import { GroqProvider } from '../src/modules/groq/groq.provider';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';

describe('GroqProvider & High-Speed LPU Integration', () => {
  let groqProvider: GroqProvider;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    groqProvider = new GroqProvider();
    orchestrator = new AgentOrchestrator();
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
