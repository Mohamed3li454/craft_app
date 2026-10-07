/**
 * Factual Grounding & Natural Response Guard Types (Phase 15.1F)
 *
 * Defines the contract for precision factual detection, evidence-bound
 * grounding verification, search failure safety, and natural response guarding.
 */

export type FactualPrecisionPolicy = 'NORMAL' | 'FACTUAL_ENHANCED' | 'PRECISION_FACTUAL';

export type FactualCategory =
  | 'CHRONOLOGY_OR_RELEASE_ORDER'
  | 'MULTI_ENTITY_ATTRIBUTES'
  | 'HISTORICAL_EVENT_OR_RULER'
  | 'FACTUAL_VERIFICATION_OR_CORRECTION'
  | 'TECHNICAL_SPEC_OR_VERSION'
  | 'GENERAL_KNOWLEDGE';

export interface FactualEvaluationResult {
  readonly policy: FactualPrecisionPolicy;
  readonly category?: FactualCategory;
  readonly score: number;
  readonly signals: readonly string[];
  readonly requiresSearch: boolean;
  readonly reason: string;
}

export interface FactualClaimValidationResult {
  readonly isGrounded: boolean;
  readonly unverifiedEntities: readonly string[];
  readonly warning?: string;
}

export interface SearchFailureSafetyResult {
  readonly shouldFallback: boolean;
  readonly fallbackMessage?: string;
  readonly reason?: string;
}
