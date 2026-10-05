import { isProductionDatabase, isTestDatabase, assertTestDatabaseSafety } from '../src/database/safety_guard';
import { DatabaseManager } from '../src/database/connection';
import { UserRepository } from '../src/database/repositories/user.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { ProactiveActionRepository } from '../src/modules/proactive/proactive_action.repo';
import { FAQRepository } from '../src/database/repositories/faq.repo';

describe('Phase 13.7: Test Harness & Integration Isolation Guard', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    DatabaseManager.resetForTest();
  });

  // =========================================================================
  // 1. Safety Guard URL Classification
  // =========================================================================
  describe('1. Safety Guard URL Classification', () => {
    it('isProductionDatabase identifies all production URLs correctly', () => {
      expect(isProductionDatabase('postgresql://postgres:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres')).toBe(true);
      expect(isProductionDatabase('postgresql://postgres:secret@db.supabase.co:5432/postgres')).toBe(true);
      expect(isProductionDatabase('postgresql://user:pass@ep-silent-shadow.neon.tech/neondb')).toBe(true);
      expect(isProductionDatabase('mysql://user:pass@aws.connect.psdb.cloud/main')).toBe(true);
      expect(isProductionDatabase('postgres://db-prod-cluster.internal:5432/main')).toBe(true);
      expect(isProductionDatabase('postgres://production-db.company.com:5432/craft')).toBe(true);

      // Non-production URLs
      expect(isProductionDatabase('postgresql://postgres:postgres@localhost:5432/craft_test')).toBe(false);
      expect(isProductionDatabase('postgresql://postgres:postgres@127.0.0.1:5432/craft_test')).toBe(false);
      expect(isProductionDatabase(undefined)).toBe(false);
      expect(isProductionDatabase('')).toBe(false);
    });

    it('isTestDatabase detects safe test databases and rejects production URLs', () => {
      expect(isTestDatabase('postgresql://postgres:postgres@localhost:5432/craft_test')).toBe(true);
      expect(isTestDatabase('postgresql://postgres:postgres@127.0.0.1:5432/test_db')).toBe(true);
      expect(isTestDatabase('sqlite://:memory:')).toBe(true);
      expect(isTestDatabase('mock://in-memory')).toBe(true);

      // Rejects production even if the word 'test' is in DB or query
      expect(isTestDatabase('postgresql://postgres:secret@aws-1-eu-west-1.pooler.supabase.com:5432/test_db')).toBe(false);
      expect(isTestDatabase('postgresql://user:pass@ep-silent-shadow.neon.tech/test')).toBe(false);
      expect(isTestDatabase(undefined)).toBe(false);
      expect(isTestDatabase('')).toBe(false);
    });
  });

  // =========================================================================
  // 2. assertTestDatabaseSafety Fail-Closed Guarantees
  // =========================================================================
  describe('2. assertTestDatabaseSafety Fail-Closed Guarantees', () => {
    it('throws SAFETY_VIOLATION if NODE_ENV is production', () => {
      expect(() => {
        assertTestDatabaseSafety({ nodeEnv: 'production', databaseUrl: 'postgresql://localhost:5432/test' });
      }).toThrow('SAFETY_VIOLATION: Refusing to run integration tests when NODE_ENV=production.');
    });

    it('throws SAFETY_VIOLATION if database URL is production without ALLOW_LIVE_DB_TESTS', () => {
      expect(() => {
        assertTestDatabaseSafety({
          nodeEnv: 'test',
          databaseUrl: 'postgresql://postgres:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
          allowLiveDbTests: 'false',
        });
      }).toThrow('SAFETY_VIOLATION: Refusing to run integration tests against production database URL.');
    });

    it('passes safely when database URL points to an isolated test database', () => {
      expect(() => {
        assertTestDatabaseSafety({
          nodeEnv: 'test',
          databaseUrl: 'postgresql://postgres:postgres@localhost:5432/craft_test',
        });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 3. DatabaseManager Test Mode Fail-Closed Isolation
  // =========================================================================
  describe('3. DatabaseManager Test Mode Fail-Closed Isolation', () => {
    it('isolates to in-memory mode (pool = null) when running in test mode with production DATABASE_URL and no TEST_DATABASE_URL', () => {
      DatabaseManager.resetForTest();
      delete process.env.TEST_DATABASE_URL;

      const db = DatabaseManager.getInstance();
      expect(db.getPool()).toBeNull();
      expect(db.getSupabase()).toBeNull();
    });

    it('throws SAFETY_VIOLATION if TEST_DATABASE_URL points to a production database', () => {
      DatabaseManager.resetForTest();
      process.env.TEST_DATABASE_URL = 'postgresql://postgres:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

      expect(() => {
        DatabaseManager.getInstance();
      }).toThrow('SAFETY_VIOLATION: TEST_DATABASE_URL points to a production database URL.');
    });
  });

  // =========================================================================
  // 4. Repository Shared In-Memory Store Synchronization
  // =========================================================================
  describe('4. Repository Shared In-Memory Store Synchronization', () => {
    beforeEach(() => {
      UserRepository.clearInMemoryUsers();
      ChatRepository.clearInMemory();
      ReminderRepository.clearInMemory();
      MemoryRepository.clearInMemory();
      ProactiveActionRepository.clearInMemory();
      FAQRepository.clearInMemory();
    });

    it('synchronizes users across distinct UserRepository instances', async () => {
      const repoA = new UserRepository();
      const repoB = new UserRepository();

      UserRepository.seedInMemoryUser({
        id: 'usr_iso_001',
        name: 'Isolated User',
        phoneNumber: '201099999999',
      });

      const userA = await repoA.getUserById('usr_iso_001');
      const userB = await repoB.getUserById('usr_iso_001');

      expect(userA).toBeDefined();
      expect(userB).toBeDefined();
      expect(userA?.name).toBe('Isolated User');
      expect(userB?.name).toBe('Isolated User');

      // Mutate VIP on repoA, check visible on repoB
      await repoA.setVipStatus('usr_iso_001', true);
      const userBUpdated = await repoB.getUserById('usr_iso_001');
      expect(userBUpdated?.isVip).toBe(true);

      // Toggle VIP on repoB, check visible on repoA
      await repoB.toggleVipStatus('usr_iso_001');
      const userAUpdated = await repoA.getUserById('usr_iso_001');
      expect(userAUpdated?.isVip).toBe(false);

      // Ban on repoA, check isUserBanned on repoB
      await repoA.banUser('usr_iso_001', 'Test ban');
      expect(await repoB.isUserBanned('usr_iso_001')).toBe(true);

      // Unban on repoB, check on repoA
      await repoB.unbanUser('usr_iso_001');
      expect(await repoA.isUserBanned('usr_iso_001')).toBe(false);
    });

    it('synchronizes conversations across distinct ChatRepository instances', async () => {
      const chatA = new ChatRepository();
      const chatB = new ChatRepository();

      const convA = await chatA.getOrCreateConversation('usr_iso_002', 'whatsapp', 'Test Sync');
      const convB = await chatB.getOrCreateConversation('usr_iso_002', 'whatsapp', 'Different Title');

      expect(convA.id).toBe(convB.id);
      expect(convB.title).toBe('Test Sync');
    });

    it('synchronizes reminders across distinct ReminderRepository instances', async () => {
      const remA = new ReminderRepository();
      const remB = new ReminderRepository();

      const created = await remA.create('usr_iso_003', 'Iso Reminder', new Date(Date.now() + 60000));
      const fetched = await remB.getById(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.title).toBe('Iso Reminder');

      // Admin retry resets state
      const retried = await remB.adminRetryReminder(created.id);
      expect(retried?.state).toBe('retry_pending');

      const cancelled = await remA.cancelById(created.id);
      expect(cancelled).toBe(true);

      const finalState = await remB.getById(created.id);
      expect(finalState?.state).toBe('cancelled');
    });

    it('synchronizes memory items across distinct MemoryRepository instances', async () => {
      const memA = new MemoryRepository();
      const memB = new MemoryRepository();

      const fact = await memA.saveFact('usr_iso_004', 'Prefers quiet mornings', 'preference' as any);
      const fetched = await memB.getMemoryById(fact.id);

      expect(fetched).toBeDefined();
      expect(fetched?.factText).toBe('Prefers quiet mornings');
    });

    it('synchronizes proactive actions across distinct ProactiveActionRepository instances', async () => {
      const proA = new ProactiveActionRepository();
      const proB = new ProactiveActionRepository();

      const action = await proA.createOrGet({
        userId: 'usr_iso_005',
        candidateType: 'unresolved_follow_up',
        topic: 'onboarding',
        contextDigest: 'digest_iso_1',
        reason: 'testing proactive sync',
        deliveryMode: 'out_of_turn',
        eligibleAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });

      const fetched = await proB.findById(action.id);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(action.id);
      expect(fetched?.topic).toBe('onboarding');
    });

    it('synchronizes FAQs across distinct FAQRepository instances', async () => {
      const faqA = new FAQRepository();
      const faqB = new FAQRepository();

      const allA = await faqA.getAll();
      const allB = await faqB.getAll();

      expect(allA.length).toBeGreaterThan(0);
      expect(allA.length).toBe(allB.length);
    });
  });
});
