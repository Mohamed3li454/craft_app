/**
 * Text Normalizer for Smart Multilingual Semantic Cache.
 * 
 * Provides deterministic, high-speed (<0.2ms) text normalization while
 * strictly preserving the original raw message for contextual logging and response formatting.
 */

export interface NormalizedText {
  original: string;
  normalized: string;
  tokens: string[];
}

export function collapseRepeatedChars(text: string): string {
  if (!text) return '';

  // 1. Handle common conversational elongated words
  let result = text
    .replace(/\bhel+o+\b/gi, 'hello')
    .replace(/\bso+\b/gi, 'so')
    .replace(/\bhey+\b/gi, 'hey')
    .replace(/\bhi+\b/gi, 'hi')
    .replace(/\bple+a+s+e*\b/gi, 'please')
    .replace(/\bpl+z+\b/gi, 'please')
    .replace(/\byes+\b/gi, 'yes')
    .replace(/\bno+\b/gi, 'no')
    .replace(/\btha+n+k+s*\b/gi, 'thanks');

  // 2. Arabic letter elongation: collapse 3 or more repeated vowels/letters (preserve legitimate double letters like صمم)
  result = result.replace(/([اويبتثجحخدذرزسشصضطظعغفقكلمنه])\1{2,}/gu, '$1');

  // 3. General fallback: collapse 3 or more identical characters into 1
  return result.replace(/(.)\1{2,}/gu, '$1');
}

/**
 * Strips emojis and graphical symbols from a string.
 */
export function removeEmojis(text: string): string {
  if (!text) return '';
  return text
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu,
      ' '
    )
    .replace(/[\uFE00-\uFE0F]/g, ''); // Variation selectors
}

/**
 * Normalizes Arabic orthographic variants, removing diacritics, tatweel,
 * and canonicalizing alef, taa marbouta, and yaa.
 */
export function normalizeArabicVariants(text: string): string {
  if (!text) return '';
  return text
    // Remove Arabic diacritics / tashkeel
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Remove tatweel (kashida)
    .replace(/\u0640/g, '')
    // Canonicalize alef variants: أ, إ, آ, ٱ -> ا
    .replace(/[أإآٱ]/g, 'ا')
    // Canonicalize taa marbouta: ة -> ه
    .replace(/ة/g, 'ه')
    // Canonicalize yaa / alif maqsura: ى -> ي
    .replace(/ى/g, 'ي')
    // Canonicalize waw with hamza: ؤ -> و
    .replace(/ؤ/g, 'و')
    // Canonicalize hamza on nabra: ئ -> ي
    .replace(/ئ/g, 'ي');
}

/**
 * Normalizes common English contractions to simplified unpunctuated tokens.
 */
export function normalizeEnglishContractions(text: string): string {
  if (!text) return '';
  return text
    .replace(/\bcan['’]t\b/gi, 'cannot')
    .replace(/\bwon['’]t\b/gi, 'will not')
    .replace(/\bn['’]t\b/gi, ' not')
    .replace(/['’]re\b/gi, ' are')
    .replace(/['’]s\b/gi, ' is')
    .replace(/['’]d\b/gi, ' would')
    .replace(/['’]ll\b/gi, ' will')
    .replace(/['’]ve\b/gi, ' have')
    .replace(/['’]m\b/gi, ' am');
}

/**
 * Comprehensive normalizer function.
 * Produces clean normalized text without mutating the raw original.
 */
export function normalizeMessage(raw: string): NormalizedText {
  const original = raw || '';
  if (!original.trim()) {
    return {
      original,
      normalized: '',
      tokens: [],
    };
  }

  // 1. Lowercase
  let text = original.toLowerCase();

  // 2. Remove emojis
  text = removeEmojis(text);

  // 3. Normalize English contractions
  text = normalizeEnglishContractions(text);

  // 4. Normalize Arabic variants (alef, tashkeel, etc.)
  text = normalizeArabicVariants(text);

  // 5. Collapse repeated elongation characters
  text = collapseRepeatedChars(text);

  // 6. Strip punctuation and symbols (retain letters, digits, and spaces)
  text = text.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  // 7. Collapse whitespace and trim
  text = text.replace(/\s+/g, ' ').trim();

  // 8. Generate clean token array
  const tokens = text.length > 0 ? text.split(' ').filter(Boolean) : [];

  return {
    original,
    normalized: text,
    tokens,
  };
}

export class TextNormalizer {
  public static normalize(text: string): string {
    return normalizeMessage(text).normalized;
  }

  public static tokenize(text: string): string[] {
    return normalizeMessage(text).tokens;
  }
}

