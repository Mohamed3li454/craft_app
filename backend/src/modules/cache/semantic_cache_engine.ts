import { normalizeMessage } from './text_normalizer';
import { LocalLanguageDetector } from './language_detector';
import { EmbeddingProvider } from './embedding/embedding.interface';
import { MockEmbeddingProvider } from './embedding/mock_embedding.provider';
import { EmbeddingFactory } from './embedding/embedding.factory';
import { SemanticCacheRepository } from '../../database/repositories/semantic_cache.repo';
import { TemplateEngine } from './template_engine';
import { isCacheEligible } from './cache_safety';
import { CacheContext, SemanticCacheResult, CacheMetricsEvent } from './cache.types';
import { CacheObservability } from './cache_observability';
import { logger } from '../../core/logger';

export interface SemanticCacheEngineOptions {
  allowMockInProduction?: boolean;
}

export class SemanticCacheEngine {
  private static instance: SemanticCacheEngine;

  constructor(
    private embeddingProvider: EmbeddingProvider = EmbeddingFactory.getSharedProvider(),
    private repo: SemanticCacheRepository = new SemanticCacheRepository(),
    private templateEngine: TemplateEngine = TemplateEngine.getInstance(),
    private options?: SemanticCacheEngineOptions
  ) {}

  public static getInstance(): SemanticCacheEngine {
    if (!SemanticCacheEngine.instance) {
      SemanticCacheEngine.instance = new SemanticCacheEngine();
    }
    return SemanticCacheEngine.instance;
  }

  /**
   * Main entrypoint for caching pipeline:
   * 1. Text Normalization
   * 2. Cache Eligibility Pre-checks (Deterministic safety rules)
   * 3. Language Detection (Deterministic)
   * 4. Production Embedding Availability Check
   * 5. Semantic Vector Lookup via pgvector
   * 6. Item Safety Rules Validation
   * 7. Response Strategy Selection & Template Rendering
   * 8. Safe Fallback to AI Router on any miss or error
   */
  public async process(rawText: string, context?: CacheContext): Promise<SemanticCacheResult> {
    const startTime = Date.now();

    if (!rawText || !rawText.trim()) {
      return { type: 'miss', reason: 'empty_query', latencyMs: 0 };
    }

    try {
      // 1. Text Normalization
      const { normalized } = normalizeMessage(rawText);

      // 2. Lightweight Deterministic Safety Gate FIRST (<0.05ms, Zero LLM / Zero Network / Zero DB)
      const eligibility = isCacheEligible(rawText, context);
      if (!eligibility.eligible) {
        const latencyMs = Date.now() - startTime;
        this.logEvent({
          event: (eligibility.reason as any) || 'semantic_miss',
          reason: eligibility.reason,
          latencyMs,
        });

        return {
          type: 'miss',
          reason: eligibility.reason || 'ineligible',
          latencyMs,
        };
      }

      // 4. Deterministic Language Resolution (Use passed LanguageContext or fall back to detector)
      const userLanguage =
        context?.languageContext?.targetLanguage ||
        LocalLanguageDetector.getInstance().detect(rawText).language ||
        'ar';

      // 5. Production Embedding Availability Check
      // MockEmbeddingProvider is strictly for tests/CI. In production, mock vectors must NOT match.
      const isProduction = process.env.NODE_ENV === 'production';
      const isMock = this.embeddingProvider instanceof MockEmbeddingProvider;
      if (isMock && isProduction && !this.options?.allowMockInProduction) {
        const latencyMs = Date.now() - startTime;
        this.logEvent({
          event: 'semantic_unavailable',
          reason: 'mock_provider_in_production',
          latencyMs,
        });

        return {
          type: 'miss',
          reason: 'semantic_unavailable',
          latencyMs,
        };
      }

      // 6. Generate Query Embedding
      let queryEmbedding: number[];
      try {
        queryEmbedding = await this.embeddingProvider.embed(normalized || rawText);
        if (
          !Array.isArray(queryEmbedding) ||
          queryEmbedding.length !== this.embeddingProvider.dimension ||
          queryEmbedding.some((v) => typeof v !== 'number' || !Number.isFinite(v))
        ) {
          throw new Error('Embedding provider returned invalid or non-finite vector');
        }
      } catch (embErr: any) {
        const latencyMs = Date.now() - startTime;
        logger.warn('Failed to generate embedding for semantic cache lookup, falling back to AI router', {
          error: embErr.message,
          latencyMs,
        });
        return {
          type: 'miss',
          reason: 'embedding_error',
          latencyMs,
        };
      }

      // 7. Semantic Vector Lookup via pgvector (Find Similar)
      const matches = await this.repo.findSimilar(queryEmbedding, {
        dimension: this.embeddingProvider.dimension,
        limit: 1,
      });

      if (!matches || matches.length === 0) {
        const latencyMs = Date.now() - startTime;
        this.logEvent({
          event: 'below_threshold',
          latencyMs,
        });

        return {
          type: 'miss',
          reason: 'below_threshold',
          latencyMs,
        };
      }

      const bestMatch = matches[0];
      const item = bestMatch.item;
      const similarity = bestMatch.similarity;

      // 8. Post-Retrieval Item Safety Rules
      if (!item.isActive || !item.isCacheable) {
        const latencyMs = Date.now() - startTime;
        this.logEvent({ event: 'semantic_miss', reason: 'uncacheable_item', latencyMs });
        return { type: 'miss', reason: 'uncacheable_item', latencyMs };
      }

      if (item.requiresSearch) {
        const latencyMs = Date.now() - startTime;
        this.logEvent({ event: 'ineligible_search', reason: 'requires_search', latencyMs });
        return { type: 'miss', reason: 'ineligible_search', latencyMs };
      }

      if (item.requiresUserContext) {
        const latencyMs = Date.now() - startTime;
        this.logEvent({ event: 'ineligible_user_context', reason: 'requires_user_context', latencyMs });
        return { type: 'miss', reason: 'ineligible_user_context', latencyMs };
      }

      // 9. Template Selection & Rendering
      const rawTemplate = this.templateEngine.selectTemplate(
        item.responseTemplates,
        userLanguage,
        item.response
      );

      if (!rawTemplate) {
        const latencyMs = Date.now() - startTime;
        this.logEvent({ event: 'semantic_miss', reason: 'missing_template', latencyMs });
        return { type: 'miss', reason: 'missing_template', latencyMs };
      }

      const renderResult = this.templateEngine.render(
        item.responseStrategy,
        rawTemplate,
        context,
        userLanguage
      );

      if (!renderResult.success || !renderResult.text) {
        const latencyMs = Date.now() - startTime;
        const reason = renderResult.reason || 'render_failed';
        this.logEvent({
          event: reason === 'strategy_ai_fallback' ? 'fallback_to_ai' : 'semantic_miss',
          reason,
          latencyMs,
        });

        return {
          type: 'miss',
          reason,
          latencyMs,
        };
      }

      // 10. Cache Hit Success
      // Record hit asynchronously without blocking response
      this.repo.recordHit(item.id);

      const latencyMs = Date.now() - startTime;
      this.logEvent({
        event: 'semantic_hit',
        source: 'semantic',
        intent: item.intent,
        strategy: item.responseStrategy,
        similarity,
        threshold: item.confidenceThreshold,
        latencyMs,
      });

      return {
        type: 'hit',
        source: 'semantic',
        response: renderResult.text,
        intent: item.intent,
        strategy: item.responseStrategy,
        similarity,
        language: userLanguage,
        itemId: item.id,
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.warn('Unexpected error in SemanticCacheEngine, falling back safely to AI router', {
        error: err.message,
        latencyMs,
      });

      return {
        type: 'miss',
        reason: 'cache_engine_error',
        latencyMs,
      };
    }
  }

  /**
   * Sanitized observability logger.
   * NEVER logs raw text, personal data, embeddings, or keys.
   */
  private logEvent(event: CacheMetricsEvent): void {
    logger.info('CacheEngineEvent', {
      event: event.event,
      source: event.source,
      intent: event.intent,
      strategy: event.strategy,
      similarity: event.similarity !== undefined ? parseFloat(event.similarity.toFixed(4)) : undefined,
      threshold: event.threshold,
      reason: event.reason,
      latencyMs: event.latencyMs,
    });

    CacheObservability.getInstance()
      .recordCacheEvent(event)
      .catch((err) => {
        logger.warn('Failed to record cache metrics event to observability store', { error: err.message });
      });
  }
}
