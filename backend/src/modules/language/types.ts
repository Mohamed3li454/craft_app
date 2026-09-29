/**
 * Language Intelligence Module - Core Types
 * 
 * Defines provider-agnostic, deterministic representations of language,
 * dialect, resolution tiers, and context.
 */

export type SupportedLanguage = 'ar' | 'en' | 'fr' | 'es' | 'de';
export type LanguageCode = SupportedLanguage | 'it' | 'pt' | 'tr' | 'other';

export type Dialect =
  | 'egyptian_ar'
  | 'gulf_ar'
  | 'levantine_ar'
  | 'maghrebi_ar'
  | 'iraqi_ar'
  | 'sudanese_ar'
  | 'msa_ar'
  | 'msa'
  | 'unknown';

export type ArabicDialect =
  | 'egyptian'
  | 'msa'
  | 'gulf'
  | 'levantine'
  | 'maghrebi'
  | 'iraqi'
  | 'sudanese'
  | 'unknown'
  | 'egyptian_ar'
  | 'gulf_ar'
  | 'levantine_ar'
  | 'maghrebi_ar'
  | 'iraqi_ar'
  | 'sudanese_ar'
  | 'msa_ar';

export type Register = 'casual' | 'neutral' | 'professional' | 'formal';
export type Verbosity = 'concise' | 'balanced' | 'detailed';
export type ResponseTone = 'direct' | 'warm' | 'professional' | 'supportive' | 'technical';

export type ResolutionSource =
  | 'explicit_instruction' // Tier 1: Direct user command (e.g., "كلمني بالإنجليزي", "Speak English")
  | 'current_message'      // Tier 2: Detected from current message content
  | 'recent_history'       // Tier 3: Inferred from sliding window of recent conversation turns
  | 'conversation_state'   // Tier 4: Session-level conversation language state
  | 'stored_preference'    // Tier 5: Long-term profile preference from storage/memory
  | 'neutral_fallback';    // Tier 6: Safe system neutral fallback (unbiased, non-colloquial)

export type InstructionScope = 'turn' | 'persistent';

export interface DialectSignal {
  dialect: ArabicDialect;
  confidence: number;
  confidenceBucket: 'high' | 'medium' | 'low';
  evidenceTags: string[]; // low-cardinality, privacy-safe tokens e.g. ['eg_lexical', 'eg_future_ha'], NEVER raw text or PII!
}

export interface CodeSwitchingInfo {
  isCodeSwitching: boolean;
  primaryLanguage: SupportedLanguage;
  secondaryLanguage?: SupportedLanguage;
  preservedTerms?: string[];
  preserveTechnicalTerms: boolean;
}

export interface ExplicitInstructionInfo {
  detected: boolean;
  requestedLanguage?: SupportedLanguage;
  requestedDialect?: ArabicDialect;
  requestedRegister?: Register;
  requestedVerbosity?: Verbosity;
  requestedTone?: ResponseTone;
  rawTrigger?: string;
  scope?: InstructionScope; // 'turn' = only for this single turn ("في الرسالة دي بس"), 'persistent' = for conversation
}

export interface LanguageContext {
  targetLanguage: SupportedLanguage;
  language?: SupportedLanguage; // convenient alias for targetLanguage
  dialect?: ArabicDialect;
  dialectSignal?: DialectSignal;
  dialectConfidence?: number;
  register?: Register;
  verbosity?: Verbosity;
  tone?: ResponseTone;
  codeSwitching?: CodeSwitchingInfo;
  confidence: number;
  source: ResolutionSource;
  explicitInstruction?: ExplicitInstructionInfo;
  locale: string;            // e.g. 'en-US', 'ar-EG', 'ar', 'fr-FR'
  textDirection: 'ltr' | 'rtl';
}

export type RecentMessageInput =
  | string
  | {
      role?: 'user' | 'assistant' | string;
      text?: string;
      content?: string;
      language?: SupportedLanguage;
    };

export interface ResolutionOptions {
  /**
   * Recent messages in the conversation (most recent last, or chronological)
   */
  recentMessages?: RecentMessageInput[];

  /**
   * Active conversation language state, if tracked in database or session
   */
  conversationLanguage?: SupportedLanguage;

  /**
   * Stored user profile preference (e.g. from user_profiles or long-term facts).
   * Note: This is a low-priority baseline (Tier 5) and is always overridden by
   * current message or explicit instructions.
   */
  storedPreference?: {
    language: SupportedLanguage;
    dialect?: ArabicDialect;
  };

  /**
   * Optional custom fallback for Tier 6. If omitted, defaults to neutral standard Arabic.
   */
  defaultFallback?: {
    language?: SupportedLanguage;
    dialect?: ArabicDialect;
  };
}

/**
 * Normalizes an Arabic dialect string to a canonical legacy code ('egyptian', 'gulf', etc.)
 */
export function toCanonicalDialect(dialect?: ArabicDialect | string): ArabicDialect | undefined {
  if (!dialect) return undefined;
  const clean = dialect.toLowerCase().replace(/_ar$/, '').trim();
  if (['egyptian', 'msa', 'gulf', 'levantine', 'maghrebi', 'iraqi', 'sudanese', 'unknown'].includes(clean)) {
    return clean as ArabicDialect;
  }
  return undefined;
}

/**
 * Normalizes an Arabic dialect string to the expanded Dialect format with `_ar` suffix
 */
export function toDialectCode(dialect?: ArabicDialect | string): Dialect | undefined {
  if (!dialect) return undefined;
  const canonical = toCanonicalDialect(dialect);
  if (!canonical || canonical === 'unknown' || canonical === 'msa') {
    return canonical as Dialect;
  }
  return `${canonical}_ar` as Dialect;
}

