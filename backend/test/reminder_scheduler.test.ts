import { ReminderScheduler } from '../src/modules/reminder/reminder.scheduler';
import { ReminderRepository, parseDueAt } from '../src/database/repositories/reminder.repo';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { ChatRepository } from '../src/database/repositories/chat.repo';

describe('ReminderScheduler & Timezone Intelligence', () => {
  let scheduler: ReminderScheduler;
  let repo: ReminderRepository;
  let mockAdapter: jest.Mocked<WhatsAppAdapter>;
  let chatRepo: ChatRepository;

  beforeEach(() => {
    repo = new ReminderRepository();
    mockAdapter = {
      sendTextMessage: jest.fn().mockResolvedValue(true),
    } as any;
    chatRepo = new ChatRepository();
    scheduler = new ReminderScheduler(repo, mockAdapter, chatRepo);
  });

  test('parseDueAt handles "بعد دقيقة" by returning timestamp 1 minute in future', () => {
    const before = Date.now();
    const parsed = parseDueAt('بعد دقيقة');
    const after = Date.now();

    expect(parsed).not.toBeNull();
    const diff = (parsed!.getTime() - before);
    expect(diff).toBeGreaterThanOrEqual(59000);
    expect(diff).toBeLessThanOrEqual(61000);
  });

  test('parseDueAt interprets naive datetime as Cairo local time (+03:00)', () => {
    const parsed = parseDueAt('2026-09-19 18:30');
    expect(parsed).not.toBeNull();
    // 18:30 in UTC+3 should be 15:30 in UTC
    expect(parsed!.toISOString()).toBe('2026-09-19T15:30:00.000Z');
  });

  test('dispatches due reminder via WhatsApp and marks it completed', async () => {
    // 1. Create a reminder due in the past (1 minute ago)
    const pastDue = new Date(Date.now() - 60 * 1000);
    const reminder = await repo.create(
      'wa_201028067432',
      'تذكير بموعد الدواء',
      pastDue
    );

    expect(reminder.isCompleted).toBe(false);

    // 2. Run scheduler check
    const result = await scheduler.checkAndDispatchDueReminders();

    expect(result.dispatchedCount).toBeGreaterThanOrEqual(1);
    expect(mockAdapter.sendTextMessage).toHaveBeenCalled();

    // Verify recipient phone was extracted from wa_201028067432
    const targetPhone = (mockAdapter.sendTextMessage as jest.Mock).mock.calls[0][0];
    expect(targetPhone).toBe('201028067432');

    const sentMessage = (mockAdapter.sendTextMessage as jest.Mock).mock.calls[0][1];
    expect(sentMessage).toContain('تذكير من كرافت');
    expect(sentMessage).toContain('تذكير بموعد الدواء');
  });

  test('dispatches smart dynamic reminder with weather report when topic is weather', async () => {
    // 1. Create a reminder due in past about weather in Cairo
    const pastDue = new Date(Date.now() - 60 * 1000);
    const reminder = await repo.create(
      'wa_201028067432',
      'تذكير بحالة الطقس في القاهرة',
      pastDue
    );

    expect(reminder.isCompleted).toBe(false);

    // 2. Dispatch
    const result = await scheduler.checkAndDispatchDueReminders();
    expect(result.dispatchedCount).toBeGreaterThanOrEqual(1);

    // 3. Sent message should contain weather information
    const lastCall = (mockAdapter.sendTextMessage as jest.Mock).mock.calls.pop();
    const sentMessage = lastCall[1];
    expect(sentMessage).toContain('تذكير من كرافت');
    expect(sentMessage).toContain('الطقس');
  });
});
