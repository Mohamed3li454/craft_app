import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler } from './core/errors';
import { logger } from './core/logger';
import { ChatController } from './modules/chat/chat.controller';
import { WhatsAppWebhookHandler } from './modules/whatsapp/webhook';
import { ReminderScheduler } from './modules/reminder/reminder.scheduler';
import { ReminderTrigger, TriggerSource } from './modules/reminder';
import { ProactiveScheduler } from './modules/proactive';
import { WhatsAppProactiveDispatcher } from './modules/whatsapp';
import { AnalyticsController } from './modules/analytics/analytics.controller';
import { CandidateReviewController } from './modules/cache/learning/candidate_review.controller';
import { AdminRateLimiter } from './modules/cache/learning/admin_rate_limiter';
import { v4 as uuidv4 } from 'uuid';
import {
  TraceContextManager,
  MetricsCollector,
  HealthSnapshotService,
} from './modules/observability';

export function createApp(): Application {
  const app: Application = express();

  // 1. CORS Configuration
  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256', 'x-admin-token', 'x-admin-actor'],
    })
  );

  // 1.5 Correlation & Trace Context Middleware
  app.use((req: Request, res: Response, next) => {
    const rawCorrId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      `req_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const channel = req.path.startsWith('/webhooks')
      ? 'whatsapp'
      : req.path.startsWith('/api/v1/cron')
      ? 'cron'
      : 'flutter';

    res.setHeader('X-Correlation-ID', rawCorrId);
    (req as any).correlationId = rawCorrId;

    const metrics = MetricsCollector.getInstance();
    metrics.increment('craft.requests.total', 1, { channel });
    const reqStartTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - reqStartTime;
      const statusTag = res.statusCode >= 400 ? 'error' : 'success';
      metrics.observe('craft.request.latency', duration, { channel, status: statusTag });
      if (res.statusCode >= 400) {
        metrics.increment('craft.requests.error', 1, { channel });
      } else {
        metrics.increment('craft.requests.success', 1, { channel });
      }
    });

    TraceContextManager.runWithContext(
      TraceContextManager.createRootContext({ correlationId: rawCorrId, channel }),
      () => next()
    );
  });

  // 2. Body Parsers with Raw Body Capture (for HMAC Signature Verification)
  app.use(
    express.json({
      verify: (req: Request, _res, buf) => {
        (req as any).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // 3. Request Logging Middleware
  app.use((req, _res, next) => {
    logger.debug(`HTTP ${req.method} ${req.path}`);
    next();
  });

  // 4. Health Check Endpoint
  app.get('/health', (_req: Request, res: Response) => {
    const snapshot = HealthSnapshotService.getInstance().getSnapshot();
    res.status(snapshot.status === 'unhealthy' ? 503 : 200).json({
      status: snapshot.status,
      service: 'craft-agent-backend',
      environment: config.nodeEnv,
      timestamp: snapshot.timestamp,
      uptimeSeconds: snapshot.uptimeSeconds,
      snapshot,
    });
  });

  // Privacy Policy and Terms of Service endpoints for Meta compliance
  app.get('/privacy', (_req: Request, res: Response) => {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Privacy Policy - Craft Agent</title></head>
        <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6;">
          <h1>Privacy Policy for Craft Agent</h1>
          <p>Last updated: September 18, 2026</p>
          <p>Craft Agent provides an intelligent AI assistant accessible via WhatsApp and mobile clients.</p>
          <h2>Information We Collect</h2>
          <p>We process messages you send to Craft Agent strictly to understand your requests, perform user-requested actions, and generate conversational replies.</p>
          <h2>Data Protection</h2>
          <p>We do not sell, rent, or share personal information with third parties. Your chat data is used solely for the functionality of the AI assistant.</p>
          <h2>Contact Us</h2>
          <p>For questions or data deletion requests, contact us at mohhamed4413@gmail.com.</p>
        </body>
      </html>
    `);
  });

  app.get('/terms', (_req: Request, res: Response) => {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Terms of Service - Craft Agent</title></head>
        <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6;">
          <h1>Terms of Service for Craft Agent</h1>
          <p>Craft Agent is provided as an AI assistant service. By using this service, you agree to respectful and lawful use.</p>
        </body>
      </html>
    `);
  });

  // 5. Initialize Controllers
  const chatController = new ChatController();
  const whatsappHandler = new WhatsAppWebhookHandler();
  const analyticsController = new AnalyticsController();
  const candidateReviewController = new CandidateReviewController();
  const adminRateLimiter = new AdminRateLimiter();

  // 6. Flutter API Routes (/api/v1)
  app.post('/api/v1/auth/phone', chatController.loginWithPhone);
  app.post('/api/v1/chat', chatController.handleChat);
  app.post('/api/v1/chat/vision', chatController.handleChat);
  app.post('/api/v1/chat/stream', chatController.handleStream);
  app.post('/api/v1/chat/confirm', chatController.handleConfirmation);
  app.get('/api/v1/conversations', chatController.listConversations);
  app.get('/api/v1/user/conversations', chatController.listConversations);
  app.get('/api/v1/conversations/:id/messages', chatController.getMessages);
  app.get('/api/v1/user/reminders', chatController.listReminders);

  // 7. WhatsApp Webhook Routes (/webhooks/whatsapp)
  app.get('/webhooks/whatsapp', whatsappHandler.verifyWebhook);
  app.post('/webhooks/whatsapp', whatsappHandler.handleIncoming);

  // 8. Cron Dispatcher Endpoints (Reminders & Proactive Actions)
  const reminderTrigger = ReminderTrigger.getInstance();
  const proactiveDispatcher = WhatsAppProactiveDispatcher.getInstance();
  const proactiveScheduler = ProactiveScheduler.getInstance(proactiveDispatcher);

  const handleCronReminders = async (req: Request, res: Response): Promise<void> => {
    const cronSecret = process.env.CRON_SECRET;

    if (config.nodeEnv === 'production' && !cronSecret) {
      logger.error('[Cron Auth] CRON_SECRET is not configured in production environment');
      res.status(500).json({ success: false, error: 'Server misconfiguration: CRON_SECRET required in production' });
      return;
    }

    if (cronSecret) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
        logger.warn('[Cron Auth] Unauthorized invocation of reminder cron endpoint');
        res.status(401).json({ success: false, error: 'Unauthorized: invalid or missing cron secret' });
        return;
      }
    }

    const headerSource = req.headers['x-trigger-source'] as string;
    const isVercelCron = Boolean(
      req.headers['x-vercel-cron'] ||
      (req.headers['user-agent'] && req.headers['user-agent'].includes('vercel-cron'))
    );
    const triggerSource: TriggerSource =
      headerSource === 'external_cron' ||
      headerSource === 'vercel_cron' ||
      headerSource === 'manual' ||
      headerSource === 'test'
        ? headerSource
        : isVercelCron
        ? 'vercel_cron'
        : 'external_cron';

    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string);

    let reminderResult: any = { dispatchedCount: 0, remindersDispatched: [] };
    let proactiveResult: any = { claimedCount: 0, dispatchedIntents: [] };
    let reminderError: string | undefined;
    let proactiveError: string | undefined;

    // Strict failure isolation: proactive failure never prevents reminder dispatch, and vice versa
    try {
      reminderResult = await reminderTrigger.execute({
        triggerSource,
        correlationId,
      });
    } catch (err: any) {
      logger.error('Error running reminder cron job via trigger', { error: err.message });
      reminderError = err.message;
    }

    try {
      proactiveResult = await proactiveScheduler.checkAndProcessDueActions();
    } catch (err: any) {
      logger.error('Error running proactive cron job in reminder dispatcher', { error: err.message });
      proactiveError = err.message;
    }

    if (reminderError && proactiveError) {
      res.status(500).json({ success: false, reminderError, proactiveError });
      return;
    }

    res.status(200).json({
      success: reminderResult.success !== false,
      ...reminderResult,
      proactive: proactiveResult,
      timestamp: new Date().toISOString(),
    });
  };

  const handleCronProactive = async (req: Request, res: Response): Promise<void> => {
    const cronSecret = process.env.CRON_SECRET;

    if (config.nodeEnv === 'production' && !cronSecret) {
      logger.error('[Cron Auth] CRON_SECRET is not configured in production environment');
      res.status(500).json({ success: false, error: 'Server misconfiguration: CRON_SECRET required in production' });
      return;
    }

    if (cronSecret) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
        logger.warn('[Cron Auth] Unauthorized invocation of proactive cron endpoint');
        res.status(401).json({ success: false, error: 'Unauthorized: invalid or missing cron secret' });
        return;
      }
    }

    try {
      const result = await proactiveScheduler.checkAndProcessDueActions();
      res.status(200).json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error('Error running dedicated proactive cron job', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  };

  app.all('/api/v1/cron/reminders', handleCronReminders);
  app.all('/api/cron/reminders', handleCronReminders);
  app.all('/api/v1/cron/proactive', handleCronProactive);
  app.all('/api/cron/proactive', handleCronProactive);

  // 9. Analytics & Admin Dashboard Routes
  app.get('/dashboard', analyticsController.serveDashboardUI);
  app.get('/admin', analyticsController.serveDashboardUI);
  app.get('/api/admin/analytics', analyticsController.getAnalyticsData);
  app.get('/api/admin/conversations', analyticsController.getConversations);
  app.get('/api/admin/conversations/:id/messages', analyticsController.getConversationTranscript);
  app.get('/api/admin/users/:id/details', analyticsController.getUserDetails);
  app.post('/api/admin/users/:id/toggle-vip', analyticsController.toggleUserVip);
  app.get('/api/admin/tools-stats', analyticsController.getToolsStats);
  app.get('/api/admin/faq', analyticsController.getFaqs);
  app.post('/api/admin/faq', analyticsController.createFaq);
  app.put('/api/admin/faq/:id', analyticsController.updateFaq);
  app.delete('/api/admin/faq/:id', analyticsController.deleteFaq);
  app.get('/api/admin/semantic-cache/dashboard', analyticsController.getSemanticCacheDashboard);

  // 10. Semantic Cache Admin & Review Routes (/api/admin/cache)
  app.use('/api/admin/cache', adminRateLimiter.middleware);
  app.get('/api/admin/cache/candidates', candidateReviewController.listCandidates);
  app.get('/api/admin/cache/candidates/:id', candidateReviewController.getCandidate);
  app.post('/api/admin/cache/candidates/:id/validate', candidateReviewController.validateCandidate);
  app.post('/api/admin/cache/candidates/:id/reject', candidateReviewController.rejectCandidate);
  app.post('/api/admin/cache/candidates/:id/promote', candidateReviewController.promoteCandidate);
  app.get('/api/admin/cache/stats', candidateReviewController.getCacheStats);
  app.get('/api/admin/cache/learning-stats', candidateReviewController.getLearningStats);
  app.post('/api/admin/cache/feedback/incorrect', candidateReviewController.markIncorrect);

  // 4.1 Root Endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'online',
      service: 'craft-agent-backend',
      environment: config.nodeEnv,
      version: '1.0.0',
      endpoints: {
        health: '/health',
        privacy: '/privacy',
        terms: '/terms',
        dashboard: '/dashboard',
        analyticsApi: '/api/admin/analytics',
        whatsappWebhook: '/webhooks/whatsapp',
        chatApi: '/api/v1/chat',
      },
    });
  });

  // 8. Global Error Handler Middleware
  app.use(errorHandler);

  return app;
}

const defaultApp = createApp();
export default defaultApp;
