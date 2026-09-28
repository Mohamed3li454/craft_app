/**
 * Fast Deterministic Token Counter (Phase 8.1)
 *
 * Provides sub-millisecond, zero-dependency token estimation for multilingual
 * text (Latin, Arabic, and structured code/JSON) to support dynamic context window budgeting.
 */

const ARABIC_UNICODE_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

// Average characters per token:
// - Latin / ASCII text: ~4.0 chars/token
// - Arabic text (BPE/tiktoken/Llama tokenizers): ~2.8 chars/token
// - Structured code/JSON: ~3.5 chars/token
const CHARS_PER_TOKEN_LATIN = 4.0;
const CHARS_PER_TOKEN_ARABIC = 2.8;
const PER_MESSAGE_TOKEN_OVERHEAD = 4; // Typical chat template overhead per turn

export class TokenCounter {
  /**
   * Deterministically estimates token count for a given text snippet.
   */
  public static countTokens(text: string | null | undefined): number {
    if (!text || text.length === 0) {
      return 0;
    }

    const arabicMatches = text.match(ARABIC_UNICODE_REGEX);
    const arabicChars = arabicMatches ? arabicMatches.length : 0;
    const nonArabicChars = text.length - arabicChars;

    const estimatedArabicTokens = arabicChars / CHARS_PER_TOKEN_ARABIC;
    const estimatedNonArabicTokens = nonArabicChars / CHARS_PER_TOKEN_LATIN;

    return Math.ceil(estimatedArabicTokens + estimatedNonArabicTokens);
  }

  /**
   * Estimates tokens for an array of structured messages including turn framing overhead.
   */
  public static countMessageTokens(
    messages: Array<{ role?: string; content?: string; text?: string }>
  ): number {
    if (!messages || messages.length === 0) {
      return 0;
    }

    let total = 0;
    for (const msg of messages) {
      const content = msg.content ?? msg.text ?? '';
      total += PER_MESSAGE_TOKEN_OVERHEAD + this.countTokens(content);
    }
    return total;
  }

  /**
   * Estimates maximum characters that can fit into a given token budget.
   */
  public static estimateCharLimit(tokens: number, hasArabic: boolean = false): number {
    if (tokens <= 0) return 0;
    const ratio = hasArabic ? CHARS_PER_TOKEN_ARABIC : CHARS_PER_TOKEN_LATIN;
    return Math.floor(tokens * ratio);
  }

  /**
   * Detects if the majority or significant portion of text contains Arabic script.
   */
  public static hasArabicScript(text: string | null | undefined): boolean {
    if (!text) return false;
    return ARABIC_UNICODE_REGEX.test(text);
  }
}
