import { Request, Response } from 'express';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { logger } from '../../../core/logger';

export class AdminAuditController {
  constructor(private auditService: AdminAuditService = AdminAuditService.getInstance()) {}

  public getAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, cursor } = parsePaginationQuery(req.query);
      const action = req.query.action as string | undefined;
      const resourceType = req.query.resourceType as string | undefined;
      const resourceId = req.query.resourceId as string | undefined;
      const status = req.query.status as 'success' | 'failure' | undefined;

      const result = await this.auditService.listLogs({
        limit,
        cursor,
        action,
        resourceType,
        resourceId,
        status,
      });

      sendAdminSuccess(res, result.items, {
        nextCursor: result.nextCursor,
        total: result.items.length,
      });
    } catch (err: any) {
      logger.error('[Admin Audit] Failed to retrieve audit logs', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve audit trail');
    }
  };
}
