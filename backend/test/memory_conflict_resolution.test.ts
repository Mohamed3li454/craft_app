import { MemoryRepository } from '../src/database/repositories/memory.repo';
import {
  normalizeFactText,
  calculateTokenSimilarity,
  deriveFactKey,
} from '../src/modules/memory/types';

describe('Phase 4.4: Memory Conflict Resolution & Deduplication', () => {
  let memoryRepo: MemoryRepository;

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
    memoryRepo.clearInMemoryStore();
  });

  describe('Deduplication Helpers (Unit Tests)', () => {
    test('normalizeFactText trims, collapses whitespace, and strips trailing punctuation', () => {
      expect(normalizeFactText('  المستخدم يعمل  كمطور.  ')).toBe('المستخدم يعمل كمطور');
      expect(normalizeFactText('User prefers dark mode!?!')).toBe('User prefers dark mode');
      expect(normalizeFactText('   \n\t  ')).toBe('');
    });

    test('calculateTokenSimilarity computes token-based Jaccard similarity', () => {
      const textA = 'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر';
      const textB = 'المستخدم يعمل كمطور هواتف باستخدام فلاتر';
      const sim = calculateTokenSimilarity(textA, textB);
      expect(sim).toBeGreaterThanOrEqual(0.8);

      const textC = 'المستخدم يحب السفر والسياحة';
      const simDiff = calculateTokenSimilarity(textA, textC);
      expect(simDiff).toBeLessThan(0.3);
    });

    test('deriveFactKey generates deterministic keys for conflict-sensitive categories', () => {
      expect(deriveFactKey('اسم المستخدم: محمد', 'identity')).toBe('identity.name');
      expect(deriveFactKey('User prefers dark mode', 'preference')).toBe('preference.theme');
      expect(deriveFactKey('المستخدم يستخدم Flutter', 'technical_context')).toBeUndefined();
    });
  });

  describe('Memory Conflict Resolution & Deduplication Scenarios', () => {
    test('1. Exact duplicates -> single active row', async () => {
      const userId = 'user_dedup_exact';
      const item1 = await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور برمجيات', 'stable_fact');
      const item2 = await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور برمجيات', 'stable_fact');

      expect(item1.id).toBe(item2.id);

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toBe('المستخدم يعمل كمطور برمجيات');

      const activeRecords = await memoryRepo.getActiveMemories(userId);
      expect(activeRecords).toHaveLength(1);
    });

    test('2. Whitespace and punctuation normalization -> duplicate handled', async () => {
      const userId = 'user_dedup_normalized';
      await memoryRepo.saveFact(userId, '  المستخدم يفضل لغة دارت.  ', 'stable_fact');
      await memoryRepo.saveFact(userId, 'المستخدم يفضل لغة دارت', 'stable_fact');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toBe('المستخدم يفضل لغة دارت');
    });

    test('3. Different facts in different categories -> both active, not merged', async () => {
      const userId = 'user_distinct_facts';
      await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact');
      await memoryRepo.saveFact(userId, 'المستخدم يحب القراءة والبحث', 'interests');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(2);
      expect(memories).toContain('المستخدم يعيش في القاهرة');
      expect(memories).toContain('المستخدم يحب القراءة والبحث');
    });

    test('4. Name conflict -> new name active, old superseded', async () => {
      const userId = 'user_name_conflict';
      const item1 = await memoryRepo.saveFact(userId, 'اسم المستخدم: محمد', 'identity');
      expect(item1.status).toBe('active');

      const item2 = await memoryRepo.saveFact(userId, 'اسم المستخدم: أحمد', 'identity');
      expect(item2.status).toBe('active');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toBe('اسم المستخدم: أحمد');

      // Verify the old item was superseded
      const active = await memoryRepo.getActiveMemories(userId);
      expect(active).toHaveLength(1);
      expect(active[0].factText).toBe('اسم المستخدم: أحمد');
    });

    test('5. Explicit authority beats automatic extraction', async () => {
      const userId = 'user_authority_check';
      // User explicitly declares their name
      const explicitFact = await memoryRepo.saveFact(
        userId,
        'اسم المستخدم: طارق',
        'identity',
        { source: 'user_explicit' }
      );
      expect(explicitFact.source).toBe('user_explicit');

      // Later, an automatic extraction tries to save a different name
      const autoFact = await memoryRepo.saveFact(
        userId,
        'اسم المستخدم: مروان',
        'identity',
        { source: 'automatic_extraction' }
      );

      // The explicit fact must NOT be superseded by lower priority source
      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toBe('اسم المستخدم: طارق');

      const active = await memoryRepo.getActiveMemories(userId);
      expect(active).toHaveLength(1);
      expect(active[0].factText).toBe('اسم المستخدم: طارق');
      expect(active[0].source).toBe('user_explicit');
    });

    test('6. Technical context coexistence -> Flutter and React both active', async () => {
      const userId = 'user_tech_coexist';
      await memoryRepo.saveFact(
        userId,
        'المستخدم يستخدم Flutter لتطوير الموبايل',
        'technical_context'
      );
      await memoryRepo.saveFact(
        userId,
        'المستخدم يستخدم React لتطوير الويب',
        'technical_context'
      );

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(2);
      expect(memories).toContain('المستخدم يستخدم Flutter لتطوير الموبايل');
      expect(memories).toContain('المستخدم يستخدم React لتطوير الويب');
    });

    test('7. Preference conflict -> dark mode vs light mode resolves to newer', async () => {
      const userId = 'user_theme_pref';
      await memoryRepo.saveFact(
        userId,
        'المستخدم يفضل الوضع الليلي (Dark Mode)',
        'preference'
      );
      await memoryRepo.saveFact(
        userId,
        'المستخدم يفضل الوضع الفاتح (Light Mode)',
        'preference'
      );

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toBe('المستخدم يفضل الوضع الفاتح (Light Mode)');
    });

    test('8. Ephemeral memory -> expired valid_until is excluded from active memories', async () => {
      const userId = 'user_ephemeral';
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now

      // Expired ephemeral fact
      await memoryRepo.saveFact(
        userId,
        'المستخدم يحضر مؤتمر تك اليوم فقط',
        'ephemeral_context',
        { validUntil: pastDate }
      );

      // Active ephemeral fact
      await memoryRepo.saveFact(
        userId,
        'المستخدم في اجتماع عمل حتى الساعة 4',
        'ephemeral_context',
        { validUntil: futureDate }
      );

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toBe('المستخدم في اجتماع عمل حتى الساعة 4');
    });

    test('9. Active retrieval excludes superseded and expired facts', async () => {
      const userId = 'user_active_retrieval';
      // 1. Stable fact
      await memoryRepo.saveFact(userId, 'المستخدم مهندس برمجيات', 'stable_fact');
      // 2. Identity name updated
      await memoryRepo.saveFact(userId, 'اسم المستخدم: خالد', 'identity');
      await memoryRepo.saveFact(userId, 'اسم المستخدم: عمر', 'identity');
      // 3. Expired fact
      await memoryRepo.saveFact(
        userId,
        'المستخدم في إجازة سنوية',
        'ephemeral_context',
        { validUntil: new Date(Date.now() - 1000) }
      );

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(2);
      expect(memories).toContain('المستخدم مهندس برمجيات');
      expect(memories).toContain('اسم المستخدم: عمر');
      expect(memories).not.toContain('اسم المستخدم: خالد');
      expect(memories).not.toContain('المستخدم في إجازة سنوية');
    });

    test('10. Idempotency of saveFact()', async () => {
      const userId = 'user_idempotent';
      const fact = 'المستخدم يفضل استخدام TypeScript في مشاريع Node.js';

      for (let i = 0; i < 5; i++) {
        await memoryRepo.saveFact(userId, fact, 'technical_context');
      }

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toBe(fact);

      const activeRecords = await memoryRepo.getActiveMemories(userId);
      expect(activeRecords).toHaveLength(1);
    });

    test('11. Semantic deduplication with calculateTokenSimilarity > 0.85', async () => {
      const userId = 'user_semantic_sim';
      await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر',
        'profession'
      );

      // Very similar wording (Jaccard similarity > 0.85) in same category
      await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور هواتف باستخدام فلاتر',
        'profession'
      );

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(1);
    });
  });
});
