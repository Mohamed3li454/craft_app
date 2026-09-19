import {
  processMediaAttachment,
  formatConversationHistory,
  AgentOrchestrator,
} from '../src/modules/agent/orchestrator';
import { WhatsAppWebhookHandler } from '../src/modules/whatsapp/webhook';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { WebhookRepository } from '../src/database/repositories/webhook.repo';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { ChatRepository } from '../src/database/repositories/chat.repo';

describe('Multimodal Vision & File Processing', () => {
  describe('processMediaAttachment', () => {
    test('converts image buffer into Gemini inlineData part with default Arabic prompt', async () => {
      const buffer = Buffer.from('fake-image-bytes');
      const result = await processMediaAttachment('', {
        buffer,
        mimeType: 'image/jpeg',
      });

      expect(result.mediaPart).toBeDefined();
      expect(result.mediaPart?.inlineData?.mimeType).toBe('image/jpeg');
      expect(result.mediaPart?.inlineData?.data).toBe(buffer.toString('base64'));
      expect(result.effectivePrompt).toContain('حلل هذه الصورة المرفقة');
      expect(result.historyRecordText).toBe('[صورة مرفقة]');
    });

    test('preserves user caption when image is provided', async () => {
      const buffer = Buffer.from('fake-image-png');
      const result = await processMediaAttachment('ايه رأيك في المنظر ده يا كرافت؟', {
        buffer,
        mimeType: 'image/png',
        filename: 'sea.png',
      });

      expect(result.mediaPart?.inlineData?.mimeType).toBe('image/png');
      expect(result.effectivePrompt).toContain('ايه رأيك في المنظر ده يا كرافت؟');
      expect(result.historyRecordText).toContain('ايه رأيك في المنظر ده يا كرافت؟');
    });

    test('converts audio/voice note buffer into Gemini inlineData part with cleaned mimeType', async () => {
      const buffer = Buffer.from('fake-ogg-opus-audio');
      const result = await processMediaAttachment('', {
        buffer,
        mimeType: 'audio/ogg; codecs=opus',
      });

      expect(result.mediaPart).toBeDefined();
      expect(result.mediaPart?.inlineData?.mimeType).toBe('audio/ogg');
      expect(result.mediaPart?.inlineData?.data).toBe(buffer.toString('base64'));
      expect(result.effectivePrompt).toContain('استمع إلى هذا التسجيل الصوتي');
      expect(result.historyRecordText).toBe('[تسجيل صوتي من المستخدم]');
    });

    test('converts PDF buffer into Gemini inlineData part', async () => {
      const buffer = Buffer.from('%PDF-1.4-fake-pdf');
      const result = await processMediaAttachment('', {
        buffer,
        mimeType: 'application/pdf',
        filename: 'summary.pdf',
      });

      expect(result.mediaPart?.inlineData?.mimeType).toBe('application/pdf');
      expect(result.effectivePrompt).toContain('اقرأ هذا المستند المرفق بصيغة PDF');
      expect(result.historyRecordText).toContain('summary.pdf');
    });

    test('formats Dart code file into markdown code block with language identifier', async () => {
      const dartCode = 'void main() { runApp(const MyApp()); }';
      const buffer = Buffer.from(dartCode, 'utf-8');
      const result = await processMediaAttachment('شوف الكود ده', {
        buffer,
        mimeType: 'text/plain',
        filename: 'main.dart',
      });

      expect(result.mediaPart).toBeUndefined();
      expect(result.effectivePrompt).toContain('```dart');
      expect(result.effectivePrompt).toContain(dartCode);
      expect(result.effectivePrompt).toContain('شوف الكود ده');
      expect(result.historyRecordText).toContain('main.dart');
    });

    test('formats docx file gracefully and embeds into prompt', async () => {
      const buffer = Buffer.from('invalid-docx-raw-bytes');
      const result = await processMediaAttachment('', {
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'report.docx',
      });

      expect(result.effectivePrompt).toContain('report.docx');
      expect(result.effectivePrompt).toContain('```text');
      expect(result.historyRecordText).toContain('report.docx');
    });
  });

  describe('formatConversationHistory with Multimodal Part', () => {
    test('attaches mediaPart to the latest user turn in Gemini conversation', () => {
      const mediaPart = {
        inlineData: {
          data: 'base64data',
          mimeType: 'image/jpeg',
        },
      };

      const contents = formatConversationHistory(
        [{ id: '1', conversationId: 'c1', senderRole: 'user', senderName: 'User', text: 'مرحبا', createdAt: new Date() }],
        'حلل الصورة المرفقة',
        mediaPart
      );

      const lastTurn = contents[contents.length - 1];
      expect(lastTurn.role).toBe('user');
      expect(lastTurn.parts.length).toBe(2);
      expect(lastTurn.parts[0]).toEqual(mediaPart);
      expect((lastTurn.parts[1] as any).text).toBe('حلل الصورة المرفقة');
    });
  });

  describe('AgentOrchestrator Multimodal Execution', () => {
    let orchestrator: AgentOrchestrator;

    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    test('successfully processes image attachment run', async () => {
      const output = await orchestrator.run({
        userId: 'test_media_user',
        channel: 'whatsapp',
        text: '',
        media: {
          buffer: Buffer.from('test-image-data'),
          mimeType: 'image/jpeg',
        },
      });

      expect(output.status).toBe('completed');
      expect(output.replyText).toBeDefined();
      expect(output.replyText.length).toBeGreaterThan(0);
    });

    test('successfully processes Dart file attachment run', async () => {
      const output = await orchestrator.run({
        userId: 'test_code_user',
        channel: 'whatsapp',
        text: 'افحص هذا الكود',
        media: {
          buffer: Buffer.from('class User { final String name; User(this.name); }'),
          mimeType: 'text/plain',
          filename: 'user.dart',
        },
      });

      expect(output.status).toBe('completed');
      expect(output.replyText).toBeDefined();
    });

    test('successfully processes audio/voice note attachment run', async () => {
      const output = await orchestrator.run({
        userId: 'test_audio_user',
        channel: 'whatsapp',
        text: '',
        media: {
          buffer: Buffer.from('test-audio-data'),
          mimeType: 'audio/ogg',
        },
      });

      expect(output.status).toBe('completed');
      expect(output.replyText).toBeDefined();
      expect(output.replyText).toContain('تسجيلك الصوتي');
    });
  });

  describe('WhatsApp Webhook Media Handler', () => {
    let handler: WhatsAppWebhookHandler;
    let mockAdapter: jest.Mocked<WhatsAppAdapter>;

    beforeEach(() => {
      mockAdapter = {
        sendTextMessage: jest.fn().mockResolvedValue(true),
        sendInteractiveButtons: jest.fn().mockResolvedValue(true),
        downloadMedia: jest.fn().mockImplementation(async (mediaId: string) => {
          if (mediaId === 'img_123') {
            return {
              buffer: Buffer.from('img-bytes'),
              mimeType: 'image/jpeg',
            };
          }
          if (mediaId === 'doc_456') {
            return {
              buffer: Buffer.from('void main() {}'),
              mimeType: 'text/plain',
            };
          }
          if (mediaId === 'aud_789') {
            return {
              buffer: Buffer.from('voice-note-bytes'),
              mimeType: 'audio/ogg',
            };
          }
          return null;
        }),
      } as any;

      handler = new WhatsAppWebhookHandler(
        mockAdapter,
        new WebhookRepository(),
        new AgentOrchestrator(),
        new ConfirmationService(),
        new ChatRepository()
      );
    });

    test('handles image message webhook, downloads image, and sends reply', async () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '201028067432',
                      id: `wamid_img_${Date.now()}`,
                      type: 'image',
                      image: {
                        id: 'img_123',
                        mime_type: 'image/jpeg',
                        caption: 'صورة بحر',
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
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await handler.handleIncoming(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAdapter.downloadMedia).toHaveBeenCalledWith('img_123');
      expect(mockAdapter.sendTextMessage).toHaveBeenCalled();
    });

    test('handles document message webhook (main.dart), downloads file, and sends reply', async () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '201028067432',
                      id: `wamid_doc_${Date.now()}`,
                      type: 'document',
                      document: {
                        id: 'doc_456',
                        filename: 'main.dart',
                        mime_type: 'text/plain',
                        caption: 'شوف الكود ده',
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
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await handler.handleIncoming(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAdapter.downloadMedia).toHaveBeenCalledWith('doc_456');
      expect(mockAdapter.sendTextMessage).toHaveBeenCalled();
    });

    test('handles audio/voice note message webhook, downloads audio, and sends reply', async () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '201028067432',
                      id: `wamid_aud_${Date.now()}`,
                      type: 'audio',
                      audio: {
                        id: 'aud_789',
                        mime_type: 'audio/ogg; codecs=opus',
                        voice: true,
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
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await handler.handleIncoming(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAdapter.downloadMedia).toHaveBeenCalledWith('aud_789');
      expect(mockAdapter.sendTextMessage).toHaveBeenCalled();
    });
  });
});

