/**
 * Proactive Scheduler & Processor (Phase 7.3)
 *
 * Coordinates atomic claiming of due proactive actions, rigorous re-evaluation
 * of current user/conversation state, and generation of Dispatch Intents.
 *
 * Architectural Invariant:
 * Strictly produces ProactiveDispatchIntent objects.
 * Performs ZERO outbound WhatsApp messaging or Meta Graph API calls.
 */

import { ProactiveActionRepository } from './proactive_action.repo';
import { ProactiveEligibilityGate } from './eligibility_gate';
import { ConsentManager } from './consent';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { UserPreferenceRepository } from '../../database/repositories/user_preference.repo';
import { logger } from '../../core/logger';
import { RuntimePolicyResolver } from '../../config/runtime_policy';
import {
  ProactiveActionEntity,
  ProactiveDispatchIntent,
  ProactiveOpportunity,
  ProactiveSchedulerResult,
} from './types';
import { ConversationState } from '../conversation/types';

export interface IProactiveDispatcher {
  dispatchIntent(intent: ProactiveDispatchIntent, options?: any): Promise<any>;
}

export class ProactiveScheduler {
  private static instance: ProactiveScheduler;
  public static readonly MAX_RETRY_ATTEMPTS = 3;

  constructor(
    private repo: ProactiveActionRepository = new ProactiveActionRepository(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private userPrefRepo: UserPreferenceRepository = new UserPreferenceRepository(),
    private dispatcher?: IProactiveDispatcher
  ) {}

  public static getInstance(dispatcher?: IProactiveDispatcher): ProactiveScheduler {
    if (!ProactiveScheduler.instance) {
      ProactiveScheduler.instance = new ProactiveScheduler(
        new ProactiveActionRepository(),
        new ChatRepository(),
        new UserPreferenceRepository(),
        dispatcher
      );
    }
    return ProactiveScheduler.instance;
  }

  /**
   * Main scheduler execution loop:
   * 1. Atomically claims due actions via FOR UPDATE SKIP LOCKED
   * 2. Re-evaluates current user consent, activity, resolution, and quiet hours
   * 3. Produces ProactiveDispatchIntent for authorized actions (without sending WhatsApp messages)
   */
  public async checkAndProcessDueActions(now: Date = new Date()): Promise<ProactiveSchedulerResult> {
    if (!RuntimePolicyResolver.getPolicy().proactiveEnabled) {
      logger.info('[ProactiveScheduler] Proactive processing skipped: proactiveEnabled is disabled by runtime policy');
      return {
        claimedCount: 0,
        dispatchedIntents: [],
        suppressedCount: 0,
        deferredCount: 0,
        expiredCount: 0,
        failedCount: 0,
      };
    }

    const dueActions = await this.repo.claimDueActions(50, now);
    if (dueActions.length === 0) {
      return {
        claimedCount: 0,
        dispatchedIntents: [],
        suppressedCount: 0,
        deferredCount: 0,
        expiredCount: 0,
        failedCount: 0,
      };
    }

    logger.info(`Claimed [${dueActions.length}] due proactive actions for re-evaluation.`);

    const dispatchedIntents: ProactiveDispatchIntent[] = [];
    let suppressedCount = 0;
    let deferredCount = 0;
    let expiredCount = 0;
    let failedCount = 0;

    for (const item of dueActions) {
      try {
        // 1. Expiration Check
        if (now >= item.expiresAt) {
          await this.repo.markExpired(item.id);
          expiredCount++;
          logger.info(`Proactive action [${item.id}] marked expired.`);
          continue;
        }

        // 2. Persistent Consent / Opt-Out Re-evaluation
        let storedOptOut = false;
        try {
          const pref = await this.userPrefRepo.getPreference<boolean>(item.userId, 'proactive_opt_out');
          storedOptOut = pref === true;
        } catch {
          // Keep conservative
        }

        const consent = ConsentManager.resolveConsent({
          storedOptOut,
          storedAllowsFollowUp: !storedOptOut,
        });

        if (consent.hasExplicitOptOut) {
          await this.repo.markSuppressed(item.id, 'User opted out of proactive messages');
          suppressedCount++;
          logger.info(`Proactive action [${item.id}] suppressed due to explicit user opt-out.`);
          continue;
        }

        // 2b. Context Digest & Candidate Integrity Check
        if (!item.contextDigest || item.contextDigest.trim().length === 0) {
          await this.repo.markSuppressed(item.id, 'invalid_candidate: empty context digest');
          suppressedCount++;
          logger.info(`Proactive action [${item.id}] suppressed due to invalid candidate context.`);
          continue;
        }

        // 3. Conversation State & Resolution Re-evaluation
        let lastUserMessageAt: Date | undefined;
        let lastInboundMessageAt: Date | undefined;
        let isResolved = false;

        if (item.metadata?.lastUserMessageAt) {
          lastUserMessageAt = new Date(item.metadata.lastUserMessageAt as string);
          lastInboundMessageAt = lastUserMessageAt;
        }

        if (item.conversationId) {
          try {
            const recentMessages = await this.chatRepo.getRecentMessages(item.conversationId, 10);
            const userMessages = recentMessages.filter((m) => m.senderRole === 'user');
            if (userMessages.length > 0) {
              const lastMsg = userMessages[userMessages.length - 1];
              lastUserMessageAt = lastMsg.createdAt ? new Date(lastMsg.createdAt) : undefined;
              lastInboundMessageAt = lastUserMessageAt;

              // Check if user confirmed resolution in recent messages
              const userTexts = userMessages.map((m) => m.text.toLowerCase()).join(' ');
              const resolutionKeywords = ['اشتغل تمام', 'اتحلت المشكله', 'اتحلت', 'شكرا اتحلت', 'fixed now', 'issue resolved', 'that solved it'];
              isResolved = resolutionKeywords.some((kw) => userTexts.includes(kw));
            }
          } catch (err: any) {
            logger.debug('Failed to inspect conversation history for proactive action', { error: err.message });
          }
        }

        // If no user message was found and no forced unknown activity, infer timing from eligibleAt
        if (!lastUserMessageAt && item.metadata?.requireExplicitHistory !== true) {
          lastUserMessageAt = new Date(item.eligibleAt.getTime() - 30 * 60 * 1000);
          lastInboundMessageAt = lastUserMessageAt;
        }

        if (isResolved) {
          await this.repo.markSuppressed(item.id, 'Conversational issue was resolved prior to dispatch');
          suppressedCount++;
          logger.info(`Proactive action [${item.id}] suppressed because issue is already resolved.`);
          continue;
        }

        // 4. History Snapshot Re-evaluation
        const historySnapshot = await this.repo.getRecentHistory(item.userId, 24 * 60 * 60 * 1000, now);

        // 5. Construct Opportunity & Conversation State for Re-evaluation
        const opportunity: ProactiveOpportunity = {
          type: item.candidateType,
          topic: item.topic,
          context: item.contextDigest,
          confidence: (item.metadata?.confidence as number) || 0.85,
          urgency: (item.metadata?.urgency as any) || 'low',
          reason: item.reason,
        };

        const mockConvState: ConversationState = {
          activeTopic: item.topic,
          topicHistory: [],
          isTopicSwitch: false,
          previousTopic: null,
          isFollowUp: false,
          requiresContext: false,
          contextualizedQuery: item.contextDigest,
          goal: 'troubleshooting',
          resolutionState: isResolved ? 'resolved' : 'unresolved',
          unresolvedItems: [item.contextDigest],
          sessionEntities: [],
          confidence: 0.9,
        };

        // 6. Hard-Gate Eligibility Re-evaluation
        const decision = ProactiveEligibilityGate.evaluate({
          opportunity,
          conversationState: mockConvState,
          deliveryMode: item.deliveryMode,
          consent,
          now,
          lastUserMessageAt,
          lastInboundMessageAt,
          historySnapshot,
        });

        if (decision.status === 'suppressed') {
          await this.repo.markSuppressed(item.id, decision.reason);
          suppressedCount++;
          logger.info(`Proactive action [${item.id}] suppressed at cron time: [${decision.reason}]`);
          continue;
        }

        if (decision.status === 'deferred') {
          const retryAt = decision.retryAt || new Date(now.getTime() + 15 * 60 * 1000);
          await this.repo.markDeferred(item.id, retryAt, decision.reason);
          deferredCount++;
          logger.info(`Proactive action [${item.id}] deferred until [${retryAt.toISOString()}]: [${decision.reason}]`);
          continue;
        }

        // 7. Produce ProactiveDispatchIntent
        const dispatchIntent: ProactiveDispatchIntent = {
          actionId: item.id,
          userId: item.userId,
          conversationId: item.conversationId,
          deliveryMode: item.deliveryMode,
          candidateType: item.candidateType,
          topic: item.topic,
          contextDigest: item.contextDigest,
          reason: item.reason,
          status: 'dispatch_ready',
          createdAt: new Date(),
          metadata: item.metadata,
        };

        if (this.dispatcher) {
          try {
            const dispatchRes = await this.dispatcher.dispatchIntent(dispatchIntent, { now });
            logger.info(`Dispatched intent through proactive dispatcher: [${dispatchRes.status}]`);
          } catch (dispatchErr: any) {
            logger.error(`Error dispatching intent through proactive dispatcher`, { error: dispatchErr.message });
          }
        } else {
          await this.repo.markCompleted(item.id);
        }

        dispatchedIntents.push(dispatchIntent);
        logger.info(`Proactive action [${item.id}] authorized -> ProactiveDispatchIntent generated.`);
      } catch (err: any) {
        logger.error(`Error processing proactive action [${item.id}]`, { error: err.message });
        const currentAttempts = (item.attemptCount || 0) + 1;
        if (currentAttempts >= ProactiveScheduler.MAX_RETRY_ATTEMPTS) {
          await this.repo.markFailed(item.id, err.message || 'Maximum retry attempts exceeded');
          failedCount++;
        } else {
          await this.repo.revertClaimForRetry(item.id, 60, err.message);
          deferredCount++;
        }
      }
    }

    return {
      claimedCount: dueActions.length,
      dispatchedIntents,
      suppressedCount,
      deferredCount,
      expiredCount,
      failedCount,
    };
  }
}
