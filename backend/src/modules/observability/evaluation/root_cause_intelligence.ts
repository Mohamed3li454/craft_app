/**
 * Root Cause Intelligence Engine (Phase 12.6)
 *
 * Implements deterministic failure correlation hints across provider, model,
 * tool invocation, dimension clustering, and latency anomalies.
 *
 * Strict Invariants:
 * - Zero LLM judgment.
 * - Always labeled "Possible contributing factor" unless deterministic causal link is verified.
 * - Returns 'ROOT_CAUSE_DATA_UNAVAILABLE' when no statistical or telemetry correlation can be established.
 */

import { EvaluationCaseResultRecord } from '../../../database/repositories/evaluation.repo';
import { classifyFailure, FailureCategory } from './quality_intelligence';

export type RootCauseConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface ContributingFactor {
  id: string;
  factorType: 'provider_model' | 'tool_failure' | 'dimension_cluster' | 'latency_spike' | 'timeout_pattern';
  label: string;
  provider?: string;
  model?: string;
  tool?: string;
  dimension?: string;
  observed: string;
  correlationExplanation: string;
  affectedCasesCount: number;
  affectedCaseIds: string[];
  confidence: RootCauseConfidence;
}

export interface RootCauseAnalysisResult {
  status: 'available' | 'ROOT_CAUSE_DATA_UNAVAILABLE';
  analyzedFailuresCount: number;
  factors: ContributingFactor[];
  summary: string;
}

/**
 * Deterministically correlates failures against telemetry and execution attributes.
 */
export function analyzeRootCauses(
  results: EvaluationCaseResultRecord[]
): RootCauseAnalysisResult {
  const failedCases = results.filter((r) => r.status === 'failed' || r.status === 'error');

  if (failedCases.length === 0) {
    return {
      status: 'ROOT_CAUSE_DATA_UNAVAILABLE',
      analyzedFailuresCount: 0,
      factors: [],
      summary: 'No failures observed in dataset; no contributing factors identified.',
    };
  }

  const factors: ContributingFactor[] = [];
  const passingCases = results.filter((r) => r.status === 'passed');

  // 1. Dimension Concentration Correlation
  // If >= 50% of all failures belong to a single dimension, flag dimension clustering
  const dimCount = new Map<string, string[]>();
  for (const f of failedCases) {
    const list = dimCount.get(f.dimension) || [];
    list.push(f.caseId);
    dimCount.set(f.dimension, list);
  }

  for (const [dim, cases] of dimCount.entries()) {
    const ratio = cases.length / failedCases.length;
    if (ratio >= 0.4 && cases.length >= 2) {
      factors.push({
        id: `rc-dim-${dim}`,
        factorType: 'dimension_cluster',
        label: `Failures concentrated in ${dim} subsystem`,
        dimension: dim,
        observed: `${Math.round(ratio * 100)}% of all failures (${cases.length}/${failedCases.length}) concentrated in dimension '${dim}'`,
        correlationExplanation: `Strong concentration of failures in '${dim}' indicates a subsystem-specific issue rather than global platform degradation.`,
        affectedCasesCount: cases.length,
        affectedCaseIds: cases,
        confidence: ratio >= 0.7 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // 2. Latency Spike Correlation in Failing Cases
  // Compare average latency of failing cases vs passing cases
  if (passingCases.length > 0 && failedCases.length > 0) {
    const avgPassLatency = passingCases.reduce((sum, r) => sum + (r.durationMs || 0), 0) / passingCases.length;
    const avgFailLatency = failedCases.reduce((sum, r) => sum + (r.durationMs || 0), 0) / failedCases.length;

    if (avgPassLatency > 0 && avgFailLatency > avgPassLatency * 1.3) {
      const spikePct = Math.round(((avgFailLatency - avgPassLatency) / avgPassLatency) * 100);
      factors.push({
        id: 'rc-latency-elevated',
        factorType: 'latency_spike',
        label: 'Elevated latency observed in failing cases',
        observed: `Failing cases average latency is +${spikePct}% higher (${Math.round(avgFailLatency)}ms vs ${Math.round(avgPassLatency)}ms passing)`,
        correlationExplanation: `Higher latency strongly correlates with execution failure, timeout, or external provider latency degradation.`,
        affectedCasesCount: failedCases.length,
        affectedCaseIds: failedCases.map((f) => f.caseId),
        confidence: spikePct >= 50 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // 3. Provider & Model Correlation
  // Check if failing cases share a specific provider or model
  const providerModelMap = new Map<string, string[]>();
  for (const f of failedCases) {
    const key = `${f.provider || 'Not Tracked'}:::${f.model || 'Not Tracked'}`;
    const list = providerModelMap.get(key) || [];
    list.push(f.caseId);
    providerModelMap.set(key, list);
  }

  for (const [key, cases] of providerModelMap.entries()) {
    const [provider, model] = key.split(':::');
    if (provider !== 'Not Tracked' || model !== 'Not Tracked') {
      const ratio = cases.length / failedCases.length;
      if (ratio >= 0.5 && cases.length >= 2) {
        factors.push({
          id: `rc-provider-${provider}-${model}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
          factorType: 'provider_model',
          label: `Provider / Model concentration (${provider} / ${model})`,
          provider: provider !== 'Not Tracked' ? provider : undefined,
          model: model !== 'Not Tracked' ? model : undefined,
          observed: `${cases.length} of ${failedCases.length} failures executed against ${provider} / ${model}`,
          correlationExplanation: `Failures consistently involve provider '${provider}' and model '${model}'. Check provider API rate limits or model behavior.`,
          affectedCasesCount: cases.length,
          affectedCaseIds: cases,
          confidence: ratio >= 0.8 ? 'HIGH' : 'MEDIUM',
        });
      }
    }
  }

  // 4. Tool-Specific Failure Correlation
  const toolFailures = new Map<string, string[]>();
  for (const f of failedCases) {
    const { category, reason } = classifyFailure(f.dimension, f.expected, f.actual, f.failureReason);
    if (category === 'forbidden_tool_used' || category === 'required_tool_missing') {
      const match = reason.match(/tool ['"]?([a-zA-Z0-9_\-]+)['"]?/i);
      const toolName = match ? match[1] : 'unknown_tool';
      const list = toolFailures.get(toolName) || [];
      list.push(f.caseId);
      toolFailures.set(toolName, list);
    }
  }

  for (const [tool, cases] of toolFailures.entries()) {
    factors.push({
      id: `rc-tool-${tool}`,
      factorType: 'tool_failure',
      label: `Tool assertion correlation with '${tool}'`,
      tool,
      observed: `${cases.length} case(s) failed assertion involving tool '${tool}'`,
      correlationExplanation: `Tool invocation mismatch detected for '${tool}'. Agent reasoning or tool schema prompt may need tuning.`,
      affectedCasesCount: cases.length,
      affectedCaseIds: cases,
      confidence: cases.length >= 3 ? 'HIGH' : 'MEDIUM',
    });
  }

  // 5. Timeout & Budget Pattern Correlation
  const timeoutCases = failedCases.filter((f) => {
    const { category } = classifyFailure(f.dimension, f.expected, f.actual, f.failureReason);
    return category === 'timeout' || category === 'budget_exceeded';
  });

  if (timeoutCases.length >= 2) {
    factors.push({
      id: 'rc-timeout-cluster',
      factorType: 'timeout_pattern',
      label: 'Timeout / Context Overflow Cluster',
      observed: `${timeoutCases.length} cases failed due to execution timeout or context budget overflow`,
      correlationExplanation: `Repeated timeouts indicate long execution paths, multi-hop loops, or slow upstream responses.`,
      affectedCasesCount: timeoutCases.length,
      affectedCaseIds: timeoutCases.map((f) => f.caseId),
      confidence: 'HIGH',
    });
  }

  if (factors.length === 0) {
    return {
      status: 'ROOT_CAUSE_DATA_UNAVAILABLE',
      analyzedFailuresCount: failedCases.length,
      factors: [],
      summary: 'Failures are dispersed across multiple subsystems without significant clustering or telemetry correlation.',
    };
  }

  // Sort by confidence ('HIGH' first) then by affected cases count
  factors.sort((a, b) => {
    const confScore = (c: RootCauseConfidence) => (c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : c === 'LOW' ? 1 : 0);
    const scoreDiff = confScore(b.confidence) - confScore(a.confidence);
    if (scoreDiff !== 0) return scoreDiff;
    return b.affectedCasesCount - a.affectedCasesCount;
  });

  return {
    status: 'available',
    analyzedFailuresCount: failedCases.length,
    factors,
    summary: `Identified ${factors.length} possible contributing factor(s) across ${failedCases.length} failed evaluation cases.`,
  };
}
