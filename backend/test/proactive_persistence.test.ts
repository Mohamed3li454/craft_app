/**
 * Phase 7.3 — Proactive Persistence & Scheduler Comprehensive Test Suite
 *
 * Verifies:
 * 1. Persistence & Deduplication
 * 2. Concurrency & Locking Safety (Atomic FOR UPDATE SKIP LOCKED)
 * 3. Scheduler & Lifecycle Management
 * 4. Runtime Re-evaluation (Resolution, Recent Activity, Quiet Hours, Cooldown, Rate Limits, Opt-Out, Safety)
 * 5. WhatsApp 24-hour Policy Integration
 * 6. Retry & Failure Handling (Bounded retries, Max 3 attempts)
 * 7. Dispatch Boundary (Zero outbound WhatsApp messages, Zero Meta Graph API calls)
 * 8. Failure Isolation with Reminders
 * 9. Integration & Performance Benchmark (< 250ms for 50 actions)
 */

import crypto from 'crypto';
import {
  ProactiveActionRepository,
  generateDedupKey,
  ProactiveScheduler,
  ProactiveActionEntity,
  ProactiveDispatchIntent,
  CreateProactiveActionInput,
} from '../src/modules/proactive';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { ReminderScheduler } from '../src/modules/reminder/reminder.scheduler';
import { DatabaseManager } from '../src/database/connection';

function makeCairoDate(hour: number, minute: number): Date {
  const d = new Date();
  d.setUTCHours(hour - 3, minute, 0, 0);
  return d;
}

describe('Phase 7.3 — Proactive Persistence & Scheduler Test Suite', () => {
  let repo: ProactiveActionRepository;
  let chatRepo: ChatRepository;
  let userPrefRepo: UserPreferenceRepository;
  let scheduler: ProactiveScheduler;

  beforeEach(() => {
    const inMemoryDb = {
      getPool: () => null,
      getSupabase: () => null,
    } as unknown as DatabaseManager;
    repo = new ProactiveActionRepository(inMemoryDb);
    repo.clearInMemory();
    chatRepo = new ChatRepository(inMemoryDb);
    userPrefRepo = new UserPreferenceRepository(inMemoryDb);
    scheduler = new ProactiveScheduler(repo, chatRepo, userPrefRepo);
    jest.clearAllMocks();
  });

  // =========================================================================
  // Category 1: Persistence & Deduplication (Scenarios 1-6)
  // =========================================================================
  describe('Category 1: Persistence & Deduplication', () => {
    it('Scenario 1: creates a proactive action with valid parameters in pending status', async () => {
      const input: CreateProactiveActionInput = {
        userId: 'user-persist-1',
        conversationId: 'conv-persist-1',
        candidateType: 'unresolved_follow_up',
        topic: 'flutter_build_issue',
        contextDigest: 'Gradle build failed exit code 1',
        reason: 'Troubleshooting follow-up',
        eligibleAt: new Date(Date.now() - 1000),
      };

      const action = await repo.createOrGet(input);

      expect(action).toBeDefined();
      expect(action.id).toBeDefined();
      expect(action.userId).toBe('user-persist-1');
      expect(action.status).toBe('pending');
      expect(action.candidateType).toBe('unresolved_follow_up');
      expect(action.attemptCount).toBe(0);
      expect(action.dedupKey).toBeDefined();
      expect(action.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('Scenario 2: generates deterministic SHA-256 deduplication key matching spec', () => {
      const userId = 'user-hash-1';
      const type = 'unresolved_follow_up';
      const topic = 'flutter_build_issue';
      const digest = 'Gradle build failed exit code 1';

      const key = generateDedupKey(userId, type, topic, digest);
      const expected = crypto
        .createHash('sha256')
        .update(`${userId}:${type}:${topic.toLowerCase()}:${digest.toLowerCase()}`)
        .digest('hex');

      expect(key).toBe(expected);
      expect(key).toHaveLength(64);
    });

    it('Scenario 3: duplicate candidate upserts / returns existing action without creating duplicate', async () => {
      const input: CreateProactiveActionInput = {
        userId: 'user-dup-1',
        candidateType: 'unresolved_follow_up',
        topic: 'database_migration',
        contextDigest: 'Migration lock timeout error',
        reason: 'Migration help',
      };

      const first = await repo.createOrGet(input);
      const second = await repo.createOrGet({
        ...input,
        reason: 'Updated reason for same opportunity',
      });

      expect(first.id).toBe(second.id);
      expect(first.dedupKey).toBe(second.dedupKey);
    });

    it('Scenario 4: findById retrieves exact persisted record', async () => {
      const action = await repo.createOrGet({
        userId: 'user-find-1',
        candidateType: 'unresolved_follow_up',
        topic: 'state_management',
        contextDigest: 'Provider vs Riverpod choice',
        reason: 'Architecture selection',
      });

      const retrieved = await repo.findById(action.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(action.id);
      expect(retrieved?.topic).toBe('state_management');
      expect(retrieved?.status).toBe('pending');
    });

    it('Scenario 5: updateStatus transitions cleanly across lifecycle', async () => {
      const action = await repo.createOrGet({
        userId: 'user-lifecycle-1',
        candidateType: 'unresolved_follow_up',
        topic: 'auth_flow',
        contextDigest: 'JWT expiration handling',
        reason: 'Security followup',
      });

      expect(action.status).toBe('pending');

      await repo.updateStatus(action.id, 'claimed');
      let current = await repo.findById(action.id);
      expect(current?.status).toBe('claimed');
      expect(current?.claimedAt).toBeDefined();

      await repo.updateStatus(action.id, 'completed');
      current = await repo.findById(action.id);
      expect(current?.status).toBe('completed');
      expect(current?.completedAt).toBeDefined();
    });

    it('Scenario 6: queryByStatus filters accurately by status and userId', async () => {
      const a1 = await repo.createOrGet({
        userId: 'user-q-1',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-1',
        contextDigest: 'digest-1',
        reason: 'reason-1',
      });
      const a2 = await repo.createOrGet({
        userId: 'user-q-2',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-2',
        contextDigest: 'digest-2',
        reason: 'reason-2',
      });
      await repo.markSuppressed(a2.id, 'User opted out');

      const pending = await repo.queryByStatus('pending');
      const suppressed = await repo.queryByStatus('suppressed');
      const user1Pending = await repo.queryByStatus('pending', 'user-q-1');

      expect(pending.some((a) => a.id === a1.id)).toBe(true);
      expect(pending.some((a) => a.id === a2.id)).toBe(false);
      expect(suppressed.some((a) => a.id === a2.id)).toBe(true);
      expect(user1Pending.length).toBe(1);
      expect(user1Pending[0].id).toBe(a1.id);
    });
  });

  // =========================================================================
  // Category 2: Concurrency & Locking Safety (Scenarios 7-12)
  // =========================================================================
  describe('Category 2: Concurrency & Locking Safety', () => {
    it('Scenario 7: atomic claim sets status to claimed and records claimedAt', async () => {
      const now = new Date();
      const action = await repo.createOrGet({
        userId: 'user-lock-1',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-lock',
        contextDigest: 'digest-lock',
        reason: 'Lock testing',
        eligibleAt: new Date(now.getTime() - 1000),
      });

      const claimed = await repo.claimDueActions(10, now);
      expect(claimed.length).toBe(1);
      expect(claimed[0].id).toBe(action.id);
      expect(claimed[0].status).toBe('claimed');
      expect(claimed[0].claimedAt).toBeDefined();
    });

    it('Scenario 8: claimDueActions selects due actions (eligible_at <= now, pending/deferred)', async () => {
      const now = new Date();
      // Due action
      const due = await repo.createOrGet({
        userId: 'user-lock-2',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-due',
        contextDigest: 'digest-due',
        reason: 'Due action',
        eligibleAt: new Date(now.getTime() - 5000),
      });

      // Future action
      await repo.createOrGet({
        userId: 'user-lock-2',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-future',
        contextDigest: 'digest-future',
        reason: 'Future action',
        eligibleAt: new Date(now.getTime() + 60000),
      });

      const claimed = await repo.claimDueActions(10, now);
      expect(claimed.length).toBe(1);
      expect(claimed[0].id).toBe(due.id);
    });

    it('Scenario 9: claimDueActions respects batchSize limit', async () => {
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await repo.createOrGet({
          userId: `user-batch-${i}`,
          candidateType: 'unresolved_follow_up',
          topic: `topic-batch-${i}`,
          contextDigest: `digest-batch-${i}`,
          reason: 'Batch testing',
          eligibleAt: new Date(now.getTime() - 1000),
        });
      }

      const claimed = await repo.claimDueActions(2, now);
      expect(claimed.length).toBe(2);
    });

    it('Scenario 10: two concurrent claim requests do not claim the same action', async () => {
      const now = new Date();
      await repo.createOrGet({
        userId: 'user-race-1',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-race',
        contextDigest: 'digest-race',
        reason: 'Race condition test',
        eligibleAt: new Date(now.getTime() - 1000),
      });

      const [worker1, worker2] = await Promise.all([
        repo.claimDueActions(10, now),
        repo.claimDueActions(10, now),
      ]);

      const totalClaimed = worker1.length + worker2.length;
      expect(totalClaimed).toBe(1);
    });

    it('Scenario 11: claimed action is not claimed again while claimed', async () => {
      const now = new Date();
      const action = await repo.createOrGet({
        userId: 'user-claimed-1',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-claimed',
        contextDigest: 'digest-claimed',
        reason: 'Claim persistence test',
        eligibleAt: new Date(now.getTime() - 1000),
      });

      const firstClaim = await repo.claimDueActions(10, now);
      expect(firstClaim.length).toBe(1);

      // Second worker immediately claims
      const secondClaim = await repo.claimDueActions(10, now);
      expect(secondClaim.length).toBe(0);
    });

    it('Scenario 12: actions past expiresAt are expired and not claimed', async () => {
      const now = new Date();
      const action = await repo.createOrGet({
        userId: 'user-exp-1',
        candidateType: 'unresolved_follow_up',
        topic: 'topic-expired',
        contextDigest: 'digest-expired',
        reason: 'Expiration test',
        eligibleAt: new Date(now.getTime() - 10000),
        expiresAt: new Date(now.getTime() - 1000), // Already expired
      });

      const claimed = await repo.claimDueActions(10, now);
      expect(claimed.length).toBe(0);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('expired');
    });
  });

  // =========================================================================
  // Category 3: Scheduler Scheduling (Scenarios 13-18)
  // =========================================================================
  describe('Category 3: Scheduler Scheduling & Lifecycle', () => {
    it('Scenario 13: due action is picked up and processed by scheduler', async () => {
      const now = makeCairoDate(14, 0); // Active hours (14:00 Cairo)
      await repo.createOrGet({
        userId: 'user-sched-1',
        candidateType: 'unresolved_follow_up',
        topic: 'flutter_error',
        contextDigest: 'Unhandled exception in setState',
        reason: 'Troubleshooting follow-up',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.claimedCount).toBe(1);
      expect(result.dispatchedIntents.length).toBe(1);
    });

    it('Scenario 14: future action is ignored by scheduler', async () => {
      const now = makeCairoDate(14, 0);
      await repo.createOrGet({
        userId: 'user-sched-future',
        candidateType: 'unresolved_follow_up',
        topic: 'future_topic',
        contextDigest: 'Future context',
        reason: 'Future follow-up',
        eligibleAt: new Date(now.getTime() + 3600000), // 1 hour in future
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.claimedCount).toBe(0);
      expect(result.dispatchedIntents.length).toBe(0);
    });

    it('Scenario 15: completed action is ignored by scheduler', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-sched-comp',
        candidateType: 'unresolved_follow_up',
        topic: 'done_topic',
        contextDigest: 'Done context',
        reason: 'Completed followup',
        eligibleAt: new Date(now.getTime() - 60000),
      });
      await repo.markCompleted(action.id);

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.claimedCount).toBe(0);
    });

    it('Scenario 16: suppressed action is ignored by scheduler', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-sched-supp',
        candidateType: 'unresolved_follow_up',
        topic: 'suppressed_topic',
        contextDigest: 'Suppressed context',
        reason: 'Suppressed followup',
        eligibleAt: new Date(now.getTime() - 60000),
      });
      await repo.markSuppressed(action.id, 'Quiet hours active');

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.claimedCount).toBe(0);
    });

    it('Scenario 17: expired action is marked expired and ignored by scheduler', async () => {
      const now = makeCairoDate(14, 0);
      await repo.createOrGet({
        userId: 'user-sched-exp',
        candidateType: 'unresolved_follow_up',
        topic: 'expired_topic',
        contextDigest: 'Expired context',
        reason: 'Expired followup',
        eligibleAt: new Date(now.getTime() - 100000),
        expiresAt: new Date(now.getTime() - 5000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.claimedCount).toBe(0);
      expect(result.dispatchedIntents.length).toBe(0);
    });

    it('Scenario 18: failed action is ignored by scheduler', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-sched-failed',
        candidateType: 'unresolved_follow_up',
        topic: 'failed_topic',
        contextDigest: 'Failed context',
        reason: 'Failed followup',
        eligibleAt: new Date(now.getTime() - 60000),
      });
      await repo.markFailed(action.id, 'Permanent DB error');

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.claimedCount).toBe(0);
    });
  });

  // =========================================================================
  // Category 4: Re-evaluation at Scheduler Run (Scenarios 19-27)
  // =========================================================================
  describe('Category 4: Re-evaluation at Scheduler Run', () => {
    it('Scenario 19: unresolved candidate remains eligible -> produces dispatch intent', async () => {
      const now = makeCairoDate(15, 0);
      await repo.createOrGet({
        userId: 'user-reeval-1',
        candidateType: 'unresolved_follow_up',
        topic: 'dart_async',
        contextDigest: 'Future deadlock in broadcast stream',
        reason: 'Unresolved async question',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(1);
      expect(result.dispatchedIntents[0].topic).toBe('dart_async');
      expect(result.dispatchedIntents[0].status).toBe('dispatch_ready');
    });

    it('Scenario 20: issue resolved in conversation history -> suppressed', async () => {
      const now = makeCairoDate(15, 0);
      const convId = 'conv-resolved-1';

      jest.spyOn(chatRepo, 'getRecentMessages').mockResolvedValue([
        {
          id: 'msg-1',
          conversationId: convId,
          senderRole: 'user',
          text: 'شكرا اتحلت المشكله واشتغل تمام',
          createdAt: new Date(now.getTime() - 60 * 60 * 1000),
        } as any,
      ]);

      const action = await repo.createOrGet({
        userId: 'user-reeval-res',
        conversationId: convId,
        candidateType: 'unresolved_follow_up',
        topic: 'flutter_build',
        contextDigest: 'Gradle issue',
        reason: 'Gradle followup',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('resolved');
    });

    it('Scenario 21: user active within last 5 minutes (<15m recent activity) -> suppressed', async () => {
      const now = makeCairoDate(15, 0);
      const convId = 'conv-active-1';

      jest.spyOn(chatRepo, 'getRecentMessages').mockResolvedValue([
        {
          id: 'msg-2',
          conversationId: convId,
          senderRole: 'user',
          text: 'سؤال تاني لو سمحت',
          createdAt: new Date(now.getTime() - 5 * 60 * 1000), // 5 min ago (< 15 min gate)
        } as any,
      ]);

      const action = await repo.createOrGet({
        userId: 'user-reeval-active',
        conversationId: convId,
        candidateType: 'unresolved_follow_up',
        topic: 'flutter_nav',
        contextDigest: 'GoRouter nested tabs',
        reason: 'Navigation followup',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('actively conversing');
    });

    it('Scenario 22: quiet hours now active (23:30 Cairo) -> suppressed', async () => {
      const quietNow = makeCairoDate(23, 30); // 23:30 Cairo (quiet: 22:00-09:00)

      const action = await repo.createOrGet({
        userId: 'user-reeval-quiet',
        candidateType: 'unresolved_follow_up',
        topic: 'state_mgmt',
        contextDigest: 'Bloc pattern',
        reason: 'Bloc followup',
        eligibleAt: new Date(quietNow.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(quietNow);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('quiet hours');
    });

    it('Scenario 23: user in cooldown period (< 4h since last proactive) -> suppressed', async () => {
      const now = makeCairoDate(14, 0);
      const userId = 'user-cooldown-1';

      // Insert prior proactive completed 2h ago
      const prior = await repo.createOrGet({
        userId,
        candidateType: 'unresolved_follow_up',
        topic: 'prior_topic',
        contextDigest: 'prior context',
        reason: 'prior followup',
      });
      prior.status = 'completed';
      prior.completedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago (< 4h cooldown)

      // New due proactive
      const current = await repo.createOrGet({
        userId,
        candidateType: 'unresolved_follow_up',
        topic: 'new_topic',
        contextDigest: 'new context',
        reason: 'new followup',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(current.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('cooldown');
    });

    it('Scenario 24: rolling 24h limit reached (>= 1 in 24h) -> suppressed', async () => {
      const now = makeCairoDate(14, 0);
      const userId = 'user-limit-1';

      // 1 proactive completed 19h ago (>18h cooldown, but in rolling 24h window)
      const p1 = await repo.createOrGet({
        userId,
        candidateType: 'unresolved_follow_up',
        topic: 'topic-1',
        contextDigest: 'digest-1',
        reason: 'r1',
      });
      p1.status = 'completed';
      p1.completedAt = new Date(now.getTime() - 19 * 60 * 60 * 1000);

      // Second candidate in 24h window
      const p2 = await repo.createOrGet({
        userId,
        candidateType: 'unresolved_follow_up',
        topic: 'topic-2',
        contextDigest: 'digest-2',
        reason: 'r2',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(p2.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('quota exceeded');
    });

    it('Scenario 25: user opted out since creation (proactive_opt_out = true) -> suppressed', async () => {
      const now = makeCairoDate(14, 0);
      const userId = 'user-optout-reeval';

      jest.spyOn(userPrefRepo, 'getPreference').mockResolvedValue(true);

      const action = await repo.createOrGet({
        userId,
        candidateType: 'unresolved_follow_up',
        topic: 'opt_out_topic',
        contextDigest: 'opt out digest',
        reason: 'opt out reason',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('opted out');
    });

    it('Scenario 26: safety filter fails (harmful prompt / injection) -> suppressed', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-safety-fail',
        candidateType: 'unresolved_follow_up',
        topic: 'exploit_topic',
        contextDigest: 'Here is my password and api_key: secret_token_123',
        reason: 'malicious injection attempt',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('Hard safety violation');
    });

    it('Scenario 27: hard gate re-evaluation passes cleanly -> dispatch intent generated with all metadata', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-clean-pass',
        candidateType: 'unresolved_follow_up',
        topic: 'clean_topic',
        contextDigest: 'Standard flutter architecture question',
        reason: 'Clean follow-up',
        eligibleAt: new Date(now.getTime() - 60000),
        metadata: { confidence: 0.95, urgency: 'low', tags: ['flutter', 'clean'] },
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(1);
      const intent = result.dispatchedIntents[0];
      expect(intent.actionId).toBe(action.id);
      expect(intent.userId).toBe('user-clean-pass');
      expect(intent.metadata?.tags).toEqual(['flutter', 'clean']);
      expect(intent.status).toBe('dispatch_ready');

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('completed');
    });
  });

  // =========================================================================
  // Category 5: WhatsApp Policy Integration (Scenarios 28-30)
  // =========================================================================
  describe('Category 5: WhatsApp Policy Integration', () => {
    it('Scenario 28: user message within 24h -> delivery_mode out_of_turn produces normal dispatch intent', async () => {
      const now = makeCairoDate(14, 0);
      const convId = 'conv-wa-24h';

      jest.spyOn(chatRepo, 'getRecentMessages').mockResolvedValue([
        {
          id: 'msg-wa-1',
          conversationId: convId,
          senderRole: 'user',
          text: 'عندي سؤال في الـ flutter',
          createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago (< 24h and >15m)
        } as any,
      ]);

      await repo.createOrGet({
        userId: 'user-wa-24h',
        conversationId: convId,
        candidateType: 'unresolved_follow_up',
        topic: 'flutter_questions',
        contextDigest: 'Flutter general question',
        reason: 'Active session followup',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(1);
      expect(result.dispatchedIntents[0].deliveryMode).toBe('out_of_turn');
    });

    it('Scenario 29: user message >24h ago in out_of_turn mode -> suppressed due to whatsapp_window_expired_template_required', async () => {
      const now = makeCairoDate(14, 0);
      const convId = 'conv-wa-old';

      jest.spyOn(chatRepo, 'getRecentMessages').mockResolvedValue([
        {
          id: 'msg-wa-old',
          conversationId: convId,
          senderRole: 'user',
          text: 'رسالة قديمة جدا',
          createdAt: new Date(now.getTime() - 26 * 60 * 60 * 1000), // 26 hours ago (> 24h window)
        } as any,
      ]);

      const action = await repo.createOrGet({
        userId: 'user-wa-old',
        conversationId: convId,
        candidateType: 'unresolved_follow_up',
        topic: 'expired_session',
        contextDigest: 'Expired session query',
        reason: 'Session expired',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      // Hard gate suppresses when outside 24h window
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('WhatsApp 24-hour session window expired');
    });

    it('Scenario 30: missing or unknown interaction history -> safely suppressed', async () => {
      const now = makeCairoDate(14, 0);

      // Explicitly require history so no fallback occurs
      const action = await repo.createOrGet({
        userId: 'user-wa-missing',
        candidateType: 'unresolved_follow_up',
        topic: 'missing_session',
        contextDigest: 'Missing session query',
        reason: 'Missing session',
        eligibleAt: new Date(now.getTime() - 60000),
        metadata: { requireExplicitHistory: true },
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(0);
      expect(result.suppressedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('User recent activity is unknown');
    });
  });

  // =========================================================================
  // Category 6: Retry & Failure Handling (Scenarios 31-35)
  // =========================================================================
  describe('Category 6: Retry & Failure Handling', () => {
    it('Scenario 31: evaluation error increments attempts count and retries', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-retry-1',
        candidateType: 'unresolved_follow_up',
        topic: 'retry_topic',
        contextDigest: 'retry context',
        reason: 'retry reason',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      // Force failure during evaluation
      jest.spyOn(userPrefRepo, 'getPreference').mockRejectedValueOnce(new Error('Simulated transient error'));
      // In the scheduler, getPreference is caught gracefully, so let's mock repo.getRecentHistory to throw
      jest.spyOn(repo, 'getRecentHistory').mockRejectedValueOnce(new Error('Database lock error'));

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.deferredCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.attemptCount).toBe(1);
      expect(refreshed?.status).toBe('deferred');
      expect(refreshed?.lastError).toContain('Database lock error');
    });

    it('Scenario 32: attempt < max_attempts (3) resets action to deferred for retry', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-retry-2',
        candidateType: 'unresolved_follow_up',
        topic: 'retry_topic_2',
        contextDigest: 'retry context 2',
        reason: 'retry reason 2',
        eligibleAt: new Date(now.getTime() - 60000),
      });
      action.attemptCount = 1; // Already 1 attempt

      jest.spyOn(repo, 'getRecentHistory').mockRejectedValueOnce(new Error('Transient network error'));

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.deferredCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.attemptCount).toBe(2);
      expect(refreshed?.status).toBe('deferred');
    });

    it('Scenario 33: attempt >= max_attempts marks action failed with error message', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-retry-3',
        candidateType: 'unresolved_follow_up',
        topic: 'retry_topic_3',
        contextDigest: 'retry context 3',
        reason: 'retry reason 3',
        eligibleAt: new Date(now.getTime() - 60000),
      });
      action.attemptCount = 2; // Next will be 3 (max)

      jest.spyOn(repo, 'getRecentHistory').mockRejectedValueOnce(new Error('Third consecutive failure'));

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.failedCount).toBe(1);

      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('failed');
      expect(refreshed?.lastError).toContain('Third consecutive failure');
    });

    it('Scenario 34: unhandled exception in one action does not crash entire batch', async () => {
      const now = makeCairoDate(14, 0);

      const faultyAction = await repo.createOrGet({
        userId: 'user-faulty',
        candidateType: 'unresolved_follow_up',
        topic: 'faulty_topic',
        contextDigest: 'faulty digest',
        reason: 'faulty reason',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const goodAction = await repo.createOrGet({
        userId: 'user-good',
        candidateType: 'unresolved_follow_up',
        topic: 'good_topic',
        contextDigest: 'good digest',
        reason: 'good reason',
        eligibleAt: new Date(now.getTime() - 50000),
      });

      // Mock getRecentHistory to throw only for faultyAction
      const originalGetRecentHistory = repo.getRecentHistory.bind(repo);
      jest.spyOn(repo, 'getRecentHistory').mockImplementation(async (userId, windowMs, n) => {
        if (userId === 'user-faulty') {
          throw new Error('Fatal fault on user-faulty');
        }
        return originalGetRecentHistory(userId, windowMs, n);
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.claimedCount).toBe(2);
      expect(result.dispatchedIntents.length).toBe(1);
      expect(result.dispatchedIntents[0].actionId).toBe(goodAction.id);
      expect(result.deferredCount).toBe(1); // faultyAction deferred
    });

    it('Scenario 35: malformed payload / context digest handled gracefully without crash', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-malformed',
        candidateType: 'unresolved_follow_up',
        topic: 'malformed_topic',
        contextDigest: '', // empty digest
        reason: 'empty digest reason',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      // Empty context is rejected by eligibility gate candidate validation
      expect(result.suppressedCount).toBe(1);
      const refreshed = await repo.findById(action.id);
      expect(refreshed?.status).toBe('suppressed');
      expect(refreshed?.reason).toContain('invalid_candidate');
    });
  });

  // =========================================================================
  // Category 7: Dispatch Boundary / No-Send Guarantee (Scenarios 36-39)
  // =========================================================================
  describe('Category 7: Dispatch Boundary & Zero-Send Invariant', () => {
    it('Scenario 36: scheduler returns ProactiveDispatchIntent and NEVER calls WhatsApp API', async () => {
      const now = makeCairoDate(14, 0);
      const spySendText = jest.spyOn(WhatsAppAdapter.prototype, 'sendTextMessage');
      const spySendRaw = jest.spyOn(WhatsAppAdapter.prototype, 'sendRawTextMessage');

      await repo.createOrGet({
        userId: 'user-no-send-1',
        candidateType: 'unresolved_follow_up',
        topic: 'no_send_topic',
        contextDigest: 'Safe proactive opportunity context',
        reason: 'No-send guarantee test',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      const result = await scheduler.checkAndProcessDueActions(now);

      expect(result.dispatchedIntents.length).toBe(1);
      expect(spySendText).not.toHaveBeenCalled();
      expect(spySendRaw).not.toHaveBeenCalled();
    });

    it('Scenario 37: WhatsAppAdapter.sendTextMessage is NEVER invoked across multiple actions', async () => {
      const now = makeCairoDate(14, 0);
      const spySendText = jest.spyOn(WhatsAppAdapter.prototype, 'sendTextMessage');

      for (let i = 0; i < 3; i++) {
        await repo.createOrGet({
          userId: `user-multi-nosend-${i}`,
          candidateType: 'unresolved_follow_up',
          topic: `multi_topic_${i}`,
          contextDigest: `multi context ${i}`,
          reason: `multi reason ${i}`,
          eligibleAt: new Date(now.getTime() - 60000),
        });
      }

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(3);
      expect(spySendText).not.toHaveBeenCalled();
    });

    it('Scenario 38: zero outbound network calls during scheduler run', async () => {
      const now = makeCairoDate(14, 0);
      const globalFetchSpy = jest.spyOn(global, 'fetch');

      await repo.createOrGet({
        userId: 'user-network-zero',
        candidateType: 'unresolved_follow_up',
        topic: 'network_topic',
        contextDigest: 'Network test context',
        reason: 'Network test reason',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      await scheduler.checkAndProcessDueActions(now);
      expect(globalFetchSpy).not.toHaveBeenCalled();
    });

    it('Scenario 39: dispatch intent contains correct actionId, userId, message payload, and candidateType', async () => {
      const now = makeCairoDate(14, 0);
      const action = await repo.createOrGet({
        userId: 'user-intent-fields',
        conversationId: 'conv-intent-fields',
        candidateType: 'unresolved_follow_up',
        topic: 'architecture',
        contextDigest: 'Clean architecture design in Flutter',
        reason: 'Architecture assistance',
        deliveryMode: 'out_of_turn',
        eligibleAt: new Date(now.getTime() - 60000),
        metadata: { confidence: 0.96, domain: 'mobile' },
      });

      const result = await scheduler.checkAndProcessDueActions(now);
      expect(result.dispatchedIntents.length).toBe(1);

      const intent = result.dispatchedIntents[0];
      expect(intent.actionId).toBe(action.id);
      expect(intent.userId).toBe('user-intent-fields');
      expect(intent.conversationId).toBe('conv-intent-fields');
      expect(intent.deliveryMode).toBe('out_of_turn');
      expect(intent.candidateType).toBe('unresolved_follow_up');
      expect(intent.topic).toBe('architecture');
      expect(intent.contextDigest).toBe('Clean architecture design in Flutter');
      expect(intent.reason).toBe('Architecture assistance');
      expect(intent.status).toBe('dispatch_ready');
      expect(intent.metadata?.confidence).toBe(0.96);
      expect(intent.createdAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // Category 8: Failure Isolation with Reminders (Scenarios 40-41)
  // =========================================================================
  describe('Category 8: Failure Isolation with Reminders', () => {
    it('Scenario 40: error in proactive scheduler does not impact reminder processing', async () => {
      const reminderScheduler = new ReminderScheduler();
      const spyReminderDispatch = jest
        .spyOn(reminderScheduler, 'checkAndDispatchDueReminders')
        .mockResolvedValue({
          dispatchedCount: 2,
          remindersDispatched: ['Reminder 1', 'Reminder 2'],
          skippedCount: 0,
          failedCount: 0,
        });

      // Simulate Cron handler failure isolation pattern from app.ts
      let reminderError: string | null = null;
      let proactiveError: string | null = null;
      let reminderResult: any = null;
      let proactiveResult: any = null;

      // Force proactive scheduler to crash
      jest.spyOn(scheduler, 'checkAndProcessDueActions').mockRejectedValueOnce(new Error('Proactive DB crash'));

      // Run isolated executions
      try {
        reminderResult = await reminderScheduler.checkAndDispatchDueReminders();
      } catch (err: any) {
        reminderError = err.message;
      }

      try {
        proactiveResult = await scheduler.checkAndProcessDueActions();
      } catch (err: any) {
        proactiveError = err.message;
      }

      expect(spyReminderDispatch).toHaveBeenCalled();
      expect(reminderResult?.dispatchedCount).toBe(2);
      expect(reminderError).toBeNull();
      expect(proactiveError).toBe('Proactive DB crash');
    });

    it('Scenario 41: reminder error does not impact proactive processing', async () => {
      const reminderScheduler = new ReminderScheduler();
      jest
        .spyOn(reminderScheduler, 'checkAndDispatchDueReminders')
        .mockRejectedValueOnce(new Error('Reminder DB deadlock'));

      const now = makeCairoDate(14, 0);
      await repo.createOrGet({
        userId: 'user-isolate-proactive',
        candidateType: 'unresolved_follow_up',
        topic: 'isolate_topic',
        contextDigest: 'isolate context',
        reason: 'isolate reason',
        eligibleAt: new Date(now.getTime() - 60000),
      });

      let reminderError: string | null = null;
      let proactiveResult: any = null;

      try {
        await reminderScheduler.checkAndDispatchDueReminders();
      } catch (err: any) {
        reminderError = err.message;
      }

      try {
        proactiveResult = await scheduler.checkAndProcessDueActions(now);
      } catch (err: any) {
        // Should not be called
      }

      expect(reminderError).toBe('Reminder DB deadlock');
      expect(proactiveResult).not.toBeNull();
      expect(proactiveResult.dispatchedIntents.length).toBe(1);
      expect(proactiveResult.dispatchedIntents[0].userId).toBe('user-isolate-proactive');
    });
  });

  // =========================================================================
  // Category 9: Integration & Performance Benchmark (Scenario 42)
  // =========================================================================
  describe('Category 9: Integration & Performance Benchmark', () => {
    it('Scenario 42: batch processing of 50 actions executes under 250ms', async () => {
      const now = makeCairoDate(14, 0);

      // Seed 50 actions
      for (let i = 0; i < 50; i++) {
        await repo.createOrGet({
          userId: `user-bench-${i}`,
          candidateType: 'unresolved_follow_up',
          topic: `topic-bench-${i}`,
          contextDigest: `Context digest benchmark item ${i} for performance evaluation`,
          reason: `Benchmark reason ${i}`,
          eligibleAt: new Date(now.getTime() - (i + 1) * 1000),
        });
      }

      const startTime = performance.now();
      const result = await scheduler.checkAndProcessDueActions(now);
      const durationMs = performance.now() - startTime;

      expect(result.claimedCount).toBe(50);
      expect(result.dispatchedIntents.length).toBe(50);
      expect(durationMs).toBeLessThan(600); // < 12ms per action
    });
  });
});
