/**
 * Evaluation Quality Gate & Operational Snapshot Engine (Phase 12.4)
 *
 * Implements deterministic quality gate evaluation, release quality snapshots,
 * and operational criteria verification against persisted evaluation runs.
 *
 * Strictly deterministic: Zero LLM judgment or hallucinated telemetry.
 */

import { EvaluationRunRecord, EvaluationCaseResultRecord } from '../../../database/repositories/evaluation.repo';
import { EvaluationCategory } from './types';
import {
  ReleaseMetadata,
  QualityDecision,
  DatasetProvenance,
  extractReleaseMetadata,
  deriveQualityDecision,
  resolveDatasetProvenance,
} from './release_quality';

export interface QualityGatePolicy {
  minimumPassRate?: number; // e.g. 95 (percentage, 0-100)
  minimumScore?: number; // e.g. 90 (percentage, 0-100)
  maximumRegressions?: number; // e.g. 0
  maximumFailures?: number; // e.g. 2
}

export interface QualityGateCheckItem {
  criterion: 'minimum_pass_rate' | 'minimum_score' | 'maximum_regressions' | 'maximum_failures';
  label: string;
  threshold: number | string;
  actual: number | string;
  passed: boolean;
  message: string;
}

export interface QualityGateEvaluationResult {
  runId: string;
  status: 'passed' | 'failed' | 'not_configured';
  policyConfigured: boolean;
  policy: QualityGatePolicy;
  checks: QualityGateCheckItem[];
  failureReasons: string[];
  evaluatedAt: string;
}

export interface QualityReleaseSnapshot {
  runId: string;
  datasetVersion: string;
  mode: string;
  status: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  overallScore: number;
  regressionCount: number;
  durationMs: number;
  completedAt: string | null;
  createdBy: string;
  dimensionScores: Record<EvaluationCategory, { total: number; passed: number; passRate: number; avgScore: number }>;
  qualityGate: QualityGateEvaluationResult;
  releaseMetadata?: ReleaseMetadata;
  qualityDecision?: QualityDecision;
  datasetProvenance?: DatasetProvenance;
  snapshotGeneratedAt: string;
}

/**
 * Resolves the active Quality Gate policy from explicit options or platform environment.
 * If no threshold is configured, policyConfigured is false (thresholds are 'Not Configured').
 */
export function resolveQualityGatePolicy(explicitPolicy?: QualityGatePolicy): {
  policy: QualityGatePolicy;
  isConfigured: boolean;
} {
  const envMinPassRate = process.env.QUALITY_GATE_MIN_PASS_RATE
    ? parseFloat(process.env.QUALITY_GATE_MIN_PASS_RATE)
    : undefined;
  const envMinScore = process.env.QUALITY_GATE_MIN_SCORE
    ? parseFloat(process.env.QUALITY_GATE_MIN_SCORE)
    : undefined;
  const envMaxRegressions = process.env.QUALITY_GATE_MAX_REGRESSIONS
    ? parseInt(process.env.QUALITY_GATE_MAX_REGRESSIONS, 10)
    : undefined;
  const envMaxFailures = process.env.QUALITY_GATE_MAX_FAILURES
    ? parseInt(process.env.QUALITY_GATE_MAX_FAILURES, 10)
    : undefined;

  const policy: QualityGatePolicy = {
    minimumPassRate: explicitPolicy?.minimumPassRate ?? envMinPassRate,
    minimumScore: explicitPolicy?.minimumScore ?? envMinScore,
    maximumRegressions: explicitPolicy?.maximumRegressions ?? envMaxRegressions,
    maximumFailures: explicitPolicy?.maximumFailures ?? envMaxFailures,
  };

  const isConfigured =
    policy.minimumPassRate !== undefined ||
    policy.minimumScore !== undefined ||
    policy.maximumRegressions !== undefined ||
    policy.maximumFailures !== undefined;

  return { policy, isConfigured };
}

/**
 * Deterministically evaluates a completed run against the Quality Gate policy.
 */
export function evaluateQualityGate(
  run: EvaluationRunRecord,
  customPolicy?: QualityGatePolicy
): QualityGateEvaluationResult {
  const { policy, isConfigured } = resolveQualityGatePolicy(customPolicy);
  const now = new Date().toISOString();

  if (!isConfigured) {
    return {
      runId: run.id,
      status: 'not_configured',
      policyConfigured: false,
      policy: {},
      checks: [
        {
          criterion: 'minimum_pass_rate',
          label: 'Minimum Pass Rate',
          threshold: 'Not Configured',
          actual: `${run.totalCases > 0 ? Math.round((run.passedCases / run.totalCases) * 1000) / 10 : 0}%`,
          passed: true,
          message: 'No minimum pass rate threshold is defined.',
        },
        {
          criterion: 'minimum_score',
          label: 'Minimum Score',
          threshold: 'Not Configured',
          actual: `${run.overallScore}%`,
          passed: true,
          message: 'No minimum score threshold is defined.',
        },
        {
          criterion: 'maximum_regressions',
          label: 'Maximum Regressions',
          threshold: 'Not Configured',
          actual: run.regressionCount,
          passed: true,
          message: 'No maximum regression ceiling is defined.',
        },
        {
          criterion: 'maximum_failures',
          label: 'Maximum Failures',
          threshold: 'Not Configured',
          actual: run.failedCases,
          passed: true,
          message: 'No maximum failure ceiling is defined.',
        },
      ],
      failureReasons: [],
      evaluatedAt: now,
    };
  }

  const checks: QualityGateCheckItem[] = [];
  const failureReasons: string[] = [];

  const actualPassRate = run.totalCases > 0 ? Math.round((run.passedCases / run.totalCases) * 1000) / 10 : 0;
  const actualScore = run.overallScore ?? 0;
  const actualRegressions = run.regressionCount ?? 0;
  const actualFailures = run.failedCases ?? 0;

  // 1. Minimum Pass Rate Check
  if (policy.minimumPassRate !== undefined) {
    const passed = actualPassRate >= policy.minimumPassRate;
    checks.push({
      criterion: 'minimum_pass_rate',
      label: 'Minimum Pass Rate',
      threshold: `${policy.minimumPassRate}%`,
      actual: `${actualPassRate}%`,
      passed,
      message: passed
        ? `Pass rate ${actualPassRate}% meets requirement of >= ${policy.minimumPassRate}%.`
        : `Pass rate ${actualPassRate}% is below requirement of >= ${policy.minimumPassRate}%.`,
    });
    if (!passed) {
      failureReasons.push(`Pass rate ${actualPassRate}% is below minimum threshold of ${policy.minimumPassRate}%.`);
    }
  }

  // 2. Minimum Score Check
  if (policy.minimumScore !== undefined) {
    const passed = actualScore >= policy.minimumScore;
    checks.push({
      criterion: 'minimum_score',
      label: 'Minimum Quality Score',
      threshold: `${policy.minimumScore}%`,
      actual: `${actualScore}%`,
      passed,
      message: passed
        ? `Overall score ${actualScore}% meets requirement of >= ${policy.minimumScore}%.`
        : `Overall score ${actualScore}% is below requirement of >= ${policy.minimumScore}%.`,
    });
    if (!passed) {
      failureReasons.push(`Overall score ${actualScore}% is below minimum threshold of ${policy.minimumScore}%.`);
    }
  }

  // 3. Maximum Regressions Check
  if (policy.maximumRegressions !== undefined) {
    const passed = actualRegressions <= policy.maximumRegressions;
    checks.push({
      criterion: 'maximum_regressions',
      label: 'Maximum Active Regressions',
      threshold: policy.maximumRegressions,
      actual: actualRegressions,
      passed,
      message: passed
        ? `Regression count ${actualRegressions} is within allowed ceiling of <= ${policy.maximumRegressions}.`
        : `Regression count ${actualRegressions} exceeds maximum allowed ceiling of ${policy.maximumRegressions}.`,
    });
    if (!passed) {
      failureReasons.push(
        `Active regression count (${actualRegressions}) exceeds maximum limit (${policy.maximumRegressions}).`
      );
    }
  }

  // 4. Maximum Failures Check
  if (policy.maximumFailures !== undefined) {
    const passed = actualFailures <= policy.maximumFailures;
    checks.push({
      criterion: 'maximum_failures',
      label: 'Maximum Failed Scenarios',
      threshold: policy.maximumFailures,
      actual: actualFailures,
      passed,
      message: passed
        ? `Failed scenarios count ${actualFailures} is within allowed ceiling of <= ${policy.maximumFailures}.`
        : `Failed scenarios count ${actualFailures} exceeds maximum allowed ceiling of ${policy.maximumFailures}.`,
    });
    if (!passed) {
      failureReasons.push(
        `Failed scenarios count (${actualFailures}) exceeds maximum limit (${policy.maximumFailures}).`
      );
    }
  }

  const allPassed = checks.every((c) => c.passed);

  return {
    runId: run.id,
    status: allPassed ? 'passed' : 'failed',
    policyConfigured: true,
    policy,
    checks,
    failureReasons,
    evaluatedAt: now,
  };
}

/**
 * Builds a clean, deterministic Quality Release Snapshot without CoT, credentials, or prompts.
 */
export function buildQualityReleaseSnapshot(
  run: EvaluationRunRecord,
  results: EvaluationCaseResultRecord[],
  policy?: QualityGatePolicy
): QualityReleaseSnapshot {
  const dimensions: EvaluationCategory[] = [
    'memory',
    'conversation',
    'personalization',
    'adaptive_response',
    'agent',
    'provider',
    'proactive',
  ];

  const dimensionScores = {} as QualityReleaseSnapshot['dimensionScores'];

  for (const dim of dimensions) {
    const dimResults = results.filter((r) => r.dimension === dim);
    const total = dimResults.length;
    const passed = dimResults.filter((r) => r.status === 'passed').length;
    const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 100;
    const sumScore = dimResults.reduce((acc, r) => acc + (r.score || 0), 0);
    const avgScore = total > 0 ? Math.round((sumScore / total) * 10) / 10 : 100;

    dimensionScores[dim] = {
      total,
      passed,
      passRate,
      avgScore,
    };
  }

  const qualityGate = evaluateQualityGate(run, policy);
  const passRate = run.totalCases > 0 ? Math.round((run.passedCases / run.totalCases) * 1000) / 10 : 0;
  const releaseMetadata = extractReleaseMetadata(run.metadata?.release || run.metadata);
  const qualityDecision = deriveQualityDecision(qualityGate.status);
  const datasetProvenance = resolveDatasetProvenance(run.datasetVersion);

  return {
    runId: run.id,
    datasetVersion: run.datasetVersion,
    mode: run.mode,
    status: run.status,
    totalCases: run.totalCases,
    passedCases: run.passedCases,
    failedCases: run.failedCases,
    passRate,
    overallScore: run.overallScore,
    regressionCount: run.regressionCount,
    durationMs: run.durationMs,
    completedAt: run.completedAt || null,
    createdBy: run.createdBy,
    dimensionScores,
    qualityGate,
    releaseMetadata,
    qualityDecision,
    datasetProvenance,
    snapshotGeneratedAt: new Date().toISOString(),
  };
}
