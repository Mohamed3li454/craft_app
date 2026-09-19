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
});
