import { WhatsAppWebhookHandler } from '../src/modules/whatsapp/webhook';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { WebhookRepository } from '../src/database/repositories/webhook.repo';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { ChatRepository } from '../src/database/repositories/chat.repo';

describe('WhatsApp Interactive Buttons & Confirmation Webhook', () => {
  let handler: WhatsAppWebhookHandler;
  let mockAdapter: jest.Mocked<WhatsAppAdapter>;
  let confirmationService: ConfirmationService;
  let chatRepo: ChatRepository;
  let orchestrator: AgentOrchestrator;
  let webhookRepo: WebhookRepository;

  beforeEach(() => {
    mockAdapter = {
      sendTextMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    } as any;

    confirmationService = new ConfirmationService();
    chatRepo = new ChatRepository();
    webhookRepo = new WebhookRepository();
    orchestrator = new AgentOrchestrator();

    handler = new WhatsAppWebhookHandler(
      mockAdapter,
      webhookRepo,
      orchestrator,
      confirmationService,
      chatRepo
    );
  });

  test('processes approve button reply and confirms action', async () => {
    // 1. Create a real pending confirmation request
    const request = await confirmationService.createConfirmationRequest(
      'run-int-1',
      'wa_201028067432',
      'create_reminder',
      'طلب تأكيد تذكير',
      { title: 'اجتماع هام', time: 'tomorrow 10am' }
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
                    id: `wamid_test_${Date.now()}`,
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
    const req: any = {
      headers: {},
      body: payload,
    };
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          send: () => {},
        };
      },
      headersSent: false,
    };

    await handler.handleIncoming(req, res);

    expect(statusCode).toBe(200);
    expect(mockAdapter.sendTextMessage).toHaveBeenCalledTimes(1);
    const sentMessage = (mockAdapter.sendTextMessage as jest.Mock).mock.calls[0][1];
    expect(sentMessage).toContain('تم التأكيد بنجاح');
    expect(sentMessage).toContain('اجتماع هام');

    // Verify token is now approved in database
    const resolvedCheck = await confirmationService.verifyAndResolve(request.token, 'approved');
    expect(resolvedCheck.success).toBe(false); // Replay rejected
    expect(resolvedCheck.message).toContain('Replay rejected');
  });

  test('processes reject button reply and cancels action', async () => {
    const request = await confirmationService.createConfirmationRequest(
      'run-int-2',
      'wa_201028067432',
      'create_reminder',
      'طلب تأكيد تذكير',
      { title: 'موعد ملغي' }
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
                    id: `wamid_reject_${Date.now()}`,
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
    const req: any = {
      headers: {},
      body: payload,
    };
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
  });

  test('dispatches interactive quick-reply buttons when sensitive tool requires confirmation', async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '201028067432',
                    id: `wamid_prompt_${Date.now()}`,
                    type: 'text',
                    text: {
                      body: 'فكرني بكرة بميعاد الدكتور',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const req: any = {
      headers: {},
      body: payload,
    };
    const res: any = {
      status: () => ({ send: () => {} }),
      headersSent: false,
    };

    await handler.handleIncoming(req, res);

    // Should call sendInteractiveButtons with Approve & Reject buttons
    expect(mockAdapter.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const buttonsArg = (mockAdapter.sendInteractiveButtons as jest.Mock).mock.calls[0][2];
    expect(buttonsArg.length).toBe(2);
    expect(buttonsArg[0].id).toContain('conf_approve_');
    expect(buttonsArg[0].title).toBe('تأكيد ✅');
    expect(buttonsArg[1].id).toContain('conf_reject_');
    expect(buttonsArg[1].title).toBe('إلغاء ❌');
  });
});
