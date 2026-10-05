/**
 * Evaluation Quality Intelligence Engine (Phase 12.3)
 *
 * Implements deterministic failure taxonomy classification, assertion-level diagnostics,
 * failure fingerprinting & clustering, dimension health calculation, run comparisons,
 * and model/provider descriptive diagnostics.
 *
 * Strictly deterministic: Zero LLM judgment or hallucinated telemetry.
 */

import { GOLDEN_EVALUATION_DATASET } from './dataset';
import { EvaluationCategory, EvaluationCase } from './types';
import { EvaluationCaseResultRecord, EvaluationRunRecord } from '../../../database/repositories/evaluation.repo';
import { redactObject, redactSecrets } from '../redaction';
import { ReleaseMetadata, extractReleaseMetadata } from './release_quality';

// ============================================================================
// 1. FAILURE TAXONOMY
// ============================================================================

export type FailureCategory =
  | 'forbidden_tool_used'
  | 'required_tool_missing'
  | 'memory_mismatch'
  | 'conversation_mismatch'
  | 'personalization_mismatch'
  | 'adaptive_response_mismatch'
  | 'provider_error'
  | 'execution_error'
  | 'timeout'
  | 'budget_exceeded'
  | 'security_violation'
  | 'assertion_failure'
  | 'unknown';

export interface CaseFailureDiagnostic {
  category: FailureCategory;
  reason: string;
  caseId: string;
  dimension: string;
  runId: string;
  fingerprint: string;
}

export function classifyFailure(
  dimension: string,
  expected: Record<string, any>,
  actual: Record<string, any>,
  failureReason?: string | null
): { category: FailureCategory; reason: string } {
  const reason = failureReason ? failureReason.trim() : (actual?.error as string) || 'Assertion failed';
  const reasonLower = reason.toLowerCase();
  const actualStatus = String(actual?.status || '').toLowerCase();
  const blockedReason = String(actual?.blockedReason || '').toLowerCase();

  // 1. Security violation
  if (
    blockedReason === 'side_effect_tool_blocked' ||
    blockedReason === 'ssrf_blocked' ||
    reasonLower.includes('side_effect_tool_blocked') ||
    reasonLower.includes('security violation') ||
    reasonLower.includes('ssrf')
  ) {
    return { category: 'security_violation', reason };
  }

  // 2. Timeout
  if (
    blockedReason === 'timeout' ||
    actualStatus === 'timeout' ||
    reasonLower.includes('timeout') ||
    reasonLower.includes('timed out')
  ) {
    return { category: 'timeout', reason };
  }

  // 3. Budget exceeded
  if (
    blockedReason === 'context_overflow' ||
    reasonLower.includes('budget') ||
    reasonLower.includes('context_overflow') ||
    reasonLower.includes('token limit')
  ) {
    return { category: 'budget_exceeded', reason };
  }

  // 4. Provider error
  if (
    dimension === 'provider' &&
    (actualStatus === 'error' || reasonLower.includes('provider') || reasonLower.includes('fallback'))
  ) {
    return { category: 'provider_error', reason };
  }

  // 5. Tool violations
  if (reasonLower.includes('not to be used') || reasonLower.includes('forbidden tool')) {
    return { category: 'forbidden_tool_used', reason };
  }
  if (
    (reasonLower.includes('expected tool') || reasonLower.includes('required tool')) &&
    (reasonLower.includes('to be used') || reasonLower.includes('missing') || reasonLower.includes('not invoked'))
  ) {
    return { category: 'required_tool_missing', reason };
  }

  // 6. Subsystem specific mismatches
  if (dimension === 'memory' && (reasonLower.includes('memory') || reasonLower.includes('memories'))) {
    return { category: 'memory_mismatch', reason };
  }
  if (dimension === 'conversation' && (reasonLower.includes('strategy') || reasonLower.includes('topic'))) {
    return { category: 'conversation_mismatch', reason };
  }
  if (dimension === 'personalization' && (reasonLower.includes('dialect') || reasonLower.includes('language') || reasonLower.includes('depth'))) {
    return { category: 'personalization_mismatch', reason };
  }
  if (dimension === 'adaptive_response' && (reasonLower.includes('clarification') || reasonLower.includes('troubleshooting'))) {
    return { category: 'adaptive_response_mismatch', reason };
  }

  // 7. General execution error
  if (actualStatus === 'error' || reasonLower.includes('unhandled execution error') || reasonLower.includes('threw unexpected error')) {
    return { category: 'execution_error', reason };
  }

  // 8. General assertion failure
  if (reasonLower.includes('expected')) {
    return { category: 'assertion_failure', reason };
  }

  // 9. Unknown fallback
  return { category: 'unknown', reason };
}

// ============================================================================
// 2. ASSERTION-LEVEL DIAGNOSTICS
// ============================================================================

export interface AssertionDiagnostic {
  type: string;
  expected: string;
  observed: string;
  status: 'passed' | 'failed';
  failureReason?: string;
}

export interface CaseAssertionReport {
  caseId: string;
  dimension: string;
  passedCount: number;
  totalCount: number;
  assertions: AssertionDiagnostic[];
}

export function generateAssertionDiagnostics(
  evalCase: EvaluationCase,
  actual: Record<string, any>
): CaseAssertionReport {
  const assertions: AssertionDiagnostic[] = [];
  const expected = evalCase.expected || {};
  const sanitizedActual = redactObject(actual || {}) as Record<string, any>;

  // 1. Required Tools
  if (expected.toolCalls && expected.toolCalls.length > 0) {
    const executedTools: string[] = (sanitizedActual.toolCalls as string[]) || [];
    for (const tool of expected.toolCalls) {
      const ok = executedTools.includes(tool);
      assertions.push({
        type: 'required_tool',
        expected: tool,
        observed: executedTools.length > 0 ? executedTools.join(', ') : 'none',
        status: ok ? 'passed' : 'failed',
        failureReason: ok ? undefined : `Required tool '${tool}' was not invoked`,
      });
    }
  }

  // 2. Forbidden Tools
  if (expected.forbiddenTools && expected.forbiddenTools.length > 0) {
    const executedTools: string[] = (sanitizedActual.toolCalls as string[]) || [];
    for (const tool of expected.forbiddenTools) {
      const used = executedTools.includes(tool);
      assertions.push({
        type: 'forbidden_tool',
        expected: `NOT ${tool}`,
        observed: used ? tool : 'none',
        status: !used ? 'passed' : 'failed',
        failureReason: !used ? undefined : `Forbidden tool '${tool}' was unexpectedly executed`,
      });
    }
  }

  // 3. Strategy
  if (expected.strategy) {
    const observedStrategy = (sanitizedActual.strategy || sanitizedActual.responseStrategy || 'none') as string;
    const ok = observedStrategy === expected.strategy;
    assertions.push({
      type: 'strategy',
      expected: expected.strategy,
      observed: observedStrategy,
      status: ok ? 'passed' : 'failed',
      failureReason: ok ? undefined : `Expected strategy '${expected.strategy}', but got '${observedStrategy}'`,
    });
  }

  // 4. Memory Usage
  if (expected.memoryUsage) {
    const count = Number(
      sanitizedActual.memorySelectedCount ?? (sanitizedActual.memories ? (sanitizedActual.memories as any[]).length : 0)
    );
    const ok = expected.memoryUsage === 'required' ? count >= 1 : count === 0;
    assertions.push({
      type: 'memory_usage',
      expected: expected.memoryUsage,
      observed: `${count} memories selected`,
      status: ok ? 'passed' : 'failed',
      failureReason: ok ? undefined : `Memory usage requirement '${expected.memoryUsage}' not met (got ${count})`,
    });
  }

  // 5. Clarification
  if (expected.clarification !== undefined) {
    const observedClarification = Boolean(
      sanitizedActual.clarificationNeeded || sanitizedActual.clarification || sanitizedActual.strategy === 'clarification_prompt'
    );
    const ok = observedClarification === expected.clarification;
    assertions.push({
      type: 'clarification',
      expected: String(expected.clarification),
      observed: String(observedClarification),
      status: ok ? 'passed' : 'failed',
      failureReason: ok ? undefined : `Expected clarification=${expected.clarification}, but got ${observedClarification}`,
    });
  }

  // 6. Max Steps
  if (expected.maxSteps !== undefined) {
    const steps = Number(
      sanitizedActual.stepsCount ?? (sanitizedActual.steps ? (sanitizedActual.steps as any[]).length : 1)
    );
    const ok = steps <= expected.maxSteps;
    assertions.push({
      type: 'max_steps',
      expected: `<=${expected.maxSteps}`,
      observed: `${steps} steps`,
      status: ok ? 'passed' : 'failed',
      failureReason: ok ? undefined : `Execution exceeded max steps: took ${steps} (limit: ${expected.maxSteps})`,
    });
  }

  // 7. Final State / Status
  if (expected.status) {
    const observedStatus = String(sanitizedActual.status || 'unknown');
    const ok = observedStatus === expected.status;
    assertions.push({
      type: 'final_status',
      expected: expected.status,
      observed: observedStatus,
      status: ok ? 'passed' : 'failed',
      failureReason: ok ? undefined : `Expected final status '${expected.status}', but got '${observedStatus}'`,
    });
  }

  // 8. Fallback Used
  if (expected.fallbackUsed !== undefined) {
    const observedFallback = Boolean(sanitizedActual.fallbackUsed || sanitizedActual.isFallback);
    const ok = observedFallback === expected.fallbackUsed;
    assertions.push({
      type: 'fallback_used',
      expected: String(expected.fallbackUsed),
      observed: String(observedFallback),
      status: ok ? 'passed' : 'failed',
      failureReason: ok ? undefined : `Expected fallback=${expected.fallbackUsed}, but got ${observedFallback}`,
    });
  }

  // 9. Safety Boundary / Blocked Reason
  if (expected.blockedReason) {
    const observedBlocked = String(
      sanitizedActual.blockedReason || sanitizedActual.suppressionReason || sanitizedActual.status || 'none'
    );
    const ok = observedBlocked.toLowerCase().includes(expected.blockedReason.toLowerCase());
    assertions.push({
      type: 'safety_boundary',
      expected: expected.blockedReason,
      observed: observedBlocked,
      status: ok ? 'passed' : 'failed',
      failureReason: ok ? undefined : `Expected safety boundary '${expected.blockedReason}', but observed '${observedBlocked}'`,
    });
  }

  // If no assertions were specified in expected (edge case), default to single overall assertion
  if (assertions.length === 0) {
    const ok = sanitizedActual.status !== 'error';
    assertions.push({
      type: 'execution_success',
      expected: 'status != error',
      observed: String(sanitizedActual.status || 'ok'),
      status: ok ? 'passed' : 'failed',
    });
  }

  const passedCount = assertions.filter((a) => a.status === 'passed').length;

  return {
    caseId: evalCase.id,
    dimension: evalCase.category,
    passedCount,
    totalCount: assertions.length,
    assertions,
  };
}

// ============================================================================
// 3. FAILURE FINGERPRINTING & CLUSTERING
// ============================================================================

export interface FailureCluster {
  pattern: string;
  category: FailureCategory;
  dimension: string;
  affectedCases: string[];
  affectedRuns: string[];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  sampleReason: string;
}

export function buildFailureFingerprint(
  dimension: string,
  category: FailureCategory,
  failureReason?: string | null
): string {
  const cleanReason = (failureReason || '').toLowerCase();

  let detail = 'general';
  if (cleanReason.includes('tool [')) {
    const match = cleanReason.match(/tool \[([a-zA-Z0-9_\-]+)\]/);
    if (match) detail = match[1];
  } else if (cleanReason.includes('strategy [')) {
    const match = cleanReason.match(/strategy \[([a-zA-Z0-9_\-]+)\]/);
    if (match) detail = match[1];
  } else if (cleanReason.includes('quiet_hours')) {
    detail = 'quiet_hours';
  } else if (cleanReason.includes('cooldown')) {
    detail = 'cooldown';
  } else if (cleanReason.includes('ssrf')) {
    detail = 'ssrf';
  } else if (cleanReason.includes('side_effect')) {
    detail = 'side_effect_tool_blocked';
  }

  return `${dimension}:${category}:${detail}`;
}

export function clusterFailures(results: EvaluationCaseResultRecord[]): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();

  for (const r of results) {
    if (r.status !== 'failed' && r.status !== 'error') continue;

    const { category, reason } = classifyFailure(r.dimension, r.expected, r.actual, r.failureReason);
    const pattern = buildFailureFingerprint(r.dimension, category, reason);

    const existing = clusters.get(pattern);
    const createdAt = r.createdAt || new Date().toISOString();

    if (!existing) {
      clusters.set(pattern, {
        pattern,
        category,
        dimension: r.dimension,
        affectedCases: [r.caseId],
        affectedRuns: [r.runId],
        occurrences: 1,
        firstSeen: createdAt,
        lastSeen: createdAt,
        sampleReason: redactSecrets(reason),
      });
    } else {
      if (!existing.affectedCases.includes(r.caseId)) {
        existing.affectedCases.push(r.caseId);
      }
      if (!existing.affectedRuns.includes(r.runId)) {
        existing.affectedRuns.push(r.runId);
      }
      existing.occurrences++;
      if (new Date(createdAt) < new Date(existing.firstSeen)) {
        existing.firstSeen = createdAt;
      }
      if (new Date(createdAt) > new Date(existing.lastSeen)) {
        existing.lastSeen = createdAt;
      }
    }
  }

  return Array.from(clusters.values()).sort((a, b) => b.occurrences - a.occurrences);
}

// ============================================================================
// 4. DIMENSION HEALTH
// ============================================================================

export interface DimensionHealth {
  dimension: EvaluationCategory;
  totalCases: number;
  evaluatedCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageScore: number;
  regressionsCount: number;
  topFailurePattern: string | null;
}

export function computeDimensionHealth(
  results: EvaluationCaseResultRecord[]
): Record<EvaluationCategory, DimensionHealth> {
  const dimensions: EvaluationCategory[] = [
    'memory',
    'conversation',
    'personalization',
    'adaptive_response',
    'agent',
    'provider',
    'proactive',
  ];

  const healthMap = {} as Record<EvaluationCategory, DimensionHealth>;

  for (const dim of dimensions) {
    const dimCases = GOLDEN_EVALUATION_DATASET.filter((c) => c.category === dim);
    const dimResults = results.filter((r) => r.dimension === dim);

    const evaluatedCases = dimResults.length;
    const passedCases = dimResults.filter((r) => r.status === 'passed').length;
    const failedCases = dimResults.filter((r) => r.status === 'failed' || r.status === 'error').length;
    const regressionsCount = dimResults.filter((r) => r.regression).length;

    const passRate = evaluatedCases > 0 ? Math.round((passedCases / evaluatedCases) * 1000) / 10 : 100;
    const totalScore = dimResults.reduce((acc, r) => acc + (r.score || 0), 0);
    const averageScore = evaluatedCases > 0 ? Math.round((totalScore / evaluatedCases) * 10) / 10 : 100;

    const clusters = clusterFailures(dimResults);
    const topFailurePattern = clusters.length > 0 ? clusters[0].pattern : null;

    healthMap[dim] = {
      dimension: dim,
      totalCases: dimCases.length,
      evaluatedCases,
      passedCases,
      failedCases,
      passRate,
      averageScore,
      regressionsCount,
      topFailurePattern,
    };
  }

  return healthMap;
}

// ============================================================================
// 5. RUN COMPARISON
// ============================================================================

export interface CaseComparisonDiff {
  caseId: string;
  dimension: string;
  changeType: 'regression' | 'recovered' | 'score_changed' | 'new_failure' | 'resolved_failure';
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
}

export interface RunComparisonResult {
  runA: EvaluationRunRecord;
  runB: EvaluationRunRecord;
  releaseA?: ReleaseMetadata;
  releaseB?: ReleaseMetadata;
  comparisonType: 'regression' | 'informational';
  warning?: string | null;
  metrics: {
    passRateDeltaPp: number; // e.g. +5.2 pp
    averageScoreDelta: number;
    failuresDelta: number;
    regressionsDelta: number;
    durationDeltaMs: number;
    tokensDelta: number;
  };
  dimensionComparison: {
    dimension: string;
    runAPassRate: number;
    runBPassRate: number;
    deltaPp: number;
  }[];
  changedCases: CaseComparisonDiff[];
}

export function compareRuns(
  runA: EvaluationRunRecord,
  resultsA: EvaluationCaseResultRecord[],
  runB: EvaluationRunRecord,
  resultsB: EvaluationCaseResultRecord[]
): RunComparisonResult {
  const isSameDataset = runA.datasetVersion === runB.datasetVersion;
  const comparisonType: 'regression' | 'informational' = isSameDataset ? 'regression' : 'informational';
  const warning = isSameDataset ? null : 'Dataset versions differ; regression semantics are disabled.';
  const releaseA = extractReleaseMetadata(runA.metadata?.release || runA.metadata);
  const releaseB = extractReleaseMetadata(runB.metadata?.release || runB.metadata);

  const mapA = new Map<string, EvaluationCaseResultRecord>();
  const mapB = new Map<string, EvaluationCaseResultRecord>();

  for (const r of resultsA) mapA.set(r.caseId, r);
  for (const r of resultsB) mapB.set(r.caseId, r);

  const passRateA = runA.totalCases > 0 ? (runA.passedCases / runA.totalCases) * 100 : 0;
  const passRateB = runB.totalCases > 0 ? (runB.passedCases / runB.totalCases) * 100 : 0;

  const passRateDeltaPp = Math.round((passRateB - passRateA) * 10) / 10;
  const averageScoreDelta = Math.round(((runB.overallScore || 0) - (runA.overallScore || 0)) * 10) / 10;
  const failuresDelta = (runB.failedCases || 0) - (runA.failedCases || 0);
  const regressionsDelta = (runB.regressionCount || 0) - (runA.regressionCount || 0);
  const durationDeltaMs = (runB.durationMs || 0) - (runA.durationMs || 0);

  const tokensA = resultsA.reduce((sum, r) => sum + (r.tokens || 0), 0);
  const tokensB = resultsB.reduce((sum, r) => sum + (r.tokens || 0), 0);
  const tokensDelta = tokensB - tokensA;

  // Dimension Comparison
  const dimensions: EvaluationCategory[] = [
    'memory',
    'conversation',
    'personalization',
    'adaptive_response',
    'agent',
    'provider',
    'proactive',
  ];

  const dimensionComparison = dimensions.map((dim) => {
    const dimResA = resultsA.filter((r) => r.dimension === dim);
    const dimResB = resultsB.filter((r) => r.dimension === dim);

    const prA = dimResA.length > 0 ? (dimResA.filter((r) => r.status === 'passed').length / dimResA.length) * 100 : 100;
    const prB = dimResB.length > 0 ? (dimResB.filter((r) => r.status === 'passed').length / dimResB.length) * 100 : 100;

    return {
      dimension: dim,
      runAPassRate: Math.round(prA * 10) / 10,
      runBPassRate: Math.round(prB * 10) / 10,
      deltaPp: Math.round((prB - prA) * 10) / 10,
    };
  });

  // Changed Cases
  const changedCases: CaseComparisonDiff[] = [];
  const allCaseIds = new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]);

  for (const caseId of allCaseIds) {
    const caseA = mapA.get(caseId);
    const caseB = mapB.get(caseId);

    if (!caseA || !caseB) continue;

    const statusA = caseA.status;
    const statusB = caseB.status;
    const scoreA = caseA.score ?? 0;
    const scoreB = caseB.score ?? 0;

    if (statusA === statusB && scoreA === scoreB) {
      continue; // Unchanged case: omit from delta list
    }

    let changeType: CaseComparisonDiff['changeType'] = 'score_changed';
    if (statusA === 'passed' && (statusB === 'failed' || statusB === 'error')) {
      changeType = isSameDataset ? 'regression' : 'new_failure';
    } else if ((statusA === 'failed' || statusA === 'error') && statusB === 'passed') {
      changeType = isSameDataset ? 'recovered' : 'resolved_failure';
    } else if (statusA === 'passed' && statusB !== 'passed') {
      changeType = 'new_failure';
    } else if (statusA !== 'passed' && statusB === 'passed') {
      changeType = 'resolved_failure';
    }

    changedCases.push({
      caseId,
      dimension: caseB.dimension || caseA.dimension,
      changeType,
      runA: {
        status: statusA,
        score: scoreA,
        durationMs: caseA.durationMs,
        failureReason: caseA.failureReason ? redactSecrets(caseA.failureReason) : null,
      },
      runB: {
        status: statusB,
        score: scoreB,
        durationMs: caseB.durationMs,
        failureReason: caseB.failureReason ? redactSecrets(caseB.failureReason) : null,
      },
      scoreDelta: scoreB - scoreA,
    });
  }

  return {
    runA,
    runB,
    releaseA,
    releaseB,
    comparisonType,
    warning,
    metrics: {
      passRateDeltaPp,
      averageScoreDelta,
      failuresDelta,
      regressionsDelta,
      durationDeltaMs,
      tokensDelta,
    },
    dimensionComparison,
    changedCases,
  };
}

// ============================================================================
// 6. MODEL / PROVIDER DESCRIPTIVE DIAGNOSTICS
// ============================================================================

export interface ProviderDiagnosticItem {
  provider: string;
  model: string;
  evaluatedCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageScore: number;
  averageDurationMs: number;
  totalTokens: number;
}

export function computeProviderDiagnostics(results: EvaluationCaseResultRecord[]): ProviderDiagnosticItem[] {
  const groups = new Map<string, EvaluationCaseResultRecord[]>();

  for (const r of results) {
    const key = `${r.provider || 'Not Tracked'}:${r.model || 'Not Tracked'}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  const diagnostics: ProviderDiagnosticItem[] = [];

  for (const [key, list] of groups.entries()) {
    const [provider, model] = key.split(':');
    const total = list.length;
    const passed = list.filter((r) => r.status === 'passed').length;
    const failed = list.filter((r) => r.status === 'failed' || r.status === 'error').length;
    const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 100;
    const totalScore = list.reduce((sum, r) => sum + (r.score || 0), 0);
    const averageScore = total > 0 ? Math.round((totalScore / total) * 10) / 10 : 100;
    const totalDuration = list.reduce((sum, r) => sum + (r.durationMs || 0), 0);
    const averageDurationMs = total > 0 ? Math.round(totalDuration / total) : 0;
    const totalTokens = list.reduce((sum, r) => sum + (r.tokens || 0), 0);

    diagnostics.push({
      provider,
      model,
      evaluatedCases: total,
      passedCases: passed,
      failedCases: failed,
      passRate,
      averageScore,
      averageDurationMs,
      totalTokens,
    });
  }

  return diagnostics.sort((a, b) => b.evaluatedCases - a.evaluatedCases);
}
