import { z } from 'zod';
import { AgentTool, ToolContext, ToolExecutionResult, ToolMetadata } from '../tool.interface';
import { config } from '../../../config/env';
import { RuntimePolicyResolver } from '../../../config/runtime_policy';
import { logger } from '../../../core/logger';
import { LanguageContext } from '../../language/types';
import { MetricsCollector } from '../../observability/metrics';
import {
  NormalizedSearchResult,
  SearchIntent,
  SearchQueryPlan,
} from '../search/search.types';
import { SearchIntentClassifier } from '../search/search_intent_classifier';
import { SearchQueryPlanner } from '../search/search_query_planner';
import { SearchDeduplicator } from '../search/search_deduplicator';
import { SearchRanker } from '../search/search_ranker';
import { SearchRefiner } from '../search/search_refiner';

export interface SearchResultItem {
  title: string;
  snippet: string;
  url?: string;
  sourceDomain?: string;
  sourceName?: string;
  publishedAt?: string;
  publishedTimestamp?: number;
  relevanceScore?: number;
  freshnessScore?: number;
  sourceQualityScore?: number;
  entityMatchScore?: number;
  finalScore?: number;
  isHistoricalProtected?: boolean;
}

const searchSchema = z
  .object({
    query: z.string().min(1, 'Search query cannot be empty').max(500, 'Search query cannot exceed 500 characters'),
    cursor: z.number().optional(),
    id: z.number().optional(),
    topn: z.number().optional(),
  })
  .strict();

export type SearchArgs = z.infer<typeof searchSchema>;

export class WebSearchTool implements AgentTool<SearchArgs> {
  public readonly name = 'web_search';
  public readonly description =
    'Searches the live web for the latest news, actual product releases, device specs, leaks, rumors, gold/currency prices, movies, TV series, actors, cultural trivia, and real-time events across all Arab countries and worldwide.';
  public readonly isSensitive = false;
  public readonly schema = searchSchema;
  public readonly metadata: ToolMetadata = {
    name: 'web_search',
    description:
      'Searches the live web for the latest news, actual product releases, device specs, leaks, rumors, gold/currency prices, movies, TV series, actors, cultural trivia, and real-time events across all Arab countries and worldwide.',
    category: 'external_network',
    riskLevel: 'medium',
    requiresConfirmation: false,
    requiresNetwork: true,
    maxExecutionMs: 8000,
    maxOutputChars: 6000,
    maxOutputTokens: 1500,
  };
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query to look up on the live web',
      },
      cursor: {
        type: 'number',
        description: 'Optional pagination cursor',
      },
      id: {
        type: 'number',
        description: 'Optional search identifier',
      },
      topn: {
        type: 'number',
        description: 'Optional max results count',
      },
    },
    required: [] as string[],
  };

  public async execute(
    args: SearchArgs,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const rawQuery = (args.query || '').trim();
    if (!rawQuery) {
      return { success: false, error: 'Empty search query' };
    }

    if (!RuntimePolicyResolver.getPolicy().searchEnabled) {
      logger.warn('Web search execution blocked: searchEnabled is disabled by runtime policy');
      return {
        success: false,
        error: 'Web search is currently disabled by runtime system policy',
      };
    }

    const startTime = Date.now();

    // 1. Deterministic Query Planning & Intent Classification (Phase 9.3)
    const plan = SearchQueryPlanner.plan(rawQuery, context?.languageContext);

    // Emit low-cardinality telemetry
    MetricsCollector.getInstance().increment('craft.search.intent', 1, { intent: plan.intent });

    // Deterministic mock return for CI / unit test runs
    if (config.groq.isMockMode) {
      return {
        success: true,
        output: {
          query: rawQuery,
          intent: plan.intent,
          results: [
            {
              title: `أحدث التفاصيل والأخبار المؤكدة بخصوص: ${rawQuery}`,
              snippet: `نتائج بحث حية توضح المواصفات والتسريبات الحالية لـ ${rawQuery}.`,
              url: 'https://news.google.com',
              sourceDomain: 'news.google.com',
              relevanceScore: 0.95,
              finalScore: 0.92,
            },
          ],
        },
      };
    }

    try {
      logger.info(
        `Executing Search Intelligence V2 for: "${rawQuery}" [Intent: ${plan.intent}, Preferred: ${plan.preferredProvider}, Geo: ${plan.geoTargeting}]`
      );

      // 2. If Tavily API Key is configured, try Tavily first
      if (config.search?.tavilyApiKey) {
        try {
          const tavilyResults = await this.searchTavily(plan.plannedQuery, config.search.tavilyApiKey);
          if (tavilyResults.length > 0) {
            MetricsCollector.getInstance().increment('craft.search.provider', 1, { provider: 'tavily' });
            logger.info(`Tavily live search returned [${tavilyResults.length}] results for "${plan.plannedQuery}"`);
            const normalized = this.toNormalizedResults(tavilyResults);
            const deduped = SearchDeduplicator.deduplicate(normalized);
            const ranked = SearchRanker.rank(deduped, plan.plannedQuery, plan.intent);
            return {
              success: true,
              output: {
                query: rawQuery,
                intent: plan.intent,
                source: 'tavily',
                results: ranked.slice(0, 8),
              },
            };
          }
        } catch (tavilyErr: any) {
          logger.warn('Tavily search failed, continuing to multi-engine fallback', { error: tavilyErr.message });
        }
      }

      // 3. Multi-Engine Execution with Intent-Driven Provider Routing (Phase 9.3)
      let initialResults = await this.executeProviderRouting(plan, context?.languageContext);
      let normalized = this.toNormalizedResults(initialResults);
      let deduped = SearchDeduplicator.deduplicate(normalized);
      let ranked = SearchRanker.rank(deduped, plan.plannedQuery, plan.intent);

      // 4. Bounded 1-Shot Search Refinement (Phase 9.3)
      const refinementDecision = SearchRefiner.evaluate(ranked, plan, false);
      if (refinementDecision.shouldRefine && refinementDecision.refinementQuery) {
        MetricsCollector.getInstance().increment('craft.search.refinement_used', 1, { status: 'true' });
        logger.info(
          `Triggering search refinement for intent [${plan.intent}] with query "${refinementDecision.refinementQuery}" (reason: ${refinementDecision.reason})`
        );

        const refinedPlan: SearchQueryPlan = {
          ...plan,
          plannedQuery: refinementDecision.refinementQuery,
        };

        const supplementalResults = await this.executeProviderRouting(refinedPlan, context?.languageContext);
        const supplementalNormalized = this.toNormalizedResults(supplementalResults);
        const merged = SearchDeduplicator.deduplicate([...ranked, ...supplementalNormalized]);
        ranked = SearchRanker.rank(merged, plan.plannedQuery, plan.intent);
      }

      const executionLatencyMs = Date.now() - startTime;
      MetricsCollector.getInstance().observe('craft.search.execution_ms', executionLatencyMs);

      // 5. Successful Ranked Output
      if (ranked.length > 0) {
        logger.info(
          `Search Intelligence returned [${ranked.length}] ranked results for "${rawQuery}" [Intent: ${plan.intent}] in ${executionLatencyMs}ms`
        );
        return {
          success: true,
          output: {
            query: rawQuery,
            intent: plan.intent,
            source: 'live_web',
            results: ranked.slice(0, 8),
          },
        };
      }

      // 6. Graceful fallback if search engines returned no data
      MetricsCollector.getInstance().increment('craft.search.fallback_used', 1);
      return {
        success: true,
        output: {
          query: rawQuery,
          intent: plan.intent,
          results: [
            {
              title: `نتائج عامة حول ${rawQuery}`,
              snippet: `تم البحث عن ${rawQuery} عبر محركات البحث، يرجى الاستعانة بأحدث الأخبار الموثوقة المنشورة في المواقع الرسمية.`,
            },
          ],
        },
      };
    } catch (err: any) {
      logger.error('Live web search encountered an error', { error: err.message, query: rawQuery });
      MetricsCollector.getInstance().increment('craft.search.fallback_used', 1);
      return {
        success: true,
        output: {
          query: rawQuery,
          intent: plan.intent,
          error: 'تعذر الاتصال بمحرك البحث مؤقتاً، يرجى الاستعانة بالمعلومات العامة المتاحة.',
          results: [],
        },
      };
    }
  }

  /**
   * Routes query execution to providers based on the classified SearchIntent.
   *
   * Historical Query Invariant:
   * Google News RSS is NEVER routed as primary for historical_fact queries.
   */
  private async executeProviderRouting(
    plan: SearchQueryPlan,
    languageContext?: LanguageContext
  ): Promise<SearchResultItem[]> {
    const q = plan.plannedQuery;

    switch (plan.intent) {
      case 'breaking_news': {
        // Breaking news prioritizes Google News RSS, supplemented by DuckDuckGo HTML
        MetricsCollector.getInstance().increment('craft.search.provider', 1, { provider: 'google_news' });
        const [googleRes, ddgRes] = await Promise.allSettled([
          this.searchGoogleNews(q, 8, languageContext),
          this.searchDuckDuckGoHtml(q, 4, languageContext),
        ]);
        const gResults = googleRes.status === 'fulfilled' ? googleRes.value : [];
        const dResults = ddgRes.status === 'fulfilled' ? ddgRes.value : [];
        return [...gResults, ...dResults];
      }

      case 'historical_fact': {
        // Historical query protection: Google News is NEVER primary!
        MetricsCollector.getInstance().increment('craft.search.provider', 1, { provider: 'duckduckgo' });
        const [ddgHtmlRes, ddgLiteRes] = await Promise.allSettled([
          this.searchDuckDuckGoHtml(q, 8, languageContext),
          this.searchDuckDuckGoLite(q, 5, languageContext),
        ]);
        const htmlResults = ddgHtmlRes.status === 'fulfilled' ? ddgHtmlRes.value : [];
        const liteResults = ddgLiteRes.status === 'fulfilled' ? ddgLiteRes.value : [];
        const combined = [...htmlResults, ...liteResults];

        // Only if DuckDuckGo completely failed and returned 0 results, fall back to Google News
        if (combined.length === 0) {
          const gNewsRes = await this.searchGoogleNews(q, 3, languageContext);
          return gNewsRes;
        }
        return combined;
      }

      case 'technical_docs':
      case 'evergreen_knowledge': {
        // Tech docs & conceptual knowledge prioritize general web sources with rich code/text blocks
        MetricsCollector.getInstance().increment('craft.search.provider', 1, { provider: 'duckduckgo' });
        const [ddgHtmlRes, ddgLiteRes] = await Promise.allSettled([
          this.searchDuckDuckGoHtml(q, 8, languageContext),
          this.searchDuckDuckGoLite(q, 5, languageContext),
        ]);
        const htmlResults = ddgHtmlRes.status === 'fulfilled' ? ddgHtmlRes.value : [];
        const liteResults = ddgLiteRes.status === 'fulfilled' ? ddgLiteRes.value : [];
        return [...htmlResults, ...liteResults];
      }

      case 'technical_release':
      case 'latest_product':
      case 'general_web':
      default: {
        // Multi-engine fusion: DDG HTML + DDG Lite + Google News
        MetricsCollector.getInstance().increment('craft.search.provider', 1, { provider: 'multi_engine' });
        const [ddgHtmlRes, ddgLiteRes, googleNewsRes] = await Promise.allSettled([
          this.searchDuckDuckGoHtml(q, 6, languageContext),
          this.searchDuckDuckGoLite(q, 4, languageContext),
          this.searchGoogleNews(q, 4, languageContext),
        ]);
        const htmlResults = ddgHtmlRes.status === 'fulfilled' ? ddgHtmlRes.value : [];
        const liteResults = ddgLiteRes.status === 'fulfilled' ? ddgLiteRes.value : [];
        const newsResults = googleNewsRes.status === 'fulfilled' ? googleNewsRes.value : [];
        return [...htmlResults, ...liteResults, ...newsResults];
      }
    }
  }

  /**
   * Converts raw search items into internal NormalizedSearchResult representation.
   */
  private toNormalizedResults(items: SearchResultItem[]): NormalizedSearchResult[] {
    return items.map((item) => ({
      title: item.title,
      url: item.url || '',
      snippet: item.snippet,
      publishedAt: item.publishedAt,
      publishedTimestamp: item.publishedTimestamp,
      sourceName: item.sourceName,
      sourceDomain: item.sourceDomain || SearchDeduplicator.extractDomain(item.url),
      relevanceScore: item.relevanceScore,
      freshnessScore: item.freshnessScore,
      sourceQualityScore: item.sourceQualityScore,
      entityMatchScore: item.entityMatchScore,
      finalScore: item.finalScore,
      isHistoricalProtected: item.isHistoricalProtected,
    }));
  }

  /**
   * Official Google News RSS Search - 100% unblocked on Cloud/Vercel/AWS Lambda
   */
  public async searchGoogleNews(
    query: string,
    maxResults = 5,
    languageContext?: LanguageContext
  ): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2800);

    try {
      const isArabic = /[\u0600-\u06FF]/.test(query);
      const isEnglish = languageContext?.targetLanguage === 'en' || (!isArabic && /^[a-zA-Z0-9\s.,!?'"-]+$/.test(query));
      const hl = isEnglish ? 'en-US' : (isArabic ? 'ar' : (languageContext?.locale || 'en-US'));
      let gl = isEnglish ? 'US' : 'EG';
      let ceid = isEnglish ? 'US:en' : 'EG:ar';

      if (isArabic) {
        const lowerQuery = query.toLowerCase();
        if (/سعودي|سعودية|الرياض|جدة|الدمام|المملكة/.test(lowerQuery)) {
          gl = 'SA';
          ceid = 'SA:ar';
        } else if (/إمارات|امارات|دبي|أبوظبي|ابوظبي|الشارقة/.test(lowerQuery)) {
          gl = 'AE';
          ceid = 'AE:ar';
        } else if (/كويت/.test(lowerQuery)) {
          gl = 'KW';
          ceid = 'KW:ar';
        } else if (/أردن|اردن|عمان|نشامى/.test(lowerQuery)) {
          gl = 'JO';
          ceid = 'JO:ar';
        } else if (/مغرب|رباط|كازا|دار البيضاء/.test(lowerQuery)) {
          gl = 'MA';
          ceid = 'MA:ar';
        } else if (/مصر|القاهرة|الإسكندرية|الاسكندرية/.test(lowerQuery)) {
          gl = 'EG';
          ceid = 'EG:ar';
        } else {
          // General Pan-Arab default
          gl = 'EG';
          ceid = 'EG:ar';
        }
      } else if (languageContext?.targetLanguage === 'fr') {
        gl = 'FR';
        ceid = 'FR:fr';
      }

      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return [];
      }

      const xml = await response.text();
      const results = this.parseGoogleNewsRss(xml, maxResults);
      if (results.length === 0) {
        const cleaned = this.cleanKeywords(query);
        if (cleaned && cleaned !== query) {
          return await this.searchGoogleNewsDirect(cleaned, hl, gl, ceid, maxResults);
        }
      }
      return results;
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }

  public cleanKeywords(query: string): string {
    const stopWords = new Set([
      'في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'تم', 'كان', 'كانت', 'يكون',
      'اللي', 'اللى', 'ده', 'دي', 'دا', 'عشان', 'علشان', 'بتاع', 'بتاعة', 'مش', 'أنه',
      'إنه', 'ان', 'أن', 'او', 'أو', 'ثم', 'حيث', 'لما', 'كل', 'بعد', 'قبل', 'هو', 'هي',
      'the', 'is', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'about', 'to', 'for'
    ]);
    const words = query
      .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));
    return words.slice(0, 5).join(' ');
  }

  public async searchGoogleNewsDirect(
    keywordQuery: string,
    hl: string,
    gl: string,
    ceid: string,
    maxResults: number
  ): Promise<SearchResultItem[]> {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keywordQuery)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!response.ok) return [];
      const xml = await response.text();
      return this.parseGoogleNewsRss(xml, maxResults);
    } catch {
      return [];
    }
  }

  public parseGoogleNewsRss(xml: string, maxResults: number): SearchResultItem[] {
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>(?:[\s\S]*?<source\s+url="([^"]*)">([\s\S]*?)<\/source>)?[\s\S]*?<\/item>/g;
    const results: SearchResultItem[] = [];

    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null && results.length < maxResults) {
      const rawTitle = match[1] || '';
      const rawLink = match[2] || '';
      const pubDate = match[3] || '';
      const sourceUrl = match[4] || '';
      const sourceNameRaw = match[5] || '';

      const cleanTitle = rawTitle
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (cleanTitle) {
        // Extract source name and domain
        let sourceName = sourceNameRaw.trim();
        let sourceDomain: string | undefined;

        if (sourceUrl) {
          sourceDomain = SearchDeduplicator.extractDomain(sourceUrl);
        }

        // If source name not in <source>, check title suffix (e.g. "... - Reuters")
        if (!sourceName && cleanTitle.includes(' - ')) {
          const parts = cleanTitle.split(' - ');
          if (parts.length > 1) {
            sourceName = parts[parts.length - 1].trim();
          }
        }

        let publishedTimestamp: number | undefined;
        let publishedIso: string | undefined;
        if (pubDate) {
          const parsed = Date.parse(pubDate);
          if (!isNaN(parsed)) {
            publishedTimestamp = parsed;
            publishedIso = new Date(parsed).toISOString();
          }
        }

        results.push({
          title: cleanTitle,
          snippet: pubDate ? `${cleanTitle} (${pubDate})` : cleanTitle,
          url: rawLink.trim(),
          sourceName: sourceName || undefined,
          sourceDomain: sourceDomain || 'news.google.com',
          publishedAt: publishedIso || pubDate || undefined,
          publishedTimestamp,
        });
      }
    }

    return results;
  }

  /**
   * DuckDuckGo HTML Search - Ultra fast and rich snippets with prices & specs
   */
  public async searchDuckDuckGoHtml(
    query: string,
    maxResults = 8,
    languageContext?: LanguageContext
  ): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);

    const acceptLang = languageContext?.targetLanguage === 'en'
      ? 'en-US,en;q=0.9'
      : (languageContext?.targetLanguage === 'fr'
        ? 'fr-FR,fr;q=0.9,en;q=0.8'
        : 'ar-EG,ar;q=0.9,en;q=0.8');

    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': acceptLang,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // DuckDuckGo anti-bot / HTTP 202 resilience
      if (!response.ok || response.status === 202) {
        logger.warn('DuckDuckGo HTML returned non-200 or HTTP 202 Accepted without body', { status: response.status });
        return [];
      }

      const html = await response.text();
      if (!html || html.length < 200 || html.includes('challenge-form') || html.includes('captcha')) {
        logger.warn('DuckDuckGo HTML returned empty or bot challenge response');
        return [];
      }

      return this.parseDuckDuckGoHtml(html, maxResults);
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }

  public parseDuckDuckGoHtml(html: string, maxResults: number): SearchResultItem[] {
    const results: SearchResultItem[] = [];
    const blocks = html.split('<div class="result results_links');

    for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
      const b = blocks[i];
      const titleMatch = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (titleMatch && snippetMatch) {
        let rawUrl = titleMatch[1];
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          try {
            rawUrl = decodeURIComponent(uddgMatch[1]);
          } catch {}
        }

        const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
        const snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim();

        if (title && snippet) {
          results.push({
            title,
            snippet,
            url: rawUrl,
            sourceDomain: SearchDeduplicator.extractDomain(rawUrl),
          });
        }
      }
    }

    return results;
  }

  /**
   * DuckDuckGo Lite Search
   */
  public async searchDuckDuckGoLite(
    query: string,
    maxResults = 5,
    languageContext?: LanguageContext
  ): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const acceptLang = languageContext?.targetLanguage === 'en'
      ? 'en-US,en;q=0.9'
      : (languageContext?.targetLanguage === 'fr'
        ? 'fr-FR,fr;q=0.9,en;q=0.8'
        : 'ar,en;q=0.9');

    try {
      const response = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': acceptLang,
        },
        body: new URLSearchParams({ q: query }).toString(),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // DuckDuckGo anti-bot / HTTP 202 resilience
      if (!response.ok || response.status === 202) {
        logger.warn('DuckDuckGo Lite returned non-200 or HTTP 202 Accepted without body', { status: response.status });
        return [];
      }

      const html = await response.text();
      if (!html || html.length < 200 || html.includes('challenge-form') || html.includes('captcha')) {
        logger.warn('DuckDuckGo Lite returned empty or bot challenge response');
        return [];
      }

      return this.parseDuckDuckGoLiteHtml(html, maxResults);
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }

  public parseDuckDuckGoLiteHtml(html: string, maxResults: number): SearchResultItem[] {
    const linkRegex = /<a rel="nofollow" href="([^"]+)" class=['"]result-link['"]>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<td class=['"]result-snippet['"]>([\s\S]*?)<\/td>/g;

    const titles: Array<{ url: string; title: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      const cleanTitle = m[2].replace(/<[^>]+>/g, '').trim();
      if (cleanTitle) {
        titles.push({ url: m[1], title: cleanTitle });
      }
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      const cleanSnippet = m[1].replace(/<[^>]+>/g, '').trim();
      if (cleanSnippet) {
        snippets.push(cleanSnippet);
      }
    }

    const results: SearchResultItem[] = [];
    const count = Math.min(titles.length, snippets.length, maxResults);

    for (let i = 0; i < count; i++) {
      results.push({
        title: titles[i].title,
        snippet: snippets[i],
        url: titles[i].url,
        sourceDomain: SearchDeduplicator.extractDomain(titles[i].url),
      });
    }

    return results;
  }

  public async searchTavily(query: string, apiKey: string, maxResults = 5): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return [];
      }

      const data: any = await response.json();
      const rawResults = data.results || [];

      return rawResults.map((item: any) => ({
        title: item.title || '',
        snippet: item.content || '',
        url: item.url || '',
        sourceDomain: SearchDeduplicator.extractDomain(item.url),
      }));
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }
}
