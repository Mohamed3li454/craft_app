import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { DEFAULT_MEMORY_RETRIEVAL_LIMIT } from '../src/modules/memory/types';

describe('Phase 4.6: Memory Selective Retrieval Service', () => {
  let memoryRepo: MemoryRepository;
  let retrievalService: MemoryRetrievalService;
  let userPrefRepo: UserPreferenceRepository;

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
    memoryRepo.clearInMemoryStore();
    retrievalService = new MemoryRetrievalService(memoryRepo);
    userPrefRepo = new UserPreferenceRepository();
  });

  describe('1. Basic Relevance & Topic Matching', () => {
    test('selects relevant technical memory for technical query', async () => {
      const userId = 'user_retrieval_basic_' + Date.now();
      await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        'profession'
      );

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إزاي أعمل optimize لأداء تطبيق Flutter بتاعي؟',
      });

      expect(retrieved.length).toBeGreaterThanOrEqual(1);
      expect(retrieved[0].memory.factText).toContain('Flutter');
      expect(retrieved[0].relevanceScore).toBeGreaterThanOrEqual(0.3);
    });

    test('excludes completely irrelevant memory from technical query', async () => {
      const userId = 'user_retrieval_irrel_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يحب قراءة الروايات التاريخية', 'interests');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'how do I optimize Flutter performance?',
      });

      expect(retrieved).toHaveLength(0);
    });
  });

  describe('2. Negative Rule & Identity Isolation', () => {
    test('isolates identity facts when query is purely technical', async () => {
      const userId = 'user_identity_iso_' + Date.now();
      await memoryRepo.saveFact(userId, 'اسم المستخدم: محمد', 'identity');
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إيه الفرق بين Bloc و Cubit؟',
      });

      // Profession/Flutter memory is relevant to state management in Flutter
      expect(retrieved.some((m) => m.memory.factText.includes('Flutter'))).toBe(true);

      // Identity fact MUST NOT leak into prompt
      expect(retrieved.some((m) => m.memory.category === 'identity')).toBe(false);
      expect(retrieved.some((m) => m.memory.factText.includes('محمد'))).toBe(false);
    });

    test('retrieves identity facts when query explicitly asks about name or identity', async () => {
      const userId = 'user_identity_query_' + Date.now();
      await memoryRepo.saveFact(userId, 'اسم المستخدم: أحمد عادل', 'identity');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'هو أنت عارف أنا اسمي إيه؟',
      });

      expect(retrieved.length).toBeGreaterThanOrEqual(1);
      expect(retrieved[0].memory.factText).toContain('أحمد عادل');
      expect(retrieved[0].memory.category).toBe('identity');
    });

    test('hard negative rule: 5 memories exist, only the 1 relevant is retrieved', async () => {
      const userId = 'user_hard_negative_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم اسمه محمد', 'identity');
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
      await memoryRepo.saveFact(userId, 'المستخدم يحب القراءة', 'interests');
      await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إيه الفرق بين Bloc وCubit؟',
      });

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].memory.factText).toBe('المستخدم يعمل كمطور Flutter');
    });
  });

  describe('3. Multiple Relevant Memories', () => {
    test('retrieves and ranks multiple relevant technical memories', async () => {
      const userId = 'user_multi_rel_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
      await memoryRepo.saveFact(userId, 'المستخدم يستخدم Bloc لإدارة الحالة', 'technical_context');
      await memoryRepo.saveFact(userId, 'قاعدة بيانات المشروع هي Supabase', 'technical_context');
      await memoryRepo.saveFact(userId, 'المستخدم يفضل شرب القهوة صباحاً', 'interests');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'How should I structure my Flutter app architecture with Bloc and Supabase?',
      });

      expect(retrieved.length).toBe(3);
      expect(retrieved.some((m) => m.memory.factText.includes('Flutter'))).toBe(true);
      expect(retrieved.some((m) => m.memory.factText.includes('Bloc'))).toBe(true);
      expect(retrieved.some((m) => m.memory.factText.includes('Supabase'))).toBe(true);

      // Coffee interest fact must be excluded
      expect(retrieved.some((m) => m.memory.factText.includes('القهوة'))).toBe(false);
    });
  });

  describe('4. Lifecycle Awareness (Active, Superseded, Expired)', () => {
    test('retrieves active memories and excludes superseded ones', async () => {
      const userId = 'user_lifecycle_super_' + Date.now();

      // Older fact gets superseded by newer authority fact
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كطالب هندسة', 'profession', {
        source: 'automatic_extraction',
      });
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمهندس برمجيات أول', 'profession', {
        source: 'user_explicit',
      });

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'ما هي وظيفتي ومجال عملي؟',
      });

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].memory.factText).toBe('المستخدم يعمل كمهندس برمجيات أول');
      expect(retrieved.some((m) => m.memory.factText.includes('طالب'))).toBe(false);
    });

    test('excludes expired memories with validUntil in the past', async () => {
      const userId = 'user_lifecycle_expired_' + Date.now();

      // Expired ephemeral memory (validUntil 1 hour in the past)
      await memoryRepo.saveFact(userId, 'المستخدم في إجازة سنوية تنتهي اليوم', 'ephemeral_context', {
        validUntil: new Date(Date.now() - 3600 * 1000),
      });

      // Active permanent memory
      await memoryRepo.saveFact(userId, 'المستخدم يقيم ويعمل في الرياض', 'stable_fact');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا مسافر فين أو وضعي إيه حالياً؟',
      });

      // Expired memory should NOT be returned
      expect(retrieved.some((m) => m.memory.factText.includes('إجازة'))).toBe(false);
    });

    test('includes active ephemeral memories with validUntil in the future', async () => {
      const userId = 'user_ephemeral_active_' + Date.now();

      await memoryRepo.saveFact(userId, 'المستخدم في رحلة عمل إلى دبي هذا الأسبوع', 'ephemeral_context', {
        validUntil: new Date(Date.now() + 48 * 3600 * 1000), // 2 days in future
      });

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا مسافر فين في رحلة العمل الحالية؟',
      });

      expect(retrieved.length).toBeGreaterThanOrEqual(1);
      expect(retrieved[0].memory.factText).toContain('دبي');
      expect(retrieved[0].memory.category).toBe('ephemeral_context');
    });
  });

  describe('5. Importance and Confidence Ranking', () => {
    test('high importance boosts ranking among relevant candidates', async () => {
      const userId = 'user_importance_rank_' + Date.now();

      await memoryRepo.saveFact(userId, 'المستخدم يتعلم بايثون في أوقات الفراغ', 'technical_context', {
        importance: 'low',
      });
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمهندس بايثون رئيسي (Lead Python Engineer)', 'profession', {
        importance: 'high',
      });

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'عايز مساعدة في كتابة كود بايثون متقدم',
      });

      expect(retrieved.length).toBe(2);
      expect(retrieved[0].memory.importance).toBe('high');
      expect(retrieved[0].memory.factText).toContain('Lead Python Engineer');
    });

    test('high confidence breaks tie among similar relevance candidates', async () => {
      const userId = 'user_confidence_rank_' + Date.now();

      await memoryRepo.saveFact(userId, 'المستخدم يستخدم Docker لتشغيل التطبيقات', 'technical_context', {
        confidence: 0.6,
      });
      await memoryRepo.saveFact(userId, 'المستخدم يعتمد على Docker Compose في بيئة التطوير', 'technical_context', {
        confidence: 1.0,
      });

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إزاي أعمل إعداد لملف Docker في مشروعي؟',
      });

      expect(retrieved.length).toBeGreaterThanOrEqual(1);
      expect(retrieved[0].memory.confidence).toBe(1.0);
    });
  });

  describe('6. Hard Limits and Token Budget Protection', () => {
    test('strictly caps results to configured retrieval limit', async () => {
      const userId = 'user_limit_cap_' + Date.now();

      // Save 10 technical facts
      for (let i = 1; i <= 10; i++) {
        await memoryRepo.saveFact(
          userId,
          `المستخدم يتقن التقنية البرمجية رقم ${i} في الفلاتر والدارت Flutter`,
          'technical_context'
        );
      }

      // Default limit is 5
      const retrievedDefault = await retrievalService.retrieve({
        userId,
        message: 'ما هي التقنيات البرمجية التي أستخدمها في Flutter؟',
      });

      expect(retrievedDefault.length).toBe(DEFAULT_MEMORY_RETRIEVAL_LIMIT);
      expect(retrievedDefault.length).toBeLessThanOrEqual(5);

      // Custom limit
      const retrievedCustom = await retrievalService.retrieve({
        userId,
        message: 'ما هي التقنيات البرمجية التي أستخدمها في Flutter؟',
        limit: 3,
      });

      expect(retrievedCustom.length).toBe(3);
    });
  });

  describe('7. Preferences Isolation', () => {
    test('language and personality preferences do not appear in generic memory retrieval', async () => {
      const userId = 'user_pref_iso_' + Date.now();

      // Store preferences via UserPreferenceRepository
      await userPrefRepo.setLanguagePreference(userId, {
        language: 'ar',
        dialect: 'egyptian',
      });
      await userPrefRepo.setPersonalityPreference(userId, {
        verbosity: 'concise',
      });

      // Save normal memory fact
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمهندس نظم سحابية Cloud Engineer', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا شغال إيه ولغتي إيه؟',
      });

      // Should only contain the profession fact
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].memory.category).toBe('profession');

      // Neither language nor personality preferences must appear in generic retrieved items
      expect(retrieved.some((m) => m.memory.category === ('language_preference' as any))).toBe(false);
      expect(retrieved.some((m) => m.memory.category === ('personality_preference' as any))).toBe(false);
    });
  });

  describe('8. Boundary Tests (Cases A - F) & False Positive Verification', () => {
    test('Case A: Strong lexical match selects memory', async () => {
      const userId = 'user_case_a_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا شغال على Flutter وعايز أحسن الـ architecture',
      });

      expect(retrieved.length).toBeGreaterThanOrEqual(1);
      expect(retrieved[0].memory.factText).toBe('المستخدم يعمل كمطور Flutter');
      expect(retrieved[0].relevanceScore).toBeGreaterThanOrEqual(0.7);
    });

    test('Case B: Generic wording without technical anchor is NOT selected', async () => {
      const userId = 'user_case_b_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'عايز أرتب مشروعي بشكل احترافي',
      });

      // Without explicit technical anchor, generic wording must NOT select the memory
      expect(retrieved).toHaveLength(0);
    });

    test('Case C: Completely unrelated query does NOT select memory', async () => {
      const userId = 'user_case_c_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إيه أفضل طريقة أعمل بيها قهوة؟',
      });

      expect(retrieved).toHaveLength(0);
    });

    test('Case D: Identity fact is NOT selected for technical question', async () => {
      const userId = 'user_case_d_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم اسمه Mohamed', 'identity');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إيه الفرق بين Bloc وCubit؟',
      });

      expect(retrieved).toHaveLength(0);
    });

    test('Case E: Multiple technical contextual memories selected while unrelated excluded', async () => {
      const userId = 'user_case_e_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
      await memoryRepo.saveFact(userId, 'المستخدم يستخدم Supabase', 'technical_context');
      await memoryRepo.saveFact(userId, 'المستخدم يحب القراءة', 'interests');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إزاي أعمل authentication في تطبيق Flutter باستخدام Supabase؟',
      });

      expect(retrieved.length).toBe(2);
      expect(retrieved.some((m) => m.memory.factText === 'المستخدم يعمل كمطور Flutter')).toBe(true);
      expect(retrieved.some((m) => m.memory.factText === 'المستخدم يستخدم Supabase')).toBe(true);
      expect(retrieved.some((m) => m.memory.factText === 'المستخدم يحب القراءة')).toBe(false);
    });

    test('Case F: Same category but irrelevant topic is NOT selected', async () => {
      const userId = 'user_case_f_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا بفكر أشتري لابتوب جديد',
      });

      expect(retrieved).toHaveLength(0);
    });

    test('False positive prevention: critical importance with zero relevance is strictly excluded', async () => {
      const userId = 'user_critical_irrel_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact', {
        importance: 'critical',
        confidence: 1.0,
      });

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إيه أفضل طريقة أعمل بيها قهوة؟',
      });

      expect(retrieved).toHaveLength(0);
    });
  });

  describe('9. Generic Wordings & Category Boost Risk Audit', () => {
    test('Test 1 — Generic app usage without technical anchor is NOT selected', async () => {
      const userId = 'user_audit_t1_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا بعمل تطبيق لإدارة مصاريف البيت',
      });

      // "تطبيق" alone is generic and must NOT trigger category boost
      expect(retrieved).toHaveLength(0);
    });

    test('Test 2 — Actual technical context with Flutter is selected', async () => {
      const userId = 'user_audit_t2_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا بعمل تطبيق Flutter لإدارة مصاريف البيت',
      });

      expect(retrieved.length).toBe(1);
      expect(retrieved[0].relevanceScore).toBeGreaterThanOrEqual(0.7);
      expect(retrieved[0].retrievalReason).toContain('flutter');
    });

    test('Test 3 — Generic project without technical keywords is NOT selected', async () => {
      const userId = 'user_audit_t3_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا بشتغل على مشروع جديد',
      });

      expect(retrieved).toHaveLength(0);
    });

    test('Test 4 — Explicit programming context is selected', async () => {
      const userId = 'user_audit_t4_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'أنا بشتغل على مشروع برمجي وعايز أظبط الـ architecture',
      });

      expect(retrieved.length).toBe(1);
      expect(retrieved[0].relevanceScore).toBeGreaterThanOrEqual(0.3);
      expect(retrieved[0].retrievalReason).toContain('category:profession');
    });

    test('Test 5 — Completely unrelated context (coffee) is NOT selected', async () => {
      const userId = 'user_audit_t5_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إيه أفضل طريقة أعمل بيها قهوة؟',
      });

      expect(retrieved).toHaveLength(0);
    });

    test('Test 6 — Multiple memories with Flutter and Supabase are selected while reading is excluded', async () => {
      const userId = 'user_audit_t6_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
      await memoryRepo.saveFact(userId, 'المستخدم يفضل Supabase في قواعد البيانات', 'technical_preference');
      await memoryRepo.saveFact(userId, 'المستخدم يحب القراءة', 'interest');

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إزاي أعمل authentication في تطبيق Flutter باستخدام Supabase؟',
      });

      expect(retrieved.length).toBe(2);
      expect(retrieved.some((m) => m.memory.factText === 'المستخدم يعمل كمطور Flutter')).toBe(true);
      expect(retrieved.some((m) => m.memory.factText === 'المستخدم يفضل Supabase في قواعد البيانات')).toBe(true);
      expect(retrieved.some((m) => m.memory.factText === 'المستخدم يحب القراءة')).toBe(false);
    });

    test('Generic everyday words (فكرة, حاجة, مشروع) without anchors are strictly NOT selected', async () => {
      const userId = 'user_audit_generic_' + Date.now();
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

      const res1 = await retrievalService.retrieve({
        userId,
        message: 'عندي فكرة مشروع جديد ومتحمس لها',
      });
      expect(res1).toHaveLength(0);

      const res2 = await retrievalService.retrieve({
        userId,
        message: 'أنا بعمل حاجة في البيت ومحتاج مساعدة',
      });
      expect(res2).toHaveLength(0);
    });
  });
});

