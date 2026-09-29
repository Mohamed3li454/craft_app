import {
  CodeSwitchingInfo,
  Register,
  ResponseTone,
  SupportedLanguage,
  Verbosity,
} from './types';

// Common technical vocabulary that should be preserved and indicate technical tone
const TECHNICAL_TERMS = [
  'flutter', 'dart', 'supabase', 'firebase', 'api', 'rest', 'graphql',
  'bloc', 'cubit', 'provider', 'riverpod', 'repository', 'architecture',
  'clean architecture', 'dependency injection', 'di', 'service locator',
  'async', 'await', 'stream', 'future', 'widget', 'stateful', 'stateless',
  'github', 'vercel', 'git', 'npm', 'pipeline', 'docker', 'json', 'http',
  'database', 'postgres', 'sqlite', 'schema', 'migration', 'refactor',
  'unit test', 'integration test', 'mock', 'tdd', 'endpoint', 'webhook'
];

/**
 * Normalizes text for style token matching:
 * - strips Arabic diacritics / tashkeel and tatweel
 * - normalizes alef variants (أ, إ, آ -> ا)
 * - normalizes taa marbouta (ة -> ه)
 * - normalizes alef maqsoura (ى -> ي)
 * - collapses punctuation and whitespace
 */
function normalizeForStyle(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // tashkeel
    .replace(/\u0640/g, '')               // tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،!«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface StyleAnalysisResult {
  register: Register;
  verbosity: Verbosity;
  tone: ResponseTone;
  codeSwitching: CodeSwitchingInfo;
}

export class StyleDetector {
  /**
   * Analyzes an input message to identify Register, Verbosity, Tone,
   * and Code-Switching dimensions.
   */
  public static analyze(
    text: string,
    primaryLanguage: SupportedLanguage = 'ar'
  ): StyleAnalysisResult {
    const raw = text ? text.trim() : '';
    const normalized = normalizeForStyle(raw);

    const register = this.detectRegister(normalized, raw);
    const verbosity = this.detectVerbosity(normalized, raw);
    const tone = this.detectTone(normalized, raw, register);
    const codeSwitching = this.detectCodeSwitching(raw, primaryLanguage);

    return {
      register,
      verbosity,
      tone,
      codeSwitching,
    };
  }

  /**
   * Detects conversational register ('casual' | 'neutral' | 'professional' | 'formal')
   */
  public static detectRegister(normalizedText: string, rawText = ''): Register {
    if (!normalizedText && !rawText) return 'neutral';
    const padded = ` ${normalizedText} `;

    // 1. Formal checks
    const formalTokens = [
      'نحيطكم علما', 'اود الاستفسار', 'مع فائق الاحترام', 'تحيه طيبه وبعد',
      'برجاء التكرم', 'حضراتكم', 'نرجو منكم', 'السيد المحترم', 'بالاشاره الي',
      'رسمي', 'بشكل رسمي'
    ];
    for (const token of formalTokens) {
      if (padded.includes(` ${token} `)) {
        return 'formal';
      }
    }
    if (/\b(?:dear\s+sir|dear\s+madam|hereby|furthermore|with\s+due\s+respect|sincerely|formally|formal)\b/i.test(rawText)) {
      return 'formal';
    }

    // 2. Casual checks
    const casualTokens = [
      'بص', 'ازيك', 'عامل ايه', 'يا عم', 'يا باشا', 'يا صاحبي', 'كده ليه',
      'شغال ولا ايه', 'براحتك', 'زي الفل', 'ولا يهمك', 'قشطه', 'واقع ليه'
    ];
    for (const token of casualTokens) {
      if (padded.includes(` ${token} `)) {
        return 'casual';
      }
    }
    if (/\b(?:hey|sup|yo|what'?s\s+up|bro|dude|lol|gonna|wanna|casual)\b/i.test(rawText)) {
      return 'casual';
    }

    // 3. Professional checks
    const professionalTokens = [
      'ممكن توضيح', 'شكرا جزيلا', 'تحليل تقني', 'هل يمكن مراجعه', 'يرجي بيان',
      'افضل الممارسات', 'مهني', 'بشكل احترافي', 'توضيح معماري'
    ];
    for (const token of professionalTokens) {
      if (padded.includes(` ${token} `)) {
        return 'professional';
      }
    }
    if (/\b(?:could\s+you\s+explain|please\s+provide|technical\s+analysis|best\s+practices|architecture|recommendation|professional)\b/i.test(rawText)) {
      return 'professional';
    }

    return 'neutral';
  }

  /**
   * Detects desired verbosity ('concise' | 'balanced' | 'detailed')
   */
  public static detectVerbosity(normalizedText: string, rawText = ''): Verbosity {
    if (!normalizedText && !rawText) return 'balanced';
    const padded = ` ${normalizedText} `;

    // 1. Concise patterns
    const conciseTokens = [
      'اختصر', 'بالمختصر', 'مختصر', 'في سطرين', 'علي السريع', 'ملخص',
      'باختصار', 'موجز', 'بدون تطويل', 'نقاط فقط'
    ];
    for (const token of conciseTokens) {
      if (padded.includes(` ${token} `)) {
        return 'concise';
      }
    }
    if (/\b(?:be\s+concise|concise|briefly|short\s+answer|tl;?dr|keep\s+it\s+(?:short|concise)|one\s+line|in\s+two\s+lines|bullet\s+points\s+only)\b/i.test(rawText)) {
      return 'concise';
    }

    // 2. Detailed patterns
    const detailedTokens = [
      'اشرح بالتفصيل', 'فهمني خطوه خطوه', 'شرح مفصل', 'بالتفصيل الممل',
      'مع كل الخطوات', 'كل التفاصيل', 'استفض', 'باستفاضه', 'تعمق'
    ];
    for (const token of detailedTokens) {
      if (padded.includes(` ${token} `)) {
        return 'detailed';
      }
    }
    if (/\b(?:explain\s+in\s+detail|detailed|step\s+by\s+step|thoroughly|in-?depth|comprehensive|deep\s+dive|elaborate)\b/i.test(rawText)) {
      return 'detailed';
    }

    return 'balanced';
  }

  /**
   * Detects response tone ('direct' | 'warm' | 'professional' | 'supportive' | 'technical')
   */
  public static detectTone(normalizedText: string, rawText: string, register: Register): ResponseTone {
    if (!normalizedText && !rawText) return 'professional';
    const padded = ` ${normalizedText} `;

    // 1. Direct tone markers
    const directTokens = ['علي طول', 'مباشره'];
    for (const token of directTokens) {
      if (padded.includes(` ${token} `)) {
        return 'direct';
      }
    }
    if (/(?:جاوب\s+(?:علي\s+طول|مباشره))|\b(?:direct|quick\s+answer|straight\s+to\s+the\s+point)\b/i.test(rawText)) {
      return 'direct';
    }

    // 2. Supportive tone markers
    const supportiveTokens = ['مش فاهم', 'محتاج مساعده', 'معقده', 'كود واقع', 'محتار', 'مش عارف احلها'];
    for (const token of supportiveTokens) {
      if (padded.includes(` ${token} `)) {
        return 'supportive';
      }
    }
    if (/\b(?:i\s+am\s+(?:stuck|confused)|help\s+me\s+please|can'?t\s+figure\s+out)\b/i.test(rawText)) {
      return 'supportive';
    }

    // 3. Warm tone markers
    const warmTokens = ['صباح الخير', 'مساء الخير', 'تسلم يا غالي', 'شكرا يا كرافت', 'يا هلا', 'احبك'];
    for (const token of warmTokens) {
      if (padded.includes(` ${token} `)) {
        return 'warm';
      }
    }
    if (/\b(?:thank\s+you\s+so\s+much|glad\s+to\s+chat|have\s+a\s+wonderful\s+day)\b/i.test(rawText)) {
      return 'warm';
    }

    // 4. Technical tone markers
    for (const tech of TECHNICAL_TERMS) {
      const reg = new RegExp(`\\b${tech}\\b`, 'i');
      if (reg.test(rawText)) {
        return 'technical';
      }
    }

    if (register === 'formal' || register === 'professional') {
      return 'professional';
    }

    return 'professional';
  }

  /**
   * Evaluates code-switching (e.g. Arabic carrier sentence with English technical terms).
   * Identifies preserved terms and ensures strict technical identifier preservation.
   */
  public static detectCodeSwitching(
    text: string,
    primaryLanguage: SupportedLanguage
  ): CodeSwitchingInfo {
    if (!text || !text.trim()) {
      return {
        isCodeSwitching: false,
        primaryLanguage,
        preserveTechnicalTerms: true,
      };
    }

    const hasArabic = /[\u0600-\u06FF]/.test(text);
    const hasLatin = /[a-zA-Z]/.test(text);

    const preservedTerms: string[] = [];
    const lower = text.toLowerCase();

    for (const term of TECHNICAL_TERMS) {
      const regex = new RegExp(`\\b${term}\\b`, 'i');
      if (regex.test(lower)) {
        preservedTerms.push(term);
      }
    }

    // If both scripts are present
    if (hasArabic && hasLatin) {
      let arabicCount = 0;
      let latinCount = 0;
      for (const char of text) {
        const code = char.codePointAt(0) || 0;
        if ((code >= 0x0600 && code <= 0x06ff) || (code >= 0x0750 && code <= 0x077f)) {
          arabicCount++;
        } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
          latinCount++;
        }
      }

      const isPredominantlyArabic = arabicCount >= latinCount;
      const primary: SupportedLanguage = isPredominantlyArabic ? 'ar' : 'en';
      const secondary: SupportedLanguage = isPredominantlyArabic ? 'en' : 'ar';

      // Extract standalone terms in the other language
      if (isPredominantlyArabic) {
        const latinWords = text.match(/\b[A-Za-z][A-Za-z0-9_-]*\b/g) || [];
        for (const w of latinWords) {
          if (!preservedTerms.includes(w.toLowerCase()) && w.length >= 2) {
            preservedTerms.push(w);
          }
        }
      }

      return {
        isCodeSwitching: true,
        primaryLanguage: primary,
        secondaryLanguage: secondary,
        preservedTerms,
        preserveTechnicalTerms: true,
      };
    }

    // If English text with some Arabic phrases
    if (hasLatin && hasArabic && primaryLanguage === 'en') {
      return {
        isCodeSwitching: true,
        primaryLanguage: 'en',
        secondaryLanguage: 'ar',
        preservedTerms,
        preserveTechnicalTerms: true,
      };
    }

    return {
      isCodeSwitching: false,
      primaryLanguage,
      preservedTerms: preservedTerms.length > 0 ? preservedTerms : undefined,
      preserveTechnicalTerms: true,
    };
  }
}
