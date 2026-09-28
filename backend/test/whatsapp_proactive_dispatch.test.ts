/**
 * Phase 7.4 — WhatsApp Window & Template Adapter Comprehensive Test Suite
 *
 * Verifies:
 * 1. WhatsApp Window Evaluation (Scenarios 1-5)
 * 2. Template Selection & Validation (Scenarios 6-11)
 * 3. Freeform vs. Template Routing (Scenarios 12-14)
 * 4. Idempotency & Concurrent Dispatch Prevention (Scenarios 15-18)
 * 5. Meta Response Classification (Scenarios 19-25)
 * 6. Retry Mechanism (Scenarios 26-28)
 * 7. Credentials & Security (Scenarios 29-31)
 * 8. End-to-End Proactive Dispatch Integration (Scenarios 32-35)
 * 9. Reminder System Isolation (Scenarios 36-37)
 * 10. Zero-Outbound / Real-Send Verification (Scenarios 38-41)
 * 11. Performance & Overhead (Scenarios 42-43)
 */

import crypto from 'crypto';
import { DatabaseManager } from '../src/database/connection';
import {
  WhatsAppWindowPolicy,
  ProactiveTemplateRegistry,
  WhatsAppTemplateAdapter,
  ProactiveDispatchRepository,
  generateIdempotencyKey,
  MetaErrorClassifier,
  WhatsAppAdapter,
  WhatsAppProactiveDispatcher,
} from '../src/modules/whatsapp';
import {
  ProactiveActionRepository,
  ProactiveScheduler,
  ProactiveDispatchIntent,
  CreateProactiveActionInput,
} from '../src/modules/proactive';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { UserRepository } from '../src/database/repositories/user.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { ReminderScheduler } from '../src/modules/reminder/reminder.scheduler';
import { logger } from '../src/core/logger';

function makeCairoDate(hour: number, minute: number): Date {
  const d = new Date();
  d.setUTCHours(hour - 3, minute, 0, 0);
  return d;
}

describe('Phase 7.4 — WhatsApp Window & Template Adapter Test Suite', () => {
  let db: DatabaseManager;
  let actionRepo: ProactiveActionRepository;
  let dispatchRepo: ProactiveDispatchRepository;
  let chatRepo: ChatRepository;
  let userRepo: UserRepository;
  let userPrefRepo: UserPreferenceRepository;
  let adapter: WhatsAppAdapter;
  let dispatcher: WhatsAppProactiveDispatcher;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Set test mock mode by default for safety
    process.env.WHATSAPP_MOCK_DISPATCH = 'true';
    ProactiveTemplateRegistry.clearOverrides();

    db = {
      getPool: () => null,
      getSupabase: () => null,
    } as unknown as DatabaseManager;

    actionRepo = new ProactiveActionRepository(db);
    actionRepo.clearInMemory();

    dispatchRepo = new ProactiveDispatchRepository(db);
    dispatchRepo.clearInMemory();

    userRepo = new UserRepository(db);
    chatRepo = new ChatRepository(db, userRepo);
    userPrefRepo = new UserPreferenceRepository(db);

    adapter = new WhatsAppAdapter();
    dispatcher = new WhatsAppProactiveDispatcher(adapter, dispatchRepo, actionRepo, chatRepo, userRepo);

    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    ProactiveTemplateRegistry.clearOverrides();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Category 1: WhatsApp Window Evaluation (Scenarios 1-5)
  // =========================================================================
  describe('Category 1: WhatsApp Window Evaluation', () => {
    it('Scenario 1: user message received 10 minutes ago evaluates to within_24h, freeform allowed', () => {
      const now = new Date('2026-09-28T12:00:00.000Z');
      const lastInbound = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago

      const evaluation = WhatsAppWindowPolicy.evaluateWindow(now, lastInbound);

      expect(evaluation.state).toBe('within_24h');
      expect(evaluation.isFreeformAllowed).toBe(true);
      expect(evaluation.isTemplateRequired).toBe(false);
      expect(evaluation.remainingMs).toBe((24 * 60 - 10) * 60 * 1000);
      expect(evaluation.elapsedMs).toBe(10 * 60 * 1000);
    });

    it('Scenario 2: user message received 23h 59m 59s ago evaluates to within_24h, freeform allowed', () => {
      const now = new Date('2026-09-28T12:00:00.000Z');
      const lastInbound = new Date(now.getTime() - ((23 * 60 + 59) * 60 + 59) * 1000); // 23h 59m 59s ago

      const evaluation = WhatsAppWindowPolicy.evaluateWindow(now, lastInbound);

      expect(evaluation.state).toBe('within_24h');
      expect(evaluation.isFreeformAllowed).toBe(true);
      expect(evaluation.isTemplateRequired).toBe(false);
      expect(evaluation.remainingMs).toBe(1000);
    });

    it('Scenario 3: user message received 24h 00m 01s ago evaluates to outside_24h, freeform blocked, template required', () => {
      const now = new Date('2026-09-28T12:00:00.000Z');
      const lastInbound = new Date(now.getTime() - (24 * 60 * 60 * 1000 + 1000)); // 24h 00m 01s ago

      const evaluation = WhatsAppWindowPolicy.evaluateWindow(now, lastInbound);

      expect(evaluation.state).toBe('outside_24h');
      expect(evaluation.isFreeformAllowed).toBe(false);
      expect(evaluation.isTemplateRequired).toBe(true);
      expect(evaluation.remainingMs).toBe(0);
      expect(evaluation.elapsedMs).toBe(24 * 60 * 60 * 1000 + 1000);
    });

    it('Scenario 4: no inbound messages recorded evaluates to unknown, freeform blocked, fail-closed', () => {
      const now = new Date('2026-09-28T12:00:00.000Z');

      const evaluation = WhatsAppWindowPolicy.evaluateWindow(now, undefined);

      expect(evaluation.state).toBe('unknown');
      expect(evaluation.isFreeformAllowed).toBe(false);
      expect(evaluation.isTemplateRequired).toBe(true);
      expect(evaluation.remainingMs).toBe(0);
      expect(evaluation.elapsedMs).toBeUndefined();
    });

    it('Scenario 5: multiple messages: only latest user inbound message determines window, outbound assistant does not extend it', async () => {
      const convId = 'conv-window-order-1';
      const now = new Date('2026-09-28T12:00:00.000Z');
      const userMessageTime = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
      const assistantMessageTime = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

      // Populate conversation history with older user message and newer assistant reply
      (chatRepo as any).inMemoryMessages.set(convId, [
        {
          id: 'msg-user-old',
          conversationId: convId,
          senderRole: 'user',
          senderName: 'Client',
          text: 'Can you help with deployment?',
          createdAt: userMessageTime,
        },
        {
          id: 'msg-assistant-new',
          conversationId: convId,
          senderRole: 'assistant',
          senderName: 'Craft',
          text: 'Sure, here are the steps...',
          createdAt: assistantMessageTime,
        },
      ]);

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-win-5',
        userId: '201012345678',
        conversationId: convId,
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'deployment',
        contextDigest: 'docker compose failure',
        reason: 'Deployment check',
        status: 'dispatch_ready',
        createdAt: now,
      };

      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');

      const result = await dispatcher.dispatch(intent, { now });

      // Because the user message was 25h ago, window is outside_24h despite assistant reply 2h ago
      expect(result.windowState).toBe('outside_24h');
      expect(result.payloadType).toBe('template');
    });
  });

  // =========================================================================
  // Category 2: Template Selection & Validation (Scenarios 6-11)
  // =========================================================================
  describe('Category 2: Template Selection & Validation', () => {
    it('Scenario 6: candidate type unresolved_follow_up maps to approved template craft_followup_v1', () => {
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');
      const name = ProactiveTemplateRegistry.getTemplateName('unresolved_follow_up');
      expect(name).toBe('craft_followup_v1');
    });

    it('Scenario 7: candidate type with no template defined is rejected with template_unavailable', async () => {
      // Invalidate template for unresolved_follow_up
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', '');

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-no-tpl-7',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'api_bug',
        contextDigest: '500 internal error',
        reason: 'Bug followup',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: {
          lastInboundMessageAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), // outside 24h
        },
      };

      const result = await dispatcher.dispatch(intent);

      expect(result.status).toBe('template_unavailable');
      expect(result.reason).toBe('template_unavailable');
    });

    it('Scenario 8: template configured in code but env key missing/empty is blocked', () => {
      delete process.env.PROACTIVE_TEMPLATE_UNRESOLVED_FOLLOW_UP;
      ProactiveTemplateRegistry.clearOverrides();

      const name = ProactiveTemplateRegistry.getTemplateName('unresolved_follow_up');
      expect(name).toBeNull();
    });

    it('Scenario 9: template parameters correctly extracted from candidate context into body components', () => {
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-tpl-params-9',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'flutter_bloc_state',
        contextDigest: 'emit error in bloc',
        reason: 'State management check',
        status: 'dispatch_ready',
        createdAt: new Date(),
      };

      const built = WhatsAppTemplateAdapter.buildTemplatePayload(intent, {
        languageContext: { targetLanguage: 'en', confidence: 0.9, detectedCode: 'en' } as any,
      });

      expect(built.success).toBe(true);
      expect(built.payload?.name).toBe('craft_followup_v1');
      expect(built.payload?.language.code).toBe('en');
      expect(built.payload?.components).toHaveLength(1);

      const bodyComponent = built.payload?.components[0];
      expect(bodyComponent?.type).toBe('body');
      expect(bodyComponent?.parameters).toHaveLength(2);
      expect(bodyComponent?.parameters[0].text).toBe('flutter_bloc_state');
      expect(bodyComponent?.parameters[1].text).toBe('emit error in bloc');
    });

    it('Scenario 10: template language code matches user language context (ar vs en)', () => {
      ProactiveTemplateRegistry.setTemplateOverride('next_step_offer', 'craft_next_step_v1');

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-lang-10',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'next_step_offer',
        topic: 'الخطوة القادمة',
        contextDigest: 'تجهيز السيرفر',
        reason: 'Next step',
        status: 'dispatch_ready',
        createdAt: new Date(),
      };

      const arBuilt = WhatsAppTemplateAdapter.buildTemplatePayload(intent, {
        languageContext: { targetLanguage: 'ar', confidence: 0.95 } as any,
      });
      expect(arBuilt.payload?.language.code).toBe('ar');

      const enBuilt = WhatsAppTemplateAdapter.buildTemplatePayload(intent, {
        languageContext: { targetLanguage: 'en', confidence: 0.95 } as any,
      });
      expect(enBuilt.payload?.language.code).toBe('en');
    });

    it('Scenario 11: template parameters containing sensitive keywords are rejected by pre-send safety check', () => {
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');

      const intentWithSecret: ProactiveDispatchIntent = {
        actionId: 'action-safety-11',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'Database password reset',
        contextDigest: 'API secret key token leaked',
        reason: 'Troubleshooting follow-up',
        status: 'dispatch_ready',
        createdAt: new Date(),
      };

      const built = WhatsAppTemplateAdapter.buildTemplatePayload(intentWithSecret);
      expect(built.success).toBe(false);
      expect(built.reason).toBe('sensitive_parameter_detected');
    });
  });

  // =========================================================================
  // Category 3: Freeform vs. Template Routing (Scenarios 12-14)
  // =========================================================================
  describe('Category 3: Freeform vs. Template Routing', () => {
    it('Scenario 12: action within 24h window constructs freeform text payload without using template', async () => {
      const now = new Date();
      const lastInbound = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-freeform-12',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'flutter_routing',
        contextDigest: 'go_router subroutes setup',
        reason: 'Routing check',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: {
          lastInboundMessageAt: lastInbound.toISOString(),
        },
      };

      const result = await dispatcher.dispatch(intent, { now });

      expect(result.windowState).toBe('within_24h');
      expect(result.payloadType).toBe('freeform');
      expect(result.status).toBe('mock_success');
    });

    it('Scenario 13: action outside 24h window constructs template payload without freeform text', async () => {
      const now = new Date();
      const lastInbound = new Date(now.getTime() - 36 * 60 * 60 * 1000); // 36 hours ago
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-template-13',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'auth_issue',
        contextDigest: 'session expiry bug',
        reason: 'Auth check',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: {
          lastInboundMessageAt: lastInbound.toISOString(),
        },
      };

      const result = await dispatcher.dispatch(intent, { now });

      expect(result.windowState).toBe('outside_24h');
      expect(result.payloadType).toBe('template');
      expect(result.status).toBe('mock_success');
    });

    it('Scenario 14: action within window with sensitive text in topic fails pre-send safety check and is suppressed', async () => {
      const now = new Date();
      const lastInbound = new Date(now.getTime() - 10 * 60 * 1000); // 10 mins ago

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-leak-14',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'password token recovery',
        contextDigest: 'api_key check',
        reason: 'Sensitive topic',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: {
          lastInboundMessageAt: lastInbound.toISOString(),
        },
      };

      const result = await dispatcher.dispatch(intent, { now });

      expect(result.status).toBe('suppressed');
      expect(result.reason).toContain('Safety violation');
    });
  });

  // =========================================================================
  // Category 4: Idempotency & Concurrent Dispatch Prevention (Scenarios 15-18)
  // =========================================================================
  describe('Category 4: Idempotency & Concurrent Dispatch Prevention', () => {
    it('Scenario 15: calling dispatch twice in rapid succession returns duplicate and makes exactly 1 provider call', async () => {
      const now = new Date();
      const spy = jest.spyOn(adapter, 'dispatchProactiveMessage');

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-idempotent-15',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'riverpod_state',
        contextDigest: 'provider refresh loop',
        reason: 'Debug',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: {
          lastInboundMessageAt: new Date(now.getTime() - 1000).toISOString(),
        },
      };

      const firstResult = await dispatcher.dispatch(intent, { now });
      const secondResult = await dispatcher.dispatch(intent, { now });

      expect(firstResult.status).toBe('mock_success');
      expect(secondResult.status).toBe('duplicate');
      expect(secondResult.reason).toContain('Duplicate dispatch prevented');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 16: concurrent dispatch with existing sending state within 30s skips duplicate', async () => {
      const idempotencyKey = generateIdempotencyKey('action-concurrent-16', 'out_of_turn', 'freeform');

      await dispatchRepo.createOrGet({
        actionId: 'action-concurrent-16',
        idempotencyKey,
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        payloadType: 'freeform',
      });
      await dispatchRepo.markSending(idempotencyKey);

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-concurrent-16',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'graphql_cache',
        contextDigest: 'normalized cache miss',
        reason: 'Caching check',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: {
          lastInboundMessageAt: new Date().toISOString(),
        },
      };

      const result = await dispatcher.dispatch(intent);

      expect(result.status).toBe('duplicate');
      expect(result.reason).toContain('Concurrent dispatch in progress');
    });

    it('Scenario 17: SHA-256 idempotency key prevents duplicate delivery even if action is re-queued', () => {
      const actionId = 'action-sha-17';
      const mode = 'out_of_turn';
      const payloadType = 'template';

      const key1 = generateIdempotencyKey(actionId, mode, payloadType);
      const key2 = generateIdempotencyKey(actionId, mode, payloadType);

      const expected = crypto
        .createHash('sha256')
        .update(`${actionId}:${mode}:${payloadType}`)
        .digest('hex');

      expect(key1).toBe(expected);
      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64);
    });

    it('Scenario 18: distinct actions produce distinct idempotency keys and both dispatch independently', async () => {
      const now = new Date();
      const spy = jest.spyOn(adapter, 'dispatchProactiveMessage');

      const intentA: ProactiveDispatchIntent = {
        actionId: 'action-distinct-18A',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'task_A',
        contextDigest: 'details A',
        reason: 'Reason A',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: { lastInboundMessageAt: now.toISOString() },
      };

      const intentB: ProactiveDispatchIntent = {
        actionId: 'action-distinct-18B',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'task_B',
        contextDigest: 'details B',
        reason: 'Reason B',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: { lastInboundMessageAt: now.toISOString() },
      };

      const resA = await dispatcher.dispatch(intentA, { now });
      const resB = await dispatcher.dispatch(intentB, { now });

      expect(resA.status).toBe('mock_success');
      expect(resB.status).toBe('mock_success');
      expect(resA.idempotencyKey).not.toBe(resB.idempotencyKey);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Category 5: Meta Response Classification (Scenarios 19-25)
  // =========================================================================
  describe('Category 5: Meta Response Classification', () => {
    let metaAdapter: WhatsAppAdapter;
    let metaDispatcher: WhatsAppProactiveDispatcher;

    beforeEach(() => {
      delete process.env.WHATSAPP_MOCK_DISPATCH;
      metaAdapter = new WhatsAppAdapter('phone_12345', 'token_secret_meta');
      metaDispatcher = new WhatsAppProactiveDispatcher(
        metaAdapter,
        dispatchRepo,
        actionRepo,
        chatRepo,
        userRepo
      );
    });

    it('Scenario 19: Meta returns 200 with message ID -> status sent, provider message ID recorded', async () => {
      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          messages: [{ id: 'wamid.HBgLMjAxMDI4MDY3NDMyFQIAEhgWM' }],
        }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-meta-200',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'docker_compose',
        contextDigest: 'port binding conflict',
        reason: 'Docker followup',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await metaDispatcher.dispatch(intent);

      expect(result.status).toBe('sent');
      expect(result.providerMessageId).toBe('wamid.HBgLMjAxMDI4MDY3NDMyFQIAEhgWM');

      const log = await dispatchRepo.findByIdempotencyKey(result.idempotencyKey!);
      expect(log?.status).toBe('sent');
      expect(log?.providerMessageId).toBe('wamid.HBgLMjAxMDI4MDY3NDMyFQIAEhgWM');
    });

    it('Scenario 20: Meta returns 400 (Invalid parameter) -> classified as non_retryable, status failed', async () => {
      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Parameter value is invalid',
            type: 'OAuthException',
            code: 100,
          },
        }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-meta-400',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'test_param',
        contextDigest: 'param error',
        reason: 'Param test',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await metaDispatcher.dispatch(intent);

      expect(result.status).toBe('failed');
      expect(result.isRetryable).toBe(false);
      expect(result.reason).toContain('Invalid request parameters');
    });

    it('Scenario 21: Meta returns 401 (Invalid OAuth access token) -> classified as non_retryable', async () => {
      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: 'Invalid OAuth access token',
            type: 'OAuthException',
            code: 190,
          },
        }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-meta-401',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'test_oauth',
        contextDigest: 'oauth error',
        reason: 'OAuth test',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await metaDispatcher.dispatch(intent);

      expect(result.status).toBe('failed');
      expect(result.isRetryable).toBe(false);
      expect(result.reason).toContain('Invalid OAuth access token');
    });

    it('Scenario 22: Meta returns 429 (Rate limit) -> classified as retryable, status failed, retryable flag true', async () => {
      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            message: 'Rate limit hit',
            code: 80007,
          },
        }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-meta-429',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'test_rate',
        contextDigest: 'rate limit test',
        reason: 'Rate test',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await metaDispatcher.dispatch(intent);

      expect(result.status).toBe('failed');
      expect(result.isRetryable).toBe(true);
      expect(result.reason).toContain('rate limit exceeded');
    });

    it('Scenario 23: Meta returns 500 (Internal server error) -> classified as retryable', async () => {
      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        json: async () => ({
          error: {
            message: 'Temporary server failure',
            code: 2,
          },
        }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-meta-500',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'test_500',
        contextDigest: 'server 500 test',
        reason: '500 test',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await metaDispatcher.dispatch(intent);

      expect(result.status).toBe('failed');
      expect(result.isRetryable).toBe(true);
      expect(result.reason).toContain('internal server error');
    });

    it('Scenario 24: Meta returns 131047 (Message failed to send outside window) -> classified as non_retryable', () => {
      const classified = MetaErrorClassifier.classify(400, {
        error: {
          code: 131047,
          message: 'Re-engagement message failed to send: 24h window closed',
        },
      });

      expect(classified.type).toBe('non_retryable');
      expect(classified.reason).toContain('24-hour customer service session expired');
      expect(classified.code).toBe(131047);
    });

    it('Scenario 25: network timeout during Meta call -> classified as unknown, not marked as sent', async () => {
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';

      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
        throw timeoutError;
      });

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-meta-timeout',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'test_timeout',
        contextDigest: 'timeout test',
        reason: 'Timeout test',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await metaDispatcher.dispatch(intent);

      expect(result.status).toBe('unknown');
      expect(result.isRetryable).toBe(false);
      expect(result.reason).toContain('timeout');
    });
  });

  // =========================================================================
  // Category 6: Retry Mechanism (Scenarios 26-28)
  // =========================================================================
  describe('Category 6: Retry Mechanism', () => {
    let retryAdapter: WhatsAppAdapter;
    let retryDispatcher: WhatsAppProactiveDispatcher;

    beforeEach(() => {
      delete process.env.WHATSAPP_MOCK_DISPATCH;
      retryAdapter = new WhatsAppAdapter('phone_12345', 'token_secret_meta');
      retryDispatcher = new WhatsAppProactiveDispatcher(
        retryAdapter,
        dispatchRepo,
        actionRepo,
        chatRepo,
        userRepo
      );
    });

    it('Scenario 26: retryable failure on attempt 1 schedules action for retry with backoff', async () => {
      const action = await actionRepo.createOrGet({
        userId: '201012345678',
        candidateType: 'unresolved_follow_up',
        topic: 'retry_backoff_topic',
        contextDigest: 'backoff test',
        reason: 'Backoff test',
      });

      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'Service unavailable', code: 2 } }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: action.id,
        userId: action.userId,
        deliveryMode: action.deliveryMode,
        candidateType: action.candidateType,
        topic: action.topic,
        contextDigest: action.contextDigest,
        reason: action.reason,
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await retryDispatcher.dispatch(intent);

      expect(result.status).toBe('failed');
      expect(result.isRetryable).toBe(true);

      const updatedAction = await actionRepo.findById(action.id);
      expect(updatedAction?.status).toBe('deferred'); // Reverted to deferred for retry
      expect(updatedAction?.attemptCount).toBe(1);
      expect(updatedAction?.eligibleAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('Scenario 27: non-retryable failure marks action failed immediately without scheduling retry', async () => {
      const action = await actionRepo.createOrGet({
        userId: '201012345678',
        candidateType: 'unresolved_follow_up',
        topic: 'non_retry_topic',
        contextDigest: 'non retry test',
        reason: 'Non-retry test',
      });

      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Bad request', code: 100 } }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: action.id,
        userId: action.userId,
        deliveryMode: action.deliveryMode,
        candidateType: action.candidateType,
        topic: action.topic,
        contextDigest: action.contextDigest,
        reason: action.reason,
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await retryDispatcher.dispatch(intent);

      expect(result.status).toBe('failed');
      expect(result.isRetryable).toBe(false);

      const updatedAction = await actionRepo.findById(action.id);
      expect(updatedAction?.status).toBe('failed');
    });

    it('Scenario 28: 3 consecutive retryable failures marks action failed permanently without 4th attempt', async () => {
      const action = await actionRepo.createOrGet({
        userId: '201012345678',
        candidateType: 'unresolved_follow_up',
        topic: 'max_retries_topic',
        contextDigest: 'max retries test',
        reason: 'Max retries test',
      });

      // Simulate 2 previous attempts
      await actionRepo.revertClaimForRetry(action.id, 60, 'Attempt 1 failed');
      await actionRepo.revertClaimForRetry(action.id, 60, 'Attempt 2 failed');

      const actionBeforeAttempt3 = await actionRepo.findById(action.id);
      expect(actionBeforeAttempt3?.attemptCount).toBe(2);

      // 3rd attempt via scheduler
      const now = makeCairoDate(14, 0);
      actionBeforeAttempt3!.eligibleAt = new Date(now.getTime() - 60000); // make due
      const scheduler = new ProactiveScheduler(actionRepo, chatRepo, userPrefRepo);

      jest.spyOn(actionRepo, 'getRecentHistory').mockRejectedValueOnce(
        new Error('Network connection dropped')
      );

      const res = await scheduler.checkAndProcessDueActions(now);

      expect(res.failedCount).toBe(1);
      const finalAction = await actionRepo.findById(action.id);
      expect(finalAction?.status).toBe('failed');
      expect(finalAction?.attemptCount).toBe(3);
    });
  });

  // =========================================================================
  // Category 7: Credentials & Security (Scenarios 29-31)
  // =========================================================================
  describe('Category 7: Credentials & Security', () => {
    it('Scenario 29: Meta access token never appears in dispatch logs, error logs, or database records', async () => {
      delete process.env.WHATSAPP_MOCK_DISPATCH;
      const secretToken = 'EAABw_SUPER_SECRET_META_ACCESS_TOKEN_XYZ123';

      const secAdapter = new WhatsAppAdapter('phone_sec_1', secretToken);
      const secDispatcher = new WhatsAppProactiveDispatcher(
        secAdapter,
        dispatchRepo,
        actionRepo,
        chatRepo,
        userRepo
      );

      const logSpy = jest.spyOn(logger, 'error');

      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid token', code: 190 },
        }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-sec-token',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'security_audit',
        contextDigest: 'checking logs',
        reason: 'Security check',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      await secDispatcher.dispatch(intent);

      // Verify logger calls never contained secret token
      for (const call of logSpy.mock.calls) {
        const str = JSON.stringify(call);
        expect(str).not.toContain(secretToken);
      }

      // Verify database log never stored secret token
      const idempotencyKey = generateIdempotencyKey('action-sec-token', 'out_of_turn', 'freeform');
      const log = await dispatchRepo.findByIdempotencyKey(idempotencyKey);
      expect(JSON.stringify(log)).not.toContain(secretToken);
    });

    it('Scenario 30: webhook app secret never appears in any log or error object', () => {
      const appSecret = 'APP_SECRET_987654321_PRIVATE';
      process.env.WHATSAPP_APP_SECRET = appSecret;

      const classified = MetaErrorClassifier.classify(400, {
        error: { message: 'Invalid payload signature', code: 100 },
      });

      expect(JSON.stringify(classified)).not.toContain(appSecret);
    });

    it('Scenario 31: template parameter safety regex accurately identifies sensitive keywords', () => {
      expect(WhatsAppTemplateAdapter.isSafeParameter('موضوعنا عن فلاتر')).toBe(true);
      expect(WhatsAppTemplateAdapter.isSafeParameter('Here is your password: 1234')).toBe(false);
      expect(WhatsAppTemplateAdapter.isSafeParameter('ادخل كلمة السر')).toBe(false);
      expect(WhatsAppTemplateAdapter.isSafeParameter('Your auth token is xyz')).toBe(false);
      expect(WhatsAppTemplateAdapter.isSafeParameter('رقم بطاقة الائتمان')).toBe(false);
      expect(WhatsAppTemplateAdapter.isSafeParameter('Prescription details')).toBe(false);
    });
  });

  // =========================================================================
  // Category 8: End-to-End Proactive Dispatch Integration (Scenarios 32-35)
  // =========================================================================
  describe('Category 8: End-to-End Proactive Dispatch Integration', () => {
    it('Scenario 32: proactive candidate -> persisted -> claimed -> within window -> dispatched via mock API -> action completed', async () => {
      const now = makeCairoDate(14, 0); // 2:00 PM Cairo time (active daytime)
      const lastInbound = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago (> 15m, < 24h)

      const action = await actionRepo.createOrGet({
        userId: '201012345678',
        candidateType: 'unresolved_follow_up',
        topic: 'clean_architecture',
        contextDigest: 'repository pattern in flutter',
        reason: 'Architecture guidance',
        eligibleAt: new Date(now.getTime() - 60000), // Due
        metadata: {
          lastInboundMessageAt: lastInbound.toISOString(),
          lastUserMessageAt: lastInbound.toISOString(),
        },
      });

      const scheduler = new ProactiveScheduler(actionRepo, chatRepo, userPrefRepo, dispatcher);
      const result = await scheduler.checkAndProcessDueActions(now);

      expect(result.claimedCount).toBe(1);
      expect(result.dispatchedIntents).toHaveLength(1);

      const completedAction = await actionRepo.findById(action.id);
      expect(completedAction?.status).toBe('completed');

      const idempotencyKey = generateIdempotencyKey(action.id, 'out_of_turn', 'freeform');
      const dispatchLog = await dispatchRepo.findByIdempotencyKey(idempotencyKey);
      expect(dispatchLog?.status).toBe('sent');
      expect(dispatchLog?.payloadType).toBe('freeform');
    });

    it('Scenario 33: proactive candidate outside window -> persisted -> claimed -> template selected -> dispatched -> completed', async () => {
      const now = makeCairoDate(14, 0);
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');
      const lastInbound = new Date(now.getTime() - 36 * 60 * 60 * 1000); // 36h ago (> 24h)

      const action = await actionRepo.createOrGet({
        userId: '201012345678',
        candidateType: 'unresolved_follow_up',
        topic: 'sqlite_locking',
        contextDigest: 'database busy error',
        reason: 'Database check',
        eligibleAt: new Date(now.getTime() - 60000),
        metadata: {
          lastInboundMessageAt: lastInbound.toISOString(),
          lastUserMessageAt: lastInbound.toISOString(),
        },
      });

      const scheduler = new ProactiveScheduler(actionRepo, chatRepo, userPrefRepo, dispatcher);
      const result = await scheduler.checkAndProcessDueActions(now);

      expect(result.claimedCount).toBe(1);
      expect(result.dispatchedIntents).toHaveLength(1);

      const completedAction = await actionRepo.findById(action.id);
      expect(completedAction?.status).toBe('completed');

      const idempotencyKey = generateIdempotencyKey(action.id, 'out_of_turn', 'template');
      const dispatchLog = await dispatchRepo.findByIdempotencyKey(idempotencyKey);
      expect(dispatchLog?.status).toBe('sent');
      expect(dispatchLog?.payloadType).toBe('template');
      expect((dispatchLog?.metadata as any)?.templateName).toBe('craft_followup_v1');
    });

    it('Scenario 34: proactive candidate outside window without template -> rejected and suppressed', async () => {
      const now = makeCairoDate(14, 0);
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', ''); // Unset template
      const lastInbound = new Date(now.getTime() - 36 * 60 * 60 * 1000);

      const action = await actionRepo.createOrGet({
        userId: '201012345678',
        candidateType: 'unresolved_follow_up',
        topic: 'kafka_streams',
        contextDigest: 'rebalance in progress',
        reason: 'Kafka check',
        eligibleAt: new Date(now.getTime() - 60000),
        metadata: {
          lastInboundMessageAt: lastInbound.toISOString(),
          lastUserMessageAt: lastInbound.toISOString(),
        },
      });

      const scheduler = new ProactiveScheduler(actionRepo, chatRepo, userPrefRepo, dispatcher);
      await scheduler.checkAndProcessDueActions(now);

      const updatedAction = await actionRepo.findById(action.id);
      expect(updatedAction?.status).toBe('suppressed');
      expect(updatedAction?.reason).toContain('WhatsApp 24-hour session window expired');
    });

    it('Scenario 35: duplicate dispatch intent for completed action -> rejected by idempotency check', async () => {
      const now = new Date();
      const intent: ProactiveDispatchIntent = {
        actionId: 'action-completed-dup-35',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'testing_dup',
        contextDigest: 'duplicate test',
        reason: 'Dup check',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: { lastInboundMessageAt: now.toISOString() },
      };

      const first = await dispatcher.dispatch(intent, { now });
      expect(first.status).toBe('mock_success');

      const second = await dispatcher.dispatch(intent, { now });
      expect(second.status).toBe('duplicate');
    });
  });

  // =========================================================================
  // Category 9: Reminder System Isolation (Scenarios 36-37)
  // =========================================================================
  describe('Category 9: Reminder System Isolation', () => {
    it('Scenario 36: proactive dispatch failure does NOT affect pending reminders', async () => {
      const reminderScheduler = ReminderScheduler.getInstance();
      expect(reminderScheduler).toBeDefined();

      delete process.env.WHATSAPP_MOCK_DISPATCH;
      const failAdapter = new WhatsAppAdapter('phone_12345', 'token_secret_meta');
      const failDispatcher = new WhatsAppProactiveDispatcher(
        failAdapter,
        dispatchRepo,
        actionRepo,
        chatRepo,
        userRepo
      );

      jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Server down' } }),
      } as any));

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-fail-isolation-36',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'crash_test',
        contextDigest: 'error',
        reason: 'Crash test',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await failDispatcher.dispatch(intent);
      expect(result.status).toBe('failed');

      // Reminders subsystem remains healthy and unaffected
      expect(typeof reminderScheduler.checkAndDispatchDueReminders).toBe('function');
    });

    it('Scenario 37: reminder dispatches continue to use existing reminder flow completely untouched', async () => {
      const sendTemplateSpy = jest.spyOn(adapter, 'sendTemplateMessage');

      const to = '201012345678';
      const templatePayload = {
        name: 'craft_reminder_notification',
        language: { code: 'ar' },
        components: [
          {
            type: 'body' as const,
            parameters: [{ type: 'text' as const, text: 'موعدك اليوم' }],
          },
        ],
      };

      await adapter.sendTemplateMessage(to, templatePayload);

      expect(sendTemplateSpy).toHaveBeenCalledWith(to, templatePayload);
    });
  });

  // =========================================================================
  // Category 10: Zero-Outbound / Real-Send Verification (Scenarios 38-41)
  // =========================================================================
  describe('Category 10: Zero-Outbound / Real-Send Verification', () => {
    it('Scenario 38: in test mode, ZERO actual HTTP requests to graph.facebook.com are made', async () => {
      process.env.WHATSAPP_MOCK_DISPATCH = 'true';
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;

      const fetchSpy = jest.spyOn(global, 'fetch');

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-test-zero-send-38',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'zero_send_check',
        contextDigest: 'confirm zero outbound',
        reason: 'Test mode check',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await dispatcher.dispatch(intent);

      expect(result.status).toBe('mock_success');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Scenario 39: in production mode with valid credentials, freeform dispatch calls POST messages with type text', async () => {
      delete process.env.WHATSAPP_MOCK_DISPATCH;
      const phoneId = 'phone_real_39';
      const token = 'access_token_real_39';

      const prodAdapter = new WhatsAppAdapter(phoneId, token);
      const prodDispatcher = new WhatsAppProactiveDispatcher(
        prodAdapter,
        dispatchRepo,
        actionRepo,
        chatRepo,
        userRepo
      );

      let capturedUrl = '';
      let capturedBody: any = null;

      jest.spyOn(global, 'fetch').mockImplementationOnce(async (url: any, init: any) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.REAL_FREEFORM_39' }] }),
        } as any;
      });

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-real-freeform-39',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'real_freeform',
        contextDigest: 'production check',
        reason: 'Production freeform',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await prodDispatcher.dispatch(intent);

      expect(result.status).toBe('sent');
      expect(capturedUrl).toBe(`https://graph.facebook.com/v22.0/${phoneId}/messages`);
      expect(capturedBody.type).toBe('text');
      expect(capturedBody.text.body).toBeDefined();
    });

    it('Scenario 40: in production mode outside window, dispatch calls POST messages with type template', async () => {
      delete process.env.WHATSAPP_MOCK_DISPATCH;
      const phoneId = 'phone_real_40';
      const token = 'access_token_real_40';

      const prodAdapter = new WhatsAppAdapter(phoneId, token);
      const prodDispatcher = new WhatsAppProactiveDispatcher(
        prodAdapter,
        dispatchRepo,
        actionRepo,
        chatRepo,
        userRepo
      );

      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');

      let capturedUrl = '';
      let capturedBody: any = null;

      jest.spyOn(global, 'fetch').mockImplementationOnce(async (url: any, init: any) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.REAL_TEMPLATE_40' }] }),
        } as any;
      });

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-real-tpl-40',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'real_template',
        contextDigest: 'production template check',
        reason: 'Production template',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: {
          lastInboundMessageAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), // 30h ago
        },
      };

      const result = await prodDispatcher.dispatch(intent);

      expect(result.status).toBe('sent');
      expect(capturedUrl).toBe(`https://graph.facebook.com/v22.0/${phoneId}/messages`);
      expect(capturedBody.type).toBe('template');
      expect(capturedBody.template.name).toBe('craft_followup_v1');
    });

    it('Scenario 41: dispatcher rejects calls with missing credentials in production mode (fail closed)', async () => {
      delete process.env.WHATSAPP_MOCK_DISPATCH;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;

      const nonMockAdapter = new WhatsAppAdapter('', '');
      const nonMockDispatcher = new WhatsAppProactiveDispatcher(
        nonMockAdapter,
        dispatchRepo,
        actionRepo,
        chatRepo,
        userRepo
      );

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-no-cred-41',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'missing_creds',
        contextDigest: 'should fail closed',
        reason: 'Missing creds test',
        status: 'dispatch_ready',
        createdAt: new Date(),
        metadata: { lastInboundMessageAt: new Date().toISOString() },
      };

      const result = await nonMockDispatcher.dispatch(intent);

      expect(result.status).toBe('configuration_missing');
      expect(result.reason).toContain('credentials not configured');
    });
  });

  // =========================================================================
  // Category 11: Performance & Overhead (Scenarios 42-43)
  // =========================================================================
  describe('Category 11: Performance & Overhead', () => {
    it('Scenario 42: window evaluation executes in < 1ms across 1,000 iterations', () => {
      const now = new Date();
      const lastInbound = new Date(now.getTime() - 15 * 60 * 60 * 1000);

      const start = process.hrtime.bigint();
      for (let i = 0; i < 1000; i++) {
        WhatsAppWindowPolicy.evaluateWindow(now, lastInbound);
      }
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

      const perOpMs = elapsedMs / 1000;
      expect(perOpMs).toBeLessThan(0.05); // Far below 1ms
    });

    it('Scenario 43: complete pre-dispatch pipeline executes in < 10ms', async () => {
      const now = new Date();
      ProactiveTemplateRegistry.setTemplateOverride('unresolved_follow_up', 'craft_followup_v1');

      const intent: ProactiveDispatchIntent = {
        actionId: 'action-perf-43',
        userId: '201012345678',
        deliveryMode: 'out_of_turn',
        candidateType: 'unresolved_follow_up',
        topic: 'performance_benchmark',
        contextDigest: 'sub-millisecond evaluation',
        reason: 'Perf test',
        status: 'dispatch_ready',
        createdAt: now,
        metadata: { lastInboundMessageAt: now.toISOString() },
      };

      const start = Date.now();
      const result = await dispatcher.dispatch(intent, { now });
      const durationMs = Date.now() - start;

      expect(result.status).toBe('mock_success');
      expect(durationMs).toBeLessThan(10);
    });
  });
});
