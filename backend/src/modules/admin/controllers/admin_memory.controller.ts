import { Request, Response } from 'express';
import { MemoryRepository } from '../../../database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../../../database/repositories/memory_evidence.repo';
import { MemorySafetyGate } from '../../memory/memory_safety_gate';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError, getCorrelationId, getAdminActor } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { logger } from '../../../core/logger';
import { z } from 'zod';
import { EvidenceStatus } from '../../memory/types';

const UpdateMemorySchema = z.object({
  factText: z.string().trim().min(2).max(1000).optional(),
  category: z.string().trim().max(50).optional(),
  importance: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  status: z.enum(['active', 'superseded', 'deleted', 'archived']).optional(),
});

const PurgeMemorySchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required for purge'),
});

const RejectCandidateSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export class AdminMemoryController {
  constructor(
    private memoryRepo: MemoryRepository = new MemoryRepository(),
    private evidenceRepo: MemoryEvidenceRepository = MemoryEvidenceRepository.getInstance(),
    private auditService: AdminAuditService = AdminAuditService.getInstance()
  ) {}

  public getMemoryItems = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : undefined;

      const { items, total } = await this.memoryRepo.listMemoryItems({
        userId,
        status,
        category,
        limit,
        offset,
      });

      sendAdminSuccess(res, items, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to list memory items', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve memory items');
    }
  };

  public getMemoryDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      if (!id || id.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Memory ID is required');
        return;
      }

      const item = await this.memoryRepo.getMemoryById(id);
      if (!item) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Memory item not found');
        return;
      }

      sendAdminSuccess(res, item);
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to get memory item details', { error: err.message, id: req.params.id });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve memory item details');
    }
  };

  public updateMemoryItem = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Memory ID is required');
      return;
    }

    const parseRes = UpdateMemorySchema.safeParse(req.body || {});
    if (!parseRes.success) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Invalid memory update payload', parseRes.error.format());
      return;
    }

    try {
      const updated = await this.memoryRepo.updateMemoryFact(id, parseRes.data);
      if (!updated) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Memory item not found or update failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UPDATE_MEMORY_ITEM',
        resourceType: 'memory_item',
        resourceId: id,
        status: 'success',
        metadata: {
          category: updated.category,
          importance: updated.importance,
          status: updated.status,
        },
        correlationId,
      });

      sendAdminSuccess(res, updated);
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to update memory item', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UPDATE_MEMORY_ITEM',
        resourceType: 'memory_item',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to update memory item');
    }
  };

  public deleteMemoryItem = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Memory ID is required');
      return;
    }

    try {
      const ok = await this.memoryRepo.deleteFact(id);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Memory item not found or delete failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'DELETE_MEMORY_ITEM',
        resourceType: 'memory_item',
        resourceId: id,
        status: 'success',
        correlationId,
      });

      sendAdminSuccess(res, { id, deleted: true });
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to delete memory item', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'DELETE_MEMORY_ITEM',
        resourceType: 'memory_item',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to delete memory item');
    }
  };

  public purgeUserMemories = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';

    const parseRes = PurgeMemorySchema.safeParse(req.body || {});
    if (!parseRes.success) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Invalid purge payload', parseRes.error.format());
      return;
    }

    const { userId } = parseRes.data;

    try {
      const deletedCount = await this.memoryRepo.purgeUserMemories(userId);

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'PURGE_USER_MEMORIES',
        resourceType: 'memory_item',
        resourceId: userId,
        status: 'success',
        metadata: { deletedCount },
        correlationId,
      });

      sendAdminSuccess(res, { userId, deletedCount, purged: true });
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to purge user memories', { error: err.message, userId });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'PURGE_USER_MEMORIES',
        resourceType: 'memory_item',
        resourceId: userId,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to purge user memories');
    }
  };

  public getEvidenceCandidates = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : undefined;
      const status = typeof req.query.status === 'string' ? (req.query.status.trim() as EvidenceStatus) : undefined;

      const { items, total } = await this.evidenceRepo.listCandidates({
        userId,
        status,
        limit,
        offset,
      });

      sendAdminSuccess(res, items, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to list evidence candidates', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve evidence candidates');
    }
  };

  public getEvidenceCandidateDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      if (!id || id.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Candidate ID is required');
        return;
      }

      const candidate = await this.evidenceRepo.getCandidateById(id);
      if (!candidate) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Evidence candidate not found');
        return;
      }

      sendAdminSuccess(res, candidate);
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to get candidate details', { error: err.message, id: req.params.id });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve candidate details');
    }
  };

  public approveEvidenceCandidate = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Candidate ID is required');
      return;
    }

    try {
      const candidate = await this.evidenceRepo.getCandidateById(id);
      if (!candidate) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Evidence candidate not found');
        return;
      }

      // 1. Enforce Memory Safety Gate before saving to confirmed memory
      const safetyCheck = MemorySafetyGate.getInstance().evaluate(candidate.canonicalFact, candidate.category);
      if (!safetyCheck.allowed) {
        sendAdminError(res, 422, 'ADMIN_UNPROCESSABLE_ENTITY', `Candidate rejected by Memory Safety Gate: ${safetyCheck.reason}`);
        return;
      }

      // 2. Save confirmed fact into memory_items
      const memoryEntity = await this.memoryRepo.saveFact(
        candidate.userId,
        candidate.canonicalFact,
        (candidate.category as any) || 'general',
        {
          source: 'system_derived',
          confidence: candidate.confidence || 1.0,
          importance: (candidate.importance as any) || 'normal',
          temporalState: (candidate.temporalState as any) || 'unknown',
          validFrom: candidate.validFrom,
          validUntil: candidate.validUntil,
        }
      );

      // 3. Mark candidate as promoted
      await this.evidenceRepo.markPromoted(candidate.userId, candidate.candidateKey, memoryEntity.id);

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'APPROVE_MEMORY_CANDIDATE',
        resourceType: 'memory_candidate',
        resourceId: id,
        status: 'success',
        metadata: {
          promotedMemoryId: memoryEntity.id,
          category: candidate.category,
        },
        correlationId,
      });

      sendAdminSuccess(res, {
        candidateId: id,
        promotedMemoryId: memoryEntity.id,
        status: 'promoted',
      });
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to approve candidate', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'APPROVE_MEMORY_CANDIDATE',
        resourceType: 'memory_candidate',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to approve candidate');
    }
  };

  public rejectEvidenceCandidate = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Candidate ID is required');
      return;
    }

    const parseRes = RejectCandidateSchema.safeParse(req.body || {});
    const reason = parseRes.success ? parseRes.data.reason : 'Rejected by admin';

    try {
      const ok = await this.evidenceRepo.rejectCandidate(id, reason);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Evidence candidate not found or rejection failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'REJECT_MEMORY_CANDIDATE',
        resourceType: 'memory_candidate',
        resourceId: id,
        status: 'success',
        metadata: { reason },
        correlationId,
      });

      sendAdminSuccess(res, {
        candidateId: id,
        status: 'rejected',
        reason,
      });
    } catch (err: any) {
      logger.error('[Admin Memory] Failed to reject candidate', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'REJECT_MEMORY_CANDIDATE',
        resourceType: 'memory_candidate',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to reject candidate');
    }
  };
}
