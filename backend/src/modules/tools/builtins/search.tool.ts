import { AgentTool, ToolContext, ToolExecutionResult } from '../tool.interface';
import { config } from '../../../config/env';
import { logger } from '../../../core/logger';

export interface SearchResultItem {
  title: string;
  snippet: string;
  url?: string;
}

export class WebSearchTool implements AgentTool {
  public readonly name = 'web_search';
  public readonly description =
    'Searches the live web for the latest news, actual product releases, device specs, leaks, rumors, gold/currency prices, movies, TV series, actors, cultural trivia, and real-time events across all Arab countries and worldwide.';
  public readonly isSensitive = false;
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
    args: Record<string, any>,
    _context: ToolContext
  ): Promise<ToolExecutionResult> {
    let query = (args.query || '').trim();
    if (!query) {
      return { success: false, error: 'Empty search query' };
    }

    // Auto-focus price & product inquiries to Egyptian market if no specific region is mentioned
    const isPriceOrMarketQuery = /سعر|اسعار|أسعار|بكام|تكلفة|كام|مواصفات|تاريخ نزول|موعد طرح/i.test(query);
    const mentionsCountry = /مصر|سعودي|امارات|إمارات|كويت|قطر|بحرين|عمان|أردن|اردن|مغرب|تونس|جزائر|دبي|رياض/i.test(query);
    if (isPriceOrMarketQuery && !mentionsCountry) {
      query = `${query} في مصر`;
    }

    // Deterministic mock return for CI / unit test runs
    if (config.groq.isMockMode || process.env.GEMINI_MOCK_MODE === 'true') {
      return {
        success: true,
        output: {
          query,
          results: [
            {
              title: `أحدث التفاصيل والأخبار المؤكدة بخصوص: ${query}`,
              snippet: `نتائج بحث حية توضح المواصفات والتسريبات الحالية لـ ${query}.`,
              url: 'https://news.google.com',
            },
          ],
        },
      };
    }

    try {
      logger.info(`Executing live web search for: "${query}"`);

      // 1. If Tavily API Key is configured, try Tavily first
      if (config.search?.tavilyApiKey) {
        try {
          const tavilyResults = await this.searchTavily(query, config.search.tavilyApiKey);
          if (tavilyResults.length > 0) {
            logger.info(`Tavily live search returned [${tavilyResults.length}] results for "${query}"`);
            return {
              success: true,
              output: {
                query,
                source: 'tavily',
                results: tavilyResults,
              },
            };
          }
        } catch (tavilyErr: any) {
          logger.warn('Tavily search failed, continuing to multi-engine fallback', { error: tavilyErr.message });
        }
      }

      // 2. Multi-Engine Fusion: Run DuckDuckGo HTML + DuckDuckGo Lite + Google News concurrently
      const [ddgHtmlRes, ddgLiteRes, googleNewsRes] = await Promise.allSettled([
        this.searchDuckDuckGoHtml(query, 8),
        this.searchDuckDuckGoLite(query, 5),
        this.searchGoogleNews(query, 5),
      ]);

      const ddgHtmlResults = ddgHtmlRes.status === 'fulfilled' ? ddgHtmlRes.value : [];
      const ddgLiteResults = ddgLiteRes.status === 'fulfilled' ? ddgLiteRes.value : [];
      const googleNewsResults = googleNewsRes.status === 'fulfilled' ? googleNewsRes.value : [];

      const combined: SearchResultItem[] = [];
      const seenTitles = new Set<string>();

      // Prioritize DuckDuckGo HTML and Lite results as they contain detailed paragraphs with real prices & specs
      const allResults = [...ddgHtmlResults, ...ddgLiteResults, ...googleNewsResults];

      // Sort: results with informative snippets (containing actual numbers, prices, or length > 50 chars) first
      allResults.sort((a, b) => {
        const aHasSnippet = a.snippet && a.snippet.length > 50 && !a.snippet.startsWith('تاريخ الخبر');
        const bHasSnippet = b.snippet && b.snippet.length > 50 && !b.snippet.startsWith('تاريخ الخبر');
        if (aHasSnippet && !bHasSnippet) return -1;
        if (!aHasSnippet && bHasSnippet) return 1;
        return 0;
      });

      for (const item of allResults) {
        const normalized = item.title.toLowerCase().trim();
        if (!seenTitles.has(normalized)) {
          seenTitles.add(normalized);
          combined.push(item);
        }
      }

      if (combined.length > 0) {
        logger.info(
          `Live web search returned [${combined.length}] results (DDG HTML: ${ddgHtmlResults.length}, DDG Lite: ${ddgLiteResults.length}, GoogleNews: ${googleNewsResults.length}) for "${query}"`
        );
        return {
          success: true,
          output: {
            query,
            source: 'live_web',
            results: combined.slice(0, 8),
          },
        };
      }

      // 3. Graceful fallback if search engines returned no data
      return {
        success: true,
        output: {
          query,
          results: [
            {
              title: `نتائج عامة حول ${query}`,
              snippet: `تم البحث عن ${query} عبر محركات البحث، يرجى الاستعانة بأحدث الأخبار الموثوقة المنشورة في المواقع الرسمية.`,
            },
          ],
        },
      };
    } catch (err: any) {
      logger.error('Live web search encountered an error', { error: err.message, query });
      return {
        success: true,
        output: {
          query,
          error: 'تعذر الاتصال بمحرك البحث مؤقتاً، يرجى الاستعانة بالمعلومات العامة المتاحة.',
          results: [],
        },
      };
    }
  }

  /**
   * Official Google News RSS Search - 100% unblocked on Cloud/Vercel/AWS Lambda
   */
  public async searchGoogleNews(query: string, maxResults = 5): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2800);

    try {
      const isArabic = /[\u0600-\u06FF]/.test(query);
      const hl = isArabic ? 'ar' : 'en-US';
      let gl = 'US';
      let ceid = 'US:en';

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
        } else {
          // General Arabic region / Pan-Arab
          gl = 'EG';
          ceid = 'EG:ar';
        }
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
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g;
    const results: SearchResultItem[] = [];

    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null && results.length < maxResults) {
      const rawTitle = match[1] || '';
      const rawLink = match[2] || '';
      const pubDate = match[3] || '';

      const cleanTitle = rawTitle
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (cleanTitle) {
        results.push({
          title: cleanTitle,
          snippet: cleanTitle,
          url: rawLink.trim(),
        });
      }
    }

    return results;
  }

  /**
   * DuckDuckGo HTML Search - Ultra fast and rich snippets with prices & specs
   */
  public async searchDuckDuckGoHtml(query: string, maxResults = 8): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);

    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar-EG,ar;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
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
          });
        }
      }
    }

    return results;
  }

  public async searchDuckDuckGoLite(query: string, maxResults = 5): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en;q=0.9',
        },
        body: new URLSearchParams({ q: query }).toString(),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
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
      }));
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }
}
