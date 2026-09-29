/**
 * Phase 9.2: Production Reminder Delivery Foundation Test Suite
 *
 * Verifies the 20 authoritative delivery foundation requirements:
 *
 * Part 1: Reminder State Machine & Lifecycle (Tests A - E)
 * - Test A: Create reminder -> state = 'scheduled', attempts = 0, isCompleted = false
 * - Test B: Reminder becomes due -> scheduler detects it
 * - Test C: Atomic claim -> row marked 'claimed' with 2-minute lease (locked_until)
 * - Test D: Two concurrent workers -> only one claims the row (SKIP LOCKED)
 * - Test E: Successful delivery -> state = 'sent', wamid saved, isCompleted = true
 *
 * Part 2: Error Classification & Bounded Backoff (Tests F - L)
 * - Test F: 429 Rate Limit -> retry_pending
 * - Test G: 500 Meta Server Error -> retry_pending
 * - Test H: 400 Bad Request / Fatal error -> dead_letter
 * - Test I: Attempt 1 -> retry delay +1 minute (60s)
 * - Test J: Attempt 2 -> retry delay +5 minutes (300s)
 * - Test K: Attempt 3 -> retry delay +15 minutes (900s)
 * - Test L: Max attempts exceeded (>= 3) -> dead_letter
 *
 * Part 3: Idempotency & Safety Guarantees (Tests M - P)
 * - Test M: Existing sent reminder -> never sent twice
 * - Test N: Cancelled reminder -> never dispatched
 * - Test O: Expired lease -> reminder can be reclaimed
 * - Test P: Concurrent scheduler invocations -> no duplicate delivery
 *
 * Part 4: Cron Route, Auth & Advanced Delivery Safeguards (Tests Q - T)
 * - Test Q: Invalid cron secret -> HTTP 401 Unauthorized
 * - Test R: Valid cron secret -> scheduler runs, HTTP 200
 * - Test S: Missed reminder beyond threshold (> 6 hours) -> dead_letter (missed_threshold_exceeded)
 * - Test T: Meta success but missing wamid -> do not mark sent
 */

import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../src/app';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { ReminderScheduler } from '../src/modules/reminder/reminder.scheduler';
import { ReminderTrigger } from '../src/modules/reminder/reminder.trigger';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';

describe('Phase 9.2: Production Reminder Delivery Foundation', () => {
  let repo: ReminderRepository;
  let mockWhatsApp: jest.Mocked<WhatsAppAdapter>;
  let mockChatRepo: jest.Mocked<ChatRepository>;
  let mockOrchestrator: jest.Mocked<AgentOrchestrator>;
  let scheduler: ReminderScheduler;

  const testUserPrefix = `test_p92_${Date.now()}`;
  const testPhone = '201028067432';

  let testUserUuid: string | undefined;

  beforeAll(async () => {
    repo = new ReminderRepository();
    try {
      testUserUuid = await (repo as any).resolveUserId(`wa_${testPhone}`);
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    jest.restoreAllMocks();

    try {
      const pool = (repo as any).db?.getPool?.();
      if (pool) {
        if (testUserUuid) {
          await pool.query('DELETE FROM reminders WHERE user_id = $1', [testUserUuid]);
        }
        await pool.query("DELETE FROM reminders WHERE title LIKE 'تذكير %' OR title LIKE 'مهمة %' OR title LIKE 'تناول %' OR title LIKE 'تقرير %'");
      }
    } catch {
      // ignore
    }

    mockWhatsApp = {
      sendTextMessage: jest.fn().mockResolvedValue(true),
      dispatchProactiveMessage: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        providerMessageId: `wamid.HBgL${Date.now()}`,
      }),
    } as any;

    mockChatRepo = {
      getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'test_conv_id' } as any),
      saveMessage: jest.fn().mockResolvedValue({ id: 'test_msg_id' } as any),
      getRecentMessages: jest.fn().mockResolvedValue([
        { senderRole: 'user', createdAt: new Date().toISOString() },
      ] as any),
    } as any;

    mockOrchestrator = {
      generateSmartReminder: jest.fn().mockImplementation((_userId, title) =>
        Promise.resolve(`⏰ *تذكير من كرافت*:\n${title}`)
      ),
    } as any;

    scheduler = new ReminderScheduler(
      repo,
      mockWhatsApp,
      mockChatRepo,
      mockOrchestrator,
      {
        batchSize: 50,
        leaseSeconds: 120,
        maxRetries: 3,
        maxMissedAgeMs: 6 * 60 * 60 * 1000,
      }
    );
  });

  afterAll(async () => {
    try {
      const pool = (repo as any).db?.getPool?.();
      if (pool) {
        if (testUserUuid) {
          await pool.query('DELETE FROM reminders WHERE user_id = $1', [testUserUuid]);
        }
        await pool.query("DELETE FROM reminders WHERE title LIKE 'تذكير %' OR title LIKE 'مهمة %' OR title LIKE 'تناول %' OR title LIKE 'تقرير %'");
      }
    } catch {
      // ignore cleanup errors
    }
  });

  // =========================================================================
  // Part 1: Reminder State Machine & Lifecycle (Tests A - E)
  // =========================================================================
  describe('Part 1: Reminder State Machine & Lifecycle', () => {
    test('Test A: Create reminder -> state = scheduled, attempts = 0, isCompleted = false', async () => {
      const userId = `${testUserPrefix}_A`;
      const dueAt = new Date(Date.now() + 60 * 60 * 1000);

      const reminder = await repo.create(userId, 'موعد الطبيب', dueAt);

      expect(reminder.id).toBeDefined();
      expect(reminder.state).toBe('scheduled');
      expect(reminder.attempts).toBe(0);
      expect(reminder.isCompleted).toBe(false);
      expect(reminder.wamid == null).toBe(true);
    });

    test('Test B: Reminder becomes due -> scheduler detects it', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000); // 30s in the past

      const reminder = await repo.create(userId, 'تناول الدواء الآن', dueAt);

      const result = await scheduler.checkAndDispatchDueReminders(10);

      expect(result.dispatchedCount).toBeGreaterThanOrEqual(1);
      expect(result.remindersDispatched).toContain('تناول الدواء الآن');
      expect(mockWhatsApp.dispatchProactiveMessage).toHaveBeenCalled();

      const updated = await repo.getById(reminder.id);
      expect(updated?.state).toBe('sent');
      expect(updated?.isCompleted).toBe(true);
    });

    test('Test C: Atomic claim -> row marked claimed with lease (locked_until)', async () => {
      const userId = `${testUserPrefix}_C`;
      const dueAt = new Date(Date.now() - 60 * 1000);

      const reminder = await repo.create(userId, 'مهمة فحص الحجز', dueAt);

      const claimed = await repo.claimDueReminders(10, 120);
      const target = claimed.find((r) => r.id === reminder.id);

      expect(target).toBeDefined();
      expect(target?.state).toBe('claimed');
      expect(target?.lockedUntil).toBeDefined();

      const leaseDiffMs = (target!.lockedUntil!.getTime()) - Date.now();
      expect(leaseDiffMs).toBeGreaterThan(60 * 1000);
      expect(leaseDiffMs).toBeLessThanOrEqual(125 * 1000);
    });

    test('Test D: Two concurrent workers -> only one claims the row (SKIP LOCKED)', async () => {
      const userId = `${testUserPrefix}_D`;
      const dueAt = new Date(Date.now() - 45 * 1000);

      const reminder = await repo.create(userId, 'تقرير الاجتماع الدوري', dueAt);

      // Two concurrent claims racing for batchSize 1
      const [claim1, claim2] = await Promise.all([
        repo.claimDueReminders(1, 120),
        repo.claimDueReminders(1, 120),
      ]);

      const foundIn1 = claim1.some((r) => r.id === reminder.id);
      const foundIn2 = claim2.some((r) => r.id === reminder.id);

      // Exactly one worker claimed this row, never both
      expect(Number(foundIn1) + Number(foundIn2)).toBe(1);
    });

    test('Test E: Successful delivery -> state = sent, wamid saved, isCompleted = true', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 20 * 1000);
      const expectedWamid = `wamid.HBgL_TEST_E_${Date.now()}`;

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: true,
        status: 200,
        providerMessageId: expectedWamid,
      });

      const reminder = await repo.create(userId, 'تأكيد الحجز النهائي', dueAt);

      const result = await scheduler.checkAndDispatchDueReminders(10);
      expect(result.remindersDispatched).toContain('تأكيد الحجز النهائي');

      const updated = await repo.getById(reminder.id);
      expect(updated).not.toBeNull();
      expect(updated?.state).toBe('sent');
      expect(updated?.isCompleted).toBe(true);
      expect(updated?.wamid).toBe(expectedWamid);
    });
  });

  // =========================================================================
  // Part 2: Error Classification & Bounded Backoff (Tests F - L)
  // =========================================================================
  describe('Part 2: Error Classification & Bounded Backoff', () => {
    test('Test F: 429 Rate Limit -> retry_pending', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: false,
        status: 429,
        error: { message: 'Too Many Requests' },
      });

      const reminder = await repo.create(userId, 'تذكير تحت ضغط المعدل', dueAt);
      await scheduler.checkAndDispatchDueReminders(10);

      const updated = await repo.getById(reminder.id);
      expect(updated?.state).toBe('retry_pending');
      expect(updated?.attempts).toBe(1);
      expect(updated?.isCompleted).toBe(false);
      expect(updated?.lastError).toMatch(/rate.*limit/i);
    });

    test('Test G: 500 Meta Server Error -> retry_pending', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: false,
        status: 500,
        error: { message: 'Meta internal server error' },
      });

      const reminder = await repo.create(userId, 'تذكير خطأ خادم ميتا', dueAt);
      await scheduler.checkAndDispatchDueReminders(10);

      const updated = await repo.getById(reminder.id);
      expect(updated?.state).toBe('retry_pending');
      expect(updated?.attempts).toBe(1);
      expect(updated?.lastError).toMatch(/server error/i);
    });

    test('Test H: 400 Bad Request / Fatal error -> dead_letter', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: false,
        status: 400,
        error: { message: 'Invalid recipient phone number' },
      });

      const reminder = await repo.create(userId, 'تذكير برقم غير صالح', dueAt);
      await scheduler.checkAndDispatchDueReminders(10);

      const updated = await repo.getById(reminder.id);
      expect(updated?.state).toBe('dead_letter');
      expect(updated?.isCompleted).toBe(true);
      expect(updated?.lastError).toBeDefined();
    });

    test('Test I: Attempt 1 -> retry delay +1 minute (60s)', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: false,
        status: 503,
        error: { message: 'Service unavailable' },
      });

      const reminder = await repo.create(userId, 'تذكير محاولة 1', dueAt);
      const before = Date.now();
      await scheduler.checkAndDispatchDueReminders(10);

      const updated = await repo.getById(reminder.id);
      expect(updated?.attempts).toBe(1);
      expect(updated?.dueAt).toBeDefined();

      const delayMs = updated!.dueAt!.getTime() - before;
      expect(delayMs).toBeGreaterThanOrEqual(55 * 1000);
      expect(delayMs).toBeLessThanOrEqual(65 * 1000);
    });

    test('Test J: Attempt 2 -> retry delay +5 minutes (300s)', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      const reminder = await repo.create(userId, 'تذكير محاولة 2', dueAt);
      // Simulate that attempt 1 already happened
      const pool = (repo as any).db?.getPool?.();
      if (pool) {
        await pool.query('UPDATE reminders SET attempts = 1 WHERE id = $1', [reminder.id]);
      }

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: false,
        status: 503,
        error: { message: 'Service unavailable' },
      });

      const before = Date.now();
      await scheduler.checkAndDispatchDueReminders(10);

      const updated = await repo.getById(reminder.id);
      expect(updated?.attempts).toBe(2);

      const delayMs = updated!.dueAt!.getTime() - before;
      expect(delayMs).toBeGreaterThanOrEqual(290 * 1000);
      expect(delayMs).toBeLessThanOrEqual(310 * 1000);
    });

    test('Test K: Attempt 3 -> retry delay +15 minutes (900s)', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      const reminder = await repo.create(userId, 'تذكير محاولة 3', dueAt);
      const pool = (repo as any).db?.getPool?.();
      if (pool) {
        await pool.query('UPDATE reminders SET attempts = 2 WHERE id = $1', [reminder.id]);
      }

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: false,
        status: 503,
        error: { message: 'Service unavailable' },
      });

      const before = Date.now();
      await scheduler.checkAndDispatchDueReminders(10);

      const updated = await repo.getById(reminder.id);
      expect(updated?.attempts).toBe(3);

      const delayMs = updated!.dueAt!.getTime() - before;
      expect(delayMs).toBeGreaterThanOrEqual(890 * 1000);
      expect(delayMs).toBeLessThanOrEqual(910 * 1000);
    });

    test('Test L: Max attempts exceeded (>= 3) -> dead_letter', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      const reminder = await repo.create(userId, 'تذكير مستنفذ المحاولات', dueAt);
      const pool = (repo as any).db?.getPool?.();
      if (pool) {
        await pool.query('UPDATE reminders SET attempts = 3 WHERE id = $1', [reminder.id]);
      }

      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: false,
        status: 503,
        error: { message: 'Still unavailable' },
      });

      await scheduler.checkAndDispatchDueReminders(10);

      const updated = await repo.getById(reminder.id);
      expect(updated?.state).toBe('dead_letter');
      expect(updated?.lastError).toContain('Exceeded max retry attempts');
    });
  });

  // =========================================================================
  // Part 3: Idempotency & Safety Guarantees (Tests M - P)
  // =========================================================================
  describe('Part 3: Idempotency & Safety Guarantees', () => {
    test('Test M: Existing sent reminder -> never sent twice', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      const reminder = await repo.create(userId, 'تذكير تم إرساله سابقاً', dueAt);
      await repo.markSent(reminder.id, 'wamid.ALREADY_SENT_123');

      mockWhatsApp.dispatchProactiveMessage.mockClear();

      const result = await scheduler.checkAndDispatchDueReminders(10);
      expect(result.remindersDispatched).not.toContain('تذكير تم إرساله سابقاً');
      expect(mockWhatsApp.dispatchProactiveMessage).not.toHaveBeenCalled();
    });

    test('Test N: Cancelled reminder -> never dispatched', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      const reminder = await repo.create(userId, 'تذكير ملغي', dueAt);
      await repo.cancelById(reminder.id);

      mockWhatsApp.dispatchProactiveMessage.mockClear();

      const result = await scheduler.checkAndDispatchDueReminders(10);
      expect(result.remindersDispatched).not.toContain('تذكير ملغي');
      expect(mockWhatsApp.dispatchProactiveMessage).not.toHaveBeenCalled();

      const updated = await repo.getById(reminder.id);
      expect(updated?.state).toBe('cancelled');
    });

    test('Test O: Expired lease -> reminder can be reclaimed', async () => {
      const userId = `${testUserPrefix}_O`;
      const dueAt = new Date(Date.now() - 60 * 1000);

      const reminder = await repo.create(userId, 'مهمة عقد إيجار منتهي', dueAt);

      // Manually set to claimed with an expired locked_until (10s in the past)
      const pool = (repo as any).db?.getPool?.();
      if (pool) {
        await pool.query(
          "UPDATE reminders SET state = 'claimed', locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1",
          [reminder.id]
        );
      }

      const reclaimed = await repo.claimDueReminders(10, 120);
      const found = reclaimed.find((r) => r.id === reminder.id);

      expect(found).toBeDefined();
      expect(found?.state).toBe('claimed');
    });

    test('Test P: Concurrent scheduler invocations -> no duplicate delivery', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      const r1 = await repo.create(userId, 'تذكير متزامن 1', dueAt);
      const r2 = await repo.create(userId, 'تذكير متزامن 2', dueAt);

      const scheduler2 = new ReminderScheduler(
        repo,
        mockWhatsApp,
        mockChatRepo,
        mockOrchestrator,
        { batchSize: 50, leaseSeconds: 120, maxRetries: 3 }
      );

      // Launch both simultaneously
      const [res1, res2] = await Promise.all([
        scheduler.checkAndDispatchDueReminders(10),
        scheduler2.checkAndDispatchDueReminders(10),
      ]);

      const allDispatched = [...res1.remindersDispatched, ...res2.remindersDispatched];
      const countR1 = allDispatched.filter((t) => t === 'تذكير متزامن 1').length;
      const countR2 = allDispatched.filter((t) => t === 'تذكير متزامن 2').length;

      expect(countR1).toBe(1);
      expect(countR2).toBe(1);

      const u1 = await repo.getById(r1.id);
      const u2 = await repo.getById(r2.id);
      expect(u1?.state).toBe('sent');
      expect(u2?.state).toBe('sent');
    });
  });

  // =========================================================================
  // Part 4: Cron Route, Auth & Advanced Delivery Safeguards (Tests Q - T)
  // =========================================================================
  describe('Part 4: Cron Route, Auth & Advanced Delivery Safeguards', () => {
    let server: http.Server;
    let baseUrl: string;
    const testSecret = 'craft_test_cron_secret_secure_992';

    beforeAll((done) => {
      process.env.CRON_SECRET = testSecret;
      const app = createApp();
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${port}`;
        done();
      });
    });

    afterAll((done) => {
      delete process.env.CRON_SECRET;
      server.close(done);
    });

    test('Test Q: Invalid cron secret -> HTTP 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/cron/reminders`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid_secret_token_123',
        },
      });

      expect(response.status).toBe(401);
      const data = (await response.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    test('Test R: Valid cron secret -> scheduler runs, HTTP 200', async () => {
      const response = await fetch(`${baseUrl}/api/v1/cron/reminders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${testSecret}`,
          'x-trigger-source': 'test',
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.dispatchedCount).toBeDefined();
      expect(data.triggerSource).toBe('test');
    });

    test('Test S: Missed reminder beyond threshold (> 6 hours) -> dead_letter (missed_threshold_exceeded)', async () => {
      const userId = `wa_${testPhone}`;
      // 7 hours in past (> 6h threshold)
      const dueAt = new Date(Date.now() - 7 * 60 * 60 * 1000);

      const reminder = await repo.create(userId, 'تذكير قديم جدا متجاوز للنافذة', dueAt);

      mockWhatsApp.dispatchProactiveMessage.mockClear();

      const result = await scheduler.checkAndDispatchDueReminders(10);

      expect(result.remindersDispatched).not.toContain('تذكير قديم جدا متجاوز للنافذة');
      expect(mockWhatsApp.dispatchProactiveMessage).not.toHaveBeenCalled();

      const updated = await repo.getById(reminder.id);
      expect(updated?.state).toBe('dead_letter');
      expect(updated?.lastError).toContain('missed_threshold_exceeded');
    });

    test('Test T: Meta success but missing wamid -> do not mark sent', async () => {
      const userId = `wa_${testPhone}`;
      const dueAt = new Date(Date.now() - 30 * 1000);

      // Meta returns HTTP 200 / success: true, but providerMessageId is completely missing/empty!
      mockWhatsApp.dispatchProactiveMessage.mockResolvedValueOnce({
        success: true,
        status: 200,
        providerMessageId: '',
      });

      const reminder = await repo.create(userId, 'تذكير استجابة ميتا بدون معرف رسالة', dueAt);

      const result = await scheduler.checkAndDispatchDueReminders(10);

      expect(result.remindersDispatched).not.toContain('تذكير استجابة ميتا بدون معرف رسالة');

      const updated = await repo.getById(reminder.id);
      // Must NOT be marked sent!
      expect(updated?.state).not.toBe('sent');
      expect(updated?.isCompleted).toBe(false);
      expect(updated?.state).toBe('retry_pending');
      expect(updated?.lastError).toMatch(/missing.*message.*identif/i);
    });
  });
});
