import { Request, Response } from 'express';
import { ReminderRepository } from '../../../database/repositories/reminder.repo';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError, getCorrelationId, getAdminActor } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { logger } from '../../../core/logger';
import { z } from 'zod';

const CancelReminderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export class AdminRemindersController {
  constructor(
    private reminderRepo: ReminderRepository = new ReminderRepository(),
    private auditService: AdminAuditService = AdminAuditService.getInstance()
  ) {}

  public getReminders = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : undefined;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : undefined;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : undefined;

      const { items, total } = await this.reminderRepo.listAllReminders({
        status,
        userId,
        startDate,
        endDate,
        limit,
        offset,
      });

      sendAdminSuccess(res, items, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Reminders] Failed to list reminders', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve reminders list');
    }
  };

  public getReminderDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      if (!id || id.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Reminder ID is required');
        return;
      }

      const reminder = await this.reminderRepo.getById(id);
      if (!reminder) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Reminder not found');
        return;
      }

      sendAdminSuccess(res, {
        id: reminder.id,
        userId: reminder.userId,
        title: reminder.title,
        dueAt: reminder.dueAt,
        recurrence: reminder.recurrence,
        isCompleted: reminder.isCompleted,
        state: reminder.state,
        attempts: reminder.attempts,
        lockedUntil: reminder.lockedUntil,
        lastError: reminder.lastError,
        wamid: reminder.wamid,
        createdAt: reminder.createdAt,
        updatedAt: reminder.updatedAt,
      });
    } catch (err: any) {
      logger.error('[Admin Reminders] Failed to get reminder details', { error: err.message, id: req.params.id });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve reminder details');
    }
  };

  public cancelReminder = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Reminder ID is required');
      return;
    }

    const parseRes = CancelReminderSchema.safeParse(req.body || {});
    const reason = parseRes.success ? parseRes.data.reason : 'Cancelled by admin';

    try {
      const ok = await this.reminderRepo.cancelById(id);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Reminder not found or cancel failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'CANCEL_REMINDER',
        resourceType: 'reminder',
        resourceId: id,
        status: 'success',
        metadata: { reason },
        correlationId,
      });

      sendAdminSuccess(res, {
        id,
        state: 'cancelled',
        reason,
      });
    } catch (err: any) {
      logger.error('[Admin Reminders] Failed to cancel reminder', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'CANCEL_REMINDER',
        resourceType: 'reminder',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to cancel reminder');
    }
  };

  /**
   * Retries a failed/dead_letter reminder by putting it back into 'retry_pending'
   * in the scheduler lifecycle.
   * STRICT NOTE: NEVER bypass the standard scheduler or send WhatsApp messages directly from Admin.
   */
  public retryReminder = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Reminder ID is required');
      return;
    }

    try {
      const updated = await this.reminderRepo.adminRetryReminder(id);
      if (!updated) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Reminder not found or retry failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'RETRY_REMINDER',
        resourceType: 'reminder',
        resourceId: id,
        status: 'success',
        metadata: {
          newState: updated.state,
          attempts: updated.attempts,
        },
        correlationId,
      });

      sendAdminSuccess(res, {
        id: updated.id,
        state: updated.state,
        dueAt: updated.dueAt,
        message: 'Reminder queued for scheduler delivery retry',
      });
    } catch (err: any) {
      logger.error('[Admin Reminders] Failed to retry reminder', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'RETRY_REMINDER',
        resourceType: 'reminder',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retry reminder');
    }
  };
}
