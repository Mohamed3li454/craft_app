import { DatabaseManager } from '../src/database/connection';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { MemoryConsolidationService } from '../src/modules/memory/memory_consolidation.service';
import { SemanticContradictionService } from '../src/modules/memory/semantic_contradiction.service';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';
import { calculateDynamicConfidence } from '../src/modules/memory/types';

describe('Phase 2.7 — Cross-Conversation Intelligence', () => {
  let memoryRepo: MemoryRepository;
  let evidenceRepo: MemoryEvidenceRepository;
  let consolidationService: MemoryConsolidationService;
  let contradictionService: SemanticContradictionService;
  let retrievalService: MemoryRetrievalService;
  let assembler: MemoryContextAssembler;

  beforeAll(() => {
    const db = DatabaseManager.getInstance();
    memoryRepo = new MemoryRepository(db);
    evidenceRepo = MemoryEvidenceRepository.getInstance(db);
    contradictionService = SemanticContradictionService.getInstance();
    consolidationService = MemoryConsolidationService.getInstance();
    retrievalService = MemoryRetrievalService.getInstance(memoryRepo);
    assembler = MemoryContextAssembler.getInstance();
  });

  beforeEach(() => {
    memoryRepo.clearInMemoryStore();
    evidenceRepo.clearInMemoryStore();
  });

  // ============================================================================
  // Scenario A: Same Fact Across Multiple Conversations
  // ============================================================================
  test('Scenario A: Same fact observed across 3 conversations produces 1 canonical memory with conversationCount=3', async () => {
    const userId = `user_cross_a_${Date.now()}`;
    const factText = 'المستخدم يعمل كمطور تطبيقات Flutter';
    const category = 'profession';

    // Conversation 1
    await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.75,
      metadata: { conversationId: 'conv_1', evidenceCount: 1 },
    });

    // Conversation 2
    await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.75,
      metadata: { conversationId: 'conv_2', evidenceCount: 1 },
    });

    // Conversation 3
    await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.75,
      metadata: { conversationId: 'conv_3', evidenceCount: 1 },
    });

    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(1);

    const canonical = active[0];
    expect(canonical.factText).toBe(factText);
    expect(canonical.metadata?.conversationCount).toBe(3);

    const convIds = canonical.metadata?.conversationIds as string[];
    expect(convIds).toBeDefined();
    expect(convIds).toHaveLength(3);
    expect(convIds).toContain('conv_1');
    expect(convIds).toContain('conv_2');
    expect(convIds).toContain('conv_3');

    // Monotonic confidence boosted by conversation diversity
    expect(canonical.confidence).toBeGreaterThanOrEqual(0.75);
  });

  // ============================================================================
  // Scenario B: Same Conversation Repetition
  // ============================================================================
  test('Scenario B: Same fact repeated twice within the same conversation has conversationCount=1', async () => {
    const userId = `user_cross_b_${Date.now()}`;
    const factText = 'المستخدم يفضل كتابة الاختبارات بـ Jest';
    const category = 'technical_preference';

    // Observation 1 in conv_1
    await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.60,
      metadata: { conversationId: 'conv_1', evidenceCount: 1, evidenceFingerprint: 'fp_b1' },
    });

    // Observation 2 in SAME conv_1
    await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.60,
      metadata: { conversationId: 'conv_1', evidenceCount: 1, evidenceFingerprint: 'fp_b2' },
    });

    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(1);

    const memory = active[0];
    expect(memory.metadata?.conversationCount).toBe(1);
    expect(memory.metadata?.conversationIds).toEqual(['conv_1']);
    expect(memory.metadata?.evidenceCount).toBe(2);
  });

  // ============================================================================
  // Scenario C: Idempotent Replay
  // ============================================================================
  test('Scenario C: Replaying the same observation with identical fingerprint does not increment counts or confidence', async () => {
    const userId = `user_cross_c_${Date.now()}`;
    const factText = 'المستخدم مهتم بتعلم Rust';
    const category = 'interest';
    const fingerprint = 'fixed_fingerprint_c_123';

    // First save
    const first = await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.70,
      metadata: {
        conversationId: 'conv_c1',
        evidenceCount: 1,
        evidenceFingerprint: fingerprint,
        evidenceFingerprints: [fingerprint],
      },
    });

    const confAfterFirst = first.confidence;
    const evAfterFirst = first.metadata?.evidenceCount;

    // Replay same observation
    const second = await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.70,
      metadata: {
        conversationId: 'conv_c1',
        evidenceCount: 1,
        evidenceFingerprint: fingerprint,
        evidenceFingerprints: [fingerprint],
      },
    });

    expect(second.metadata?.evidenceCount).toBe(evAfterFirst);
    expect(second.metadata?.conversationCount).toBe(1);
    expect(second.confidence).toBe(confAfterFirst);
  });

  // ============================================================================
  // Scenario D: Different Facts Coexist
  // ============================================================================
  test('Scenario D: Distinct technical competencies across conversations coexist without superseding each other', async () => {
    const userId = `user_cross_d_${Date.now()}`;

    // Conv A: Flutter
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter منذ سنتين', 'technical_context', {
      metadata: { conversationId: 'conv_A' },
    });

    // Conv B: React
    await memoryRepo.saveFact(userId, 'المستخدم يتعلم مكتبة React حالياً', 'technical_context', {
      metadata: { conversationId: 'conv_B' },
    });

    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(2);

    const facts = active.map((m) => m.factText);
    expect(facts.some((f) => f.includes('Flutter'))).toBe(true);
    expect(facts.some((f) => f.includes('React'))).toBe(true);
  });

  // ============================================================================
  // Scenario E: Cross-Conversation Evolution
  // ============================================================================
  test('Scenario E: Career change across conversations evolves memory from current to historical without losing provenance', async () => {
    const userId = `user_cross_e_${Date.now()}`;

    // Conversation 1: Company X
    const memX = await memoryRepo.saveFact(
      userId,
      'المستخدم يعمل في شركة Google',
      'profession',
      {
        factKey: 'profession.current',
        temporalState: 'current',
        metadata: { conversationId: 'conv_1' },
      }
    );

    // Conversation 2: Company Y
    const memY = await memoryRepo.saveFact(
      userId,
      'المستخدم ترك Google وبدأ العمل في شركة DeepMind',
      'profession',
      {
        factKey: 'profession.current',
        temporalState: 'current',
        metadata: { conversationId: 'conv_2' },
      }
    );

    const active = await memoryRepo.getActiveMemories(userId);
    const googleMem = active.find((m) => m.id === memX.id);
    const deepMindMem = active.find((m) => m.id === memY.id);

    expect(deepMindMem).toBeDefined();
    expect(deepMindMem?.temporalState).toBe('current');
    expect(deepMindMem?.metadata?.conversationIds).toContain('conv_2');

    // Google memory transitioned to historical
    expect(googleMem?.temporalState).toBe('historical');
    expect(googleMem?.metadata?.conversationIds).toContain('conv_1');
  });

  // ============================================================================
  // Scenario F: Historical vs Current Protection
  // ============================================================================
  test('Scenario F: Consolidation never merges historical and current memories into a single record', async () => {
    const userId = `user_cross_f_${Date.now()}`;

    // Historical in conv 1
    await memoryRepo.saveFact(userId, 'المستخدم كان يعمل كمطور PHP سابقاً', 'technical_context', {
      temporalState: 'historical',
      metadata: { conversationId: 'conv_1' },
    });

    // Current in conv 2
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Go حالياً', 'technical_context', {
      temporalState: 'current',
      metadata: { conversationId: 'conv_2' },
    });

    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(2);

    const consolidationResults = await memoryRepo.consolidateMemoriesForUser(userId);
    // Historical vs current must not merge
    expect(consolidationResults.filter((r) => r.action === 'merge')).toHaveLength(0);

    const activeAfter = await memoryRepo.getActiveMemories(userId);
    expect(activeAfter).toHaveLength(2);
  });

  // ============================================================================
  // Scenario G: Planned vs Current Transition Support
  // ============================================================================
  test('Scenario G: Planned future intention and current active skill remain separate records', async () => {
    const userId = `user_cross_g_${Date.now()}`;

    // Conv A: planned
    await memoryRepo.saveFact(userId, 'المستخدم يخطط لتعلم Kubernetes قريباً', 'technical_context', {
      temporalState: 'planned',
      metadata: { conversationId: 'conv_plan' },
    });

    // Conv B: current
    await memoryRepo.saveFact(userId, 'المستخدم يستخدم Kubernetes في بيئة الإنتاج', 'technical_context', {
      temporalState: 'current',
      metadata: { conversationId: 'conv_prod' },
    });

    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(2);

    const states = active.map((m) => m.temporalState);
    expect(states).toContain('planned');
    expect(states).toContain('current');
  });

  // ============================================================================
  // Scenario H: Confidence Diversity Benefit
  // ============================================================================
  test('Scenario H: Dynamic confidence calculation rewards conversation diversity over single-session repetitions', () => {
    // 2 observations across 2 distinct conversations
    const confMultiConv = calculateDynamicConfidence({
      evidenceCount: 2,
      conversationCount: 2,
      sources: ['automatic_extraction'],
    });

    // 2 observations in 1 single conversation
    const confSingleConv = calculateDynamicConfidence({
      evidenceCount: 2,
      conversationCount: 1,
      sources: ['automatic_extraction'],
    });

    // Diversity boost (+0.16 vs +0.04)
    expect(confMultiConv).toBeGreaterThan(confSingleConv);
    expect(confMultiConv).toBe(0.61); // 0.45 base + 0.16 conv diversity
    expect(confSingleConv).toBe(0.49); // 0.45 base + 0.04 single repeat
  });

  // ============================================================================
  // Scenario I: Consolidation Provenance Preservation
  // ============================================================================
  test('Scenario I: Consolidating 3 paraphrased variants preserves all conversation IDs and marks duplicates superseded', async () => {
    const userId = `user_cross_i_${Date.now()}`;
    const pool = DatabaseManager.getInstance().getPool();
    const userUuid = await (memoryRepo as any).resolveUserId(userId);

    const mem1 = await memoryRepo.saveFact(userId, 'المستخدم يعمل كمهندس برمجيات محترف', 'profession', {
      temporalState: 'current',
      metadata: { conversationId: 'conv_alpha', evidenceFingerprint: 'fp_i1' },
    });

    let mem2Id: string;
    let mem3Id: string;

    if (pool) {
      const res2 = await pool.query(
        `INSERT INTO memory_items (
           id, user_id, fact_text, category, status, confidence, importance, temporal_state, metadata, created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1,
           'المستخدم شغال مهندس برمجيات محترف', 'profession', 'active', 0.75, 'normal', 'current',
           $2::jsonb, NOW(), NOW()
         ) RETURNING id`,
        [userUuid, JSON.stringify({ conversationIds: ['conv_beta'], evidenceFingerprint: 'fp_i2' })]
      );
      mem2Id = res2.rows[0].id;

      const res3 = await pool.query(
        `INSERT INTO memory_items (
           id, user_id, fact_text, category, status, confidence, importance, temporal_state, metadata, created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1,
           'المستخدم يعمل كمهندس برمجيات محترف جداً', 'profession', 'active', 0.75, 'normal', 'current',
           $2::jsonb, NOW(), NOW()
         ) RETURNING id`,
        [userUuid, JSON.stringify({ conversationIds: ['conv_gamma'], evidenceFingerprint: 'fp_i3' })]
      );
      mem3Id = res3.rows[0].id;
    } else {
      const item2 = {
        id: `mem_i2_${Date.now()}`,
        userId: userUuid,
        factText: 'المستخدم شغال مهندس برمجيات محترف',
        category: 'profession',
        status: 'active',
        temporalState: 'current',
        confidence: 0.75,
        importance: 'normal',
        metadata: { conversationIds: ['conv_beta'], evidenceFingerprint: 'fp_i2' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const item3 = {
        id: `mem_i3_${Date.now()}`,
        userId: userUuid,
        factText: 'المستخدم يعمل كمهندس برمجيات محترف جداً',
        category: 'profession',
        status: 'active',
        temporalState: 'current',
        confidence: 0.75,
        importance: 'normal',
        metadata: { conversationIds: ['conv_gamma'], evidenceFingerprint: 'fp_i3' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const list = (memoryRepo as any).inMemoryItems.get(userUuid) || [];
      list.push(item2, item3);
      (memoryRepo as any).inMemoryItems.set(userUuid, list);
      mem2Id = item2.id;
      mem3Id = item3.id;
    }

    // Verify 3 active before consolidation
    const activeBefore = await memoryRepo.getActiveMemories(userId);
    expect(activeBefore).toHaveLength(3);

    // Run consolidation
    await memoryRepo.consolidateMemoriesForUser(userId);

    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(1);

    const canonical = active[0];
    const convIds = canonical.metadata?.conversationIds as string[];
    expect(convIds).toBeDefined();
    expect(convIds).toContain('conv_alpha');
    expect(convIds).toContain('conv_beta');
    expect(convIds).toContain('conv_gamma');
    expect(canonical.metadata?.conversationCount).toBe(3);

    // Duplicates are traceable and superseded in SQL or in-memory
    if (pool) {
      const allRows = await pool.query(
        `SELECT id, status, metadata FROM memory_items WHERE user_id = $1`,
        [userUuid]
      );
      expect(allRows.rows.length).toBe(3);
      const superseded = allRows.rows.filter((r: any) => r.status === 'superseded');
      expect(superseded).toHaveLength(2);
      for (const dup of superseded) {
        expect(dup.metadata?.consolidatedInto).toBe(canonical.id);
        expect(dup.metadata?.supersedeType).toBe('consolidation');
      }
    } else {
      const all = (memoryRepo as any).inMemoryItems?.get(userUuid) || [];
      const superseded = all.filter((m: any) => m.status === 'superseded');
      expect(superseded).toHaveLength(2);
      for (const dup of superseded) {
        expect(dup.metadata?.consolidatedInto).toBe(canonical.id);
        expect(dup.metadata?.supersedeType).toBe('consolidation');
      }
    }
  });

  // ============================================================================
  // Scenario J: Retrieval of Relevant Cross-Conversation Memory
  // ============================================================================
  test('Scenario J: Query in Conversation C retrieves relevant memory reinforced across Conversations A and B', async () => {
    const userId = `user_cross_j_${Date.now()}`;

    // Reinforced memory across conv A and B
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession', {
      confidence: 0.85,
      importance: 'high',
      metadata: { conversationIds: ['conv_A', 'conv_B'], conversationCount: 2 },
    });

    // In Conversation C, user asks about their profession
    const retrieved = await retrievalService.retrieve({
      userId,
      message: 'أنا بشتغل إيه؟',
    });

    expect(retrieved.length).toBeGreaterThanOrEqual(1);
    expect(retrieved[0].memory.factText).toContain('Flutter');
    expect(retrieved[0].relevanceScore).toBeGreaterThanOrEqual(0.20);
  });

  // ============================================================================
  // Scenario K: Irrelevant Memory Remains Excluded
  // ============================================================================
  test('Scenario K: Memory with high conversationCount is strictly excluded when query is irrelevant', async () => {
    const userId = `user_cross_k_${Date.now()}`;

    // Memory with high conversation consensus
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession', {
      confidence: 0.95,
      importance: 'high',
      metadata: {
        conversationIds: ['conv_1', 'conv_2', 'conv_3', 'conv_4', 'conv_5'],
        conversationCount: 5,
        evidenceCount: 10,
      },
    });

    // Unrelated query about cooking/weather
    const retrieved = await retrievalService.retrieve({
      userId,
      message: 'عايز طريقة عمل البيتزا في البيت',
    });

    expect(retrieved).toHaveLength(0);
  });

  // ============================================================================
  // Scenario L: Legacy Compatibility
  // ============================================================================
  test('Scenario L: Legacy memory without conversation metadata is handled safely without crashing', async () => {
    const userId = `user_cross_l_${Date.now()}`;

    // Simulate legacy memory without conversation metadata
    const legacyMem = await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact', {
      metadata: { legacyField: true },
    });

    expect(legacyMem.metadata?.conversationCount).toBe(0);
    expect(legacyMem.metadata?.conversationIds).toEqual([]);

    // Active retrieval works seamlessly
    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(1);

    // Reinforce legacy memory with new conversation provenance
    const updated = await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact', {
      metadata: { conversationId: 'conv_modern_1' },
    });

    expect(updated.metadata?.conversationIds).toEqual(['conv_modern_1']);
    expect(updated.metadata?.conversationCount).toBe(1);
  });

  // ============================================================================
  // Scenario M: Concurrent Cross-Conversation Evidence
  // ============================================================================
  test('Scenario M: Concurrent observations from distinct conversations accumulate atomically without lost updates', async () => {
    const userId = `user_cross_m_${Date.now()}`;
    const candidateKey = 'tech.concurrent_test';

    // Simulate two concurrent observations from Conv A and Conv B arriving at the exact same moment
    const [resA, resB] = await Promise.all([
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'أنا بستخدم Docker',
        canonicalFact: 'المستخدم يستخدم Docker في التطوير',
        source: 'automatic_extraction',
        confidence: 0.70,
        conversationId: 'conv_concurrent_A',
      }),
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'شغال بـ Docker',
        canonicalFact: 'المستخدم يستخدم Docker في التطوير',
        source: 'automatic_extraction',
        confidence: 0.70,
        conversationId: 'conv_concurrent_B',
      }),
    ]);

    // Inspect the evidence candidate
    const finalCandidate = resB.candidate.conversationCount >= resA.candidate.conversationCount
      ? resB.candidate
      : resA.candidate;

    expect(finalCandidate.conversationIds).toContain('conv_concurrent_A');
    expect(finalCandidate.conversationIds).toContain('conv_concurrent_B');
    expect(finalCandidate.conversationCount).toBe(2);
    expect(finalCandidate.evidenceCount).toBe(2);
  });

  // ============================================================================
  // Scenario N: Scale Past 20 Conversations with Bounded Conversation IDs
  // ============================================================================
  test('Scenario N: More than 20 conversations correctly tracks cumulative conversationCount while bounding conversationIds to last 20', async () => {
    const userId = `user_cross_n_${Date.now()}`;
    const factText = 'المستخدم يتقن لغة Python';
    const category = 'technical_context';

    // Simulate 35 distinct conversations sequentially reinforcing the same fact
    for (let i = 1; i <= 35; i++) {
      await memoryRepo.saveFact(userId, factText, category, {
        confidence: 0.70,
        metadata: { conversationId: `conv_scale_${i}` },
      });
    }

    const active = await memoryRepo.getActiveMemories(userId);
    expect(active).toHaveLength(1);
    const mem = active[0];

    // Total conversation count must reflect all 35 unique conversations
    expect(mem.metadata?.conversationCount).toBe(35);
    // Bounded conversationIds must contain at most 20 elements (the most recent 20)
    expect(mem.metadata?.conversationIds).toHaveLength(20);
    expect(mem.metadata?.conversationIds).toContain('conv_scale_35');
    expect(mem.metadata?.conversationIds).toContain('conv_scale_16');
    expect(mem.metadata?.conversationIds).not.toContain('conv_scale_1');

    // Strict Idempotency: Replaying an existing recent conversation does NOT increment conversationCount
    const replayed = await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.70,
      metadata: { conversationId: 'conv_scale_35' },
    });
    expect(replayed.metadata?.conversationCount).toBe(35);
    expect(replayed.metadata?.conversationIds).toHaveLength(20);
  });

  // ============================================================================
  // Scenario O: Legacy Memory with Unknown Provenance Transitions Safely
  // ============================================================================
  test('Scenario O: Legacy memory without conversation data starts at count=0, ids=[], then increments cleanly on new conversations', async () => {
    const userId = `user_cross_o_${Date.now()}`;
    const factText = 'المستخدم يفضل التوثيق الواضح والمباشر';
    const category = 'preference';

    // 1. Legacy memory created before Phase 2.7 (no conversation metadata)
    const legacyMem = await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.80,
      metadata: { legacyImport: true },
    });

    expect(legacyMem.metadata?.conversationCount).toBe(0);
    expect(legacyMem.metadata?.conversationIds).toEqual([]);

    // 2. First modern observation arrives from Conversation A
    const reinforcedA = await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.80,
      metadata: { conversationId: 'conv_A' },
    });

    expect(reinforcedA.metadata?.conversationCount).toBe(1);
    expect(reinforcedA.metadata?.conversationIds).toEqual(['conv_A']);

    // 3. Second modern observation arrives from Conversation B
    const reinforcedB = await memoryRepo.saveFact(userId, factText, category, {
      confidence: 0.80,
      metadata: { conversationId: 'conv_B' },
    });

    expect(reinforcedB.metadata?.conversationCount).toBe(2);
    expect(reinforcedB.metadata?.conversationIds).toEqual(['conv_A', 'conv_B']);
  });

  // ============================================================================
  // Scenario P: Concurrent Distinct Conversations
  // ============================================================================
  test('Scenario P: Three concurrent distinct conversations (A, B, C) accumulate atomically without lost updates to conversationCount=3', async () => {
    const userId = `user_cross_p_${Date.now()}`;
    const candidateKey = 'tech.concurrent_p_test';

    // Simulate three concurrent observations from Conv A, Conv B, and Conv C arriving in parallel
    await Promise.all([
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'أنا شغال بـ TypeScript',
        canonicalFact: 'المستخدم يتقن لغة TypeScript',
        source: 'automatic_extraction',
        confidence: 0.70,
        conversationId: 'conv_p_A',
      }),
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'مشروعي مبني بـ TypeScript',
        canonicalFact: 'المستخدم يتقن لغة TypeScript',
        source: 'automatic_extraction',
        confidence: 0.70,
        conversationId: 'conv_p_B',
      }),
      evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'بكتب كود TypeScript يومياً',
        canonicalFact: 'المستخدم يتقن لغة TypeScript',
        source: 'automatic_extraction',
        confidence: 0.70,
        conversationId: 'conv_p_C',
      }),
    ]);

    // Retrieve active candidate directly from repo
    const candidate = await evidenceRepo.getCandidateByKey(userId, candidateKey);
    expect(candidate).toBeDefined();
    expect(candidate!.conversationCount).toBe(3);
    expect(candidate!.evidenceCount).toBe(3);
    expect(candidate!.conversationIds).toContain('conv_p_A');
    expect(candidate!.conversationIds).toContain('conv_p_B');
    expect(candidate!.conversationIds).toContain('conv_p_C');
  });
});
