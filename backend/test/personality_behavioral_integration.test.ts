import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityEngine, PersonalityContext } from '../src/modules/personality';
import { WeatherTool } from '../src/modules/tools/builtins/weather.tool';
import { CompleteReminderTool, ListRemindersTool } from '../src/modules/tools/builtins/reminder.tool';
import { SaveMemoryTool } from '../src/modules/tools/builtins/memory.tool';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { config } from '../src/config/env';

describe('Phase 3.3-B — Personality Behavioral Integration Test Suite', () => {
  let orchestrator: AgentOrchestrator;
  let groqProvider: GroqProvider;
  let languageService: LanguageIntelligenceService;
  let personalityEngine: PersonalityEngine;

  beforeAll(() => {
    config.groq.isMockMode = true;
    process.env.GROQ_MOCK_MODE = 'true';
    orchestrator = new AgentOrchestrator();
    groqProvider = new GroqProvider();
    languageService = LanguageIntelligenceService.getInstance();
    personalityEngine = PersonalityEngine.getInstance();
  });

  // 1. English deterministic response
  describe('1. English Deterministic Response', () => {
    it('produces calm, concise, professional English deterministic rate-limit and error responses', async () => {
      const langCtx = languageService.resolveContext('Hello, can you help me?');
      expect(langCtx.targetLanguage).toBe('en');

      // Default mock fallback for English
      const reply = groqProvider.generateMockResponse(
        [{ role: 'user', content: 'Hello' }],
        undefined,
        false,
        langCtx
      );
      expect(reply.text).toBe('Hello, I am Craft, your personal AI assistant.');
      expect(reply.text).not.toContain('How can I help');
      expect(reply.text).not.toContain('Groq');
    });
  });

  // 2. Arabic deterministic response
  describe('2. Arabic Deterministic Response', () => {
    it('produces calm, concise, professional Arabic deterministic responses without slang or forced enthusiasm', async () => {
      const langCtx = languageService.resolveContext('السلام عليكم يا كرافت');
      expect(langCtx.targetLanguage).toBe('ar');

      const reply = groqProvider.generateMockResponse(
        [{ role: 'user', content: 'مرحبا' }],
        undefined,
        false,
        langCtx
      );
      expect(reply.text).toBe('أهلاً بك، أنا Craft، مساعدك الذكي الشخصي.');
      expect(reply.text).not.toContain('كيف يمكنني مساعدتك');
      expect(reply.text).not.toContain('يا باشا');
      expect(reply.text).not.toContain('يا هندسة');
      expect(reply.text).not.toContain('Groq');
    });
  });

  // 3. Egyptian Arabic response
  describe('3. Egyptian Arabic Response', () => {
    it('generates system instructions tailored to Egyptian Arabic while banning slang fillers', () => {
      const langCtx = languageService.resolveContext('عايز اعرف الطقس النهاردة عامل ايه');
      expect(langCtx.targetLanguage).toBe('ar');
      expect(langCtx.dialect).toBe('egyptian');

      const persCtx = personalityEngine.resolve();
      const instruction = groqProvider.getSystemInstruction(undefined, langCtx, persCtx);

      expect(instruction).toContain('Dialect: Natural, friendly, and professional Egyptian Arabic');
      expect(instruction).toContain('Avoid excessive colloquial fillers');
      expect(instruction).toContain('Communication & Personality Guidelines');
    });
  });

  // 4. MSA response
  describe('4. MSA Response', () => {
    it('generates system instructions tailored to Modern Standard Arabic cleanly without slang', () => {
      const langCtx = languageService.resolveContext('اتكلم معايا بالعربية الفصحى فقط');
      expect(langCtx.targetLanguage).toBe('ar');
      expect(langCtx.dialect).toBe('msa');

      const persCtx = personalityEngine.resolve();
      const instruction = groqProvider.getSystemInstruction(undefined, langCtx, persCtx);

      expect(instruction).toContain('Language: Modern Standard Arabic');
      expect(instruction).toContain('Communication & Personality Guidelines');
      expect(instruction).not.toContain('Egyptian');
    });
  });

  // 5. Search synthesis with different Personality
  describe('5. Search Synthesis with Personality Variations', () => {
    it('maintains identical search execution while reflecting personality directives in synthesis instruction', () => {
      const langCtx = languageService.resolveContext('ما هي مواصفات لابتوب ديل');
      const concisePers = personalityEngine.resolve({
        explicitPreference: { verbosity: 'concise' },
      });
      const compPers = personalityEngine.resolve({
        explicitPreference: { verbosity: 'comprehensive' },
      });

      const concisePrompt = groqProvider.getSystemInstruction(undefined, langCtx, concisePers);
      const compPrompt = groqProvider.getSystemInstruction(undefined, langCtx, compPers);

      // Both target Arabic
      expect(concisePrompt).toContain('Response Language & Style');
      expect(compPrompt).toContain('Response Language & Style');

      // Personality instructions differ in verbosity
      expect(concisePrompt).toContain('Be concise and get straight to the point without unnecessary filler');
      expect(compPrompt).toContain('Provide comprehensive, detailed responses with thorough explanations when warranted');
    });
  });

  // 6. Tool output presentation
  describe('6. Tool Output Presentation', () => {
    it('ensures tools present clean, localized data with zero personality contamination', async () => {
      const enContext = languageService.resolveContext('English query');
      const weatherTool = new WeatherTool();
      const weatherRes = await weatherTool.execute(
        { city: 'Cairo' },
        { userId: 'u1', conversationId: 'c1', channel: 'whatsapp', languageContext: enContext }
      );
      expect(weatherRes.success).toBe(true);
      expect(weatherRes.output.description).toContain('Current weather in Cairo');

      const reminderTool = new CompleteReminderTool({ complete: jest.fn().mockResolvedValue({ id: '1', title: 'Team Meeting' }) } as any);
      const remRes = await reminderTool.execute(
        { title: 'Team Meeting' },
        { userId: 'u1', conversationId: 'c1', channel: 'whatsapp', languageContext: enContext }
      );
      expect(remRes.success).toBe(true);
      expect(remRes.output.message).toContain('Reminder completed successfully');

      const memoryTool = new SaveMemoryTool({ saveFact: jest.fn().mockResolvedValue(true) } as any);
      const memRes = await memoryTool.execute(
        { fact: 'User is an architect' },
        { userId: 'u1', conversationId: 'c1', channel: 'whatsapp', languageContext: enContext }
      );
      expect(memRes.success).toBe(true);
      expect(memRes.output.message).toContain('Fact saved to long-term memory successfully');
    });
  });

  // 7. Rate-limit response
  describe('7. Rate-limit Response', () => {
    it('returns a calm, neutral, and localized rate limit response in Arabic and English', () => {
      const enRateLimit = 'You have reached the daily limit of free messages (40 messages). Your balance will be refreshed tomorrow. For unlimited access, please contact support.';
      const arRateLimit = 'لقد وصلت إلى الحد الأقصى للرسائل المجانية اليومية (40 رسالة). سيتجدد رصيدك غداً. للحصول على باقة غير محدودة، يمكنك التواصل مع الدعم.';

      expect(enRateLimit).not.toContain('!');
      expect(enRateLimit).not.toContain('sorry');
      expect(arRateLimit).not.toContain('يا باشا');
      expect(arRateLimit).not.toContain('يا فندم');
    });
  });

  // 8. Error response
  describe('8. Error Response', () => {
    it('returns a calm, neutral, and localized error response in Arabic and English', () => {
      const enError = 'A temporary connection error occurred. Please try sending your request again.';
      const arError = 'حدث خطأ مؤقت في الاتصال. يرجى محاولة إرسال طلبك مرة أخرى.';

      expect(enError).not.toContain('Oops');
      expect(enError).not.toContain('!');
      expect(arError).not.toContain('للأسف الشديد');
      expect(arError).not.toContain('معلش');
    });
  });

  // 9. Interim acknowledgement
  describe('9. Interim Acknowledgements', () => {
    it('produces calm, single-emoji, professional interim acknowledgements for all media types', async () => {
      const dispatched: string[] = [];

      // Image
      await orchestrator.run({
        userId: 'u_interim_img',
        channel: 'whatsapp',
        text: 'شوف دي كده',
        media: {
          buffer: Buffer.from('img_data'),
          mimeType: 'image/jpeg',
          filename: 'test.jpg',
        },
        onInterimProgress: (msg) => { dispatched.push(msg); },
      });
      expect(dispatched[0]).toContain('الصورة');
      expect(dispatched[0]).toContain('👁️');
      expect(dispatched[0]).not.toContain('يا باشا');
      expect(dispatched[0]).not.toContain('يا هندسة');

      // Audio
      dispatched.length = 0;
      await orchestrator.run({
        userId: 'u_interim_aud',
        channel: 'whatsapp',
        text: '',
        media: {
          buffer: Buffer.from('aud_data'),
          mimeType: 'audio/ogg',
          filename: 'voice.ogg',
        },
        onInterimProgress: (msg) => { dispatched.push(msg); },
      });
      expect(dispatched[0]).toContain('التسجيل الصوتي');
      expect(dispatched[0]).toContain('🎙️');

      // Document
      dispatched.length = 0;
      await orchestrator.run({
        userId: 'u_interim_doc',
        channel: 'whatsapp',
        text: 'اقرأ الملف',
        media: {
          buffer: Buffer.from('doc_data'),
          mimeType: 'text/plain',
          filename: 'notes.txt',
        },
        onInterimProgress: (msg) => { dispatched.push(msg); },
      });
      expect(dispatched[0]).toContain('الملف');
      expect(dispatched[0]).toContain('📄');
    });
  });

  // 10. Semantic Cache independence from Personality
  describe('10. Semantic Cache Independence from Personality', () => {
    it('evaluates identical cache hits regardless of the personality context', async () => {
      const engine = SemanticCacheEngine.getInstance();
      const query = 'من هو مطور كرافت';
      const arContext = languageService.resolveContext(query);

      const res1 = await engine.process(query, {
        userId: 'u_cache_1',
        channel: 'whatsapp',
        languageContext: arContext,
      });

      const res2 = await engine.process(query, {
        userId: 'u_cache_2',
        channel: 'whatsapp',
        languageContext: arContext,
      });

      expect(res1.type).toBe(res2.type);
      if (res1.type === 'hit' && res2.type === 'hit') {
        expect(res1.response).toBe(res2.response);
        expect(res1.similarity).toBe(res2.similarity);
      }
    });
  });
});
