export type ResponseStrategy =
  | 'static'
  | 'dynamic_template'
  | 'contextual_template'
  | 'slot_based'
  | 'ai_fallback';

export interface SemanticCacheItem {
  id: string;
  intent: string;
  category: string;
  title: string;
  examples: string[];
  patterns: string[];
  response: string;
  responseStrategy: ResponseStrategy;
  responseTemplates: Record<string, string[]>;
  matchType: 'contains' | 'exact';
  isCacheable: boolean;
  isDynamic: boolean;
  requiresSearch: boolean;
  requiresUserContext: boolean;
  confidenceThreshold: number;
  embedding?: number[] | null;
  embeddingDimension?: number | null;
  isActive: boolean;
  hitCount: number;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticCacheMatch {
  item: SemanticCacheItem;
  similarity: number;
}

export interface FindSimilarOptions {
  threshold?: number; // Optional caller-specified minimum similarity filter
  limit?: number;     // Max results to return (default 3)
  category?: string;  // Optional category filter
  dimension?: number; // Expected vector dimension
}

export interface CreateSemanticCacheDto {
  intent?: string;
  category?: string;
  title: string;
  examples?: string[];
  patterns?: string[];
  response: string;
  responseStrategy?: ResponseStrategy;
  responseTemplates?: Record<string, string[]>;
  matchType?: 'contains' | 'exact';
  isCacheable?: boolean;
  isDynamic?: boolean;
  requiresSearch?: boolean;
  requiresUserContext?: boolean;
  confidenceThreshold?: number;
  embedding?: number[];
  embeddingDimension?: number;
  isActive?: boolean;
}

export interface UpdateSemanticCacheDto {
  intent?: string;
  category?: string;
  title?: string;
  examples?: string[];
  patterns?: string[];
  response?: string;
  responseStrategy?: ResponseStrategy;
  responseTemplates?: Record<string, string[]>;
  matchType?: 'contains' | 'exact';
  isCacheable?: boolean;
  isDynamic?: boolean;
  requiresSearch?: boolean;
  requiresUserContext?: boolean;
  confidenceThreshold?: number;
  embedding?: number[] | null;
  embeddingDimension?: number | null;
  isActive?: boolean;
}
