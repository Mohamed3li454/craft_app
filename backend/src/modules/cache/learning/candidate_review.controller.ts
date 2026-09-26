import crypto from 'crypto';
import { Request, Response } from 'express';
import { config } from '../../../config/env';
import { logger } from '../../../core/logger';
import { CandidateReviewService } from './candidate_review.service';
import { CacheObservability } from '../cache_observability';
import { ListCandidatesFilter, CandidateStatus } from '../../../database/repositories/semantic_candidate.types';

export class CandidateReviewController {
  constructor(
    private reviewService: CandidateReviewService = new CandidateReviewService(),
    private observability: CacheObservability = CacheObservability.getInstance()
  ) {}

  /**
   * Validates administrative authorization token against configured admin secret.
   *
   * SECURITY AUDIT ENFORCEMENTS:
   * 1. Query token (?token=...) is STRICTLY FORBIDDEN to prevent leakage in URLs/access logs.
   * 2. Only Authorization: Bearer <TOKEN> and x-admin-token: <TOKEN> headers are accepted.
   * 3. Production Fail-Closed: If ADMIN_SECRET_KEY is missing or empty, all admin requests are blocked.
   * 4. Constant-Time Comparison: crypto.timingSafeEqual prevents timing side-channel attacks.
   */
  public isAuthorized(req: Request): boolean {
    const authHeader = req.headers?.authorization;
    const customHeader = req.headers?.['x-admin-token'] as string;

    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;

    const providedToken = bearerToken || (customHeader ? customHeader.trim() : undefined);
    const expectedToken = (config.admin?.secretKey || '').trim();

    // 1. Fail-closed: Reject if expected token is not configured or in production without explicit env var
    if (!expectedToken) {
      return false;
    }
    if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_SECRET_KEY || !process.env.ADMIN_SECRET_KEY.trim())) {
      return false;
    }

    // 2. Reject if no valid header token was supplied
    if (!providedToken) {
      return false;
    }

    // 3. Constant-time comparison using crypto.timingSafeEqual
    const providedBuf = Buffer.from(providedToken);
    const expectedBuf = Buffer.from(expectedToken);

    if (providedBuf.length !== expectedBuf.length) {
      // Execute dummy timing operation with identical length to maintain constant time response
      crypto.timingSafeEqual(expectedBuf, expectedBuf);
      return false;
    }

    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  }

  /**
   * Safely extracts reviewer actor ID without leaking secrets into audit trail.
   * If no explicit actor identifier is passed, returns undefined (actor recorded as null with actorType: admin_token).
   */
  private extractActorId(req: Request): string | undefined {
    const actorHeader = req.headers?.['x-admin-actor'] as string;
    const actorBody = req.body?.actorId as string;
    const rawActor = (actorHeader || actorBody || '').trim();

    if (!rawActor) return undefined;
    const secret = (config.admin?.secretKey || '').trim();
    if (secret && rawActor === secret) return undefined;
    if (rawActor.toLowerCase().startsWith('bearer ')) return undefined;

    return rawActor;
  }

  /**
   * GET /api/admin/cache/candidates
   * Lists candidates with extensive filtering and pagination.
   */
  public listCandidates = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const filter: ListCandidatesFilter = {};

      if (req.query.status) {
        filter.status = req.query.status as CandidateStatus;
      }
      if (req.query.promotionEligible !== undefined) {
        filter.promotionEligible = req.query.promotionEligible === 'true';
      }
      if (req.query.intent) {
        filter.intent = req.query.intent as string;
      }
      if (req.query.category) {
        filter.category = req.query.category as string;
      }
      if (req.query.language) {
        filter.language = req.query.language as string;
      }
      if (req.query.sourceModel) {
        filter.sourceModel = req.query.sourceModel as string;
      }
      if (req.query.minConfidence) {
        const val = parseFloat(req.query.minConfidence as string);
        if (!isNaN(val)) filter.minConfidence = val;
      }
      if (req.query.maxConfidence) {
        const val = parseFloat(req.query.maxConfidence as string);
        if (!isNaN(val)) filter.maxConfidence = val;
      }
      if (req.query.minObservations) {
        const val = parseInt(req.query.minObservations as string, 10);
        if (!isNaN(val)) filter.minObservations = val;
      }
      if (req.query.from) {
        filter.from = req.query.from as string;
      }
      if (req.query.to) {
        filter.to = req.query.to as string;
      }
      if (req.query.limit) {
        const val = parseInt(req.query.limit as string, 10);
        if (!isNaN(val)) filter.limit = val;
      }
      if (req.query.offset) {
        const val = parseInt(req.query.offset as string, 10);
        if (!isNaN(val)) filter.offset = val;
      }
      if (req.query.cursor) {
        filter.cursor = req.query.cursor as string;
      }

      const result = await this.reviewService.listCandidates(filter);
      res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      logger.error('Failed to list cache candidates', { error: err.message });
      res.status(500).json({
        success: false,
        error: 'Internal server error while querying cache candidates',
      });
    }
  };

  /**
   * GET /api/admin/cache/candidates/:id
   * Retrieves sanitized candidate details, promotion evaluation, and audit events.
   * STRICT: Never returns user identifiers or sensitive conversation details.
   */
  public getCandidate = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const { id } = req.params;
      const recordViewAudit = req.query?.recordViewAudit === 'true';
      const actorId = this.extractActorId(req);

      const candidate = await this.reviewService.getCandidate(id, { actorId, recordViewAudit });
      if (!candidate) {
        res.status(404).json({
          success: false,
          error: `Candidate with id "${id}" not found`,
        });
        return;
      }

      const [eligibility, auditTrail] = await Promise.all([
        this.reviewService.getPromotionEligibility(id),
        this.reviewService.getAuditEvents(id, { limit: 20 }),
      ]);

      res.json({
        success: true,
        candidate,
        promotionEligibility: eligibility,
        auditTrail,
      });
    } catch (err: any) {
      logger.error('Failed to get candidate details', { error: err.message, candidateId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Internal server error while fetching candidate',
      });
    }
  };

  /**
   * POST /api/admin/cache/candidates/:id/validate
   * Explicit reviewer validation of candidate.
   */
  public validateCandidate = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const { id } = req.params;
      const reason = req.body?.notes || req.body?.reason;
      const actorId = this.extractActorId(req);

      const result = await this.reviewService.validateCandidate(id, { actorId, reason });
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
          candidate: result.candidate,
        });
        return;
      }

      res.json({
        success: true,
        candidate: result.candidate,
      });
    } catch (err: any) {
      logger.error('Failed to validate candidate', { error: err.message, candidateId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Internal server error while validating candidate',
      });
    }
  };

  /**
   * POST /api/admin/cache/candidates/:id/reject
   * Explicit reviewer rejection of candidate. Rejection reason is strictly mandatory.
   */
  public rejectCandidate = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const { id } = req.params;
      const reason = req.body?.reason;
      const actorId = this.extractActorId(req);

      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        res.status(400).json({
          success: false,
          error: 'Rejection reason is mandatory and cannot be empty',
        });
        return;
      }

      const result = await this.reviewService.rejectCandidate(id, reason, { actorId });
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        candidate: result.candidate,
      });
    } catch (err: any) {
      logger.error('Failed to reject candidate', { error: err.message, candidateId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Internal server error while rejecting candidate',
      });
    }
  };

  /**
   * POST /api/admin/cache/candidates/:id/promote
   * Explicit promotion to production FAQ semantic cache.
   * Delegates strictly to PromotionService.
   */
  public promoteCandidate = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const { id } = req.params;
      const actorId = this.extractActorId(req);

      const result = await this.reviewService.promoteCandidate(id, { actorId });
      if (!result.success) {
        res.status(400).json({
          success: false,
          candidateId: result.candidateId,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        candidateId: result.candidateId,
        promotedFaqId: result.promotedFaqId,
      });
    } catch (err: any) {
      logger.error('Failed to promote candidate', { error: err.message, candidateId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Internal server error while promoting candidate',
      });
    }
  };

  /**
   * GET /api/admin/cache/stats
   * Production Cache Observability statistics (hits, misses, hit rate, eligible hit rate).
   */
  public getCacheStats = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const filter = {
        from: req.query.from as string,
        to: req.query.to as string,
      };

      const stats = await this.observability.getCacheStats(filter);
      res.json({
        success: true,
        stats,
      });
    } catch (err: any) {
      logger.error('Failed to retrieve cache stats', { error: err.message });
      res.status(500).json({
        success: false,
        error: 'Internal server error while computing cache stats',
      });
    }
  };

  /**
   * GET /api/admin/cache/learning-stats
   * Comprehensive learning and conversion statistics.
   */
  public getLearningStats = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const filter = {
        from: req.query.from as string,
        to: req.query.to as string,
      };

      const [learningStats, candidateStats, promotionStats] = await Promise.all([
        this.observability.getLearningStats(filter),
        this.observability.getCandidateStats(filter),
        this.observability.getPromotionStats(filter),
      ]);

      res.json({
        success: true,
        stats: {
          ...learningStats,
          candidateDistribution: candidateStats,
          conversionRates: promotionStats,
        },
      });
    } catch (err: any) {
      logger.error('Failed to retrieve learning stats', { error: err.message });
      res.status(500).json({
        success: false,
        error: 'Internal server error while computing learning stats',
      });
    }
  };

  /**
   * POST /api/admin/cache/feedback/incorrect
   * Marks a cache result as incorrect (false positive reporting).
   */
  public markIncorrect = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid admin token is required',
      });
      return;
    }

    try {
      const cacheEntryId = req.body?.cacheEntryId || req.body?.id || req.body?.itemId;
      const reason = req.body?.reason || 'Incorrect cache hit reported by reviewer';
      const actorId = this.extractActorId(req);

      if (!cacheEntryId) {
        res.status(400).json({
          success: false,
          error: 'cacheEntryId is required',
        });
        return;
      }

      await this.observability.markCacheResultAsIncorrect(cacheEntryId, reason, actorId);
      res.json({
        success: true,
        message: 'Cache result feedback recorded successfully',
      });
    } catch (err: any) {
      logger.error('Failed to record cache feedback', { error: err.message });
      res.status(500).json({
        success: false,
        error: 'Internal server error while recording cache feedback',
      });
    }
  };
}
