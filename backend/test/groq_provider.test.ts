import { GroqProvider } from '../src/modules/groq/groq.provider';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { config } from '../src/config/env';
import { DatabaseManager } from '../src/database/connection';
import { UserRepository } from '../src/database/repositories/user.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { ConfirmationRepository } from '../src/database/repositories/confirmation.repo';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { ToolRegistry } from '../src/modules/tools/registry';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';

describe('GroqProvider & High-Speed LPU Integration', () => {
  let groqProvider: GroqProvider;
  let orchestrator: AgentOrchestrator;
  const originalMockMode = config.groq.isMockMode;

  beforeAll(() => {
    config.groq.isMockMode = true;
  });

  afterAll(() => {
    config.groq.isMockMode = originalMockMode;
  });

  beforeEach(() => {
    const mockDb = {
      getPool: () => null,
      getSupabase: () => null,
    } as unknown as DatabaseManager;

    const userRepo = new UserRepository(mockDb);
    const chatRepo = new ChatRepository(mockDb, userRepo);
    const memoryRepo = new MemoryRepository(mockDb);
    const userPrefRepo = new UserPreferenceRepository(mockDb);
    const confRepo = new ConfirmationRepository(mockDb);
    const confService = new ConfirmationService(confRepo);

    groqProvider = new GroqProvider();
    orchestrator = new AgentOrchestrator(
      groqProvider,
      ToolRegistry.getInstance(),
      confService,
      chatRepo,
      memoryRepo,
      userRepo,
      userPrefRepo
    );

    jest.spyOn(SemanticCacheEngine.getInstance(), 'process').mockResolvedValue({
      type: 'miss',
      reason: 'mock_test_mode',
      latencyMs: 1,
    });
  });

  describe('GroqProvider Unit Tests', () => {
    test('generates text reply using primary model in mock mode', async () => {
      const response = await groqProvider.generateReply([
        { role: 'user', content: 'مرحبا يا كرافت' },
      ]);

      expect(response.text).toBeDefined();
      expect(response.text.length).toBeGreaterThan(0);
    });

    test('generates tool calls for time query in mock mode', async () => {
      const response = await groqProvider.generateReply([
        { role: 'user', content: 'كم الوقت والساعة الآن؟' },
      ]);

      expect(response.functionCalls).toBeDefined();
      expect(response.functionCalls?.length).toBeGreaterThan(0);
      expect(response.functionCalls?.[0].name).toBe('get_current_time');
    });

    test('generates tool calls for weather query in mock mode', async () => {
      const response = await groqProvider.generateReply([
        { role: 'user', content: 'ما حالة الطقس في القاهرة اليوم؟' },
      ]);

      expect(response.functionCalls).toBeDefined();
      expect(response.functionCalls?.[0].name).toBe('get_weather');
    });

    test('routes image attachment to vision model in mock mode', async () => {
      const response = await groqProvider.generateReply(
        [{ role: 'user', content: 'حلل هذه الصورة' }],
        true,
        undefined,
        { data: 'base64imagedata', mimeType: 'image/png' }
      );

      expect(response.text).toContain('Groq Vision');
    });

    test('transcribes audio via Groq Whisper in mock mode', async () => {
      const audioBuffer = Buffer.from('fake-audio-bytes');
      const text = await groqProvider.transcribeAudio(audioBuffer, 'audio/ogg');

      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe('AgentOrchestrator with Groq LPU Engine', () => {
    test('executes conversational query with Groq and returns answer', async () => {
      const output = await orchestrator.run({
        userId: 'groq_test_user_1',
        channel: 'whatsapp',
        text: 'مرحبا',
      });

      expect(output.status).toBe('completed');
      expect(output.replyText).toBeDefined();
      expect(output.conversationId).toBeDefined();
    });

    test('transcribes voice note and processes request seamlessly', async () => {
      const output = await orchestrator.run({
        userId: 'groq_test_user_2',
        channel: 'whatsapp',
        text: '',
        media: {
          buffer: Buffer.from('test-voice-note-bytes'),
          mimeType: 'audio/ogg',
          filename: 'voice_note.ogg',
        },
      });

      expect(output.status).toBe('completed');
      expect(output.replyText).toBeDefined();
    });

    test('executes smart reminder via Groq', async () => {
      const reminderText = await orchestrator.generateSmartReminder(
        'groq_test_user_3',
        'تذكير بحالة الطقس في القاهرة'
      );

      expect(reminderText).toBeDefined();
      expect(reminderText).toContain('تذكير');
    });
  });
});
