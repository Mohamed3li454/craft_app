import {
  ExplicitInstructionInfo,
  InstructionScope,
  SupportedLanguage,
  ArabicDialect,
} from './types';

/**
 * Normalizes text for regex rule evaluation:
 * - strips Arabic diacritics (tashkeel) and tatweel
 * - normalizes alef variants (أ, إ, آ -> ا)
 * - normalizes taa marbouta (ة -> ه)
 * - normalizes alef maqsoura (ى -> ي)
 * - collapses whitespace and trims
 */
function normalizeForMatching(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    // remove diacritics
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // remove tatweel
    .replace(/\u0640/g, '')
    // normalize alef
    .replace(/[أإآ]/g, 'ا')
    // normalize taa marbouta
    .replace(/ة/g, 'ه')
    // normalize alef maqsoura
    .replace(/ى/g, 'ي')
    // normalize punct to spaces
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TURN_ONLY_PATTERNS = [
  /في\s+(?:الرساله|المسج)\s+دي\s+بس/,
  /(?:الرساله|المسج)\s+دي\s+بس/,
  /(?:بس\s+)?المره\s+دي\s+بس/,
  /لهذه\s+الرساله\s+فقط/,
  /لهذا\s+الرد\s+فقط/,
  /بس\s+في\s+السؤال\s+ده/,
  /للمره\s+دي\s+بس/,
  /مره\s+واحده\s+بس/,
  /\bfor\s+this\s+message\s+only\b/i,
  /\bjust\s+for\s+this\s+message\b/i,
  /\bthis\s+message\s+only\b/i,
  /\bthis\s+turn\s+only\b/i,
  /\bjust\s+this\s+once\b/i,
  /\bonly\s+for\s+this\s+(?:message|question)\b/i,
];

interface ExplicitPattern {
  lang: SupportedLanguage;
  dialect?: ArabicDialect;
  regex: RegExp;
}

const EXPLICIT_RULES: ExplicitPattern[] = [
  // 1. English Rules
  {
    lang: 'en',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب|خلي\s+كلامك|عاوزك\s+تكلمني|حابب\s+اتكلم|اريد\s+الكلام|تحدث)\s+(?:معايا\s+|معي\s+)?(?:بالانجليزي|بالانكليزي|انجليزي|انكليزي|انجلش|english)/i,
  },
  {
    lang: 'en',
    regex: /^(?:بالانجليزي|بالانكليزي|انجليزي|انكليزي|انجلش|english)$/i,
  },
  {
    lang: 'en',
    regex: /(?:بالانجليزي|بالانكليزي|انجلش|english)\s*(?:لو\s+سمحت|من\s+فضلك|بليز|please)/i,
  },
  {
    lang: 'en',
    regex: /(?:ممكن|عايز|عاوز|حابب|اريد|ياريت)\s+(?:تكلمني|ترد|تتكلم|تجاوب)?\s*(?:بالانجليزي|بالانكليزي|انجلش|english)/i,
  },
  {
    lang: 'en',
    regex: /\b(?:speak|talk|reply|answer|respond|write)\s+(?:in\s+)?english\b/i,
  },
  {
    lang: 'en',
    regex: /\benglish\s+(?:please|pls)\b/i,
  },
  {
    lang: 'en',
    regex: /\bin\s+english(?:\s+please)?\b/i,
  },
  {
    lang: 'en',
    regex: /\bwhy\s+(?:are\s+you\s+speaking|did\s+you\s+reply\s+in|speaking)\s+arabic\b/i,
  },
  {
    lang: 'en',
    regex: /\b(?:i\s+said|didn'?t\s+i\s+say|i\s+told\s+you\s+to)\s+speak\s+english\b/i,
  },
  {
    lang: 'en',
    regex: /\b(?:switch\s+to|use)\s+english\b/i,
  },

  // 2. Egyptian Arabic Rules
  {
    lang: 'ar',
    dialect: 'egyptian',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب|خلي\s+كلامك)\s+(?:معايا\s+|معي\s+)?(?:بالمصري|مصري|بالعاميه\s+المصريه|عاميه\s+مصريه|عربي\s+مصري)/i,
  },
  {
    lang: 'ar',
    dialect: 'egyptian',
    regex: /^(?:بالمصري|مصري|بالعاميه\s+المصريه|عاميه\s+مصريه)$/i,
  },
  {
    lang: 'ar',
    dialect: 'egyptian',
    regex: /(?:بالمصري|عاميه\s+مصريه)\s*(?:لو\s+سمحت|من\s+فضلك|بليز|please)/i,
  },
  {
    lang: 'ar',
    dialect: 'egyptian',
    regex: /(?:ممكن|عايز|عاوز|حابب|ياريت)\s+(?:تكلمني|ترد|تتكلم|تجاوب)?\s*(?:بالمصري|عاميه\s+مصريه)/i,
  },
  {
    lang: 'ar',
    dialect: 'egyptian',
    regex: /\b(?:speak|talk|reply|answer)\s+(?:in\s+)?egyptian(?:\s+arabic)?\b/i,
  },
  {
    lang: 'ar',
    dialect: 'egyptian',
    regex: /\begyptian\s+arabic(?:\s+please)?\b/i,
  },

  // 3. Modern Standard Arabic (MSA) Rules
  {
    lang: 'ar',
    dialect: 'msa',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب)\s+(?:معايا\s+|معي\s+)?(?:بالفصحي|فصحي|عربي\s+فصيح|باللغه\s+العربيه\s+الفصحي|العربيه\s+الفصحي)/i,
  },
  {
    lang: 'ar',
    dialect: 'msa',
    regex: /^(?:بالفصحي|فصحي|عربي\s+فصيح|العربيه\s+الفصحي)$/i,
  },
  {
    lang: 'ar',
    dialect: 'msa',
    regex: /(?:بالفصحي|عربي\s+فصيح|العربيه\s+الفصحي)\s*(?:لو\s+سمحت|من\s+فضلك)?/i,
  },
  {
    lang: 'ar',
    dialect: 'msa',
    regex: /(?:ممكن|عايز|عاوز|حابب|ياريت)\s+(?:تكلمني|ترد|تتكلم|تجاوب)?\s*(?:بالفصحي|عربي\s+فصيح)/i,
  },
  {
    lang: 'ar',
    dialect: 'msa',
    regex: /\b(?:speak|talk|reply)\s+(?:in\s+)?(?:msa|standard\s+arabic|modern\s+standard\s+arabic)\b/i,
  },
  {
    lang: 'ar',
    dialect: 'msa',
    regex: /\b(?:modern\s+)?standard\s+arabic(?:\s+please)?\b/i,
  },

  // 4. Gulf Arabic Rules
  {
    lang: 'ar',
    dialect: 'gulf',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب)\s+(?:معايا\s+|معي\s+)?(?:بالخليجي|خليجي|باللهجه\s+الخليجيه)/i,
  },
  {
    lang: 'ar',
    dialect: 'gulf',
    regex: /^(?:بالخليجي|خليجي|باللهجه\s+الخليجيه)$/i,
  },
  {
    lang: 'ar',
    dialect: 'gulf',
    regex: /(?:بالخليجي|اللهجه\s+الخليجيه)\s*(?:لو\s+سمحت|من\s+فضلك)?/i,
  },
  {
    lang: 'ar',
    dialect: 'gulf',
    regex: /\b(?:speak|talk|reply)\s+(?:in\s+)?(?:gulf|khaleeji)(?:\s+arabic)?\b/i,
  },

  // 5. Levantine Arabic Rules
  {
    lang: 'ar',
    dialect: 'levantine',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب)\s+(?:معايا\s+|معي\s+)?(?:بالشامي|شامي|باللهجه\s+الشاميه|لبناني|سوري)/i,
  },
  {
    lang: 'ar',
    dialect: 'levantine',
    regex: /^(?:بالشامي|شامي|باللهجه\s+الشاميه)$/i,
  },
  {
    lang: 'ar',
    dialect: 'levantine',
    regex: /(?:بالشامي|اللهجه\s+الشاميه)\s*(?:لو\s+سمحت|من\s+فضلك)?/i,
  },
  {
    lang: 'ar',
    dialect: 'levantine',
    regex: /\b(?:speak|talk|reply)\s+(?:in\s+)?(?:levantine|shami)(?:\s+arabic)?\b/i,
  },

  // 6. French Rules
  {
    lang: 'fr',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب)\s+(?:معايا\s+|معي\s+)?(?:بالفرنساوي|فرنساوي|بالفرنسي|فرنسي|بالفرنسيه)/i,
  },
  {
    lang: 'fr',
    regex: /^(?:بالفرنساوي|فرنساوي|بالفرنسي|فرنسي|بالفرنسيه)$/i,
  },
  {
    lang: 'fr',
    regex: /(?:بالفرنساوي|بالفرنسيه|بالفرنسي)\s*(?:لو\s+سمحت|من\s+فضلك)?/i,
  },
  {
    lang: 'fr',
    regex: /\b(?:speak|talk|reply)\s+(?:in\s+)?french\b/i,
  },
  {
    lang: 'fr',
    regex: /\b(?:parle|parlez)\s+fran[çc]ais\b/i,
  },
  {
    lang: 'fr',
    regex: /\b(?:en\s+fran[çc]ais|french\s+please)\b/i,
  },

  // 7. German Rules
  {
    lang: 'de',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب)\s+(?:معايا\s+|معي\s+)?(?:بالالماني|الماني|باللغه\s+الالمانيه)/i,
  },
  {
    lang: 'de',
    regex: /^(?:بالالماني|الماني)$/i,
  },
  {
    lang: 'de',
    regex: /(?:بالالماني)\s*(?:لو\s+سمحت|من\s+فضلك)?/i,
  },
  {
    lang: 'de',
    regex: /\b(?:speak|talk|reply)\s+(?:in\s+)?german\b/i,
  },
  {
    lang: 'de',
    regex: /\bsprechen\s+sie\s+deutsch\b/i,
  },
  {
    lang: 'de',
    regex: /\b(?:auf\s+deutsch|german\s+please)\b/i,
  },

  // 8. Spanish Rules
  {
    lang: 'es',
    regex: /(?:كلمني|اتكلم|تكلم|خليك|رد|اكتب|جاوب)\s+(?:معايا\s+|معي\s+)?(?:بالاسباني|اسباني|باللغه\s+الاسبانيه)/i,
  },
  {
    lang: 'es',
    regex: /^(?:بالاسباني|اسباني)$/i,
  },
  {
    lang: 'es',
    regex: /(?:بالاسباني)\s*(?:لو\s+سمحت|من\s+فضلك)?/i,
  },
  {
    lang: 'es',
    regex: /\b(?:speak|talk|reply)\s+(?:in\s+)?spanish\b/i,
  },
  {
    lang: 'es',
    regex: /\bhabla\s+espa[ñn]ol\b/i,
  },
  {
    lang: 'es',
    regex: /\b(?:en\s+espa[ñn]ol|spanish\s+please)\b/i,
  },
];

export class ExplicitInstructionDetector {
  /**
   * Evaluates whether the incoming user message contains an explicit request
   * to communicate in a specific language or dialect.
   */
  public static detect(text: string): ExplicitInstructionInfo {
    if (!text || !text.trim()) {
      return { detected: false };
    }

    const normalized = normalizeForMatching(text);
    if (!normalized) {
      return { detected: false };
    }

    // Determine scope
    let scope: InstructionScope = 'persistent';
    for (const scopePattern of TURN_ONLY_PATTERNS) {
      if (scopePattern.test(normalized)) {
        scope = 'turn';
        break;
      }
    }

    // Match rules
    for (const rule of EXPLICIT_RULES) {
      const match = normalized.match(rule.regex);
      if (match) {
        return {
          detected: true,
          requestedLanguage: rule.lang,
          requestedDialect: rule.dialect,
          rawTrigger: match[0],
          scope,
        };
      }
    }

    return { detected: false };
  }
}
