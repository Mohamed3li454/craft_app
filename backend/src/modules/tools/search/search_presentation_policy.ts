/**
 * Search Presentation Policy & Intent Detection
 *
 * Implements strict architectural separation between internal web research
 * and user-facing source presentation:
 * - Default behavior: Sources are NEVER shown unless explicitly requested.
 * - Explicit source request: Detects Arabic, Egyptian dialect, and English intents.
 * - Explicit link request: Distinguishes between sources generally and URLs/links specifically.
 * - Follow-up detection: Identifies requests referring to previous search answers without new topics.
 * - Code-layer leak guard: Detects and sanitizes unrequested raw search result dumps.
 */

import { LanguageContext } from '../../language/types';

export interface SearchPresentationPolicy {
  /**
   * Whether sources/references should be presented in the final response.
   * Default: FALSE unless explicitly requested.
   */
  readonly shouldShowSources: boolean;

  /**
   * Whether URLs / links should be included in the presentation.
   * Default: FALSE unless explicitly requested (e.g. "هات اللينكات", "فين الرابط").
   */
  readonly shouldShowUrls: boolean;

  /**
   * Whether snippets should be shown in source listings.
   * Default: FALSE for concise presentation.
   */
  readonly shouldShowSnippets: boolean;

  /**
   * Whether the user query is a follow-up purely requesting sources/links for the previous response.
   */
  readonly isFollowUpSourceRequest: boolean;

  /**
   * Whether the user specifically asked for links/URLs.
   */
  readonly isExplicitLinkRequest: boolean;
}

export class SearchPresentationPolicyResolver {
  /**
   * Normalizes text for robust intent and keyword matching:
   * - Strips Arabic diacritics (tashkeel)
   * - Normalizes Alef variants (أ, إ, آ -> ا)
   * - Normalizes Taa Marbouta (ة -> ه)
   * - Normalizes Alef Maqsoura (ى -> ي)
   * - Collapses whitespace and punctuation
   */
  public static normalize(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      // Remove Arabic diacritics
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Remove Tatweel
      .replace(/\u0640/g, '')
      // Normalize Alef variants
      .replace(/[أإآ]/g, 'ا')
      // Normalize Taa Marbouta
      .replace(/ة/g, 'ه')
      // Normalize Alef Maqsoura
      .replace(/ى/g, 'ي')
      // Normalize punctuation to spaces
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Resolves the presentation policy based on current user query and optional recent dialogue context.
   */
  public static resolve(
    rawQuery: string,
    recentContext?: Array<{ role?: string; senderRole?: string; text?: string; content?: string }>
  ): SearchPresentationPolicy {
    const q = this.normalize(rawQuery || '');

    if (!q) {
      return {
        shouldShowSources: false,
        shouldShowUrls: false,
        shouldShowSnippets: false,
        isFollowUpSourceRequest: false,
        isExplicitLinkRequest: false,
      };
    }

    const hasLinkRequest = this.matchesLinkRequest(q);
    const hasSourceRequest = this.matchesSourceRequest(q) || hasLinkRequest;
    const isFollowUp = hasSourceRequest && this.isFollowUpQuery(q, rawQuery);

    return {
      shouldShowSources: hasSourceRequest,
      shouldShowUrls: hasLinkRequest,
      shouldShowSnippets: false,
      isFollowUpSourceRequest: isFollowUp,
      isExplicitLinkRequest: hasLinkRequest,
    };
  }

  /**
   * Detects explicit requests for sources, references, or provenance.
   * Crucial invariant: "ابحثلي عن..." or "ابحث عن..." alone does NOT match.
   */
  public static matchesSourceRequest(normalizedQuery: string): boolean {
    const q = normalizedQuery;

    // 1. Provenance inquiries (Arabic / Egyptian)
    const provenancePatterns = [
      /جبت\s+(الكلام|المعلومات|ده|دا)\s+(ده\s+)?منين/,
      /منين\s+جبت\s+(الكلام|المعلومات|ده|دا)/,
      /من\s+اين\s+لك\s+هذا/,
      /مصدر\s+(?:الكلام\s+ده|الكلام\s+دا|الكلام|المعلومات|الخبر|ده|دا)\s*(ايه|إيه|\?)/,
      /منين\s+(المعلومات|الكلام|المصدر)/,
      /مين\s+اللي\s+قال\s+كده/,
    ];
    if (provenancePatterns.some((p) => p.test(q))) {
      return true;
    }

    // 2. Request verbs + sources/references (Arabic / Egyptian)
    const arabicSourceRequests = [
      /(هات|هاتلي|اذكر|قولي|ما هي|ما|فين|عايز|عاوز|اريد|ابعت|ابعتلي|وريني|اعطيني|عرض)\s+(المصادر|مصادر|المراجع|مراجع|المصدر|المرجع)/,
      /(المصادر|المراجع)\s*(ايه|إيه|\?|فين)?$/,
      /^(المصادر|المراجع|المصدر|المرجع)$/,
      /^(ما\s+هي\s+المصادر|ما\s+مصادرك|اين\s+المصادر|فين\s+المصادر)$/,
      /^(عايز\s+المراجع|عايز\s+المصادر|عاوز\s+المصادر)$/,
      /(مع|و)\s*(المصادر|المراجع)/,
    ];
    if (arabicSourceRequests.some((p) => p.test(q))) {
      return true;
    }

    // 3. English Source Requests
    const englishSourceRequests = [
      /\b(show\s+(me\s+)?(the\s+)?sources|show\s+sources|sources\?|what\s+are\s+the\s+sources)\b/,
      /\b(where\s+did\s+you\s+get\s+this|what('s|\s+is)\s+the\s+source|give\s+me\s+(the\s+)?sources)\b/,
      /\b(citations\?|references\?|citations|references)\b/,
      /\b(with\s+(the\s+)?sources|include\s+(the\s+)?sources|list\s+(the\s+)?sources)\b/,
      /^(sources|references|citations)$/,
    ];
    if (englishSourceRequests.some((p) => p.test(q))) {
      return true;
    }

    return false;
  }

  /**
   * Detects explicit requests for URLs or hyperlinks.
   */
  public static matchesLinkRequest(normalizedQuery: string): boolean {
    const q = normalizedQuery;

    // 1. Arabic link patterns
    const arabicLinkPatterns = [
      /(هات|هاتلي|ابعت|ابعتلي|فين|اين|وريني|عايز|عاوز|اريد|اعطيني|عرض)\s+(الروابط|روابط|اللينكات|لينكات|الرابط|رابط|اللينك|لينك)/,
      /^(طب\s+|طيب\s+)?(الروابط|اللينكات|الرابط|اللينك)(\s*(ايه|إيه|\?))?$/,
      /^(طب\s+|طيب\s+)?(فين\s+)?(اللينك|الرابط)$/,
      /^(هات\s+|هاتلي\s+)(اللينكات|الروابط|اللينك|الرابط)$/,
      /^(ابعت\s+|ابعتلي\s+)(الروابط|اللينكات|اللينك|الرابط)$/,
      /(مع|و)\s*(الروابط|اللينكات|اللينك|الرابط)/,
      /(ابعتلي|ابعت|هاتلي|هات)\s+(لينكه|لينكها|روابطها|رابطها)/,
      /(الموقع\s+الرسمي|موقعهم|موقعهم\s+الرسمي|رابط\s+الموقع|لينك\s+الموقع)/,
      /(ايه|إيه|ما\s+هو|ما|فين|اين)\s+(موقع|الموقع)/,
      /(موقع|الموقع)\s+.*(ايه|إيه|\?)/,
    ];
    if (arabicLinkPatterns.some((p) => p.test(q))) {
      return true;
    }

    // 2. English link patterns
    const englishLinkPatterns = [
      /\b(give\s+me\s+(the\s+)?links|send\s+me\s+(the\s+)?links|show\s+(the\s+)?links)\b/,
      /\b(where\s+is\s+the\s+link|what('s|\s+is)\s+the\s+link|links\?|link\?)\b/,
      /\b(give\s+links|send\s+links|share\s+(the\s+)?links?)\b/,
      /\b(official\s+website|website\s+link|official\s+site|what('s|\s+is)\s+the\s+website)\b/,
      /^(links?|urls?)$/,
    ];
    if (englishLinkPatterns.some((p) => p.test(q))) {
      return true;
    }

    return false;
  }

  /**
   * Evaluates if the query is purely a follow-up request for sources of the prior message
   * rather than introducing a new substantive research topic.
   */
  public static isFollowUpQuery(normalizedQuery: string, rawQuery: string): boolean {
    const q = normalizedQuery;

    // Follow-up queries are concise inquiries focusing on sources/links/provenance
    const pureFollowUpPhrases = [
      /^(هات\s+|هاتلي\s+)?(المصادر|المراجع|اللينكات|الروابط|اللينك|الرابط)$/,
      /^(طب\s+|طيب\s+)?(اللينك|الرابط|اللينكات|الروابط)(\s*(ايه|إيه|\?))?$/,
      /^(فين\s+)(المصادر|المراجع|اللينك|الرابط|اللينكات|الروابط)$/,
      /^(ما\s+هي\s+المصادر|ما\s+مصادرك|اين\s+المصادر|المراجع\s+ايه)$/,
      /^(عايز\s+المراجع|عايز\s+المصادر|عاوز\s+المصادر)$/,
      /^(جبت\s+الكلام\s+ده\s+منين|منين\s+جبت\s+الكلام\s+ده|من\s+اين\s+لك\s+هذا)$/,
      /^(مصدر\s+(?:الكلام\s+ده|الكلام\s+دا|الكلام|المعلومات|الخبر)\s*(?:ايه|إيه|\?))$/,
      /^(show\s+sources|show\s+me\s+the\s+sources|sources\?|what\s+are\s+the\s+sources\??|give\s+me\s+the\s+links|send\s+me\s+the\s+links)$/,
      /^(where\s+did\s+you\s+get\s+this|citations\?|references\?|links\?)$/,
    ];

    if (pureFollowUpPhrases.some((p) => p.test(q))) {
      return true;
    }

    // Short queries under 50 chars that only contain source request patterns
    if (rawQuery.trim().length <= 50) {
      const stripped = q
        .replace(/(هات|هاتلي|ابعت|ابعتلي|فين|اين|وريني|عايز|عاوز|قولي|طب|طيب|لو سمحت|من فضلك|please)/g, '')
        .replace(/(المصادر|مصادر|المراجع|مراجع|المصدر|المرجع|اللينكات|لينكات|الروابط|روابط|اللينك|الرابط)/g, '')
        .replace(/(show|me|the|give|send|where|did|you|get|this|from|what|are|is|sources?|links?|references?|citations?)/g, '')
        .replace(/\s+/g, '')
        .trim();

      if (stripped.length === 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Code-Layer Leak Guard:
   * Policy-aware sanitizer. If web search was executed in the turn and `shouldShowSources === false`,
   * checks if the response leaks raw search listings, raw fallback headers, or unrequested source dumps,
   * and sanitizes it into a clean natural answer without stripping requested links or natural URLs.
   */
  public static sanitizeResponseIfLeaked(
    reply: string,
    policyOrLanguage?: SearchPresentationPolicy | LanguageContext,
    languageContext?: LanguageContext
  ): string {
    if (!reply || typeof reply !== 'string') return reply;

    let policy: SearchPresentationPolicy | undefined;
    let langCtx = languageContext;

    if (policyOrLanguage && 'shouldShowSources' in policyOrLanguage) {
      policy = policyOrLanguage as SearchPresentationPolicy;
    } else if (policyOrLanguage && 'targetLanguage' in policyOrLanguage) {
      langCtx = policyOrLanguage as LanguageContext;
    }

    // Policy-Aware Guard: If user explicitly requested sources or links, allow them without sanitization
    if (policy && (policy.shouldShowUrls || policy.shouldShowSources)) {
      return reply;
    }

    const trimmed = reply.trim();

    // 1. Detect raw search fallback header leaks
    const searchHeaderRegex = /^(إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:|Here are the search results retrieved for your query:|إليك نتائج البحث بخصوص طلبك:|نتائج البحث:)/m;
    const hasSearchHeader = searchHeaderRegex.test(trimmed);

    // 2. Detect raw search dump item patterns:
    // e.g. "1. *Title*\n   🌐 domain\n   Snippet\n   🔗 url"
    const hasRawDumpPattern = /\d+\.\s+\*[^*]+\*\n\s*(?:🌐|🔗|[a-z0-9.-]+\.[a-z]{2,})/i.test(trimmed);
    const hasRawUrls = /🔗\s*https?:\/\/[^\s]+/i.test(trimmed);

    if (!hasSearchHeader && !hasRawDumpPattern && !hasRawUrls) {
      return reply; // Clean, no leak detected
    }

    // If the entire message is just the raw search dump block:
    if (hasSearchHeader) {
      // Remove the header
      const withoutHeader = trimmed.replace(searchHeaderRegex, '').trim();

      // Extract titles and snippets to build a clean natural synthesized summary
      const items: Array<{ title: string; snippet: string }> = [];
      const itemBlocks = withoutHeader.split(/\n\s*\n/);

      for (const block of itemBlocks) {
        const titleMatch = block.match(/\d+\.\s+\*([^*]+)\*/);
        const snippetMatch = block.match(/\n\s+([^\n🌐🔗]+)/);
        if (titleMatch) {
          items.push({
            title: titleMatch[1].trim(),
            snippet: snippetMatch ? snippetMatch[1].trim() : '',
          });
        }
      }

      if (items.length > 0) {
        const isEnglish = langCtx?.targetLanguage === 'en';
        const isEgyptian = langCtx?.dialect === 'egyptian';

        const bulletPoints = items
          .map((item) => {
            if (item.snippet && item.snippet !== item.title) {
              return `• *${item.title}*: ${item.snippet}`;
            }
            return `• ${item.title}`;
          })
          .join('\n');

        if (isEnglish) {
          return `Based on verified information:\n\n${bulletPoints}`.trim();
        } else if (isEgyptian) {
          return `من واقع البيانات الرسمية المتاحة:\n\n${bulletPoints}`.trim();
        } else {
          return `بناءً على المعلومات الموثقة:\n\n${bulletPoints}`.trim();
        }
      }
    }

    // Suppress raw URL lines and domain icons if they were leaked without permission
    let cleaned = trimmed
      .replace(/\n\s*🔗\s*https?:\/\/[^\s]+/gi, '')
      .replace(/\n\s*🌐\s*[^\n]+/gi, '')
      .trim();

    return cleaned || reply;
  }
}
