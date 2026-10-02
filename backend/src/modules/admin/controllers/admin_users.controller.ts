import { Request, Response } from 'express';
import { UserRepository } from '../../../database/repositories/user.repo';
import { AnalyticsRepository } from '../../../database/repositories/analytics.repo';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError, getCorrelationId, getAdminActor } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { logger } from '../../../core/logger';
import { z } from 'zod';

const BanUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export class AdminUsersController {
  constructor(
    private userRepo: UserRepository = new UserRepository(),
    private analyticsRepo: AnalyticsRepository = new AnalyticsRepository(),
    private auditService: AdminAuditService = AdminAuditService.getInstance()
  ) {}

  public getUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
      const isVip = req.query.isVip !== undefined ? req.query.isVip === 'true' : undefined;
      const isBanned = req.query.isBanned !== undefined ? req.query.isBanned === 'true' : undefined;

      const { users, total } = await this.analyticsRepo.getUsersList({
        search,
        isVip,
        isBanned,
        limit,
        offset,
      });

      sendAdminSuccess(res, users, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Users] Failed to list users', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve users list');
    }
  };

  public getUserDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const userIdOrPhone = req.params.id;
      if (!userIdOrPhone || userIdOrPhone.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'User ID or phone number is required');
        return;
      }

      const details = await this.analyticsRepo.getUserDetails(userIdOrPhone);
      if (!details) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'User details not found');
        return;
      }

      sendAdminSuccess(res, details);
    } catch (err: any) {
      logger.error('[Admin Users] Failed to get user details', { error: err.message, userId: req.params.id });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve user details');
    }
  };

  public toggleUserVip = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const userId = req.params.id;

    if (!userId || userId.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'User ID is required');
      return;
    }

    try {
      const { isVip } = req.body || {};
      let newVip: boolean | null = null;
      if (typeof isVip === 'boolean') {
        const ok = await this.userRepo.setVipStatus(userId, isVip);
        if (ok) newVip = isVip;
      } else {
        newVip = await this.userRepo.toggleVipStatus(userId);
      }

      if (newVip === null) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'User not found or VIP update failed');
        return;
      }

      // Record state mutation in audit trail
      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'TOGGLE_USER_VIP',
        resourceType: 'user',
        resourceId: userId,
        status: 'success',
        metadata: { newVip },
        correlationId,
      });

      sendAdminSuccess(res, {
        id: userId,
        isVip: newVip,
      });
    } catch (err: any) {
      logger.error('[Admin Users] Failed to toggle VIP status', { error: err.message, userId });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'TOGGLE_USER_VIP',
        resourceType: 'user',
        resourceId: userId,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to update VIP status');
    }
  };

  public banUser = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const userId = req.params.id;

    if (!userId || userId.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'User ID is required');
      return;
    }

    const parseRes = BanUserSchema.safeParse(req.body || {});
    if (!parseRes.success) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Invalid ban payload', parseRes.error.format());
      return;
    }

    const { reason } = parseRes.data;

    try {
      const ok = await this.userRepo.banUser(userId, reason);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'User not found or ban update failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'BAN_USER',
        resourceType: 'user',
        resourceId: userId,
        status: 'success',
        metadata: { reason: reason || 'Banned by admin' },
        correlationId,
      });

      sendAdminSuccess(res, {
        id: userId,
        isBanned: true,
        reason: reason || 'Banned by admin',
      });
    } catch (err: any) {
      logger.error('[Admin Users] Failed to ban user', { error: err.message, userId });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'BAN_USER',
        resourceType: 'user',
        resourceId: userId,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to ban user');
    }
  };

  public unbanUser = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';
    const userId = req.params.id;

    if (!userId || userId.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'User ID is required');
      return;
    }

    try {
      const ok = await this.userRepo.unbanUser(userId);
      if (!ok) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'User not found or unban failed');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UNBAN_USER',
        resourceType: 'user',
        resourceId: userId,
        status: 'success',
        correlationId,
      });

      sendAdminSuccess(res, {
        id: userId,
        isBanned: false,
      });
    } catch (err: any) {
      logger.error('[Admin Users] Failed to unban user', { error: err.message, userId });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UNBAN_USER',
        resourceType: 'user',
        resourceId: userId,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to unban user');
    }
  };
}
