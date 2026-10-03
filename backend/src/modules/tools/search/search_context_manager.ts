/**
 * Search Context Manager
 *
 * Maintains conversation-scoped search history in memory with optional database fallback.
 * Allows follow-up requests ("هات المصادر", "طب اللينك؟") to immediately reference
 * prior search results without re-executing an unnecessary network search.
 */

import { NormalizedSearchItem, SearchFallbackFormatter } from '../adapters/search_fallback_formatter';
import { logger } from '../../../core/logger';

export interface StoredSearchContext {
  conversationId: string;
  query: string;
  results: NormalizedSearchItem[];
  timestamp: number;
}

export class SearchContextManager {
  private static store = new Map<string, StoredSearchContext>();

  /**
   * Caches the latest successful search results for a conversation.
   */
  public static setLatestSearch(
    conversationId: string,
    query: string,
    rawResult: any
  ): void {
    if (!conversationId) return;
    try {
      const items = SearchFallbackFormatter.extractItems(rawResult);
      if (items.length > 0) {
        this.store.set(conversationId, {
          conversationId,
          query,
          results: items,
          timestamp: Date.now(),
        });
        logger.debug(
          `Cached latest search context for conversation [${conversationId}] (${items.length} items)`
        );
      }
    } catch (e: any) {
      logger.warn('Failed to extract search items for context cache', { error: e.message });
    }
  }

  /**
   * Retrieves the latest search context from memory for a conversation.
   */
  public static getLatestSearch(conversationId: string): StoredSearchContext | undefined {
    if (!conversationId) return undefined;
    return this.store.get(conversationId);
  }

  /**
   * Retrieves latest search context with fallback to database if memory was cleared.
   */
  public static async getLatestSearchWithDbFallback(
    conversationId: string,
    chatRepo?: any
  ): Promise<StoredSearchContext | undefined> {
    const memory = this.getLatestSearch(conversationId);
    if (memory) return memory;

    if (chatRepo && typeof chatRepo.getLatestToolCall === 'function') {
      try {
        const row = await chatRepo.getLatestToolCall(conversationId, 'web_search');
        if (row && row.result) {
          const items = SearchFallbackFormatter.extractItems(row.result);
          if (items.length > 0) {
            const context: StoredSearchContext = {
              conversationId,
              query: row.arguments?.query || '',
              results: items,
              timestamp: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
            };
            this.store.set(conversationId, context);
            return context;
          }
        }
      } catch (err: any) {
        logger.debug('Db fallback for search context failed (safely ignored)', {
          error: err.message,
        });
      }
    }

    return undefined;
  }

  /**
   * Clears context for testing or session reset.
   */
  public static clear(conversationId?: string): void {
    if (conversationId) {
      this.store.delete(conversationId);
    } else {
      this.store.clear();
    }
  }
}
