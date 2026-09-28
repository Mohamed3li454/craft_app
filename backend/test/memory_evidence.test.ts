import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { calculateEvidenceStrength } from '../src/modules/memory/types';

function getTestUserId(base: string): string {
  return `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('Phase 2.2 — Memory Evidence & Observation Engine', () => {
  let memoryRepo: MemoryRepository;
  let evidenceRepo: MemoryEvidenceRepository;

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
    evidenceRepo = MemoryEvidenceRepository.getInstance();
    memoryRepo.clearInMemoryStore();
    evidenceRepo.clearInMemoryStore();
  });

  // Test 1: Single casual observation -> candidate created in 'observing' status; memory_items has 0 rows
  test('Test 1: Single casual observation creates candidate in observing status without polluting memory_items', async () => {
    const userId = getTestUserId('user_obs_1');
    const text = 'عايز أعمل زرار بيغير لونه في Flutter';

    const saved = await memoryRepo.extractAndSaveFacts(userId, text, 'conv-1');
    expect(saved).toHaveLength(0); // Not promoted

    // Verify candidate in observing status
    const candidates = await evidenceRepo.getCandidates(userId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidateKey).toBe('tech.flutter');
    expect(candidates[0].status).toBe('observing');
    expect(candidates[0].evidenceCount).toBe(1);
    expect(candidates[0].conversationCount).toBe(1);

    // Verify memory_items is empty
    const persistentMemories = await memoryRepo.getActiveMemories(userId);
    expect(persistentMemories).toHaveLength(0);
  });

  // Test 2: Repeated observation in same conversation -> evidenceCount = 2, conversationCount = 1
  test('Test 2: Repeated observation in same conversation accumulates evidenceCount but keeps conversationCount = 1', async () => {
    const userId = getTestUserId('user_obs_2');
    const convId = 'conv-session-1';

    await memoryRepo.extractAndSaveFacts(userId, 'عايز أظبط ألوان الثيم في Flutter', convId);
    await memoryRepo.extractAndSaveFacts(userId, 'عندي مشكلة في الـ state management في Flutter', convId);

    const candidates = await evidenceRepo.getCandidates(userId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidenceCount).toBe(2);
    expect(candidates[0].conversationCount).toBe(1);
    expect(candidates[0].conversationIds).toEqual([convId]);
    expect(candidates[0].status).toBe('observing');

    const persistentMemories = await memoryRepo.getActiveMemories(userId);
    expect(persistentMemories).toHaveLength(0);
  });

  // Test 3: Cross-conversation reinforcement -> conv A + conv B -> promoted to memory_items
  test('Test 3: Cross-conversation reinforcement (conv A + conv B) promotes candidate to memory_items', async () => {
    const userId = getTestUserId('user_obs_3');

    // Conversation 1
    const saved1 = await memoryRepo.extractAndSaveFacts(userId, 'عندي مشكلة في Flutter اليوم', 'conv-A');
    expect(saved1).toHaveLength(0);

    let candidates = await evidenceRepo.getCandidates(userId);
    expect(candidates[0].status).toBe('observing');
    expect(candidates[0].conversationCount).toBe(1);

    // Conversation 2 (Reinforcement from distinct conversation)
    const saved2 = await memoryRepo.extractAndSaveFacts(userId, 'أنا بكتب كود Flutter في مشروعي', 'conv-B');
    expect(saved2).toHaveLength(1);
    expect(saved2[0]).toContain('Flutter');

    candidates = await evidenceRepo.getCandidates(userId);
    expect(candidates[0].status).toBe('promoted');
    expect(candidates[0].conversationCount).toBe(2);
    expect(candidates[0].evidenceCount).toBe(2);
    expect(candidates[0].promotedMemoryId).toBeDefined();

    // Verify memory_items now contains the promoted memory
    const persistentMemories = await memoryRepo.getActiveMemories(userId);
    expect(persistentMemories).toHaveLength(1);
    expect(persistentMemories[0].factText).toContain('Flutter');
    expect(persistentMemories[0].id).toBe(candidates[0].promotedMemoryId);
  });

  // Test 4: Same-conversation repetition weighting -> distinct conversations strictly weighted higher
  test('Test 4: Multi-conversation diversity scores higher evidence strength than single-conversation repetition spam', () => {
    // 10 mentions in single conversation
    const singleConvScore = calculateEvidenceStrength({
      evidenceCount: 10,
      conversationCount: 1,
      hasExplicitSource: false,
      sources: ['automatic_extraction'],
    });

    // 2 mentions across 2 distinct conversations
    const crossConvScore2 = calculateEvidenceStrength({
      evidenceCount: 2,
      conversationCount: 2,
      hasExplicitSource: false,
      sources: ['automatic_extraction'],
    });

    // 3 mentions across 3 distinct conversations
    const crossConvScore3 = calculateEvidenceStrength({
      evidenceCount: 3,
      conversationCount: 3,
      hasExplicitSource: false,
      sources: ['automatic_extraction'],
    });

    // Distinct conversation points (0.25 * count) ensure 3 conversations (0.75) > 1 conversation with 10 spams (0.50 max)
    expect(singleConvScore).toBe(0.50); // 0.25 (1 conv) + 0.25 (5 excess * 0.05 capped)
    expect(crossConvScore2).toBe(0.50); // 0.50 (2 convs) + 0.00
    expect(crossConvScore3).toBe(0.75); // 0.75 (3 convs) + 0.00
    expect(crossConvScore3).toBeGreaterThan(singleConvScore);
  });

  // Test 5: Explicit memory command -> promoted immediately on first observation
  test('Test 5: Explicit memory command or declaration is promoted immediately on first observation', async () => {
    const userId = getTestUserId('user_obs_5');

    const saved = await memoryRepo.extractAndSaveFacts(
      userId,
      'احفظ أن مشروع التخرج بتاعي عن إنترنت الأشياء',
      'conv-explicit'
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain('إنترنت الأشياء');

    const candidates = await evidenceRepo.getCandidates(userId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe('promoted');
    expect(candidates[0].evidenceStrength).toBe(1.0);

    const persistentMemories = await memoryRepo.getActiveMemories(userId);
    expect(persistentMemories).toHaveLength(1);
    expect(persistentMemories[0].factText).toContain('إنترنت الأشياء');
  });

  // Test 6: Implicit casual technical mention -> observation stage without immediate memory promotion
  test('Test 6: Casual mention of Supabase enters observing stage without immediate promotion', async () => {
    const userId = getTestUserId('user_obs_6');

    const saved = await memoryRepo.extractAndSaveFacts(
      userId,
      'أنا عايز أربط الـ database مع Supabase',
      'conv-supa-1'
    );
    expect(saved).toHaveLength(0);

    const candidate = await evidenceRepo.getCandidateByKey(userId, 'tech.supabase');
    expect(candidate).toBeDefined();
    expect(candidate?.status).toBe('observing');
    expect(candidate?.canonicalFact).toContain('Supabase');

    const memories = await memoryRepo.getActiveMemories(userId);
    expect(memories).toHaveLength(0);
  });

  // Test 7: Deduplication check -> evidence accumulation does not break existing deduplication
  test('Test 7: Evidence accumulation preserves semantic and exact deduplication when promoted', async () => {
    const userId = getTestUserId('user_obs_7');

    // Promoted via cross-conversation
    await memoryRepo.extractAndSaveFacts(userId, 'عندي مشكلة في كود React بتاعي', 'conv-1');
    await memoryRepo.extractAndSaveFacts(userId, 'أنا بعدل واجهة React اليوم', 'conv-2');

    let memories = await memoryRepo.getActiveMemories(userId);
    expect(memories).toHaveLength(1);
    expect(memories[0].factText).toContain('React');

    // Third observation in conv-3: candidate already promoted, should not duplicate persistent row
    await memoryRepo.extractAndSaveFacts(userId, 'مكتبة React شغالة تمام', 'conv-3');

    memories = await memoryRepo.getActiveMemories(userId);
    expect(memories).toHaveLength(1);
  });

  // Test 8: Safety gate rejection -> sensitive text blocked from observation and persistent memory
  test('Test 8: Safety gate rejection blocks both observation entry and persistent memory', async () => {
    const userId = getTestUserId('user_obs_8');

    // Text containing sensitive data
    await memoryRepo.extractAndSaveFacts(userId, 'احفظ أن كلمة السر هي SecretPass123!@#', 'conv-leak');

    const candidates = await evidenceRepo.getCandidates(userId);
    expect(candidates).toHaveLength(0);

    const memories = await memoryRepo.getActiveMemories(userId);
    expect(memories).toHaveLength(0);
  });

  // Test 9: Concurrency / race condition test -> concurrent recordObservation calls
  test('Test 9: Concurrent recordObservation calls accumulate count properly without race condition duplicates', async () => {
    const userId = getTestUserId('user_obs_9');
    const candidateKey = 'tech.python';

    // Fire 3 concurrent observations
    await Promise.all([
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'Python script 1',
        canonicalFact: 'المستخدم يعمل مع بايثون (Python)',
        source: 'automatic_extraction',
        confidence: 0.60,
        conversationId: 'conv-p1',
      }),
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'Python script 2',
        canonicalFact: 'المستخدم يعمل مع بايثون (Python)',
        source: 'automatic_extraction',
        confidence: 0.60,
        conversationId: 'conv-p2',
      }),
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'Python script 3',
        canonicalFact: 'المستخدم يعمل مع بايثون (Python)',
        source: 'automatic_extraction',
        confidence: 0.60,
        conversationId: 'conv-p3',
      }),
    ]);

    const candidate = await evidenceRepo.getCandidateByKey(userId, candidateKey);
    expect(candidate).toBeDefined();
    expect(candidate?.evidenceCount).toBe(3);
    expect(candidate?.conversationCount).toBe(3);

    const candidates = await evidenceRepo.getCandidates(userId);
    expect(candidates).toHaveLength(1); // Exactly 1 record, no duplicate keys!
  });

  // Test 10: Retrieval integration -> unpromoted observation is NOT retrieved, promoted observation IS retrieved
  test('Test 10: Selective retrieval ignores unpromoted observation candidates and includes promoted memories', async () => {
    const userId = getTestUserId('user_obs_10');
    const retrievalService = MemoryRetrievalService.getInstance(memoryRepo);

    // 1. Single casual observation of Docker -> unpromoted
    await memoryRepo.extractAndSaveFacts(userId, 'أنا شغلت حاوية Docker على السيرفر', 'conv-d1');

    const resultBefore = await retrievalService.retrieve({
      userId,
      message: 'عايز أظبط إعدادات Docker',
    });
    expect(resultBefore).toHaveLength(0); // Not in memory_items yet!

    // 2. Cross-conversation reinforcement -> promoted!
    await memoryRepo.extractAndSaveFacts(userId, 'الـ Docker container بتاعي اشتغل', 'conv-d2');

    const resultAfter = await retrievalService.retrieve({
      userId,
      message: 'عايز أظبط إعدادات Docker',
    });
    expect(resultAfter).toHaveLength(1);
    expect(resultAfter[0].memory.factText).toContain('Docker');
  });

  // Test 11: Concurrent Evidence Idempotency (Atomic PostgreSQL UPSERT)
  test('Test 11: Concurrent duplicate evidence: identical observations arriving simultaneously increment evidenceCount only once (3 -> 4, not 3 -> 5)', async () => {
    const userId = getTestUserId('user_concurrent_idemp');
    const candidateKey = 'tech.flutter';

    // 1. Seed initial 3 observations across 3 distinct conversations
    await evidenceRepo.recordObservation({
      userId,
      candidateKey,
      category: 'technical_context',
      rawSignal: 'أنا بستخدم Flutter',
      canonicalFact: 'المستخدم يعمل مع فلاتر (Flutter)',
      source: 'automatic_extraction',
      confidence: 0.8,
      conversationId: 'conv_init_1',
    });
    await evidenceRepo.recordObservation({
      userId,
      candidateKey,
      category: 'technical_context',
      rawSignal: 'مشروعي شغال بـ Flutter',
      canonicalFact: 'المستخدم يعمل مع فلاتر (Flutter)',
      source: 'automatic_extraction',
      confidence: 0.8,
      conversationId: 'conv_init_2',
    });
    const obs3 = await evidenceRepo.recordObservation({
      userId,
      candidateKey,
      category: 'technical_context',
      rawSignal: 'التطبيق مبني بـ Flutter',
      canonicalFact: 'المستخدم يعمل مع فلاتر (Flutter)',
      source: 'automatic_extraction',
      confidence: 0.8,
      conversationId: 'conv_init_3',
    });
    expect(obs3.candidate.evidenceCount).toBe(3);

    // 2. Fire 2 identical observations simultaneously (Request A and Request B concurrently)
    const duplicateObservation = {
      userId,
      candidateKey,
      category: 'technical_context' as const,
      rawSignal: 'نفس الملاحظة بالضبط وصلت مرتين في نفس اللحظة',
      canonicalFact: 'المستخدم يعمل مع فلاتر (Flutter)',
      source: 'automatic_extraction' as const,
      confidence: 0.8,
      conversationId: 'conv_concurrent_x',
    };

    const [resA, resB] = await Promise.all([
      evidenceRepo.recordObservation(duplicateObservation),
      evidenceRepo.recordObservation(duplicateObservation),
    ]);

    // 3. Atomicity check: evidenceCount must be 4, NOT 5!
    expect(resA.candidate.evidenceCount).toBe(4);
    expect(resB.candidate.evidenceCount).toBe(4);

    const finalCandidate = await evidenceRepo.getCandidateByKey(userId, candidateKey);
    expect(finalCandidate).toBeDefined();
    expect(finalCandidate!.evidenceCount).toBe(4); // 3 -> 4, strictly idempotent under concurrency!
    expect(finalCandidate!.conversationCount).toBe(4);
  });
});
