import { LocalLanguageDetector } from '../cache/language_detector';
import { ExplicitInstructionDetector } from './explicit_instruction_detector';
import {
  ArabicDialect,
  LanguageContext,
  RecentMessageInput,
  ResolutionOptions,
  SupportedLanguage,
} from './types';

// Common neutral conversational acknowledgement / short punctuation tokens
const SHORT_NEUTRAL_TOKENS = new Set([
  // Latin tokens
  'ok', 'okay', 'k', 'yes', 'yep', 'yeah', 'yup', 'no', 'nope',
  'hi', 'hello', 'hey', 'cool', 'thanks', 'thank you', 'thx', 'ty',
  'why', 'why?', 'great', 'nice', 'sure', 'fine', 'got it',
  'good', 'bye', 'good morning', 'good evening', 'good night',
  // Arabic tokens
  'تمام', 'ماشي', 'اوك', 'اوكي', 'اه', 'أه', 'ايوه', 'ايوة', 'لا',
  'شكرا', 'شكراً', 'ليه', 'ليه؟', 'تسلم', 'حبيبي', 'طيب', 'نعم',
  'عفواً', 'عفوا', 'هلا', 'أهلاً', 'اهلا', 'سلام', 'مع السلامة',
  'حلو', 'كويس', 'يا هلا', 'صباح الخير', 'مساء الخير',
]);

// Arabic dialect tokens for exact boundary checking
const EGYPTIAN_DIALECT_TOKENS = [
  'ازيك', 'عامل ايه', 'عاملين ايه', 'عاوز', 'عايز', 'دلوقتي', 'كده', 'ايه ده',
  'فينك', 'معلش', 'بتاع', 'بتاعة', 'بتاعت', 'يا باشا', 'يا هندسه', 'يا فندم',
  'مش كده', 'عشان', 'اكتر', 'برضه', 'خالص', 'انهارده', 'النهارده'
];

const GULF_DIALECT_TOKENS = [
  'شلونك', 'شلونكم', 'وشلونك', 'ايش فيك', 'وش فيك', 'وينك', 'ابي', 'ابغي', 'ابغى',
  'شنو', 'وايد', 'الحين', 'تكفي', 'تكفى', 'يا الغالي', 'عساك بخير'
];

const LEVANTINE_DIALECT_TOKENS = [
  'كيفك', 'كيفكن', 'شو في', 'شو الاخبار', 'بدي', 'هيك', 'هلق', 'منيح', 'منيحه',
  'كتير', 'عم احكي', 'يا زلمه', 'شو بدك'
];

// Key carrier stopwords used in code-switching analysis
const ARABIC_CARRIER_TOKENS = new Set([
  'انا', 'محتاج', 'ممكن', 'شرح', 'عندي', 'بتاع', 'بتاعة', 'بتاعت', 'في', 'من', 'على',
  'عن', 'مع', 'ده', 'دي', 'ازاي', 'عايز', 'عاوز', 'ليه', 'عشان', 'علشان', 'كود', 'تطبيق',
  'خطأ', 'مشكلة', 'سؤال', 'هو', 'هي', 'لو', 'هل', 'اللي', 'الي'
]);

const ENGLISH_CARRIER_TOKENS = new Set([
  'the', 'is', 'are', 'was', 'were', 'am', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'how', 'what', 'why', 'when', 'where', 'which', 'who', 'can', 'could', 'would', 'should',
  'with', 'this', 'that', 'these', 'those', 'have', 'has', 'had', 'will', 'about', 'from',
  'to', 'in', 'for', 'of', 'and', 'or', 'my', 'your', 'his', 'her', 'our', 'their', 'do', 'does', 'did'
]);

export class LanguageIntelligenceService {
  private static instance: LanguageIntelligenceService;

  public static getInstance(): LanguageIntelligenceService {
    if (!LanguageIntelligenceService.instance) {
      LanguageIntelligenceService.instance = new LanguageIntelligenceService();
    }
    return LanguageIntelligenceService.instance;
  }

  /**
   * Resolves the LanguageContext for an incoming user message following
   * the strict 6-tier Priority Hierarchy:
   * 1. Explicit user language instruction
   * 2. Current message language
   * 3. Recent conversation language
   * 4. Conversation language state
   * 5. Stored user language preference
   * 6. Neutral fallback (unbiased, non-colloquial)
   */
  public resolveContext(
    message: string,
    options: ResolutionOptions = {}
  ): LanguageContext {
    const rawText = message ? message.trim() : '';

    // =========================================================================
    // TIER 1: Explicit user language instruction
    // =========================================================================
    if (rawText.length > 0) {
      const explicit = ExplicitInstructionDetector.detect(rawText);
      if (explicit.detected && explicit.requestedLanguage) {
        return this.buildContext({
          targetLanguage: explicit.requestedLanguage,
          dialect: explicit.requestedDialect,
          confidence: 0.98,
          source: 'explicit_instruction',
          explicitInstruction: explicit,
        });
      }
    }

    // =========================================================================
    // Check for Short Neutral Conversational Tokens
    // =========================================================================
    const isShortNeutral = this.isShortNeutralToken(rawText);

    // If it's a short neutral token, we consult higher-context tiers (Recent History,
    // Conversation State, or Stored Preference) to prevent aggressive switching.
    if (isShortNeutral) {
      // Try Tier 3 (Recent History)
      const recentLang = this.resolveFromRecentHistory(options.recentMessages);
      if (recentLang) {
        return this.buildContext({
          targetLanguage: recentLang,
          confidence: 0.85,
          source: 'recent_history',
        });
      }

      // Try Tier 4 (Conversation Language State)
      if (options.conversationLanguage) {
        return this.buildContext({
          targetLanguage: options.conversationLanguage,
          confidence: 0.80,
          source: 'conversation_state',
        });
      }

      // Try Tier 5 (Stored Preference)
      if (options.storedPreference?.language) {
        return this.buildContext({
          targetLanguage: options.storedPreference.language,
          dialect: options.storedPreference.dialect,
          confidence: 0.75,
          source: 'stored_preference',
        });
      }
    }

    // =========================================================================
    // TIER 2: Current message language
    // =========================================================================
    if (rawText.length > 0) {
      const charStats = this.analyzeCharacterCounts(rawText);

      // Only attempt current message detection if there are alphabetic characters
      if (charStats.totalAlpha > 0) {
        const resolution = this.resolveCurrentMessageLanguage(rawText, charStats);

        if (resolution) {
          // If detection is reliable with confidence >= 0.70
          if (resolution.confidence >= 0.70) {
            return this.buildContext({
              targetLanguage: resolution.language,
              dialect: resolution.dialect,
              confidence: resolution.confidence,
              source: 'current_message',
            });
          }

          // In low-confidence or ambiguous mixed-language scenarios:
          // Check if Recent History or Conversation State can break the ambiguity
          const recentLang = this.resolveFromRecentHistory(options.recentMessages);
          if (recentLang) {
            return this.buildContext({
              targetLanguage: recentLang,
              confidence: 0.82,
              source: 'recent_history',
            });
          }

          if (options.conversationLanguage) {
            return this.buildContext({
              targetLanguage: options.conversationLanguage,
              confidence: 0.78,
              source: 'conversation_state',
            });
          }

          // Otherwise return the detected language
          return this.buildContext({
            targetLanguage: resolution.language,
            dialect: resolution.dialect,
            confidence: resolution.confidence,
            source: 'current_message',
          });
        }
      }
    }

    // =========================================================================
    // TIER 3: Recent conversation language
    // =========================================================================
    const recentLang = this.resolveFromRecentHistory(options.recentMessages);
    if (recentLang) {
      return this.buildContext({
        targetLanguage: recentLang,
        confidence: 0.85,
        source: 'recent_history',
      });
    }

    // =========================================================================
    // TIER 4: Conversation language state
    // =========================================================================
    if (options.conversationLanguage) {
      return this.buildContext({
        targetLanguage: options.conversationLanguage,
        confidence: 0.80,
        source: 'conversation_state',
      });
    }

    // =========================================================================
    // TIER 5: Stored user language preference
    // =========================================================================
    if (options.storedPreference?.language) {
      return this.buildContext({
        targetLanguage: options.storedPreference.language,
        dialect: options.storedPreference.dialect,
        confidence: 0.75,
        source: 'stored_preference',
      });
    }

    // =========================================================================
    // TIER 6: Neutral fallback (Safe, unbiased, non-Egyptian Arabic default)
    // =========================================================================
    const fallbackLang = options.defaultFallback?.language || 'ar';
    const fallbackDialect = options.defaultFallback?.dialect; // undefined by default (neutral MSA)

    return this.buildContext({
      targetLanguage: fallbackLang,
      dialect: fallbackDialect,
      confidence: 0.50,
      source: 'neutral_fallback',
    });
  }

  /**
   * Resolves current message language with carrier structure analysis for code-switching
   */
  private resolveCurrentMessageLanguage(
    text: string,
    charStats: { arabic: number; latin: number; totalAlpha: number }
  ): { language: SupportedLanguage; dialect?: ArabicDialect; confidence: number } | null {
    const { arabic, latin, totalAlpha } = charStats;

    // Both scripts are present: Mixed Language / Code-switching
    if (arabic > 0 && latin > 0) {
      const normalizedWords = text
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،!]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 0);

      let arabicCarrierScore = 0;
      let englishCarrierScore = 0;

      for (const w of normalizedWords) {
        if (ARABIC_CARRIER_TOKENS.has(w)) {
          arabicCarrierScore++;
        }
        if (ENGLISH_CARRIER_TOKENS.has(w)) {
          englishCarrierScore++;
        }
      }

      // If Arabic carrier words clearly dominate, it's Arabic with tech terms
      if (arabicCarrierScore > englishCarrierScore) {
        return {
          language: 'ar',
          dialect: this.detectArabicDialect(text),
          confidence: 0.85,
        };
      }

      // If English carrier words clearly dominate, it's English with Arabic loan words
      if (englishCarrierScore > arabicCarrierScore) {
        return {
          language: 'en',
          confidence: 0.85,
        };
      }

      // If no carrier words or equal: inspect ratio
      const mixRatio = Math.min(arabic, latin) / totalAlpha;
      // High mix ratio in a short phrase indicates borderline ambiguity
      if (mixRatio >= 0.35 && normalizedWords.length <= 3) {
        // Borderline confidence to allow Tier 3/4 resolution
        const preliminaryLang = arabic >= latin ? 'ar' : 'en';
        return {
          language: preliminaryLang,
          dialect: preliminaryLang === 'ar' ? this.detectArabicDialect(text) : undefined,
          confidence: 0.55,
        };
      }
    }

    // Default to LocalLanguageDetector
    const detection = LocalLanguageDetector.getInstance().detect(text);
    const supported = this.toSupportedLanguage(detection.language);

    if (supported) {
      let dialect: ArabicDialect | undefined;
      if (supported === 'ar') {
        dialect = this.detectArabicDialect(text);
      }
      return {
        language: supported,
        dialect,
        confidence: detection.confidence,
      };
    }

    return null;
  }

  /**
   * Checks if the message consists solely of short neutral tokens
   * (e.g. "ok", "hi", "تمام", "ماشي", "thanks")
   */
  private isShortNeutralToken(text: string): boolean {
    if (!text) return false;
    const clean = text
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،!]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return false;

    // Direct match against known tokens
    if (SHORT_NEUTRAL_TOKENS.has(clean)) {
      return true;
    }

    // Check up to 2-word neutral phrases
    const words = clean.split(' ');
    if (words.length <= 2) {
      const allWordsNeutral = words.every((w) => SHORT_NEUTRAL_TOKENS.has(w));
      if (allWordsNeutral) return true;
    }

    return false;
  }

  /**
   * Analyzes recent message history and extracts the dominant language
   */
  private resolveFromRecentHistory(
    recentMessages?: RecentMessageInput[]
  ): SupportedLanguage | null {
    if (!recentMessages || recentMessages.length === 0) {
      return null;
    }

    // Inspect the last 5 messages
    const window = recentMessages.slice(-5);
    const votes: Record<SupportedLanguage, number> = {
      ar: 0,
      en: 0,
      fr: 0,
      es: 0,
      de: 0,
    };

    let totalVotes = 0;

    for (let i = 0; i < window.length; i++) {
      const item = window[i];
      let msgLang: SupportedLanguage | null = null;

      if (typeof item === 'string') {
        const det = LocalLanguageDetector.getInstance().detect(item);
        msgLang = this.toSupportedLanguage(det.language);
      } else if (item && typeof item === 'object') {
        if (item.language && this.toSupportedLanguage(item.language)) {
          msgLang = item.language;
        } else {
          const content = item.text || item.content || '';
          if (content.trim()) {
            const det = LocalLanguageDetector.getInstance().detect(content);
            msgLang = this.toSupportedLanguage(det.language);
          }
        }
      }

      if (msgLang) {
        // Recency weighting: more recent messages receive higher weight
        const weight = 1 + i * 0.25;
        votes[msgLang] += weight;
        totalVotes += weight;
      }
    }

    if (totalVotes === 0) {
      return null;
    }

    let dominantLang: SupportedLanguage | null = null;
    let maxWeight = 0;

    for (const [lang, weight] of Object.entries(votes)) {
      if (weight > maxWeight) {
        maxWeight = weight;
        dominantLang = lang as SupportedLanguage;
      }
    }

    // Require at least 40% dominance
    if (dominantLang && maxWeight / totalVotes >= 0.40) {
      return dominantLang;
    }

    return null;
  }

  /**
   * Detects Arabic dialects from lexical tokens using padded boundary matching
   */
  private detectArabicDialect(text: string): ArabicDialect | undefined {
    if (!text) return undefined;

    const normalized = text
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،!]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const padded = ` ${normalized} `;

    for (const token of EGYPTIAN_DIALECT_TOKENS) {
      if (padded.includes(` ${token} `)) {
        return 'egyptian';
      }
    }

    for (const token of GULF_DIALECT_TOKENS) {
      if (padded.includes(` ${token} `)) {
        return 'gulf';
      }
    }

    for (const token of LEVANTINE_DIALECT_TOKENS) {
      if (padded.includes(` ${token} `)) {
        return 'levantine';
      }
    }

    return undefined;
  }

  /**
   * Counts alphabetic characters
   */
  private analyzeCharacterCounts(text: string): {
    arabic: number;
    latin: number;
    totalAlpha: number;
  } {
    let arabic = 0;
    let latin = 0;

    for (const char of text) {
      const code = char.codePointAt(0) || 0;
      if (
        (code >= 0x0600 && code <= 0x06ff) ||
        (code >= 0x0750 && code <= 0x077f) ||
        (code >= 0x08a0 && code <= 0x08ff)
      ) {
        arabic++;
      } else if (
        (code >= 0x0041 && code <= 0x005a) ||
        (code >= 0x0061 && code <= 0x007a) ||
        (code >= 0x00c0 && code <= 0x00ff)
      ) {
        latin++;
      }
    }

    return { arabic, latin, totalAlpha: arabic + latin };
  }

  private toSupportedLanguage(lang: string): SupportedLanguage | null {
    if (['ar', 'en', 'fr', 'es', 'de'].includes(lang)) {
      return lang as SupportedLanguage;
    }
    return null;
  }

  /**
   * Constructs the LanguageContext object with locale and textDirection
   */
  private buildContext(params: {
    targetLanguage: SupportedLanguage;
    dialect?: ArabicDialect;
    confidence: number;
    source: LanguageContext['source'];
    explicitInstruction?: LanguageContext['explicitInstruction'];
  }): LanguageContext {
    const { targetLanguage, dialect, confidence, source, explicitInstruction } = params;

    let locale: string;
    let textDirection: 'ltr' | 'rtl';

    if (targetLanguage === 'ar') {
      textDirection = 'rtl';
      if (dialect === 'egyptian') {
        locale = 'ar-EG';
      } else if (dialect === 'gulf') {
        locale = 'ar-SA';
      } else if (dialect === 'levantine') {
        locale = 'ar-LB';
      } else {
        locale = 'ar'; // Neutral Standard Arabic
      }
    } else {
      textDirection = 'ltr';
      switch (targetLanguage) {
        case 'en':
          locale = 'en-US';
          break;
        case 'fr':
          locale = 'fr-FR';
          break;
        case 'es':
          locale = 'es-ES';
          break;
        case 'de':
          locale = 'de-DE';
          break;
        default:
          locale = 'en-US';
      }
    }

    return {
      targetLanguage,
      dialect,
      confidence: Number(confidence.toFixed(2)),
      source,
      explicitInstruction,
      locale,
      textDirection,
    };
  }
}
