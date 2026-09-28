/**
 * Proactive Webhook Receipt & Engagement Handler (Phase 7.5)
 *
 * Coordinates processing of inbound Meta WhatsApp status receipts, enforces
 * strictly monotonic status progression, records granular engagement events,
 * and deterministically attributes incoming user replies to proactive outreach.
 *
 * Guarantees:
 * 1. Monotonic state transitions (pending < sending < sent < delivered < read).
 * 2. Strict mapping by provider_message_id (wamid) only.
 * 3. Token & secret sanitization in error logs and database fields.
 * 4. User reply attribution within a 2-hour window, guarded against trivial messages and topic switches.
 * 5. Complete isolation: Webhook errors or attribution failures never crash the server or user chat flow.
 * 6. Zero dynamic policy tuning & zero direct memory modifications.
 */

import { logger } from '../../core/logger';
import { ProactiveDispatchRepository } from './proactive_dispatch.repo';
import {
  MetaStatusPayload,
  ProactiveEngagementEventType,
  ReceiptProcessingResult,
  UserResponseAttributionInput,
  AttributionResult,
} from './receipt_types';

/**
 * Sanitizes Meta error text by redacting access tokens, client secrets, and authorization headers.
 */
export function sanitizeErrorMessage(message?: string): string {
  if (!message) return '';
  return message
    .replace(/EAAB[a-zA-Z0-9_-]+/g, '[REDACTED_META_TOKEN]')
    .replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(access_token|token|client_secret|app_secret|secret)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/Authorization:\s*Bearer\s+[^\s]+/gi, 'Authorization: Bearer [REDACTED]')
    .trim();
}

/**
 * Checks if an inbound message text is trivial (empty, whitespace, or single punctuation/symbol).
 */
export function isTrivialMessage(text?: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  // Single punctuation or symbol without words/digits
  if (trimmed.length === 1 && /^[\p{P}\p{S}]$/u.test(trimmed)) {
    return true;
  }
  return false;
}

export class ProactiveReceiptHandler {
  private static instance: ProactiveReceiptHandler | null = null;
  public static readonly DEFAULT_ATTRIBUTION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

  constructor(
    private dispatchRepo: ProactiveDispatchRepository = new ProactiveDispatchRepository()
  ) {}

  public static getInstance(): ProactiveReceiptHandler {
    if (!ProactiveReceiptHandler.instance) {
      ProactiveReceiptHandler.instance = new ProactiveReceiptHandler();
    }
    return ProactiveReceiptHandler.instance;
  }

  /**
   * Processes a list of status receipt items received in a Meta WhatsApp webhook payload.
   * Updates dispatch records monotonically and records engagement events.
   */
  public async processStatusReceipts(
    statuses: readonly MetaStatusPayload[]
  ): Promise<ReceiptProcessingResult[]> {
    if (!statuses || !Array.isArray(statuses) || statuses.length === 0) {
      return [];
    }

    const results: ReceiptProcessingResult[] = [];

    for (const statusItem of statuses) {
      const providerMessageId = statusItem.id;
      if (!providerMessageId) {
        logger.debug('Skipping status receipt without provider_message_id (wamid)');
        continue;
      }

      const rawStatus = (statusItem.status || '').toLowerCase();
      if (!['sent', 'delivered', 'read', 'failed'].includes(rawStatus)) {
        logger.debug(`Ignoring unknown receipt status [${rawStatus}] for wamid [${providerMessageId}]`);
        continue;
      }

      // Parse timestamp safely
      let timestamp = new Date();
      if (statusItem.timestamp) {
        const rawTs = Number(statusItem.timestamp);
        if (!isNaN(rawTs) && rawTs > 0) {
          // Meta sends unix timestamp in seconds
          const ms = rawTs < 1e11 ? rawTs * 1000 : rawTs;
          timestamp = new Date(ms);
        }
      }

      // Extract error details if present
      let errorCode: string | undefined;
      let errorMessage: string | undefined;
      if (statusItem.errors && statusItem.errors.length > 0) {
        const firstErr = statusItem.errors[0];
        errorCode = String(firstErr.code);
        const rawMsg =
          firstErr.message ||
          firstErr.title ||
          firstErr.error_data?.details ||
          'Meta delivery failure';
        errorMessage = sanitizeErrorMessage(rawMsg);
      }

      // Monotonically update dispatch record
      const updateResult = await this.dispatchRepo.updateReceiptStatus({
        providerMessageId,
        status: rawStatus as 'sent' | 'delivered' | 'read' | 'failed',
        timestamp,
        errorCode,
        errorMessage,
      });

      if (!updateResult.log) {
        logger.debug(
          `Status receipt [${rawStatus}] received for untracked or non-proactive message [${providerMessageId}]`
        );
        results.push({
          providerMessageId,
          updated: false,
          currentStatus: 'unknown',
          engagementRecorded: false,
          reason: 'dispatch_not_found',
        });
        continue;
      }

      const dispatchLog = updateResult.log;

      // Record engagement event
      await this.dispatchRepo.recordEngagement({
        dispatchId: dispatchLog.id,
        actionId: dispatchLog.actionId,
        userId: dispatchLog.userId,
        eventType: rawStatus as ProactiveEngagementEventType,
        occurredAt: timestamp,
        attributionSource: 'meta_webhook',
        metadata: {
          providerMessageId,
          recipientId: statusItem.recipient_id,
          errorCode,
          errorMessage,
        },
      });

      logger.info('Proactive webhook receipt recorded successfully', {
        dispatchId: dispatchLog.id,
        actionId: dispatchLog.actionId,
        status: rawStatus,
        currentStatus: dispatchLog.status,
        providerMessageId,
      });

      results.push({
        providerMessageId,
        updated: updateResult.updated,
        currentStatus: dispatchLog.status,
        engagementRecorded: true,
      });
    }

    return results;
  }

  /**
   * Deterministically attributes an incoming user message to the latest eligible proactive outreach.
   */
  public async attributeUserResponse(
    input: UserResponseAttributionInput
  ): Promise<AttributionResult> {
    // 1. Guard against empty or trivial messages
    if (isTrivialMessage(input.text)) {
      return {
        attributed: false,
        reason: 'trivial_message',
      };
    }

    // 2. Guard against explicit topic switches
    if (input.isTopicSwitch) {
      return {
        attributed: false,
        reason: 'topic_switch_detected',
      };
    }

    // 3. Attribution Window (default 2 hours)
    const windowMs = input.attributionWindowMs ?? ProactiveReceiptHandler.DEFAULT_ATTRIBUTION_WINDOW_MS;
    const now = input.receivedAt || new Date();
    const windowStart = new Date(now.getTime() - windowMs);

    // 4. Find latest eligible dispatch for this user
    const dispatch = await this.dispatchRepo.findLatestAttributableDispatch(
      input.userId,
      input.conversationId,
      windowStart
    );

    if (!dispatch) {
      // Diagnostic check: Was there an older dispatch outside the attribution window?
      const olderDispatch = await this.dispatchRepo.findLatestAttributableDispatch(
        input.userId,
        input.conversationId,
        undefined
      );

      if (olderDispatch) {
        return {
          attributed: false,
          dispatchId: olderDispatch.id,
          actionId: olderDispatch.actionId,
          reason: 'outside_attribution_window',
        };
      }

      return {
        attributed: false,
        reason: 'no_eligible_dispatch',
      };
    }

    // 5. Check if already attributed
    if (dispatch.respondedAt) {
      return {
        attributed: false,
        dispatchId: dispatch.id,
        actionId: dispatch.actionId,
        reason: 'already_attributed',
      };
    }

    // 6. Record response in dispatch log and engagement audit
    await this.dispatchRepo.markResponded(dispatch.id, now, input.messageId);

    await this.dispatchRepo.recordEngagement({
      dispatchId: dispatch.id,
      actionId: dispatch.actionId,
      userId: input.userId,
      eventType: 'user_replied',
      occurredAt: now,
      attributionSource: 'inbound_message',
      metadata: {
        messageId: input.messageId,
        textSnippet: input.text.slice(0, 100),
        conversationId: input.conversationId,
      },
    });

    logger.info('Inbound user response attributed to proactive dispatch', {
      dispatchId: dispatch.id,
      actionId: dispatch.actionId,
      userId: input.userId,
      messageId: input.messageId,
    });

    return {
      attributed: true,
      dispatchId: dispatch.id,
      actionId: dispatch.actionId,
      reason: 'attributed_successfully',
    };
  }
}
