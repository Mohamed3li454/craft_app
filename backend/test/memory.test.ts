import { formatConversationHistory, AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { MessageEntity } from '../src/database/repositories/types';

describe('Multi-turn Conversation Memory', () => {
  describe('formatConversationHistory normalizer', () => {
    test('ensures first turn is from user by dropping leading model messages', () => {
      const messages: MessageEntity[] = [
        {
          id: '1',
          conversationId: 'c1',
          senderRole: 'assistant',
          senderName: 'Craft',
          text: 'مرحبا بك! كيف أساعدك؟',
          createdAt: new Date(),
        },
        {
          id: '2',
          conversationId: 'c1',
          senderRole: 'user',
          senderName: 'User',
          text: 'أنا مبرمج',
          createdAt: new Date(),
        },
      ];

      const contents = formatConversationHistory(messages, 'أنا مبرمج');
      expect(contents.length).toBe(1);
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts[0]).toEqual({ text: 'أنا مبرمج' });
    });

    test('merges consecutive messages with the same role into single turn', () => {
      const messages: MessageEntity[] = [
        {
          id: '1',
          conversationId: 'c1',
          senderRole: 'user',
          senderName: 'User',
          text: 'أنا شغال مبرمج فلاتر',
          createdAt: new Date(),
        },
        {
          id: '2',
          conversationId: 'c1',
          senderRole: 'user',
          senderName: 'User',
          text: 'وعايش في القاهرة',
          createdAt: new Date(),
        },
      ];

      const contents = formatConversationHistory(messages, 'وعايش في القاهرة');
      expect(contents.length).toBe(1);
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts[0]).toEqual({ text: 'أنا شغال مبرمج فلاتر\nوعايش في القاهرة' });
    });

    test('preserves alternating user/model turns and appends latest prompt', () => {
      const messages: MessageEntity[] = [
        {
          id: '1',
          conversationId: 'c1',
          senderRole: 'user',
          senderName: 'User',
          text: 'مرحبا',
          createdAt: new Date(),
        },
        {
          id: '2',
          conversationId: 'c1',
          senderRole: 'assistant',
          senderName: 'Craft',
          text: 'أهلاً بك يا فندم',
          createdAt: new Date(),
        },
      ];

      const contents = formatConversationHistory(messages, 'ما هي خدماتك؟');
      expect(contents.length).toBe(3);
      expect(contents[0].role).toBe('user');
      expect(contents[1].role).toBe('model');
      expect(contents[2].role).toBe('user');
      expect(contents[2].parts[0]).toEqual({ text: 'ما هي خدماتك؟' });
    });
  });

  describe('AgentOrchestrator context recall across turns', () => {
    let orchestrator: AgentOrchestrator;

    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    test('recalls details from earlier turns in the same conversation', async () => {
      const userId = `memory_test_user_${Date.now()}`;

      // Turn 1: user introduces job and city
      const turn1 = await orchestrator.run({
        userId,
        channel: 'whatsapp',
        text: 'أنا شغال مبرمج فلاتر في القاهرة',
      });
      expect(turn1.status).toBe('completed');

      // Turn 2: user asks about previously given details
      const turn2 = await orchestrator.run({
        userId,
        channel: 'whatsapp',
        text: 'أنا شغال إيه وفين؟',
      });
      expect(turn2.status).toBe('completed');
      expect(turn2.replyText).toContain('مبرمج');
      expect(turn2.replyText).toContain('القاهرة');
    });
  });
});
