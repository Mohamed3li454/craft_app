import { normalizeMessage } from '../text_normalizer';

export interface SanitizedExampleResult {
  sanitized: string;
  isValid: boolean;
  wasModified: boolean;
}

// Conversational and dialectal noise prefixes to strip (e.g. "يا باشا لو سمحت قولي...")
const CONVERSATIONAL_PREFIXES = [
  /^(يا\s*(باشا|غالي|هندسة|ريس|فندم|كرافت|كابتن|عم|أستاذ|استاذ))\s*,?\s*/i,
  /^(لو\s*سمحت|من\s*فضلك|بالله\s*عليك|بعد\s*اذنك|بعد\s*إذنك)\s*,?\s*/i,
  /^(ممكن\s*(تقولي|تقول\s*لي|اعرف|أعرف|توضح\s*لي|تفهمني))\s*/i,
  /^(عايز\s*(اعرف|أعرف|اسأل|أسأل|افهم|أفهم))\s*/i,
  /^(كنت\s*(عايز\s*اعرف|بسأل|عايز\s*اسأل))\s*/i,
  /^(قولي|قول\s*لي|قل\s*لي|وضح\s*لي|اشرح\s*لي)\s*,?\s*/i,
  /^(tell\s*me|explain\s*to\s*me)\s*,?\s*/i,
  /^(أنا\s*اسمي|اسمي|معاك|أنا)\s+[\p{L}]+\s*,?\s*/iu,
  /^(hello|hi|hey|dear\s*craft|please|could\s*you\s*tell\s*me|can\s*you\s*tell\s*me|i\s*want\s*to\s*ask)\s*,?\s*/i,
];

// Conversational pleasantries at the end (e.g. "...شكراً جزيلاً")
const CONVERSATIONAL_SUFFIXES = [
  /\s*(شكرا[ً]?\s*جزيلا[ً]?|شكرا[ً]?|تسلم[لي]*|الف\s*شكر|ألف\s*شكر|مشكور|الله\s*يخليك|يا\s*(غالي|باشا|ريس|فندم))\s*[\.!\؟\?]*$/i,
  /\s*(thanks\s*(a\s*lot)?|thank\s*you\s*(very\s*much)?|thx|cheers|appreciate\s*it)\s*[\.!\؟\?]*$/i,
];

// Specific digits sequences (like order numbers, tracking numbers, IDs)
const SPECIFIC_NUMBER_PATTERNS = /\b\d{3,}\b/g;

// Email and Phone regexes for defense-in-depth redaction
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_REGEX = /(?:\+?20|0)?1[0125]\d{8}\b|\b\d{10,14}\b/g;

export class ExampleSanitizer {
  /**
   * Deterministically sanitizes, redacts, and generalizes user queries
   * into clean, anonymous, canonical FAQ question examples.
   *
   * STRICT PRIVACY GUARANTEES:
   * - Strips conversational personal names, greetings, and dialectal prefixes.
   * - Strips trailing pleasantries.
   * - Redacts any phone numbers, email addresses, or specific ID sequences.
   * - Normalizes whitespace and punctuation.
   * - Returns isValid: false if resulting query is too short or corrupted.
   */
  public static sanitize(rawText: string): SanitizedExampleResult {
    if (!rawText || !rawText.trim()) {
      return { sanitized: '', isValid: false, wasModified: false };
    }

    let text = rawText.trim();
    const original = text;

    // 1. Defense-in-depth: Redact emails and phone numbers
    text = text.replace(EMAIL_REGEX, '');
    text = text.replace(PHONE_REGEX, '');
    text = text.replace(SPECIFIC_NUMBER_PATTERNS, '');

    // 2. Iteratively strip conversational prefixes
    let prefixMatched = true;
    let iterations = 0;
    while (prefixMatched && iterations < 6) {
      prefixMatched = false;
      iterations++;
      for (const prefix of CONVERSATIONAL_PREFIXES) {
        if (prefix.test(text)) {
          text = text.replace(prefix, '').trim();
          prefixMatched = true;
        }
      }
    }

    // 3. Iteratively strip conversational suffixes (pleasantries)
    let suffixMatched = true;
    let sIterations = 0;
    while (suffixMatched && sIterations < 6) {
      suffixMatched = false;
      sIterations++;
      for (const suffix of CONVERSATIONAL_SUFFIXES) {
        if (suffix.test(text)) {
          text = text.replace(suffix, '').trim();
          suffixMatched = true;
        }
      }
    }

    // 4. Remove emojis and extraneous punctuation
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu, '');
    text = text.replace(/[\!؟\?\.،,;:]+/g, ' ').replace(/\s+/g, ' ').trim();

    // 5. Ensure final question mark for canonical question formatting
    const isArabic = /[\u0600-\u06FF]/.test(text);
    if (text.length > 0) {
      text = isArabic ? `${text}؟` : `${text}?`;
    }

    // 6. Validation
    // A clean generalized example must have at least 2 distinct words and >= 8 characters
    const words = text.split(' ').filter(Boolean);
    const isValid = words.length >= 2 && text.length >= 8;

    return {
      sanitized: text,
      isValid,
      wasModified: text !== original,
    };
  }
}
