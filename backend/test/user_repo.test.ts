import { UserRepository, normalizePhoneNumber } from '../src/database/repositories/user.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';

describe('UserRepository & Unified Phone Identity', () => {
  let userRepo: UserRepository;
  let chatRepo: ChatRepository;
  let memoryRepo: MemoryRepository;
  let reminderRepo: ReminderRepository;

  beforeAll(() => {
    userRepo = new UserRepository();
    chatRepo = new ChatRepository();
    memoryRepo = new MemoryRepository();
    reminderRepo = new ReminderRepository();
  });

  describe('normalizePhoneNumber', () => {
    it('normalizes local Egyptian mobile number starting with 010', () => {
      expect(normalizePhoneNumber('01028067432')).toBe('201028067432');
    });

    it('normalizes international format with plus prefix', () => {
      expect(normalizePhoneNumber('+201028067432')).toBe('201028067432');
    });

    it('normalizes international format with 00 prefix', () => {
      expect(normalizePhoneNumber('00201028067432')).toBe('201028067432');
    });

    it('removes spaces, dashes, and parentheses', () => {
      expect(normalizePhoneNumber('+20 (10) 2806-7432')).toBe('201028067432');
    });

    it('handles already standard numeric phone string', () => {
      expect(normalizePhoneNumber('201028067432')).toBe('201028067432');
    });
  });

  describe('findOrCreateUserByPhone & Identity Resolution', () => {
    it('resolves the same user across different phone number formats', async () => {
      const u1 = await userRepo.findOrCreateUserByPhone('+201099887766', 'Test Ahmed');
      const u2 = await userRepo.findOrCreateUserByPhone('01099887766');
      const u3 = await userRepo.findOrCreateUserByPhone('201099887766');

      expect(u1.id).toBeDefined();
      expect(u1.phoneNumber).toBe('201099887766');
      expect(u2.id).toBe(u1.id);
      expect(u3.id).toBe(u1.id);
    });

    it('allows lookup by user id or phone', async () => {
      const user = await userRepo.findOrCreateUserByPhone('201112223344', 'Sara');
      const byPhone = await userRepo.getUserByPhone('01112223344');
      const byId = await userRepo.getUserById(user.id);

      expect(byPhone).not.toBeNull();
      expect(byPhone?.id).toBe(user.id);
      expect(byId?.phoneNumber).toBe('201112223344');
    });
  });

  describe('Cross-Channel Unified Memory & Reminders', () => {
    const testPhone = '201555667788';

    it('shares long-term memories saved from WhatsApp when queried via Flutter phone number', async () => {
      // 1. User messages on WhatsApp
      await memoryRepo.saveFact(testPhone, 'المستخدم مهندس برمجيات ومؤسس شركة ناشئة', 'profession');

      // 2. User queries their memories from Flutter app using their phone number
      const memories = await memoryRepo.getMemories(`+${testPhone}`);
      expect(memories).toBeDefined();
      expect(memories.some(m => m.includes('مهندس برمجيات'))).toBe(true);
    });

    it('shares scheduled reminders across WhatsApp and Mobile app', async () => {
      // 1. Reminder created on WhatsApp
      const rem = await reminderRepo.create(testPhone, 'اجتماع مع المستثمرين', '+1h');
      expect(rem.id).toBeDefined();

      // 2. Flutter app lists reminders with local format
      const userReminders = await reminderRepo.listByUser(`0${testPhone.slice(2)}`, true);
      expect(userReminders.some(r => r.title === 'اجتماع مع المستثمرين')).toBe(true);
    });

    it('shares conversation history across channels for the same phone user', async () => {
      const conv = await chatRepo.getOrCreateConversation(testPhone, 'whatsapp');
      await chatRepo.saveMessage(conv.id, 'user', 'Ahmed', 'مرحبا كرافت');
      await chatRepo.saveMessage(conv.id, 'assistant', 'Craft', 'أهلاً بك يا أحمد!');

      const detailedConvs = await chatRepo.getUserConversationsDetailed(testPhone);
      expect(detailedConvs.length).toBeGreaterThan(0);
      expect(detailedConvs[0].messagesCount).toBeGreaterThanOrEqual(2);
    });
  });
});
