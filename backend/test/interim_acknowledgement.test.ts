import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { ToolRegistry } from '../src/modules/tools/registry';
import { WhatsAppWebhookHandler } from '../src/modules/whatsapp/webhook';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { config } from '../src/config/env';

describe('Fast Intelligent Contextual Interim Acknowledgements', () => {
  let groqProvider: GroqProvider;
  let orchestrator: AgentOrchestrator;

  beforeAll(() => {
    config.groq.isMockMode = true;
    process.env.GROQ_MOCK_MODE = 'true';
    groqProvider = new GroqProvider();
    orchestrator = new AgentOrchestrator();
  });

  describe('GroqProvider.generateInterimAcknowledgement', () => {
    it('returns null for empty or whitespace prompts', async () => {
      const res = await groqProvider.generateInterimAcknowledgement('');
      expect(res).toBeNull();
    });

    it('returns null for simple greetings or casual queries without search intent', async () => {
      const res = await groqProvider.generateInterimAcknowledgement('صباح الخير يا كرافت عامل ايه');
      expect(res).toBeNull();
    });

    it('returns contextual price check acknowledgment for price queries', async () => {
      const res = await groqProvider.generateInterimAcknowledgement('سعر الدولار والذهب النهاردة كام في السوق؟');
      expect(res).not.toBeNull();
      expect(res).toContain('الأسعار');
    });

    it('returns contextual website acknowledgment for sites search queries', async () => {
      const res = await groqProvider.generateInterimAcknowledgement('هل فيه موقع بيخليني اجرب الموديل مجانا؟');
      expect(res).not.toBeNull();
      expect(res).toContain('المواقع');
    });

    it('returns general web search acknowledgment for research queries', async () => {
      const res = await groqProvider.generateInterimAcknowledgement('ابحث عن أحدث مواصفات آيفون 17 برو');
      expect(res).not.toBeNull();
      expect(res).toContain('البحث');
    });
  });

  describe('AgentOrchestrator Media Interim Dispatch', () => {
    it('immediately dispatches interim message when an image attachment is provided', async () => {
      const interimMessages: string[] = [];
      const imageBuffer = Buffer.from('fake_image_bytes');

      const result = await orchestrator.run({
        userId: 'interim_test_user_img',
        channel: 'whatsapp',
        text: 'شوف الصورة دي كده',
        media: {
          buffer: imageBuffer,
          mimeType: 'image/jpeg',
          filename: 'photo.jpg',
        },
        onInterimProgress: async (msg) => {
          interimMessages.push(msg);
        },
      });

      expect(result.status).toBe('completed');
      expect(interimMessages.length).toBe(1);
      expect(interimMessages[0]).toContain('الصورة');
    });

    it('immediately dispatches interim message when a voice note is provided', async () => {
      const interimMessages: string[] = [];
      const audioBuffer = Buffer.from('fake_audio_bytes');

      const result = await orchestrator.run({
        userId: 'interim_test_user_audio',
        channel: 'whatsapp',
        text: '',
        media: {
          buffer: audioBuffer,
          mimeType: 'audio/ogg',
          filename: 'voice.ogg',
        },
        onInterimProgress: async (msg) => {
          interimMessages.push(msg);
        },
      });

      expect(result.status).toBe('completed');
      expect(interimMessages.length).toBe(1);
      expect(interimMessages[0]).toContain('التسجيل الصوتي');
    });

    it('immediately dispatches interim message when a document/code file is provided', async () => {
      const interimMessages: string[] = [];
      const docBuffer = Buffer.from('void main() { print("hello"); }');

      const result = await orchestrator.run({
        userId: 'interim_test_user_doc',
        channel: 'whatsapp',
        text: 'لخصلي الملف ده',
        media: {
          buffer: docBuffer,
          mimeType: 'text/plain',
          filename: 'main.dart',
        },
        onInterimProgress: async (msg) => {
          interimMessages.push(msg);
        },
      });

      expect(result.status).toBe('completed');
      expect(interimMessages.length).toBe(1);
      expect(interimMessages[0]).toContain('الملف');
    });

    it('does not send duplicate interim messages in the same run', async () => {
      const interimMessages: string[] = [];
      const imageBuffer = Buffer.from('fake_image_bytes');

      const result = await orchestrator.run({
        userId: 'interim_test_user_dedup',
        channel: 'whatsapp',
        text: 'ابحث عن الصورة دي في المواقع',
        media: {
          buffer: imageBuffer,
          mimeType: 'image/png',
          filename: 'diagram.png',
        },
        onInterimProgress: async (msg) => {
          interimMessages.push(msg);
        },
      });

      expect(result.status).toBe('completed');
      // Should only dispatch the initial image interim message, not duplicates
      expect(interimMessages.length).toBe(1);
    });
  });

  describe('WhatsAppWebhookHandler Integration', () => {
    it('dispatches interim progress message through WhatsApp adapter on image webhook', async () => {
      const sentMessages: Array<{ to: string; text: string }> = [];
      const mockWhatsAppAdapter: Partial<WhatsAppAdapter> = {
        sendTypingIndicator: jest.fn().mockResolvedValue(true),
        sendTextMessage: jest.fn().mockImplementation(async (to: string, text: string) => {
          sentMessages.push({ to, text });
          return { messaging_product: 'whatsapp', messages: [{ id: 'wa_msg_123' }] };
        }),
        downloadMedia: jest.fn().mockResolvedValue({
          buffer: Buffer.from('mock_image_bytes'),
          mimeType: 'image/jpeg',
        }),
      };

      const webhookHandler = new WhatsAppWebhookHandler(
        mockWhatsAppAdapter as WhatsAppAdapter,
        undefined as any,
        orchestrator,
        new ConfirmationService(),
        new ChatRepository()
      );

      const fakeReq: any = {
        body: {
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        id: `wamid.interim_img_${Date.now()}`,
                        from: '201028067432',
                        timestamp: '1742000000',
                        type: 'image',
                        image: {
                          id: 'media_id_test_999',
                          mime_type: 'image/jpeg',
                          caption: 'ايه المشكلة في الشاشة دي؟',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        headers: {},
      };

      const fakeRes: any = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await webhookHandler.handleIncoming(fakeReq, fakeRes);

      expect(fakeRes.status).toHaveBeenCalledWith(200);
      // Both interim acknowledgement AND final answer should be sent via sendTextMessage
      expect(sentMessages.length).toBeGreaterThanOrEqual(2);
      // The first message sent must be the fast interim message
      expect(sentMessages[0].text).toContain('الصورة');
      expect(sentMessages[0].to).toBe('201028067432');
    });
  });
});
