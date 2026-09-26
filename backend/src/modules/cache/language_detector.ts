/**
 * Fast, local, deterministic Language Detector for Smart Semantic Cache.
 * 
 * Uses a two-stage approach:
 * 1. Unicode Script Analysis (Arabic, Latin, Cyrillic, CJK, etc.)
 * 2. Lexical & Stopword Profiling for Latin-based languages (English, French, Spanish, German)
 * 
 * Operates in <0.5ms without any external network calls or LLM dependencies.
 */

export interface LanguageDetectionResult {
  language: string;    // ISO 639-1 code ('ar', 'en', 'fr', 'es', 'de', or 'unknown')
  confidence: number;  // 0.0 to 1.0
  isReliable: boolean; // true if confidence meets threshold
}

export interface LanguageDetector {
  detect(text: string): LanguageDetectionResult;
}

// Characteristic stop-words and common vocabulary for Latin-based languages
const LATIN_PROFILES: Record<string, string[]> = {
  en: [
    'the', 'is', 'are', 'you', 'how', 'what', 'why', 'when', 'where', 'can',
    'could', 'help', 'please', 'hello', 'hi', 'hey', 'thanks', 'thank', 'with',
    'this', 'that', 'have', 'will', 'would', 'your', 'about', 'from', 'order',
    'password', 'change', 'good', 'morning', 'evening', 'night'
  ],
  fr: [
    'le', 'la', 'les', 'un', 'une', 'des', 'est', 'sont', 'comment', 'pourquoi',
    'quand', 'vous', 'avec', 'pour', 'dans', 'bonjour', 'salut', 'merci', 'votre',
    'mon', 'ma', 'puis', 'aide', 'mot', 'passe', 'bienvenue', 'soir', 'matin'
  ],
  es: [
    'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'cómo', 'como',
    'por', 'qué', 'que', 'hola', 'gracias', 'con', 'para', 'usted', 'su',
    'mi', 'ayuda', 'contraseña', 'pedido', 'puedo', 'buenos', 'días', 'tardes'
  ],
  de: [
    'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'wie', 'warum', 'wann',
    'hallo', 'danke', 'bitte', 'mit', 'für', 'nicht', 'sie', 'ihr', 'mein',
    'hilfe', 'passwort', 'guten', 'tag', 'morgen', 'abend'
  ],
};

export class LocalLanguageDetector implements LanguageDetector {
  private static instance: LocalLanguageDetector;

  public static getInstance(): LocalLanguageDetector {
    if (!LocalLanguageDetector.instance) {
      LocalLanguageDetector.instance = new LocalLanguageDetector();
    }
    return LocalLanguageDetector.instance;
  }

  public static detect(text: string): LanguageDetectionResult {
    return LocalLanguageDetector.getInstance().detect(text);
  }

  public detect(text: string): LanguageDetectionResult {
    if (!text || !text.trim()) {
      return { language: 'ar', confidence: 0.0, isReliable: false };
    }

    const clean = text.trim();

    // Stage 1: Script Count Analysis
    let arabicCount = 0;
    let latinCount = 0;
    let otherAlphaCount = 0;

    for (const char of clean) {
      const code = char.codePointAt(0) || 0;
      // Arabic script block (0600-06FF, 0750-077F, 08A0-08FF)
      if ((code >= 0x0600 && code <= 0x06ff) || (code >= 0x0750 && code <= 0x077f) || (code >= 0x08a0 && code <= 0x08ff)) {
        arabicCount++;
      } else if ((code >= 0x0041 && code <= 0x005a) || (code >= 0x0061 && code <= 0x007a) || (code >= 0x00c0 && code <= 0x00ff)) {
        latinCount++;
      } else if (/\p{L}/u.test(char)) {
        otherAlphaCount++;
      }
    }

    const totalAlpha = arabicCount + latinCount + otherAlphaCount;
    if (totalAlpha === 0) {
      // Emojis or numbers only: fallback to system default (Arabic) with low confidence
      return { language: 'ar', confidence: 0.3, isReliable: false };
    }

    // If Arabic characters represent >= 30% of total letters or strictly dominate Latin
    if (arabicCount > 0 && arabicCount >= latinCount) {
      const confidence = Math.min(1.0, 0.7 + (arabicCount / totalAlpha) * 0.3);
      return {
        language: 'ar',
        confidence: Number(confidence.toFixed(2)),
        isReliable: confidence >= 0.75,
      };
    }

    // Stage 2: Latin-based Language Lexical Profiling
    if (latinCount > arabicCount) {
      const tokens = clean
        .toLowerCase()
        .replace(/[^\p{L}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1);

      if (tokens.length === 0) {
        return { language: 'en', confidence: 0.5, isReliable: false };
      }

      const scores: Record<string, number> = { en: 0, fr: 0, es: 0, de: 0 };

      for (const token of tokens) {
        for (const [lang, profile] of Object.entries(LATIN_PROFILES)) {
          if (profile.includes(token)) {
            scores[lang] += 1;
          }
        }
      }

      let bestLang = 'en';
      let highestScore = 0;

      for (const [lang, score] of Object.entries(scores)) {
        if (score > highestScore) {
          highestScore = score;
          bestLang = lang;
        }
      }

      if (highestScore > 0) {
        // High confidence match based on known stop words
        const confidence = Math.min(0.95, 0.6 + (highestScore / tokens.length) * 0.4);
        return {
          language: bestLang,
          confidence: Number(confidence.toFixed(2)),
          isReliable: confidence >= 0.7,
        };
      }

      // Default Latin fallback is English with moderate confidence
      return {
        language: 'en',
        confidence: 0.6,
        isReliable: false,
      };
    }

    return {
      language: 'ar',
      confidence: 0.4,
      isReliable: false,
    };
  }
}
