import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { AnalyticsRepository } from '../../database/repositories/analytics.repo';

export class AnalyticsController {
  constructor(
    private analyticsRepo: AnalyticsRepository = new AnalyticsRepository()
  ) {}

  private isAuthorized(req: Request): boolean {
    const queryToken = req.query.token as string;
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-admin-token'] as string;

    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;

    const providedToken = queryToken || bearerToken || customHeader;
    const expectedToken = config.admin.secretKey;

    if (!providedToken || !expectedToken) {
      return false;
    }

    return providedToken === expectedToken;
  }

  public getAnalyticsData = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({
        success: false,
        error: 'غير مصرح بالدخول (Unauthorized). يرجى إدخال رمز الأمان الصحيح (Admin Secret Key).',
      });
      return;
    }

    try {
      const days = parseInt(req.query.days as string, 10) || 14;
      const userLimit = parseInt(req.query.userLimit as string, 10) || 10;
      const recentLimit = parseInt(req.query.limit as string, 10) || 30;

      const [overview, dailyTrends, modelBreakdown, mediaBreakdown, topUsers, recentInteractions] =
        await Promise.all([
          this.analyticsRepo.getOverviewStats(),
          this.analyticsRepo.getDailyTrends(days),
          this.analyticsRepo.getModelBreakdown(),
          this.analyticsRepo.getMediaTypeBreakdown(),
          this.analyticsRepo.getTopUsers(userLimit),
          this.analyticsRepo.getRecentInteractions(recentLimit),
        ]);

      res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        overview,
        dailyTrends,
        modelBreakdown,
        mediaBreakdown,
        topUsers,
        recentInteractions,
      });
    } catch (err: any) {
      logger.error('Failed to aggregate analytics data', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public serveDashboardUI = (_req: Request, res: Response): void => {
    const htmlPath = path.join(__dirname, 'dashboard.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
      return;
    }

    // Fallback if file not found at runtime
    res.status(200).send(this.getEmbeddedHtmlFallback());
  };

  private getEmbeddedHtmlFallback(): string {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>Craft Analytics</title>
</head>
<body style="font-family: sans-serif; padding: 40px; background: #0f172a; color: #fff; text-align: center;">
  <h1>لوحة تحكم كرافت (Craft Analytics)</h1>
  <p>جاري تحميل البيانات...</p>
</body>
</html>`;
  }
}
