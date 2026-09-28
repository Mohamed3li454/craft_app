import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { WhatsAppTypingController } from '../src/modules/whatsapp/typing_controller';
import { WhatsAppWebhookHandler } from '../src/modules/whatsapp/webhook';
import { config } from '../src/config/env';

describe('WhatsApp Typing Indicator & Lifecycle Tests (Part 13)', () => {
  const originalFetch = global.fetch;
  const originalNodeEnv = config.nodeEnv;
  const originalPhoneId = config.whatsapp.phoneNumberId;
  const originalToken = config.whatsapp.accessToken;

  afterEach(() => {
    global.fetch = originalFetch;
    (config as any).nodeEnv = originalNodeEnv;
    (config as any).whatsapp.phoneNumberId = originalPhoneId;
    (config as any).whatsapp.accessToken = originalToken;
    jest.clearAllMocks();
  });

  // =========================================================================
  // Scenario A: Typing Success (incoming -> typing -> AI -> response)
  // =========================================================================
  test('Scenario A: Incoming message triggers typing indicator, executes AI, and sends response', async () => {
    (config as any).whatsapp.phoneNumberId = '1234567890';
    (config as any).whatsapp.accessToken = 'prod_secret_token';

    const dispatchedCalls: any[] = [];
    const mockFetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      const parsedBody = JSON.parse(opts.body);
      dispatchedCalls.push({ url, body: parsedBody, headers: opts.headers });
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.sent.123' }] }),
      };
    });
    global.fetch = mockFetch as any;

    const mockAdapter = new WhatsAppAdapter('1234567890', 'prod_secret_token');
    const mockWebhookRepo = {
      isEventProcessed: jest.fn().mockResolvedValue(false),
      markEventProcessed: jest.fn().mockResolvedValue(true),
    };
    const mockUserRepo = {
      findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({ id: 'u1', name: 'Test User', phoneNumber: '201012345678' }),
    };
    const mockChatRepo = {
      getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'c1' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
    };
    const mockOrchestrator = {
      run: jest.fn().mockResolvedValue({ status: 'completed', replyText: 'مرحباً بك في Craft!' }),
    };

    const handler = new WhatsAppWebhookHandler(
      mockAdapter,
      mockWebhookRepo as any,
      mockOrchestrator as any,
      {} as any,
      mockChatRepo as any,
      mockUserRepo as any,
      { attributeUserResponse: jest.fn().mockResolvedValue(null) } as any
    );

    const req: any = {
      headers: {},
      rawBody: '{"test":true}',
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.incoming.001',
                      from: '201012345678',
                      type: 'text',
                      text: { body: 'مرحبا' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    let responseStatus = 0;
    let responseBody = '';
    const res: any = {
      status: (s: number) => {
        responseStatus = s;
        return res;
      },
      send: (b: string) => {
        responseBody = b;
        return res;
      },
      headersSent: false,
    };

    await handler.handleIncoming(req, res);

    expect(responseStatus).toBe(200);
    expect(responseBody).toBe('EVENT_RECEIVED');
    expect(mockOrchestrator.run).toHaveBeenCalledTimes(1);

    // Verify typing indicator call
    const typingCall = dispatchedCalls.find((c) => c.body.typing_indicator?.type === 'text');
    expect(typingCall).toBeDefined();
    expect(typingCall.body.message_id).toBe('wamid.incoming.001');
    expect(typingCall.body.status).toBe('read');
    expect(typingCall.headers.Authorization).toBe('Bearer prod_secret_token');

    // Verify outbound reply call
    const replyCall = dispatchedCalls.find((c) => c.body.text?.body === 'مرحباً بك في Craft!');
    expect(replyCall).toBeDefined();
    expect(replyCall.body.to).toBe('201012345678');
  });

  // =========================================================================
  // Scenario B: Typing Failure (typing fails -> AI continues -> response succeeds)
  // =========================================================================
  test('Scenario B: Failure in typing dispatch does NOT abort AI processing or response', async () => {
    (config as any).whatsapp.phoneNumberId = '1234567890';
    (config as any).whatsapp.accessToken = 'prod_secret_token';

    const dispatchedCalls: any[] = [];
    const mockFetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      const parsedBody = JSON.parse(opts.body);
      if (parsedBody.typing_indicator) {
        // Typing fails with 500
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { message: 'Meta Graph API internal error' } }),
        };
      }
      dispatchedCalls.push(parsedBody);
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.sent.002' }] }),
      };
    });
    global.fetch = mockFetch as any;

    const mockAdapter = new WhatsAppAdapter('1234567890', 'prod_secret_token');
    const mockWebhookRepo = {
      isEventProcessed: jest.fn().mockResolvedValue(false),
      markEventProcessed: jest.fn().mockResolvedValue(true),
    };
    const mockUserRepo = {
      findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({ id: 'u1', name: 'User', phoneNumber: '201012345678' }),
    };
    const mockOrchestrator = {
      run: jest.fn().mockResolvedValue({ status: 'completed', replyText: 'Success despite typing failure' }),
    };

    const handler = new WhatsAppWebhookHandler(
      mockAdapter,
      mockWebhookRepo as any,
      mockOrchestrator as any,
      {} as any,
      {} as any,
      mockUserRepo as any,
      { attributeUserResponse: jest.fn().mockResolvedValue(null) } as any
    );

    const req: any = {
      headers: {},
      rawBody: '{}',
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.incoming.002',
                      from: '201012345678',
                      type: 'text',
                      text: { body: 'test' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    const res: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    await handler.handleIncoming(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
    expect(mockOrchestrator.run).toHaveBeenCalledTimes(1);

    // Outbound message was dispatched despite typing error
    const textReply = dispatchedCalls.find((c) => c.text?.body === 'Success despite typing failure');
    expect(textReply).toBeDefined();
  });

  // =========================================================================
  // Scenario C: AI Failure (typing -> AI failure -> safe termination & cleanup)
  // =========================================================================
  test('Scenario C: AI crash safely terminates typing controller and dispatches emergency fallback', async () => {
    (config as any).whatsapp.phoneNumberId = '1234567890';
    (config as any).whatsapp.accessToken = 'prod_secret_token';

    const dispatchedCalls: any[] = [];
    const mockFetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      const parsedBody = JSON.parse(opts.body);
      dispatchedCalls.push(parsedBody);
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.sent.003' }] }),
      };
    });
    global.fetch = mockFetch as any;

    const mockAdapter = new WhatsAppAdapter('1234567890', 'prod_secret_token');
    const mockWebhookRepo = {
      isEventProcessed: jest.fn().mockResolvedValue(false),
      markEventProcessed: jest.fn().mockResolvedValue(true),
    };
    const mockUserRepo = {
      findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({ id: 'u1', name: 'User', phoneNumber: '201012345678' }),
    };
    const mockOrchestrator = {
      run: jest.fn().mockRejectedValue(new Error('AI provider fatal timeout')),
    };

    const handler = new WhatsAppWebhookHandler(
      mockAdapter,
      mockWebhookRepo as any,
      mockOrchestrator as any,
      {} as any,
      {} as any,
      mockUserRepo as any,
      { attributeUserResponse: jest.fn().mockResolvedValue(null) } as any
    );

    const req: any = {
      headers: {},
      rawBody: '{}',
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.incoming.003',
                      from: '201012345678',
                      type: 'text',
                      text: { body: 'error query' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    const res: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    await handler.handleIncoming(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Emergency notice sent to user
    const emergencyNotice = dispatchedCalls.find((c) =>
      c.text?.body?.includes('حدث خطأ مؤقت في الاتصال')
    );
    expect(emergencyNotice).toBeDefined();
  });

  // =========================================================================
  // Scenario D: Multi-Step Agent & Interim Refresh
  // =========================================================================
  test('Scenario D: Interim progress refreshes typing and heartbeat clears upon completion', async () => {
    (config as any).whatsapp.phoneNumberId = '1234567890';
    (config as any).whatsapp.accessToken = 'prod_secret_token';

    let typingDispatches = 0;
    const dispatchedCalls: any[] = [];
    const mockFetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      const parsedBody = JSON.parse(opts.body);
      if (parsedBody.typing_indicator) {
        typingDispatches++;
      } else {
        dispatchedCalls.push(parsedBody);
      }
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.sent.004' }] }),
      };
    });
    global.fetch = mockFetch as any;

    const mockAdapter = new WhatsAppAdapter('1234567890', 'prod_secret_token');
    const mockWebhookRepo = {
      isEventProcessed: jest.fn().mockResolvedValue(false),
      markEventProcessed: jest.fn().mockResolvedValue(true),
    };
    const mockUserRepo = {
      findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({ id: 'u1', name: 'User', phoneNumber: '201012345678' }),
    };

    // Orchestrator simulates interim progress callback during multi-step tool run
    const mockOrchestrator = {
      run: jest.fn().mockImplementation(async (opts: any) => {
        if (opts.onInterimProgress) {
          await opts.onInterimProgress('جاري فحص حالة الطقس...');
        }
        return { status: 'completed', replyText: 'الطقس معتدل والساعة 5:30.' };
      }),
    };

    const handler = new WhatsAppWebhookHandler(
      mockAdapter,
      mockWebhookRepo as any,
      mockOrchestrator as any,
      {} as any,
      {} as any,
      mockUserRepo as any,
      { attributeUserResponse: jest.fn().mockResolvedValue(null) } as any
    );

    const req: any = {
      headers: {},
      rawBody: '{}',
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.incoming.004',
                      from: '201012345678',
                      type: 'text',
                      text: { body: 'الطقس في الإسكندرية وكم الساعة' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    const res: any = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    await handler.handleIncoming(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Initial typing + refresh after interim text
    expect(typingDispatches).toBeGreaterThanOrEqual(2);
    // Interim message sent
    expect(dispatchedCalls.find((c) => c.text?.body === 'جاري فحص حالة الطقس...')).toBeDefined();
    // Final reply sent
    expect(dispatchedCalls.find((c) => c.text?.body === 'الطقس معتدل والساعة 5:30.')).toBeDefined();
  });

  // =========================================================================
  // Scenario E: Production Credentials & Mock Isolation
  // =========================================================================
  test('Scenario E: In production mode, missing credentials returns false (no mock success return true)', async () => {
    (config as any).nodeEnv = 'production';
    (config as any).whatsapp.phoneNumberId = undefined;
    (config as any).whatsapp.accessToken = undefined;

    const mockFetch = jest.fn();
    global.fetch = mockFetch as any;

    const adapter = new WhatsAppAdapter(); // No constructor args, env is undefined
    const result = await adapter.sendTypingIndicator('wamid.test.005');

    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('Scenario E: In production mode with valid credentials, calls Meta Graph API with Bearer token', async () => {
    (config as any).nodeEnv = 'production';
    (config as any).whatsapp.phoneNumberId = 'prod_phone_999';
    (config as any).whatsapp.accessToken = 'prod_token_xyz';

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch as any;

    const adapter = new WhatsAppAdapter();
    const result = await adapter.sendTypingIndicator('wamid.test.006');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v22.0/prod_phone_999/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer prod_token_xyz',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: 'wamid.test.006',
          typing_indicator: {
            type: 'text',
          },
        }),
      })
    );
  });
});
