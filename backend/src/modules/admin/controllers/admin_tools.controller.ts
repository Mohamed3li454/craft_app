import { Request, Response } from 'express';
import { AnalyticsRepository } from '../../../database/repositories/analytics.repo';
import { sendAdminSuccess, sendAdminError } from '../admin.types';
import { logger } from '../../../core/logger';

export class AdminToolsController {
  constructor(private analyticsRepo: AnalyticsRepository = new AnalyticsRepository()) {}

  public getToolsStats = async (_req: Request, res: Response): Promise<void> => {
    try {
      const stats = await this.analyticsRepo.getToolsStats();
      sendAdminSuccess(res, stats);
    } catch (err: any) {
      logger.error('[Admin Tools] Failed to get tools stats', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve tools statistics');
    }
  };
}
