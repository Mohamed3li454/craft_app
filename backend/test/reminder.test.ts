import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { ListRemindersTool, CompleteReminderTool, CreateReminderTool } from '../src/modules/tools/builtins/reminder.tool';

describe('Reminder Engine & Tools', () => {
  let repo: ReminderRepository;
  const testUserId = `reminder_test_${Date.now()}`;

  beforeEach(() => {
    repo = new ReminderRepository();
  });

  test('creates a reminder with title and optional due date', async () => {
    const reminder = await repo.create(
      testUserId,
      'شراء مستلزمات المكتب',
      new Date('2026-09-20T10:00:00Z')
    );

    expect(reminder.id).toBeDefined();
    expect(reminder.title).toBe('شراء مستلزمات المكتب');
    expect(reminder.isCompleted).toBe(false);
  });

  test('lists active reminders for user', async () => {
    await repo.create(testUserId, 'مهمة 1');
    await repo.create(testUserId, 'مهمة 2');

    const activeList = await repo.listByUser(testUserId, false);
    expect(activeList.length).toBeGreaterThanOrEqual(2);
    expect(activeList.some((r) => r.title === 'مهمة 1')).toBe(true);
  });

  test('completes a reminder by title match', async () => {
    await repo.create(testUserId, 'اجتماع زوم مع العميل');

    const completed = await repo.complete('اجتماع زوم', testUserId);
    expect(completed).not.toBeNull();
    expect(completed?.isCompleted).toBe(true);
    expect(completed?.title).toBe('اجتماع زوم مع العميل');
  });

  test('ListRemindersTool returns formatted Arabic summary', async () => {
    const tool = new ListRemindersTool(repo);
    const result = await tool.execute({}, { userId: testUserId, channel: 'whatsapp', conversationId: 'test_conv_1' });

    expect(result.success).toBe(true);
    expect(result.output.count).toBeGreaterThan(0);
    expect(result.output.summary).toContain('قائمة التذكيرات الحالية');
  });

  test('CompleteReminderTool marks reminder as finished', async () => {
    await repo.create(testUserId, 'دفع فاتورة النت');
    const tool = new CompleteReminderTool(repo);

    const result = await tool.execute(
      { title: 'فاتورة النت' },
      { userId: testUserId, channel: 'flutter', conversationId: 'test_conv_1' }
    );
    expect(result.success).toBe(true);
    expect(result.output.status).toBe('completed');
    expect(result.output.message).toContain('تم إتمام التذكير بنجاح');
  });

  describe('Recurring Reminders Engine', () => {
    const { calculateNextDueAt } = require('../src/database/repositories/reminder.repo');

    test('calculateNextDueAt correctly advances daily recurrence', () => {
      const base = new Date('2026-09-23T12:00:00+03:00');
      const next = calculateNextDueAt(base, 'daily');
      expect(next.getTime()).toBeGreaterThan(base.getTime());
      expect(next.getTime()).toBeGreaterThan(Date.now());
    });

    test('calculateNextDueAt correctly advances weekly recurrence', () => {
      const base = new Date('2026-09-23T12:00:00+03:00');
      const next = calculateNextDueAt(base, 'weekly');
      expect(next.getTime() - base.getTime()).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 1000);
    });

    test('creates and retrieves a recurring daily reminder', async () => {
      const recurringReminder = await repo.create(
        testUserId,
        'النشرة الإخبارية اليومية',
        new Date('2026-09-24T12:00:00+03:00'),
        'daily'
      );

      expect(recurringReminder.id).toBeDefined();
      expect(recurringReminder.recurrence).toBe('daily');

      const userReminders = await repo.listByUser(testUserId, false);
      const found = userReminders.find((r) => r.id === recurringReminder.id);
      expect(found).toBeDefined();
      expect(found?.recurrence).toBe('daily');
    });

    test('rescheduleRecurring updates due date and keeps reminder active', async () => {
      const r = await repo.create(
        testUserId,
        'تذكير أسبوعي رياضي',
        new Date('2026-09-20T10:00:00Z'),
        'weekly'
      );

      const nextWeek = new Date('2026-09-27T10:00:00Z');
      const rescheduled = await repo.rescheduleRecurring(r.id, nextWeek);
      expect(rescheduled).toBe(true);

      const list = await repo.listByUser(testUserId, false);
      const updated = list.find((item) => item.id === r.id);
      expect(updated).toBeDefined();
      expect(updated?.isCompleted).toBe(false);
      expect(new Date(updated!.dueAt!).toISOString()).toBe(nextWeek.toISOString());
    });

    test('CreateReminderTool supports recurrence parameter and labels confirmation', async () => {
      const tool = new CreateReminderTool();
      const res = await tool.execute(
        { title: 'ملخص الأخبار', time: '12:00', recurrence: 'daily' },
        { userId: testUserId, channel: 'whatsapp', conversationId: 'conv_1' }
      );

      expect(res.success).toBe(true);
      expect(res.confirmationDescription).toContain('يومياً');
      expect(res.output.recurrence).toBe('daily');
    });

    test('ListRemindersTool displays recurrence badge', async () => {
      await repo.create(
        testUserId,
        'تقرير المبيعات الأسبوعي',
        new Date('2026-09-25T09:00:00Z'),
        'weekly'
      );
      const tool = new ListRemindersTool(repo);
      const res = await tool.execute(
        {},
        { userId: testUserId, channel: 'whatsapp', conversationId: 'conv_1' }
      );

      expect(res.output.summary).toContain('[أسبوعي 🔄]');
    });
  });
});
