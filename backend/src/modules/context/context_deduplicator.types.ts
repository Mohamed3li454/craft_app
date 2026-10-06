/**
 * Context Deduplication & Adaptive Budget Types (Phase 14.5)
 *
 * Defines typed models for global context deduplication, source authority hierarchy,
 * context item fingerprinting, provenance tracking, and adaptive context budgeting.
 */

export type ContextSourceType =
  | 'CURRENT_MESSAGE'
  | 'VERIFIED_TOOL_OBSERVATION'
  | 'EXPLICIT_USER_INSTRUCTION'
  | 'CONVERSATION_STATE'
  | 'PERSONALIZATION'
  | 'MEMORY'
  | 'SEARCH_EVIDENCE'
  | 'CONVERSATION'
  | 'DERIVED_SUMMARY'
  | 'LANGUAGE_CONTEXT'
  | 'ADAPTIVE_RESPONSE'
  | 'PROACTIVE_CONTEXT'
  | 'DEFAULT_CONTEXT';

export type ContextPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ContextBudgetMode = 'MINIMAL' | 'STANDARD' | 'RICH' | 'MULTI_STEP';

/**
 * Authoritative Precedence Hierarchy (Section 5)
 * Lower number = Higher authority in conflict or deduplication resolution.
 */
export const SOURCE_AUTHORITY_MAP: Record<ContextSourceType, number> = {
  CURRENT_MESSAGE: 1,
  VERIFIED_TOOL_OBSERVATION: 2,
  EXPLICIT_USER_INSTRUCTION: 3,
  CONVERSATION_STATE: 4,
  PERSONALIZATION: 5,
  MEMORY: 6,
  SEARCH_EVIDENCE: 7,
  CONVERSATION: 8,
  DERIVED_SUMMARY: 9,
  LANGUAGE_CONTEXT: 3, // Authoritative when representing active instruction
  ADAPTIVE_RESPONSE: 4,
  PROACTIVE_CONTEXT: 9,
  DEFAULT_CONTEXT: 10,
};

export interface ContextItem {
  readonly id: string; // Deterministic sha256 fingerprint
  readonly source: ContextSourceType;
  readonly content: string;
  readonly priority: ContextPriority;
  readonly authority: number; // 1 (highest) to 10 (lowest)
  readonly relevance: number; // 0.0 to 1.0
  readonly identityKey: string; // Semantic entity/topic identity key
  readonly metadata?: Record<string, any>;
  readonly dependencies?: readonly string[];
}

export interface ContextDeduplicationProvenance {
  readonly canonicalSource: ContextSourceType;
  readonly canonicalId: string;
  readonly originalSources: readonly ContextSourceType[];
  readonly deduplicatedIds: readonly string[];
  readonly reason: string;
  readonly tokensSaved: number;
}

export interface DeduplicationResult {
  readonly preservedItems: readonly ContextItem[];
  readonly removedItems: readonly ContextItem[];
  readonly provenances: readonly ContextDeduplicationProvenance[];
  readonly totalTokensBefore: number;
  readonly totalTokensAfter: number;
  readonly tokensSaved: number;
  readonly budgetMode: ContextBudgetMode;
}

export interface AdaptiveBudgetLimits {
  readonly maxHistoryChars: number;
  readonly maxMemoryItems: number;
  readonly maxSearchItems: number;
  readonly allowProactiveSuggestions: boolean;
  readonly allowSupplementalContext: boolean;
  readonly targetTokenCeiling: number;
}
