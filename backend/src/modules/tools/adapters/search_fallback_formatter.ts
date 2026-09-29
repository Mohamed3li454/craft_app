/**
 * Deterministic Search Fallback Formatter (Phase 9.1)
 *
 * Provides a 100% deterministic, zero-LLM presentation fallback layer
 * when LLM synthesis fails after web search tools have successfully executed.
 *
 * Invariants:
 * - Pure TypeScript, zero network calls, zero external APIs.
 * - Max 3 useful results.
 * - Strict character and snippet budgets.
 * - Clean WhatsApp Markdown formatting.
 * - Strips all internal metadata, provider codes, tokens, and errors.
 * - Neutral phrasing when publication recency cannot be verified.
 */

import { LanguageContext } from '../../language/types';
import { redactSecrets } from '../contracts/error.types';

export const MAX_FALLBACK_RESULTS = 3;
export const MAX_SNIPPET_LENGTH = 160;
export const MAX_TITLE_LENGTH = 100;
export const MAX_TOTAL_CHARS = 1000;

export interface NormalizedSearchItem {
  title: string;
  snippet: string;
  url?: string;
  sourceDomain?: string;
  publishedDate?: string;
}

export class SearchFallbackFormatter {
  /**
   * Formats raw search execution results into a clean, deterministic WhatsApp response.
   */
  public static format(
    rawResult: any,
    languageContext?: LanguageContext
  ): string {
    const isEnglish = languageContext?.targetLanguage === 'en';
    const items = this.extractItems(rawResult);

    if (items.length === 0) {
      return isEnglish
        ? 'Your request was processed and a search was conducted, but no matching results were found at this time.'
        : 'تمت معالجة طلبك والبحث في المصادر، ولكن لم يتم العثور على نتائج مطابقة في الوقت الحالي.';
    }

    const selected = items.slice(0, MAX_FALLBACK_RESULTS);
    const formattedBlocks: string[] = [];

    const header = isEnglish
      ? 'Here are the search results retrieved for your query:\n'
      : 'إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:\n';

    let currentLength = header.length;

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const cleanTitle = this.sanitizeText(item.title, MAX_TITLE_LENGTH);
      const cleanSnippet = this.sanitizeText(item.snippet, MAX_SNIPPET_LENGTH);
      const domain = this.extractDomain(item.url, item.sourceDomain);
      const cleanUrl = this.sanitizeUrl(item.url);

      let block = `${i + 1}. *${cleanTitle}*`;
      if (domain) {
        block += `\n   🌐 ${domain}`;
      }
      if (cleanSnippet) {
        block += `\n   ${cleanSnippet}`;
      }
      if (cleanUrl) {
        block += `\n   🔗 ${cleanUrl}`;
      }

      if (currentLength + block.length + 2 > MAX_TOTAL_CHARS) {
        if (formattedBlocks.length > 0) break;
        const trimmedSnippet = cleanSnippet.slice(0, 80) + '...';
        block = `${i + 1}. *${cleanTitle}*\n   ${trimmedSnippet}`;
        if (cleanUrl) block += `\n   🔗 ${cleanUrl}`;
      }

      formattedBlocks.push(block);
      currentLength += block.length + 2;
    }

    const body = formattedBlocks.join('\n\n');
    return `${header}\n${body}`.trim();
  }

  /**
   * Safely extracts search items from various result representations.
   */
  public static extractItems(rawResult: any): NormalizedSearchItem[] {
    if (!rawResult) return [];

    let parsed = rawResult;
    if (typeof rawResult === 'string') {
      try {
        parsed = JSON.parse(rawResult);
      } catch {
        return [];
      }
    }

    let candidateList: any[] = [];

    if (Array.isArray(parsed)) {
      candidateList = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.results)) {
        candidateList = parsed.results;
      } else if (parsed.output && Array.isArray(parsed.output.results)) {
        candidateList = parsed.output.results;
      } else if (Array.isArray(parsed.items)) {
        candidateList = parsed.items;
      }
    }

    const normalized: NormalizedSearchItem[] = [];

    for (const rawItem of candidateList) {
      if (!rawItem || typeof rawItem !== 'object') continue;

      const title = String(rawItem.title || rawItem.name || '').trim();
      const snippet = String(rawItem.snippet || rawItem.description || rawItem.body || '').trim();
      const url = typeof rawItem.url === 'string' ? rawItem.url.trim() : undefined;
      const sourceDomain = typeof rawItem.sourceDomain === 'string' ? rawItem.sourceDomain : undefined;

      // Filter out empty or generic placeholder items
      if (!title && !snippet) continue;
      if (title.startsWith('نتائج عامة حول') && snippet.includes('يرجى الاستعانة بأحدث الأخبار')) {
        continue;
      }

      normalized.push({
        title,
        snippet,
        url,
        sourceDomain,
        publishedDate: rawItem.publishedDate || rawItem.pubDate,
      });
    }

    return normalized;
  }

  private static sanitizeText(text: string, maxLength: number): string {
    if (!text) return '';
    let cleaned = text
      .replace(/<[^>]*>/g, '') // Strip HTML tags
      .replace(/[\r\n\t]+/g, ' ') // Flatten newlines
      .replace(/\s+/g, ' ')
      .trim();

    cleaned = redactSecrets(cleaned);

    if (cleaned.length > maxLength) {
      return cleaned.slice(0, maxLength - 3).trim() + '...';
    }
    return cleaned;
  }

  private static extractDomain(url?: string, explicitDomain?: string): string | undefined {
    if (explicitDomain) return explicitDomain;
    if (!url) return undefined;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      return host || undefined;
    } catch {
      return undefined;
    }
  }

  private static sanitizeUrl(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      const u = new URL(url);
      const trackingParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'fbclid',
        'gclid',
        'session_id',
        'session',
        'ref',
        'source',
        'tracking_id',
        'yclid',
        'mc_cid',
        'mc_eid',
      ];
      for (const param of trackingParams) {
        u.searchParams.delete(param);
      }
      return u.toString();
    } catch {
      return url.split('?')[0];
    }
  }
}
