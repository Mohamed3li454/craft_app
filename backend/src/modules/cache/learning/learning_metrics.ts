import { logger } from '../../../core/logger';
import { EligibilityReason } from '../../../database/repositories/semantic_candidate.types';

export type LearningMetricEventName =
  | 'learning_candidate_created'
  | 'learning_candidate_rejected'
  | 'learning_candidate_duplicate'
  | 'learning_candidate_validated'
  | 'learning_candidate_promoted'
  | 'learning_candidate_failed'
  // Phase 6 Evidence & Controlled Learning Events
  | 'learning_evidence_observed'
  | 'learning_candidate_reused'
  | 'learning_candidate_example_added'
  | 'learning_candidate_evaluated'
  | 'learning_candidate_promotion_eligible'
  | 'learning_candidate_blocked'
  | 'learning_candidate_conflict'
  | 'learning_candidate_stale';

export interface LearningMetricPayload {
  eventName: LearningMetricEventName;
  candidateId?: string;
  reason?: EligibilityReason | string;
  intent?: string;
  language?: string;
  strategy?: string;
  sourceProvider?: string;
  sourceModel?: string;
  latencyMs?: number;
  duplicateOf?: string;
  score?: number;
  confidence?: number;
  observationCount?: number;
  uniqueExampleCount?: number;
  duplicateCount?: number;
  blockers?: string[];
  details?: string;
}

export class LearningMetrics {
  /**
   * Safe, sanitized metrics recorder.
   * STRICT GUARANTEE: Never logs or stores raw user input or private conversation text.
   */
  public static record(payload: LearningMetricPayload): void {
    const sanitizedLog = {
      event: payload.eventName,
      candidateId: payload.candidateId,
      reason: payload.reason,
      intent: payload.intent,
      language: payload.language || 'default',
      strategy: payload.strategy || 'static',
      sourceProvider: payload.sourceProvider,
      sourceModel: payload.sourceModel,
      duplicateOf: payload.duplicateOf,
      score: payload.score,
      confidence: payload.confidence,
      observationCount: payload.observationCount,
      uniqueExampleCount: payload.uniqueExampleCount,
      duplicateCount: payload.duplicateCount,
      blockers: payload.blockers,
      latencyMs: payload.latencyMs,
      details: payload.details,
      timestamp: new Date().toISOString(),
    };

    logger.info(`[LearningMetrics] ${payload.eventName}`, sanitizedLog);
  }
}
