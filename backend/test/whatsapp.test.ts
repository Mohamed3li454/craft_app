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
    const eventId = 'wamid.HBgLMjAxMDI4MDY3NDMyFQIAEhgg...';
    expect(await repo.isEventProcessed(eventId)).toBe(false);

    await repo.markEventProcessed(eventId);
    expect(await repo.isEventProcessed(eventId)).toBe(true);
  });
});
