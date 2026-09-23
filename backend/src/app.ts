import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler } from './core/errors';
import { logger } from './core/logger';
import { ChatController } from './modules/chat/chat.controller';
import { WhatsAppWebhookHandler } from './modules/whatsapp/webhook';
import { ReminderScheduler } from './modules/reminder/reminder.scheduler';
import { AnalyticsController } from './modules/analytics/analytics.controller';

export function createApp(): Application {
  const app: Application = express();

  // 1. CORS Configuration
  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256'],
    })
  );

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
    res.status(200).json({
      status: 'healthy',
      service: 'craft-agent-backend',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
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

  // 8. Cron Dispatcher Endpoint for Scheduled Reminders
  const reminderScheduler = ReminderScheduler.getInstance();
  const handleCronReminders = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await reminderScheduler.checkAndDispatchDueReminders();
      res.status(200).json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error('Error running reminder cron job', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  };
  app.all('/api/v1/cron/reminders', handleCronReminders);
  app.all('/api/cron/reminders', handleCronReminders);

  // 9. Analytics & Admin Dashboard Routes
  app.get('/dashboard', analyticsController.serveDashboardUI);
  app.get('/admin', analyticsController.serveDashboardUI);
  app.get('/api/admin/analytics', analyticsController.getAnalyticsData);
  app.get('/api/admin/conversations', analyticsController.getConversations);
  app.get('/api/admin/conversations/:id/messages', analyticsController.getConversationTranscript);
  app.get('/api/admin/users/:id/details', analyticsController.getUserDetails);
  app.get('/api/admin/tools-stats', analyticsController.getToolsStats);

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
