/**
 * Case Intelligence Engine (Phase 12.6)
 *
 * Implements deterministic ranking for Best Cases, Worst Cases, and Flaky Evaluation Case Detection.
 *
 * Strict Invariant: Zero LLM judgment. Minimum 3 historical observations required for flakiness classification.
 */

import { GOLDEN_EVALUATION_DATASET } from './dataset';
import { EvaluationCaseResultRecord } from '../../../database/repositories/evaluation.repo';
import { classifyFailure, buildFailureFingerprint } from './quality_intelligence';

export interface RankedCaseItem {
  caseId: string;
  dimension: string;
  title: string;
  description: string;
  score: number;
  status: string;
  regression: boolean;
  failureCategory?: string;
  failureReason?: string | null;
  fingerprint?: string;
  durationMs: number;
  tokens: number;
  provider?: string | null;
  model?: string | null;
}

export interface FlakyCaseItem {
  caseId: string;
  dimension: string;
  title: string;
  isFlaky: boolean;
  flipCount: number;
  totalObservations: number;
  passCount: number;
  failCount: number;
  flakinessRatePct: number;
  lastStatus: string;
  failureFingerprints: string[];
  history: {
    runId: string;
    status: string;
    score: number;
    createdAt: string;
  }[];
}

export interface CaseIntelligenceResult {
  bestCases: RankedCaseItem[];
  worstCases: RankedCaseItem[];
  flakyCases: FlakyCaseItem[];
  totalCasesEvaluated: number;
}

/**
 * Enriches a case result with dataset metadata (title, description).
 */
function enrichCase(r: EvaluationCaseResultRecord): RankedCaseItem {
  const meta = GOLDEN_EVALUATION_DATASET.find((c) => c.id === r.caseId);
  const failureInfo =
    r.status === 'failed' || r.status === 'error'
      ? classifyFailure(r.dimension, r.expected, r.actual, r.failureReason)
      : null;

  return {
    caseId: r.caseId,
    dimension: r.dimension,
    title: meta?.name || r.caseId,
    description: meta?.input || '',
    score: r.score,
    status: r.status,
    regression: r.regression,
    failureCategory: failureInfo?.category,
    failureReason: r.failureReason,
    fingerprint: failureInfo
      ? buildFailureFingerprint(r.dimension, failureInfo.category, failureInfo.reason)
      : undefined,
    durationMs: r.durationMs,
    tokens: r.tokens,
    provider: r.provider,
    model: r.model,
  };
}

/**
 * Ranks best cases deterministically:
 * Passed status first, highest score, zero regressions, lowest duration, lowest tokens.
 */
export function rankBestCases(results: EvaluationCaseResultRecord[], limit = 10): RankedCaseItem[] {
  const enriched = results.map(enrichCase);

  return enriched
    .filter((c) => c.status === 'passed')
    .sort((a, b) => {
      // 1. Regressions (0 regressions first)
      if (a.regression !== b.regression) return a.regression ? 1 : -1;
      // 2. Score (higher first)
      if (b.score !== a.score) return b.score - a.score;
      // 3. Duration (lower first)
      if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs;
      // 4. Tokens (lower first)
      return a.tokens - b.tokens;
    })
    .slice(0, limit);
}

/**
 * Ranks worst cases deterministically:
 * Failed/error first, active regressions next, lowest score, highest duration.
 */
export function rankWorstCases(results: EvaluationCaseResultRecord[], limit = 10): RankedCaseItem[] {
  const enriched = results.map(enrichCase);

  return enriched
    .sort((a, b) => {
      // 1. Failed status before passed
      const aFailed = a.status === 'failed' || a.status === 'error';
      const bFailed = b.status === 'failed' || b.status === 'error';
      if (aFailed !== bFailed) return aFailed ? -1 : 1;

      // 2. Regressions first
      if (a.regression !== b.regression) return a.regression ? -1 : 1;

      // 3. Lowest score first
      if (a.score !== b.score) return a.score - b.score;

      // 4. Highest duration first
      return b.durationMs - a.durationMs;
    })
    .slice(0, limit);
}

/**
 * Detects flaky evaluation cases across historical runs.
 * A case is considered FLAKY when:
 * 1. Evaluated in at least 3 historical runs (totalObservations >= 3).
 * 2. Has at least 2 status flips (PASS -> FAIL or FAIL -> PASS).
 */
export function detectFlakyCases(
  historicalResults: EvaluationCaseResultRecord[],
  minObservations = 3
): FlakyCaseItem[] {
  // Group results by caseId
  const byCase = new Map<string, EvaluationCaseResultRecord[]>();

  for (const r of historicalResults) {
    const list = byCase.get(r.caseId) || [];
    list.push(r);
    byCase.set(r.caseId, list);
  }

  const flakyList: FlakyCaseItem[] = [];

  for (const [caseId, records] of byCase.entries()) {
    // Sort chronologically ascending (oldest to newest) to trace state transitions
    const sorted = [...records].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    if (sorted.length < minObservations) {
      continue; // Insufficient observations for flakiness classification
    }

    let flips = 0;
    let passCount = 0;
    let failCount = 0;
    const fingerprints = new Set<string>();

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const isPass = current.status === 'passed';
      if (isPass) passCount++;
      else failCount++;

      if (current.status === 'failed' || current.status === 'error') {
        const failInfo = classifyFailure(current.dimension, current.expected, current.actual, current.failureReason);
        fingerprints.add(buildFailureFingerprint(current.dimension, failInfo.category, failInfo.reason));
      }

      if (i > 0) {
        const prev = sorted[i - 1];
        const prevPass = prev.status === 'passed';
        if (isPass !== prevPass) {
          flips++;
        }
      }
    }

    const totalObs = sorted.length;
    const flakinessRatePct = totalObs > 1 ? Math.round((flips / (totalObs - 1)) * 100) : 0;
    const isFlaky = flips >= 2;

    const meta = GOLDEN_EVALUATION_DATASET.find((c) => c.id === caseId);

    flakyList.push({
      caseId,
      dimension: sorted[sorted.length - 1].dimension,
      title: meta?.name || caseId,
      isFlaky,
      flipCount: flips,
      totalObservations: totalObs,
      passCount,
      failCount,
      flakinessRatePct,
      lastStatus: sorted[sorted.length - 1].status,
      failureFingerprints: Array.from(fingerprints),
      history: sorted.map((s) => ({
        runId: s.runId,
        status: s.status,
        score: s.score,
        createdAt: s.createdAt,
      })),
    });
  }

  // Return only flaky cases or cases with status flips, sorted by flakiness and flipCount descending
  return flakyList
    .filter((c) => c.isFlaky || c.flipCount > 0)
    .sort((a, b) => {
      if (a.isFlaky !== b.isFlaky) return a.isFlaky ? -1 : 1;
      return b.flipCount - a.flipCount;
    });
}
