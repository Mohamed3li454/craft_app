import { DatabaseManager } from '../src/database/connection';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { MemoryConsolidationService } from '../src/modules/memory/memory_consolidation.service';
import { SemanticContradictionService } from '../src/modules/memory/semantic_contradiction.service';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';
import { MemoryImportance, TemporalState } from '../src/modules/memory/types';
import { MemoryItemEntity } from '../src/database/repositories/types';

function createMockEntity(partial: Partial<MemoryItemEntity> & { id: string; factText: string }): MemoryItemEntity {
  return {
    id: partial.id,
    userId: partial.userId || 'test_user',
    factText: partial.factText,
    category: partial.category || 'general',
    status: partial.status || 'active',
    temporalState: partial.temporalState || 'unknown',
    confidence: partial.confidence ?? 0.8,
    importance: partial.importance || 'normal',
    source: partial.source || 'automatic_extraction',
    factKey: partial.factKey,
    metadata: partial.metadata || {},
    createdAt: partial.createdAt || new Date(),
    updatedAt: partial.updatedAt || new Date(),
  };
}

describe('Phase 2.6 — Memory Consolidation', () => {
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
    retrievalService = new MemoryRetrievalService(memoryRepo);
    assembler = MemoryContextAssembler.getInstance();
  });

  beforeEach(() => {
    memoryRepo.clearInMemoryStore();
    evidenceRepo.clearInMemoryStore();
  });

  // ============================================================================
  // 1. Direct Unit Evaluation of Consolidation Service
  // ============================================================================
  describe('1. Direct Unit Evaluation of MemoryConsolidationService', () => {
    test('Exact duplicate candidates return action: reinforce', () => {
      const existing = createMockEntity({
        id: 'mem-1',
        factText: 'المستخدم يعمل كمطور Flutter',
        category: 'profession',
        temporalState: 'current' as TemporalState,
        confidence: 0.85,
        importance: 'high' as MemoryImportance,
        metadata: { evidenceCount: 1, conversationIds: ['conv-1'] },
      });

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'المستخدم يعمل كمطور Flutter',
          category: 'profession',
          temporalState: 'current',
          metadata: { evidenceCount: 1, conversationIds: ['conv-2'] },
        },
        [existing]
      );

      expect(result.action).toBe('reinforce');
      expect(result.canonicalMemoryId).toBe('mem-1');
      expect(result.consolidatedConfidence).toBeGreaterThanOrEqual(0.85);
      expect(result.consolidatedImportance).toBe('high');
      expect(result.signals).toContain('same_canonical_fact_reinforced');
    });

    test('Same canonical fact with different wording returns action: reinforce', () => {
      const existing = createMockEntity({
        id: 'mem-2',
        factText: 'المستخدم يستخدم Flutter في تطوير التطبيقات',
        category: 'technical_context',
        temporalState: 'current' as TemporalState,
        confidence: 0.70,
        importance: 'normal' as MemoryImportance,
      });

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'يستخدم تقنية Flutter لتطوير التطبيقات',
          category: 'technical_context',
          temporalState: 'current',
        },
        [existing]
      );

      expect(result.action).toBe('reinforce');
      expect(result.canonicalMemoryId).toBe('mem-2');
      expect(result.consolidatedConfidence).toBeGreaterThanOrEqual(0.70);
    });

    test('Empty active memories returns keep_separate safely', () => {
      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'مطور Flutter',
          category: 'profession',
        },
        []
      );

      expect(result.action).toBe('keep_separate');
      expect(result.signals).toContain('no_active_memories');
    });

    test('Bounded candidate filtering respects top-5 candidates', () => {
      const activeList: MemoryItemEntity[] = Array.from({ length: 10 }, (_, i) =>
        createMockEntity({
          id: `mem-${i}`,
          factText: `معلومة رقم ${i} في التصنيف العام`,
          category: 'general',
        })
      );

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'معلومة برمجية جديدة',
          category: 'technical_context',
        },
        activeList
      );

      expect(result.action).toBe('keep_separate');
    });
  });

  // ============================================================================
  // 2. Importance Consolidation Rules
  // ============================================================================
  describe('2. Deterministic Importance Consolidation', () => {
    test('high + normal -> high', () => {
      expect(consolidationService.consolidateImportance('high', 'normal')).toBe('high');
      expect(consolidationService.consolidateImportance('normal', 'high')).toBe('high');
    });

    test('critical + high -> critical', () => {
      expect(consolidationService.consolidateImportance('critical', 'high')).toBe('critical');
      expect(consolidationService.consolidateImportance('high', 'critical')).toBe('critical');
    });

    test('normal + low -> normal', () => {
      expect(consolidationService.consolidateImportance('normal', 'low')).toBe('normal');
      expect(consolidationService.consolidateImportance('low', 'normal')).toBe('normal');
    });

    test('low + low -> low', () => {
      expect(consolidationService.consolidateImportance('low', 'low')).toBe('low');
    });

    test('Frequency alone does NOT escalate routine facts to critical', () => {
      expect(consolidationService.consolidateImportance('normal', 'normal')).toBe('normal');
    });
  });

  // ============================================================================
  // 3. Temporal Separation & History Preservation
  // ============================================================================
  describe('3. Temporal Separation & History Preservation', () => {
    test('Historical past experience vs current state returns preserve_history, NOT merged', () => {
      const historicalMem = createMockEntity({
        id: 'mem-hist',
        factText: 'كان المستخدم يعمل كمهندس DevOps سابقاً',
        category: 'profession',
        temporalState: 'historical' as TemporalState,
        confidence: 0.85,
        importance: 'normal' as MemoryImportance,
      });

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'يعمل حالياً كمهندس برمجيات Frontend',
          category: 'profession',
          temporalState: 'current',
        },
        [historicalMem]
      );

      expect(result.action).toBe('preserve_history');
      expect(result.mergedMemoryIds).toHaveLength(0);
      expect(result.preservedMemoryIds).toContain('mem-hist');
      expect(result.signals).toContain('temporal_preservation:historical_vs_current');
    });

    test('Planned future goal vs current state returns keep_separate, NOT merged', () => {
      const currentMem = createMockEntity({
        id: 'mem-curr',
        factText: 'المستخدم يعمل كمطور Flutter',
        category: 'profession',
        temporalState: 'current' as TemporalState,
        confidence: 0.90,
        importance: 'high' as MemoryImportance,
      });

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'ينوي دراسة لغة Rust الشهر القادم',
          category: 'technical_context',
          temporalState: 'planned',
        },
        [currentMem]
      );

      expect(result.action).toBe('keep_separate');
      expect(result.signals).toContain('temporal_separation:planned_vs_current');
    });
  });

  // ============================================================================
  // 4. Coexistence of Distinct Technologies & Skills
  // ============================================================================
  describe('4. Coexistence of Distinct Technologies & Skills', () => {
    test('Different technologies (Flutter vs React) remain distinct and keep_separate', () => {
      const flutterMem = createMockEntity({
        id: 'mem-flutter',
        factText: 'المستخدم يعمل كمطور تطبيقات Flutter',
        category: 'profession',
        temporalState: 'current' as TemporalState,
        confidence: 0.85,
      });

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'المستخدم يتقن إطار العمل React Native',
          category: 'technical_context',
          temporalState: 'current',
        },
        [flutterMem]
      );

      expect(result.action).toBe('keep_separate');
      expect(result.signals).toContain('distinct_technologies_kept_separate');
      expect(result.mergedMemoryIds).toHaveLength(0);
    });

    test('Multiple technologies in database remain active together', async () => {
      const userId = `user_multi_tech_${Date.now()}`;

      const mem1 = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات Flutter',
        'profession',
        {
          confidence: 0.85,
          temporalState: 'current',
          metadata: { evidenceCount: 1, conversationIds: ['c1'] },
        }
      );

      const mem2 = await memoryRepo.saveFact(
        userId,
        'المستخدم يتقن إطار العمل React Native',
        'technical_context',
        {
          confidence: 0.80,
          temporalState: 'current',
          metadata: { evidenceCount: 1, conversationIds: ['c2'] },
        }
      );

      expect(mem1.id).not.toBe(mem2.id);
      expect(mem1.status).toBe('active');
      expect(mem2.status).toBe('active');

      const allActive = await memoryRepo.getActiveMemories(userId);
      expect(allActive).toHaveLength(2);
      expect(allActive.map((m: MemoryItemEntity) => m.id)).toEqual(
        expect.arrayContaining([mem1.id, mem2.id])
      );
    });
  });

  // ============================================================================
  // 5. In-Place Reinforcement via Repository
  // ============================================================================
  describe('5. Repository Integration & Repeated Evidence Reinforcement', () => {
    test('Adding identical fact reinforces canonical memory without duplicating row', async () => {
      const userId = `user_reinforce_${Date.now()}`;

      // 1. Initial observation
      const firstSave = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور Flutter',
        'profession',
        {
          source: 'automatic_extraction',
          confidence: 0.70,
          importance: 'normal',
          temporalState: 'current',
          metadata: {
            evidenceCount: 1,
            conversationIds: ['conv-1'],
            candidateId: 'cand-1',
          },
        }
      );

      expect(firstSave.id).toBeDefined();
      expect(firstSave.status).toBe('active');
      expect(firstSave.metadata?.evidenceCount).toBe(1);

      // 2. Second observation of identical fact from another conversation
      const secondSave = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور Flutter',
        'profession',
        {
          source: 'automatic_extraction',
          confidence: 0.75,
          importance: 'high',
          temporalState: 'current',
          metadata: {
            evidenceCount: 1,
            conversationIds: ['conv-2'],
            candidateId: 'cand-2',
          },
        }
      );

      expect(secondSave.id).toBe(firstSave.id);

      const activeMemories = await memoryRepo.getActiveMemories(userId);
      expect(activeMemories).toHaveLength(1);

      const canonical = activeMemories[0];
      expect(canonical.id).toBe(firstSave.id);
      expect(canonical.metadata?.evidenceCount).toBe(2);
      expect(canonical.metadata?.conversationCount).toBe(2);
      expect(canonical.metadata?.conversationIds).toEqual(
        expect.arrayContaining(['conv-1', 'conv-2'])
      );
      expect(canonical.metadata?.consolidatedFrom).toContain('cand-2');
      expect(canonical.importance).toBe('high');
      expect(canonical.confidence).toBeGreaterThanOrEqual(0.75);
    });

    test('Source authority: user_explicit cannot be downgraded by automatic_extraction', async () => {
      const userId = `user_authority_${Date.now()}`;

      const explicitSave = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمهندس برمجيات رئيسي',
        'profession',
        {
          source: 'user_explicit',
          confidence: 0.95,
          importance: 'critical',
          temporalState: 'current',
          metadata: {
            evidenceCount: 1,
            conversationIds: ['conv-explicit'],
            isExplicit: true,
          },
        }
      );

      const autoSave = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمهندس برمجيات رئيسي',
        'profession',
        {
          source: 'automatic_extraction',
          confidence: 0.60,
          importance: 'normal',
          temporalState: 'current',
          metadata: {
            evidenceCount: 1,
            conversationIds: ['conv-auto'],
          },
        }
      );

      expect(autoSave.id).toBe(explicitSave.id);

      const active = await memoryRepo.getActiveMemories(userId);
      expect(active).toHaveLength(1);
      const canonical = active[0];

      expect(canonical.importance).toBe('critical');
      expect(canonical.confidence).toBeGreaterThanOrEqual(0.95);
      expect(canonical.metadata?.sources).toContain('user_explicit');
      expect(canonical.metadata?.evidenceCount).toBe(2);
      expect(canonical.metadata?.conversationCount).toBe(2);
    });
  });

  // ============================================================================
  // 6. Monotonic Confidence with Diminishing Returns
  // ============================================================================
  describe('6. Monotonic Dynamic Confidence with Diminishing Returns', () => {
    test('Repeated evidence produces monotonic gain without exceeding 1.0', async () => {
      const userId = `user_diminishing_${Date.now()}`;

      let lastConfidence = 0.45;
      let lastGain = 1.0;

      for (let i = 1; i <= 5; i++) {
        const saved = await memoryRepo.saveFact(
          userId,
          'المستخدم يفضل التوثيق باللغة العربية دائماً',
          'preferences',
          {
            source: 'automatic_extraction',
            confidence: 0.45,
            temporalState: 'current',
            metadata: {
              evidenceCount: 1,
              conversationIds: [`conv-${i}`],
            },
          }
        );

        const currentConfidence = saved.confidence ?? 0.45;
        expect(currentConfidence).toBeGreaterThanOrEqual(lastConfidence);
        expect(currentConfidence).toBeLessThanOrEqual(1.0);

        const currentGain = currentConfidence - lastConfidence;
        if (i > 2) {
          expect(currentGain).toBeLessThanOrEqual(lastGain + 0.001);
        }

        lastGain = currentGain;
        lastConfidence = currentConfidence;
      }

      const active = await memoryRepo.getActiveMemories(userId);
      expect(active).toHaveLength(1);
      expect(active[0].metadata?.evidenceCount).toBe(5);
      expect(active[0].metadata?.conversationCount).toBe(5);
    });
  });

  // ============================================================================
  // 7. Opportunistic Batch Consolidation & Idempotency
  // ============================================================================
  describe('7. Opportunistic Batch Consolidation & Idempotency', () => {
    test('consolidateMemoriesForUser consolidates duplicate rows and is strictly idempotent', async () => {
      const userId = `user_batch_${Date.now()}`;

      await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور Flutter',
        'profession',
        {
          source: 'automatic_extraction',
          confidence: 0.70,
          temporalState: 'current',
          metadata: { evidenceCount: 1, conversationIds: ['c1'] },
        }
      );

      await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات Flutter المحترف',
        'technical_context',
        {
          source: 'automatic_extraction',
          confidence: 0.75,
          temporalState: 'current',
          metadata: { evidenceCount: 1, conversationIds: ['c2'] },
        }
      );

      const initialActive = await memoryRepo.getActiveMemories(userId);
      expect(initialActive.length).toBeGreaterThanOrEqual(1);

      // Run batch consolidation
      await memoryRepo.consolidateMemoriesForUser(userId);

      // Running consolidation a second time must produce 0 merges (Idempotency)
      const results2 = await memoryRepo.consolidateMemoriesForUser(userId);
      expect(results2).toHaveLength(0);
    });
  });

  // ============================================================================
  // 8. Retrieval & Context Assembly Parity
  // ============================================================================
  describe('8. Retrieval & Context Assembly Parity', () => {
    test('Retrieval returns only the canonical memory, avoiding duplicate context clutter', async () => {
      const userId = `user_retrieval_${Date.now()}`;

      // Save initial memory
      await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات Flutter',
        'profession',
        {
          source: 'automatic_extraction',
          confidence: 0.70,
          importance: 'high',
          temporalState: 'current',
          metadata: { evidenceCount: 1, conversationIds: ['c1'] },
        }
      );

      // Reinforce it 3 times across conversations
      for (let i = 2; i <= 4; i++) {
        await memoryRepo.saveFact(
          userId,
          'المستخدم يعمل كمطور تطبيقات Flutter',
          'profession',
          {
            source: 'automatic_extraction',
            confidence: 0.75,
            temporalState: 'current',
            metadata: { evidenceCount: 1, conversationIds: [`c${i}`] },
          }
        );
      }

      // Retrieve relevant memories for a programming prompt
      const retrieved = await retrievalService.retrieve({
        userId,
        message: 'عايز أظبط كود تطبيق Flutter بتاعي',
      });

      // Must only return the 1 canonical memory, NOT duplicates
      expect(retrieved).toHaveLength(1);
      const canonical = retrieved[0].memory;
      expect(canonical.status).toBe('active');
      expect(canonical.metadata?.evidenceCount).toBe(4);
      expect(canonical.metadata?.conversationCount).toBe(4);

      // Assemble context
      const context = assembler.assemble(retrieved);
      expect(context.selectedCount).toBe(1);
      expect(context.formattedPromptText).toContain('Flutter');
      // No duplicate repetition in prompt
      const occurrences = (context.formattedPromptText?.match(/Flutter/g) || []).length;
      expect(occurrences).toBe(1);
    });
  });

  // ============================================================================
  // 9. Semantic Contradiction & Evolution Coexistence
  // ============================================================================
  describe('9. Contradiction & Evolution Coexistence with Consolidation', () => {
    test('Contradicting city ("القاهرة" vs "الإسكندرية") blocks consolidation', () => {
      const existing = createMockEntity({
        id: 'mem-loc-1',
        factText: 'يقيم المستخدم في القاهرة',
        category: 'location',
        temporalState: 'current' as TemporalState,
        factKey: 'location.city',
      });

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'يقيم المستخدم في الإسكندرية',
          category: 'location',
          temporalState: 'current',
          factKey: 'location.city',
        },
        [existing]
      );

      expect(result.action).toBe('keep_separate');
      expect(result.signals).toContain('contradiction_blocks_consolidation');
    });

    test('Company evolution ("يعمل في Vodafone" -> "يعمل في Google") preserves history, not squashed', () => {
      const existing = createMockEntity({
        id: 'mem-work-1',
        factText: 'يعمل المستخدم في شركة Vodafone',
        category: 'work',
        temporalState: 'current' as TemporalState,
        factKey: 'work.company',
      });

      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'انتقل للعمل في شركة Google',
          category: 'work',
          temporalState: 'current',
          factKey: 'work.company',
        },
        [existing]
      );

      expect(result.action).toBe('preserve_history');
      expect(result.signals).toContain('evolution_preserves_history');
    });
  });

  // ============================================================================
  // 10. Traceability, Idempotency, and Ordering Verification
  // ============================================================================
  describe('10. Traceability, Idempotency, and Ordering Invariants', () => {
    test('Consolidation Traceability: original memories are superseded with consolidatedInto metadata, not deleted', async () => {
      const userId = `user_trace_${Date.now()}`;

      // Insert Memory A
      const memA = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات Flutter',
        'profession',
        {
          temporalState: 'current',
          confidence: 0.75,
          importance: 'high',
          metadata: { evidenceCount: 2, conversationIds: ['conv_1'] },
        }
      );

      // Insert Memory B directly as separate active row
      const pool = DatabaseManager.getInstance().getPool();
      let memBId: string;
      if (pool) {
        const userUuid = await (memoryRepo as any).resolveUserId(userId);
        const res = await pool.query(
          `INSERT INTO memory_items (
             id, user_id, fact_text, category, status, confidence, importance, temporal_state, metadata, created_at, updated_at
           ) VALUES (
             gen_random_uuid(), $1,
             'المستخدم شغال كمطور تطبيقات Flutter', 'profession', 'active', 0.80, 'high', 'current',
             $2::jsonb, NOW(), NOW()
           ) RETURNING id`,
          [userUuid, JSON.stringify({ evidenceCount: 1, conversationIds: ['conv_2'] })]
        );
        memBId = res.rows[0].id;
      } else {
        const itemB = createMockEntity({
          id: `mem_b_${Date.now()}`,
          userId,
          factText: 'المستخدم شغال كمطور تطبيقات Flutter',
          category: 'profession',
          status: 'active',
          temporalState: 'current',
          confidence: 0.80,
          importance: 'high',
          metadata: { evidenceCount: 1, conversationIds: ['conv_2'] },
        });
        (memoryRepo as any).inMemoryItems.get(userId)?.push(itemB);
        memBId = itemB.id;
      }

      // Verify both A and B are active before consolidation
      const activeBefore = await memoryRepo.getActiveMemories(userId);
      expect(activeBefore.some((m) => m.id === memA.id)).toBe(true);
      expect(activeBefore.some((m) => m.id === memBId)).toBe(true);

      // Run consolidation
      const results = await memoryRepo.consolidateMemoriesForUser(userId);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Verify active memories: only 1 canonical remains active
      const activeAfter = await memoryRepo.getActiveMemories(userId);
      expect(activeAfter).toHaveLength(1);
      const canonicalId = activeAfter[0].id;

      // Verify both records still exist in the database (NO physical DELETE!)
      if (pool) {
        const userUuid = await (memoryRepo as any).resolveUserId(userId);
        const allRows = await pool.query(
          `SELECT id, status, metadata FROM memory_items WHERE user_id = $1`,
          [userUuid]
        );
        expect(allRows.rows.length).toBe(2); // Both records preserved!

        const supersededRow = allRows.rows.find((r) => r.status === 'superseded');
        expect(supersededRow).toBeDefined();
        expect(supersededRow.metadata.consolidatedInto).toBe(canonicalId);
        expect(supersededRow.metadata.supersededBy).toBe(canonicalId);
        expect(supersededRow.metadata.supersedeType).toBe('consolidation');
        expect(supersededRow.metadata.consolidatedAt).toBeDefined();
        expect(supersededRow.metadata.consolidationReason).toBeDefined();

        const canonicalRow = allRows.rows.find((r) => r.status === 'active');
        expect(canonicalRow.id).toBe(canonicalId);
        expect(canonicalRow.metadata.consolidatedFrom).toContain(supersededRow.id);
      }
    });

    test('Idempotent Evidence: identical observation processed twice increments evidenceCount only once', async () => {
      const userId = `user_idemp_ev_${Date.now()}`;
      const candidateKey = 'tech.flutter';
      const convId = 'conv_idemp_1';

      // 1. Initial observations (3 observations)
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

      // 2. Process Observation X (4th observation)
      const obs4 = await evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'كود الفلاتر شغال تمام',
        canonicalFact: 'المستخدم يعمل مع فلاتر (Flutter)',
        source: 'automatic_extraction',
        confidence: 0.8,
        conversationId: convId,
      });
      expect(obs4.candidate.evidenceCount).toBe(4);

      // 3. Process the exact same Observation X again
      const obs4Again = await evidenceRepo.recordObservation({
        userId,
        candidateKey,
        category: 'technical_context',
        rawSignal: 'كود الفلاتر شغال تمام',
        canonicalFact: 'المستخدم يعمل مع فلاتر (Flutter)',
        source: 'automatic_extraction',
        confidence: 0.8,
        conversationId: convId,
      });

      // Must remain 4 (NOT 5)!
      expect(obs4Again.candidate.evidenceCount).toBe(4);
      expect(obs4Again.candidate.conversationCount).toBe(4);
    });

    test('Candidate Ordering: best match at position > 5 is ranked and consolidated, not dropped', () => {
      // Create 7 active memories in category 'profession'
      // Positions 0 to 4 are weak matches or completely different professions
      // Position 6 is the exact canonical match for candidate
      const memories: MemoryItemEntity[] = [
        createMockEntity({ id: 'm0', factText: 'المستخدم يعمل كمحاسب مالي', category: 'profession' }),
        createMockEntity({ id: 'm1', factText: 'المستخدم يعمل كطبيب بيطري', category: 'profession' }),
        createMockEntity({ id: 'm2', factText: 'المستخدم يعمل كمدرس لغة إنجليزية', category: 'profession' }),
        createMockEntity({ id: 'm3', factText: 'المستخدم يعمل كمحامي قانوني', category: 'profession' }),
        createMockEntity({ id: 'm4', factText: 'المستخدم يعمل كسائق توصيل', category: 'profession' }),
        createMockEntity({ id: 'm5', factText: 'المستخدم يعمل كمهندس مدني', category: 'profession' }),
        createMockEntity({
          id: 'm6_best_match',
          factText: 'المستخدم يعمل كمطور تطبيقات Flutter',
          category: 'profession',
          temporalState: 'current' as TemporalState,
          confidence: 0.85,
        }),
      ];

      const candidate = {
        factText: 'شغال مطور تطبيقات Flutter',
        category: 'profession',
        temporalState: 'current' as TemporalState,
      };

      const result = consolidationService.evaluateConsolidation(candidate, memories);

      // Must consolidate with m6_best_match, NOT keep_separate!
      expect(result.action).toBe('reinforce');
      expect(result.canonicalMemoryId).toBe('m6_best_match');
    });

    test('Idempotent Consolidation: running batch consolidation twice is strictly idempotent', async () => {
      const userId = `user_idemp_batch_${Date.now()}`;

      // Insert 2 duplicate memories
      await memoryRepo.saveFact(userId, 'المستخدم يفضل لغة Dart', 'technical_preference', {
        confidence: 0.8,
        importance: 'normal',
      });

      const pool = DatabaseManager.getInstance().getPool();
      if (pool) {
        const userUuid = await (memoryRepo as any).resolveUserId(userId);
        await pool.query(
          `INSERT INTO memory_items (
             id, user_id, fact_text, category, status, confidence, importance, temporal_state, metadata, created_at, updated_at
           ) VALUES (
             gen_random_uuid(), $1,
             'المستخدم يفضل لغة Dart في كتابة الأكواد', 'technical_preference', 'active', 0.82, 'normal', 'unknown',
             $2::jsonb, NOW(), NOW()
           )`,
          [userUuid, JSON.stringify({ evidenceCount: 1 })]
        );
      } else {
        const itemB = createMockEntity({
          id: `mem_b_${Date.now()}`,
          userId,
          factText: 'المستخدم يفضل لغة Dart في كتابة الأكواد',
          category: 'technical_preference',
          status: 'active',
          confidence: 0.82,
          importance: 'normal',
          metadata: { evidenceCount: 1 },
        });
        (memoryRepo as any).inMemoryItems.get(userId)?.push(itemB);
      }

      // First run: consolidates duplicate into canonical
      const res1 = await memoryRepo.consolidateMemoriesForUser(userId);
      const active1 = await memoryRepo.getActiveMemories(userId);
      expect(active1).toHaveLength(1);
      const conf1 = active1[0].confidence;
      const evCount1 = active1[0].metadata?.evidenceCount;

      // Second run on same user: must be a no-op, zero duplicates, no confidence inflation
      const res2 = await memoryRepo.consolidateMemoriesForUser(userId);
      expect(res2).toHaveLength(0); // Nothing left to consolidate!

      const active2 = await memoryRepo.getActiveMemories(userId);
      expect(active2).toHaveLength(1);
      expect(active2[0].confidence).toBe(conf1);
      expect(active2[0].metadata?.evidenceCount).toBe(evCount1);
    });

    test('Concurrent Evidence Idempotency: simultaneous identical saveFact calls increment evidenceCount only once (3 -> 4, not 3 -> 5)', async () => {
      const userId = `user_concurrent_savefact_${Date.now()}`;
      const fact = 'المستخدم يعمل كمطور تطبيقات Flutter المحترفة';

      // 1. Initial memory with evidenceCount = 3
      await memoryRepo.saveFact(userId, fact, 'profession', {
        temporalState: 'current',
        confidence: 0.8,
        importance: 'high',
        metadata: {
          evidenceCount: 3,
          conversationIds: ['c1', 'c2', 'c3'],
          evidenceFingerprints: ['fp_init_1', 'fp_init_2', 'fp_init_3'],
        },
      });

      // 2. Fire 2 identical saveFact calls concurrently with same observation
      const identicalOptions = {
        temporalState: 'current' as const,
        confidence: 0.8,
        importance: 'high' as const,
        metadata: {
          conversationIds: ['c_concurrent_4'],
          rawSignal: 'أنا شغال فلاتر بروفيشنال',
        },
      };

      const [resA, resB] = await Promise.all([
        memoryRepo.saveFact(userId, fact, 'profession', identicalOptions),
        memoryRepo.saveFact(userId, fact, 'profession', identicalOptions),
      ]);

      // 3. Atomicity check: active memories count must remain 1, evidenceCount must be 4, NOT 5!
      const active = await memoryRepo.getActiveMemories(userId);
      expect(active).toHaveLength(1);
      expect(active[0].metadata?.evidenceCount).toBe(4);
      expect(resA.metadata?.evidenceCount).toBe(4);
      expect(resB.metadata?.evidenceCount).toBe(4);
    });
  });
});
