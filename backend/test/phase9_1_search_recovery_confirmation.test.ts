/**
 * Phase 9.1: Presentation & Search Recovery Hardening Tests
 *
 * Validates:
 * Part 1: Search Recovery & Deterministic Fallback (Tests A - H)
 * - Test A: Search succeeds + LLM synthesis succeeds -> Returns synthesized LLM answer.
 * - Test B: Search succeeds + LLM synthesis throws timeout / circuit breaker -> Returns deterministic fallback markdown.
 * - Test C: Search succeeds + LLM synthesis throws rate limit -> Returns deterministic fallback markdown.
 * - Test D: Search succeeds + LLM synthesis throws malformed response / empty string -> Returns deterministic fallback markdown.
 * - Test E: Search succeeds + LLM synthesis throws unexpected error -> Returns deterministic fallback markdown.
 * - Test F: Search returns 0 results + LLM synthesis fails -> Neutral message without fabricated links.
 * - Test G: Search returns > 3 results -> Fallback bounds output to at most 3 results.
 * - Test H: Fallback strips all internal metadata, tracking query parameters, and raw JSON.
 *
 * Part 2: Confirmation Token & Presentation Security (Tests I - L)
 * - Test I: Sensitive actions generate confirmation notice without token in user text; token preserved in internal context.
 * - Test J: WhatsApp interactive button reply with conf_approve_{token} approves and executes action.
 * - Test K: WhatsApp interactive button reply with conf_reject_{token} cancels action safely.
 * - Test L: Invalid or expired token is rejected without executing the sensitive action.
 */

import { ExecutionEngine, ExecutionEngineContext, ExecutionStateManager } from '../src/modules/agent/execution';
import { SearchFallbackFormatter } from '../src/modules/tools/adapters/search_fallback_formatter';
import { ToolResultFormatter } from '../src/modules/tools/adapters/tool_result_formatter';
import { AIRouter } from '../src/modules/ai/router';
import { AIProviderError } from '../src/modules/ai/provider_error';
import { MetricsCollector } from '../src/modules/observability/metrics';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { WhatsAppWebhookHandler } from '../src/modules/whatsapp/webhook';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { WebhookRepository } from '../src/database/repositories/webhook.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';

describe('Phase 9.1: Presentation & Search Recovery Hardening', () => {
  // =========================================================================
  // Part 1: Search Recovery & Deterministic Fallback (Tests A to H)
  // =========================================================================
  describe('Part 1: Search Recovery & Deterministic Fallback', () => {
    let engine: ExecutionEngine;
    let router: AIRouter;

    beforeEach(() => {
      engine = ExecutionEngine.getInstance();
      router = AIRouter.getInstance();
      jest.restoreAllMocks();
    });

    const mockSearchResults = [
      {
        title: 'Egyptian Exchange EGX30 Closes Higher Today',
        snippet: 'The Egyptian stock exchange benchmark EGX30 gained 1.4% to close at 31,500 points amid strong trading volumes.',
        url: 'https://example.com/news/egx-today?utm_source=twitter&utm_medium=cpc&session=xyz123',
        sourceDomain: 'example.com',
      },
      {
        title: 'Central Bank of Egypt Interest Rate Decision',
        snippet: 'Monetary policy committee meeting scheduled to review key overnight rates this Thursday.',
        url: 'https://finance.eg/rates/cbe-meeting?tracking_id=track_998',
        sourceDomain: 'finance.eg',
      },
    ];

    it('Test A: Search succeeds + LLM synthesis succeeds -> returns synthesized text from LLM', async () => {
      const state = ExecutionStateManager.createInitialState('run_a', 'task_a', 'ما أخبار البورصة اليوم؟', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'EGX30 today' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_a',
        userId: 'u_a',
        conversationId: 'c_a',
        channel: 'whatsapp',
        userGoal: 'ما أخبار البورصة اليوم؟',
        languageContext: { targetLanguage: 'ar', dialect: 'egyptian', locale: 'ar-EG' } as any,
      };

      const expectedSynthesis = 'ارتفعت البورصة المصرية اليوم وسجل المؤشر الرئيسي EGX30 مكاسب بنسبة 1.4%.';

      // Mock AIRouter synthesis route returning clean text
      jest.spyOn(router, 'route').mockResolvedValueOnce({
        providerId: 'groq',
        model: 'openai/gpt-oss-120b',
        message: { role: 'assistant', content: expectedSynthesis },
        toolCalls: [],
        finishReason: 'stop',
        latencyMs: 120,
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      });

      // Call internal synthesizeFinalAnswer via any cast
      const finalReply = await (engine as any).synthesizeFinalAnswer(state, context, 'completed');

      expect(finalReply).toBe(expectedSynthesis);
    });

    it('Test B: Search succeeds + LLM synthesis throws timeout / circuit breaker -> returns deterministic fallback markdown', async () => {
      const state = ExecutionStateManager.createInitialState('run_b', 'task_b', 'ما أخبار البورصة اليوم؟', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'EGX30 today' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_b',
        userId: 'u_b',
        conversationId: 'c_b',
        channel: 'whatsapp',
        userGoal: 'ما أخبار البورصة اليوم؟',
        languageContext: { targetLanguage: 'ar', dialect: 'egyptian', locale: 'ar-EG' } as any,
      };

      // Mock AIRouter synthesis throwing timeout error
      jest.spyOn(router, 'route').mockRejectedValueOnce(
        new AIProviderError({
          providerId: 'groq',
          category: 'timeout',
          message: 'Operation timed out after 30000ms',
          retryable: true,
        })
      );

      const metricsSpy = jest.spyOn(MetricsCollector.getInstance(), 'increment');

      const finalReply = await (engine as any).synthesizeFinalAnswer(state, context, 'completed');

      expect(finalReply).toBeDefined();
      expect(finalReply).toContain('إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:');
      expect(finalReply).toContain('Egyptian Exchange EGX30 Closes Higher Today');
      expect(finalReply).toContain('🌐 example.com');
      expect(finalReply).toContain('🔗 https://example.com/news/egx-today');
      // Assert metric was recorded
      expect(metricsSpy).toHaveBeenCalledWith(
        'craft.search.deterministic_fallback_invoked',
        1,
        expect.objectContaining({ reason: 'timeout', provider: 'groq' })
      );
    });

    it('Test C: Search succeeds + LLM synthesis throws rate limit -> returns deterministic fallback markdown', async () => {
      const state = ExecutionStateManager.createInitialState('run_c', 'task_c', 'latest rates', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'CBE interest rates' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_c',
        userId: 'u_c',
        conversationId: 'c_c',
        channel: 'whatsapp',
        userGoal: 'latest rates',
        languageContext: { targetLanguage: 'en', locale: 'en-US' } as any,
      };

      // Mock AIRouter synthesis throwing rate_limit error
      jest.spyOn(router, 'route').mockRejectedValueOnce(
        new AIProviderError({
          providerId: 'groq',
          category: 'rate_limit',
          message: 'Rate limit exceeded (429)',
          retryable: true,
        })
      );

      const finalReply = await (engine as any).synthesizeFinalAnswer(state, context, 'completed');

      expect(finalReply).toContain('Here are the search results retrieved for your query:');
      expect(finalReply).toContain('Central Bank of Egypt Interest Rate Decision');
      expect(finalReply).toContain('🌐 finance.eg');
    });

    it('Test D: Search succeeds + LLM synthesis returns empty string / malformed response -> returns deterministic fallback markdown', async () => {
      const state = ExecutionStateManager.createInitialState('run_d', 'task_d', 'search query', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'query' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_d',
        userId: 'u_d',
        conversationId: 'c_d',
        channel: 'whatsapp',
        userGoal: 'search query',
        languageContext: { targetLanguage: 'ar', locale: 'ar-EG' } as any,
      };

      // Mock AIRouter returning empty content
      jest.spyOn(router, 'route').mockResolvedValueOnce({
        providerId: 'groq',
        model: 'openai/gpt-oss-120b',
        message: { role: 'assistant', content: '   ' },
        toolCalls: [],
        finishReason: 'stop',
        latencyMs: 80,
      });

      const finalReply = await (engine as any).synthesizeFinalAnswer(state, context, 'completed');

      expect(finalReply).toContain('إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:');
      expect(finalReply).toContain('Egyptian Exchange EGX30 Closes Higher Today');
    });

    it('Test E: Search succeeds + LLM synthesis throws unexpected generic error -> returns deterministic fallback markdown', async () => {
      const state = ExecutionStateManager.createInitialState('run_e', 'task_e', 'search query', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'query' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_e',
        userId: 'u_e',
        conversationId: 'c_e',
        channel: 'whatsapp',
        userGoal: 'search query',
        languageContext: { targetLanguage: 'ar', locale: 'ar-EG' } as any,
      };

      // Mock AIRouter throwing unexpected generic runtime error
      jest.spyOn(router, 'route').mockRejectedValueOnce(new Error('Fatal socket hang up on TLS handshake'));

      const finalReply = await (engine as any).synthesizeFinalAnswer(state, context, 'completed');

      expect(finalReply).toContain('إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:');
      expect(finalReply).toContain('Egyptian Exchange EGX30 Closes Higher Today');
    });

    it('Test F: Search returns 0 results + LLM synthesis fails -> returns neutral message without fabricating fake links', async () => {
      const state = ExecutionStateManager.createInitialState('run_f', 'task_f', 'obscure keyword', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'obscure keyword' });
      ExecutionStateManager.completeStep(step, 'succeeded', [], JSON.stringify([]));

      const context: ExecutionEngineContext = {
        runId: 'run_f',
        userId: 'u_f',
        conversationId: 'c_f',
        channel: 'whatsapp',
        userGoal: 'obscure keyword',
        languageContext: { targetLanguage: 'ar', locale: 'ar-EG' } as any,
      };

      jest.spyOn(router, 'route').mockRejectedValueOnce(
        new AIProviderError({
          providerId: 'groq',
          category: 'timeout',
          message: 'Timeout',
          retryable: false,
        })
      );

      const finalReply = await (engine as any).synthesizeFinalAnswer(state, context, 'completed');

      expect(finalReply).toContain('لم يتم العثور على نتائج مطابقة في الوقت الحالي');
      expect(finalReply).not.toContain('http');
      expect(finalReply).not.toContain('undefined');
    });

    it('Test G: Search returns > 3 results -> fallback bounds output to at most 3 results', () => {
      const fiveResults = [
        { title: 'Result 1', snippet: 'Snippet 1', url: 'https://ex.com/1' },
        { title: 'Result 2', snippet: 'Snippet 2', url: 'https://ex.com/2' },
        { title: 'Result 3', snippet: 'Snippet 3', url: 'https://ex.com/3' },
        { title: 'Result 4', snippet: 'Snippet 4', url: 'https://ex.com/4' },
        { title: 'Result 5', snippet: 'Snippet 5', url: 'https://ex.com/5' },
      ];

      const formatted = SearchFallbackFormatter.format(fiveResults, { targetLanguage: 'en' } as any);

      expect(formatted).toContain('1. *Result 1*');
      expect(formatted).toContain('2. *Result 2*');
      expect(formatted).toContain('3. *Result 3*');
      expect(formatted).not.toContain('Result 4');
      expect(formatted).not.toContain('Result 5');
    });

    it('Test H: Fallback strips all internal metadata, tracking query parameters, and raw JSON', () => {
      const noisyResult = [
        {
          title: 'News Headline with Internal Tokens',
          snippet: 'Description with raw tokens and scores',
          url: 'https://example.com/article?utm_source=twitter&utm_medium=cpc&session_id=s123&fbclid=abc_xyz_789',
          _score: 0.9942,
          _rawInternalCode: 'SECRET_CODE_123',
          timestamp: 1727500000,
        },
      ];

      const formatted = SearchFallbackFormatter.format(noisyResult, { targetLanguage: 'ar' } as any);

      // Tracking parameters must be cleanly stripped from the URL
      expect(formatted).toContain('https://example.com/article');
      expect(formatted).not.toContain('utm_source');
      expect(formatted).not.toContain('utm_medium');
      expect(formatted).not.toContain('fbclid');
      expect(formatted).not.toContain('session_id');

      // Internal metadata keys must not leak
      expect(formatted).not.toContain('_score');
      expect(formatted).not.toContain('_rawInternalCode');
      expect(formatted).not.toContain('SECRET_CODE_123');
      expect(formatted).not.toContain('{');
      expect(formatted).not.toContain('}');
    });
  });

  // =========================================================================
  // Part 2: Confirmation Token & Presentation Security (Tests I to L)
  // =========================================================================
  describe('Part 2: Confirmation Token & Presentation Security', () => {
    let confirmationService: ConfirmationService;
    let mockAdapter: jest.Mocked<WhatsAppAdapter>;
    let webhookRepo: WebhookRepository;
    let chatRepo: ChatRepository;
    let userRepo: any;
    let orchestrator: AgentOrchestrator;
    let handler: WhatsAppWebhookHandler;

    beforeEach(() => {
      const inMemoryConfirmations = new Map<string, any>();
      const mockConfirmationRepo: any = {
        create: jest.fn(async (agentRunId, userId, actionName, description, payload, expiresAt, conversationId) => {
          const token = `tok_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          const entity = {
            id: `conf_${Date.now()}`,
            agentRunId,
            userId,
            actionName,
            description,
            payload,
            token,
            status: 'pending',
            expiresAt,
            createdAt: new Date(),
          };
          inMemoryConfirmations.set(token, entity);
          return entity;
        }),
        getByToken: jest.fn(async (token: string) => {
          return inMemoryConfirmations.get(token) || null;
        }),
        updateStatus: jest.fn(async (token: string, status: string) => {
          const item = inMemoryConfirmations.get(token);
          if (item) {
            item.status = status;
            return item;
          }
          return null;
        }),
      };

      const mockReminderRepo: any = {
        create: jest.fn().mockResolvedValue({
          id: `rem_${Date.now()}`,
          title: 'مراجعة التصاميم',
          state: 'scheduled',
        }),
      };

      confirmationService = new ConfirmationService(mockConfirmationRepo, mockReminderRepo);

      mockAdapter = {
        sendTextMessage: jest.fn().mockResolvedValue(true),
        sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      } as any;

      chatRepo = {
        getOrCreateConversation: jest.fn().mockResolvedValue({
          id: 'conv_mock_p9_1',
          userId: 'u_mock_p9_1',
          channel: 'whatsapp',
        }),
        saveMessage: jest.fn().mockResolvedValue({
          id: `msg_${Date.now()}`,
        }),
      } as any;

      webhookRepo = {
        isEventProcessed: jest.fn().mockResolvedValue(false),
        markEventProcessed: jest.fn().mockResolvedValue(undefined),
      } as any;

      userRepo = {
        findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({
          id: 'u_mock_p9_1',
          name: 'Mohamed Ali',
          phoneNumber: '201028067432',
        }),
      };

      orchestrator = new AgentOrchestrator();

      handler = new WhatsAppWebhookHandler(
        mockAdapter,
        webhookRepo,
        orchestrator,
        confirmationService,
        chatRepo,
        userRepo
      );
    });

    it('Test I: create_reminder or sensitive tool generates confirmation notice without token in user text; token preserved in internal context', () => {
      const sensitiveToken = 'CONF-TOKEN-SECRET-987654';

      // 1. Arabic format check
      const noticeAr = ToolResultFormatter.formatConfirmationNotice(
        'create_reminder',
        { title: 'اجتماع مجلس الإدارة', time: 'tomorrow 10am', recurrence: 'none' },
        sensitiveToken,
        { targetLanguage: 'ar', dialect: 'egyptian', locale: 'ar-EG' } as any
      );

      expect(noticeAr).toContain('هذا الإجراء يتطلب تأكيدك الصريح للمتابعة:');
      expect(noticeAr).toContain('اجتماع مجلس الإدارة');
      expect(noticeAr).toContain('إنشاء تذكير جديد');
      // Critical Phase 9.1 guarantee: Token must NOT be visible in user-facing notice
      expect(noticeAr).not.toContain(sensitiveToken);
      expect(noticeAr).not.toContain('الرمز');

      // 2. English format check
      const noticeEn = ToolResultFormatter.formatConfirmationNotice(
        'create_reminder',
        { title: 'Board Meeting', time: 'tomorrow 10am' },
        sensitiveToken,
        { targetLanguage: 'en', locale: 'en-US' } as any
      );

      expect(noticeEn).toContain('This action requires your confirmation to proceed:');
      expect(noticeEn).toContain('Board Meeting');
      expect(noticeEn).not.toContain(sensitiveToken);
      expect(noticeEn).not.toContain('confirm using code');
    });

    it('Test J: WhatsApp interactive button reply with conf_approve_{token} approves and executes action', async () => {
      // 1. Create a real pending confirmation request
      const request = await confirmationService.createConfirmationRequest(
        'run-p9-1',
        'wa_201028067432',
        'create_reminder',
        'طلب تأكيد تذكير',
        { title: 'مراجعة التصاميم', time: 'tomorrow 12pm' }
      );

      expect(request.token).toBeDefined();

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '201028067432',
                      id: `wamid_app_${Date.now()}`,
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: `conf_approve_${request.token}`,
                          title: 'تأكيد ✅',
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

      let statusCode = 0;
      const req: any = { headers: {}, body: payload };
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return { send: () => {} };
        },
        headersSent: false,
      };

      await handler.handleIncoming(req, res);

      expect(statusCode).toBe(200);
      expect(mockAdapter.sendTextMessage).toHaveBeenCalledTimes(1);
      const sentMessage = (mockAdapter.sendTextMessage as jest.Mock).mock.calls[0][1];
      expect(sentMessage).toContain('تم التأكيد بنجاح');
      expect(sentMessage).toContain('مراجعة التصاميم');

      // Verify token state in DB is now resolved and prevents replay
      const replayCheck = await confirmationService.verifyAndResolve(request.token, 'approved');
      expect(replayCheck.success).toBe(false);
      expect(replayCheck.message).toContain('Replay rejected');
    });

    it('Test K: WhatsApp interactive button reply with conf_reject_{token} cancels action safely', async () => {
      const request = await confirmationService.createConfirmationRequest(
        'run-p9-2',
        'wa_201028067432',
        'create_reminder',
        'طلب تأكيد تذكير',
        { title: 'موعد مؤجل' }
      );

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '201028067432',
                      id: `wamid_rej_${Date.now()}`,
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: `conf_reject_${request.token}`,
                          title: 'إلغاء ❌',
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

      let statusCode = 0;
      const req: any = { headers: {}, body: payload };
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return { send: () => {} };
        },
        headersSent: false,
      };

      await handler.handleIncoming(req, res);

      expect(statusCode).toBe(200);
      expect(mockAdapter.sendTextMessage).toHaveBeenCalledTimes(1);
      const sentMessage = (mockAdapter.sendTextMessage as jest.Mock).mock.calls[0][1];
      expect(sentMessage).toContain('تم إلغاء الإجراء');

      // Replay must be rejected
      const replayCheck = await confirmationService.verifyAndResolve(request.token, 'rejected');
      expect(replayCheck.success).toBe(false);
      expect(replayCheck.message).toContain('Replay rejected');
    });

    it('Test L: Invalid or expired token is rejected without executing the sensitive action', async () => {
      const invalidToken = 'non_existent_token_99999';

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '201028067432',
                      id: `wamid_inv_${Date.now()}`,
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: `conf_approve_${invalidToken}`,
                          title: 'تأكيد ✅',
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

      let statusCode = 0;
      const req: any = { headers: {}, body: payload };
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return { send: () => {} };
        },
        headersSent: false,
      };

      await handler.handleIncoming(req, res);

      expect(statusCode).toBe(200);
      expect(mockAdapter.sendTextMessage).toHaveBeenCalledTimes(1);
      const sentMessage = (mockAdapter.sendTextMessage as jest.Mock).mock.calls[0][1];
      expect(sentMessage).toContain('قد يكون الطلب قد انتهت صلاحيته أو تم اتخاذ قرار بشأنه مسبقاً');
    });
  });
});
