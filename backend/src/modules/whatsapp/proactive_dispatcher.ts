/**
 * WhatsApp Proactive Dispatcher (Phase 7.4)
 *
 * Coordinates safe, idempotent outbound dispatch of ProactiveDispatchIntent records
 * through the Meta WhatsApp Cloud API.
 *
 * Core Guarantees:
 * 1. 24h Window Enforcement: Freeform text permitted only within 24h window; approved Meta Template strictly required outside.
 * 2. Idempotency: SHA-256 idempotency key prevents duplicate outreach across concurrent cron workers.
 * 3. Sanitization & Safety: Parameter and freeform payloads undergo pre-send credential/PII filtering.
 * 4. Error Classification & Bounded Retries: Differentiates retryable, non-retryable, and timeout (unknown) states.
 * 5. Security: Never logs access tokens, app secrets, or sensitive request authorization headers.
 */

import { WhatsAppAdapter, normalizeWhatsAppDestination } from './adapter';
import { WhatsAppWindowPolicy } from './window_policy';
import { ProactiveTemplateRegistry } from './template_registry';
import { WhatsAppTemplateAdapter } from './template_adapter';
import {
  ProactiveDispatchRepository,
  generateIdempotencyKey,
} from './proactive_dispatch.repo';
import { MetaErrorClassifier } from './meta_error_classifier';
import {
  ProactiveDispatchIntent,
  ProactiveActionRepository,
} from '../proactive';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { UserRepository } from '../../database/repositories/user.repo';
import { LanguageContext } from '../language/types';
import { logger } from '../../core/logger';
import {
  ProactiveDispatchResult,
  MetaTemplatePayload,
} from './types';

export class WhatsAppProactiveDispatcher {
  private static instance: WhatsAppProactiveDispatcher;
  public static readonly MAX_RETRIES = 3;

  constructor(
    private adapter: WhatsAppAdapter = new WhatsAppAdapter(),
    private dispatchRepo: ProactiveDispatchRepository = new ProactiveDispatchRepository(),
    private actionRepo: ProactiveActionRepository = new ProactiveActionRepository(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private userRepo: UserRepository = new UserRepository()
  ) {}

  public static getInstance(): WhatsAppProactiveDispatcher {
    if (!WhatsAppProactiveDispatcher.instance) {
      WhatsAppProactiveDispatcher.instance = new WhatsAppProactiveDispatcher();
    }
    return WhatsAppProactiveDispatcher.instance;
  }

  /**
   * Resolves the target recipient destination (phone number or BSUID) for a user.
   */
  private async resolveDestination(userId: string): Promise<string | null> {
    if (!userId) return null;

    // Direct phone number formats
    if (/^\+?\d{8,15}$/.test(userId.replace(/\s+/g, ''))) {
      return normalizeWhatsAppDestination(userId);
    }
    if (userId.startsWith('wa_')) {
      return normalizeWhatsAppDestination(userId.replace('wa_', ''));
    }

    // UUID look up in users repository
    try {
      const user = await this.userRepo.getUserById(userId);
      if (user?.phoneNumber) {
        return normalizeWhatsAppDestination(user.phoneNumber);
      }
    } catch {
      // Fallback
    }

    return null;
  }

  /**
   * Formats deterministic freeform message text for within-window dispatch.
   */
  private formatFreeformMessage(intent: ProactiveDispatchIntent): string {
    if (typeof intent.metadata?.formattedMessage === 'string' && intent.metadata.formattedMessage.trim().length > 0) {
      return intent.metadata.formattedMessage.trim();
    }

    const topic = intent.topic || 'الموضوع اللي كنا بنناقشه';
    switch (intent.candidateType) {
      case 'unresolved_follow_up':
        return `مرحبًا، بخصوص "${topic}" اللي اتكلمنا فيها، حابب أطمن عليك.. هل المشكلة اتحلت ولا تحب نكمل مع بعض؟`;
      case 'next_step_offer':
        return `مرحبًا، بخصوص الخطوة الجاية في "${topic}"، تحب نبدأ نشتغل عليها دلوقتي؟`;
      case 'follow_up_offer':
        return `مرحبًا، حابب أتابع معاك بخصوص "${topic}". لو محتاج أي مساعدة إضافية، أنا في الخدمة.`;
      default:
        return `مرحبًا، بخصوص استفسارك الأخير حول "${topic}"، هل تحب نتابع؟`;
    }
  }

  /**
   * Dispatches a single ProactiveDispatchIntent with complete defense-in-depth safety,
   * window policy enforcement, and idempotency guarantees.
   */
  public async dispatch(
    intent: ProactiveDispatchIntent,
    options?: {
      now?: Date;
      languageContext?: LanguageContext;
      explicitDestination?: string;
    }
  ): Promise<ProactiveDispatchResult> {
    return this.dispatchIntent(intent, options);
  }

  public async dispatchIntent(
    intent: ProactiveDispatchIntent,
    options?: {
      now?: Date;
      languageContext?: LanguageContext;
      explicitDestination?: string;
    }
  ): Promise<ProactiveDispatchResult> {
    const now = options?.now || new Date();

    // 1. Resolve Recipient Destination
    const destination = options?.explicitDestination || (await this.resolveDestination(intent.userId));
    if (!destination) {
      logger.warn('Proactive dispatch aborted: missing or unresolvable recipient destination', {
        actionId: intent.actionId,
        userId: intent.userId,
      });
      return {
        status: 'failed',
        actionId: intent.actionId,
        userId: intent.userId,
        candidateType: intent.candidateType,
        deliveryMode: intent.deliveryMode,
        reason: 'Missing or unresolvable destination phone number',
        isRetryable: false,
      };
    }

    // 2. Resolve Last Inbound Message Timestamp
    let lastInboundMessageAt: Date | undefined;
    if (intent.metadata?.lastInboundMessageAt) {
      lastInboundMessageAt = new Date(intent.metadata.lastInboundMessageAt as string);
    } else if (intent.conversationId) {
      try {
        const recentMessages = await this.chatRepo.getRecentMessages(intent.conversationId, 10);
        const userMessages = recentMessages.filter((m) => m.senderRole === 'user');
        if (userMessages.length > 0) {
          const lastMsg = userMessages[userMessages.length - 1];
          lastInboundMessageAt = lastMsg.createdAt ? new Date(lastMsg.createdAt) : undefined;
        }
      } catch (err: any) {
        logger.debug('Failed to query conversation for inbound timestamp', { error: err.message });
      }
    }

    // 3. Strict 24-Hour Window Evaluation
    const windowEval = WhatsAppWindowPolicy.evaluateWindow(now, lastInboundMessageAt);

    let payloadType: 'freeform' | 'template';
    let freeformText: string | undefined;
    let templatePayload: MetaTemplatePayload | undefined;

    if (windowEval.state === 'within_24h') {
      // Within 24-hour window: Freeform text permitted
      payloadType = 'freeform';
      freeformText = this.formatFreeformMessage(intent);

      // Pre-send freeform safety check
      if (!WhatsAppTemplateAdapter.isSafeParameter(freeformText)) {
        logger.warn('Proactive dispatch suppressed: sensitive content detected in freeform payload', {
          actionId: intent.actionId,
        });
        await this.actionRepo.markSuppressed(intent.actionId, 'Sensitive content detected in proactive payload');
        return {
          status: 'suppressed',
          actionId: intent.actionId,
          userId: intent.userId,
          candidateType: intent.candidateType,
          deliveryMode: intent.deliveryMode,
          payloadType: 'freeform',
          windowState: windowEval.state,
          reason: 'Safety violation in freeform payload',
        };
      }
    } else {
      // Outside 24h OR Unknown inbound timestamp: Freeform STRICTLY BLOCKED -> Approved Template Required
      payloadType = 'template';

      const templateResult = WhatsAppTemplateAdapter.buildTemplatePayload(intent, {
        languageContext: options?.languageContext,
      });

      if (!templateResult.success || !templateResult.payload) {
        const reason = templateResult.reason || 'template_unavailable';
        logger.info(`Proactive template selection blocked: [${reason}]`, {
          actionId: intent.actionId,
          candidateType: intent.candidateType,
          windowState: windowEval.state,
        });

        await this.actionRepo.markSuppressed(
          intent.actionId,
          reason === 'template_unavailable'
            ? 'WhatsApp 24h window expired and no approved template is configured'
            : 'Sensitive parameter detected in template parameters'
        );

        return {
          status: reason === 'template_unavailable' ? 'template_unavailable' : 'suppressed',
          actionId: intent.actionId,
          userId: intent.userId,
          candidateType: intent.candidateType,
          deliveryMode: intent.deliveryMode,
          payloadType: 'template',
          windowState: windowEval.state,
          reason,
        };
      }

      templatePayload = templateResult.payload;
    }

    // 4. Idempotency Gate
    const idempotencyKey = generateIdempotencyKey(intent.actionId, intent.deliveryMode, payloadType);

    const existingLog = await this.dispatchRepo.findByIdempotencyKey(idempotencyKey);
    if (existingLog) {
      if (existingLog.status === 'sent') {
        logger.info('Proactive outreach skipped: already sent under idempotency key', {
          idempotencyKey,
          actionId: intent.actionId,
        });
        return {
          status: 'duplicate',
          actionId: intent.actionId,
          userId: intent.userId,
          candidateType: intent.candidateType,
          deliveryMode: intent.deliveryMode,
          payloadType,
          windowState: windowEval.state,
          providerMessageId: existingLog.providerMessageId || undefined,
          idempotencyKey,
          reason: 'Duplicate dispatch prevented by idempotency lock',
        };
      }

      if (existingLog.status === 'sending') {
        const sendingElapsed = now.getTime() - existingLog.updatedAt.getTime();
        if (sendingElapsed < 30 * 1000) {
          logger.warn('Proactive outreach currently sending in concurrent worker, skipping duplicate', {
            idempotencyKey,
            actionId: intent.actionId,
          });
          return {
            status: 'duplicate',
            actionId: intent.actionId,
            userId: intent.userId,
            candidateType: intent.candidateType,
            deliveryMode: intent.deliveryMode,
            payloadType,
            windowState: windowEval.state,
            idempotencyKey,
            reason: 'Concurrent dispatch in progress',
          };
        }
      }
    }

    // Record or advance dispatch log to sending state
    await this.dispatchRepo.createOrGet({
      actionId: intent.actionId,
      idempotencyKey,
      userId: intent.userId,
      deliveryMode: intent.deliveryMode,
      payloadType,
      conversationId: intent.conversationId,
      metadata: {
        destination,
        windowState: windowEval.state,
        templateName: templatePayload?.name,
        conversationId: intent.conversationId,
        topic: intent.topic,
        candidateType: intent.candidateType,
      },
    });
    await this.dispatchRepo.markSending(idempotencyKey);

    // 5. Final Dispatch via WhatsAppAdapter
    logger.info('Dispatching outbound proactive WhatsApp message', {
      actionId: intent.actionId,
      userId: intent.userId,
      candidateType: intent.candidateType,
      payloadType,
      windowState: windowEval.state,
      destination,
    });

    const dispatchResponse = await this.adapter.dispatchProactiveMessage(destination, {
      type: payloadType,
      text: freeformText,
      template: templatePayload,
    });

    // 6. Handle Environment / Configuration Missing (Fail Closed)
    if (dispatchResponse.isConfigMissing) {
      logger.warn('Proactive dispatch failed closed: WhatsApp credentials not configured', {
        actionId: intent.actionId,
      });
      await this.dispatchRepo.markFailed(idempotencyKey, 'WhatsApp credentials missing (fail closed)');
      return {
        status: 'configuration_missing',
        actionId: intent.actionId,
        userId: intent.userId,
        candidateType: intent.candidateType,
        deliveryMode: intent.deliveryMode,
        payloadType,
        windowState: windowEval.state,
        idempotencyKey,
        reason: 'WhatsApp credentials not configured in environment',
      };
    }

    // 7. Handle Test Mock Success
    if (dispatchResponse.isMock) {
      const mockId = dispatchResponse.providerMessageId || `wamid.MOCK_${now.getTime()}`;
      await this.dispatchRepo.markSent(idempotencyKey, mockId);
      await this.actionRepo.markCompleted(intent.actionId);
      return {
        status: 'mock_success',
        actionId: intent.actionId,
        userId: intent.userId,
        candidateType: intent.candidateType,
        deliveryMode: intent.deliveryMode,
        payloadType,
        windowState: windowEval.state,
        providerMessageId: mockId,
        idempotencyKey,
      };
    }

    // 8. Handle Real Meta Graph API Success
    if (dispatchResponse.success && dispatchResponse.providerMessageId) {
      const providerId = dispatchResponse.providerMessageId;
      await this.dispatchRepo.markSent(idempotencyKey, providerId);
      await this.actionRepo.markCompleted(intent.actionId);

      logger.info('Outbound proactive WhatsApp message successfully dispatched and confirmed by Meta', {
        actionId: intent.actionId,
        providerMessageId: providerId,
        payloadType,
      });

      return {
        status: 'sent',
        actionId: intent.actionId,
        userId: intent.userId,
        candidateType: intent.candidateType,
        deliveryMode: intent.deliveryMode,
        payloadType,
        windowState: windowEval.state,
        providerMessageId: providerId,
        idempotencyKey,
      };
    }

    // 9. Classify and Handle Meta Error
    const errorClassification = MetaErrorClassifier.classify(
      dispatchResponse.status,
      dispatchResponse.error,
      dispatchResponse.error instanceof Error ? dispatchResponse.error : undefined
    );

    logger.error('Outbound proactive dispatch failed Meta execution', {
      actionId: intent.actionId,
      httpStatus: dispatchResponse.status,
      errorType: errorClassification.type,
      reason: errorClassification.reason,
    });

    if (errorClassification.type === 'unknown') {
      // Timeout or connection drop: State unknown, do NOT immediately retry
      await this.dispatchRepo.markUnknown(idempotencyKey, errorClassification.reason);
      return {
        status: 'unknown',
        actionId: intent.actionId,
        userId: intent.userId,
        candidateType: intent.candidateType,
        deliveryMode: intent.deliveryMode,
        payloadType,
        windowState: windowEval.state,
        idempotencyKey,
        reason: errorClassification.reason,
        isRetryable: false,
      };
    }

    if (errorClassification.type === 'retryable') {
      await this.dispatchRepo.markFailed(idempotencyKey, errorClassification.reason);
      // Revert action for retry if within retry threshold
      await this.actionRepo.revertClaimForRetry(intent.actionId, 120, errorClassification.reason);
      return {
        status: 'failed',
        actionId: intent.actionId,
        userId: intent.userId,
        candidateType: intent.candidateType,
        deliveryMode: intent.deliveryMode,
        payloadType,
        windowState: windowEval.state,
        idempotencyKey,
        reason: errorClassification.reason,
        isRetryable: true,
      };
    }

    // Non-retryable error (e.g. 4xx, invalid recipient, unapproved template): Mark failed permanently
    await this.dispatchRepo.markFailed(idempotencyKey, errorClassification.reason);
    await this.actionRepo.markFailed(intent.actionId, errorClassification.reason);

    return {
      status: 'failed',
      actionId: intent.actionId,
      userId: intent.userId,
      candidateType: intent.candidateType,
      deliveryMode: intent.deliveryMode,
      payloadType,
      windowState: windowEval.state,
      idempotencyKey,
      reason: errorClassification.reason,
      isRetryable: false,
    };
  }
}
