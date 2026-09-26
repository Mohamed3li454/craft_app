import { ResponseStrategy } from './semantic_cache.types';

export type CandidateStatus = 'pending' | 'validated' | 'rejected' | 'promoted';

export type EligibilityReason =
  | 'static_reusable'
  | 'dynamic'
  | 'user_specific'
  | 'tool_result'
  | 'search_result'
  | 'private'
  | 'low_confidence'
  | 'empty_response'
  | 'duplicate'
  | 'unsupported';

export interface SemanticCacheCandidate {
  id: string;
  intent: string;
  category: string;
  inputExamples: string[];
  response: string;
  responseStrategy: ResponseStrategy;
  responseTemplates: Record<string, string[]>;
  language: string;
  sourceModel?: string | null;
  sourceProvider?: string | null;
  sourceRunId?: string | null;
  confidence: number;
  eligibilityReason: EligibilityReason;
  status: CandidateStatus;
  rejectionReason?: string | null;
  promotedFaqId?: string | null;

  // Phase 6 Evidence Model fields:
  observationCount: number;
  uniqueExampleCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  validationCount: number;
  rejectionCount: number;
  safetyViolationCount: number;
  duplicateCount: number;
  conflictCount: number;
  semanticConsistency?: number | null;
  promotionEligible: boolean;
  promotionReasons: string[];
  promotionBlockers: string[];

  createdAt: string;
  updatedAt: string;
  validatedAt?: string | null;
  promotedAt?: string | null;
}

export interface CreateCandidateDto {
  intent: string;
  category?: string;
  inputExamples: string[];
  response: string;
  responseStrategy?: ResponseStrategy;
  responseTemplates?: Record<string, string[]>;
  language?: string;
  sourceModel?: string;
  sourceProvider?: string;
  sourceRunId?: string;
  confidence?: number;
  eligibilityReason?: EligibilityReason;
  status?: CandidateStatus;
  rejectionReason?: string;

  // Phase 6 optional creation overrides
  observationCount?: number;
  uniqueExampleCount?: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  validationCount?: number;
  rejectionCount?: number;
  safetyViolationCount?: number;
  duplicateCount?: number;
  conflictCount?: number;
  semanticConsistency?: number;
  promotionEligible?: boolean;
  promotionReasons?: string[];
  promotionBlockers?: string[];
}

export interface UpdateCandidateEvidenceDto {
  observationCount?: number;
  uniqueExampleCount?: number;
  inputExamples?: string[];
  lastObservedAt?: string;
  validationCount?: number;
  rejectionCount?: number;
  safetyViolationCount?: number;
  duplicateCount?: number;
  conflictCount?: number;
  confidence?: number;
  semanticConsistency?: number | null;
  promotionEligible?: boolean;
  promotionReasons?: string[];
  promotionBlockers?: string[];
  status?: CandidateStatus;
  rejectionReason?: string | null;
}

export interface ListCandidatesFilter {
  status?: CandidateStatus;
  promotionEligible?: boolean;
  promotionEligibleOnly?: boolean; // backwards compatible
  intent?: string;
  category?: string;
  language?: string;
  sourceModel?: string;
  responseStrategy?: ResponseStrategy;
  createdAfter?: string; // ISO date
  createdBefore?: string; // ISO date
  from?: string; // ISO date synonym for createdAfter
  to?: string; // ISO date synonym for createdBefore
  updatedAfter?: string; // ISO date
  minConfidence?: number;
  maxConfidence?: number;
  minObservations?: number;
  hasConflict?: boolean;
  isStale?: boolean;
  limit?: number;
  offset?: number;
  cursor?: string; // Cursor pagination using created_at/id
}

export type ReviewAction = 'view' | 'validate' | 'reject' | 'promote';

export interface ReviewEvent {
  id: string;
  candidateId: string;
  action: ReviewAction;
  actorId?: string | null;
  reason?: string | null;
  previousStatus?: CandidateStatus | null;
  newStatus?: CandidateStatus | null;
  previousEligibility?: boolean | null;
  newEligibility?: boolean | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface CreateReviewEventDto {
  candidateId: string;
  action: ReviewAction;
  actorId?: string | null;
  reason?: string | null;
  previousStatus?: CandidateStatus | null;
  newStatus?: CandidateStatus | null;
  previousEligibility?: boolean | null;
  newEligibility?: boolean | null;
  metadata?: Record<string, any>;
}

export interface SanitizedCandidateDetail {
  id: string;
  intent: string;
  category: string;
  inputExamples: string[];
  response: string;
  responseStrategy: ResponseStrategy;
  responseTemplates: Record<string, string[]>;
  language: string;
  sourceModel?: string | null;
  sourceProvider?: string | null;
  confidence: number;
  eligibilityReason: EligibilityReason;
  status: CandidateStatus;
  rejectionReason?: string | null;
  promotedFaqId?: string | null;
  observationCount: number;
  uniqueExampleCount: number;
  duplicateCount: number;
  validationCount: number;
  rejectionCount: number;
  safetyViolationCount: number;
  conflictCount: number;
  semanticConsistency?: number | null;
  promotionEligible: boolean;
  promotionReasons: string[];
  promotionBlockers: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  validatedAt?: string | null;
  promotedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
