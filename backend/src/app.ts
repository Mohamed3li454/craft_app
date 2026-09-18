import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler } from './core/errors';
import { logger } from './core/logger';
import { ChatController } from './modules/chat/chat.controller';
import { WhatsAppWebhookHandler } from './modules/whatsapp/webhook';

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

  // 5. Initialize Controllers
  const chatController = new ChatController();
  const whatsappHandler = new WhatsAppWebhookHandler();

  // 6. Flutter API Routes (/api/v1)
  app.post('/api/v1/chat', chatController.handleChat);
  app.post('/api/v1/chat/vision', chatController.handleChat);
  app.post('/api/v1/chat/stream', chatController.handleStream);
  app.post('/api/v1/chat/confirm', chatController.handleConfirmation);
  app.get('/api/v1/conversations', chatController.listConversations);
  app.get('/api/v1/conversations/:id/messages', chatController.getMessages);

  // 7. WhatsApp Webhook Routes (/webhooks/whatsapp)
  app.get('/webhooks/whatsapp', whatsappHandler.verifyWebhook);
  app.post('/webhooks/whatsapp', whatsappHandler.handleIncoming);

  // 8. Global Error Handler Middleware
  app.use(errorHandler);

  return app;
}
