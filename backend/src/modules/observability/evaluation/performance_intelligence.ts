/**
 * Performance Intelligence Engine (Phase 12.6)
 *
 * Implements deterministic latency distribution calculation (p50, p90, p95, p99)
 * and token consumption analytics across evaluation cases and runs.
 *
 * Strict Invariants:
 * - Zero LLM judgment.
 * - Sample size safeguards: Returns 'INSUFFICIENT_DATA' when sample sizes are inadequate.
 * - No hallucinated cost calculation without verified pricing tables.
 */

import { EvaluationCaseResultRecord } from '../../../database/repositories/evaluation.repo';
import { GOLDEN_EVALUATION_DATASET } from './dataset';

export interface PercentileResult {
  p50: number | 'INSUFFICIENT_DATA';
  p90: number | 'INSUFFICIENT_DATA';
  p95: number | 'INSUFFICIENT_DATA';
  p99: number | 'INSUFFICIENT_DATA';
  average: number;
  min: number;
  max: number;
  sampleSize: number;
}

export interface DimensionPerformanceItem {
  dimension: string;
  sampleSize: number;
  averageLatencyMs: number;
  p90LatencyMs: number | 'INSUFFICIENT_DATA';
  totalTokens: number;
  averageTokens: number;
}

export interface CasePerformanceItem {
  caseId: string;
  dimension: string;
  title: string;
  durationMs: number;
  tokens: number;
  status: string;
}

export interface PerformanceIntelligenceResult {
  status: 'available' | 'INSUFFICIENT_DATA';
  sampleSize: number;
  latency: {
    averageMs: number;
    p50Ms: number | 'INSUFFICIENT_DATA';
    p90Ms: number | 'INSUFFICIENT_DATA';
    p95Ms: number | 'INSUFFICIENT_DATA';
    p99Ms: number | 'INSUFFICIENT_DATA';
    minMs: number;
    maxMs: number;
  };
  tokens: {
    totalTokens: number;
    averageTokensPerCase: number;
    minTokens: number;
    maxTokens: number;
  };
  byDimension: DimensionPerformanceItem[];
  slowestCases: CasePerformanceItem[];
  topTokenCases: CasePerformanceItem[];
}

/**
 * Calculates deterministic percentile value using standard nearest-rank / interpolation method.
 */
export function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sortedValues[lower];
  }
  return Math.round(sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight);
}

/**
 * Computes performance intelligence across a set of evaluation case results.
 */
export function computePerformanceIntelligence(
  results: EvaluationCaseResultRecord[]
): PerformanceIntelligenceResult {
  const sampleSize = results.length;

  if (sampleSize === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      sampleSize: 0,
      latency: {
        averageMs: 0,
        p50Ms: 'INSUFFICIENT_DATA',
        p90Ms: 'INSUFFICIENT_DATA',
        p95Ms: 'INSUFFICIENT_DATA',
        p99Ms: 'INSUFFICIENT_DATA',
        minMs: 0,
        maxMs: 0,
      },
      tokens: {
        totalTokens: 0,
        averageTokensPerCase: 0,
        minTokens: 0,
        maxTokens: 0,
      },
      byDimension: [],
      slowestCases: [],
      topTokenCases: [],
    };
  }

  const sortedLatencies = results.map((r) => r.durationMs ?? 0).sort((a, b) => a - b);
  const sortedTokens = results.map((r) => r.tokens ?? 0).sort((a, b) => a - b);

  const totalDuration = sortedLatencies.reduce((sum, v) => sum + v, 0);
  const totalTokens = sortedTokens.reduce((sum, v) => sum + v, 0);

  const averageMs = Math.round(totalDuration / sampleSize);
  const averageTokensPerCase = Math.round(totalTokens / sampleSize);

  // Percentile safeguards:
  // p50/p90/p95 require at least 5 data points
  // p99 requires at least 100 data points to be mathematically valid
  const p50Ms = sampleSize >= 5 ? calculatePercentile(sortedLatencies, 50) : 'INSUFFICIENT_DATA';
  const p90Ms = sampleSize >= 5 ? calculatePercentile(sortedLatencies, 90) : 'INSUFFICIENT_DATA';
  const p95Ms = sampleSize >= 5 ? calculatePercentile(sortedLatencies, 95) : 'INSUFFICIENT_DATA';
  const p99Ms = sampleSize >= 100 ? calculatePercentile(sortedLatencies, 99) : 'INSUFFICIENT_DATA';

  // Dimension breakdown
  const byDimMap = new Map<string, EvaluationCaseResultRecord[]>();
  for (const r of results) {
    const list = byDimMap.get(r.dimension) || [];
    list.push(r);
    byDimMap.set(r.dimension, list);
  }

  const byDimension: DimensionPerformanceItem[] = [];
  for (const [dim, dimResults] of byDimMap.entries()) {
    const dimLatencies = dimResults.map((r) => r.durationMs ?? 0).sort((a, b) => a - b);
    const dimTokens = dimResults.reduce((sum, r) => sum + (r.tokens ?? 0), 0);
    const dimTotalDuration = dimLatencies.reduce((sum, v) => sum + v, 0);

    const dimAvgLat = Math.round(dimTotalDuration / dimResults.length);
    const dimP90 = dimResults.length >= 5 ? calculatePercentile(dimLatencies, 90) : 'INSUFFICIENT_DATA';

    byDimension.push({
      dimension: dim,
      sampleSize: dimResults.length,
      averageLatencyMs: dimAvgLat,
      p90LatencyMs: dimP90,
      totalTokens: dimTokens,
      averageTokens: Math.round(dimTokens / dimResults.length),
    });
  }

  // Case mappings
  const casePerformanceList: CasePerformanceItem[] = results.map((r) => {
    const meta = GOLDEN_EVALUATION_DATASET.find((c) => c.id === r.caseId);
    return {
      caseId: r.caseId,
      dimension: r.dimension,
      title: meta?.name || r.caseId,
      durationMs: r.durationMs ?? 0,
      tokens: r.tokens ?? 0,
      status: r.status,
    };
  });

  const slowestCases = [...casePerformanceList]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);

  const topTokenCases = [...casePerformanceList]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  return {
    status: 'available',
    sampleSize,
    latency: {
      averageMs,
      p50Ms,
      p90Ms,
      p95Ms,
      p99Ms,
      minMs: sortedLatencies[0],
      maxMs: sortedLatencies[sortedLatencies.length - 1],
    },
    tokens: {
      totalTokens,
      averageTokensPerCase,
      minTokens: sortedTokens[0],
      maxTokens: sortedTokens[sortedTokens.length - 1],
    },
    byDimension: byDimension.sort((a, b) => b.averageLatencyMs - a.averageLatencyMs),
    slowestCases,
    topTokenCases,
  };
}
