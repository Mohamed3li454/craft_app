import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../../../database/connection';
import { SemanticCandidateRepository } from '../../../database/repositories/semantic_candidate.repo';
import { SemanticCacheRepository } from '../../../database/repositories/semantic_cache.repo';
import { SemanticCacheCandidate } from '../../../database/repositories/semantic_candidate.types';
import { EmbeddingProvider } from '../embedding/embedding.interface';
import { EmbeddingFactory } from '../embedding/embedding.factory';
import { CandidateValidator } from './candidate_validator';
import { ConflictDetector } from './conflict_detector';
import { StalenessEvaluator } from './staleness_evaluator';
import { PromotionEvaluator } from './promotion_evaluator';
import { LearningMetrics } from './learning_metrics';
import { normalizeMessage } from '../text_normalizer';
import { logger } from '../../../core/logger';

export interface PromotionResult {
  success: boolean;
  promotedFaqId?: string;
  candidateId: string;
  error?: string;
}

export class PromotionService {
  constructor(
    private candidateRepo: SemanticCandidateRepository = new SemanticCandidateRepository(),
    private semanticCacheRepo: SemanticCacheRepository = new SemanticCacheRepository(),
    private embeddingProvider?: EmbeddingProvider,
    private db: DatabaseManager = DatabaseManager.getInstance()
  ) {
    if (!this.embeddingProvider) {
      this.embeddingProvider = EmbeddingFactory.createProvider();
    }
  }

  /**
   * Explicit, transaction-safe promotion of a candidate to production Semantic Cache (faq_items).
   *
   * Steps:
   * 1. Retrieve candidate & verify existence.
   * 2. Re-validate content, metadata, and safety via CandidateValidator.
   * 3. Verify embedding provider readiness (strictly forbid mock provider in production mode).
   * 4. Generate embedding vector and verify dimension.
   * 5. Atomically insert into faq_items and mark candidate as promoted within a database transaction.
   * 6. Roll back cleanly on any failure without leaving partial state.
   */
  public async promoteCandidate(candidateId: string): Promise<PromotionResult> {
    const startTime = Date.now();
    const candidate = await this.candidateRepo.findById(candidateId);

    if (!candidate) {
      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        candidateId,
        reason: 'candidate_not_found',
        latencyMs: Date.now() - startTime,
      });
      return {
        success: false,
        candidateId,
        error: `Candidate with id "${candidateId}" not found`,
      };
    }

    if (candidate.status === 'promoted') {
      return {
        success: true,
        candidateId,
        promotedFaqId: candidate.promotedFaqId || undefined,
      };
    }

    // 1. Guard: Candidate MUST be validated prior to promotion
    if (candidate.status !== 'validated') {
      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        candidateId,
        intent: candidate.intent,
        reason: 'not_validated',
        details: `Candidate must be validated before promotion (current status: "${candidate.status}")`,
        latencyMs: Date.now() - startTime,
      });

      return {
        success: false,
        candidateId,
        error: `Candidate must be validated before promotion (current status: "${candidate.status}")`,
      };
    }

    // 2. Guard: Candidate MUST have accumulated sufficient evidence (promotionEligible === true)
    if (!candidate.promotionEligible) {
      const blockers = candidate.promotionBlockers && candidate.promotionBlockers.length > 0
        ? candidate.promotionBlockers.join(', ')
        : 'insufficient evidence';

      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        candidateId,
        intent: candidate.intent,
        reason: 'not_promotion_eligible',
        details: blockers,
        latencyMs: Date.now() - startTime,
      });

      return {
        success: false,
        candidateId,
        error: `Candidate is not eligible for promotion: ${blockers}`,
      };
    }

    // 3. Guard: Staleness check
    const staleness = StalenessEvaluator.isStale(candidate);
    if (staleness.isStale) {
      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        candidateId,
        intent: candidate.intent,
        reason: 'candidate_stale',
        details: staleness.reason,
        latencyMs: Date.now() - startTime,
      });

      return {
        success: false,
        candidateId,
        error: `Candidate is stale and cannot be promoted: ${staleness.reason}`,
      };
    }

    // 4. Guard: Conflict detection against existing candidate knowledge base
    const allCandidates = await this.candidateRepo.list({ limit: 200 });
    const conflict = ConflictDetector.detectConflict(candidate, allCandidates);
    if (conflict.hasConflict) {
      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        candidateId,
        intent: candidate.intent,
        reason: 'conflict_detected',
        details: conflict.details,
        latencyMs: Date.now() - startTime,
      });

      return {
        success: false,
        candidateId,
        error: `Candidate has unresolved conflict: ${conflict.details}`,
      };
    }

    // 5. Re-validate candidate content, metadata, and safety
    const validation = CandidateValidator.validate(candidate);
    if (!validation.valid) {
      await this.candidateRepo.updateStatus(candidateId, 'rejected', {
        rejectionReason: `Validation failed: ${validation.reason} - ${validation.details}`,
      });

      LearningMetrics.record({
        eventName: 'learning_candidate_rejected',
        candidateId,
        intent: candidate.intent,
        reason: validation.reason,
        details: validation.details,
        latencyMs: Date.now() - startTime,
      });

      return {
        success: false,
        candidateId,
        error: `Validation failed: ${validation.details}`,
      };
    }

    // 2. Production Environment Check: strictly forbid mock provider in production
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && (!this.embeddingProvider || this.embeddingProvider.name === 'mock')) {
      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        candidateId,
        intent: candidate.intent,
        reason: 'mock_provider_in_production',
        details: 'Mock embedding provider is forbidden for production promotion',
        latencyMs: Date.now() - startTime,
      });

      return {
        success: false,
        candidateId,
        error: 'Cannot promote candidate: Mock embedding provider is forbidden for production promotion. A real embedding provider must be configured.',
      };
    }

    // 3. Generate Embedding & Verify Dimension
    let vector: number[];
    try {
      if (!this.embeddingProvider) {
        throw new Error('No embedding provider available');
      }
      // Embed representative text (intent + main example, normalized for consistency with cache lookup)
      const primaryText = candidate.inputExamples[0] || candidate.intent;
      const { normalized: normalizedPrimary } = normalizeMessage(primaryText);
      vector = await this.embeddingProvider.embed(normalizedPrimary || primaryText);

      if (!Array.isArray(vector) || vector.length !== this.embeddingProvider.dimension) {
        throw new Error(
          `Generated embedding dimension mismatch: expected ${this.embeddingProvider.dimension}, got ${vector?.length}`
        );
      }
    } catch (embErr: any) {
      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        candidateId,
        intent: candidate.intent,
        reason: 'embedding_generation_failed',
        details: embErr.message,
        latencyMs: Date.now() - startTime,
      });

      // Keep candidate pending, do not modify production cache
      return {
        success: false,
        candidateId,
        error: `Embedding generation failed: ${embErr.message}`,
      };
    }

    // 4. Atomic Promotion (PostgreSQL transaction or in-memory atomic update)
    const faqId = uuidv4();
    const pool = this.db.getPool();

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Concurrency Guard: Lock candidate row exclusively FOR UPDATE to prevent race conditions
        const lockRes = await client.query(
          `SELECT id, status, promoted_faq_id FROM semantic_cache_candidates WHERE id = $1 FOR UPDATE`,
          [candidateId]
        );

        if (lockRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return {
            success: false,
            candidateId,
            error: `Candidate with id "${candidateId}" not found`,
          };
        }

        const lockedStatus = lockRes.rows[0].status;
        const existingFaqId = lockRes.rows[0].promoted_faq_id;

        // Idempotency: If already promoted concurrently, return existing FAQ ID without creating duplicates
        if (lockedStatus === 'promoted') {
          await client.query('ROLLBACK');
          return {
            success: true,
            candidateId,
            promotedFaqId: existingFaqId || undefined,
          };
        }

        // If candidate was concurrently rejected or modified:
        if (lockedStatus !== 'validated') {
          await client.query('ROLLBACK');
          return {
            success: false,
            candidateId,
            error: `Candidate status was modified concurrently (current status: "${lockedStatus}")`,
          };
        }

        const vectorString = `[${vector.join(',')}]`;
        const category = candidate.category || 'custom';
        const title = candidate.intent;
        const examples = candidate.inputExamples;
        const patterns = candidate.inputExamples;
        const response = candidate.response;
        const strategy = candidate.responseStrategy;
        const templates = JSON.stringify(candidate.responseTemplates);
        const dimension = vector.length;

        // Insert into faq_items
        await client.query(
          `INSERT INTO faq_items (
            id, category, intent, title, examples, patterns, response,
            response_strategy, response_templates, match_type, is_active,
            is_cacheable, is_dynamic, requires_search, requires_user_context,
            confidence_threshold, embedding, embedding_dimension, hit_count,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 'contains', true,
            true, false, false, false,
            0.88, $10::vector, $11, 0, NOW(), NOW()
          )`,
          [
            faqId,
            category,
            candidate.intent,
            title,
            examples,
            patterns,
            response,
            strategy,
            templates,
            vectorString,
            dimension,
          ]
        );

        // Update candidate status to 'promoted'
        await client.query(
          `UPDATE semantic_cache_candidates 
           SET status = 'promoted', promoted_faq_id = $1, promoted_at = NOW(), updated_at = NOW() 
           WHERE id = $2`,
          [faqId, candidateId]
        );

        await client.query('COMMIT');
      } catch (txErr: any) {
        await client.query('ROLLBACK');
        logger.error('Transaction rollback during candidate promotion', { error: txErr.message, candidateId });

        LearningMetrics.record({
          eventName: 'learning_candidate_failed',
          candidateId,
          intent: candidate.intent,
          reason: 'transaction_rollback',
          details: txErr.message,
          latencyMs: Date.now() - startTime,
        });

        return {
          success: false,
          candidateId,
          error: `Promotion transaction failed: ${txErr.message}`,
        };
      } finally {
        client.release();
      }
    } else {
      // In-Memory atomic promotion (for unit tests / mock mode)
      try {
        const fresh = await this.candidateRepo.findById(candidateId);
        if (fresh?.status === 'promoted') {
          return {
            success: true,
            candidateId,
            promotedFaqId: fresh.promotedFaqId || faqId,
          };
        }
        if (fresh && fresh.status !== 'validated') {
          return {
            success: false,
            candidateId,
            error: `Candidate status was modified concurrently (current status: "${fresh.status}")`,
          };
        }

        await this.semanticCacheRepo.create({
          intent: candidate.intent,
          category: candidate.category,
          title: candidate.intent,
          examples: candidate.inputExamples,
          patterns: candidate.inputExamples,
          response: candidate.response,
          responseStrategy: candidate.responseStrategy,
          responseTemplates: candidate.responseTemplates,
          confidenceThreshold: 0.88,
          embedding: vector,
          embeddingDimension: vector.length,
          isActive: true,
          isCacheable: true,
        });

        await this.candidateRepo.updateStatus(candidateId, 'promoted', { promotedFaqId: faqId });
      } catch (inMemErr: any) {
        return {
          success: false,
          candidateId,
          error: `In-memory promotion failed: ${inMemErr.message}`,
        };
      }
    }

    LearningMetrics.record({
      eventName: 'learning_candidate_promoted',
      candidateId,
      intent: candidate.intent,
      strategy: candidate.responseStrategy,
      language: candidate.language,
      sourceModel: candidate.sourceModel || undefined,
      sourceProvider: candidate.sourceProvider || undefined,
      latencyMs: Date.now() - startTime,
    });

    return {
      success: true,
      promotedFaqId: faqId,
      candidateId,
    };
  }

  /**
   * Human Review: Explicitly validate a pending candidate.
   */
  public async validateCandidate(candidateId: string): Promise<boolean> {
    const candidate = await this.candidateRepo.findById(candidateId);
    if (!candidate) return false;

    const validation = CandidateValidator.validate(candidate);
    if (!validation.valid) {
      await this.candidateRepo.updateStatus(candidateId, 'rejected', {
        rejectionReason: validation.details,
      });
      return false;
    }

    const updated = await this.candidateRepo.updateStatus(candidateId, 'validated');
    if (!updated) return false;

    // Phase 6: Re-evaluate promotion eligibility upon validation
    const allCandidates = await this.candidateRepo.list({ limit: 200 });
    const evalResult = await PromotionEvaluator.evaluate(
      updated,
      allCandidates,
      undefined,
      this.embeddingProvider
    );

    await this.candidateRepo.updateEvidence(candidateId, {
      confidence: evalResult.score,
      promotionEligible: evalResult.eligible,
      promotionReasons: evalResult.reasons,
      promotionBlockers: evalResult.blockers,
      semanticConsistency: evalResult.evidence.semanticConsistency,
    });

    LearningMetrics.record({
      eventName: 'learning_candidate_validated',
      candidateId,
      intent: candidate.intent,
      language: candidate.language,
    });

    if (evalResult.eligible) {
      LearningMetrics.record({
        eventName: 'learning_candidate_promotion_eligible',
        candidateId,
        intent: candidate.intent,
        score: evalResult.score,
      });
    }

    return true;
  }

  /**
   * Human Review: Explicitly reject a candidate with a documented reason.
   */
  public async rejectCandidate(candidateId: string, reason: string): Promise<boolean> {
    const updated = await this.candidateRepo.updateStatus(candidateId, 'rejected', {
      rejectionReason: reason,
    });

    if (updated) {
      LearningMetrics.record({
        eventName: 'learning_candidate_rejected',
        candidateId,
        reason,
        intent: updated.intent,
      });
      return true;
    }
    return false;
  }
}
