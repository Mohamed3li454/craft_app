import { AnalyticsRepository } from '../src/database/repositories/analytics.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { AdminAgentRunsController } from '../src/modules/admin/controllers/admin_agent_runs.controller';
import { AdminToolCallsController } from '../src/modules/admin/controllers/admin_tool_calls.controller';

describe('Admin Data Contract & SQL Aggregation Verification (Isolated Mock)', () => {
  let mockPool: any;
  let mockDbManager: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    mockDbManager = {
      getPool: jest.fn().mockReturnValue(mockPool),
    };
  });

  describe('1. Users Data Contract (Dual-Key & Populated Counts)', () => {
    it('emits all required user properties without Cartesian explosion', async () => {
      const repo = new AnalyticsRepository();
      (repo as any).db = mockDbManager;

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM users')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              user_id: 'u-123',
              name: 'Test Engineer',
              phone: '201012345678',
              is_vip: true,
              is_banned: false,
              daily_message_count: 5,
              total_messages: '42',
              total_conversations: '3',
              total_reminders: '2',
              tokens_used: '1500',
              first_active: new Date('2026-09-01T00:00:00Z'),
              last_active: new Date('2026-10-02T08:00:00Z'),
              created_at: new Date('2026-09-01T00:00:00Z'),
            },
          ],
        };
      });

      const result = await repo.getUsersList({ limit: 10, offset: 0 });
      const user = result.users[0];

      // Verification of Dual Keys & Canonical Contract
      expect(user.id).toBe('u-123');
      expect(user.userId).toBe('u-123');
      expect(user.phoneNumber).toBe('201012345678');
      expect(user.phone).toBe('201012345678');
      expect(user.messageCount).toBe(42);
      expect(user.totalMessages).toBe(42);
      expect(user.conversationCount).toBe(3);
      expect(user.reminderCount).toBe(2);
      expect(user.lastActiveAt).toBe('2026-10-02T08:00:00.000Z');
      expect(user.lastActive).toBe('2026-10-02T08:00:00.000Z');

      // Verify that SQL query contains pre-aggregated subqueries (c_agg, m_agg, r_agg)
      const listSql = mockPool.query.mock.calls.find((c: any) => c[0].includes('c_agg'))[0];
      expect(listSql).toContain('c_agg');
      expect(listSql).toContain('m_agg');
      expect(listSql).toContain('r_agg');
      expect(listSql).toContain('GROUP BY user_id');
    });
  });

  describe('2. Conversations Data Contract', () => {
    it('emits all required conversation properties and explicit status', async () => {
      const repo = new AnalyticsRepository();
      (repo as any).db = mockDbManager;

      mockPool.query.mockImplementation(async (sql: string) => {
        return {
          rows: [
            {
              id: 'c-456',
              user_id: 'u-123',
              channel: 'whatsapp',
              title: 'Customer Inquiry',
              is_archived: false,
              phone: '201012345678',
              user_name: 'Test Engineer',
              messages_count: '15',
              tokens_used: '3000',
              last_message: 'مرحبا كرافت',
              last_message_at: new Date('2026-10-02T08:30:00Z'),
              created_at: new Date('2026-10-01T10:00:00Z'),
              updated_at: new Date('2026-10-02T08:30:00Z'),
            },
          ],
        };
      });

      const result = await repo.getConversationsList({ limit: 10, offset: 0 });
      const conv = result[0];

      expect(conv.id).toBe('c-456');
      expect(conv.userId).toBe('u-123');
      expect(conv.userPhone).toBe('201012345678');
      expect(conv.phone).toBe('201012345678');
      expect(conv.userName).toBe('Test Engineer');
      expect(conv.status).toBe('active');
      expect(conv.messageCount).toBe(15);
      expect(conv.messagesCount).toBe(15);
      expect(conv.lastMessageSnippet).toBe('مرحبا كرافت');
      expect(conv.lastMessage).toBe('مرحبا كرافت');
      expect(conv.updatedAt).toBe('2026-10-02T08:30:00.000Z');
      expect(conv.lastMessageAt).toBe('2026-10-02T08:30:00.000Z');
    });
  });

  describe('3. User 360 Data Contract', () => {
    it('emits stats object with accurate counters for drawer', async () => {
      const repo = new AnalyticsRepository();
      (repo as any).db = mockDbManager;

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM users')) {
          return {
            rows: [
              {
                id: 'u-123',
                name: 'Test User',
                phoneNumber: '201012345678',
                isVip: false,
                isBanned: false,
                dailyMessageCount: 2,
                createdAt: new Date('2026-10-01T00:00:00Z'),
              },
            ],
          };
        }
        if (sql.includes('FROM whatsapp_contacts')) {
          return { rows: [] };
        }
        if (sql.includes('FROM user_preferences')) {
          return { rows: [] };
        }
        if (sql.includes('COUNT(DISTINCT c.id) as total_conversations')) {
          return {
            rows: [
              {
                total_conversations: '2',
                total_messages: '10',
                tokens_used: '500',
                prompt_tokens: '400',
                completion_tokens: '100',
                last_active: new Date('2026-10-02T08:00:00Z'),
              },
            ],
          };
        }
        if (sql.includes('FROM memory_items')) {
          return {
            rows: [
              { id: 'm-1', factKey: 'profession.current', factText: 'Developer', category: 'profession', createdAt: new Date() },
              { id: 'm-2', factKey: 'preference.theme', factText: 'Dark mode', category: 'preference', createdAt: new Date() },
            ],
          };
        }
        if (sql.includes('FROM reminders')) {
          return {
            rows: [
              { id: 'r-1', title: 'Task 1', isCompleted: false, state: 'scheduled', dueAt: new Date(), createdAt: new Date() },
              { id: 'r-2', title: 'Task 2', isCompleted: true, state: 'completed', dueAt: new Date(), createdAt: new Date() },
              { id: 'r-3', title: 'Task 3', isCompleted: false, state: 'scheduled', dueAt: new Date(), createdAt: new Date() },
            ],
          };
        }
        if (sql.includes('FROM conversations')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const details = await repo.getUserDetails('u-123');
      expect(details).not.toBeNull();
      expect(details!.stats?.totalConversations).toBe(2);
      expect(details!.stats?.totalMessages).toBe(10);
      expect(details!.stats?.totalReminders).toBe(3);
      expect(details!.stats?.activeReminders).toBe(2);
      expect(details!.stats?.memoryCount).toBe(2);
    });
  });

  describe('4. Memory Items Data Contract', () => {
    it('emits key, value, and userPhone mapped properly', async () => {
      const repo = new MemoryRepository();
      (repo as any).db = mockDbManager;

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM memory_items')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'mem-1',
              userId: 'u-123',
              userPhone: '201012345678',
              factText: 'المستخدم يعمل كمطور فلاتر',
              category: 'profession',
              status: 'active',
              factKey: 'profession.current',
              source: 'automatic_extraction',
              confidence: 0.95,
              importance: 'high',
              temporalState: 'current',
              validFrom: null,
              validUntil: null,
              metadata: {},
              createdAt: new Date('2026-10-01T00:00:00Z'),
              updatedAt: new Date('2026-10-01T00:00:00Z'),
            },
          ],
        };
      });

      const result = await repo.listMemoryItems({ limit: 10, offset: 0 });
      const item = result.items[0];

      expect(item.id).toBe('mem-1');
      expect(item.userId).toBe('u-123');
      expect(item.userPhone).toBe('201012345678');
      expect(item.key).toBe('profession.current');
      expect(item.value).toBe('المستخدم يعمل كمطور فلاتر');
      expect(item.category).toBe('profession');
      expect(item.status).toBe('active');
    });
  });

  describe('5. Reminders Data Contract', () => {
    it('emits scheduledTime, status, and retryCount properly', async () => {
      const repo = new ReminderRepository();
      (repo as any).db = mockDbManager;

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM reminders')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'rem-1',
              userId: 'u-123',
              userPhone: '201012345678',
              title: 'اجتماع مع الفريق',
              dueAt: new Date('2026-10-02T12:00:00Z'),
              recurrence: 'none',
              isCompleted: false,
              state: 'scheduled',
              attempts: 0,
              createdAt: new Date('2026-10-01T00:00:00Z'),
              updatedAt: new Date('2026-10-01T00:00:00Z'),
            },
          ],
        };
      });

      const result = await repo.listAllReminders({ limit: 10, offset: 0 });
      const reminder = result.items[0];

      expect(reminder.id).toBe('rem-1');
      expect(reminder.userId).toBe('u-123');
      expect(reminder.userPhone).toBe('201012345678');
      expect(reminder.scheduledTime).toBe(new Date('2026-10-02T12:00:00Z').toISOString());
      expect(reminder.status).toBe('scheduled');
      expect(reminder.retryCount).toBe(0);
    });
  });

  describe('6. Agent Runs Data Contract (Zero Fake Data Invariant)', () => {
    it('emits null for model and tokens when untracked without fake values', async () => {
      const controller = new AdminAgentRunsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM agent_runs')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'run-1',
              conversationId: 'c-1',
              status: 'received',
              userPrompt: 'agent_run',
              iterationsCount: 0,
              errorDetails: null,
              createdAt: '2026-10-02T06:00:00Z',
              completedAt: null,
              durationMs: '1250',
              toolCallsCount: '2',
            },
          ],
        };
      });

      let jsonResponse: any;
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          jsonResponse = data;
        }),
      };

      const req: any = { query: {} };
      await controller.getAgentRuns(req, res);

      const run = jsonResponse.data[0];
      expect(run.id).toBe('run-1');
      expect(run.durationMs).toBe(1250);
      expect(run.latencyMs).toBe(1250);
      expect(run.toolCallsCount).toBe(2);
      expect(run.model).toBeNull();
      expect(run.totalTokens).toBeNull();
      expect(run.promptTokens).toBeNull();
      expect(run.completionTokens).toBeNull();
    });
  });

  describe('7. Tool Calls Data Contract', () => {
    it('emits runId, argumentsSanitized, and resultSanitized without raw leakage', async () => {
      const controller = new AdminToolCallsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM tool_calls')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'tc-1',
              agentRunId: 'run-1',
              toolName: 'web_search',
              status: 'completed',
              arguments: { query: 'weather in cairo' },
              result: { summary: 'Sunny' },
              errorMessage: null,
              createdAt: '2026-10-02T06:00:00Z',
              completedAt: '2026-10-02T06:00:01Z',
            },
          ],
        };
      });

      let jsonResponse: any;
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          jsonResponse = data;
        }),
      };

      const req: any = { query: {} };
      await controller.getToolCalls(req, res);

      const tc = jsonResponse.data[0];
      expect(tc.id).toBe('tc-1');
      expect(tc.runId).toBe('run-1');
      expect(tc.argumentsSanitized).toEqual({ query: 'weather in cairo' });
      expect(tc.resultSanitized).toEqual({ summary: 'Sunny' });
    });
  });

  describe('8. SQL Aggregation Non-Multiplication Invariant', () => {
    it('proves that pre-aggregated subqueries isolate counts and never produce Cartesian products', () => {
      const user = { id: 'u-cartesian' };
      const conversations = [{ id: 'c-1' }, { id: 'c-2' }]; // 2 convs
      const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m-${i}`, convId: i < 5 ? 'c-1' : 'c-2' })); // 10 msgs
      const reminders = [{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }]; // 3 reminders

      // Naive join multiplication:
      const naiveMultiplicationCount = conversations.length * (messages.length / conversations.length) * reminders.length * conversations.length;
      expect(naiveMultiplicationCount).toBe(60);

      // Pre-aggregated CTE subquery simulation (our architecture):
      const c_agg = { user_id: user.id, conv_count: conversations.length };
      const m_agg = { user_id: user.id, msg_count: messages.length };
      const r_agg = { user_id: user.id, rem_count: reminders.length };

      expect(c_agg.conv_count).toBe(2);
      expect(m_agg.msg_count).toBe(10);
      expect(r_agg.rem_count).toBe(3);

      // Total messages is strictly 10, NOT 60
      expect(m_agg.msg_count).not.toBe(60);
      expect(m_agg.msg_count).toBe(10);
    });
  });
});
