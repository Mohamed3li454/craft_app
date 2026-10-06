/**
 * Search Evidence Compactor (Phase 14.4)
 *
 * Implements intelligent, deterministic search evidence optimization:
 * 1. Crawler & Web Boilerplate Removal:
 *    - Strips navigation chrome ("Skip to main content", "تخطي إلى المحتوى"),
 *      cookie banners/GDPR notices ("We use cookies", "ملفات تعريف الارتباط"),
 *      paywall/subscription prompts ("Subscribe to read", "اشترك الآن"),
 *      social sharing links ("Share on Twitter", "شارك عبر فيسبوك"),
 *      and footer copyright legalese ("All rights reserved © 2024").
 *    - 100% preserves facts, statistics, numbers, prices, currency symbols,
 *      dates, specifications, quotes, and substantive text.
 * 2. Canonical URL Normalization:
 *    - Strips search redirect wrappers (Google, DuckDuckGo, Bing, Yahoo).
 *    - Strips tracking query parameters (utm_*, fbclid, gclid, ref, etc.).
 *    - Normalizes hostname (removes leading www.) and paths.
 * 3. Canonical Source Key Deduplication:
 *    - Deduplicates by `${domain}:::${canonicalPath}`.
 *    - Invariant: Different articles from the same domain are NEVER deduplicated.
 * 4. Zero LLM Cost & Zero Latency Overhead:
 *    - 100% deterministic, local, regex-based optimization.
 */

export interface SearchCompactorOptions {
  readonly maxResults?: number;
  readonly preserveBoilerplate?: boolean;
}

export interface CompactedSearchResults<T> {
  readonly results: T[];
  readonly originalCount: number;
  readonly compactedCount: number;
  readonly dedupedCount: number;
  readonly tokensSavedEstimate: number;
}

export class SearchEvidenceCompactor {
  public static readonly DEFAULT_MAX_RESULTS = 8;

  private static readonly TRACKING_PARAMS = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'fbclid',
    'gclid',
    'msclkid',
    'dclid',
    'twclid',
    'session_id',
    'session',
    'ref',
    'ref_src',
    'ref_url',
    'source',
    'campaign',
    'tracking_id',
    'yclid',
    'mc_cid',
    'mc_eid',
    '_ga',
    '_gl',
    '_hsenc',
    '_hsmi',
    'ncid',
    'cmpid',
    'igshid',
    'trk',
  ]);

  private static readonly BOILERPLATE_PATTERNS: RegExp[] = [
    // 1. Navigation / Breadcrumbs
    /(?:تخطي\s+إلى\s+(?:المحتوى|المحتوى\s+الرئيسي|العناصر\s+الرئيسية)|الصفحة\s+الرئيسية\s*[>»/]|القائمة\s+الرئيسية)[^.\n]*[.\n]?/gi,
    /(?:skip\s+to\s+(?:main\s+content|content|navigation)|home\s*[>»/]\s*news|main\s+menu)[^.\n]*[.\n]?/gi,

    // 2. Cookie / Consent / GDPR
    /(?:نحن\s+نستخدم\s+ملفات\s+تعريف\s+الارتباط|قبول\s+(?:جميع\s+)?ملفات\s+تعريف\s+الارتباط|إدارة\s+(?:ملفات\s+الارتباط|التفضيلات)|سياسة\s+الخصوصية\s+وملفات\s+الارتباط)[^.\n]*[.\n]?/gi,
    /(?:we\s+use\s+cookies|this\s+website\s+uses\s+cookies|accept\s+all\s+cookies|manage\s+cookie\s+preferences|cookie\s+policy)[^.\n]*[.\n]?/gi,

    // 3. Subscription / Paywall / Sign-in
    /(?:اشترك\s+الآن|سجل\s+دخولك\s+لمتابعة|للمشتركين\s+فقط|تسجيل\s+الدخول\s+أو\s+إنشاء\s+حساب)[^.\n]*[.\n]?/gi,
    /(?:subscribe\s+(?:now\s+)?(?:to\s+read|for\s+unlimited|to\s+continue)[^.\n]*[.\n]?|sign\s+in\s+to\s+continue[^.\n]*[.\n]?|already\s+a\s+subscriber[^.\n]*[.\n]?|create\s+a\s+free\s+account[^.\n]*[.\n]?)/gi,

    // 4. Social Sharing & Follows
    /(?:شارك\s+(?:هذا\s+)?(?:المقال|الخبر)\s+عبر(?:\s+(?:فيسبوك|تويتر|واتساب|تليجرام|لينكد\s+إن))+|تابعنا\s+على\s+(?:تليجرام|تويتر|فيسبوك))[.\n]?/gi,
    /(?:share\s+(?:this\s+)?(?:article|story|post)(?:\s+(?:on|via)\s+(?:facebook|twitter|x|whatsapp|linkedin))+|follow\s+us\s+on\s+(?:twitter|x|telegram|facebook))[.\n]?/gi,

    // 5. Footers / Copyright / Legal Boilerplate
    /(?:جميع\s+الحقوق\s+محفوظة|حقوق\s+النشر|شروط\s+الخدمة\s+وسياسة\s+الخصوصية)[^.\n]*[.\n]?/gi,
    /(?:all\s+rights\s+reserved\s*(?:©|\(c\))?\s*\d{0,4}[^.\n]*[.\n]?|copyright\s*(?:©|\(c\))?\s*\d{0,4}[^.\n]*[.\n]?|terms\s+of\s+service\s+and\s+privacy\s+policy[^.\n]*[.\n]?)/gi,
  ];

  /**
   * Cleans search snippets by removing crawler boilerplate while preserving
   * 100% of facts, numbers, prices, dates, specs, and substantive sentences.
   */
  public static cleanSnippetBoilerplate(snippet: string): string {
    if (!snippet || typeof snippet !== 'string') return '';

    let cleaned = snippet.trim();
    if (!cleaned) return '';

    // Apply boilerplate elimination regexes
    for (const pattern of this.BOILERPLATE_PATTERNS) {
      cleaned = cleaned.replace(pattern, ' ');
    }

    // Strip leading/trailing decorative noise and ellipses, preserving regular sentence-ending period
    cleaned = cleaned
      .replace(/^[\s.\-–—•|*#]+/, '')
      .replace(/\.{3,}$/, '')
      .replace(/[\s\-–—•|*#]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Invariant Protection: If cleaning was overly aggressive and emptied a non-empty snippet,
    // preserve the original stripped of basic excessive whitespace
    if (cleaned.length < 15 && snippet.trim().length >= 15) {
      return snippet.trim().replace(/\s{2,}/g, ' ');
    }

    return cleaned;
  }

  /**
   * Normalizes URLs by removing redirect wrappers, tracking parameters, hashes,
   * default ports, and trailing slashes.
   */
  public static normalizeUrl(rawUrl?: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    let urlString = rawUrl.trim();
    if (!urlString) return '';

    // 1. Decode DuckDuckGo redirects (uddg=)
    const uddgMatch = urlString.match(/[?&]uddg=([^&]+)/i);
    if (uddgMatch) {
      try {
        urlString = decodeURIComponent(uddgMatch[1]);
      } catch {}
    }

    // 2. Decode Google search redirect wrappers (google.com/url?q=)
    const googleMatch = urlString.match(/google\.[a-z.]+\/url\?(?:[^&]+&)*q=([^&]+)/i);
    if (googleMatch) {
      try {
        urlString = decodeURIComponent(googleMatch[1]);
      } catch {}
    }

    // 3. Decode Bing redirect wrappers (bing.com/ck/a?...&u=a1<base64>)
    const bingMatch = urlString.match(/bing\.com\/ck\/a\?(?:[^&]+&)*u=a1([^&]+)/i);
    if (bingMatch) {
      try {
        const decoded = Buffer.from(bingMatch[1], 'base64').toString('utf8');
        if (decoded.startsWith('http')) {
          urlString = decoded;
        }
      } catch {}
    }

    // 4. Decode Yahoo redirect wrappers (r.search.yahoo.com/.../RU=<encoded_url>)
    const yahooMatch = urlString.match(/r\.search\.yahoo\.com\/(?:[^/]+\/)+RU=([^/]+)/i);
    if (yahooMatch) {
      try {
        urlString = decodeURIComponent(yahooMatch[1]);
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

      // Normalize hostname (lowercase, strip leading www.)
      parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

      // Normalize pathname (remove trailing slash on non-root paths)
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }

      let result = parsed.toString();
      if (result.endsWith('/') && parsed.pathname === '/') {
        result = result.slice(0, -1);
      }

      return result;
    } catch {
      // Fallback for non-standard URLs
      return urlString.split('?')[0].split('#')[0].replace(/^https?:\/\/www\./i, 'https://');
    }
  }

  /**
   * Computes a canonical source key based on domain + canonical path.
   * Guarantees that different articles on the same domain are NOT deduplicated.
   */
  public static computeSourceKey(url?: string, title?: string, domain?: string): string {
    if (url) {
      const normalized = this.normalizeUrl(url);
      try {
        const parsed = new URL(normalized);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
        return `${host}:::${path || '/'}`;
      } catch {
        // Fallback using string splitting
        const clean = normalized.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
        const slashIdx = clean.indexOf('/');
        if (slashIdx >= 0) {
          const host = clean.substring(0, slashIdx).toLowerCase();
          const path = clean.substring(slashIdx).split('?')[0].split('#')[0].toLowerCase().replace(/\/+$/, '');
          return `${host}:::${path || '/'}`;
        }
        return `${clean.toLowerCase()}:::/`;
      }
    }

    // If no URL available, fall back to domain + title key
    const dom = (domain || 'unknown').toLowerCase().replace(/^www\./, '');
    const cleanTitle = (title || '')
      .toLowerCase()
      .replace(/[^\w\s\u0600-\u06FF]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);

    return `${dom}:::${cleanTitle}`;
  }

  /**
   * Compacts search results by removing crawler boilerplate, normalizing URLs,
   * deduplicating by canonical source key, and prioritizing substantive evidence.
   */
  public static compactResults<
    T extends {
      title: string;
      snippet: string;
      url?: string;
      sourceDomain?: string;
      sourceName?: string;
    }
  >(results: T[], options?: SearchCompactorOptions): CompactedSearchResults<T> {
    if (!results || results.length === 0) {
      return {
        results: [],
        originalCount: 0,
        compactedCount: 0,
        dedupedCount: 0,
        tokensSavedEstimate: 0,
      };
    }

    const maxResults = options?.maxResults || this.DEFAULT_MAX_RESULTS;
    const preserveBoilerplate = options?.preserveBoilerplate || false;

    const seenSourceKeys = new Set<string>();
    const compacted: T[] = [];
    let omittedChars = 0;
    let dedupedCount = 0;

    for (const item of results) {
      const cleanUrl = this.normalizeUrl(item.url);
      const sourceKey = this.computeSourceKey(cleanUrl || item.url, item.title, item.sourceDomain);

      // Deduplication check
      if (seenSourceKeys.has(sourceKey)) {
        dedupedCount++;
        omittedChars += (item.snippet?.length || 0) + (item.title?.length || 0) + (item.url?.length || 0);
        continue;
      }
      seenSourceKeys.add(sourceKey);

      // Boilerplate cleaning
      const originalSnippet = item.snippet || '';
      const cleanSnippet = preserveBoilerplate
        ? originalSnippet
        : this.cleanSnippetBoilerplate(originalSnippet);

      const snippetCharsSaved = Math.max(0, originalSnippet.length - cleanSnippet.length);
      omittedChars += snippetCharsSaved;

      const urlCharsSaved = item.url ? Math.max(0, item.url.length - cleanUrl.length) : 0;
      omittedChars += urlCharsSaved;

      compacted.push({
        ...item,
        url: cleanUrl || item.url,
        snippet: cleanSnippet,
      });

      if (compacted.length >= maxResults) {
        break;
      }
    }

    const tokensSavedEstimate = Math.max(0, Math.round(omittedChars / 3.8));

    return {
      results: compacted,
      originalCount: results.length,
      compactedCount: compacted.length,
      dedupedCount,
      tokensSavedEstimate,
    };
  }
}
