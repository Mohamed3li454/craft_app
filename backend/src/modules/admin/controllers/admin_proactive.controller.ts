import { Request, Response } from 'express';
import { ProactiveActionRepository } from '../../proactive/proactive_action.repo';
import { ProactiveDispatchRepository } from '../../whatsapp/proactive_dispatch.repo';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError, getCorrelationId, getAdminActor } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { logger } from '../../../core/logger';
import { z } from 'zod';

const CancelActionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export class AdminProactiveController {
  constructor(
    private proactiveRepo: ProactiveActionRepository = new ProactiveActionRepository(),
    private dispatchRepo: ProactiveDispatchRepository = new ProactiveDispatchRepository(),
    private auditService: AdminAuditService = AdminAuditService.getInstance()
  ) {}

  public getActions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : undefined;
      const candidateType = typeof req.query.candidateType === 'string' ? req.query.candidateType.trim() : undefined;

      const { items, total } = await this.proactiveRepo.listAll({
        status,
        userId,
        candidateType,
        limit,
        offset,
      });

      sendAdminSuccess(res, items, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Proactive] Failed to list proactive actions', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve proactive actions');
    }
  };

  public getActionDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      if (!id || id.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Proactive Action ID is required');
        return;
      }

      const action = await this.proactiveRepo.findById(id);
      if (!action) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Proactive action not found');
        return;
      }

      sendAdminSuccess(res, action);
    } catch (err: any) {
      logger.error('[Admin Proactive] Failed to get proactive action details', { error: err.message, id: req.params.id });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve action details');
    }
  };

  public cancelAction = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Action ID is required');
      return;
    }

    const parseRes = CancelActionSchema.safeParse(req.body || {});
    const reason = parseRes.success ? parseRes.data.reason : 'Cancelled by admin';

    try {
      const ok = await this.proactiveRepo.cancelAction(id, reason);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Action not found or cancellation not allowed for current state');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'CANCEL_PROACTIVE_ACTION',
        resourceType: 'proactive_action',
        resourceId: id,
        status: 'success',
        metadata: { reason },
        correlationId,
      });

      sendAdminSuccess(res, {
        id,
        status: 'suppressed',
        reason,
      });
    } catch (err: any) {
      logger.error('[Admin Proactive] Failed to cancel action', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'CANCEL_PROACTIVE_ACTION',
        resourceType: 'proactive_action',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to cancel proactive action');
    }
  };

  public retryAction = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Action ID is required');
      return;
    }

    try {
      const ok = await this.proactiveRepo.retryAction(id);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Action not found or retry failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'RETRY_PROACTIVE_ACTION',
        resourceType: 'proactive_action',
        resourceId: id,
        status: 'success',
        correlationId,
      });

      sendAdminSuccess(res, {
        id,
        status: 'pending',
        message: 'Action queued for proactive evaluation',
      });
    } catch (err: any) {
      logger.error('[Admin Proactive] Failed to retry action', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'RETRY_PROACTIVE_ACTION',
        resourceType: 'proactive_action',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retry proactive action');
    }
  };

  public getDispatchLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : undefined;

      const { items, total } = await this.dispatchRepo.listDispatchLogs({
        status,
        userId,
        limit,
        offset,
      });

      sendAdminSuccess(res, items, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Proactive] Failed to list dispatch logs', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve dispatch logs');
    }
  };

  public getEngagement = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const { items, total } = await this.dispatchRepo.listEngagements({ limit, offset });

      sendAdminSuccess(res, items, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Proactive] Failed to list engagements', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve engagement statistics');
    }
  };
}
