import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { AnalyticsRepository } from '../../database/repositories/analytics.repo';
import { UserRepository } from '../../database/repositories/user.repo';

export class AnalyticsController {
  constructor(
    private analyticsRepo: AnalyticsRepository = new AnalyticsRepository(),
    private userRepo: UserRepository = new UserRepository()
  ) {}

  public isAuthorized(req: Request): boolean {
    const queryToken = req.query?.token as string;
    const authHeader = req.headers?.authorization;
    const customHeader = req.headers?.['x-admin-token'] as string;

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

      res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        overview,
        dailyTrends,
        hourlyDistribution,
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

  /**
   * GET /api/admin/conversations
   */
  public getConversations = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const search = req.query.search as string;
      const channel = req.query.channel as string;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const conversations = await this.analyticsRepo.getConversationsList({
        search,
        channel,
        limit,
        offset,
      });

      res.status(200).json({ success: true, conversations });
    } catch (err: any) {
      logger.error('Failed to get conversations list', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/admin/conversations/:id/messages
   */
  public getConversationTranscript = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const conversationId = req.params.id;
      const messages = await this.analyticsRepo.getConversationTranscript(conversationId);
      res.status(200).json({ success: true, messages });
    } catch (err: any) {
      logger.error('Failed to get conversation transcript', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/admin/users/:id/details
   */
  public getUserDetails = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const userIdOrPhone = req.params.id;
      const details = await this.analyticsRepo.getUserDetails(userIdOrPhone);
      if (!details) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      res.status(200).json({ success: true, ...details });
    } catch (err: any) {
      logger.error('Failed to get user details', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/admin/tools-stats
   */
  public getToolsStats = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const stats = await this.analyticsRepo.getToolsStats();
      res.status(200).json({ success: true, ...stats });
    } catch (err: any) {
      logger.error('Failed to get tools stats', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * POST /api/admin/users/:id/toggle-vip
   */
  public toggleUserVip = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthorized(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const userId = req.params.id;
      const { isVip } = req.body || {};
      let newVip: boolean | null = null;
      if (typeof isVip === 'boolean') {
        const ok = await this.userRepo.setVipStatus(userId, isVip);
        if (ok) newVip = isVip;
      } else {
        newVip = await this.userRepo.toggleVipStatus(userId);
      }

      if (newVip === null) {
        res.status(404).json({ success: false, error: 'User not found or update failed' });
        return;
      }

      res.status(200).json({
        success: true,
        user: {
          id: userId,
          isVip: newVip,
        },
      });
    } catch (err: any) {
      logger.error('Failed to toggle user VIP status', { error: err.message });
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
