/**
 * Trend Intelligence Engine (Phase 12.6)
 *
 * Computes deterministic quality, reliability, latency, and token trends across historical evaluation runs.
 * Supports run-over-run deltas, 3-run moving averages, and 7-run moving averages.
 *
 * Strict Invariant: Zero LLM judgment. Returns 'INSUFFICIENT_HISTORY' when sample size is insufficient.
 */

import { EvaluationCaseResultRecord, EvaluationRunRecord } from '../../../database/repositories/evaluation.repo';

export type TrendDirection = 'improving' | 'stable' | 'degrading' | 'insufficient_history';

export interface RunTrendSummary {
  runId: string;
  createdAt: string;
  datasetVersion: string;
  mode: string;
  overallScore: number;
  passRate: number;
  failureRate: number;
  regressionCount: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  durationMs: number;
  averageLatencyMs: number;
  averageTokens: number;
  totalTokens: number;
  failuresByDimension: Record<string, number>;
}

export interface MetricDelta {
  current: number;
  previous: number | 'INSUFFICIENT_HISTORY';
  delta: number | 'INSUFFICIENT_HISTORY';
  direction: TrendDirection;
}

export interface MovingAverageMetrics {
  score: number | 'INSUFFICIENT_HISTORY';
  passRate: number | 'INSUFFICIENT_HISTORY';
  regressions: number | 'INSUFFICIENT_HISTORY';
  latencyMs: number | 'INSUFFICIENT_HISTORY';
  tokens: number | 'INSUFFICIENT_HISTORY';
  sampleSize: number;
  status: 'available' | 'INSUFFICIENT_HISTORY';
}

export interface QualityTrendIntelligence {
  status: 'available' | 'INSUFFICIENT_HISTORY';
  historicalRunsCount: number;
  currentRun: RunTrendSummary | null;
  previousRun: RunTrendSummary | null;
  scoreTrend: MetricDelta;
  passRateTrend: MetricDelta;
  regressionTrend: MetricDelta;
  latencyTrend: MetricDelta;
  tokenTrend: MetricDelta;
  threeRunMovingAverage: MovingAverageMetrics;
  sevenRunMovingAverage: MovingAverageMetrics;
  runOverRunSeries: RunTrendSummary[];
}

/**
 * Builds a run trend summary from a run record and its associated case results.
 */
export function buildRunTrendSummary(
  run: EvaluationRunRecord,
  results: EvaluationCaseResultRecord[] = []
): RunTrendSummary {
  const total = run.totalCases > 0 ? run.totalCases : results.length;
  const passed = run.passedCases;
  const failed = run.failedCases;
  const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
  const failureRate = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;

  const totalDuration = results.reduce((sum, r) => sum + (r.durationMs || 0), 0);
  const averageLatencyMs = results.length > 0
    ? Math.round(totalDuration / results.length)
    : (run.totalCases > 0 ? Math.round((run.durationMs || 0) / run.totalCases) : 0);

  const totalTokens = results.reduce((sum, r) => sum + (r.tokens || 0), 0);
  const averageTokens = results.length > 0 ? Math.round(totalTokens / results.length) : 0;

  const failuresByDimension: Record<string, number> = {};
  for (const r of results) {
    if (r.status === 'failed' || r.status === 'error') {
      failuresByDimension[r.dimension] = (failuresByDimension[r.dimension] || 0) + 1;
    }
  }

  return {
    runId: run.id,
    createdAt: run.completedAt || run.createdAt,
    datasetVersion: run.datasetVersion,
    mode: run.mode,
    overallScore: run.overallScore ?? 0,
    passRate,
    failureRate,
    regressionCount: run.regressionCount ?? 0,
    totalCases: total,
    passedCases: passed,
    failedCases: failed,
    durationMs: run.durationMs ?? 0,
    averageLatencyMs,
    averageTokens,
    totalTokens,
    failuresByDimension,
  };
}

/**
 * Calculates deterministic metric delta between current and previous values.
 * Higher is better for score/passRate; lower is better for regressions/latency/tokens.
 */
export function calculateDelta(
  current: number,
  previous: number | null | undefined,
  metricType: 'score' | 'passRate' | 'regressions' | 'latency' | 'tokens',
  tolerance = 0.5
): MetricDelta {
  if (previous === null || previous === undefined || Number.isNaN(previous)) {
    return {
      current,
      previous: 'INSUFFICIENT_HISTORY',
      delta: 'INSUFFICIENT_HISTORY',
      direction: 'insufficient_history',
    };
  }

  const delta = Math.round((current - previous) * 10) / 10;
  let direction: TrendDirection = 'stable';

  if (metricType === 'score' || metricType === 'passRate') {
    if (delta > tolerance) direction = 'improving';
    else if (delta < -tolerance) direction = 'degrading';
    else direction = 'stable';
  } else {
    // For regressions, latency, tokens: decrease is improving, increase is degrading
    if (delta < -tolerance) direction = 'improving';
    else if (delta > tolerance) direction = 'degrading';
    else direction = 'stable';
  }

  return {
    current,
    previous,
    delta,
    direction,
  };
}

/**
 * Computes moving average across N recent runs.
 */
export function computeMovingAverage(
  summaries: RunTrendSummary[],
  windowSize: number
): MovingAverageMetrics {
  if (summaries.length < windowSize) {
    return {
      score: 'INSUFFICIENT_HISTORY',
      passRate: 'INSUFFICIENT_HISTORY',
      regressions: 'INSUFFICIENT_HISTORY',
      latencyMs: 'INSUFFICIENT_HISTORY',
      tokens: 'INSUFFICIENT_HISTORY',
      sampleSize: summaries.length,
      status: 'INSUFFICIENT_HISTORY',
    };
  }

  const slice = summaries.slice(0, windowSize);
  const sumScore = slice.reduce((sum, s) => sum + s.overallScore, 0);
  const sumPassRate = slice.reduce((sum, s) => sum + s.passRate, 0);
  const sumReg = slice.reduce((sum, s) => sum + s.regressionCount, 0);
  const sumLatency = slice.reduce((sum, s) => sum + s.averageLatencyMs, 0);
  const sumTokens = slice.reduce((sum, s) => sum + s.averageTokens, 0);

  return {
    score: Math.round((sumScore / windowSize) * 10) / 10,
    passRate: Math.round((sumPassRate / windowSize) * 10) / 10,
    regressions: Math.round((sumReg / windowSize) * 10) / 10,
    latencyMs: Math.round(sumLatency / windowSize),
    tokens: Math.round(sumTokens / windowSize),
    sampleSize: windowSize,
    status: 'available',
  };
}

/**
 * Computes comprehensive quality trend intelligence across historical runs.
 */
export function computeQualityTrends(
  summaries: RunTrendSummary[]
): QualityTrendIntelligence {
  if (summaries.length === 0) {
    return {
      status: 'INSUFFICIENT_HISTORY',
      historicalRunsCount: 0,
      currentRun: null,
      previousRun: null,
      scoreTrend: calculateDelta(0, null, 'score'),
      passRateTrend: calculateDelta(0, null, 'passRate'),
      regressionTrend: calculateDelta(0, null, 'regressions'),
      latencyTrend: calculateDelta(0, null, 'latency'),
      tokenTrend: calculateDelta(0, null, 'tokens'),
      threeRunMovingAverage: computeMovingAverage([], 3),
      sevenRunMovingAverage: computeMovingAverage([], 7),
      runOverRunSeries: [],
    };
  }

  // Sorted chronologically descending (newest first)
  const sorted = [...summaries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const current = sorted[0];
  const previous = sorted.length > 1 ? sorted[1] : null;

  return {
    status: sorted.length >= 2 ? 'available' : 'INSUFFICIENT_HISTORY',
    historicalRunsCount: sorted.length,
    currentRun: current,
    previousRun: previous,
    scoreTrend: calculateDelta(current.overallScore, previous ? previous.overallScore : null, 'score'),
    passRateTrend: calculateDelta(current.passRate, previous ? previous.passRate : null, 'passRate'),
    regressionTrend: calculateDelta(current.regressionCount, previous ? previous.regressionCount : null, 'regressions', 0),
    latencyTrend: calculateDelta(current.averageLatencyMs, previous ? previous.averageLatencyMs : null, 'latency', 10),
    tokenTrend: calculateDelta(current.averageTokens, previous ? previous.averageTokens : null, 'tokens', 10),
    threeRunMovingAverage: computeMovingAverage(sorted, 3),
    sevenRunMovingAverage: computeMovingAverage(sorted, 7),
    runOverRunSeries: sorted.slice(0, 20), // Bound series to 20 for UI efficiency
  };
}
