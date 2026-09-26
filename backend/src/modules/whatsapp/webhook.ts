import { Request, Response } from 'express';
import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { verifyMetaSignature } from './signature';
import { WhatsAppAdapter } from './adapter';
import { WebhookRepository } from '../../database/repositories/webhook.repo';
import { AgentOrchestrator, AgentMediaAttachment } from '../agent/orchestrator';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { parseDueAt } from '../../database/repositories/reminder.repo';
import { UserRepository } from '../../database/repositories/user.repo';

export class WhatsAppWebhookHandler {
  constructor(
    private whatsappAdapter: WhatsAppAdapter = new WhatsAppAdapter(),
    private webhookRepo: WebhookRepository = new WebhookRepository(),
    private orchestrator: AgentOrchestrator = new AgentOrchestrator(),
    private confirmationService: ConfirmationService = new ConfirmationService(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private userRepo: UserRepository = new UserRepository()
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

    let fromNumber = '';
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
      const messageType = message.type;

      // Priority: message.from -> message.from_user_id -> value.contacts[0].user_id -> value.contacts[0].wa_id
      const senderId: string =
        message.from ||
        message.from_user_id ||
        value?.contacts?.[0]?.user_id ||
        value?.contacts?.[0]?.wa_id ||
        '';

      fromNumber = senderId;

      if (!senderId) {
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      const isPhone = !!message.from && /^\+?\d+$/.test(message.from);
      const phone = isPhone ? message.from : undefined;
      const bsuid = !isPhone ? senderId : (message.from_user_id || value?.contacts?.[0]?.user_id);

      const contact = value?.contacts?.[0];
      const profileName = contact?.profile?.name;

      // 1. Parallelize user resolution and deduplication check
      const [user, alreadyProcessed] = await Promise.all([
        this.userRepo.findOrCreateWhatsAppUser({
          phone,
          bsuid,
          displayName: profileName,
        }),
        this.webhookRepo.isEventProcessed(eventId),
      ]);

      if (alreadyProcessed) {
        logger.debug(`Duplicate webhook event [${eventId}] ignored`);
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      this.webhookRepo.markEventProcessed(eventId, 'whatsapp', { type: messageType }).catch((err) => {
        logger.debug('Failed to mark event processed in background', { error: err.message });
      });

      // 3. Handle Interactive Button Replies (Quick-Reply Confirmations)
      if (messageType === 'interactive' && message.interactive?.type === 'button_reply') {
        if (typeof this.whatsappAdapter.sendTypingIndicator === 'function') {
          this.whatsappAdapter.sendTypingIndicator(eventId).catch(() => {});
        }
        const buttonReply = message.interactive.button_reply;
        const buttonId: string = buttonReply?.id || '';
        const buttonTitle: string = buttonReply?.title || '';

        logger.info(`Received WhatsApp button click: id="${buttonId}", title="${buttonTitle}"`);

        if (buttonId.startsWith('conf_approve_') || buttonId.startsWith('conf_reject_')) {
          const isApprove = buttonId.startsWith('conf_approve_');
          const token = buttonId.replace(isApprove ? 'conf_approve_' : 'conf_reject_', '');
          const decision = isApprove ? 'approved' : 'rejected';

          const resolveResult = await this.confirmationService.verifyAndResolve(token, decision);

          const isEnglish =
            buttonTitle.toLowerCase().includes('confirm') ||
            buttonTitle.toLowerCase().includes('cancel');

          let replyText = '';
          if (resolveResult.success) {
            if (decision === 'approved') {
              const actionName = resolveResult.confirmation?.actionName;
              if (actionName === 'create_reminder') {
                const title = resolveResult.confirmation?.payload?.title || (isEnglish ? 'Reminder' : 'التذكير');
                const parsedTime = parseDueAt(resolveResult.confirmation?.payload?.time);
                const recurrence = resolveResult.confirmation?.payload?.recurrence || 'none';
                let formattedTime = resolveResult.confirmation?.payload?.time || (isEnglish ? 'Scheduled time' : 'المحدد');
                if (parsedTime) {
                  formattedTime = new Intl.DateTimeFormat(isEnglish ? 'en-US' : 'ar-EG-u-nu-latn', {
                    timeZone: 'Africa/Cairo',
                    hour: 'numeric',
                    minute: 'numeric',
                    day: 'numeric',
                    month: 'long',
                  }).format(parsedTime);
                }
                const recurrenceLine = isEnglish
                  ? (recurrence === 'daily'
                      ? '\n• Recurrence: Daily (at the same time) 🔄'
                      : recurrence === 'weekly'
                      ? '\n• Recurrence: Weekly 🔄'
                      : recurrence === 'monthly'
                      ? '\n• Recurrence: Monthly 🔄'
                      : '')
                  : (recurrence === 'daily'
                      ? '\n• التكرار: يومياً (كل يوم في نفس الموعد) 🔄'
                      : recurrence === 'weekly'
                      ? '\n• التكرار: أسبوعياً 🔄'
                      : recurrence === 'monthly'
                      ? '\n• التكرار: شهرياً 🔄'
                      : '');
                replyText = isEnglish
                  ? `✅ Successfully confirmed!\nReminder scheduled:\n• Topic: "${title}"\n• Time: ${formattedTime}${recurrenceLine}\nI will notify you at the scheduled time.`
                  : `✅ تم التأكيد بنجاح!\nتم حفظ وجدولة التذكير:\n• الموضوع: "${title}"\n• الموعد: ${formattedTime}${recurrenceLine}\nسيتم التنبيه في الموعد المحدد.`;
              } else {
                replyText = isEnglish
                  ? `✅ Action [${actionName || 'Requested'}] confirmed and executed successfully!`
                  : `✅ تم تأكيد وتنفيذ العملية [${actionName || 'المطلوبة'}] بنجاح!`;
              }
            } else {
              replyText = isEnglish
                ? '❌ Action was cancelled at your request. Nothing will be executed.'
                : '❌ تم إلغاء الإجراء بناءً على رغبتك. لن يتم تنفيذ أي عملية.';
            }
          } else {
            replyText = isEnglish
              ? `⚠️ ${resolveResult.message}\n(The request may have expired or already been resolved).`
              : `⚠️ ${resolveResult.message}\n(قد يكون الطلب قد انتهت صلاحيته أو تم اتخاذ قرار بشأنه مسبقاً).`;
          }

          // Persist user interaction and assistant reply into chat history
          const conv = await this.chatRepo.getOrCreateConversation(user.id, 'whatsapp');
          await this.chatRepo.saveMessage(conv.id, 'user', user.name || 'WhatsApp User', buttonTitle);
          await this.chatRepo.saveMessage(conv.id, 'assistant', 'Craft', replyText);

          await this.whatsappAdapter.sendTextMessage(senderId, replyText);
          res.status(200).send('EVENT_RECEIVED');
          return;
        }
      }

      // Trigger typing indicator and read status immediately for responsiveness
      if (typeof this.whatsappAdapter.sendTypingIndicator === 'function') {
        this.whatsappAdapter.sendTypingIndicator(eventId).catch((err) => {
          logger.debug('Failed to dispatch typing indicator', { error: err.message, eventId });
        });
      }

      // 4. Extract message content and media attachments (image, document, text)
      let text = '';
      let mediaAttachment: AgentMediaAttachment | undefined;

      if (messageType === 'text') {
        text = message.text?.body || '';
      } else if (messageType === 'image') {
        text = message.image?.caption || '';
        const mediaId = message.image?.id;
        const mimeType = message.image?.mime_type || 'image/jpeg';
        if (mediaId) {
          const downloaded = await this.whatsappAdapter.downloadMedia(mediaId);
          if (downloaded) {
            mediaAttachment = {
              buffer: downloaded.buffer,
              mimeType: downloaded.mimeType || mimeType,
            };
          }
        }
      } else if (messageType === 'document') {
        text = message.document?.caption || '';
        const mediaId = message.document?.id;
        const filename = message.document?.filename;
        const mimeType = message.document?.mime_type || 'application/octet-stream';
        if (mediaId) {
          const downloaded = await this.whatsappAdapter.downloadMedia(mediaId);
          if (downloaded) {
            mediaAttachment = {
              buffer: downloaded.buffer,
              mimeType: downloaded.mimeType || mimeType,
              filename,
            };
          }
        }
      } else if (messageType === 'audio') {
        text = '';
        const mediaId = message.audio?.id;
        const mimeType = message.audio?.mime_type || 'audio/ogg';
        if (mediaId) {
          const downloaded = await this.whatsappAdapter.downloadMedia(mediaId);
          if (downloaded) {
            mediaAttachment = {
              buffer: downloaded.buffer,
              mimeType: downloaded.mimeType || mimeType,
              filename: 'voice_note.ogg',
            };
          }
        }
      } else {
        logger.debug('Unhandled message type received without interactive handler, skipping', {
          messageType,
        });
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      // If user sent a media file but download failed completely and there is no text
      if (
        !text &&
        !mediaAttachment &&
        (messageType === 'image' || messageType === 'document' || messageType === 'audio')
      ) {
        logger.warn('Failed to retrieve media binary from Meta Graph API', { messageType });
        await this.whatsappAdapter.sendTextMessage(
          senderId,
          'عذراً، تعذر تحميل التسجيل الصوتي/الملف المرفق من واتساب حالياً. يرجى إعادة إرساله مرة أخرى.'
        );
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      if (!text && !mediaAttachment) {
        logger.debug('Message received with neither text nor media, skipping');
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      logger.info(
        `Received WhatsApp message: type="${messageType}", textLength=${text.length}, hasMedia=${!!mediaAttachment}, isBsuid=${!isPhone}`
      );

      // 5. Run through unified Agent Orchestrator
      const agentResult = await this.orchestrator.run({
        userId: user.id,
        userPhone: phone || user.phoneNumber || (isPhone ? senderId : undefined),
        userName: user.name || profileName,
        channel: 'whatsapp',
        text,
        media: mediaAttachment,
        onInterimProgress: async (interimText: string) => {
          logger.info(`Dispatching interim acknowledgment to WhatsApp user: "${interimText}"`);
          await this.whatsappAdapter.sendTextMessage(senderId, interimText);
        },
      });

      // 6. Send reply back to WhatsApp user (Interactive Buttons if confirmation needed, else text)
      if (
        agentResult.status === 'waiting_for_confirmation' &&
        agentResult.confirmationRequest?.token
      ) {
        const token = agentResult.confirmationRequest.token;
        const isEnglish = agentResult.languageContext?.targetLanguage === 'en';
        const prompt = isEnglish
          ? `${agentResult.replyText}\n\nTap a button below to confirm or cancel:`
          : `${agentResult.replyText}\n\nاضغط على أحد الأزرار أدناه لتأكيد أو إلغاء التنفيذ:`;

        await this.whatsappAdapter.sendInteractiveButtons(senderId, prompt, [
          { id: `conf_approve_${token}`, title: isEnglish ? 'Confirm ✅' : 'تأكيد ✅' },
          { id: `conf_reject_${token}`, title: isEnglish ? 'Cancel ❌' : 'إلغاء ❌' },
        ]);
      } else {
        await this.whatsappAdapter.sendTextMessage(senderId, agentResult.replyText);
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (err: any) {
      logger.error('Error processing WhatsApp webhook payload', { error: err.message });
      try {
        if (fromNumber) {
          const emergencyFallback =
            'حدث خطأ مؤقت في الاتصال، يرجى إعادة إرسال رسالتك.';
          await this.whatsappAdapter.sendTextMessage(fromNumber, emergencyFallback);
        }
      } catch (dispatchErr: any) {
        logger.error('Failed to dispatch emergency error notice to WhatsApp user', { error: dispatchErr.message });
      }
      if (!res.headersSent) {
        res.status(200).send('EVENT_RECEIVED');
      }
    }
  };
}
