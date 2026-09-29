/**
 * Search Intelligence V2 Types (Phase 9.3)
 */

export type SearchIntent =
  | 'latest_product'
  | 'breaking_news'
  | 'technical_release'
  | 'technical_docs'
  | 'historical_fact'
  | 'evergreen_knowledge'
  | 'general_web';

export type PreferredSearchProvider =
  | 'google_news'
  | 'duckduckgo'
  | 'general_web'
  | 'official_docs';

export interface FreshnessTarget {
  maxAgeMinutes?: number;
  maxAgeHours?: number;
  maxAgeDays?: number;
}

export interface SearchQueryPlan {
  rawUserQuery: string;
  plannedQuery: string;
  alternativeQuery?: string;
  intent: SearchIntent;
  languageConstraint?: string;
  geoTargeting?: string;
  freshnessTarget?: FreshnessTarget;
  preferredProvider: PreferredSearchProvider;
}

export interface NormalizedSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  publishedTimestamp?: number;
  sourceName?: string;
  sourceDomain?: string;
  relevanceScore?: number;
  freshnessScore?: number;
  sourceQualityScore?: number;
  entityMatchScore?: number;
  finalScore?: number;
  isHistoricalProtected?: boolean;
}

export interface SearchRankingWeights {
  relevance: number;
  freshness: number;
  sourceQuality: number;
  entityMatch: number;
}

export interface SearchIntentConfig {
  intent: SearchIntent;
  weights: SearchRankingWeights;
  preferredProvider: PreferredSearchProvider;
  freshnessTarget?: FreshnessTarget;
  protectHistorical?: boolean;
}
