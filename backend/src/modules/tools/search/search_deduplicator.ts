/**
 * Search Deduplicator (Phase 9.3)
 *
 * Implements multi-level deduplication:
 * 1. Normalized & canonical URLs (tracking parameters, session IDs, trailing slashes removed)
 * 2. Redirect URL resolution (DuckDuckGo uddg decoding, clean link targets)
 * 3. Normalized titles (publication suffix stripping, Arabic normalization, whitespace collapse)
 * 4. Cross-provider same domain + same title deduplication
 */

import { NormalizedSearchResult } from './search.types';

export class SearchDeduplicator {
  private static readonly TRACKING_PARAMS = new Set([
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
    '_ga',
    'ncid',
    'cmpid',
  ]);

  private static readonly PUBLICATION_SUFFIXES = [
    /\s*[-–|•]\s*BBC\s*(News|Arabic)?\s*$/i,
    /\s*[-–|•]\s*(بوابة\s*)?الأهرام\s*$/i,
    /\s*[-–|•]\s*اليوم\s*السابع\s*$/i,
    /\s*[-–|•]\s*الجزيرة(\s*نت)?\s*$/i,
    /\s*[-–|•]\s*العربية(\s*نت)?\s*$/i,
    /\s*[-–|•]\s*سكاي\s*نيوز\s*(عربية)?\s*$/i,
    /\s*[-–|•]\s*MacRumors\s*$/i,
    /\s*[-–|•]\s*The\s*Verge\s*$/i,
    /\s*[-–|•]\s*TechCrunch\s*$/i,
    /\s*[-–|•]\s*Reuters\s*$/i,
    /\s*[-–|•]\s*Apple\s*$/i,
    /\s*[-–|•]\s*Wikipedia\s*$/i,
    /\s*[-–|•]\s*ويكيبيديا\s*$/i,
    /\s*[-–|•]\s*YouTube\s*$/i,
  ];

  /**
   * Deduplicates a list of search results using multi-level matching.
   */
  public static deduplicate(results: NormalizedSearchResult[]): NormalizedSearchResult[] {
    if (!results || results.length === 0) return [];

    const deduped: NormalizedSearchResult[] = [];
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const seenDomainTitlePairs = new Set<string>();

    for (const item of results) {
      const cleanUrl = this.normalizeUrl(item.url);
      const cleanTitle = this.normalizeTitle(item.title);
      const domain = item.sourceDomain || this.extractDomain(cleanUrl) || 'unknown';

      // 1. Skip if URL already seen
      if (cleanUrl && seenUrls.has(cleanUrl)) {
        continue;
      }

      // 2. Skip if normalized title already seen
      if (cleanTitle && seenTitles.has(cleanTitle)) {
        continue;
      }

      // 3. Skip if same domain + closely matching title
      const domainTitleKey = `${domain}:::${cleanTitle.slice(0, 40)}`;
      if (seenDomainTitlePairs.has(domainTitleKey)) {
        continue;
      }

      // Record deduplication keys
      if (cleanUrl) seenUrls.add(cleanUrl);
      if (cleanTitle) seenTitles.add(cleanTitle);
      seenDomainTitlePairs.add(domainTitleKey);

      deduped.push({
        ...item,
        url: cleanUrl || item.url,
        sourceDomain: domain !== 'unknown' ? domain : item.sourceDomain,
      });
    }

    return deduped;
  }

  /**
   * Normalizes a URL by decoding redirects and removing tracking params, hashes, and default ports.
   */
  public static normalizeUrl(rawUrl?: string): string | undefined {
    if (!rawUrl) return undefined;
    let urlString = rawUrl.trim();

    // 1. Decode DuckDuckGo uddg redirects
    const uddgMatch = urlString.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        urlString = decodeURIComponent(uddgMatch[1]);
      } catch {}
    }

    try {
      const parsed = new URL(urlString);

      // Remove tracking query parameters
      for (const param of Array.from(parsed.searchParams.keys())) {
        if (this.TRACKING_PARAMS.has(param.toLowerCase())) {
          parsed.searchParams.delete(param);
        }
      }

      // Remove hash fragment
      parsed.hash = '';

      // Normalize hostname (lowercase, strip www.)
      parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

      // Remove trailing slash on root
      let result = parsed.toString();
      if (result.endsWith('/') && parsed.pathname === '/') {
        result = result.slice(0, -1);
      }

      return result;
    } catch {
      // Fallback for non-standard URLs: strip query string tracking params via regex
      return urlString.split('?')[0];
    }
  }

  /**
   * Normalizes a search title by stripping publication branding, Arabic diacritics, and collapsing spaces.
   */
  public static normalizeTitle(title: string): string {
    if (!title) return '';

    let cleaned = title;

    // Strip publication suffixes
    for (const suffix of this.PUBLICATION_SUFFIXES) {
      cleaned = cleaned.replace(suffix, '').trim();
    }

    return cleaned
      .toLowerCase()
      // Normalize Arabic diacritics
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Normalize Alef variations
      .replace(/[أإآ]/g, 'ا')
      // Normalize Taa Marbuta / Haa
      .replace(/ة/g, 'ه')
      // Normalize Yaa / Alef Maksura
      .replace(/ى/g, 'ي')
      // Remove punctuation
      .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Safely extracts the domain from a URL.
   */
  public static extractDomain(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return undefined;
    }
  }
}
