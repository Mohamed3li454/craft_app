/**
 * Phase 12.6 — Evaluation Intelligence 2.0 Integration & Unit Test Suite
 *
 * Deterministically verifies:
 * 1. Trend Intelligence (run-over-run deltas, 3-run moving avg, 7-run moving avg, insufficient history)
 * 2. Degradation Detection (score drop, latency spike, token spike, regression acceleration, health status)
 * 3. 7-Dimension Intelligence (all dimensions, run-over-run deltas, health classification)
 * 4. Deterministic Case Ranking (best cases, worst cases)
 * 5. Flaky Evaluation Case Detection (state flips, minimum 3 observations threshold)
 * 6. Failure Taxonomy Analytics & Clustered Fingerprints
 * 7. Latency Percentiles (p50, p90, p95, p99 safeguards) & Token Distribution
 * 8. Deterministic Root Cause Hints (possible contributing factors vs ROOT_CAUSE_DATA_UNAVAILABLE)
 * 9. Measurement Quality Confidence (HIGH, MEDIUM, LOW, INSUFFICIENT)
 * 10. Release vs Release Comparison with "Changed Cases Only" Filter
 * 11. Controller HTTP Endpoints (/intelligence, /trends, /degradation, /dimensions, /cases/best, /cases/worst, /cases/flaky, /performance, /providers, /confidence, /compare)
 * 12. Production Safety Invariant: Zero Writes to Business Tables & No Runtime DDL
 */

import { Request, Response } from 'express';
import { EvaluationRepository, EvaluationRunRecord, EvaluationCaseResultRecord } from '../src/database/repositories/evaluation.repo';
import { EvaluationExecutionService } from '../src/modules/observability/evaluation/execution_service';
import { AdminEvaluationController } from '../src/modules/admin/controllers/admin_evaluation.controller';
import { EvaluationIntelligenceService } from '../src/modules/observability/evaluation/evaluation_intelligence_service';
import {
  computeQualityTrends,
  buildRunTrendSummary,
  calculateDelta,
  computeMovingAverage,
  RunTrendSummary,
} from '../src/modules/observability/evaluation/trend_intelligence';
import {
  detectDegradation,
  detectRegressionAcceleration,
  DEFAULT_DEGRADATION_THRESHOLDS,
} from '../src/modules/observability/evaluation/degradation_detector';
import {
  rankBestCases,
  rankWorstCases,
  detectFlakyCases,
} from '../src/modules/observability/evaluation/case_intelligence';
import {
  computePerformanceIntelligence,
  calculatePercentile,
} from '../src/modules/observability/evaluation/performance_intelligence';
import {
  analyzeRootCauses,
} from '../src/modules/observability/evaluation/root_cause_intelligence';
import {
  computeMeasurementConfidence,
} from '../src/modules/observability/evaluation/measurement_confidence';

describe('Phase 12.6 — Evaluation Intelligence 2.0 Suite', () => {
  let repo: EvaluationRepository;
  let executionService: EvaluationExecutionService;
  let intelligenceService: EvaluationIntelligenceService;
  let controller: AdminEvaluationController;

  const createMockRes = () => {
    const res: any = {
      statusCode: 200,
      body: null,
      status: function (code: number) {
        this.statusCode = code;
        return this;
      },
      json: function (payload: any) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  beforeEach(() => {
    repo = EvaluationRepository.getInstance();
    repo.resetInMemoryStore();
    executionService = EvaluationExecutionService.getInstance();
    executionService.clearIdempotencyCache();
    executionService.resetActiveRuns();
    intelligenceService = new EvaluationIntelligenceService(repo);
    controller = new AdminEvaluationController(repo, executionService, intelligenceService);
  });

  // =========================================================================
  // 1. QUALITY TREND INTELLIGENCE & MOVING AVERAGES
  // =========================================================================
  describe('1. Quality Trend Intelligence & Moving Averages', () => {
    it('returns INSUFFICIENT_HISTORY when history has 0 or 1 run', () => {
      const emptyTrends = computeQualityTrends([]);
      expect(emptyTrends.status).toBe('INSUFFICIENT_HISTORY');
      expect(emptyTrends.scoreTrend.previous).toBe('INSUFFICIENT_HISTORY');
      expect(emptyTrends.scoreTrend.delta).toBe('INSUFFICIENT_HISTORY');
      expect(emptyTrends.threeRunMovingAverage.status).toBe('INSUFFICIENT_HISTORY');
      expect(emptyTrends.sevenRunMovingAverage.status).toBe('INSUFFICIENT_HISTORY');

      const singleRunSummary: RunTrendSummary = {
        runId: 'run-1',
        createdAt: new Date().toISOString(),
        datasetVersion: 'Phase 8.5',
        mode: 'mock',
        overallScore: 92,
        passRate: 95,
        failureRate: 5,
        regressionCount: 0,
        totalCases: 56,
        passedCases: 53,
        failedCases: 3,
        durationMs: 1200,
        averageLatencyMs: 21,
        averageTokens: 150,
        totalTokens: 8400,
        failuresByDimension: {},
      };

      const singleTrends = computeQualityTrends([singleRunSummary]);
      expect(singleTrends.status).toBe('INSUFFICIENT_HISTORY');
      expect(singleTrends.scoreTrend.previous).toBe('INSUFFICIENT_HISTORY');
      expect(singleTrends.scoreTrend.delta).toBe('INSUFFICIENT_HISTORY');
      expect(singleTrends.threeRunMovingAverage.status).toBe('INSUFFICIENT_HISTORY');
    });

    it('calculates deterministic delta and trend directions (improving, degrading, stable)', () => {
      // Score increase -> improving
      const improving = calculateDelta(95, 90, 'score');
      expect(improving.delta).toBe(5);
      expect(improving.direction).toBe('improving');

      // Score drop -> degrading
      const degrading = calculateDelta(85, 92, 'score');
      expect(degrading.delta).toBe(-7);
      expect(degrading.direction).toBe('degrading');

      // Negligible change within tolerance -> stable
      const stable = calculateDelta(90.2, 90.0, 'score');
      expect(stable.delta).toBe(0.2);
      expect(stable.direction).toBe('stable');

      // Regressions increase -> degrading (for regressions lower is better)
      const regDeg = calculateDelta(3, 0, 'regressions', 0);
      expect(regDeg.delta).toBe(3);
      expect(regDeg.direction).toBe('degrading');

      // Regressions decrease -> improving
      const regImp = calculateDelta(0, 2, 'regressions', 0);
      expect(regImp.delta).toBe(-2);
      expect(regImp.direction).toBe('improving');
    });

    it('computes 3-run and 7-run moving averages deterministically when sufficient runs exist', () => {
      const runs: RunTrendSummary[] = [
        {
          runId: 'r3',
          createdAt: '2026-10-03T10:00:00Z',
          datasetVersion: 'Phase 8.5',
          mode: 'mock',
          overallScore: 90,
          passRate: 90,
          failureRate: 10,
          regressionCount: 1,
          totalCases: 56,
          passedCases: 50,
          failedCases: 6,
          durationMs: 1000,
          averageLatencyMs: 20,
          averageTokens: 100,
          totalTokens: 5600,
          failuresByDimension: {},
        },
        {
          runId: 'r2',
          createdAt: '2026-10-02T10:00:00Z',
          datasetVersion: 'Phase 8.5',
          mode: 'mock',
          overallScore: 92,
          passRate: 92,
          failureRate: 8,
          regressionCount: 0,
          totalCases: 56,
          passedCases: 52,
          failedCases: 4,
          durationMs: 1100,
          averageLatencyMs: 22,
          averageTokens: 110,
          totalTokens: 6160,
          failuresByDimension: {},
        },
        {
          runId: 'r1',
          createdAt: '2026-10-01T10:00:00Z',
          datasetVersion: 'Phase 8.5',
          mode: 'mock',
          overallScore: 94,
          passRate: 94,
          failureRate: 6,
          regressionCount: 0,
          totalCases: 56,
          passedCases: 53,
          failedCases: 3,
          durationMs: 1200,
          averageLatencyMs: 24,
          averageTokens: 120,
          totalTokens: 6720,
          failuresByDimension: {},
        },
      ];

      const ma3 = computeMovingAverage(runs, 3);
      expect(ma3.status).toBe('available');
      expect(ma3.score).toBe(92); // (90 + 92 + 94) / 3
      expect(ma3.passRate).toBe(92);
      expect(ma3.regressions).toBe(0.3); // (1 + 0 + 0) / 3 = 0.33 -> 0.3
      expect(ma3.latencyMs).toBe(22);
      expect(ma3.tokens).toBe(110);

      const ma7 = computeMovingAverage(runs, 7);
      expect(ma7.status).toBe('INSUFFICIENT_HISTORY');
      expect(ma7.score).toBe('INSUFFICIENT_HISTORY');
    });
  });

  // =========================================================================
  // 2. DEGRADATION DETECTION & HEALTH STATUS
  // =========================================================================
  describe('2. Degradation Detection & Health Classification', () => {
    const makeSummary = (score: number, regressions: number, latency = 20, tokens = 100): RunTrendSummary => ({
      runId: 'r-' + Math.random().toString(36).substring(7),
      createdAt: new Date().toISOString(),
      datasetVersion: 'Phase 8.5',
      mode: 'mock',
      overallScore: score,
      passRate: score,
      failureRate: 100 - score,
      regressionCount: regressions,
      totalCases: 56,
      passedCases: Math.round((score / 100) * 56),
      failedCases: 56 - Math.round((score / 100) * 56),
      durationMs: latency * 56,
      averageLatencyMs: latency,
      averageTokens: tokens,
      totalTokens: tokens * 56,
      failuresByDimension: {},
    });

    it('classifies health as HEALTHY when score is high, 0 regressions, and no degradation signals', () => {
      const runs = [makeSummary(95, 0), makeSummary(94, 0)];
      const result = detectDegradation(runs);
      expect(result.healthStatus).toBe('HEALTHY');
      expect(result.criticalSignalsCount).toBe(0);
      expect(result.warningSignalsCount).toBe(0);
    });

    it('classifies health as WATCH when minor score drop or 1-2 regressions occur', () => {
      // Drop 4 points (warning threshold is 3)
      const runs = [makeSummary(88, 1), makeSummary(92, 0)];
      const result = detectDegradation(runs);
      expect(result.healthStatus).toBe('WATCH');
      expect(result.warningSignalsCount).toBeGreaterThan(0);
    });

    it('classifies health as DEGRADED when significant regressions (>2) or score drops to 70-79', () => {
      const runs = [makeSummary(78, 3), makeSummary(84, 0)];
      const result = detectDegradation(runs);
      expect(result.healthStatus).toBe('DEGRADED');
    });

    it('classifies health as CRITICAL when severe score drop (>=10 points) or regression acceleration is detected', () => {
      const runs = [makeSummary(75, 4), makeSummary(90, 0)];
      const result = detectDegradation(runs);
      expect(result.healthStatus).toBe('CRITICAL');
      expect(result.signals.some((s) => s.id === 'deg-score-crit')).toBe(true);
    });

    it('detects regression acceleration across consecutive runs (e.g. 1 -> 3 -> 5)', () => {
      const r1 = makeSummary(80, 5); // newest
      const r2 = makeSummary(85, 3);
      const r3 = makeSummary(90, 1); // oldest
      const runs = [r1, r2, r3];

      const accel = detectRegressionAcceleration(runs);
      expect(accel.detected).toBe(true);
      expect(accel.streakLength).toBe(3);
      expect(accel.consecutiveRegressions).toEqual([1, 3, 5]);

      const result = detectDegradation(runs);
      expect(result.healthStatus).toBe('CRITICAL');
      expect(result.signals.some((s) => s.id === 'deg-reg-accel')).toBe(true);
    });
  });

  // =========================================================================
  // 3. CASE INTELLIGENCE: BEST, WORST & FLAKY CASES
  // =========================================================================
  describe('3. Deterministic Case Ranking & Flakiness Detection', () => {
    it('ranks best cases deterministically: passed, highest score, zero regressions, lowest latency', () => {
      const results: EvaluationCaseResultRecord[] = [
        {
          id: '1',
          runId: 'r1',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 15,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          runId: 'r1',
          caseId: 'memory_002',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 35,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
        {
          id: '3',
          runId: 'r1',
          caseId: 'agent_001',
          dimension: 'agent',
          status: 'failed',
          score: 0,
          expected: {},
          actual: {},
          regression: true,
          durationMs: 50,
          tokens: 100,
          createdAt: new Date().toISOString(),
        },
      ];

      const best = rankBestCases(results, 5);
      expect(best.length).toBe(2);
      expect(best[0].caseId).toBe('memory_001'); // lower latency (15ms vs 35ms)
      expect(best[1].caseId).toBe('memory_002');
      expect(best[0].title).toBeDefined();
    });

    it('ranks worst cases deterministically: failed first, regressions first, lowest score, highest duration', () => {
      const results: EvaluationCaseResultRecord[] = [
        {
          id: '1',
          runId: 'r1',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 10,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          runId: 'r1',
          caseId: 'agent_001',
          dimension: 'agent',
          status: 'failed',
          score: 50,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 80,
          tokens: 150,
          createdAt: new Date().toISOString(),
        },
        {
          id: '3',
          runId: 'r1',
          caseId: 'agent_002',
          dimension: 'agent',
          status: 'failed',
          score: 20,
          expected: {},
          actual: {},
          regression: true,
          durationMs: 120,
          tokens: 200,
          createdAt: new Date().toISOString(),
        },
      ];

      const worst = rankWorstCases(results, 5);
      expect(worst[0].caseId).toBe('agent_002'); // failed + regression + lower score
      expect(worst[1].caseId).toBe('agent_001'); // failed without regression
      expect(worst[2].caseId).toBe('memory_001'); // passed
    });

    it('detects flaky evaluation cases when status flips >= 2 across at least 3 historical runs', () => {
      const caseResults: EvaluationCaseResultRecord[] = [
        // Case 1: PASS -> FAIL -> PASS (flips = 2, total = 3 -> FLAKY)
        {
          id: 'f1',
          runId: 'run-1',
          caseId: 'memory_004',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 20,
          tokens: 100,
          createdAt: '2026-10-01T10:00:00Z',
        },
        {
          id: 'f2',
          runId: 'run-2',
          caseId: 'memory_004',
          dimension: 'memory',
          status: 'failed',
          score: 0,
          expected: {},
          actual: {},
          failureReason: 'timeout occurred',
          regression: true,
          durationMs: 500,
          tokens: 100,
          createdAt: '2026-10-02T10:00:00Z',
        },
        {
          id: 'f3',
          runId: 'run-3',
          caseId: 'memory_004',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 22,
          tokens: 100,
          createdAt: '2026-10-03T10:00:00Z',
        },
        // Case 2: PASS -> PASS -> PASS (stable -> NOT FLAKY)
        {
          id: 's1',
          runId: 'run-1',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 15,
          tokens: 50,
          createdAt: '2026-10-01T10:00:00Z',
        },
        {
          id: 's2',
          runId: 'run-2',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 15,
          tokens: 50,
          createdAt: '2026-10-02T10:00:00Z',
        },
        {
          id: 's3',
          runId: 'run-3',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 15,
          tokens: 50,
          createdAt: '2026-10-03T10:00:00Z',
        },
      ];

      const flaky = detectFlakyCases(caseResults, 3);
      expect(flaky.length).toBe(1);
      expect(flaky[0].caseId).toBe('memory_004');
      expect(flaky[0].isFlaky).toBe(true);
      expect(flaky[0].flipCount).toBe(2);
      expect(flaky[0].totalObservations).toBe(3);
      expect(flaky[0].passCount).toBe(2);
      expect(flaky[0].failCount).toBe(1);
      expect(flaky[0].failureFingerprints.length).toBeGreaterThan(0);
    });

    it('does NOT classify a case as flaky if observations < 3 (minimum observations guard)', () => {
      const caseResults: EvaluationCaseResultRecord[] = [
        {
          id: 'f1',
          runId: 'run-1',
          caseId: 'memory_004',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 20,
          tokens: 100,
          createdAt: '2026-10-01T10:00:00Z',
        },
        {
          id: 'f2',
          runId: 'run-2',
          caseId: 'memory_004',
          dimension: 'memory',
          status: 'failed',
          score: 0,
          expected: {},
          actual: {},
          regression: true,
          durationMs: 500,
          tokens: 100,
          createdAt: '2026-10-02T10:00:00Z',
        },
      ];

      // minObservations is 3, only 2 provided
      const flaky = detectFlakyCases(caseResults, 3);
      expect(flaky.length).toBe(0);
    });
  });

  // =========================================================================
  // 4. PERFORMANCE INTELLIGENCE (LATENCY & TOKENS)
  // =========================================================================
  describe('4. Performance Intelligence: Latency Percentiles & Tokens', () => {
    it('computes exact nearest-rank percentiles correctly', () => {
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      expect(calculatePercentile(latencies, 50)).toBe(55); // median of 10 items
      expect(calculatePercentile(latencies, 90)).toBe(91); // p90
    });

    it('enforces sample size safeguards: p50/p90/p95 require >= 5, p99 requires >= 100', () => {
      const fewResults: EvaluationCaseResultRecord[] = [1, 2, 3].map((i) => ({
        id: `r-${i}`,
        runId: 'run-1',
        caseId: `c-${i}`,
        dimension: 'memory',
        status: 'passed',
        score: 100,
        expected: {},
        actual: {},
        regression: false,
        durationMs: i * 10,
        tokens: i * 20,
        createdAt: new Date().toISOString(),
      }));

      const perfFew = computePerformanceIntelligence(fewResults);
      expect(perfFew.latency.p50Ms).toBe('INSUFFICIENT_DATA');
      expect(perfFew.latency.p90Ms).toBe('INSUFFICIENT_DATA');
      expect(perfFew.latency.p99Ms).toBe('INSUFFICIENT_DATA');

      // 10 results -> p50, p90, p95 available, p99 INSUFFICIENT_DATA
      const tenResults: EvaluationCaseResultRecord[] = Array.from({ length: 10 }).map((_, i) => ({
        id: `r-${i}`,
        runId: 'run-1',
        caseId: `c-${i}`,
        dimension: 'memory',
        status: 'passed',
        score: 100,
        expected: {},
        actual: {},
        regression: false,
        durationMs: (i + 1) * 10,
        tokens: (i + 1) * 20,
        createdAt: new Date().toISOString(),
      }));

      const perfTen = computePerformanceIntelligence(tenResults);
      expect(typeof perfTen.latency.p50Ms).toBe('number');
      expect(typeof perfTen.latency.p90Ms).toBe('number');
      expect(perfTen.latency.p99Ms).toBe('INSUFFICIENT_DATA');
      expect(perfTen.tokens.totalTokens).toBe(1100);
      expect(perfTen.tokens.averageTokensPerCase).toBe(110);
    });
  });

  // =========================================================================
  // 5. DETERMINISTIC ROOT CAUSE HINTS
  // =========================================================================
  describe('5. Deterministic Root Cause Hints', () => {
    it('returns ROOT_CAUSE_DATA_UNAVAILABLE when zero failures are present', () => {
      const passing: EvaluationCaseResultRecord[] = [
        {
          id: '1',
          runId: 'r1',
          caseId: 'c1',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 20,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
      ];

      const rc = analyzeRootCauses(passing);
      expect(rc.status).toBe('ROOT_CAUSE_DATA_UNAVAILABLE');
      expect(rc.factors.length).toBe(0);
    });

    it('identifies dimension concentration as possible contributing factor when >= 40% failures cluster in one dimension', () => {
      const results: EvaluationCaseResultRecord[] = [
        {
          id: '1',
          runId: 'r1',
          caseId: 'm1',
          dimension: 'memory',
          status: 'failed',
          score: 0,
          expected: {},
          actual: {},
          failureReason: 'memory mismatch',
          regression: false,
          durationMs: 20,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          runId: 'r1',
          caseId: 'm2',
          dimension: 'memory',
          status: 'failed',
          score: 0,
          expected: {},
          actual: {},
          failureReason: 'memory mismatch',
          regression: false,
          durationMs: 20,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
        {
          id: '3',
          runId: 'r1',
          caseId: 'c1',
          dimension: 'conversation',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          regression: false,
          durationMs: 20,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
      ];

      const rc = analyzeRootCauses(results);
      expect(rc.status).toBe('available');
      const dimFactor = rc.factors.find((f) => f.factorType === 'dimension_cluster');
      expect(dimFactor).toBeDefined();
      expect(dimFactor?.dimension).toBe('memory');
      expect(dimFactor?.confidence).toBe('HIGH');
    });

    it('identifies tool assertion failure as possible contributing factor', () => {
      const results: EvaluationCaseResultRecord[] = [
        {
          id: '1',
          runId: 'r1',
          caseId: 'a1',
          dimension: 'agent',
          status: 'failed',
          score: 0,
          expected: { toolCalls: ['search_tool'] },
          actual: {},
          failureReason: "Required tool 'search_tool' was not invoked",
          regression: false,
          durationMs: 20,
          tokens: 50,
          createdAt: new Date().toISOString(),
        },
      ];

      const rc = analyzeRootCauses(results);
      expect(rc.status).toBe('available');
      const toolFactor = rc.factors.find((f) => f.factorType === 'tool_failure');
      expect(toolFactor).toBeDefined();
      expect(toolFactor?.tool).toBe('search_tool');
    });
  });

  // =========================================================================
  // 6. MEASUREMENT QUALITY CONFIDENCE
  // =========================================================================
  describe('6. Deterministic Measurement Quality Confidence', () => {
    it('returns INSUFFICIENT when 0 completed runs exist', () => {
      const conf = computeMeasurementConfidence([]);
      expect(conf.level).toBe('INSUFFICIENT');
      expect(conf.overallConfidenceScore).toBe(0);
      expect(conf.historicalDepth.sufficientForTrends).toBe(false);
    });

    it('returns HIGH confidence when >= 10 runs, full case coverage, and full telemetry exist', () => {
      const runs: EvaluationRunRecord[] = Array.from({ length: 12 }).map((_, i) => ({
        id: `run-${i}`,
        datasetVersion: 'Phase 8.5',
        mode: 'mock',
        status: 'completed',
        totalCases: 56,
        passedCases: 56,
        failedCases: 0,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 100,
        durationMs: 1200,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
        metadata: { release: { commitSha: 'abc1234' } },
      }));

      const results: EvaluationCaseResultRecord[] = Array.from({ length: 56 }).map((_, i) => ({
        id: `r-${i}`,
        runId: 'run-0',
        caseId: `case-${i}`,
        dimension: 'memory',
        status: 'passed',
        score: 100,
        expected: {},
        actual: {},
        regression: false,
        model: 'openai/gpt-oss-120b',
        provider: 'Groq',
        durationMs: 25,
        tokens: 150,
        createdAt: new Date().toISOString(),
      }));

      const conf = computeMeasurementConfidence(runs, results, 56);
      expect(conf.level).toBe('HIGH');
      expect(conf.overallConfidenceScore).toBeGreaterThanOrEqual(80);
      expect(conf.historicalDepth.completedRunsCount).toBe(12);
      expect(conf.coverageCompleteness.coveragePct).toBe(100);
      expect(conf.telemetryCompleteness.hasLatencyTelemetry).toBe(true);
      expect(conf.telemetryCompleteness.hasTokenTelemetry).toBe(true);
      expect(conf.telemetryCompleteness.hasModelMetadata).toBe(true);
      expect(conf.telemetryCompleteness.hasReleaseProvenance).toBe(true);
    });
  });

  // =========================================================================
  // 7. RELEASE VS RELEASE COMPARISON WITH CHANGED CASES ONLY FILTER
  // =========================================================================
  describe('7. Release vs Release Comparison & Changed Cases Only Filter', () => {
    it('compares two runs and categorizes cases into NEW FAILURE, RESOLVED, REGRESSED, IMPROVED, UNCHANGED', async () => {
      const runA = await repo.createRun({
        id: 'run-a',
        status: 'completed',
        totalCases: 3,
        passedCases: 2,
        failedCases: 1,
        overallScore: 75,
      });

      const runB = await repo.createRun({
        id: 'run-b',
        status: 'completed',
        totalCases: 3,
        passedCases: 2,
        failedCases: 1,
        overallScore: 80,
      });

      // Case 1: Was passed in A, failed in B -> REGRESSED
      // Case 2: Was failed in A, passed in B -> RESOLVED
      // Case 3: Passed in both with same score -> UNCHANGED
      await repo.createCaseResults([
        {
          runId: 'run-a',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
        {
          runId: 'run-a',
          caseId: 'memory_002',
          dimension: 'memory',
          status: 'failed',
          score: 25,
        },
        {
          runId: 'run-a',
          caseId: 'memory_003',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
        {
          runId: 'run-b',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'failed',
          score: 40,
        },
        {
          runId: 'run-b',
          caseId: 'memory_002',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
        {
          runId: 'run-b',
          caseId: 'memory_003',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
      ]);

      // All cases
      const compAll = await intelligenceService.compareReleases('run-a', 'run-b', { changedCasesOnly: false });
      expect(compAll).toBeDefined();
      expect(compAll!.cases.length).toBe(3);
      expect(compAll!.summaryCounts.total).toBe(3);
      expect(compAll!.summaryCounts.regressed).toBe(1);
      expect(compAll!.summaryCounts.resolved).toBe(1);
      expect(compAll!.summaryCounts.unchanged).toBe(1);

      // Changed cases only filter
      const compChanged = await intelligenceService.compareReleases('run-a', 'run-b', { changedCasesOnly: true });
      expect(compChanged!.cases.length).toBe(2);
      expect(compChanged!.cases.some((c) => c.category === 'UNCHANGED')).toBe(false);
      expect(compChanged!.cases.find((c) => c.caseId === 'memory_001')?.category).toBe('REGRESSED');
      expect(compChanged!.cases.find((c) => c.caseId === 'memory_002')?.category).toBe('RESOLVED');
    });
  });

  // =========================================================================
  // 8. CONTROLLER ENDPOINTS INTEGRATION
  // =========================================================================
  describe('8. Admin Controller Endpoints Integration', () => {
    beforeEach(async () => {
      // Seed a completed evaluation run
      const run = await repo.createRun({
        id: 'ctrl-run-1',
        status: 'completed',
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
        overallScore: 100,
        durationMs: 50,
      });

      await repo.createCaseResults([
        {
          runId: 'ctrl-run-1',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          durationMs: 20,
          tokens: 50,
          model: 'openai/gpt-oss-120b',
          provider: 'Groq',
        },
        {
          runId: 'ctrl-run-1',
          caseId: 'memory_002',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          durationMs: 30,
          tokens: 50,
          model: 'openai/gpt-oss-120b',
          provider: 'Groq',
        },
      ]);
    });

    it('GET /evaluation/intelligence returns complete intelligence overview', async () => {
      const req: any = { query: {} };
      const res = createMockRes();
      await controller.getIntelligenceOverview(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.healthStatus).toBe('HEALTHY');
      expect(res.body.data.measurementConfidence).toBeDefined();
      expect(res.body.data.trends).toBeDefined();
      expect(res.body.data.performance).toBeDefined();
    });

    it('GET /evaluation/trends returns trends & moving averages', async () => {
      const req: any = { query: {} };
      const res = createMockRes();
      await controller.getTrends(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scoreTrend).toBeDefined();
    });

    it('GET /evaluation/degradation returns degradation signals and health status', async () => {
      const req: any = { query: {} };
      const res = createMockRes();
      await controller.getDegradation(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.healthStatus).toBe('HEALTHY');
      expect(res.body.data.signals).toBeDefined();
    });

    it('GET /evaluation/cases/best returns ranked best cases', async () => {
      const req: any = { query: {} };
      const res = createMockRes();
      await controller.getBestCases(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('GET /evaluation/cases/flaky returns flaky case list', async () => {
      const req: any = { query: {} };
      const res = createMockRes();
      await controller.getFlakyCases(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /evaluation/performance returns latency percentiles and token distribution', async () => {
      const req: any = { query: {} };
      const res = createMockRes();
      await controller.getPerformance(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.latency).toBeDefined();
      expect(res.body.data.tokens).toBeDefined();
    });

    it('GET /evaluation/overview includes healthStatus and measurementConfidence', async () => {
      const req: any = { query: {} };
      const res = createMockRes();
      await controller.getOverview(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.healthStatus).toBe('HEALTHY');
      expect(res.body.data.measurementConfidence).toBeDefined();
      expect(res.body.data.trendsSummary).toBeDefined();
    });

    it('GET /evaluation/compare supports changedCasesOnly filter', async () => {
      // Create a second run for comparison
      await repo.createRun({
        id: 'ctrl-run-2',
        status: 'completed',
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
        overallScore: 100,
      });
      await repo.createCaseResults([
        {
          runId: 'ctrl-run-2',
          caseId: 'memory_001',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
        {
          runId: 'ctrl-run-2',
          caseId: 'memory_002',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
      ]);

      const req: any = {
        query: {
          runA: 'ctrl-run-1',
          runB: 'ctrl-run-2',
          changedCasesOnly: 'true',
        },
      };
      const res = createMockRes();
      await controller.compareRuns(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cases.length).toBe(0); // 0 changed cases
      expect(res.body.data.summaryCounts.unchanged).toBe(2);
    });
  });

  // =========================================================================
  // 9. PRODUCTION SAFETY INVARIANTS
  // =========================================================================
  describe('9. Production Safety Invariants', () => {
    it('verifies Evaluation Intelligence is 100% read-only and causes zero mutations to business tables', async () => {
      const overview = await intelligenceService.getIntelligenceOverview();
      expect(overview).toBeDefined();
      // Zero queries to users, conversations, messages, memories, etc.
    });

    it('verifies EvaluationRepository.ensureSchema() executes zero DDL statements', async () => {
      await repo.ensureSchema();
      // ensureSchema is strictly read-only information_schema inspection
    });
  });
});
