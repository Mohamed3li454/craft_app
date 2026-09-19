import { Request, Response } from 'express';
import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { verifyMetaSignature } from './signature';
import { WhatsAppAdapter } from './adapter';
import { WebhookRepository } from '../../database/repositories/webhook.repo';
import { AgentOrchestrator } from '../agent/orchestrator';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { parseDueAt } from '../../database/repositories/reminder.repo';

export class WhatsAppWebhookHandler {
  constructor(
    private whatsappAdapter: WhatsAppAdapter = new WhatsAppAdapter(),
    private webhookRepo: WebhookRepository = new WebhookRepository(),
    private orchestrator: AgentOrchestrator = new AgentOrchestrator(),
    private confirmationService: ConfirmationService = new ConfirmationService(),
    private chatRepo: ChatRepository = new ChatRepository()
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
      const messageType = message.type;

      if (!from) {
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      // 2. Deduplication check
      const alreadyProcessed = await this.webhookRepo.isEventProcessed(eventId);
      if (alreadyProcessed) {
        logger.debug(`Duplicate webhook event [${eventId}] ignored`);
        res.status(200).send('EVENT_RECEIVED');
        return;
      }
      await this.webhookRepo.markEventProcessed(eventId, 'whatsapp', { from, type: messageType });

      // 3. Handle Interactive Button Replies (Quick-Reply Confirmations)
      if (messageType === 'interactive' && message.interactive?.type === 'button_reply') {
        const buttonReply = message.interactive.button_reply;
        const buttonId: string = buttonReply?.id || '';
        const buttonTitle: string = buttonReply?.title || '';

        logger.info(`Received WhatsApp button click from [${from}]: id="${buttonId}", title="${buttonTitle}"`);

        if (buttonId.startsWith('conf_approve_') || buttonId.startsWith('conf_reject_')) {
          const isApprove = buttonId.startsWith('conf_approve_');
          const token = buttonId.replace(isApprove ? 'conf_approve_' : 'conf_reject_', '');
          const decision = isApprove ? 'approved' : 'rejected';

          const resolveResult = await this.confirmationService.verifyAndResolve(token, decision);

          let replyText = '';
          if (resolveResult.success) {
            if (decision === 'approved') {
              const actionName = resolveResult.confirmation?.actionName;
              if (actionName === 'create_reminder') {
                const title = resolveResult.confirmation?.payload?.title || 'التذكير';
                const parsedTime = parseDueAt(resolveResult.confirmation?.payload?.time);
                let formattedTime = resolveResult.confirmation?.payload?.time || 'المحدد';
                if (parsedTime) {
                  formattedTime = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
                    timeZone: 'Africa/Cairo',
                    hour: 'numeric',
                    minute: 'numeric',
                    day: 'numeric',
                    month: 'long',
                  }).format(parsedTime);
                }
                replyText = `✅ تم التأكيد بنجاح!\nتم حفظ وجدولة التذكير:\n• الموضوع: "${title}"\n• الموعد: ${formattedTime}\nسأقوم بتنبيهك في الوقت المحدد بإذن الله.`;
              } else {
                replyText = `✅ تم تأكيد وتنفيذ العملية [${actionName || 'المطلوبة'}] بنجاح!`;
              }
            } else {
              replyText = '❌ تم إلغاء الإجراء بناءً على رغبتك. لن يتم تنفيذ أي عملية.';
            }
          } else {
            replyText = `⚠️ ${resolveResult.message}\n(قد يكون الطلب قد انتهت صلاحيته أو تم اتخاذ قرار بشأنه مسبقاً).`;
          }

          // Persist user interaction and assistant reply into chat history
          const conv = await this.chatRepo.getOrCreateConversation(`wa_${from}`, 'whatsapp');
          await this.chatRepo.saveMessage(conv.id, 'user', 'WhatsApp User', buttonTitle);
          await this.chatRepo.saveMessage(conv.id, 'assistant', 'Craft', replyText);

          await this.whatsappAdapter.sendTextMessage(from, replyText);
          res.status(200).send('EVENT_RECEIVED');
          return;
        }
      }

      // 4. Handle Text Messages
      const text = message.text?.body || '';
      if (!text) {
        logger.debug('Non-text message received without interactive handler, skipping', { messageType });
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      logger.info(`Received WhatsApp message from [${from}]: "${text}"`);

      // 5. Run through unified Agent Orchestrator
      const agentResult = await this.orchestrator.run({
        userId: `wa_${from}`,
        channel: 'whatsapp',
        text,
      });

      // 6. Send reply back to WhatsApp user (Interactive Buttons if confirmation needed, else text)
      if (
        agentResult.status === 'waiting_for_confirmation' &&
        agentResult.confirmationRequest?.token
      ) {
        const token = agentResult.confirmationRequest.token;
        const prompt = `${agentResult.replyText}\n\nاضغط على أحد الأزرار أدناه لتأكيد أو إلغاء التنفيذ:`;

        await this.whatsappAdapter.sendInteractiveButtons(from, prompt, [
          { id: `conf_approve_${token}`, title: 'تأكيد ✅' },
          { id: `conf_reject_${token}`, title: 'إلغاء ❌' },
        ]);
      } else {
        await this.whatsappAdapter.sendTextMessage(from, agentResult.replyText);
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (err: any) {
      logger.error('Error processing WhatsApp webhook payload', { error: err.message });
      if (!res.headersSent) {
        res.status(200).send('EVENT_RECEIVED');
      }
    }
  };
}
