import { ResponseStrategy } from '../../database/repositories/semantic_cache.types';

export interface CacheContext {
  userId?: string;
  userName?: string;
  conversationId?: string;
  recentMessages?: string[];
  previousIntent?: string;
  channel?: string;
  slots?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export type SemanticCacheResult =
  | {
      type: 'hit';
      response: string;
      intent?: string;
      strategy: ResponseStrategy;
      similarity?: number;
      language?: string;
      source: 'exact' | 'semantic';
      itemId?: string;
      latencyMs?: number;
    }
  | {
      type: 'miss';
      reason: string;
      latencyMs?: number;
    };

export interface CacheSafetyCheckResult {
  eligible: boolean;
  reason?: string;
}

export interface CacheMetricsEvent {
  event:
    | 'exact_hit'
    | 'semantic_hit'
    | 'semantic_miss'
    | 'semantic_unavailable'
    | 'below_threshold'
    | 'ineligible_dynamic'
    | 'ineligible_user_context'
    | 'ineligible_search'
    | 'ineligible_tool'
    | 'response_strategy'
    | 'fallback_to_ai';
  source?: 'exact' | 'semantic';
  intent?: string;
  language?: string;
  strategy?: ResponseStrategy;
  similarity?: number;
  threshold?: number;
  latencyMs?: number;
  reason?: string;
}
