import { WhatsAppWebhookHandler } from '../src/modules/whatsapp/webhook';
import { WebhookRepository } from '../src/database/repositories/webhook.repo';
import { config } from '../src/config/env';

describe('WhatsApp Integration & Webhook', () => {
  let handler: WhatsAppWebhookHandler;
  let repo: WebhookRepository;

  beforeEach(() => {
    repo = new WebhookRepository();
    handler = new WhatsAppWebhookHandler(undefined, repo);
  });

  test('successfully verifies webhook with valid token and returns challenge', () => {
    const req: any = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': config.whatsapp.verifyToken,
        'hub.challenge': '1234567890',
      },
    };

    let statusCode = 0;
    let responseBody = '';

    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          send: (body: string) => {
            responseBody = body;
          },
        };
      },
    };

    handler.verifyWebhook(req, res);
    expect(statusCode).toBe(200);
    expect(responseBody).toBe('1234567890');
  });

  test('rejects webhook with invalid verify token', () => {
    const req: any = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '1234567890',
      },
    };

    let statusCode = 0;
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          send: () => {},
        };
      },
    };

    handler.verifyWebhook(req, res);
    expect(statusCode).toBe(403);
  });

  test('deduplicates incoming events by wamid', async () => {
    const eventId = `wamid.test.${Date.now()}.${Math.random()}`;
    expect(await repo.isEventProcessed(eventId)).toBe(false);

    await repo.markEventProcessed(eventId);
    expect(await repo.isEventProcessed(eventId)).toBe(true);
  });
});

describe('WhatsAppAdapter typing indicator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends typing indicator with status read and message_id', async () => {
    const { WhatsAppAdapter } = require('../src/modules/whatsapp/adapter');
    const adapter = new WhatsAppAdapter();

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch as any;

    const result = await adapter.sendTypingIndicator('wamid.test.123');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/messages'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: 'wamid.test.123',
          typing_indicator: {
            type: 'text',
          },
        }),
      })
    );
  });

  test('returns false when messageId is empty', async () => {
    const { WhatsAppAdapter } = require('../src/modules/whatsapp/adapter');
    const adapter = new WhatsAppAdapter();
    const result = await adapter.sendTypingIndicator('');
    expect(result).toBe(false);
  });
});

describe('WhatsApp Webhook BSUID & Phone Compatibility (Tests A - E)', () => {
  let handler: WhatsAppWebhookHandler;
  let mockAdapter: any;
  let webhookRepo: any;
  let orchestrator: any;
  let chatRepo: any;
  let userRepo: any;
  let orchestratorRunSpy: jest.SpyInstance;

  beforeEach(() => {
    mockAdapter = {
      sendTextMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      sendTypingIndicator: jest.fn().mockResolvedValue(true),
    };
    webhookRepo = new (require('../src/database/repositories/webhook.repo').WebhookRepository)();
    chatRepo = new (require('../src/database/repositories/chat.repo').ChatRepository)();
    userRepo = new (require('../src/database/repositories/user.repo').UserRepository)();
    orchestrator = new (require('../src/modules/agent/orchestrator').AgentOrchestrator)();

    orchestratorRunSpy = jest.spyOn(orchestrator, 'run').mockResolvedValue({
      conversationId: 'conv-test-1',
      agentRunId: 'run-test-1',
      status: 'completed',
      replyText: 'مرحباً، تم استلام رسالتك بنجاح!',
      toolCallsExecuted: [],
    });

    const confirmationService = new (require('../src/modules/confirmation/confirmation.service').ConfirmationService)();

    handler = new WhatsAppWebhookHandler(
      mockAdapter,
      webhookRepo,
      orchestrator,
      confirmationService,
      chatRepo,
      userRepo
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockRes = () => {
    let statusCode = 0;
    let body = '';
    return {
      res: {
        status: (code: number) => {
          statusCode = code;
          return {
            send: (b: string) => {
              body = b;
            },
          };
        },
        headersSent: false,
      },
      getStatusCode: () => statusCode,
      getBody: () => body,
    };
  };

  // Test A — Legacy phone webhook: message.from = "2010...", message.from_user_id = undefined
  test('Test A: processes legacy phone webhook, resolves user, calls AI, and sends response', async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '201012345678',
                    id: `wamid_phone_${Date.now()}`,
                    type: 'text',
                    text: { body: 'رسالة من مستخدم برقم هاتف' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { res, getStatusCode, getBody } = createMockRes();
    const req: any = { headers: {}, body: payload };

    await handler.handleIncoming(req, res as any);

    expect(getStatusCode()).toBe(200);
    expect(getBody()).toBe('EVENT_RECEIVED');
    expect(orchestratorRunSpy).toHaveBeenCalledTimes(1);
    expect(orchestratorRunSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        text: 'رسالة من مستخدم برقم هاتف',
      })
    );
    expect(mockAdapter.sendTextMessage).toHaveBeenCalledWith(
      '201012345678',
      'مرحباً، تم استلام رسالتك بنجاح!'
    );
  });

  // Test B — BSUID webhook: message.from = undefined, message.from_user_id = "<BSUID>"
  test('Test B: processes BSUID webhook, resolves/creates user without phone, calls AI, and replies to BSUID', async () => {
    const bsuid = 'EG.BSUID_USER_987654';
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from_user_id: bsuid,
                    id: `wamid_bsuid_${Date.now()}`,
                    type: 'text',
                    text: { body: 'رسالة من مستخدم باسم مستخدم فقط BSUID' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { res, getStatusCode, getBody } = createMockRes();
    const req: any = { headers: {}, body: payload };

    await handler.handleIncoming(req, res as any);

    expect(getStatusCode()).toBe(200);
    expect(getBody()).toBe('EVENT_RECEIVED');
    expect(orchestratorRunSpy).toHaveBeenCalledTimes(1);
    expect(orchestratorRunSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        text: 'رسالة من مستخدم باسم مستخدم فقط BSUID',
      })
    );
    // Outbound response must be sent to the BSUID
    expect(mockAdapter.sendTextMessage).toHaveBeenCalledWith(
      bsuid,
      'مرحباً، تم استلام رسالتك بنجاح!'
    );
  });

  // Test C — Invalid webhook: neither from nor from_user_id nor contacts[0].user_id
  test('Test C: returns HTTP 200 without calling AI or sending outbound message when no sender identity exists', async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: `wamid_invalid_${Date.now()}`,
                    type: 'text',
                    text: { body: 'رسالة بدون أي معرف مرسل' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { res, getStatusCode, getBody } = createMockRes();
    const req: any = { headers: {}, body: payload };

    await handler.handleIncoming(req, res as any);

    expect(getStatusCode()).toBe(200);
    expect(getBody()).toBe('EVENT_RECEIVED');
    expect(orchestratorRunSpy).not.toHaveBeenCalled();
    expect(mockAdapter.sendTextMessage).not.toHaveBeenCalled();
  });

  // Test D — Existing BSUID user: sending another message reuses the same user and conversation history
  test('Test D: reuses existing user and conversation history for recurring BSUID messages', async () => {
    const bsuid = 'EG.RECURRING_BSUID_123';
    const payload1 = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from_user_id: bsuid,
                    id: `wamid_bsuid_d1_${Date.now()}`,
                    type: 'text',
                    text: { body: 'الرسالة الأولى من BSUID' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { res: res1 } = createMockRes();
    await handler.handleIncoming({ headers: {}, body: payload1 } as any, res1 as any);

    const firstCallUserId = orchestratorRunSpy.mock.calls[0][0].userId;
    expect(firstCallUserId).toBeDefined();

    // Send second message from same BSUID
    const payload2 = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from_user_id: bsuid,
                    id: `wamid_bsuid_d2_${Date.now()}`,
                    type: 'text',
                    text: { body: 'الرسالة الثانية من نفس BSUID' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { res: res2 } = createMockRes();
    await handler.handleIncoming({ headers: {}, body: payload2 } as any, res2 as any);

    const secondCallUserId = orchestratorRunSpy.mock.calls[1][0].userId;
    // Must resolve to the exact same userId
    expect(secondCallUserId).toBe(firstCallUserId);
  });

  // Test E — Existing phone user: verifies phone-based behavior remains unchanged
  test('Test E: existing phone user resolves consistently across message turns', async () => {
    const phone = '201099887766';
    const payload1 = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: phone,
                    id: `wamid_phone_e1_${Date.now()}`,
                    type: 'text',
                    text: { body: 'أنا مستخدم قديم برقم هاتف' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { res: res1 } = createMockRes();
    await handler.handleIncoming({ headers: {}, body: payload1 } as any, res1 as any);

    const firstUserId = orchestratorRunSpy.mock.calls[0][0].userId;

    const payload2 = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: `+${phone}`,
                    id: `wamid_phone_e2_${Date.now()}`,
                    type: 'text',
                    text: { body: 'الرسالة الثانية برقم الهاتف بصيغة +' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { res: res2 } = createMockRes();
    await handler.handleIncoming({ headers: {}, body: payload2 } as any, res2 as any);

    const secondUserId = orchestratorRunSpy.mock.calls[1][0].userId;
    expect(secondUserId).toBe(firstUserId);
  });
});

describe('WhatsApp Destination Normalization (Phone vs BSUID)', () => {
  const { normalizeWhatsAppDestination } = require('../src/modules/whatsapp/adapter');

  test('normalizes standard local and international phone numbers', () => {
    expect(normalizeWhatsAppDestination('+201012345678')).toBe('201012345678');
    expect(normalizeWhatsAppDestination('201012345678')).toBe('201012345678');
    expect(normalizeWhatsAppDestination('  +15551234567  ')).toBe('15551234567');
  });

  test('preserves alphanumeric BSUID recipients exactly without destroying letters or dots', () => {
    expect(normalizeWhatsAppDestination('EG.1A2B3C4D5E6F7G')).toBe('EG.1A2B3C4D5E6F7G');
    expect(normalizeWhatsAppDestination('US.user_scoped_9988')).toBe('US.user_scoped_9988');
    expect(normalizeWhatsAppDestination('  BR.abc123xyz.meta  ')).toBe('BR.abc123xyz.meta');
  });
});

describe('WhatsApp Outbound Payload Addressing (Phone vs BSUID)', () => {
  let adapter: any;
  let originalFetch: any;
  let capturedPayload: any;

  beforeEach(() => {
    const { WhatsAppAdapter } = require('../src/modules/whatsapp/adapter');
    adapter = new WhatsAppAdapter();
    adapter['phoneNumberId'] = '1234567890';
    adapter['accessToken'] = 'test-token';

    originalFetch = global.fetch;
    capturedPayload = null;
    global.fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
      if (options?.body) {
        capturedPayload = JSON.parse(options.body);
      }
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.out.123' }] }),
      };
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('phone recipient uses "to" and omits "recipient"', async () => {
    await adapter.sendRawTextMessage('+201012345678', 'Hello phone');
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.recipient_type).toBe('individual');
    expect(capturedPayload.to).toBe('201012345678');
    expect(capturedPayload.recipient).toBeUndefined();
    expect(capturedPayload).not.toHaveProperty('recipient');
  });

  test('BSUID recipient uses "recipient" and omits "to" (fails if BSUID placed in "to")', async () => {
    const bsuid = 'EG.BSUID_USER_987654';
    await adapter.sendRawTextMessage(bsuid, 'Hello BSUID');
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.recipient_type).toBe('individual');
    expect(capturedPayload.recipient).toBe(bsuid);
    expect(capturedPayload.to).toBeUndefined();
    expect(capturedPayload).not.toHaveProperty('to');
  });

  test('interactive buttons for phone uses "to" and omits "recipient"', async () => {
    await adapter.sendInteractiveButtons('201012345678', 'Choose option', [
      { id: 'btn_1', title: 'Option 1' },
    ]);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.recipient_type).toBe('individual');
    expect(capturedPayload.to).toBe('201012345678');
    expect(capturedPayload.recipient).toBeUndefined();
    expect(capturedPayload).not.toHaveProperty('recipient');
  });

  test('interactive buttons for BSUID uses "recipient" and omits "to"', async () => {
    const bsuid = 'US.user_scoped_9988';
    await adapter.sendInteractiveButtons(bsuid, 'Choose option', [
      { id: 'btn_1', title: 'Option 1' },
    ]);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.recipient_type).toBe('individual');
    expect(capturedPayload.recipient).toBe(bsuid);
    expect(capturedPayload.to).toBeUndefined();
    expect(capturedPayload).not.toHaveProperty('to');
  });

  test('buildRecipientPayload helper strictly differentiates phone vs BSUID', () => {
    const { buildRecipientPayload } = require('../src/modules/whatsapp/adapter');

    const phoneResult = buildRecipientPayload('+201012345678');
    expect(phoneResult).toEqual({ to: '201012345678' });
    expect(phoneResult).not.toHaveProperty('recipient');

    const bsuidResult = buildRecipientPayload('EG.USER_BSUID_123');
    expect(bsuidResult).toEqual({ recipient: 'EG.USER_BSUID_123' });
    expect(bsuidResult).not.toHaveProperty('to');
  });
});
