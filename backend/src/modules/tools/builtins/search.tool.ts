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
    'Searches the live web for the latest news, actual product releases, device specs, leaks, rumors, gold/currency prices, and real-time events.';
  public readonly isSensitive = false;
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query to look up on the live web',
      },
    },
    required: ['query'],
  };

  public async execute(
    args: Record<string, any>,
    _context: ToolContext
  ): Promise<ToolExecutionResult> {
    const query = (args.query || '').trim();
    if (!query) {
      return { success: false, error: 'Empty search query' };
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

      // 2. Hybrid Search: Run Google News RSS + DuckDuckGo Lite in parallel
      // Google News RSS is 100% unblocked on Vercel/AWS and provides real-time prices & news
      const [googleNewsResults, ddgResults] = await Promise.all([
        this.searchGoogleNews(query, 5),
        this.searchDuckDuckGoLite(query, 5),
      ]);

      const combined: SearchResultItem[] = [];
      const seenTitles = new Set<string>();

      for (const item of [...googleNewsResults, ...ddgResults]) {
        const normalized = item.title.toLowerCase().trim();
        if (!seenTitles.has(normalized)) {
          seenTitles.add(normalized);
          combined.push(item);
        }
      }

      if (combined.length > 0) {
        logger.info(`Live web search returned [${combined.length}] results (GoogleNews: ${googleNewsResults.length}, DDG: ${ddgResults.length}) for "${query}"`);
        return {
          success: true,
          output: {
            query,
            source: googleNewsResults.length > 0 ? 'google_news_and_web' : 'duckduckgo',
            results: combined.slice(0, 6),
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
    const timeout = setTimeout(() => controller.abort(), 4500);

    try {
      const isArabic = /[\u0600-\u06FF]/.test(query);
      const hl = isArabic ? 'ar' : 'en-US';
      const gl = isArabic ? 'EG' : 'US';
      const ceid = isArabic ? 'EG:ar' : 'US:en';

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
      return this.parseGoogleNewsRss(xml, maxResults);
    } catch {
      clearTimeout(timeout);
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
          snippet: `تاريخ الخبر: ${pubDate}. تفاصيل التقرير: ${cleanTitle}`,
          url: rawLink.trim(),
        });
      }
    }

    return results;
  }

  public async searchDuckDuckGoLite(query: string, maxResults = 5): Promise<SearchResultItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

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
