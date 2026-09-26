/**
 * Core type definitions for Craft Personality Engine (Phase 3.1)
 *
 * Strictly decoupled from LanguageContext, database, LLM provider, or heuristics.
 */

export type ToneAttribute = 'warm' | 'professional' | 'direct' | 'empathetic';
export type FormalityLevel = 'formal' | 'consultative' | 'casual';
export type VerbosityLevel = 'concise' | 'balanced' | 'comprehensive';
export type AddressingStyle = 'none' | 'first_name' | 'respectful';
export type EmojiPolicy = 'none' | 'minimal' | 'expressive';
export type HumorLevel = 'none' | 'subtle';
export type ProactivityLevel = 'direct_answer' | 'suggest_next_step';

/**
 * Immutable context defining HOW Craft communicates.
 */
export interface PersonalityContext {
  /** Multi-attribute tone baseline: e.g. ['warm', 'professional', 'direct'] */
  readonly tone: readonly ToneAttribute[];
  /** Level of communication formality */
  readonly formality: FormalityLevel;
  /** Response verbosity baseline */
  readonly verbosity: VerbosityLevel;
  /** How Craft addresses the user (policy only, never hardcoded slang) */
  readonly addressingStyle: AddressingStyle;
  /** Permitted emoji usage density (policy only, no literal emojis) */
  readonly emojiPolicy: EmojiPolicy;
  /** Degree of humor allowed */
  readonly humorLevel: HumorLevel;
  /** Proactivity mode (direct answer vs proactive follow-ups) */
  readonly proactivity: ProactivityLevel;
}

/**
 * Optional explicit user or caller preferences.
 * Only explicit overrides are respected; no heuristics or inference.
 */
export interface ExplicitPersonalityPreference {
  readonly tone?: ToneAttribute | readonly ToneAttribute[];
  readonly formality?: FormalityLevel;
  readonly verbosity?: VerbosityLevel;
  readonly addressingStyle?: AddressingStyle;
  readonly emojiPolicy?: EmojiPolicy;
  readonly humorLevel?: HumorLevel;
  readonly proactivity?: ProactivityLevel;
}

export interface PersonalityResolutionOptions {
  readonly explicitPreference?: ExplicitPersonalityPreference;
}

/**
 * Default Craft Personality Baseline:
 * - tone: ['warm', 'professional', 'direct']
 * - formality: 'consultative'
 * - verbosity: 'balanced'
 * - addressingStyle: 'none'
 * - emojiPolicy: 'minimal'
 * - humorLevel: 'none'
 * - proactivity: 'direct_answer'
 */
export const DEFAULT_CRAFT_PERSONALITY: PersonalityContext = Object.freeze({
  tone: Object.freeze(['warm', 'professional', 'direct'] as const),
  formality: 'consultative',
  verbosity: 'balanced',
  addressingStyle: 'none',
  emojiPolicy: 'minimal',
  humorLevel: 'none',
  proactivity: 'direct_answer',
});
