import { Request, Response } from 'express';
import { AnalyticsRepository } from '../../../database/repositories/analytics.repo';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError, getCorrelationId, getAdminActor } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { logger } from '../../../core/logger';
import { z } from 'zod';

const ArchiveSchema = z.object({
  isArchived: z.boolean().default(true),
});

export class AdminConversationsController {
  constructor(
    private analyticsRepo: AnalyticsRepository = new AnalyticsRepository(),
    private auditService: AdminAuditService = AdminAuditService.getInstance()
  ) {}

  public getConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const channel = typeof req.query.channel === 'string' ? req.query.channel : undefined;
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const includeArchived = req.query.includeArchived === 'true';

      const conversations = await this.analyticsRepo.getConversationsList({
        limit,
        offset,
        search,
        channel,
        userId,
        startDate,
        endDate,
        includeArchived,
      });

      sendAdminSuccess(res, conversations, { nextCursor: null, total: conversations.length });
    } catch (err: any) {
      logger.error('[Admin Conversations] Failed to list conversations', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve conversations list');
    }
  };

  public getConversationTranscript = async (req: Request, res: Response): Promise<void> => {
    try {
      const convId = req.params.id;
      if (!convId || convId.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Conversation ID is required');
        return;
      }

      const { limit, offset } = parsePaginationQuery(req.query);
      const transcript = await this.analyticsRepo.getConversationTranscript(convId, { limit, offset });

      sendAdminSuccess(res, transcript, { nextCursor: null, total: transcript.length });
    } catch (err: any) {
      logger.error('[Admin Conversations] Failed to get conversation transcript', {
        error: err.message,
        convId: req.params.id,
      });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve transcript');
    }
  };

  public archiveConversation = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const convId = req.params.id;

    if (!convId || convId.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Conversation ID is required');
      return;
    }

    const parseRes = ArchiveSchema.safeParse(req.body || {});
    if (!parseRes.success) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Invalid archive payload', parseRes.error.format());
      return;
    }

    const { isArchived } = parseRes.data;

    try {
      const ok = await this.analyticsRepo.archiveConversation(convId, isArchived);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Conversation not found or archive failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: isArchived ? 'ARCHIVE_CONVERSATION' : 'UNARCHIVE_CONVERSATION',
        resourceType: 'conversation',
        resourceId: convId,
        status: 'success',
        metadata: { isArchived },
        correlationId,
      });

      sendAdminSuccess(res, {
        id: convId,
        isArchived,
      });
    } catch (err: any) {
      logger.error('[Admin Conversations] Failed to archive conversation', { error: err.message, convId });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: isArchived ? 'ARCHIVE_CONVERSATION' : 'UNARCHIVE_CONVERSATION',
        resourceType: 'conversation',
        resourceId: convId,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to update conversation archive status');
    }
  };
}
