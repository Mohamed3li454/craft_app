/**
 * Language Intelligence Module - Core Types
 * 
 * Defines provider-agnostic, deterministic representations of language,
 * dialect, resolution tiers, and context.
 */

export type SupportedLanguage = 'ar' | 'en' | 'fr' | 'es' | 'de';

export type ArabicDialect = 'egyptian' | 'msa' | 'gulf' | 'levantine';

export type ResolutionSource =
  | 'explicit_instruction' // Tier 1: Direct user command (e.g., "كلمني بالإنجليزي", "Speak English")
  | 'current_message'      // Tier 2: Detected from current message content
  | 'recent_history'       // Tier 3: Inferred from sliding window of recent conversation turns
  | 'conversation_state'   // Tier 4: Session-level conversation language state
  | 'stored_preference'    // Tier 5: Long-term profile preference from storage/memory
  | 'neutral_fallback';    // Tier 6: Safe system neutral fallback (unbiased, non-colloquial)

export type InstructionScope = 'turn' | 'persistent';

export interface ExplicitInstructionInfo {
  detected: boolean;
  requestedLanguage?: SupportedLanguage;
  requestedDialect?: ArabicDialect;
  rawTrigger?: string;
  scope?: InstructionScope; // 'turn' = only for this single turn ("في الرسالة دي بس"), 'persistent' = for conversation
}

export interface LanguageContext {
  targetLanguage: SupportedLanguage;
  dialect?: ArabicDialect;
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
