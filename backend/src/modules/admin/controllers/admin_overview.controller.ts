import { Request, Response } from 'express';
import { AnalyticsRepository } from '../../../database/repositories/analytics.repo';
import { logger } from '../../../core/logger';
import { sendAdminSuccess, sendAdminError } from '../admin.types';

export class AdminOverviewController {
  constructor(private analyticsRepo: AnalyticsRepository = new AnalyticsRepository()) {}

  public getOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const days = parseInt(req.query.days as string, 10) || 14;
      const userLimit = parseInt(req.query.userLimit as string, 10) || 15;
      const recentLimit = parseInt(req.query.limit as string, 10) || 30;

      const [overview, dailyTrends, hourlyDistribution, modelBreakdown, mediaBreakdown, topUsers, recentInteractions] =
        await Promise.all([
          this.analyticsRepo.getOverviewStats(),
          this.analyticsRepo.getDailyTrends(days),
          this.analyticsRepo.getHourlyDistribution(),
          this.analyticsRepo.getModelBreakdown(),
          this.analyticsRepo.getMediaTypeBreakdown(),
          this.analyticsRepo.getTopUsers(userLimit),
          this.analyticsRepo.getRecentInteractions(recentLimit),
        ]);

      sendAdminSuccess(res, {
        overview,
        dailyTrends,
        hourlyDistribution,
        modelBreakdown,
        mediaBreakdown,
        topUsers,
        recentInteractions,
      });
    } catch (err: any) {
      logger.error('[Admin API] Failed to aggregate overview data', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve analytics overview', {
        error: err.message,
      });
    }
  };
}
