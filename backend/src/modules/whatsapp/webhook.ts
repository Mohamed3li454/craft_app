import { Request, Response } from 'express';
import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { verifyMetaSignature } from './signature';
import { WhatsAppAdapter } from './adapter';
import { WebhookRepository } from '../../database/repositories/webhook.repo';
import { AgentOrchestrator } from '../agent/orchestrator';

export class WhatsAppWebhookHandler {
  constructor(
    private whatsappAdapter: WhatsAppAdapter = new WhatsAppAdapter(),
    private webhookRepo: WebhookRepository = new WebhookRepository(),
    private orchestrator: AgentOrchestrator = new AgentOrchestrator()
  ) {}

  /**
   * Meta Webhook Verification Handshake (GET)
   */
  public verifyWebhook = (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      logger.info('WhatsApp Webhook successfully verified with Meta');
      res.status(200).send(challenge);
      return;
    }

    logger.warn('WhatsApp Webhook verification failed — token mismatch', {
      receivedToken: token,
      expectedToken: config.whatsapp.verifyToken,
    });
    res.status(403).send('Verification failed');
  };

  /**
   * Incoming Message Ingestion (POST)
   */
  public handleIncoming = async (req: Request, res: Response): Promise<void> => {
    // 1. Verify HMAC Signature
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    if (!verifyMetaSignature(rawBody, signature)) {
      res.status(401).send('Invalid signature');
      return;
    }

    try {
      const body = req.body;
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (!message) {
        // Status updates, acknowledgements, etc.
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      const eventId = message.id; // wamid
      const from = message.from; // User phone number
      const text = message.text?.body || '';

      if (!text || !from) {
        logger.debug('Non-text or empty WhatsApp message received, skipping', { messageType: message.type });
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      // 3. Deduplication check
      const alreadyProcessed = await this.webhookRepo.isEventProcessed(eventId);
      if (alreadyProcessed) {
        logger.debug(`Duplicate webhook event [${eventId}] ignored`);
        res.status(200).send('EVENT_RECEIVED');
        return;
      }
      await this.webhookRepo.markEventProcessed(eventId, 'whatsapp', { from, text });

      logger.info(`Received WhatsApp message from [${from}]: "${text}"`);

      // 4. Run through unified Agent Orchestrator
      const agentResult = await this.orchestrator.run({
        userId: `wa_${from}`,
        channel: 'whatsapp',
        text,
      });

      // 5. Send reply back to WhatsApp user
      await this.whatsappAdapter.sendTextMessage(from, agentResult.replyText);

      res.status(200).send('EVENT_RECEIVED');
    } catch (err: any) {
      logger.error('Error processing WhatsApp webhook payload', { error: err.message });
      if (!res.headersSent) {
        res.status(200).send('EVENT_RECEIVED');
      }
    }
  };
}
