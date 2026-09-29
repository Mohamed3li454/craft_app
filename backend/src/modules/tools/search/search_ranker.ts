/**
 * Search Ranker (Phase 9.3)
 *
 * Implements deterministic multi-factor scoring:
 * FinalScore = w_r * Relevance + w_f * Freshness + w_q * SourceQuality + w_e * EntityMatch - DuplicatePenalty
 *
 * Invariants:
 * - Deterministic, pure TypeScript.
 * - Weights are configured by SearchIntent.
 * - Historical queries have w_f = 0.0 (freshness never outranks historical facts).
 * - Official domains strictly outrank generic blogs.
 * - Entities must match in title/snippet/domain.
 */

import {
  NormalizedSearchResult,
  SearchIntent,
  SearchRankingWeights,
} from './search.types';

export const SEARCH_RANK_WEIGHTS: Record<SearchIntent, SearchRankingWeights> = {
  breaking_news: {
    relevance: 0.35,
    freshness: 0.40,
    sourceQuality: 0.15,
    entityMatch: 0.10,
  },
  latest_product: {
    relevance: 0.30,
    freshness: 0.30,
    sourceQuality: 0.20,
    entityMatch: 0.20,
  },
  technical_release: {
    relevance: 0.30,
    freshness: 0.25,
    sourceQuality: 0.30,
    entityMatch: 0.15,
  },
  technical_docs: {
    relevance: 0.35,
    freshness: 0.05,
    sourceQuality: 0.40,
    entityMatch: 0.20,
  },
  historical_fact: {
    relevance: 0.45,
    freshness: 0.00, // ZERO weight for freshness in historical queries
    sourceQuality: 0.35,
    entityMatch: 0.20,
  },
  evergreen_knowledge: {
    relevance: 0.50,
    freshness: 0.05,
    sourceQuality: 0.25,
    entityMatch: 0.20,
  },
  general_web: {
    relevance: 0.40,
    freshness: 0.20,
    sourceQuality: 0.25,
    entityMatch: 0.15,
  },
};

export class SearchRanker {
  private static readonly OFFICIAL_DOMAINS = new Set([
    'flutter.dev',
    'docs.flutter.dev',
    'dart.dev',
    'apple.com',
    'developer.apple.com',
    'google.com',
    'android.com',
    'developer.android.com',
    'microsoft.com',
    'github.com',
    'nodejs.org',
    'python.org',
    'react.dev',
    'rust-lang.org',
    'go.dev',
    'docker.com',
    'kubernetes.io',
    'w3.org',
  ]);

  private static readonly TECH_AUTHORITY_DOMAINS = new Set([
    'stackoverflow.com',
    'developer.mozilla.org',
    'w3schools.com',
    'geeksforgeeks.org',
    'infoq.com',
    'medium.com',
    'dev.to',
    'gsmarena.com',
    'macrumors.com',
    '9to5mac.com',
    'theverge.com',
    'arstechnica.com',
    'engadget.com',
    'xda-developers.com',
  ]);

  private static readonly HISTORICAL_REFERENCE_DOMAINS = new Set([
    'wikipedia.org',
    'ar.wikipedia.org',
    'en.wikipedia.org',
    'britannica.com',
    'history.com',
    'nationalgeographic.com',
    'archaeology.org',
    'worldhistory.org',
  ]);

  private static readonly REPUTABLE_NEWS_DOMAINS = new Set([
    'reuters.com',
    'bbc.com',
    'bbc.co.uk',
    'aljazeera.net',
    'ahram.org.eg',
    'gate.ahram.org.eg',
    'bloomberg.com',
    'youm7.com',
    'alarabiya.net',
    'skynewsarabia.com',
    'cnn.com',
    'apnews.com',
    'nytimes.com',
    'theguardian.com',
    'elwatannews.com',
    'almasryalyoum.com',
  ]);

  /**
   * Scores and sorts a list of search results according to intent and query relevance.
   */
  public static rank(
    results: NormalizedSearchResult[],
    query: string,
    intent: SearchIntent
  ): NormalizedSearchResult[] {
    const weights = SEARCH_RANK_WEIGHTS[intent] || SEARCH_RANK_WEIGHTS.general_web;
    const entities = this.extractEntities(query);

    const scored = results.map((item) => {
      const relevanceScore = this.calculateRelevance(item, query);
      const freshnessScore = this.calculateFreshness(item, intent);
      const sourceQualityScore = this.calculateSourceQuality(item, intent);
      const entityMatchScore = this.calculateEntityMatch(item, entities);

      // Historical Protection: Demote current breaking news headlines for historical queries
      let historicalDemotion = 0;
      if (intent === 'historical_fact') {
        const isNewsPortal = item.sourceDomain && this.REPUTABLE_NEWS_DOMAINS.has(item.sourceDomain);
        const hasBreakingKeywords = /(اليوم|الآن|عاجل|ساعات|تراجع|ارتفاع|أسعار|today|breaking|minutes ago)/i.test(
          item.title + ' ' + item.snippet
        );
        if (isNewsPortal && hasBreakingKeywords) {
          historicalDemotion = 0.30; // Heavy penalty for irrelevant recent news masquerading as historical facts
        }
      }

      const finalScore = Math.max(
        0,
        Math.min(
          1.0,
          weights.relevance * relevanceScore +
            weights.freshness * freshnessScore +
            weights.sourceQuality * sourceQualityScore +
            weights.entityMatch * entityMatchScore -
            historicalDemotion
        )
      );

      return {
        ...item,
        relevanceScore: Number(relevanceScore.toFixed(3)),
        freshnessScore: Number(freshnessScore.toFixed(3)),
        sourceQualityScore: Number(sourceQualityScore.toFixed(3)),
        entityMatchScore: Number(entityMatchScore.toFixed(3)),
        finalScore: Number(finalScore.toFixed(3)),
        isHistoricalProtected: intent === 'historical_fact',
      };
    });

    // Sort descending by finalScore
    scored.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
    return scored;
  }

  /**
   * Calculates relevance based on token overlap between query and title/snippet.
   */
  public static calculateRelevance(item: NormalizedSearchResult, query: string): number {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return 0.5;

    const titleTokens = new Set(this.tokenize(item.title));
    const snippetTokens = new Set(this.tokenize(item.snippet));

    let titleMatches = 0;
    let snippetMatches = 0;

    for (const token of queryTokens) {
      if (titleTokens.has(token)) titleMatches++;
      if (snippetTokens.has(token)) snippetMatches++;
    }

    const titleRatio = titleMatches / queryTokens.length;
    const snippetRatio = snippetMatches / queryTokens.length;

    // Title matches are weighted 2x compared to snippet matches
    let score = titleRatio * 0.65 + snippetRatio * 0.35;

    // Snippet richness bonus: informative snippets (> 50 chars with numbers or specifics)
    if (item.snippet && item.snippet.length > 50 && /\d/.test(item.snippet)) {
      score = Math.min(1.0, score + 0.1);
    }

    // Penalty for empty or generic fallback snippets
    if (!item.snippet || item.snippet.length < 20) {
      score = Math.max(0.1, score - 0.2);
    }

    return Math.min(1.0, Math.max(0.05, score));
  }

  /**
   * Calculates freshness score from publishedAt or timestamp.
   * If intent is historical_fact, returns neutral 0.5.
   */
  public static calculateFreshness(item: NormalizedSearchResult, intent: SearchIntent): number {
    if (intent === 'historical_fact') {
      return 0.5;
    }

    let timestamp = item.publishedTimestamp;

    if (!timestamp && item.publishedAt) {
      const parsed = Date.parse(item.publishedAt);
      if (!isNaN(parsed)) {
        timestamp = parsed;
      }
    }

    if (!timestamp) {
      if (intent === 'breaking_news') return 0.15;
      if (intent === 'evergreen_knowledge') return 0.50;
      return 0.30;
    }

    const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);

    if (ageHours <= 6) return 1.0;
    if (ageHours <= 24) return 0.95;
    if (ageHours <= 72) return 0.85; // 3 days
    if (ageHours <= 168) return 0.75; // 7 days
    if (ageHours <= 720) return 0.60; // 30 days
    if (ageHours <= 2160) return 0.45; // 90 days
    if (ageHours <= 8760) return 0.30; // 1 year
    return 0.15;
  }

  /**
   * Calculates source quality score based on domain authority and intent.
   */
  public static calculateSourceQuality(item: NormalizedSearchResult, intent: SearchIntent): number {
    const domain = (item.sourceDomain || '').toLowerCase();
    if (!domain) return 0.5;

    // 1. Official Documentation / Vendor Domains
    if (
      this.OFFICIAL_DOMAINS.has(domain) ||
      domain.endsWith('.gov') ||
      domain.endsWith('.gov.eg') ||
      domain.endsWith('.gov.sa') ||
      domain.endsWith('.edu') ||
      domain.endsWith('.edu.eg')
    ) {
      return 1.0;
    }

    // 2. Historical Reference & Encyclopedias
    if (this.HISTORICAL_REFERENCE_DOMAINS.has(domain)) {
      return intent === 'historical_fact' || intent === 'evergreen_knowledge' ? 0.95 : 0.80;
    }

    // 3. Recognized Tech Authority Domains
    if (this.TECH_AUTHORITY_DOMAINS.has(domain)) {
      return 0.85;
    }

    // 4. Reputable News Domains
    if (this.REPUTABLE_NEWS_DOMAINS.has(domain)) {
      // News domains are top tier for breaking news, but lower quality for historical facts
      if (intent === 'breaking_news' || intent === 'latest_product') {
        return 0.80;
      }
      if (intent === 'historical_fact') {
        return 0.40; // Historical queries prefer encyclopedias/history sources
      }
      return 0.70;
    }

    // 5. Generic Web Domain
    return 0.50;
  }

  /**
   * Calculates entity match score between query entities and result title/snippet/domain.
   */
  public static calculateEntityMatch(item: NormalizedSearchResult, entities: string[]): number {
    if (entities.length === 0) return 0.5;

    const targetText = `${item.title} ${item.snippet} ${item.sourceDomain || ''}`.toLowerCase();
    const normalizedTarget = targetText
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي');

    let matchedCount = 0;
    for (const entity of entities) {
      const normalizedEntity = entity
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');

      const withoutAl =
        normalizedEntity.startsWith('ال') && normalizedEntity.length > 4
          ? normalizedEntity.slice(2)
          : normalizedEntity;
      const withAl = normalizedEntity.startsWith('ال')
        ? normalizedEntity
        : 'ال' + normalizedEntity;

      if (
        normalizedTarget.includes(normalizedEntity) ||
        normalizedTarget.includes(withoutAl) ||
        normalizedTarget.includes(withAl)
      ) {
        matchedCount++;
      }
    }

    return Number((matchedCount / entities.length).toFixed(3));
  }

  /**
   * Extracts key entity candidates from query (filtering out common filler words).
   */
  public static extractEntities(query: string): string[] {
    const stopWords = new Set([
      'في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'تم', 'كان', 'كانت', 'يكون',
      'اللي', 'اللى', 'ده', 'دي', 'دا', 'عشان', 'علشان', 'بتاع', 'بتاعة', 'مش', 'أنه',
      'إنه', 'ان', 'أن', 'او', 'أو', 'ثم', 'حيث', 'لما', 'كل', 'بعد', 'قبل', 'هو', 'هي',
      'ما', 'هو', 'هي', 'كيف', 'متى', 'أين', 'هل', 'كم', 'ليه', 'كام', 'ايه', 'إيه',
      'the', 'is', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'about', 'to', 'for', 'how', 'what', 'why', 'when',
    ]);

    const words = query
      .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));

    return words;
  }

  private static tokenize(text: string): string[] {
    return (text || '')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }
}
