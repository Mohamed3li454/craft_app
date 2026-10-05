/**
 * Evaluation Intelligence 2.0 Service (Phase 12.6)
 *
 * Central aggregator for all evaluation intelligence domains:
 * - Quality Trends & Moving Averages
 * - Degradation Signals & Quality Health Classification
 * - 7-Dimension Intelligence with Deltas & Subsystem Health
 * - Deterministic Best / Worst / Flaky Cases
 * - Failure Taxonomy Analytics & Clustered Fingerprints
 * - Latency Percentiles (p50/p90/p95/p99) & Token Distribution
 * - Deterministic Root Cause Hints
 * - Provider / Model Comparative Diagnostics
 * - Measurement Quality Confidence
 * - Release vs Release Comparison with "Changed Cases Only" Filter
 *
 * Strict Invariants:
 * - 100% deterministic code. Zero LLM judge.
 * - Read-only queries against evaluation tables; bounded history scans (max 20-50 runs).
 * - Zero mutation of business tables.
 * - Real values or explicit 'N/A' / 'INSUFFICIENT_HISTORY' / 'ROOT_CAUSE_DATA_UNAVAILABLE' fallbacks.
 */

import { EvaluationRepository, EvaluationRunRecord, EvaluationCaseResultRecord } from '../../../database/repositories/evaluation.repo';
import {
  computeQualityTrends,
  buildRunTrendSummary,
  QualityTrendIntelligence,
  RunTrendSummary,
} from './trend_intelligence';
import {
  detectDegradation,
  DegradationDetectionResult,
  QualityHealthStatus,
} from './degradation_detector';
import {
  rankBestCases,
  rankWorstCases,
  detectFlakyCases,
  RankedCaseItem,
  FlakyCaseItem,
} from './case_intelligence';
import {
  computePerformanceIntelligence,
  PerformanceIntelligenceResult,
} from './performance_intelligence';
import {
  analyzeRootCauses,
  RootCauseAnalysisResult,
} from './root_cause_intelligence';
import {
  computeMeasurementConfidence,
  MeasurementConfidenceResult,
} from './measurement_confidence';
import {
  computeDimensionHealth,
  clusterFailures,
  computeProviderDiagnostics,
  DimensionHealth,
  FailureCluster,
  ProviderDiagnosticItem,
  classifyFailure,
  FailureCategory,
} from './quality_intelligence';
import { extractReleaseMetadata, ReleaseMetadata } from './release_quality';
import { GOLDEN_EVALUATION_DATASET } from './dataset';
import { EvaluationCategory } from './types';

export type ComparisonCaseCategory =
  | 'NEW FAILURE'
  | 'RESOLVED'
  | 'REGRESSED'
  | 'IMPROVED'
  | 'CHANGED'
  | 'UNCHANGED';

export interface EnhancedCaseComparisonItem {
  caseId: string;
  dimension: string;
  title: string;
  category: ComparisonCaseCategory;
  runA: {
    status: string;
    score: number;
    durationMs: number;
    failureReason?: string | null;
  };
  runB: {
    status: string;
    score: number;
    durationMs: number;
    failureReason?: string | null;
  };
  scoreDelta: number;
  durationDeltaMs: number;
}

export interface ReleaseComparisonResult {
  runA: EvaluationRunRecord;
  runB: EvaluationRunRecord;
  releaseA: ReleaseMetadata;
  releaseB: ReleaseMetadata;
  isSameDataset: boolean;
  metrics: {
    scoreDelta: number;
    passRateDeltaPp: number;
    failuresDelta: number;
    regressionsDelta: number;
    durationDeltaMs: number;
    tokensDelta: number;
  };
  summaryCounts: {
    total: number;
    changed: number;
    newFailures: number;
    resolved: number;
    regressed: number;
    improved: number;
    unchanged: number;
  };
  dimensionDeltas: {
    dimension: string;
    scoreA: number;
    scoreB: number;
    scoreDelta: number;
    passRateA: number;
    passRateB: number;
    passRateDeltaPp: number;
  }[];
  cases: EnhancedCaseComparisonItem[];
}

export interface EnrichedDimensionHealthItem extends DimensionHealth {
  previousScore: number | 'INSUFFICIENT_HISTORY';
  scoreDelta: number | 'INSUFFICIENT_HISTORY';
  trend: 'improving' | 'stable' | 'degrading' | 'insufficient_history';
  healthStatus: 'HEALTHY' | 'WATCH' | 'DEGRADED';
}

export interface FailureTaxonomyAnalytics {
  category: FailureCategory;
  count: number;
  percentage: number;
  affectedDimensions: string[];
  affectedCases: string[];
  consecutiveOccurrences: number;
}

export interface EvaluationIntelligenceOverview {
  healthStatus: QualityHealthStatus;
  statusReason: string;
  currentRun: RunTrendSummary | null;
  measurementConfidence: MeasurementConfidenceResult;
  trends: QualityTrendIntelligence;
  degradation: DegradationDetectionResult;
  dimensions: Record<string, EnrichedDimensionHealthItem>;
  failures: {
    totalFailures: number;
    taxonomyAnalytics: FailureTaxonomyAnalytics[];
    clusters: FailureCluster[];
  };
  bestCases: RankedCaseItem[];
  worstCases: RankedCaseItem[];
  flakyCases: FlakyCaseItem[];
  performance: PerformanceIntelligenceResult;
  rootCauses: RootCauseAnalysisResult;
  providers: {
    status: 'available' | 'INSUFFICIENT_PROVIDER_DATA';
    diagnostics: ProviderDiagnosticItem[];
  };
  lastUpdated: string;
}

export class EvaluationIntelligenceService {
  private static instance: EvaluationIntelligenceService;

  constructor(private repo: EvaluationRepository = EvaluationRepository.getInstance()) {}

  public static getInstance(): EvaluationIntelligenceService {
    if (!EvaluationIntelligenceService.instance) {
      EvaluationIntelligenceService.instance = new EvaluationIntelligenceService();
    }
    return EvaluationIntelligenceService.instance;
  }

  /**
   * Retrieves comprehensive Evaluation Intelligence 2.0 overview.
   */
  public async getIntelligenceOverview(options?: {
    historyLimit?: number;
  }): Promise<EvaluationIntelligenceOverview> {
    const boundHistoryLimit = Math.max(5, Math.min(50, options?.historyLimit ?? 20));

    // Fetch bounded recent runs
    const { runs } = await this.repo.listRuns({ limit: boundHistoryLimit });
    const completedRuns = runs.filter((r) => r.status === 'completed');

    if (completedRuns.length === 0) {
      return this.buildEmptyOverview();
    }

    const latestRun = completedRuns[0];

    // Fetch case results for latest run
    const { results: latestResults } = await this.repo.getCaseResultsByRunId(latestRun.id, { limit: 100 });

    // Fetch previous run results if available
    let prevResults: EvaluationCaseResultRecord[] = [];
    if (completedRuns.length > 1) {
      const { results } = await this.repo.getCaseResultsByRunId(completedRuns[1].id, { limit: 100 });
      prevResults = results;
    }

    // Build trend summaries for each completed run
    const runSummaries: RunTrendSummary[] = [];
    for (const r of completedRuns) {
      if (r.id === latestRun.id) {
        runSummaries.push(buildRunTrendSummary(r, latestResults));
      } else if (completedRuns.length > 1 && r.id === completedRuns[1].id) {
        runSummaries.push(buildRunTrendSummary(r, prevResults));
      } else {
        runSummaries.push(buildRunTrendSummary(r, []));
      }
    }

    // 1. Trends
    const trends = computeQualityTrends(runSummaries);

    // 2. Base Dimension Health
    const baseDimHealth = computeDimensionHealth(latestResults);
    const prevDimHealth = prevResults.length > 0 ? computeDimensionHealth(prevResults) : null;

    // Enriched Dimensions
    const dimensions: Record<string, EnrichedDimensionHealthItem> = {};
    for (const [dim, health] of Object.entries(baseDimHealth)) {
      const prevHealth = prevDimHealth ? prevDimHealth[dim as EvaluationCategory] : null;
      let prevScore: number | 'INSUFFICIENT_HISTORY' = 'INSUFFICIENT_HISTORY';
      let scoreDelta: number | 'INSUFFICIENT_HISTORY' = 'INSUFFICIENT_HISTORY';
      let trend: 'improving' | 'stable' | 'degrading' | 'insufficient_history' = 'insufficient_history';

      if (prevHealth && prevHealth.evaluatedCases > 0) {
        prevScore = prevHealth.averageScore;
        const delta = Math.round((health.averageScore - prevHealth.averageScore) * 10) / 10;
        scoreDelta = delta;
        trend = delta > 0.5 ? 'improving' : delta < -0.5 ? 'degrading' : 'stable';
      }

      let healthStatus: 'HEALTHY' | 'WATCH' | 'DEGRADED' = 'HEALTHY';
      if (health.regressionsCount > 0 || health.passRate < 80 || health.averageScore < 80) {
        healthStatus = health.regressionsCount >= 2 || health.passRate < 70 ? 'DEGRADED' : 'WATCH';
      }

      dimensions[dim] = {
        ...health,
        previousScore: prevScore,
        scoreDelta: scoreDelta,
        trend,
        healthStatus,
      };
    }

    // 3. Degradation Detection
    const degradation = detectDegradation(runSummaries, baseDimHealth);

    // 4. Case Intelligence: Best, Worst, Flaky
    const bestCases = rankBestCases(latestResults, 10);
    const worstCases = rankWorstCases(latestResults, 10);

    // For Flaky detection, fetch recent case results across recent runs (up to 500 records)
    const recentResults = await this.repo.getRecentCaseResults(500);
    const flakyCases = detectFlakyCases(recentResults, 3);

    // 5. Failure Intelligence & Taxonomy Analytics
    const failedCases = latestResults.filter((r) => r.status === 'failed' || r.status === 'error');
    const clusters = clusterFailures(latestResults);

    const taxonomyCounts = new Map<FailureCategory, { count: number; dims: Set<string>; cases: Set<string> }>();
    for (const f of failedCases) {
      const { category } = classifyFailure(f.dimension, f.expected, f.actual, f.failureReason);
      const existing = taxonomyCounts.get(category) || { count: 0, dims: new Set<string>(), cases: new Set<string>() };
      existing.count++;
      existing.dims.add(f.dimension);
      existing.cases.add(f.caseId);
      taxonomyCounts.set(category, existing);
    }

    const taxonomyAnalytics: FailureTaxonomyAnalytics[] = Array.from(taxonomyCounts.entries())
      .map(([cat, data]) => ({
        category: cat,
        count: data.count,
        percentage: failedCases.length > 0 ? Math.round((data.count / failedCases.length) * 100) : 0,
        affectedDimensions: Array.from(data.dims),
        affectedCases: Array.from(data.cases),
        consecutiveOccurrences: 1,
      }))
      .sort((a, b) => b.count - a.count);

    // 6. Performance Intelligence
    const performance = computePerformanceIntelligence(latestResults);

    // 7. Root Cause Hints
    const rootCauses = analyzeRootCauses(latestResults);

    // 8. Provider / Model Diagnostics
    const providerDiagnostics = computeProviderDiagnostics(latestResults);
    const hasValidProviderData = providerDiagnostics.some(
      (p) => p.provider !== 'Not Tracked' && p.model !== 'Not Tracked'
    );

    // 9. Measurement Confidence
    const measurementConfidence = computeMeasurementConfidence(completedRuns, latestResults, GOLDEN_EVALUATION_DATASET.length);

    return {
      healthStatus: degradation.healthStatus,
      statusReason: degradation.statusReason,
      currentRun: runSummaries[0],
      measurementConfidence,
      trends,
      degradation,
      dimensions,
      failures: {
        totalFailures: failedCases.length,
        taxonomyAnalytics,
        clusters,
      },
      bestCases,
      worstCases,
      flakyCases,
      performance,
      rootCauses,
      providers: {
        status: hasValidProviderData ? 'available' : 'INSUFFICIENT_PROVIDER_DATA',
        diagnostics: providerDiagnostics,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Release vs Release Comparison with Changed Cases Only Filtering.
   */
  public async compareReleases(
    runIdA: string,
    runIdB: string,
    options?: {
      changedCasesOnly?: boolean;
      filterCategory?: ComparisonCaseCategory | 'ALL';
    }
  ): Promise<ReleaseComparisonResult | null> {
    const [runA, runB] = await Promise.all([
      this.repo.getRunById(runIdA),
      this.repo.getRunById(runIdB),
    ]);

    if (!runA || !runB) return null;

    const [{ results: resA }, { results: resB }] = await Promise.all([
      this.repo.getCaseResultsByRunId(runIdA, { limit: 200 }),
      this.repo.getCaseResultsByRunId(runIdB, { limit: 200 }),
    ]);

    const isSameDataset = runA.datasetVersion === runB.datasetVersion;
    const releaseA = extractReleaseMetadata(runA.metadata?.release || runA.metadata);
    const releaseB = extractReleaseMetadata(runB.metadata?.release || runB.metadata);

    const mapA = new Map<string, EvaluationCaseResultRecord>();
    const mapB = new Map<string, EvaluationCaseResultRecord>();
    for (const r of resA) mapA.set(r.caseId, r);
    for (const r of resB) mapB.set(r.caseId, r);

    const passRateA = runA.totalCases > 0 ? (runA.passedCases / runA.totalCases) * 100 : 0;
    const passRateB = runB.totalCases > 0 ? (runB.passedCases / runB.totalCases) * 100 : 0;

    const allCaseIds = new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]);
    const comparisonCases: EnhancedCaseComparisonItem[] = [];

    let countNewFailures = 0;
    let countResolved = 0;
    let countRegressed = 0;
    let countImproved = 0;
    let countChanged = 0;
    let countUnchanged = 0;

    for (const caseId of allCaseIds) {
      const caseA = mapA.get(caseId);
      const caseB = mapB.get(caseId);
      if (!caseA || !caseB) continue;

      const meta = GOLDEN_EVALUATION_DATASET.find((c) => c.id === caseId);
      const statusA = caseA.status;
      const statusB = caseB.status;
      const scoreA = caseA.score ?? 0;
      const scoreB = caseB.score ?? 0;

      let category: ComparisonCaseCategory = 'UNCHANGED';

      if (statusA === statusB && scoreA === scoreB) {
        category = 'UNCHANGED';
        countUnchanged++;
      } else if (statusA === 'passed' && (statusB === 'failed' || statusB === 'error')) {
        category = 'REGRESSED';
        countRegressed++;
        countChanged++;
      } else if ((statusA === 'failed' || statusA === 'error') && statusB === 'passed') {
        category = 'RESOLVED';
        countResolved++;
        countChanged++;
      } else if (statusA === 'passed' && statusB !== 'passed') {
        category = 'NEW FAILURE';
        countNewFailures++;
        countChanged++;
      } else if (scoreB > scoreA) {
        category = 'IMPROVED';
        countImproved++;
        countChanged++;
      } else {
        category = 'CHANGED';
        countChanged++;
      }

      comparisonCases.push({
        caseId,
        dimension: caseB.dimension || caseA.dimension,
        title: meta?.name || caseId,
        category,
        runA: {
          status: statusA,
          score: scoreA,
          durationMs: caseA.durationMs ?? 0,
          failureReason: caseA.failureReason,
        },
        runB: {
          status: statusB,
          score: scoreB,
          durationMs: caseB.durationMs ?? 0,
          failureReason: caseB.failureReason,
        },
        scoreDelta: Math.round((scoreB - scoreA) * 10) / 10,
        durationDeltaMs: (caseB.durationMs ?? 0) - (caseA.durationMs ?? 0),
      });
    }

    // Dimension Deltas
    const dimensions: EvaluationCategory[] = [
      'memory',
      'conversation',
      'personalization',
      'adaptive_response',
      'agent',
      'provider',
      'proactive',
    ];

    const dimensionDeltas = dimensions.map((dim) => {
      const dimA = resA.filter((r) => r.dimension === dim);
      const dimB = resB.filter((r) => r.dimension === dim);

      const scA = dimA.length > 0 ? dimA.reduce((sum, r) => sum + r.score, 0) / dimA.length : 100;
      const scB = dimB.length > 0 ? dimB.reduce((sum, r) => sum + r.score, 0) / dimB.length : 100;
      const prA = dimA.length > 0 ? (dimA.filter((r) => r.status === 'passed').length / dimA.length) * 100 : 100;
      const prB = dimB.length > 0 ? (dimB.filter((r) => r.status === 'passed').length / dimB.length) * 100 : 100;

      return {
        dimension: dim,
        scoreA: Math.round(scA * 10) / 10,
        scoreB: Math.round(scB * 10) / 10,
        scoreDelta: Math.round((scB - scA) * 10) / 10,
        passRateA: Math.round(prA * 10) / 10,
        passRateB: Math.round(prB * 10) / 10,
        passRateDeltaPp: Math.round((prB - prA) * 10) / 10,
      };
    });

    const tokensA = resA.reduce((sum, r) => sum + (r.tokens || 0), 0);
    const tokensB = resB.reduce((sum, r) => sum + (r.tokens || 0), 0);

    // Apply filtering
    let filteredCases = comparisonCases;
    if (options?.changedCasesOnly || options?.filterCategory === 'CHANGED') {
      filteredCases = filteredCases.filter((c) => c.category !== 'UNCHANGED');
    } else if (options?.filterCategory && options.filterCategory !== 'ALL') {
      filteredCases = filteredCases.filter((c) => c.category === options.filterCategory);
    }

    return {
      runA,
      runB,
      releaseA,
      releaseB,
      isSameDataset,
      metrics: {
        scoreDelta: Math.round(((runB.overallScore || 0) - (runA.overallScore || 0)) * 10) / 10,
        passRateDeltaPp: Math.round((passRateB - passRateA) * 10) / 10,
        failuresDelta: (runB.failedCases || 0) - (runA.failedCases || 0),
        regressionsDelta: (runB.regressionCount || 0) - (runA.regressionCount || 0),
        durationDeltaMs: (runB.durationMs || 0) - (runA.durationMs || 0),
        tokensDelta: tokensB - tokensA,
      },
      summaryCounts: {
        total: allCaseIds.size,
        changed: countChanged,
        newFailures: countNewFailures,
        resolved: countResolved,
        regressed: countRegressed,
        improved: countImproved,
        unchanged: countUnchanged,
      },
      dimensionDeltas,
      cases: filteredCases,
    };
  }

  private buildEmptyOverview(): EvaluationIntelligenceOverview {
    return {
      healthStatus: 'INSUFFICIENT_DATA',
      statusReason: 'No completed evaluation runs available',
      currentRun: null,
      measurementConfidence: computeMeasurementConfidence([]),
      trends: computeQualityTrends([]),
      degradation: detectDegradation([]),
      dimensions: {},
      failures: { totalFailures: 0, taxonomyAnalytics: [], clusters: [] },
      bestCases: [],
      worstCases: [],
      flakyCases: [],
      performance: computePerformanceIntelligence([]),
      rootCauses: { status: 'ROOT_CAUSE_DATA_UNAVAILABLE', analyzedFailuresCount: 0, factors: [], summary: 'No evaluation data.' },
      providers: { status: 'INSUFFICIENT_PROVIDER_DATA', diagnostics: [] },
      lastUpdated: new Date().toISOString(),
    };
  }
}
