import { SemanticCandidateRepository } from '../../../database/repositories/semantic_candidate.repo';
import { SemanticReviewAuditRepository } from '../../../database/repositories/semantic_review_audit.repo';
import {
  ListCandidatesFilter,
  SemanticCacheCandidate,
  SanitizedCandidateDetail,
  ReviewEvent,
} from '../../../database/repositories/semantic_candidate.types';
import { PromotionService, PromotionResult } from './promotion_service';
import { CandidateValidator } from './candidate_validator';
import { PromotionEvaluator, PromotionEvaluation } from './promotion_evaluator';
import { EmbeddingProvider } from '../embedding/embedding.interface';
import { logger } from '../../../core/logger';

export interface PaginatedCandidatesResult {
  items: SanitizedCandidateDetail[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextCursor?: string;
}

export class CandidateReviewService {
  constructor(
    private candidateRepo: SemanticCandidateRepository = new SemanticCandidateRepository(),
    private auditRepo: SemanticReviewAuditRepository = new SemanticReviewAuditRepository(),
    private promotionService: PromotionService = new PromotionService(),
    private embeddingProvider?: EmbeddingProvider
  ) {}

  /**
   * Lists candidates with repository-level filtering and pagination.
   * Enforces MAX_PAGE_SIZE = 100.
   */
  public async listCandidates(filter?: ListCandidatesFilter): Promise<PaginatedCandidatesResult> {
    const limit = Math.max(1, Math.min(filter?.limit || 50, 100));
    const offset = Math.max(0, filter?.offset || 0);

    const [rawItems, total] = await Promise.all([
      this.candidateRepo.list({ ...filter, limit, offset }),
      this.candidateRepo.count(filter),
    ]);

    const items = rawItems.map((c) => this.sanitizeCandidate(c));
    const hasMore = offset + items.length < total;
    const nextCursor = items.length > 0 ? items[items.length - 1].createdAt : undefined;

    return {
      items,
      total,
      limit,
      offset,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Retrieves sanitized candidate details for administrative inspection.
   * STRICT GUARANTEE: Never leaks user identifiers, phones, conversation tokens, or raw user queries.
   */
  public async getCandidate(
    candidateId: string,
    options?: { actorId?: string; recordViewAudit?: boolean }
  ): Promise<SanitizedCandidateDetail | null> {
    const candidate = await this.candidateRepo.findById(candidateId);
    if (!candidate) return null;

    if (options?.recordViewAudit) {
      await this.auditRepo.recordEvent({
        candidateId,
        action: 'view',
        actorId: options.actorId || null,
        previousStatus: candidate.status,
        newStatus: candidate.status,
        previousEligibility: candidate.promotionEligible,
        newEligibility: candidate.promotionEligible,
        metadata: {
          actorType: options.actorId ? 'user' : 'admin_token',
        },
      });
    }

    return this.sanitizeCandidate(candidate);
  }

  /**
   * Validates a candidate explicitly through human / administrative review.
   * Idempotent: Subsequent calls on an already validated candidate do not duplicate validation counts.
   */
  public async validateCandidate(
    candidateId: string,
    options?: { actorId?: string; reason?: string }
  ): Promise<{ success: boolean; candidate?: SanitizedCandidateDetail; error?: string }> {
    const candidate = await this.candidateRepo.findById(candidateId);
    if (!candidate) {
      return { success: false, error: `Candidate with id "${candidateId}" not found` };
    }

    // 1. Content & Safety Validation
    const validation = CandidateValidator.validate(candidate);
    if (!validation.valid) {
      const prevStatus = candidate.status;
      const prevElig = candidate.promotionEligible;
      const rejectionReason = `Validation failed: ${validation.reason} - ${validation.details}`;

      const rejected = await this.candidateRepo.updateStatus(candidateId, 'rejected', {
        rejectionReason,
      });
      await this.candidateRepo.updateEvidence(candidateId, { promotionEligible: false });

      await this.auditRepo.recordEvent({
        candidateId,
        action: 'reject',
        actorId: options?.actorId || null,
        reason: rejectionReason,
        previousStatus: prevStatus,
        newStatus: 'rejected',
        previousEligibility: prevElig,
        newEligibility: false,
        metadata: {
          actorType: options?.actorId ? 'user' : 'admin_token',
        },
      });

      return {
        success: false,
        error: rejectionReason,
        candidate: rejected ? this.sanitizeCandidate(rejected) : undefined,
      };
    }

    const prevStatus = candidate.status;
    const prevElig = candidate.promotionEligible;

    // Idempotency: If already validated, re-evaluate promotion eligibility without double-counting validation
    let updated: SemanticCacheCandidate | null;
    if (candidate.status === 'validated') {
      updated = candidate;
    } else {
      updated = await this.candidateRepo.updateStatus(candidateId, 'validated');
    }

    if (!updated) {
      return { success: false, error: 'Failed to update candidate status to validated' };
    }

    // 2. Re-evaluate promotion eligibility upon validation
    const allCandidates = await this.candidateRepo.list({ limit: 200 });
    const evalResult = await PromotionEvaluator.evaluate(
      updated,
      allCandidates,
      undefined,
      this.embeddingProvider
    );

    const finalCandidate = await this.candidateRepo.updateEvidence(candidateId, {
      confidence: evalResult.score,
      promotionEligible: evalResult.eligible,
      promotionReasons: evalResult.reasons,
      promotionBlockers: evalResult.blockers,
      semanticConsistency: evalResult.evidence.semanticConsistency,
    });

    // 3. Append-only Immutable Audit Record
    if (prevStatus !== 'validated' || prevElig !== evalResult.eligible) {
      await this.auditRepo.recordEvent({
        candidateId,
        action: 'validate',
        actorId: options?.actorId || null,
        reason: options?.reason,
        previousStatus: prevStatus,
        newStatus: 'validated',
        previousEligibility: prevElig,
        newEligibility: evalResult.eligible,
        metadata: {
          confidenceScore: evalResult.score,
          blockersCount: evalResult.blockers.length,
          actorType: options?.actorId ? 'user' : 'admin_token',
        },
      });
    }

    return {
      success: true,
      candidate: finalCandidate ? this.sanitizeCandidate(finalCandidate) : undefined,
    };
  }

  /**
   * Explicitly rejects a candidate with a mandatory documented reason.
   * Idempotent: Subsequent calls with the same reason do not corrupt state or inflate rejection counts.
   * Reject != Delete: Candidate is strictly preserved in database for audit and analytical history.
   */
  public async rejectCandidate(
    candidateId: string,
    reason: string,
    options?: { actorId?: string }
  ): Promise<{ success: boolean; candidate?: SanitizedCandidateDetail; error?: string }> {
    if (!reason || !reason.trim()) {
      return { success: false, error: 'Rejection reason is mandatory and cannot be empty' };
    }

    const candidate = await this.candidateRepo.findById(candidateId);
    if (!candidate) {
      return { success: false, error: `Candidate with id "${candidateId}" not found` };
    }

    // Guard: Cannot reject candidate that is already promoted to production FAQ
    if (candidate.status === 'promoted') {
      return {
        success: false,
        error: 'Cannot reject an already promoted candidate. Decommission the active FAQ entry instead.',
      };
    }

    // Idempotency: If already rejected with the exact same reason, return success without duplicate audit
    if (candidate.status === 'rejected' && candidate.rejectionReason === reason.trim()) {
      return { success: true, candidate: this.sanitizeCandidate(candidate) };
    }

    const prevStatus = candidate.status;
    const prevElig = candidate.promotionEligible;

    const updated = await this.candidateRepo.updateStatus(candidateId, 'rejected', {
      rejectionReason: reason.trim(),
    });

    if (!updated) {
      return { success: false, error: 'Failed to update candidate status to rejected' };
    }

    // Ensure promotion eligibility is revoked immediately
    const finalCandidate = await this.candidateRepo.updateEvidence(candidateId, {
      promotionEligible: false,
      promotionBlockers: [...(candidate.promotionBlockers || []), `rejected_by_reviewer: ${reason.trim()}`],
    });

    await this.auditRepo.recordEvent({
      candidateId,
      action: 'reject',
      actorId: options?.actorId || null,
      reason: reason.trim(),
      previousStatus: prevStatus,
      newStatus: 'rejected',
      previousEligibility: prevElig,
      newEligibility: false,
      metadata: {
        actorType: options?.actorId ? 'user' : 'admin_token',
      },
    });

    return {
      success: true,
      candidate: finalCandidate ? this.sanitizeCandidate(finalCandidate) : undefined,
    };
  }

  /**
   * Returns deterministic promotion evaluation report for inspection.
   */
  public async getPromotionEligibility(candidateId: string): Promise<PromotionEvaluation | null> {
    const candidate = await this.candidateRepo.findById(candidateId);
    if (!candidate) return null;

    const allCandidates = await this.candidateRepo.list({ limit: 200 });
    return PromotionEvaluator.evaluate(
      candidate,
      allCandidates,
      undefined,
      this.embeddingProvider
    );
  }

  /**
   * Promotes candidate to production semantic cache (faq_items).
   * SINGLE SOURCE OF TRUTH: Delegates strictly to PromotionService.promoteCandidate.
   * Records immutable audit event upon success.
   */
  public async promoteCandidate(
    candidateId: string,
    options?: { actorId?: string }
  ): Promise<PromotionResult> {
    const candidate = await this.candidateRepo.findById(candidateId);
    if (!candidate) {
      return { success: false, candidateId, error: `Candidate "${candidateId}" not found` };
    }

    const prevStatus = candidate.status;
    const prevElig = candidate.promotionEligible;

    // Call single source of truth
    const result = await this.promotionService.promoteCandidate(candidateId);

    if (result.success && prevStatus !== 'promoted') {
      await this.auditRepo.recordEvent({
        candidateId,
        action: 'promote',
        actorId: options?.actorId || null,
        previousStatus: prevStatus,
        newStatus: 'promoted',
        previousEligibility: prevElig,
        newEligibility: true,
        metadata: {
          promotedFaqId: result.promotedFaqId,
          actorType: options?.actorId ? 'user' : 'admin_token',
        },
      });
    }

    return result;
  }

  /**
   * Retrieves review audit trail for a candidate.
   */
  public async getAuditEvents(
    candidateId: string,
    filter?: { limit?: number; offset?: number }
  ): Promise<ReviewEvent[]> {
    return this.auditRepo.listEvents(candidateId, filter);
  }

  /**
   * Strips all internal user identifiers, phone numbers, conversation IDs, and raw text.
   */
  private sanitizeCandidate(c: SemanticCacheCandidate): SanitizedCandidateDetail {
    return {
      id: c.id,
      intent: c.intent,
      category: c.category,
      inputExamples: c.inputExamples,
      response: c.response,
      responseStrategy: c.responseStrategy,
      responseTemplates: c.responseTemplates,
      language: c.language,
      sourceModel: c.sourceModel || null,
      sourceProvider: c.sourceProvider || null,
      confidence: c.confidence,
      eligibilityReason: c.eligibilityReason,
      status: c.status,
      rejectionReason: c.rejectionReason || null,
      promotedFaqId: c.promotedFaqId || null,
      observationCount: c.observationCount,
      uniqueExampleCount: c.uniqueExampleCount,
      duplicateCount: c.duplicateCount,
      validationCount: c.validationCount,
      rejectionCount: c.rejectionCount,
      safetyViolationCount: c.safetyViolationCount,
      conflictCount: c.conflictCount,
      semanticConsistency: c.semanticConsistency,
      promotionEligible: c.promotionEligible,
      promotionReasons: c.promotionReasons,
      promotionBlockers: c.promotionBlockers,
      firstObservedAt: c.firstObservedAt,
      lastObservedAt: c.lastObservedAt,
      validatedAt: c.validatedAt || null,
      promotedAt: c.promotedAt || null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
