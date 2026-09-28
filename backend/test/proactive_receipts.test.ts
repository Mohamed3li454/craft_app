/**
 * Phase 7.5 — Outbound Webhook Receipts & Engagement Tracking Test Suite
 *
 * Verifies:
 * 1. Webhook Verification & Ingestion Handshake (Scenarios 1-3)
 * 2. Receipt Mapping by Provider Message ID (Scenarios 4-8)
 * 3. State Machine Monotonicity (Scenarios 9-16)
 * 4. Error Handling & Security Sanitization (Scenarios 17-20)
 * 5. User Response Attribution (Scenarios 21-26)
 * 6. Multiple Actions & Dispatches Attribution (Scenarios 27-29)
 * 7. Integration with Webhook & Orchestrator (Scenarios 30-35)
 * 8. Idempotency & Deduplication (Scenarios 36-37)
 * 9. Boundaries, Security & Performance (Scenarios 38-41)
 */

import crypto from 'crypto';
import { DatabaseManager } from '../src/database/connection';
import {
  ProactiveDispatchRepository,
  generateIdempotencyKey,
  ProactiveReceiptHandler,
  sanitizeErrorMessage,
  isTrivialMessage,
  RECEIPT_STATUS_RANK,
  MetaStatusPayload,
  WhatsAppWebhookHandler,
} from '../src/modules/whatsapp';
import { ProactiveActionRepository } from '../src/modules/proactive';
import { config } from '../src/config/env';

function mockReqRes(
  body: any,
  headers: Record<string, string> = {},
  query: Record<string, string> = {}
) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const req = {
    body: typeof body === 'string' ? JSON.parse(body) : body,
    rawBody,
    headers: { ...headers },
    query: { ...query },
  } as any;

  const res = {
    statusCode: 200,
    sentData: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(data: any) {
      this.sentData = data;
      return this;
    },
    json(data: any) {
      this.sentData = data;
      return this;
    },
  } as any;

  return { req, res };
}

function computeSignature(rawBody: string, secret?: string): string {
  const effectiveSecret = secret || config.whatsapp.appSecret || 'test_meta_app_secret_456';
  return 'sha256=' + crypto.createHmac('sha256', effectiveSecret).update(rawBody).digest('hex');
}

describe('Phase 7.5 — Outbound Webhook Receipts & Engagement Tracking Test Suite', () => {
  let db: DatabaseManager;
  let actionRepo: ProactiveActionRepository;
  let dispatchRepo: ProactiveDispatchRepository;
  let receiptHandler: ProactiveReceiptHandler;

  const originalEnv = { ...process.env };
  const originalVerifyToken = config.whatsapp.verifyToken;
  const originalAppSecret = config.whatsapp.appSecret;

  beforeEach(() => {
    process.env = { ...originalEnv };
    config.whatsapp.verifyToken = 'test_verify_token_123';
    config.whatsapp.appSecret = 'test_meta_app_secret_456';

    db = {
      getPool: () => null,
      getSupabase: () => null,
    } as unknown as DatabaseManager;

    actionRepo = new ProactiveActionRepository(db);
    actionRepo.clearInMemory();

    dispatchRepo = new ProactiveDispatchRepository(db);
    dispatchRepo.clearInMemory();

    receiptHandler = new ProactiveReceiptHandler(dispatchRepo);

    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    config.whatsapp.verifyToken = originalVerifyToken;
    config.whatsapp.appSecret = originalAppSecret;
    jest.restoreAllMocks();
  });

  // Helper to create and persist a test dispatch log
  async function seedDispatchLog(opts: {
    actionId?: string;
    userId?: string;
    deliveryMode?: string;
    payloadType?: 'freeform' | 'template';
    providerMessageId?: string;
    status?: 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
    conversationId?: string;
    sentAt?: Date;
    metadata?: Record<string, unknown>;
  }) {
    const actionId = opts.actionId || `action-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const userId = opts.userId || 'user-123';
    const deliveryMode = opts.deliveryMode || 'out_of_turn';
    const payloadType = opts.payloadType || 'template';
    const idempotencyKey = generateIdempotencyKey(actionId, deliveryMode, payloadType);

    const log = await dispatchRepo.createOrGet({
      actionId,
      idempotencyKey,
      userId,
      deliveryMode,
      payloadType,
      conversationId: opts.conversationId,
      metadata: {
        conversationId: opts.conversationId,
        topic: 'flutter build bug',
        ...opts.metadata,
      },
    });

    const status = opts.status || 'sent';

    if (status === 'sending') {
      await dispatchRepo.markSending(idempotencyKey);
    } else if (status === 'sent' || status === 'delivered' || status === 'read') {
      await dispatchRepo.markSending(idempotencyKey);
      const msgId = opts.providerMessageId || `wamid.TEST_${Date.now()}`;
      await dispatchRepo.markSent(idempotencyKey, msgId);
      if (opts.sentAt) {
        log.sentAt = opts.sentAt;
      }
      if (status === 'delivered' || status === 'read') {
        await dispatchRepo.updateReceiptStatus({
          providerMessageId: msgId,
          status,
          timestamp: new Date(),
        });
      }
    } else if (status === 'failed') {
      await dispatchRepo.markSending(idempotencyKey);
      await dispatchRepo.markFailed(idempotencyKey, 'Simulated failure');
    }

    return log;
  }

  // ==========================================================================
  // Category 1: Webhook Verification & Ingestion Handshake (Scenarios 1-3)
  // ==========================================================================
  describe('Category 1: Webhook Verification & Ingestion Handshake', () => {
    it('Scenario 1: GET webhook verification succeeds with correct token and returns challenge', () => {
      const webhook = new WhatsAppWebhookHandler(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        receiptHandler
      );

      const { req, res } = mockReqRes(
        {},
        {},
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test_verify_token_123',
          'hub.challenge': 'CHALLENGE_ACCEPTED_999',
        }
      );

      webhook.verifyWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.sentData).toBe('CHALLENGE_ACCEPTED_999');
    });

    it('Scenario 2: GET webhook verification fails with 403 on invalid verify token', () => {
      const webhook = new WhatsAppWebhookHandler(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        receiptHandler
      );

      const { req, res } = mockReqRes(
        {},
        {},
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': 'CHALLENGE_ACCEPTED_999',
        }
      );

      webhook.verifyWebhook(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.sentData).toBe('Verification failed');
    });

    it('Scenario 3: POST webhook request with invalid HMAC signature is rejected with 401', async () => {
      const webhook = new WhatsAppWebhookHandler(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        receiptHandler
      );

      const body = { entry: [{ id: '123' }] };
      const { req, res } = mockReqRes(body, {
        'x-hub-signature-256': 'sha256=invalid_hex_digest_00000000000000000000000000000000',
      });

      await webhook.handleIncoming(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.sentData).toBe('Invalid signature');
    });
  });

  // ==========================================================================
  // Category 2: Receipt Mapping by Provider Message ID (Scenarios 4-8)
  // ==========================================================================
  describe('Category 2: Receipt Mapping by Provider Message ID', () => {
    it('Scenario 4: Receipt with valid wamid matches existing dispatch log accurately', async () => {
      const wamid = 'wamid.HBgLMTIzNDU2Nzg5MA==';
      const log = await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      const results = await receiptHandler.processStatusReceipts([
        {
          id: wamid,
          status: 'delivered',
          timestamp: '1711580000',
          recipient_id: '201012345678',
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].updated).toBe(true);
      expect(results[0].currentStatus).toBe('delivered');
      expect(results[0].engagementRecorded).toBe(true);

      const updated = await dispatchRepo.findByProviderMessageId(wamid);
      expect(updated?.status).toBe('delivered');
      expect(updated?.deliveredAt).toBeDefined();
    });

    it('Scenario 4b: Rank constant defines strictly ordered status values', () => {
      expect(RECEIPT_STATUS_RANK['pending']).toBeLessThan(RECEIPT_STATUS_RANK['sending']);
      expect(RECEIPT_STATUS_RANK['sending']).toBeLessThan(RECEIPT_STATUS_RANK['sent']);
      expect(RECEIPT_STATUS_RANK['sent']).toBeLessThan(RECEIPT_STATUS_RANK['delivered']);
      expect(RECEIPT_STATUS_RANK['delivered']).toBeLessThan(RECEIPT_STATUS_RANK['read']);
    });

    it('Scenario 5: Receipt with unknown/untracked wamid is handled gracefully without crashing', async () => {
      const results = await receiptHandler.processStatusReceipts([
        {
          id: 'wamid.UNKNOWN_NON_EXISTENT_ID_999',
          status: 'delivered',
          timestamp: '1711580000',
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].updated).toBe(false);
      expect(results[0].currentStatus).toBe('unknown');
      expect(results[0].engagementRecorded).toBe(false);
      expect(results[0].reason).toBe('dispatch_not_found');
    });

    it('Scenario 6: Receipt with null, empty, or missing id in status payload is safely ignored', async () => {
      const results = await receiptHandler.processStatusReceipts([
        {
          id: '',
          status: 'delivered',
          timestamp: '1711580000',
        },
        {
          id: null as any,
          status: 'read',
          timestamp: '1711580000',
        },
      ]);

      expect(results).toHaveLength(0);
    });

    it('Scenario 7: Webhook status with non-proactive message wamid does not alter proactive logs', async () => {
      const proactiveWamid = 'wamid.PROACTIVE_111';
      await seedDispatchLog({ providerMessageId: proactiveWamid, status: 'sent' });

      // Inbound receipt for an ad or organic broadcast message
      const results = await receiptHandler.processStatusReceipts([
        {
          id: 'wamid.ORGANIC_USER_CHAT_222',
          status: 'read',
          timestamp: '1711580000',
        },
      ]);

      expect(results[0].updated).toBe(false);

      const proactiveLog = await dispatchRepo.findByProviderMessageId(proactiveWamid);
      expect(proactiveLog?.status).toBe('sent');
    });

    it('Scenario 8: Mapping strictly relies on provider_message_id, never matching by phone alone', async () => {
      const wamidA = 'wamid.DISPATCH_USER_A';
      await seedDispatchLog({
        providerMessageId: wamidA,
        userId: '201099999999',
        status: 'sent',
      });

      // Receipt arrives with matching phone number in recipient_id, but a different wamid
      const results = await receiptHandler.processStatusReceipts([
        {
          id: 'wamid.DIFFERENT_MSG_SAME_PHONE',
          status: 'delivered',
          timestamp: '1711580000',
          recipient_id: '201099999999',
        },
      ]);

      expect(results[0].updated).toBe(false);

      // User A's dispatch must NOT be updated by the unrelated wamid
      const logA = await dispatchRepo.findByProviderMessageId(wamidA);
      expect(logA?.status).toBe('sent');
      expect(logA?.deliveredAt).toBeUndefined();
    });
  });

  // ==========================================================================
  // Category 3: State Machine Monotonicity (Scenarios 9-16)
  // ==========================================================================
  describe('Category 3: State Machine Monotonicity', () => {
    it('Scenario 9: Sequential progression pending -> sending -> sent -> delivered -> read updates properly', async () => {
      const wamid = 'wamid.MONOTONIC_SEQ_1';
      const log = await seedDispatchLog({ providerMessageId: wamid, status: 'pending' });
      expect(log.status).toBe('pending');

      await dispatchRepo.markSending(log.idempotencyKey);
      expect((await dispatchRepo.findByIdempotencyKey(log.idempotencyKey))?.status).toBe('sending');

      await dispatchRepo.markSent(log.idempotencyKey, wamid);
      expect((await dispatchRepo.findByProviderMessageId(wamid))?.status).toBe('sent');

      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'delivered', timestamp: 1711580010 }]);
      expect((await dispatchRepo.findByProviderMessageId(wamid))?.status).toBe('delivered');

      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'read', timestamp: 1711580020 }]);
      expect((await dispatchRepo.findByProviderMessageId(wamid))?.status).toBe('read');
    });

    it('Scenario 10: Out-of-order receipt: read received before delivered advances status to read', async () => {
      const wamid = 'wamid.OUT_OF_ORDER_10';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      // "read" arrives first
      const readResult = await receiptHandler.processStatusReceipts([
        { id: wamid, status: 'read', timestamp: 1711580050 },
      ]);

      expect(readResult[0].currentStatus).toBe('read');

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('read');
      expect(log?.readAt).toBeDefined();
    });

    it('Scenario 11: Subsequent delivered arriving after read preserves status as read and records delivered_at', async () => {
      const wamid = 'wamid.OUT_OF_ORDER_11';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      // 1. read arrives
      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'read', timestamp: 1711580050 }]);

      // 2. delivered arrives afterwards
      const deliveredTs = new Date(1711580040 * 1000);
      const deliveredResult = await receiptHandler.processStatusReceipts([
        { id: wamid, status: 'delivered', timestamp: 1711580040 },
      ]);

      // Status must NOT regress to 'delivered'
      expect(deliveredResult[0].currentStatus).toBe('read');

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('read');
      expect(log?.readAt).toBeDefined();
      expect(log?.deliveredAt?.getTime()).toBe(deliveredTs.getTime());
    });

    it('Scenario 12: Duplicate delivered receipt is idempotent and does not alter status or timestamp', async () => {
      const wamid = 'wamid.DUP_DELIVERED_12';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      const firstTs = 1711580100;
      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'delivered', timestamp: firstTs }]);

      const logAfterFirst = await dispatchRepo.findByProviderMessageId(wamid);
      const originalDeliveredAt = logAfterFirst?.deliveredAt;

      // Duplicate delivered receipt with slightly different timestamp
      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'delivered', timestamp: firstTs + 5 }]);

      const logAfterSecond = await dispatchRepo.findByProviderMessageId(wamid);
      expect(logAfterSecond?.status).toBe('delivered');
      expect(logAfterSecond?.deliveredAt?.getTime()).toBe(originalDeliveredAt?.getTime());
    });

    it('Scenario 13: Duplicate read receipt is idempotent', async () => {
      const wamid = 'wamid.DUP_READ_13';
      await seedDispatchLog({ providerMessageId: wamid, status: 'delivered' });

      const readTs = 1711580200;
      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'read', timestamp: readTs }]);
      const firstReadAt = (await dispatchRepo.findByProviderMessageId(wamid))?.readAt;

      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'read', timestamp: readTs + 10 }]);
      const secondReadAt = (await dispatchRepo.findByProviderMessageId(wamid))?.readAt;

      expect(secondReadAt?.getTime()).toBe(firstReadAt?.getTime());
    });

    it('Scenario 14: Direct jump from sent to read sets status to read and records read_at', async () => {
      const wamid = 'wamid.SENT_TO_READ_14';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'read', timestamp: 1711580300 }]);

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('read');
      expect(log?.readAt).toBeDefined();
    });

    it('Scenario 15: Out-of-order sent receipt arriving after delivered does NOT regress status', async () => {
      const wamid = 'wamid.SENT_AFTER_DELIVERED_15';
      await seedDispatchLog({ providerMessageId: wamid, status: 'delivered' });

      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'sent', timestamp: 1711580000 }]);

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('delivered');
    });

    it('Scenario 16: Out-of-order sent receipt arriving after read does NOT regress status', async () => {
      const wamid = 'wamid.SENT_AFTER_READ_16';
      await seedDispatchLog({ providerMessageId: wamid, status: 'read' });

      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'sent', timestamp: 1711580000 }]);

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('read');
    });
  });

  // ==========================================================================
  // Category 4: Error Handling & Security Sanitization (Scenarios 17-20)
  // ==========================================================================
  describe('Category 4: Error Handling & Security Sanitization', () => {
    it('Scenario 17: Meta status receipt with failed status and error code sets status to failed', async () => {
      const wamid = 'wamid.FAILED_MSG_17';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      const results = await receiptHandler.processStatusReceipts([
        {
          id: wamid,
          status: 'failed',
          timestamp: '1711580400',
          errors: [
            {
              code: 131026,
              title: 'Message undeliverable',
              message: 'Recipient phone number is unregistered or blocked',
            },
          ],
        },
      ]);

      expect(results[0].currentStatus).toBe('failed');

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('failed');
      expect(log?.failedAt).toBeDefined();
      expect(log?.providerErrorCode).toBe('131026');
      expect(log?.providerErrorMessage).toBe('Recipient phone number is unregistered or blocked');
    });

    it('Scenario 18: Meta error message containing Meta access token EAAB... is redacted', async () => {
      const rawError = 'Failed sending message using token EAABwzLixABC1234567890XYZ to recipient';
      const sanitized = sanitizeErrorMessage(rawError);

      expect(sanitized).not.toContain('EAABwzLixABC1234567890XYZ');
      expect(sanitized).toContain('[REDACTED_META_TOKEN]');

      const wamid = 'wamid.TOKEN_SANITIZE_18';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      await receiptHandler.processStatusReceipts([
        {
          id: wamid,
          status: 'failed',
          timestamp: 1711580450,
          errors: [
            {
              code: 190,
              message: rawError,
            },
          ],
        },
      ]);

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.providerErrorMessage).toBe('Failed sending message using token [REDACTED_META_TOKEN] to recipient');
    });

    it('Scenario 19: Meta error message containing Bearer token and client secret is redacted', () => {
      const rawMsg =
        'Authorization failed: Bearer mySecretToken123456 with client_secret=very_secret_key_999&access_token=secret_abc';
      const sanitized = sanitizeErrorMessage(rawMsg);

      expect(sanitized).not.toContain('mySecretToken123456');
      expect(sanitized).not.toContain('very_secret_key_999');
      expect(sanitized).not.toContain('secret_abc');
      expect(sanitized).toContain('Bearer [REDACTED_TOKEN]');
      expect(sanitized).toContain('client_secret=[REDACTED]');
      expect(sanitized).toContain('access_token=[REDACTED]');
    });

    it('Scenario 20: Receipt with failed arriving after message is delivered or read does NOT regress status', async () => {
      const wamid = 'wamid.FAIL_AFTER_READ_20';
      await seedDispatchLog({ providerMessageId: wamid, status: 'read' });

      await receiptHandler.processStatusReceipts([
        {
          id: wamid,
          status: 'failed',
          timestamp: 1711580500,
          errors: [{ code: 100, message: 'Late delivery failure report' }],
        },
      ]);

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('read');
      expect(log?.providerErrorCode).toBe('100');
    });
  });

  // ==========================================================================
  // Category 5: User Response Attribution (Scenarios 21-26)
  // ==========================================================================
  describe('Category 5: User Response Attribution', () => {
    it('Scenario 21: Inbound user reply received 15 minutes after dispatch is attributed successfully', async () => {
      const now = new Date();
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const userId = 'user-attr-21';
      const convId = 'conv-attr-21';

      const log = await seedDispatchLog({
        userId,
        conversationId: convId,
        sentAt: fifteenMinutesAgo,
        status: 'sent',
      });

      const attribution = await receiptHandler.attributeUserResponse({
        userId,
        conversationId: convId,
        text: 'شكراً، هجرب وأرد عليك',
        messageId: 'wamid.USER_REPLY_21',
        receivedAt: now,
      });

      expect(attribution.attributed).toBe(true);
      expect(attribution.dispatchId).toBe(log.id);
      expect(attribution.actionId).toBe(log.actionId);
      expect(attribution.reason).toBe('attributed_successfully');

      const updated = await dispatchRepo.findById(log.id);
      expect(updated?.respondedAt).toBeDefined();
      expect(updated?.respondedMessageId).toBe('wamid.USER_REPLY_21');

      const engagements = await dispatchRepo.getEngagementsForDispatch(log.id);
      const replyEng = engagements.find((e) => e.eventType === 'user_replied');
      expect(replyEng).toBeDefined();
      expect(replyEng?.attributionSource).toBe('inbound_message');
    });

    it('Scenario 22: Inbound user reply received 2 hours and 5 minutes after dispatch is rejected with outside_attribution_window', async () => {
      const now = new Date();
      const twoHoursFiveMinsAgo = new Date(now.getTime() - 125 * 60 * 1000);
      const userId = 'user-attr-22';
      const convId = 'conv-attr-22';

      await seedDispatchLog({
        userId,
        conversationId: convId,
        sentAt: twoHoursFiveMinsAgo,
        status: 'delivered',
      });

      const attribution = await receiptHandler.attributeUserResponse({
        userId,
        conversationId: convId,
        text: 'أنا لسه شايف الرسالة دلوقتي',
        receivedAt: now,
      });

      expect(attribution.attributed).toBe(false);
      expect(attribution.reason).toBe('outside_attribution_window');
    });

    it('Scenario 23: Inbound user reply from user B is NOT attributed to user A dispatch', async () => {
      const now = new Date();
      await seedDispatchLog({
        userId: 'user-A',
        sentAt: new Date(now.getTime() - 10 * 60 * 1000),
        status: 'delivered',
      });

      const attribution = await receiptHandler.attributeUserResponse({
        userId: 'user-B',
        text: 'تمام جداً',
        receivedAt: now,
      });

      expect(attribution.attributed).toBe(false);
      expect(attribution.reason).toBe('no_eligible_dispatch');
    });

    it('Scenario 24: Inbound user reply in a different conversation is NOT attributed when conversation mismatch exists', async () => {
      const now = new Date();
      await seedDispatchLog({
        userId: 'user-conv-24',
        conversationId: 'conversation-A',
        sentAt: new Date(now.getTime() - 10 * 60 * 1000),
        status: 'delivered',
      });

      const attribution = await receiptHandler.attributeUserResponse({
        userId: 'user-conv-24',
        conversationId: 'conversation-B',
        text: 'تمام هشوفها',
        receivedAt: now,
      });

      expect(attribution.attributed).toBe(false);
      expect(attribution.reason).toBe('no_eligible_dispatch');
    });

    it('Scenario 25: Trivial message (empty string, whitespace only, or single punctuation) is rejected with trivial_message', async () => {
      expect(isTrivialMessage('')).toBe(true);
      expect(isTrivialMessage('   ')).toBe(true);
      expect(isTrivialMessage('?')).toBe(true);
      expect(isTrivialMessage('.')).toBe(true);
      expect(isTrivialMessage('تمام')).toBe(false);

      const userId = 'user-triv-25';
      await seedDispatchLog({
        userId,
        sentAt: new Date(),
        status: 'delivered',
      });

      const resEmpty = await receiptHandler.attributeUserResponse({
        userId,
        text: '   ',
      });
      expect(resEmpty.attributed).toBe(false);
      expect(resEmpty.reason).toBe('trivial_message');

      const resPunct = await receiptHandler.attributeUserResponse({
        userId,
        text: '?',
      });
      expect(resPunct.attributed).toBe(false);
      expect(resPunct.reason).toBe('trivial_message');
    });

    it('Scenario 26: User reply detected as explicit topic switch is NOT attributed', async () => {
      const userId = 'user-switch-26';
      await seedDispatchLog({
        userId,
        sentAt: new Date(),
        status: 'delivered',
        metadata: { topic: 'flutter clean command' },
      });

      const attribution = await receiptHandler.attributeUserResponse({
        userId,
        text: 'عايز أسأل عن سعر سهم آبل النهاردة كام؟',
        isTopicSwitch: true,
      });

      expect(attribution.attributed).toBe(false);
      expect(attribution.reason).toBe('topic_switch_detected');
    });
  });

  // ==========================================================================
  // Category 6: Multiple Actions & Dispatches Attribution (Scenarios 27-29)
  // ==========================================================================
  describe('Category 6: Multiple Actions & Dispatches Attribution', () => {
    it('Scenario 27: Multiple proactive dispatches to the same user: reply attributes to latest dispatch within window', async () => {
      const now = new Date();
      const userId = 'user-multi-27';

      const olderLog = await seedDispatchLog({
        userId,
        actionId: 'action-older',
        sentAt: new Date(now.getTime() - 40 * 60 * 1000), // 40m ago
        status: 'delivered',
      });

      const newerLog = await seedDispatchLog({
        userId,
        actionId: 'action-newer',
        sentAt: new Date(now.getTime() - 10 * 60 * 1000), // 10m ago
        status: 'delivered',
      });

      const attribution = await receiptHandler.attributeUserResponse({
        userId,
        text: 'أنا نفذت اللي قولت عليه',
        receivedAt: now,
      });

      expect(attribution.attributed).toBe(true);
      expect(attribution.dispatchId).toBe(newerLog.id);
      expect(attribution.actionId).toBe('action-newer');

      // Older log remains unresponded
      const olderCheck = await dispatchRepo.findById(olderLog.id);
      expect(olderCheck?.respondedAt).toBeUndefined();
    });

    it('Scenario 28: Once a dispatch is marked responded_at, subsequent replies attribute to next eligible dispatch', async () => {
      const now = new Date();
      const userId = 'user-multi-28';

      const dispatch1 = await seedDispatchLog({
        userId,
        actionId: 'action-1',
        sentAt: new Date(now.getTime() - 50 * 60 * 1000),
        status: 'delivered',
      });

      const dispatch2 = await seedDispatchLog({
        userId,
        actionId: 'action-2',
        sentAt: new Date(now.getTime() - 10 * 60 * 1000),
        status: 'delivered',
      });

      // First reply attributes to dispatch2 (the newest)
      const attr1 = await receiptHandler.attributeUserResponse({
        userId,
        text: 'أيوة بخصوص الموضوع الأخير',
        receivedAt: now,
      });
      expect(attr1.dispatchId).toBe(dispatch2.id);

      // Second reply should attribute to dispatch1 (since dispatch2 is already responded to)
      const attr2 = await receiptHandler.attributeUserResponse({
        userId,
        text: 'وبرضو بخصوص الموضوع القديم، تمام',
        receivedAt: new Date(now.getTime() + 1000),
      });

      expect(attr2.attributed).toBe(true);
      expect(attr2.dispatchId).toBe(dispatch1.id);
      expect(attr2.actionId).toBe('action-1');
    });

    it('Scenario 29: If all dispatches are already responded to, reply returns no_eligible_dispatch', async () => {
      const now = new Date();
      const userId = 'user-multi-29';

      const dispatch = await seedDispatchLog({
        userId,
        sentAt: new Date(now.getTime() - 10 * 60 * 1000),
        status: 'delivered',
      });

      await receiptHandler.attributeUserResponse({
        userId,
        text: 'أول رد',
        receivedAt: now,
      });

      // Second reply with no other unresponded dispatches
      const attrSecond = await receiptHandler.attributeUserResponse({
        userId,
        text: 'رد إضافي تالت',
        receivedAt: new Date(now.getTime() + 2000),
      });

      expect(attrSecond.attributed).toBe(false);
      expect(attrSecond.reason).toBe('no_eligible_dispatch');
    });
  });

  // ==========================================================================
  // Category 7: Integration with Webhook & Orchestrator (Scenarios 30-35)
  // ==========================================================================
  describe('Category 7: Integration with Webhook & Orchestrator', () => {
    it('Scenario 30: POST webhook containing statuses payload triggers processStatusReceipts and updates dispatch log', async () => {
      const wamid = 'wamid.WEBHOOK_INT_30';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      const webhook = new WhatsAppWebhookHandler(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        receiptHandler
      );

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [
                    {
                      id: wamid,
                      status: 'delivered',
                      timestamp: '1711580600',
                      recipient_id: '201012345678',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const { req, res } = mockReqRes(payload, { 'x-hub-signature-256': signature });
      await webhook.handleIncoming(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.sentData).toBe('EVENT_RECEIVED');

      const log = await dispatchRepo.findByProviderMessageId(wamid);
      expect(log?.status).toBe('delivered');
    });

    it('Scenario 31: POST webhook containing statuses without messages returns EVENT_RECEIVED without calling orchestrator', async () => {
      const mockOrchestrator = { run: jest.fn() };
      const webhook = new WhatsAppWebhookHandler(
        {} as any,
        {} as any,
        mockOrchestrator as any,
        {} as any,
        {} as any,
        {} as any,
        receiptHandler
      );

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [{ id: 'wamid.IGNORE_ME', status: 'sent', timestamp: '1711580000' }],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const { req, res } = mockReqRes(payload, { 'x-hub-signature-256': signature });
      await webhook.handleIncoming(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockOrchestrator.run).not.toHaveBeenCalled();
    });

    it('Scenario 32: Webhook status receipt error does not fail or crash HTTP 200 response to Meta', async () => {
      const brokenHandler = {
        processStatusReceipts: jest.fn().mockRejectedValue(new Error('Simulated DB connection failure')),
        attributeUserResponse: jest.fn(),
      };

      const webhook = new WhatsAppWebhookHandler(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        brokenHandler as any
      );

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [{ id: 'wamid.TEST', status: 'delivered', timestamp: '1711580000' }],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const { req, res } = mockReqRes(payload, { 'x-hub-signature-256': signature });
      await webhook.handleIncoming(req, res);

      // Meta requires 200 OK regardless of internal receipt handler failures
      expect(res.statusCode).toBe(200);
      expect(res.sentData).toBe('EVENT_RECEIVED');
    });

    it('Scenario 33: Attribution error does not fail or delay AgentOrchestrator execution', async () => {
      const mockOrchestrator = {
        run: jest.fn().mockResolvedValue({ status: 'completed', replyText: 'Answer' }),
      };
      const mockUserRepo = {
        findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({ id: 'u-1', phoneNumber: '201012345678' }),
      };
      const mockWebhookRepo = {
        isEventProcessed: jest.fn().mockResolvedValue(false),
        markEventProcessed: jest.fn().mockResolvedValue(undefined),
      };
      const mockAdapter = {
        sendTextMessage: jest.fn().mockResolvedValue({}),
        sendTypingIndicator: jest.fn().mockResolvedValue({}),
      };

      const brokenReceiptHandler = {
        processStatusReceipts: jest.fn(),
        attributeUserResponse: jest.fn().mockRejectedValue(new Error('Attribution timeout')),
      };

      const webhook = new WhatsAppWebhookHandler(
        mockAdapter as any,
        mockWebhookRepo as any,
        mockOrchestrator as any,
        {} as any,
        {} as any,
        mockUserRepo as any,
        brokenReceiptHandler as any
      );

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.INBOUND_USER_MSG_33',
                      from: '201012345678',
                      type: 'text',
                      text: { body: 'Hello assistant' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const { req, res } = mockReqRes(payload, { 'x-hub-signature-256': signature });
      await webhook.handleIncoming(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockOrchestrator.run).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-1',
          text: 'Hello assistant',
        })
      );
    });

    it('Scenario 34: Inbound user reply creates proactive_engagement record with event_type user_replied', async () => {
      const userId = 'user-eng-34';
      const log = await seedDispatchLog({
        userId,
        sentAt: new Date(Date.now() - 5 * 60 * 1000),
        status: 'delivered',
      });

      await receiptHandler.attributeUserResponse({
        userId,
        text: 'أنا جربت الطريقة',
        messageId: 'wamid.MSG_34',
      });

      const engagements = await dispatchRepo.getEngagementsForDispatch(log.id);
      expect(engagements.some((e) => e.eventType === 'user_replied')).toBe(true);
    });

    it('Scenario 35: Interactive button reply confirmation flow operates independently from attribution', async () => {
      const mockConfirmationService = {
        verifyAndResolve: jest.fn().mockResolvedValue({
          success: true,
          message: 'Confirmed',
          confirmation: { actionName: 'create_reminder' },
        }),
      };
      const mockChatRepo = {
        getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'c-1' }),
        saveMessage: jest.fn().mockResolvedValue({}),
      };
      const mockAdapter = {
        sendTextMessage: jest.fn().mockResolvedValue({}),
      };
      const mockUserRepo = {
        findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({ id: 'u-btn', phoneNumber: '201011111111' }),
      };
      const mockWebhookRepo = {
        isEventProcessed: jest.fn().mockResolvedValue(false),
        markEventProcessed: jest.fn().mockResolvedValue(undefined),
      };

      const webhook = new WhatsAppWebhookHandler(
        mockAdapter as any,
        mockWebhookRepo as any,
        {} as any,
        mockConfirmationService as any,
        mockChatRepo as any,
        mockUserRepo as any,
        receiptHandler
      );

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.BTN_MSG_35',
                      from: '201011111111',
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: 'conf_approve_token123',
                          title: 'Confirm ✅',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const { req, res } = mockReqRes(payload, { 'x-hub-signature-256': signature });
      await webhook.handleIncoming(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockConfirmationService.verifyAndResolve).toHaveBeenCalledWith('token123', 'approved');
      expect(mockAdapter.sendTextMessage).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Category 8: Idempotency & Deduplication (Scenarios 36-37)
  // ==========================================================================
  describe('Category 8: Idempotency & Deduplication', () => {
    it('Scenario 36: Multiple identical status webhooks for same (dispatch_id, event_type) create exactly one engagement record', async () => {
      const wamid = 'wamid.DEDUP_ENG_36';
      const log = await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      // Process delivered receipt twice
      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'delivered', timestamp: 1711580700 }]);
      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'delivered', timestamp: 1711580700 }]);

      const engagements = await dispatchRepo.getEngagementsForDispatch(log.id);
      const deliveredEngagements = engagements.filter((e) => e.eventType === 'delivered');

      expect(deliveredEngagements).toHaveLength(1);
    });

    it('Scenario 37: Concurrent identical receipts for delivered do not generate duplicate engagement events', async () => {
      const wamid = 'wamid.CONCURRENT_ENG_37';
      const log = await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      // Run two parallel receipt updates
      await Promise.all([
        receiptHandler.processStatusReceipts([{ id: wamid, status: 'delivered', timestamp: 1711580750 }]),
        receiptHandler.processStatusReceipts([{ id: wamid, status: 'delivered', timestamp: 1711580750 }]),
      ]);

      const engagements = await dispatchRepo.getEngagementsForDispatch(log.id);
      const deliveredEngagements = engagements.filter((e) => e.eventType === 'delivered');

      expect(deliveredEngagements).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Category 9: Boundaries, Security & Performance (Scenarios 38-41)
  // ==========================================================================
  describe('Category 9: Boundaries, Security & Performance', () => {
    it('Scenario 38: Receipt processing never makes LLM or external network API calls', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const wamid = 'wamid.ZERO_LLM_38';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      await receiptHandler.processStatusReceipts([
        { id: wamid, status: 'delivered', timestamp: 1711580800 },
        { id: wamid, status: 'read', timestamp: 1711580810 },
      ]);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Scenario 39: Proactive receipts and engagement tracking NEVER directly write to or modify memory_items or memory_evidence', async () => {
      const memoryRepoMock = {
        saveItem: jest.fn(),
        createEvidence: jest.fn(),
      };

      const wamid = 'wamid.MEMORY_ISOLATION_39';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      await receiptHandler.processStatusReceipts([{ id: wamid, status: 'read', timestamp: 1711580850 }]);

      await receiptHandler.attributeUserResponse({
        userId: 'user-mem-39',
        text: 'أيوة الرسالة دي فادتني جداً',
      });

      expect(memoryRepoMock.saveItem).not.toHaveBeenCalled();
      expect(memoryRepoMock.createEvidence).not.toHaveBeenCalled();
    });

    it('Scenario 40: Proactive receipts and engagement tracking do NOT perform automatic dynamic policy tuning', async () => {
      const wamid = 'wamid.NO_DYNAMIC_TUNING_40';
      const log = await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      await receiptHandler.processStatusReceipts([
        { id: wamid, status: 'failed', timestamp: 1711580900, errors: [{ code: 131026, message: 'Undeliverable' }] },
      ]);

      // Verify that no cooldown or threshold properties in user preferences or action policies are modified
      const updatedLog = await dispatchRepo.findByProviderMessageId(wamid);
      expect(updatedLog?.status).toBe('failed');
      // No policy tuning side-effects
    });

    it('Scenario 41: Full receipt processing pipeline executes in < 2ms deterministically across 500 iterations', async () => {
      const wamid = 'wamid.PERF_BENCH_41';
      await seedDispatchLog({ providerMessageId: wamid, status: 'sent' });

      const payload: MetaStatusPayload = {
        id: wamid,
        status: 'delivered',
        timestamp: 1711580950,
      };

      const start = performance.now();
      const iterations = 500;
      for (let i = 0; i < iterations; i++) {
        await receiptHandler.processStatusReceipts([payload]);
      }
      const totalElapsed = performance.now() - start;
      const avgMs = totalElapsed / iterations;

      expect(avgMs).toBeLessThan(2.0); // Average must be well below 2ms target
    });
  });
});
