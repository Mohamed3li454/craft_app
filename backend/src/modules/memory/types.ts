/**
 * Memory Architecture Module - Core Types (Phase 4.2 & 4.4)
 *
 * Defines structured, provider-agnostic data models for User Memory,
 * separating Identity, Preferences, Stable Facts, and Working/Ephemeral Context,
 * with complete support for Conflict Resolution, Deduplication, and Lifecycle tracking.
 */

import crypto from 'crypto';
import { SupportedLanguage, ArabicDialect } from '../language/types';
import {
  ToneAttribute,
  FormalityLevel,
  VerbosityLevel,
  AddressingStyle,
  EmojiPolicy,
  HumorLevel,
  ProactivityLevel,
} from '../personality/types';

/**
 * Functional taxonomy of memory facts stored in the system.
 */
export type MemoryCategory =
  | 'identity'               // User identity facts (name, display name, contact handle)
  | 'preference'             // General non-linguistic, non-personality preferences
  | 'language_preference'    // Explicit language/dialect settings
  | 'personality_preference' // Explicit AI communication style settings
  | 'technical_context'      // Tools, frameworks, technical stack, environment
  | 'stable_fact'            // Long-term durable facts (profession, company, location)
  | 'ephemeral_context'      // Time-bound temporary state (current task, travel, short-term goal)
  // Backward compatibility legacy categories:
  | 'general'
  | 'profession'
  | 'interests';

/**
 * Origin of a memory record.
 */
export type MemorySource =
  | 'user_explicit'        // Directly stated or commanded by user (e.g., "احفظ أنني...", "Remember that...")
  | 'agent_tool'           // Autonomously saved by the AI agent via tool invocation (e.g. SaveMemoryTool)
  | 'automatic_extraction' // Detected by deterministic extraction rules (regex/keywords)
  | 'system_derived';      // Derived by background workflows, sync, or administrative profile updates

/**
 * Lifecycle status of a memory record.
 */
export type MemoryStatus = 'active' | 'superseded' | 'expired';

/**
 * Strict priority ranking for memory sources (higher number = higher authority).
 */
export const SOURCE_PRIORITY: Record<MemorySource, number> = {
  user_explicit: 4,
  agent_tool: 3,
  automatic_extraction: 2,
  system_derived: 1,
};

/**
 * Confidence score represented as a number between 0.0 and 1.0.
 * - 0.0: Minimum confidence (highly speculative or uncertain)
 * - 1.0: Maximum confidence (explicit user declaration or verified fact)
 */
export type ConfidenceScore = number;

/**
 * Helper to validate confidence score contract (0.0 <= score <= 1.0).
 */
export function isValidConfidence(score: number): boolean {
  return typeof score === 'number' && !isNaN(score) && score >= 0.0 && score <= 1.0;
}

/**
 * Relative importance of the memory item for context retention and prompt retrieval.
 */
export type MemoryImportance = 'low' | 'normal' | 'high' | 'critical';

/**
 * Safe structured metadata for a memory record.
 */
export interface MemoryMetadata {
  readonly topic?: string;
  readonly contextTurnId?: string;
  readonly channel?: 'whatsapp' | 'flutter' | string;
  readonly verified?: boolean;
  readonly supersededBy?: string;
  readonly supersededAt?: Date | string;
  readonly supersedeReason?: string;
  readonly [key: string]: unknown;
}

/**
 * Isolated Language Preference Model.
 * Strictly decoupled from personality traits or stylistic qualifiers.
 */
export interface LanguagePreference {
  readonly language: SupportedLanguage;
  readonly dialect?: ArabicDialect;
  readonly script?: 'arabic' | 'latin';
  readonly confidence?: ConfidenceScore;
  readonly updatedAt?: Date;
}

/**
 * Isolated Personality Preference Model.
 * Strictly decoupled from language or dialect identifiers.
 */
export interface PersonalityPreference {
  readonly tone?: readonly ToneAttribute[];
  readonly formality?: FormalityLevel;
  readonly verbosity?: VerbosityLevel;
  readonly addressingStyle?: AddressingStyle;
  readonly emojiPolicy?: EmojiPolicy;
  readonly humorLevel?: HumorLevel;
  readonly proactivity?: ProactivityLevel;
  readonly confidence?: ConfidenceScore;
  readonly updatedAt?: Date;
}

/**
 * Phase 2.4 - Temporal Intelligence & State Awareness Models
 */
export type TemporalState = 'historical' | 'current' | 'planned' | 'temporary' | 'unknown';

export interface TemporalMetadata {
  readonly temporalState: TemporalState;
  readonly temporalSignal?: string;
  readonly rawTemporalPhrase?: string;
  readonly relativeExpression?: string;
  readonly validFrom?: Date | string | null;
  readonly validUntil?: Date | string | null;
  readonly temporalConfidence?: number;
  readonly temporalAmbiguity?: boolean;
}

/**
 * Full Structured Memory Record.
 */
export interface MemoryItem {
  readonly id: string;
  readonly userId: string;
  readonly factText: string;
  readonly category: MemoryCategory;
  readonly status?: MemoryStatus;
  readonly factKey?: string;
  readonly source: MemorySource;
  readonly confidence: ConfidenceScore;
  readonly importance: MemoryImportance;
  readonly temporalState?: TemporalState;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null; // null or undefined indicates permanent fact
  readonly metadata?: MemoryMetadata;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Options for saving a memory fact.
 */
export interface MemorySaveOptions {
  readonly source?: MemorySource;
  readonly confidence?: ConfidenceScore;
  readonly importance?: MemoryImportance;
  readonly temporalState?: TemporalState;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
  readonly metadata?: MemoryMetadata;
  readonly factKey?: string;
  readonly status?: MemoryStatus;
}

/**
 * Input DTO for creating a new memory record.
 */
export interface MemoryCreateInput {
  readonly userId: string;
  readonly factText: string;
  readonly category?: MemoryCategory;
  readonly status?: MemoryStatus;
  readonly factKey?: string;
  readonly source?: MemorySource;
  readonly confidence?: ConfidenceScore;
  readonly importance?: MemoryImportance;
  readonly temporalState?: TemporalState;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
  readonly metadata?: MemoryMetadata;
}

/**
 * Conservative normalization for memory fact text:
 * - Trims leading/trailing whitespace
 * - Collapses multiple spaces into single space
 * - Strips trailing sentence punctuation (. , ! ?)
 */
export function normalizeFactText(text: string): string {
  if (!text) return '';
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.،,؛;!؟?]+$/g, '')
    .trim();
}

/**
 * Computes Jaccard token similarity for conservative lexical/semantic deduplication.
 */
export function calculateTokenSimilarity(a: string, b: string): number {
  const normA = normalizeFactText(a).toLowerCase();
  const normB = normalizeFactText(b).toLowerCase();
  if (normA === normB) return 1.0;

  const tokensA = new Set(normA.split(/\s+/).filter(Boolean));
  const tokensB = new Set(normB.split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersection++;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

/**
 * Computes a deterministic evidence fingerprint for strict observation and evidence idempotency.
 * Combination: userId + candidateKey/factKey + conversationId + canonicalFact + source (or explicit evidenceId).
 */
export function computeEvidenceFingerprint(params: {
  userId?: string;
  candidateKey?: string;
  factKey?: string;
  conversationId?: string;
  canonicalFact?: string;
  factText?: string;
  rawSignal?: string;
  source?: string;
  evidenceId?: string;
}): string {
  if (params.evidenceId) {
    return params.evidenceId;
  }
  const uid = params.userId || '';
  const key = params.candidateKey || params.factKey || '';
  const conv = params.conversationId || '';
  const text = normalizeFactText(params.canonicalFact || params.factText || '').toLowerCase();
  const signal = normalizeFactText(params.rawSignal || '').toLowerCase();
  const src = params.source || 'automatic_extraction';

  const raw = `${uid}|${key}|${conv}|${text}|${signal}|${src}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Derives a deterministic fact_key for category-aware conflict detection.
 */
export function deriveFactKey(factText: string, category?: string): string | undefined {
  const clean = normalizeFactText(factText);
  const lower = clean.toLowerCase();

  // 1. Identity name
  if (
    category === 'identity' ||
    /(?:اسم المستخدم|اسمي|أنا اسمي)\s*:/i.test(clean) ||
    clean.startsWith('اسم المستخدم:')
  ) {
    return 'identity.name';
  }

  // 2. Preference theme
  if (
    category === 'preference' &&
    (lower.includes('dark mode') ||
      lower.includes('light mode') ||
      clean.includes('الوضع الليلي') ||
      clean.includes('الوضع الفاتح') ||
      clean.includes('النمط الليلي') ||
      clean.includes('النمط الفاتح'))
  ) {
    return 'preference.theme';
  }

  // 3. Profession / job (Current vs Historical)
  if (category === 'profession') {
    if (
      clean.includes('سابقاً') ||
      clean.includes('سابقا') ||
      clean.includes('كان يعمل') ||
      lower.includes('formerly') ||
      lower.includes('used to') ||
      lower.includes('historical')
    ) {
      return 'profession.historical';
    }
    return 'profession.current';
  }

  return undefined;
}

/**
 * Phase 4.6 - Selective Retrieval & Context Assembly Models
 */

export interface MemoryRetrievalQuery {
  readonly userId: string;
  readonly message: string;
  readonly language?: string;
  readonly categories?: MemoryCategory[];
  readonly limit?: number;
}

export interface QueryIntentAnalysis {
  readonly rawMessage: string;
  readonly normalizedTokens: string[];
  readonly detectedCategories: Set<MemoryCategory>;
  readonly topics: string[];
  readonly technicalEntities: string[];
  readonly temporalIntent: 'current' | 'historical' | 'planned' | 'both_historical_and_current' | 'neutral';
  readonly isIdentityIntent: boolean;
  readonly isPreferenceIntent: boolean;
  readonly isPurePreferenceDirective: boolean;
  readonly isProjectIntent: boolean;
  readonly isWorkIntent: boolean;
  readonly negatedEntities: string[];
}

export interface RetrievedMemory {
  readonly memory: MemoryItem;
  readonly relevanceScore: number;
  readonly retrievalReason: string;
}

export interface MemoryContext {
  readonly memories: readonly RetrievedMemory[];
  readonly totalCandidates: number;
  readonly selectedCount: number;
  readonly formattedPromptText?: string;
}

export const DEFAULT_MEMORY_RETRIEVAL_LIMIT = 5;
export const DEFAULT_MEMORY_TOKEN_BUDGET = 300;
export const DEFAULT_MEMORY_CHAR_BUDGET = 1200;
export const MIN_MEMORY_RELEVANCE_THRESHOLD = 0.20;

/**
 * Phase 2.2 - Memory Evidence & Observation Engine Models
 */

export type EvidenceStatus = 'observing' | 'promoted' | 'discarded' | 'rejected';

export interface MemoryObservation {
  readonly id?: string;
  readonly userId: string;
  readonly candidateKey: string;
  readonly category: MemoryCategory;
  readonly rawSignal: string;
  readonly canonicalFact: string;
  readonly source: MemorySource;
  readonly confidence: number;
  readonly conversationId?: string;
  readonly isExplicit?: boolean;
  readonly temporalState?: TemporalState;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
  readonly temporalMetadata?: TemporalMetadata;
  readonly metadata?: Record<string, unknown>;
  readonly observedAt?: Date;
}

export interface MemoryEvidenceCandidate {
  readonly id: string;
  readonly userId: string;
  readonly candidateKey: string;
  readonly category: MemoryCategory;
  readonly canonicalFact: string;
  readonly evidenceCount: number;
  readonly conversationCount: number;
  readonly conversationIds: readonly string[];
  readonly sources: readonly MemorySource[];
  readonly evidenceStrength: number;
  readonly confidence?: number;
  readonly importance?: MemoryImportance;
  readonly temporalState?: TemporalState;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
  readonly status: EvidenceStatus;
  readonly promotedMemoryId?: string;
  readonly firstObservedAt: Date;
  readonly lastObservedAt: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface EvidenceStrengthFactors {
  readonly evidenceCount: number;
  readonly conversationCount: number;
  readonly hasExplicitSource: boolean;
  readonly sources: readonly MemorySource[];
  readonly firstObservedAt?: Date;
  readonly lastObservedAt?: Date;
}

/**
 * Deterministically computes evidence strength without confusing with final memory confidence.
 * Distinct conversation diversity is strictly weighted higher than same-conversation spam.
 */
export function calculateEvidenceStrength(factors: EvidenceStrengthFactors): number {
  if (
    factors.hasExplicitSource ||
    factors.sources.includes('user_explicit') ||
    factors.sources.includes('agent_tool')
  ) {
    return 1.0;
  }

  // Conversation diversity points (up to 0.75 for 3 distinct conversations)
  const distinctPoints = Math.min(3, Math.max(1, factors.conversationCount)) * 0.25;

  // Diminishing returns for repetitions within the same conversation (up to 0.25)
  const excessRepetitions = Math.max(0, factors.evidenceCount - factors.conversationCount);
  const repetitionPoints = Math.min(5, excessRepetitions) * 0.05;

  const rawScore = distinctPoints + repetitionPoints;
  return Math.min(1.0, Math.max(0.0, Number(rawScore.toFixed(2))));
}

export interface PromotionDecision {
  readonly shouldPromote: boolean;
  readonly reason: string;
}

/**
 * Category-aware promotion policy that decides whether an evidence candidate
 * qualifies to become an active persistent memory in memory_items.
 */
export function evaluatePromotion(candidate: MemoryEvidenceCandidate): PromotionDecision {
  // 1. Explicit user commands or agent tools always promote immediately
  if (
    candidate.sources.includes('user_explicit') ||
    candidate.sources.includes('agent_tool') ||
    Boolean(candidate.metadata?.isExplicit)
  ) {
    return { shouldPromote: true, reason: 'explicit_authority' };
  }

  // 2. Identity category: requires explicit authority
  if (candidate.category === 'identity') {
    if (
      candidate.sources.includes('user_explicit') ||
      Boolean(candidate.metadata?.isExplicit)
    ) {
      return { shouldPromote: true, reason: 'explicit_identity' };
    }
    return { shouldPromote: false, reason: 'observed_identity_requires_confirmation' };
  }

  // 3. Technical context / Profession: requires repeated evidence
  if (candidate.category === 'technical_context' || candidate.category === 'profession') {
    // Cross-conversation consensus: at least 2 distinct conversations
    if (candidate.conversationCount >= 2) {
      return { shouldPromote: true, reason: 'cross_conversation_consensus' };
    }
    // High in-session reinforcement: at least 3 distinct observations
    if (candidate.evidenceCount >= 3) {
      return { shouldPromote: true, reason: 'repeated_in_session_reinforcement' };
    }
    return { shouldPromote: false, reason: 'insufficient_evidence_threshold' };
  }

  // 4. Default / General observations: requires higher consensus
  if (candidate.conversationCount >= 3 || candidate.evidenceCount >= 5) {
    return { shouldPromote: true, reason: 'high_frequency_observation' };
  }

  return { shouldPromote: false, reason: 'observing_stage' };
}

/**
 * Phase 2.3: Dynamic Confidence Calculation Model
 */
export const AUTOMATIC_INFERENCE_CONFIDENCE_CEILING = 0.90;
export const EXPLICIT_CONFIDENCE_CEILING = 0.98;

export interface DynamicConfidenceFactors {
  readonly evidenceCount: number;
  readonly conversationCount: number;
  readonly sources: readonly MemorySource[];
  readonly isExplicit?: boolean;
  readonly category?: MemoryCategory | string;
  readonly rawConfidence?: number;
}

/**
 * Deterministically calculates memory confidence based on source authority,
 * conversation diversity, in-session repetition with diminishing returns, and confidence ceilings.
 * Monotonic with positive corroborating evidence: B >= A.
 */
export function calculateDynamicConfidence(factors: DynamicConfidenceFactors): number {
  const isExplicit =
    Boolean(factors.isExplicit) ||
    factors.sources.includes('user_explicit') ||
    factors.sources.includes('agent_tool');

  if (isExplicit) {
    // Explicit user declaration / command
    // Base confidence for explicit declarations: 0.92
    const baseExplicit = 0.92;
    // Cross-conversation corroboration adds micro-confidence up to 0.98
    const convBonus = Math.min(3, Math.max(0, factors.conversationCount - 1)) * 0.02; // max +0.06
    const score = baseExplicit + convBonus;
    return Number(Math.min(EXPLICIT_CONFIDENCE_CEILING, Math.max(0.50, score)).toFixed(2));
  }

  // Automatic / Implicit observation
  // Base confidence for single casual mention: 0.45
  const baseImplicit = 0.45;

  // Distinct conversation diversity (up to +0.36):
  // Conv 2: +0.16 (cross-session validation)
  // Conv 3: +0.10 (solidifies consensus)
  // Conv 4: +0.06 (diminishing return)
  // Conv 5+: +0.04 (reaching ceiling)
  let convDiversityScore = 0;
  if (factors.conversationCount >= 2) convDiversityScore += 0.16;
  if (factors.conversationCount >= 3) convDiversityScore += 0.10;
  if (factors.conversationCount >= 4) convDiversityScore += 0.06;
  if (factors.conversationCount >= 5) convDiversityScore += 0.04;

  // In-session repetition with diminishing returns (up to +0.09):
  // 1st repeat: +0.04
  // 2nd repeat: +0.03
  // 3rd & 4th repeat: +0.01 each (capped at 0.09)
  const excess = Math.max(0, factors.evidenceCount - factors.conversationCount);
  let repeatBonus = 0;
  if (excess >= 1) repeatBonus += 0.04;
  if (excess >= 2) repeatBonus += 0.03;
  if (excess >= 3) repeatBonus += Math.min(2, excess - 2) * 0.01;

  const rawScore = baseImplicit + convDiversityScore + repeatBonus;
  const finalScore = Math.min(AUTOMATIC_INFERENCE_CONFIDENCE_CEILING, Math.max(0.10, rawScore));

  return Number(finalScore.toFixed(2));
}

/**
 * Phase 2.3: Dynamic Importance Calculation Model
 */
export interface DynamicImportanceFactors {
  readonly category: MemoryCategory | string;
  readonly factText: string;
  readonly isExplicit?: boolean;
  readonly source?: MemorySource;
  readonly evidenceStrength?: number;
  readonly conversationCount?: number;
}

const TRANSIENT_ROUTINE_WORDS = [
  // Arabic routine actions / daily meals / beverages / fleeting moments
  'شربت', 'باشرب', 'بشرب', 'قهوة', 'نسكافيه', 'شاي', 'عصير',
  'فطار', 'غدا', 'غداء', 'عشا', 'عشاء', 'أكلت', 'باكل', 'نمت', 'صحيت',
  'اتمشيت', 'مشوار', 'النهاردة', 'اليوم فقط', 'دلوقتي', 'حاليًا فقط',
  // English routine actions / beverages / meals
  'drank', 'drinking', 'coffee', 'tea', 'breakfast', 'lunch', 'dinner',
  'ate', 'eating', 'slept', 'woke up', 'today only', 'right now only',
];

/**
 * Deterministically calculates memory importance based on taxonomy, persistence potential,
 * explicitness, and actionable context retention value.
 * Strictly decoupled from confidence (a high confidence fact can have low importance, and vice-versa).
 */
export function calculateDynamicImportance(factors: DynamicImportanceFactors): MemoryImportance {
  const normCategory = (factors.category || '').toLowerCase();
  const text = factors.factText || '';
  const lowerText = text.toLowerCase();

  // 1. Ephemeral or transient routine event -> strictly 'low'
  if (normCategory === 'ephemeral_context') {
    return 'low';
  }
  for (const word of TRANSIENT_ROUTINE_WORDS) {
    if (lowerText.includes(word)) {
      return 'low';
    }
  }

  // 2. Core Identity -> 'high'
  if (normCategory === 'identity' || text.startsWith('اسم المستخدم:')) {
    return 'high';
  }

  // 3. Profession -> 'high'
  if (normCategory === 'profession') {
    return 'high';
  }

  // 4. Explicit long-term stable facts -> 'high'
  if (normCategory === 'stable_fact' && Boolean(factors.isExplicit)) {
    return 'high';
  }

  // 5. Technical context:
  // If strongly corroborated (conv >= 3 or strength >= 0.75) -> 'high'
  // Otherwise -> 'normal'
  if (normCategory === 'technical_context') {
    if ((factors.conversationCount ?? 0) >= 3 || (factors.evidenceStrength ?? 0) >= 0.75) {
      return 'high';
    }
    return 'normal';
  }

  // 6. Default for interests, general facts, normal studies -> 'normal'
  return 'normal';
}

/**
 * Phase 2.5 - Semantic Contradiction & Memory Evolution Types
 */

export type MemoryRelation =
  | 'supports'
  | 'contradicts'
  | 'evolves'
  | 'coexists'
  | 'unrelated'
  | 'uncertain';

export type EvolutionAction =
  | 'keep_both'
  | 'supersede_target'
  | 'evolve_target_to_historical'
  | 'no_op';

export interface SemanticRelationResult {
  readonly relation: MemoryRelation;
  readonly confidence: number;
  readonly reason: string;
  readonly signals: readonly string[];
  readonly targetMemoryId?: string;
  readonly suggestedAction: EvolutionAction;
}

/**
 * Phase 2.6 - Memory Consolidation Types
 */

export type ConsolidationAction =
  | 'merge'
  | 'reinforce'
  | 'keep_separate'
  | 'preserve_history'
  | 'no_op';

export interface ConsolidationResult {
  readonly action: ConsolidationAction;
  readonly canonicalMemoryId?: string;
  readonly mergedMemoryIds: string[];
  readonly preservedMemoryIds: string[];
  readonly reason: string;
  readonly signals: readonly string[];
  readonly consolidatedFactText?: string;
  readonly consolidatedConfidence?: number;
  readonly consolidatedImportance?: MemoryImportance;
}


