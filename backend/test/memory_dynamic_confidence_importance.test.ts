import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import {
  calculateDynamicConfidence,
  calculateDynamicImportance,
  AUTOMATIC_INFERENCE_CONFIDENCE_CEILING,
  EXPLICIT_CONFIDENCE_CEILING,
  MemoryCategory,
  MemorySource,
} from '../src/modules/memory/types';

function getTestUserId(base: string): string {
  return `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('Phase 2.3 — Dynamic Confidence & Importance Engine', () => {
  let memoryRepo: MemoryRepository;
  let evidenceRepo: MemoryEvidenceRepository;

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
    evidenceRepo = MemoryEvidenceRepository.getInstance();
    memoryRepo.clearInMemoryStore();
    evidenceRepo.clearInMemoryStore();
  });

  // ============================================================================
  // 1. Dynamic Confidence Tests
  // ============================================================================
  describe('1. Dynamic Confidence Model', () => {
    // Test 1: Single implicit observation -> confidence is low/moderate
    test('Test 1: Single implicit casual observation yields low/moderate confidence (0.45)', () => {
      const conf = calculateDynamicConfidence({
        evidenceCount: 1,
        conversationCount: 1,
        sources: ['automatic_extraction'],
        category: 'technical_context',
      });
      expect(conf).toBe(0.45);
      expect(conf).toBeGreaterThanOrEqual(0.40);
      expect(conf).toBeLessThanOrEqual(0.50);
    });

    // Test 2: Monotonicity with repeated evidence -> B >= A, C >= B
    test('Test 2: Confidence increases monotonically with corroborating evidence', () => {
      const conf1 = calculateDynamicConfidence({
        evidenceCount: 1,
        conversationCount: 1,
        sources: ['automatic_extraction'],
      });
      const conf2 = calculateDynamicConfidence({
        evidenceCount: 2,
        conversationCount: 1,
        sources: ['automatic_extraction'],
      });
      const conf3 = calculateDynamicConfidence({
        evidenceCount: 3,
        conversationCount: 1,
        sources: ['automatic_extraction'],
      });
      const confCross2 = calculateDynamicConfidence({
        evidenceCount: 2,
        conversationCount: 2,
        sources: ['automatic_extraction'],
      });
      const confCross3 = calculateDynamicConfidence({
        evidenceCount: 3,
        conversationCount: 3,
        sources: ['automatic_extraction'],
      });

      expect(conf2).toBeGreaterThanOrEqual(conf1);
      expect(conf3).toBeGreaterThanOrEqual(conf2);
      expect(confCross2).toBeGreaterThanOrEqual(conf2);
      expect(confCross3).toBeGreaterThanOrEqual(confCross2);
      expect(confCross3).toBe(0.71);
    });

    // Test 3: Cross-conversation evidence outscores same-conversation spam
    test('Test 3: 3 distinct conversations produce strictly higher confidence than 10 mentions in 1 conversation', () => {
      const singleConvSpamConf = calculateDynamicConfidence({
        evidenceCount: 10,
        conversationCount: 1,
        sources: ['automatic_extraction'],
      });

      const multiConvConf = calculateDynamicConfidence({
        evidenceCount: 3,
        conversationCount: 3,
        sources: ['automatic_extraction'],
      });

      expect(singleConvSpamConf).toBe(0.54); // 0.45 base + 0.09 max spam cap
      expect(multiConvConf).toBe(0.71);      // 0.45 base + 0.26 cross-conv bonus
      expect(multiConvConf).toBeGreaterThan(singleConvSpamConf);
    });

    // Test 4: Explicit declaration produces higher confidence than casual observation
    test('Test 4: Explicit declaration yields significantly higher confidence than casual observation', () => {
      const implicitConf = calculateDynamicConfidence({
        evidenceCount: 1,
        conversationCount: 1,
        sources: ['automatic_extraction'],
        isExplicit: false,
      });

      const explicitConf = calculateDynamicConfidence({
        evidenceCount: 1,
        conversationCount: 1,
        sources: ['user_explicit'],
        isExplicit: true,
      });

      expect(explicitConf).toBe(0.92);
      expect(implicitConf).toBe(0.45);
      expect(explicitConf).toBeGreaterThan(implicitConf);
    });

    // Test 5: Diminishing returns on in-session repetitions
    test('Test 5: Diminishing returns on repeated mentions within same conversation', () => {
      const c1 = calculateDynamicConfidence({ evidenceCount: 1, conversationCount: 1, sources: ['automatic_extraction'] });
      const c2 = calculateDynamicConfidence({ evidenceCount: 2, conversationCount: 1, sources: ['automatic_extraction'] });
      const c3 = calculateDynamicConfidence({ evidenceCount: 3, conversationCount: 1, sources: ['automatic_extraction'] });
      const c4 = calculateDynamicConfidence({ evidenceCount: 4, conversationCount: 1, sources: ['automatic_extraction'] });
      const c10 = calculateDynamicConfidence({ evidenceCount: 10, conversationCount: 1, sources: ['automatic_extraction'] });

      const delta1to2 = Number((c2 - c1).toFixed(2)); // +0.04
      const delta2to3 = Number((c3 - c2).toFixed(2)); // +0.03
      const delta3to4 = Number((c4 - c3).toFixed(2)); // +0.01
      const delta4to10 = Number((c10 - c4).toFixed(2)); // +0.01 total (diminishing to 0)

      expect(delta1to2).toBeGreaterThanOrEqual(delta2to3);
      expect(delta2to3).toBeGreaterThanOrEqual(delta3to4);
      expect(delta3to4).toBeGreaterThanOrEqual(delta4to10);
    });

    // Test 6: Confidence is strictly bounded between 0.0 and 1.0
    test('Test 6: Confidence is strictly bounded between 0.0 and 1.0 across extreme combinations', () => {
      const testCases = [
        { evidenceCount: 0, conversationCount: 0, sources: [] as MemorySource[] },
        { evidenceCount: 1, conversationCount: 1, sources: ['automatic_extraction'] as MemorySource[] },
        { evidenceCount: 50, conversationCount: 20, sources: ['automatic_extraction'] as MemorySource[] },
        { evidenceCount: 100, conversationCount: 1, sources: ['automatic_extraction'] as MemorySource[] },
        { evidenceCount: 1, conversationCount: 1, sources: ['user_explicit'] as MemorySource[], isExplicit: true },
        { evidenceCount: 100, conversationCount: 50, sources: ['user_explicit'] as MemorySource[], isExplicit: true },
      ];

      for (const tc of testCases) {
        const score = calculateDynamicConfidence(tc);
        expect(score).toBeGreaterThanOrEqual(0.0);
        expect(score).toBeLessThanOrEqual(1.0);
      }
    });

    // Test 7: Confidence ceilings: automatic inference never reaches 1.0; capped at ceiling
    test('Test 7: Automatic inference strictly respects ceiling (0.90) and explicit ceiling (0.98)', () => {
      const extremeAutomatic = calculateDynamicConfidence({
        evidenceCount: 500,
        conversationCount: 100,
        sources: ['automatic_extraction'],
        isExplicit: false,
      });
      expect(extremeAutomatic).toBe(AUTOMATIC_INFERENCE_CONFIDENCE_CEILING);
      expect(extremeAutomatic).toBe(0.90);
      expect(extremeAutomatic).toBeLessThan(1.0);

      const extremeExplicit = calculateDynamicConfidence({
        evidenceCount: 100,
        conversationCount: 50,
        sources: ['user_explicit'],
        isExplicit: true,
      });
      expect(extremeExplicit).toBe(EXPLICIT_CONFIDENCE_CEILING);
      expect(extremeExplicit).toBe(0.98);
      expect(extremeExplicit).toBeLessThanOrEqual(1.0);
    });
  });

  // ============================================================================
  // 2. Dynamic Importance Tests
  // ============================================================================
  describe('2. Dynamic Importance Model', () => {
    // Test 8: Category-aware importance
    test('Test 8: Category-aware importance correctly differentiates identity, persistent context, and ephemeral events', () => {
      // Identity -> high
      const identityImp = calculateDynamicImportance({
        category: 'identity',
        factText: 'اسم المستخدم: أحمد',
        isExplicit: true,
      });
      expect(identityImp).toBe('high');

      // Profession -> high
      const professionImp = calculateDynamicImportance({
        category: 'profession',
        factText: 'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر',
        isExplicit: true,
      });
      expect(professionImp).toBe('high');

      // Explicit project / stable fact -> high
      const projectImp = calculateDynamicImportance({
        category: 'stable_fact',
        factText: 'أنا شغال على مشروع Craft',
        isExplicit: true,
      });
      expect(projectImp).toBe('high');

      // General studies -> normal
      const studiesImp = calculateDynamicImportance({
        category: 'general',
        factText: 'أنا بدرس Social Work في الجامعة',
      });
      expect(studiesImp).toBe('normal');

      // Ephemeral context / casual drinking coffee -> low
      const coffeeImp = calculateDynamicImportance({
        category: 'stable_fact',
        factText: 'أنا شربت قهوة النهارده',
        isExplicit: true,
      });
      expect(coffeeImp).toBe('low');

      const ephemeralImp = calculateDynamicImportance({
        category: 'ephemeral_context',
        factText: 'المستخدم يحضر مؤتمر تك اليوم فقط',
      });
      expect(ephemeralImp).toBe('low');

      // Technical context: single observation is normal, heavily corroborated becomes high
      const techImpCasual = calculateDynamicImportance({
        category: 'technical_context',
        factText: 'المستخدم يستخدم Docker',
        conversationCount: 1,
        evidenceStrength: 0.25,
      });
      expect(techImpCasual).toBe('normal');

      const techImpCorroborated = calculateDynamicImportance({
        category: 'technical_context',
        factText: 'المستخدم يستخدم Docker',
        conversationCount: 3,
        evidenceStrength: 0.75,
      });
      expect(techImpCorroborated).toBe('high');
    });

    // Test 9: Complete independence between Confidence and Importance
    test('Test 9: Confidence and Importance are completely decoupled (orthogonal)', () => {
      // Case A: High Confidence + Low Importance (Drank coffee today)
      const coffeeConf = calculateDynamicConfidence({
        evidenceCount: 1,
        conversationCount: 1,
        sources: ['user_explicit'],
        isExplicit: true,
      });
      const coffeeImp = calculateDynamicImportance({
        category: 'stable_fact',
        factText: 'أنا شربت قهوة النهارده',
        isExplicit: true,
      });
      expect(coffeeConf).toBe(0.92); // High confidence!
      expect(coffeeImp).toBe('low');   // Low importance!

      // Case B: Moderate Confidence + High Importance (Inferred tech stack from 2 conversations)
      const inferredTechConf = calculateDynamicConfidence({
        evidenceCount: 2,
        conversationCount: 2,
        sources: ['automatic_extraction'],
        isExplicit: false,
      });
      const inferredTechImp = calculateDynamicImportance({
        category: 'profession',
        factText: 'المستخدم يعمل كمطور Flutter',
        isExplicit: false,
      });
      expect(inferredTechConf).toBe(0.61); // Moderate confidence (0.61)
      expect(inferredTechImp).toBe('high');  // High importance ('high')

      // Case C: High Confidence + High Importance (User's Name)
      const nameConf = calculateDynamicConfidence({
        evidenceCount: 1,
        conversationCount: 1,
        sources: ['user_explicit'],
        isExplicit: true,
      });
      const nameImp = calculateDynamicImportance({
        category: 'identity',
        factText: 'اسم المستخدم: محمود',
        isExplicit: true,
      });
      expect(nameConf).toBe(0.92); // High confidence
      expect(nameImp).toBe('high');  // High importance
    });
  });

  // ============================================================================
  // 3. Runtime Integration, Safety & Storage Tests
  // ============================================================================
  describe('3. Runtime Integration & Safety', () => {
    // Test 10: Safety gate takes precedence over confidence accumulation
    test('Test 10: Safety gate blocks sensitive statements from gaining confidence or entering memory', async () => {
      const userId = getTestUserId('user_safety_conf');

      // Attempting 3 repeated credential submissions
      await memoryRepo.extractAndSaveFacts(userId, 'كلمة السر هي SecretPass123!@#', 'conv-1');
      await memoryRepo.extractAndSaveFacts(userId, 'كلمة السر هي SecretPass123!@#', 'conv-2');
      await memoryRepo.extractAndSaveFacts(userId, 'كلمة السر هي SecretPass123!@#', 'conv-3');

      const candidates = await evidenceRepo.getCandidates(userId);
      expect(candidates).toHaveLength(0); // Never recorded in evidence!

      const activeMemories = await memoryRepo.getActiveMemories(userId);
      expect(activeMemories).toHaveLength(0); // Never saved in memory_items!
    });

    // Test 11: Promoted memory in memory_items contains calculated dynamic confidence and importance
    test('Test 11: Promoted memory in memory_items contains calculated dynamic confidence and importance', async () => {
      const userId = getTestUserId('user_promote_dyn');

      // Cross-conversation reinforcement for Flutter
      await memoryRepo.extractAndSaveFacts(userId, 'عندي مشكلة في كود Flutter اليوم', 'conv-f1');
      await memoryRepo.extractAndSaveFacts(userId, 'أنا بكتب كود Flutter في مشروعي', 'conv-f2');

      const candidates = await evidenceRepo.getCandidates(userId);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].status).toBe('promoted');
      expect(candidates[0].confidence).toBe(0.61); // Dynamic confidence for 2 cross-conversations
      expect(candidates[0].importance).toBe('normal');

      const activeMemories = await memoryRepo.getActiveMemories(userId);
      expect(activeMemories).toHaveLength(1);
      expect(activeMemories[0].confidence).toBe(0.61);
      expect(activeMemories[0].importance).toBe('normal');
    });

    // Test 12: Deduplication updates confidence and importance upon reinforcement
    test('Test 12: Exact deduplication updates confidence and importance when reinforced', async () => {
      const userId = getTestUserId('user_dedup_conf');

      // 1. Initial save with moderate confidence
      const mem1 = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل مع رياكت (React)',
        'technical_context',
        {
          confidence: 0.61,
          importance: 'normal',
          source: 'automatic_extraction',
        }
      );
      expect(mem1.confidence).toBe(0.61);
      expect(mem1.importance).toBe('normal');

      // 2. Reinforced save with higher confidence and high importance
      const mem2 = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل مع رياكت (React)',
        'technical_context',
        {
          confidence: 0.81,
          importance: 'high',
          source: 'automatic_extraction',
        }
      );

      expect(mem2.id).toBe(mem1.id);
      expect(mem2.confidence).toBe(0.81); // Updated to higher confidence!
      expect(mem2.importance).toBe('high'); // Updated to high importance!

      const active = await memoryRepo.getActiveMemories(userId);
      expect(active).toHaveLength(1);
      expect(active[0].confidence).toBe(0.81);
      expect(active[0].importance).toBe('high');
    });

    // Test 13: MemoryRetrievalService utilizes dynamic confidence and importance in ranking
    test('Test 13: Selective retrieval ranks higher importance and confidence higher in tie-breaking', async () => {
      const userId = getTestUserId('user_retrieval_dyn');
      const retrievalService = MemoryRetrievalService.getInstance(memoryRepo);

      // Save two memories that match query 'Flutter' with different confidence and importance
      await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        'profession',
        { confidence: 0.95, importance: 'high', source: 'user_explicit' }
      );
      await memoryRepo.saveFact(
        userId,
        'المستخدم جرب فلاتر مرة واحدة في مشروع صغير',
        'technical_context',
        { confidence: 0.50, importance: 'low', source: 'automatic_extraction' }
      );

      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'إزاي أعمل optimize لأداء تطبيق Flutter بتاعي؟',
      });

      expect(retrieved).toHaveLength(2);
      // High importance and confidence must rank higher!
      expect(retrieved[0].memory.factText).toContain('Mobile Flutter Developer');
      expect(retrieved[0].relevanceScore).toBeGreaterThan(retrieved[1].relevanceScore);
      expect(retrieved[0].memory.importance).toBe('high');
      expect(retrieved[0].memory.confidence).toBe(0.95);
      expect(retrieved[1].memory.importance).toBe('low');
      expect(retrieved[1].memory.confidence).toBe(0.50);
    });
  });
});
