/**
 * Continuous Evaluation & Release Quality Integration (Phase 12.5)
 *
 * Provides deterministic release provenance metadata, dataset version safety,
 * objective quality decisions ('approved' | 'rejected' | 'not_configured'),
 * and sanitized release quality signals.
 *
 * Invariant: Evaluation generates Quality Signals, NEVER Production Commands.
 * Zero secrets, zero CoT, zero internal prompts.
 */

import { EvaluationRunRecord, EvaluationCaseResultRecord } from '../../../database/repositories/evaluation.repo';
import { QualityGatePolicy, QualityGateEvaluationResult, evaluateQualityGate } from './quality_gate';

export type QualityDecision = 'approved' | 'rejected' | 'not_configured';

export interface ReleaseMetadata {
  commitSha: string | null;
  deploymentId: string | null;
  deploymentVersion: string | null;
  environment: string | null;
  branch?: string | null;
  buildId?: string | null;
}

export interface DatasetProvenance {
  datasetVersion: string;
  caseCount: number;
  dimensionsCount: number;
  source: 'source-controlled' | 'Not Tracked';
}

export interface ReleaseQualitySignal {
  runId: string;
  datasetVersion: string;
  datasetProvenance: DatasetProvenance;
  releaseMetadata: ReleaseMetadata;
  qualityGate: QualityGateEvaluationResult;
  qualityDecision: QualityDecision;
  metrics: {
    status: string;
    mode: string;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    passRate: number;
    overallScore: number;
    regressionCount: number;
    durationMs: number;
    startedAt: string;
    completedAt: string | null;
  };
  generatedAt: string;
}

const FORBIDDEN_SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /bearer/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /access[_-]?token/i,
  /gh[pous]_[a-zA-Z0-9]+/i,
  /github_pat_/i,
  /sk[_-](live|test)_[a-zA-Z0-9]+/i,
];

/**
 * Sanitizes and bounds arbitrary strings for release provenance.
 * Redacts any string matching forbidden credential/auth patterns.
 */
export function sanitizeProvenanceString(val?: any): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val !== 'string') return null;

  const trimmed = val.trim();
  if (trimmed.length === 0) return null;

  // Strict secret screening
  for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
    if (pattern.test(trimmed)) {
      return '[REDACTED_CREDENTIAL]';
    }
  }

  // Bound maximum length to 128 characters
  return trimmed.slice(0, 128);
}

/**
 * Extracts and sanitizes release provenance metadata without shell/browser execution.
 * Reads solely from safe, explicit inputs or platform environment variables.
 */
export function extractReleaseMetadata(input?: Record<string, any>): ReleaseMetadata {
  const commitSha = sanitizeProvenanceString(
    input?.commitSha ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA
  );

  const deploymentId = sanitizeProvenanceString(
    input?.deploymentId ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.DEPLOYMENT_ID
  );

  const deploymentVersion = sanitizeProvenanceString(
    input?.deploymentVersion ||
    input?.version ||
    process.env.APP_VERSION ||
    process.env.RELEASE_VERSION
  );

  const environment = sanitizeProvenanceString(
    input?.environment ||
    process.env.VERCEL_ENV ||
    process.env.ENVIRONMENT ||
    (process.env.NODE_ENV && process.env.NODE_ENV !== 'test' ? process.env.NODE_ENV : null)
  );

  const branch = sanitizeProvenanceString(
    input?.branch ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.BRANCH
  );

  const buildId = sanitizeProvenanceString(
    input?.buildId ||
    process.env.BUILD_ID
  );

  return {
    commitSha,
    deploymentId,
    deploymentVersion,
    environment,
    branch,
    buildId,
  };
}

/**
 * Resolves authoritative dataset provenance for an evaluation run.
 */
export function resolveDatasetProvenance(datasetVersion: string): DatasetProvenance {
  const isGolden = datasetVersion === 'Phase 8.5 Golden Benchmark Dataset';
  return {
    datasetVersion,
    caseCount: isGolden ? 56 : 0,
    dimensionsCount: isGolden ? 7 : 0,
    source: isGolden ? 'source-controlled' : 'Not Tracked',
  };
}

/**
 * Derives a deterministic release quality decision from the Quality Gate status.
 * Strictly rule-based: Zero AI judgment or confidence heuristics.
 */
export function deriveQualityDecision(gateStatus: 'passed' | 'failed' | 'not_configured'): QualityDecision {
  if (gateStatus === 'passed') return 'approved';
  if (gateStatus === 'failed') return 'rejected';
  return 'not_configured';
}

/**
 * Constructs an authoritative Release Quality Signal for a run.
 */
export function buildReleaseQualitySignal(
  run: EvaluationRunRecord,
  policy?: QualityGatePolicy
): ReleaseQualitySignal {
  const datasetProvenance = resolveDatasetProvenance(run.datasetVersion);
  const releaseMetadata = extractReleaseMetadata(run.metadata?.release || run.metadata?.releaseMetadata || run.metadata);
  const qualityGate = evaluateQualityGate(run, policy);
  const qualityDecision = deriveQualityDecision(qualityGate.status);

  const passRate = run.totalCases > 0
    ? Math.round((run.passedCases / run.totalCases) * 1000) / 10
    : 0;

  return {
    runId: run.id,
    datasetVersion: run.datasetVersion,
    datasetProvenance,
    releaseMetadata,
    qualityGate,
    qualityDecision,
    metrics: {
      status: run.status,
      mode: run.mode,
      totalCases: run.totalCases,
      passedCases: run.passedCases,
      failedCases: run.failedCases,
      passRate,
      overallScore: run.overallScore,
      regressionCount: run.regressionCount,
      durationMs: run.durationMs,
      startedAt: run.startedAt,
      completedAt: run.completedAt || null,
    },
    generatedAt: new Date().toISOString(),
  };
}
