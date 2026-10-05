/**
 * Measurement Quality Confidence Engine (Phase 12.6)
 *
 * Implements deterministic calculation of measurement confidence for evaluation metrics.
 * Note: This represents confidence in the benchmark observation integrity and historical depth,
 * NOT an AI/LLM model subjective confidence score.
 *
 * Strict Invariant: Zero LLM judgment. Strictly deterministic based on telemetry and run depth.
 */

import { EvaluationCaseResultRecord, EvaluationRunRecord } from '../../../database/repositories/evaluation.repo';

export type MeasurementConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface ConfidenceFactor {
  factor: string;
  status: 'passed' | 'warning' | 'failed';
  weight: number;
  score: number;
  message: string;
}

export interface MeasurementConfidenceResult {
  level: MeasurementConfidenceLevel;
  overallConfidenceScore: number; // 0 to 100
  historicalDepth: {
    completedRunsCount: number;
    sufficientForTrends: boolean;
    sufficientForPercentiles: boolean;
  };
  coverageCompleteness: {
    evaluatedCases: number;
    goldenDatasetTotal: number;
    coveragePct: number;
  };
  telemetryCompleteness: {
    hasLatencyTelemetry: boolean;
    hasTokenTelemetry: boolean;
    hasModelMetadata: boolean;
    hasReleaseProvenance: boolean;
  };
  factors: ConfidenceFactor[];
}

export function computeMeasurementConfidence(
  runs: EvaluationRunRecord[],
  latestResults: EvaluationCaseResultRecord[] = [],
  goldenDatasetTotal = 56
): MeasurementConfidenceResult {
  const completedRuns = runs.filter((r) => r.status === 'completed');
  const runsCount = completedRuns.length;

  if (runsCount === 0 && latestResults.length === 0) {
    return {
      level: 'INSUFFICIENT',
      overallConfidenceScore: 0,
      historicalDepth: {
        completedRunsCount: 0,
        sufficientForTrends: false,
        sufficientForPercentiles: false,
      },
      coverageCompleteness: {
        evaluatedCases: 0,
        goldenDatasetTotal,
        coveragePct: 0,
      },
      telemetryCompleteness: {
        hasLatencyTelemetry: false,
        hasTokenTelemetry: false,
        hasModelMetadata: false,
        hasReleaseProvenance: false,
      },
      factors: [
        {
          factor: 'historical_runs',
          status: 'failed',
          weight: 35,
          score: 0,
          message: 'No completed evaluation runs found in repository.',
        },
      ],
    };
  }

  const factors: ConfidenceFactor[] = [];

  // Factor 1: Historical Run Depth (Weight 35)
  let runScore = 0;
  let runStatus: 'passed' | 'warning' | 'failed' = 'failed';
  let runMessage = 'Insufficient historical runs for reliable trend analysis';

  if (runsCount >= 10) {
    runScore = 35;
    runStatus = 'passed';
    runMessage = `Strong historical depth with ${runsCount} completed evaluation runs`;
  } else if (runsCount >= 3) {
    runScore = 25;
    runStatus = 'passed';
    runMessage = `Adequate historical depth with ${runsCount} completed evaluation runs`;
  } else if (runsCount >= 1) {
    runScore = 12;
    runStatus = 'warning';
    runMessage = `Minimal history (${runsCount} completed run(s)); trend signals have limited baseline`;
  }

  factors.push({
    factor: 'historical_depth',
    status: runStatus,
    weight: 35,
    score: runScore,
    message: runMessage,
  });

  // Factor 2: Case Coverage Completeness (Weight 35)
  const evaluatedCount = latestResults.length > 0 ? latestResults.length : (completedRuns[0]?.totalCases || 0);
  const coveragePct = goldenDatasetTotal > 0 ? Math.min(100, Math.round((evaluatedCount / goldenDatasetTotal) * 100)) : 100;

  let coverageScore = 0;
  let covStatus: 'passed' | 'warning' | 'failed' = 'failed';
  let covMessage = 'Low dataset coverage';

  if (coveragePct >= 95) {
    coverageScore = 35;
    covStatus = 'passed';
    covMessage = `Full golden benchmark coverage (${evaluatedCount}/${goldenDatasetTotal} cases evaluated)`;
  } else if (coveragePct >= 50) {
    coverageScore = 20;
    covStatus = 'warning';
    covMessage = `Partial benchmark coverage (${evaluatedCount}/${goldenDatasetTotal} cases, ${coveragePct}%)`;
  } else if (coveragePct > 0) {
    coverageScore = 10;
    covStatus = 'failed';
    covMessage = `Sub-benchmark case subset (${evaluatedCount}/${goldenDatasetTotal} cases, ${coveragePct}%)`;
  }

  factors.push({
    factor: 'case_coverage',
    status: covStatus,
    weight: 35,
    score: coverageScore,
    message: covMessage,
  });

  // Factor 3: Telemetry & Metadata Completeness (Weight 30)
  const hasLatency = latestResults.some((r) => r.durationMs > 0) || (completedRuns[0]?.durationMs || 0) > 0;
  const hasTokens = latestResults.some((r) => r.tokens > 0);
  const hasModel = latestResults.some((r) => Boolean(r.model && r.model !== 'Not Tracked'));
  const hasRelease = Boolean(
    completedRuns[0]?.metadata?.release?.commitSha ||
    completedRuns[0]?.metadata?.release?.deploymentId ||
    completedRuns[0]?.metadata?.commitSha
  );

  let telemetryScore = 0;
  if (hasLatency) telemetryScore += 10;
  if (hasTokens) telemetryScore += 8;
  if (hasModel) telemetryScore += 6;
  if (hasRelease) telemetryScore += 6;

  factors.push({
    factor: 'telemetry_completeness',
    status: telemetryScore >= 20 ? 'passed' : telemetryScore >= 10 ? 'warning' : 'failed',
    weight: 30,
    score: telemetryScore,
    message: `Telemetry completeness: Latency=${hasLatency}, Tokens=${hasTokens}, Model=${hasModel}, Release=${hasRelease}`,
  });

  const overallConfidenceScore = factors.reduce((sum, f) => sum + f.score, 0);

  let level: MeasurementConfidenceLevel = 'INSUFFICIENT';
  if (overallConfidenceScore >= 80 && runsCount >= 3) {
    level = 'HIGH';
  } else if (overallConfidenceScore >= 50 && runsCount >= 2) {
    level = 'MEDIUM';
  } else if (overallConfidenceScore >= 25 && runsCount >= 1) {
    level = 'LOW';
  } else {
    level = 'INSUFFICIENT';
  }

  return {
    level,
    overallConfidenceScore,
    historicalDepth: {
      completedRunsCount: runsCount,
      sufficientForTrends: runsCount >= 2,
      sufficientForPercentiles: evaluatedCount >= 5,
    },
    coverageCompleteness: {
      evaluatedCases: evaluatedCount,
      goldenDatasetTotal,
      coveragePct,
    },
    telemetryCompleteness: {
      hasLatencyTelemetry: hasLatency,
      hasTokenTelemetry: hasTokens,
      hasModelMetadata: hasModel,
      hasReleaseProvenance: hasRelease,
    },
    factors,
  };
}
