import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { ToolRegistry } from '../src/modules/tools/registry';
import { WebSearchTool } from '../src/modules/tools/builtins/search.tool';
import { serializeToolResultForGroq } from '../src/modules/agent/orchestrator';
import { WhatsAppWebhookHandler } from '../src/modules/whatsapp/webhook';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { LanguageIntelligenceService, LanguageContext } from '../src/modules/language';

describe('Language Intelligence Runtime Integration (Phase 2)', () => {
  let orchestrator: AgentOrchestrator;
  let groqProvider: GroqProvider;
  let langService: LanguageIntelligenceService;

  beforeEach(() => {
    orchestrator = new AgentOrchestrator();
    groqProvider = new GroqProvider();
    langService = LanguageIntelligenceService.getInstance();
  });

  describe('1. Request-level Language Context in Agent Orchestrator', () => {
    test('resolves English context for English conversational query', async () => {
      const output = await orchestrator.run({
        userId: 'test_user_en_1',
        channel: 'whatsapp',
        text: 'Hello Craft! Can you tell me what you can do?',
      });

      expect(output.status).toBe('completed');
      expect(output.languageContext).toBeDefined();
      expect(output.languageContext?.targetLanguage).toBe('en');
      expect(output.languageContext?.confidence).toBeGreaterThanOrEqual(0.80);
      expect(output.languageContext?.textDirection).toBe('ltr');
      expect(output.replyText).toBeDefined();
      expect(output.replyText.length).toBeGreaterThan(0);
    });

    test('resolves Arabic context for Arabic conversational query', async () => {
      const output = await orchestrator.run({
        userId: 'test_user_ar_1',
        channel: 'whatsapp',
        text: 'مرحبا يا كرافت، ممكن تفهمني إيه هي مميزاتك؟',
      });

      expect(output.status).toBe('completed');
      expect(output.languageContext).toBeDefined();
      expect(output.languageContext?.targetLanguage).toBe('ar');
      expect(output.languageContext?.confidence).toBeGreaterThanOrEqual(0.85);
      expect(output.languageContext?.textDirection).toBe('rtl');
      expect(output.replyText).toBeDefined();
      expect(output.replyText.length).toBeGreaterThan(0);
    });
  });

  describe('2. Explicit Instruction Overrides (Priority Hierarchy)', () => {
    test('explicit English instruction overrides stored Arabic preference', () => {
      const context = langService.resolveContext('Speak English please', {
        storedPreference: { language: 'ar', dialect: 'egyptian' },
      });

      expect(context.targetLanguage).toBe('en');
      expect(context.source).toBe('explicit_instruction');
      expect(context.confidence).toBeGreaterThanOrEqual(0.95);
      expect(context.explicitInstruction?.detected).toBe(true);
    });

    test('explicit Arabic instruction overrides stored English preference', () => {
      const context = langService.resolveContext('كلمني بالمصري يا كرافت', {
        storedPreference: { language: 'en' },
      });

      expect(context.targetLanguage).toBe('ar');
      expect(context.dialect).toBe('egyptian');
      expect(context.source).toBe('explicit_instruction');
      expect(context.confidence).toBeGreaterThanOrEqual(0.95);
    });

    test('meta-language correction overrides prior conversation context', () => {
      const context = langService.resolveContext('Why are you speaking Arabic? Speak in English', {
        recentMessages: [
          { role: 'user', text: 'ازيك' },
          { role: 'assistant', text: 'أهلاً بك! كيف أساعدك اليوم؟' },
        ],
        storedPreference: { language: 'ar' },
      });

      expect(context.targetLanguage).toBe('en');
      expect(context.source).toBe('explicit_instruction');
    });

    test('stored preference does NOT override current message language', () => {
      // User says normal English message without explicit command
      const context = langService.resolveContext('What is the latest status of my account?', {
        storedPreference: { language: 'ar', dialect: 'egyptian' },
      });

      // Must be English based on current message (Tier 2), NOT Arabic from stored preference (Tier 5)
      expect(context.targetLanguage).toBe('en');
      expect(context.source).toBe('current_message');
    });
  });

  describe('3. Code-Switching & Mixed Language Handling', () => {
    test('Arabic carrier with English technical keywords resolves to Arabic', () => {
      const context = langService.resolveContext('ممكن تشرحلي ازاي اعمل State Management في Flutter؟');

      expect(context.targetLanguage).toBe('ar');
      expect(context.source).toBe('current_message');
      expect(context.textDirection).toBe('rtl');
    });

    test('English carrier with Arabic loan phrases resolves to English', () => {
      const context = langService.resolveContext('Can you please explain this problem لي as soon as possible?');

      expect(context.targetLanguage).toBe('en');
      expect(context.source).toBe('current_message');
      expect(context.textDirection).toBe('ltr');
    });
  });

  describe('4. Search Tool Dynamic Query Handling & Localization', () => {
    test('does NOT append "في مصر" to generic search queries', async () => {
      const searchTool = new WebSearchTool();

      const enContext: LanguageContext = {
        targetLanguage: 'en',
        confidence: 0.95,
        source: 'current_message',
        locale: 'en-US',
        textDirection: 'ltr',
      };

      const result = await searchTool.execute(
        { query: 'iPhone 16 Pro price' },
        { userId: 'u1', conversationId: 'c1', channel: 'whatsapp', languageContext: enContext }
      );

      expect(result.success).toBe(true);
      expect(result.output.query).toBe('iPhone 16 Pro price');
      expect(result.output.query).not.toContain('في مصر');
    });

    test('preserves user explicit geographical context in search queries', async () => {
      const searchTool = new WebSearchTool();

      const arContext: LanguageContext = {
        targetLanguage: 'ar',
        confidence: 0.95,
        source: 'current_message',
        locale: 'ar-EG',
        textDirection: 'rtl',
      };

      const result = await searchTool.execute(
        { query: 'سعر ايفون 16 في السعودية' },
        { userId: 'u1', conversationId: 'c1', channel: 'whatsapp', languageContext: arContext }
      );

      expect(result.success).toBe(true);
      expect(result.output.query).toContain('في السعودية');
      expect(result.output.query).not.toContain('في مصر');
    });

    test('sets English headers and locale for Google News when language is English', async () => {
      const searchTool = new WebSearchTool();
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<rss><channel><item><title>Test News</title><link>https://example.com</link><description>Snippet</description></item></channel></rss>',
      } as any);

      const enContext: LanguageContext = {
        targetLanguage: 'en',
        confidence: 0.95,
        source: 'current_message',
        locale: 'en-US',
        textDirection: 'ltr',
      };

      await (searchTool as any).searchGoogleNews('AI developments', 3, enContext);

      expect(fetchSpy).toHaveBeenCalled();
      const fetchUrl = fetchSpy.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('hl=en-US');
      expect(fetchUrl).toContain('gl=US');

      fetchSpy.mockRestore();
    });
  });

  describe('5. Tool Result Serialization & Synthesis Instructions', () => {
    test('emits English synthesis instruction when languageContext is English', () => {
      const enContext: LanguageContext = {
        targetLanguage: 'en',
        confidence: 0.95,
        source: 'current_message',
        locale: 'en-US',
        textDirection: 'ltr',
      };

      const result = serializeToolResultForGroq(
        'web_search',
        {
          query: 'MacBook Pro M3 price',
          results: [{ title: 'MacBook Pro M3', snippet: '$1599 at Best Buy', url: 'https://bestbuy.com' }],
        },
        enContext
      );

      const parsed = JSON.parse(result);
      expect(parsed.instruction).toContain('Synthesize your final comprehensive response in fluent, natural English');
      expect(parsed.instruction).not.toContain('Egyptian Arabic');
    });

    test('emits Arabic synthesis instruction when languageContext is Arabic', () => {
      const arContext: LanguageContext = {
        targetLanguage: 'ar',
        dialect: 'egyptian',
        confidence: 0.95,
        source: 'current_message',
        locale: 'ar-EG',
        textDirection: 'rtl',
      };

      const result = serializeToolResultForGroq(
        'web_search',
        {
          query: 'سعر ماك بوك برو M3',
          results: [{ title: 'ماك بوك برو M3', snippet: '85000 جنيه في تريدلاين', url: 'https://tradeline.com' }],
        },
        arContext
      );

      const parsed = JSON.parse(result);
      expect(parsed.instruction).toContain('Synthesize your final comprehensive response in natural, friendly Arabic');
    });
  });

  describe('6. Groq System Instruction & Dynamic Prompting', () => {
    test('injects English language and style rules into system instruction', () => {
      const enContext: LanguageContext = {
        targetLanguage: 'en',
        confidence: 0.95,
        source: 'current_message',
        locale: 'en-US',
        textDirection: 'ltr',
      };

      const instruction = groqProvider.getSystemInstruction(
        ['User lives in Cairo', 'User speaks Arabic'],
        enContext
      );

      expect(instruction).toContain('Language: English');
      expect(instruction).toContain('Rule: You MUST formulate your entire response in natural, fluent English');
      expect(instruction).toContain('*Priority Rule*: The active "Response Language & Style" specified above is authoritative');
    });

    test('injects Egyptian Arabic rules with professional tone when requested', () => {
      const egContext: LanguageContext = {
        targetLanguage: 'ar',
        dialect: 'egyptian',
        confidence: 0.95,
        source: 'explicit_instruction',
        locale: 'ar-EG',
        textDirection: 'rtl',
      };

      const instruction = groqProvider.getSystemInstruction([], egContext);

      expect(instruction).toContain('Dialect: Natural, friendly, and professional Egyptian Arabic');
      expect(instruction).toContain('Avoid excessive colloquial fillers like "يا باشا" or "يا هندسة"');
    });

    test('injects Modern Standard Arabic when dialect is MSA', () => {
      const msaContext: LanguageContext = {
        targetLanguage: 'ar',
        dialect: 'msa',
        confidence: 0.95,
        source: 'explicit_instruction',
        locale: 'ar',
        textDirection: 'rtl',
      };

      const instruction = groqProvider.getSystemInstruction([], msaContext);

      expect(instruction).toContain('Modern Standard Arabic');
      expect(instruction).toContain('العربية الفصحى المعاصرة');
    });
  });

  describe('7. Media Interim Acknowledgements & Removal of Slang', () => {
    test('dispatches clean English interim message for English user with image', async () => {
      let interimDispatched = '';
      await orchestrator.run({
        userId: 'test_interim_en',
        channel: 'whatsapp',
        text: 'Can you analyze this diagram for me?',
        media: {
          buffer: Buffer.from('fake-image-bytes'),
          mimeType: 'image/jpeg',
          filename: 'diagram.jpg',
        },
        onInterimProgress: (msg) => {
          interimDispatched = msg;
        },
      });

      expect(interimDispatched).toContain('Analyzing your image, one moment please!');
      expect(interimDispatched).not.toContain('يا باشا');
      expect(interimDispatched).not.toContain('يا هندسة');
    });

    test('dispatches clean Arabic interim message without excessive slang for Arabic user with image', async () => {
      let interimDispatched = '';
      await orchestrator.run({
        userId: 'test_interim_ar',
        channel: 'whatsapp',
        text: 'ممكن تبص في الصورة دي؟',
        media: {
          buffer: Buffer.from('fake-image-bytes'),
          mimeType: 'image/jpeg',
          filename: 'photo.jpg',
        },
        onInterimProgress: (msg) => {
          interimDispatched = msg;
        },
      });

      expect(interimDispatched).toContain('لحظات، أطّلع على الصورة وأرد عليك!');
      expect(interimDispatched).not.toContain('يا باشا');
      expect(interimDispatched).not.toContain('يا هندسة');
    });
  });

  describe('8. Webhook Interactive Confirmation Buttons', () => {
    test('sends English button labels when languageContext is English', async () => {
      const mockAdapter = {
        sendTextMessage: jest.fn().mockResolvedValue(true),
        sendInteractiveButtons: jest.fn().mockResolvedValue(true),
        sendTypingIndicator: jest.fn().mockResolvedValue(true),
      } as unknown as jest.Mocked<WhatsAppAdapter>;

      const mockConfirmService = new ConfirmationService();
      const mockOrchestrator = {
        run: jest.fn().mockResolvedValue({
          conversationId: 'c1',
          agentRunId: 'run-1',
          status: 'waiting_for_confirmation',
          replyText: 'This action requires confirmation',
          toolCallsExecuted: [],
          confirmationRequest: {
            token: 'test_token_123',
            actionName: 'create_reminder',
            description: 'Reminder',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
          },
          languageContext: {
            targetLanguage: 'en',
            confidence: 0.98,
            source: 'current_message',
            locale: 'en-US',
            textDirection: 'ltr',
          },
        }),
      } as unknown as AgentOrchestrator;

      const handler = new WhatsAppWebhookHandler(
        mockAdapter,
        {
          isEventProcessed: jest.fn().mockResolvedValue(false),
          markEventProcessed: jest.fn().mockResolvedValue(true),
        } as any,
        mockOrchestrator,
        mockConfirmService,
        {
          getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'c1' }),
          saveMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
        } as any,
        {
          findOrCreateWhatsAppUser: jest.fn().mockResolvedValue({ id: 'u1', name: 'John' }),
        } as any
      );

      const req: any = {
        headers: {},
        body: {
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        id: 'wamid.123',
                        from: '1234567890',
                        type: 'text',
                        text: { body: 'Remind me to call John tomorrow' },
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
        send: jest.fn(),
      };

      // Mock verifyMetaSignature to bypass HMAC check
      jest.spyOn(require('../src/modules/whatsapp/signature'), 'verifyMetaSignature').mockReturnValue(true);

      await handler.handleIncoming(req, res);

      expect(mockAdapter.sendInteractiveButtons).toHaveBeenCalled();
      const [recipient, prompt, buttons] = mockAdapter.sendInteractiveButtons.mock.calls[0];

      expect(recipient).toBe('1234567890');
      expect(prompt).toContain('Tap a button below to confirm or cancel:');
      expect(buttons).toEqual([
        { id: 'conf_approve_test_token_123', title: 'Confirm ✅' },
        { id: 'conf_reject_test_token_123', title: 'Cancel ❌' },
      ]);
    });
  });
});
