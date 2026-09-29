/**
 * Phase 9.3: Search Intelligence V2 Test Suite
 *
 * Comprehensive verification of:
 * 1. SearchIntent Classification (7 intents: latest_product, breaking_news, technical_release, technical_docs, historical_fact, evergreen_knowledge, general_web)
 * 2. SearchQueryPlanner & Provider Routing
 * 3. Deterministic Freshness Scoring & Age Decay
 * 4. Historical Query Protection (News never outranks historical facts)
 * 5. Source Quality Scoring (Official > Technical Authority > Reputable News > Generic)
 * 6. Entity Matching with Arabic and English normalization
 * 7. Multi-level Deduplication (URL, tracking params, uddg decoding, title suffixes)
 * 8. Google News RSS Improvements (pubDate, sourceName, sourceDomain)
 * 9. DuckDuckGo Resilience (HTTP 202, empty response, anti-bot challenge)
 * 10. Bounded 1-Shot Search Refinement (Max 1 attempt, no infinite loops)
 * 11. SearchFallbackFormatter & Synthesis Zero-Loss Integration
 */

import { SearchIntentClassifier } from '../src/modules/tools/search/search_intent_classifier';
import { SearchQueryPlanner } from '../src/modules/tools/search/search_query_planner';
import { SearchRanker } from '../src/modules/tools/search/search_ranker';
import { SearchDeduplicator } from '../src/modules/tools/search/search_deduplicator';
import { SearchRefiner } from '../src/modules/tools/search/search_refiner';
import { WebSearchTool } from '../src/modules/tools/builtins/search.tool';
import { SearchFallbackFormatter } from '../src/modules/tools/adapters/search_fallback_formatter';
import { NormalizedSearchResult } from '../src/modules/tools/search/search.types';

describe('Phase 9.3: Search Intelligence V2 Suite', () => {
  let tool: WebSearchTool;

  beforeEach(() => {
    tool = new WebSearchTool();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. SearchIntent Classification
  // =========================================================================
  describe('1. SearchIntent Classification', () => {
    test('1.1: classifies "آخر إصدار من Flutter" as technical_release', () => {
      const intent = SearchIntentClassifier.classify('آخر إصدار من Flutter');
      expect(intent).toBe('technical_release');
    });

    test('1.2: classifies "أحدث أخبار Apple" as breaking_news', () => {
      const intent = SearchIntentClassifier.classify('أحدث أخبار Apple');
      expect(intent).toBe('breaking_news');
    });

    test('1.3: classifies "ما هو تاريخ بناء الأهرامات؟" as historical_fact', () => {
      const intent = SearchIntentClassifier.classify('ما هو تاريخ بناء الأهرامات؟');
      expect(intent).toBe('historical_fact');
    });

    test('1.4: classifies "How does Flutter rendering work?" as evergreen_knowledge', () => {
      const intent = SearchIntentClassifier.classify('How does Flutter rendering work?');
      expect(intent).toBe('evergreen_knowledge');
    });

    test('1.5: classifies "Flutter official documentation" as technical_docs', () => {
      const intent = SearchIntentClassifier.classify('Flutter official documentation');
      expect(intent).toBe('technical_docs');
    });

    test('1.6: classifies breaking news query as breaking_news', () => {
      const intent = SearchIntentClassifier.classify('عاجل: نتائج الانتخابات الأمريكية اليوم');
      expect(intent).toBe('breaking_news');
    });

    test('1.7: classifies generic web query as general_web', () => {
      const intent = SearchIntentClassifier.classify('أفضل أماكن للخروج في القاهرة');
      expect(intent).toBe('general_web');
    });

    test('1.8: classifies product specs/prices as latest_product', () => {
      const intent = SearchIntentClassifier.classify('سعر ومواصفات iPhone 16 Pro Max');
      expect(intent).toBe('latest_product');
    });
  });

  // =========================================================================
  // 2. Query Planning & Provider Routing
  // =========================================================================
  describe('2. Query Planning & Provider Routing', () => {
    test('2.1: strips conversational fluff and padding from Arabic & English queries', () => {
      const planAr = SearchQueryPlanner.plan('لو سمحت دورلي على مواصفات آيفون 16');
      expect(planAr.plannedQuery).toBe('مواصفات آيفون 16');

      const planEn = SearchQueryPlanner.plan('Please search for latest Flutter release');
      expect(planEn.plannedQuery).toBe('latest Flutter release');
    });

    test('2.2: provider routing assigns Google News for breaking_news', () => {
      const plan = SearchQueryPlanner.plan('عاجل: زلزال جديد في البحر المتوسط اليوم');
      expect(plan.intent).toBe('breaking_news');
      expect(plan.preferredProvider).toBe('google_news');
    });

    test('2.3: provider routing assigns DuckDuckGo for historical_fact (NEVER Google News)', () => {
      const plan = SearchQueryPlanner.plan('تاريخ بناء الأهرامات في مصر القديمة');
      expect(plan.intent).toBe('historical_fact');
      expect(plan.preferredProvider).toBe('duckduckgo');
      expect(plan.preferredProvider).not.toBe('google_news');
    });

    test('2.4: detects geo-targeting from query keywords and language context', () => {
      const planKsa = SearchQueryPlanner.plan('سعر الذهب اليوم في السعودية');
      expect(planKsa.geoTargeting).toBe('SA');

      const planEg = SearchQueryPlanner.plan('مؤشر البورصة المصرية اليوم');
      expect(planEg.geoTargeting).toBe('EG');
    });

    test('2.5: generates focused alternative query for technical releases', () => {
      const plan = SearchQueryPlanner.plan('آخر إصدار مستقر من Flutter');
      expect(plan.alternativeQuery).toBeDefined();
      expect(plan.alternativeQuery).toContain('Flutter latest stable release official');
    });
  });

  // =========================================================================
  // 3. Freshness Scoring & Age Decay
  // =========================================================================
  describe('3. Freshness Scoring & Age Decay', () => {
    test('3.1: computes high freshness for recent articles and decays over time', () => {
      const now = Date.now();
      const itemRecent: NormalizedSearchResult = {
        title: 'Breaking News',
        snippet: 'Just happened',
        url: 'https://example.com/1',
        publishedTimestamp: now - 2 * 60 * 60 * 1000, // 2 hours ago
      };
      const item3Days: NormalizedSearchResult = {
        title: 'News 3 days ago',
        snippet: 'Earlier this week',
        url: 'https://example.com/2',
        publishedTimestamp: now - 48 * 60 * 60 * 1000, // 48 hours ago
      };
      const itemOld: NormalizedSearchResult = {
        title: 'Old article',
        snippet: 'From last year',
        url: 'https://example.com/3',
        publishedTimestamp: now - 400 * 24 * 60 * 60 * 1000, // > 1 year ago
      };

      const scoreRecent = SearchRanker.calculateFreshness(itemRecent, 'breaking_news');
      const score3Days = SearchRanker.calculateFreshness(item3Days, 'breaking_news');
      const scoreOld = SearchRanker.calculateFreshness(itemOld, 'breaking_news');

      expect(scoreRecent).toBeGreaterThanOrEqual(0.95);
      expect(score3Days).toBeGreaterThan(scoreOld);
      expect(scoreOld).toBeLessThanOrEqual(0.20);
    });

    test('3.2: historical_fact assigns neutral 0.5 freshness to all items', () => {
      const now = Date.now();
      const itemRecent: NormalizedSearchResult = {
        title: 'Pyramids news today',
        snippet: 'Tourist event',
        url: 'https://news.com/pyramids',
        publishedTimestamp: now - 3600 * 1000,
      };
      const score = SearchRanker.calculateFreshness(itemRecent, 'historical_fact');
      expect(score).toBe(0.5);
    });
  });

  // =========================================================================
  // 4. Historical Query Protection
  // =========================================================================
  describe('4. Historical Query Protection', () => {
    test('4.1: encyclopedia historical article outranks fresh news headline about pyramids', () => {
      const query = 'ما هو تاريخ بناء الأهرامات في مصر؟';
      const items: NormalizedSearchResult[] = [
        {
          title: 'أسعار تذاكر الأهرامات اليوم الإثنين - أخبار عاجلة',
          snippet: 'أعلنت وزارة السياحة اليوم أسعار تذاكر دخول الأهرامات مع تراجع في الإقبال.',
          url: 'https://ahram.org.eg/news/pyramids-tickets-today',
          sourceDomain: 'ahram.org.eg',
          publishedTimestamp: Date.now() - 3600 * 1000, // 1 hour ago
        },
        {
          title: 'تاريخ بناء الأهرامات المصرية - ويكيبيديا الموسوعة الحرة',
          snippet: 'تم بناء أهرامات الجيزة في عصر الأسرة الرابعة في مصر القديمة كمدفن للفراعنة خوفو وخفرع ومنقرع.',
          url: 'https://ar.wikipedia.org/wiki/تاريخ_بناء_الأهرامات',
          sourceDomain: 'ar.wikipedia.org',
          publishedTimestamp: Date.now() - 500 * 24 * 3600 * 1000, // 500 days ago
        },
      ];

      const ranked = SearchRanker.rank(items, query, 'historical_fact');

      expect(ranked).toHaveLength(2);
      expect(ranked[0].sourceDomain).toBe('ar.wikipedia.org');
      expect(ranked[0].title).toContain('تاريخ بناء الأهرامات');
      expect(ranked[0].isHistoricalProtected).toBe(true);
      expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore!);
    });
  });

  // =========================================================================
  // 5. Source Quality Scoring
  // =========================================================================
  describe('5. Source Quality Scoring', () => {
    test('5.1: official tech documentation strictly outranks generic blogs', () => {
      const officialItem: NormalizedSearchResult = {
        title: 'Flutter Documentation - Official Guide',
        snippet: 'Official Flutter framework guides and SDK references',
        url: 'https://docs.flutter.dev/get-started',
        sourceDomain: 'docs.flutter.dev',
      };
      const genericItem: NormalizedSearchResult = {
        title: 'Flutter Guide - Medium Blog',
        snippet: 'Personal blog post about Flutter setup',
        url: 'https://some-personal-blog.com/flutter',
        sourceDomain: 'some-personal-blog.com',
      };

      const officialScore = SearchRanker.calculateSourceQuality(officialItem, 'technical_docs');
      const genericScore = SearchRanker.calculateSourceQuality(genericItem, 'technical_docs');

      expect(officialScore).toBe(1.0);
      expect(genericScore).toBe(0.5);
      expect(officialScore).toBeGreaterThan(genericScore);
    });
  });

  // =========================================================================
  // 6. Entity Matching
  // =========================================================================
  describe('6. Entity Matching', () => {
    test('6.1: matches entities with Arabic diacritics and letter variations', () => {
      const entities = ['الأهرامات', 'خوفو'];
      const matchingItem: NormalizedSearchResult = {
        title: 'بناء اهرامات الجيزة والملك خوفو',
        snippet: 'معلومات تاريخية مفصلة عن عصر الفراعنة',
        url: 'https://example.com/history',
      };
      const nonMatchingItem: NormalizedSearchResult = {
        title: 'برج القاهرة وتاريخ إنشائه',
        snippet: 'معلومات عامة عن القاهرة',
        url: 'https://example.com/cairo',
      };

      const matchScore = SearchRanker.calculateEntityMatch(matchingItem, entities);
      const noMatchScore = SearchRanker.calculateEntityMatch(nonMatchingItem, entities);

      expect(matchScore).toBe(1.0);
      expect(noMatchScore).toBe(0.0);
    });
  });

  // =========================================================================
  // 7. Multi-level Deduplication
  // =========================================================================
  describe('7. Multi-level Deduplication', () => {
    test('7.1: eliminates duplicate URLs with tracking query parameters', () => {
      const items: NormalizedSearchResult[] = [
        {
          title: 'Apple Announces M4 MacBook Pro',
          snippet: 'New chips with faster performance',
          url: 'https://theverge.com/apple-macbook-m4?utm_source=twitter&utm_medium=social&session_id=abc1234',
        },
        {
          title: 'Apple Announces M4 MacBook Pro',
          snippet: 'New chips with faster performance',
          url: 'https://theverge.com/apple-macbook-m4?gclid=xyz9876&fbclid=fb_555',
        },
      ];

      const deduped = SearchDeduplicator.deduplicate(items);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].url).toBe('https://theverge.com/apple-macbook-m4');
    });

    test('7.2: decodes DuckDuckGo uddg redirect URLs', () => {
      const rawUrl = 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fflutter.dev%2Fdevelopment&rut=xyz';
      const normalized = SearchDeduplicator.normalizeUrl(rawUrl);
      expect(normalized).toBe('https://flutter.dev/development');
    });

    test('7.3: strips publication suffixes from titles for accurate deduplication', () => {
      const norm1 = SearchDeduplicator.normalizeTitle('أسعار الذهب اليوم في مصر - بوابة الأهرام');
      const norm2 = SearchDeduplicator.normalizeTitle('أسعار الذهب اليوم في مصر - اليوم السابع');
      expect(norm1).toBe(norm2);
    });
  });

  // =========================================================================
  // 8. Google News RSS Improvements
  // =========================================================================
  describe('8. Google News RSS Improvements', () => {
    test('8.1: extracts pubDate, sourceName, and sourceDomain from RSS XML', () => {
      const xml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>Google announces Gemini 2.0 - TechCrunch</title>
              <link>https://news.google.com/rss/articles/CBMi999?utm_source=rss</link>
              <pubDate>Mon, 28 Sep 2026 12:00:00 GMT</pubDate>
              <source url="https://techcrunch.com">TechCrunch</source>
            </item>
          </channel>
        </rss>
      `;

      const results = tool.parseGoogleNewsRss(xml, 5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Google announces Gemini 2.0 - TechCrunch');
      expect(results[0].sourceName).toBe('TechCrunch');
      expect(results[0].sourceDomain).toBe('techcrunch.com');
      expect(results[0].publishedAt).toBe('2026-09-28T12:00:00.000Z');
      expect(results[0].publishedTimestamp).toBe(Date.parse('Mon, 28 Sep 2026 12:00:00 GMT'));
    });
  });

  // =========================================================================
  // 9. DuckDuckGo Resilience
  // =========================================================================
  describe('9. DuckDuckGo Resilience', () => {
    test('9.1: handles HTTP 202 without body safely and returns empty array', async () => {
      // Mock global fetch returning HTTP 202
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 202,
        statusText: 'Accepted',
        text: async () => '',
      } as any);

      const results = await tool.searchDuckDuckGoHtml('any query', 5);
      expect(results).toEqual([]);
    });

    test('9.2: handles anti-bot challenge response gracefully without crashing', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html><body><div id="challenge-form">Please verify you are human captcha</div></body></html>',
      } as any);

      const results = await tool.searchDuckDuckGoLite('any query', 5);
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // 10. Bounded 1-Shot Search Refinement
  // =========================================================================
  describe('10. Bounded 1-Shot Search Refinement', () => {
    test('10.1: triggers refinement when result count is low (< 2)', () => {
      const plan = SearchQueryPlanner.plan('آخر إصدار من Flutter');
      const sparseResults: NormalizedSearchResult[] = [
        {
          title: 'Flutter old note',
          snippet: 'Brief note',
          url: 'https://example.com/1',
        },
      ];

      const decision = SearchRefiner.evaluate(sparseResults, plan, false);
      expect(decision.shouldRefine).toBe(true);
      expect(decision.refinementQuery).toBe(plan.alternativeQuery);
      expect(decision.reason).toBe('low_result_count');
    });

    test('10.2: strictly bounds refinement to maximum 1 attempt (alreadyRefined guard)', () => {
      const plan = SearchQueryPlanner.plan('آخر إصدار من Flutter');
      const sparseResults: NormalizedSearchResult[] = [];

      const decision = SearchRefiner.evaluate(sparseResults, plan, true);
      expect(decision.shouldRefine).toBe(false);
      expect(decision.reason).toBe('already_refined');
    });
  });

  // =========================================================================
  // 11. Zero-Loss Synthesis Fallback Integration
  // =========================================================================
  describe('11. Zero-Loss Synthesis Fallback Integration', () => {
    test('11.1: SearchFallbackFormatter converts ranked results into deterministic WhatsApp markdown', () => {
      const rankedItems: NormalizedSearchResult[] = [
        {
          title: 'Flutter 3.24 Released with Impeller on Android',
          snippet: 'Google released Flutter 3.24 with major performance upgrades and Swift Package Manager support.',
          url: 'https://docs.flutter.dev/release/whats-new?utm_source=feed',
          sourceDomain: 'docs.flutter.dev',
          finalScore: 0.95,
        },
        {
          title: 'What is new in Flutter 3.24',
          snippet: 'Detailed breakdown of the new stable release for Flutter and Dart 3.5.',
          url: 'https://medium.com/flutter/whats-new-3-24',
          sourceDomain: 'medium.com',
          finalScore: 0.88,
        },
      ];

      const markdown = SearchFallbackFormatter.format({ results: rankedItems }, { targetLanguage: 'ar' } as any);

      expect(markdown).toContain('إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:');
      expect(markdown).toContain('*Flutter 3.24 Released with Impeller on Android*');
      expect(markdown).toContain('🌐 docs.flutter.dev');
      expect(markdown).toContain('🔗 https://docs.flutter.dev/release/whats-new');
      expect(markdown).not.toContain('utm_source=feed');
      expect(markdown).not.toContain('0.95');
    });
  });
});
