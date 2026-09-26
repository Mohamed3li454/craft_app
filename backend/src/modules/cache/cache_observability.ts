import { DatabaseManager } from '../../database/connection';
import { CacheMetricsEvent } from './cache.types';
import { LearningMetricPayload } from './learning/learning_metrics';
import { logger } from '../../core/logger';

export interface CandidateStats {
  total: number;
  pending: number;
  validated: number;
  rejected: number;
  promoted: number;
  promotionEligible: number;
  stale: number;
  conflicts: number;
  timeWindow?: { from?: string; to?: string };
}

export interface CacheStats {
  exactHits: number;
  semanticHits: number;
  misses: number;
  cacheEligibleRequests: number;
  cacheIneligibleRequests: number;
  hitRate: number;
  eligibleHitRate: number;
  semanticAverageSimilarity: number;
  semanticBelowThreshold: number;
  semanticUnavailable: number;
  timeWindow?: { from?: string; to?: string };
}

export interface PromotionStats {
  totalCandidates: number;
  promoted: number;
  rejected: number;
  validated: number;
  promotionRate: number;
  rejectionRate: number;
  timeWindow?: { from?: string; to?: string };
}

export interface LearningStats {
  candidatesCreated: number;
  candidatesRejected: number;
  candidatesValidated: number;
  candidatesPromoted: number;
  promotionEligible: number;
  aiRequestsAvoided: number;
  timeWindow?: { from?: string; to?: string };
}

export class CacheObservability {
  private static instance: CacheObservability;
  private inMemoryCacheEvents: Array<CacheMetricsEvent & { timestamp: string }> = [];

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public static getInstance(): CacheObservability {
    if (!CacheObservability.instance) {
      CacheObservability.instance = new CacheObservability();
    }
    return CacheObservability.instance;
  }

  /**
   * Persists a cache metrics event cleanly without any raw user text or sensitive tokens.
   */
  public async recordCacheEvent(event: CacheMetricsEvent): Promise<void> {
    const timestamp = new Date().toISOString();
    const pool = this.db.getPool();

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO semantic_cache_metrics_events (
            event_type, source, intent, language, similarity,
            threshold, reason, latency_ms, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            event.event,
            event.source || null,
            event.intent || null,
            event.language || null,
            event.similarity !== undefined ? event.similarity : null,
            event.threshold !== undefined ? event.threshold : null,
            event.reason || null,
            event.latencyMs || 0,
          ]
        );
      } catch (err: any) {
        logger.warn('Failed to insert semantic_cache_metrics_events in DB, saving in-memory', {
          error: err.message,
        });
        this.inMemoryCacheEvents.push({ ...event, timestamp });
      }
    } else {
      this.inMemoryCacheEvents.push({ ...event, timestamp });
    }
  }

  /**
   * Records human/admin feedback flagging a cache result as incorrect (False Positive).
   * Does NOT claim arbitrary automated ground truth; relies purely on explicit feedback.
   */
  public async markCacheResultAsIncorrect(
    cacheEntryId: string,
    reason: string,
    actorId?: string
  ): Promise<void> {
    await this.recordCacheEvent({
      event: 'semantic_miss',
      source: 'semantic',
      reason: `false_positive_feedback: ${reason || 'unspecified'}`,
      latencyMs: 0,
    });

    logger.info('Cache false positive flagged by reviewer', {
      cacheEntryId,
      reason,
      actorId,
    });
  }

  /**
   * Computes aggregated candidate status distribution with time-window support.
   * Utilizes database SQL aggregations rather than pulling all rows into Node.js memory.
   */
  public async getCandidateStats(filter?: { from?: string; to?: string }): Promise<CandidateStats> {
    const pool = this.db.getPool();
    if (pool) {
      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (filter?.from) {
        conditions.push(`created_at >= $${idx++}`);
        values.push(filter.from);
      }
      if (filter?.to) {
        conditions.push(`created_at <= $${idx++}`);
        values.push(filter.to);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'validated') as validated,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE status = 'promoted') as promoted,
          COUNT(*) FILTER (WHERE promotion_eligible = true) as promotion_eligible,
          COUNT(*) FILTER (WHERE conflict_count > 0) as conflicts,
          COUNT(*) FILTER (WHERE last_observed_at <= NOW() - INTERVAL '90 days') as stale
        FROM semantic_cache_candidates
        ${whereClause}
      `;

      const res = await pool.query(query, values);
      const row = res.rows[0] || {};

      return {
        total: parseInt(row.total || '0', 10),
        pending: parseInt(row.pending || '0', 10),
        validated: parseInt(row.validated || '0', 10),
        rejected: parseInt(row.rejected || '0', 10),
        promoted: parseInt(row.promoted || '0', 10),
        promotionEligible: parseInt(row.promotion_eligible || '0', 10),
        conflicts: parseInt(row.conflicts || '0', 10),
        stale: parseInt(row.stale || '0', 10),
        timeWindow: filter,
      };
    }

    // In-memory fallback
    return {
      total: 0,
      pending: 0,
      validated: 0,
      rejected: 0,
      promoted: 0,
      promotionEligible: 0,
      stale: 0,
      conflicts: 0,
      timeWindow: filter,
    };
  }

  /**
   * Computes accurate Cache Hit Rates and performance indicators.
   * STRICT SEPARATION: Ineligible dynamic queries are counted as cacheIneligibleRequests, NEVER as misses!
   * Handles division by zero safely.
   */
  public async getCacheStats(filter?: { from?: string; to?: string }): Promise<CacheStats> {
    const pool = this.db.getPool();
    if (pool) {
      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (filter?.from) {
        conditions.push(`created_at >= $${idx++}`);
        values.push(filter.from);
      }
      if (filter?.to) {
        conditions.push(`created_at <= $${idx++}`);
        values.push(filter.to);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'exact_hit') as exact_hits,
          COUNT(*) FILTER (WHERE event_type = 'semantic_hit') as semantic_hits,
          COUNT(*) FILTER (WHERE event_type = 'semantic_miss' OR event_type = 'below_threshold' OR event_type = 'fallback_to_ai') as misses,
          COUNT(*) FILTER (WHERE event_type LIKE 'ineligible_%') as ineligible_requests,
          AVG(similarity) FILTER (WHERE event_type = 'semantic_hit') as avg_similarity,
          COUNT(*) FILTER (WHERE event_type = 'below_threshold' OR reason = 'similarity_below_threshold' OR reason = 'below_threshold') as below_threshold,
          COUNT(*) FILTER (WHERE reason LIKE '%unavailable%' OR reason LIKE '%error%' OR event_type = 'semantic_unavailable') as unavailable_count
        FROM semantic_cache_metrics_events
        ${whereClause}
      `;

      const res = await pool.query(query, values);
      const row = res.rows[0] || {};

      const exactHits = parseInt(row.exact_hits || '0', 10);
      const semanticHits = parseInt(row.semantic_hits || '0', 10);
      const misses = parseInt(row.misses || '0', 10);
      const cacheIneligibleRequests = parseInt(row.ineligible_requests || '0', 10);
      const belowThreshold = parseInt(row.below_threshold || '0', 10);
      const semanticUnavailable = parseInt(row.unavailable_count || '0', 10);
      const avgSim = row.avg_similarity !== null && row.avg_similarity !== undefined
        ? parseFloat(parseFloat(row.avg_similarity).toFixed(4))
        : 0.0;

      const totalHits = exactHits + semanticHits;
      const cacheEligibleRequests = totalHits + misses;
      const totalAllRequests = cacheEligibleRequests + cacheIneligibleRequests;

      // Safe division by zero
      const hitRate = totalAllRequests > 0 ? parseFloat((totalHits / totalAllRequests).toFixed(4)) : 0.0;
      const eligibleHitRate = cacheEligibleRequests > 0 ? parseFloat((totalHits / cacheEligibleRequests).toFixed(4)) : 0.0;

      return {
        exactHits,
        semanticHits,
        misses,
        cacheEligibleRequests,
        cacheIneligibleRequests,
        hitRate,
        eligibleHitRate,
        semanticAverageSimilarity: avgSim,
        semanticBelowThreshold: belowThreshold,
        semanticUnavailable,
        timeWindow: filter,
      };
    }

    // In-memory calculation
    let events = [...this.inMemoryCacheEvents];
    if (filter?.from) {
      const fromTime = new Date(filter.from).getTime();
      events = events.filter((e) => new Date(e.timestamp).getTime() >= fromTime);
    }
    if (filter?.to) {
      const toTime = new Date(filter.to).getTime();
      events = events.filter((e) => new Date(e.timestamp).getTime() <= toTime);
    }

    const exactHits = events.filter((e) => e.event === 'exact_hit').length;
    const semanticHits = events.filter((e) => e.event === 'semantic_hit').length;
    const misses = events.filter(
      (e) => e.event === 'semantic_miss' || e.event === 'below_threshold' || e.event === 'fallback_to_ai'
    ).length;
    const cacheIneligibleRequests = events.filter((e) => (e.event as string).startsWith('ineligible_')).length;
    const belowThreshold = events.filter(
      (e) => e.event === 'below_threshold' || e.reason === 'similarity_below_threshold' || e.reason === 'below_threshold'
    ).length;
    const semanticUnavailable = events.filter(
      (e) => e.event === 'semantic_unavailable' || e.reason?.includes('unavailable') || e.reason?.includes('error')
    ).length;

    const simMatches = events.filter((e) => e.event === 'semantic_hit' && e.similarity !== undefined);
    const avgSim = simMatches.length > 0
      ? parseFloat((simMatches.reduce((acc, e) => acc + (e.similarity || 0), 0) / simMatches.length).toFixed(4))
      : 0.0;

    const totalHits = exactHits + semanticHits;
    const cacheEligibleRequests = totalHits + misses;
    const totalAll = cacheEligibleRequests + cacheIneligibleRequests;

    const hitRate = totalAll > 0 ? parseFloat((totalHits / totalAll).toFixed(4)) : 0.0;
    const eligibleHitRate = cacheEligibleRequests > 0 ? parseFloat((totalHits / cacheEligibleRequests).toFixed(4)) : 0.0;

    return {
      exactHits,
      semanticHits,
      misses,
      cacheEligibleRequests,
      cacheIneligibleRequests,
      hitRate,
      eligibleHitRate,
      semanticAverageSimilarity: avgSim,
      semanticBelowThreshold: belowThreshold,
      semanticUnavailable,
      timeWindow: filter,
    };
  }

  /**
   * Computes candidate conversion and promotion efficiency statistics.
   */
  public async getPromotionStats(filter?: { from?: string; to?: string }): Promise<PromotionStats> {
    const candStats = await this.getCandidateStats(filter);
    const total = candStats.total;
    const promoted = candStats.promoted;
    const rejected = candStats.rejected;
    const validated = candStats.validated;

    const promotionRate = total > 0 ? parseFloat((promoted / total).toFixed(4)) : 0.0;
    const rejectionRate = total > 0 ? parseFloat((rejected / total).toFixed(4)) : 0.0;

    return {
      totalCandidates: total,
      promoted,
      rejected,
      validated,
      promotionRate,
      rejectionRate,
      timeWindow: filter,
    };
  }

  /**
   * Computes system-wide learning performance and avoided AI LLM calls.
   */
  public async getLearningStats(filter?: { from?: string; to?: string }): Promise<LearningStats> {
    const [candStats, cacheStats] = await Promise.all([
      this.getCandidateStats(filter),
      this.getCacheStats(filter),
    ]);

    // Every cache hit (exact or semantic) directly avoids an LLM request
    const aiRequestsAvoided = cacheStats.exactHits + cacheStats.semanticHits;

    return {
      candidatesCreated: candStats.total,
      candidatesRejected: candStats.rejected,
      candidatesValidated: candStats.validated,
      candidatesPromoted: candStats.promoted,
      promotionEligible: candStats.promotionEligible,
      aiRequestsAvoided,
      timeWindow: filter,
    };
  }

  public clearInMemory(): void {
    this.inMemoryCacheEvents = [];
  }
}
