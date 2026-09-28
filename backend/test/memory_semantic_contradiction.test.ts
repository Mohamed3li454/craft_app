import { DatabaseManager } from '../src/database/connection';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { MemoryCandidateExtractor } from '../src/modules/memory/memory_extractor';
import { SemanticContradictionService } from '../src/modules/memory/semantic_contradiction.service';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';

describe('Phase 2.5 — Semantic Contradiction & Memory Evolution', () => {
  let memoryRepo: MemoryRepository;
  let evidenceRepo: MemoryEvidenceRepository;
  let extractor: MemoryCandidateExtractor;
  let contradictionService: SemanticContradictionService;
  let retrievalService: MemoryRetrievalService;
  let assembler: MemoryContextAssembler;

  const testUserId = `test_contradiction_user_${Date.now()}`;

  beforeAll(() => {
    const db = DatabaseManager.getInstance();
    memoryRepo = new MemoryRepository(db);
    evidenceRepo = MemoryEvidenceRepository.getInstance(db);
    extractor = MemoryCandidateExtractor.getInstance();
    contradictionService = SemanticContradictionService.getInstance();
    retrievalService = MemoryRetrievalService.getInstance(memoryRepo);
    assembler = MemoryContextAssembler.getInstance();
  });

  beforeEach(() => {
    memoryRepo.clearInMemoryStore();
    evidenceRepo.clearInMemoryStore();
  });

  // ============================================================================
  // 1. Direct Contradiction
  // ============================================================================
  describe('1. Direct Contradiction', () => {
    test('"اسمي محمد" vs "اسمي أحمد" in identity slot triggers contradiction and supersession', async () => {
      const user = `user_identity_conflict_${Date.now()}`;

      // Step 1: Save initial identity
      const mem1 = await memoryRepo.saveFact(
        user,
        'اسم المستخدم: محمد',
        'identity',
        {
          source: 'user_explicit',
          confidence: 0.98,
          factKey: 'identity.name',
        }
      );
      expect(mem1.status).toBe('active');

      // Direct comparison via SemanticContradictionService
      const relation = contradictionService.compareFacts(mem1, {
        factText: 'اسم المستخدم: أحمد',
        category: 'identity',
        factKey: 'identity.name',
        source: 'user_explicit',
      });

      expect(relation.relation).toBe('contradicts');
      expect(relation.confidence).toBeGreaterThanOrEqual(0.95);
      expect(relation.reason).toContain('Direct contradiction in single-value identity slot');
      expect(relation.suggestedAction).toBe('supersede_target');

      // Step 2: Save new identity
      const mem2 = await memoryRepo.saveFact(
        user,
        'اسم المستخدم: أحمد',
        'identity',
        {
          source: 'user_explicit',
          confidence: 0.98,
          factKey: 'identity.name',
        }
      );

      expect(mem2.status).toBe('active');

      // Verify mem1 is superseded and only mem2 is active
      const activeMemories = await memoryRepo.getActiveMemories(user);
      expect(activeMemories.length).toBe(1);
      expect(activeMemories[0].factText).toBe('اسم المستخدم: أحمد');
      expect(activeMemories[0].id).toBe(mem2.id);
    });

    test('UI Theme preference switch: dark mode vs light mode triggers contradiction', () => {
      const themeDark = {
        factText: 'User prefers dark mode UI theme',
        category: 'preference',
        factKey: 'preference.theme',
      };
      const themeLight = {
        factText: 'User prefers light mode UI theme',
        category: 'preference',
        factKey: 'preference.theme',
      };

      const result = contradictionService.compareFacts(themeDark, themeLight);
      expect(result.relation).toBe('contradicts');
      expect(result.signals).toContain('theme_preference_switch');
      expect(result.suggestedAction).toBe('supersede_target');
    });
  });

  // ============================================================================
  // 2. Coexistence (No Contradiction)
  // ============================================================================
  describe('2. Coexistence (No Contradiction)', () => {
    test('"أستخدم Flutter" vs "أستخدم React" peacefully coexist as separate skills', async () => {
      const user = `user_multi_skill_${Date.now()}`;

      const memFlutter = await memoryRepo.saveFact(
        user,
        'المستخدم يعمل مع فلاتر (Flutter)',
        'technical_context',
        {
          source: 'automatic_extraction',
          confidence: 0.85,
          temporalState: 'current',
          factKey: 'tech.flutter',
        }
      );

      const memReactCandidate = {
        factText: 'المستخدم يعمل مع رياكت (React)',
        category: 'technical_context',
        temporalState: 'current' as const,
        factKey: 'tech.react',
        source: 'automatic_extraction',
      };

      // Semantic comparison must recognize coexistence!
      const relation = contradictionService.compareFacts(memFlutter, memReactCandidate);
      expect(relation.relation).toBe('coexists');
      expect(relation.confidence).toBeGreaterThanOrEqual(0.90);
      expect(relation.reason).toContain('peacefully coexist');
      expect(relation.suggestedAction).toBe('keep_both');

      // Save second fact
      const memReact = await memoryRepo.saveFact(
        user,
        memReactCandidate.factText,
        memReactCandidate.category,
        {
          source: 'automatic_extraction',
          confidence: 0.85,
          temporalState: 'current',
          factKey: 'tech.react',
        }
      );

      // Both must remain active and coexist in storage
      const active = await memoryRepo.getActiveMemories(user);
      expect(active.length).toBe(2);
      expect(active.some((m) => m.factText.includes('فلاتر'))).toBe(true);
      expect(active.some((m) => m.factText.includes('رياكت'))).toBe(true);
    });
  });

  // ============================================================================
  // 3. Memory Evolution
  // ============================================================================
  describe('3. Memory Evolution', () => {
    test('Workplace evolution: "أعمل في شركة Vodafone" -> "تركت شركة Vodafone وأعمل في Google"', async () => {
      const user = `user_career_evo_${Date.now()}`;

      // Initial job
      const initialJob = await memoryRepo.saveFact(
        user,
        'المستخدم يعمل في شركة Vodafone',
        'profession',
        {
          source: 'user_explicit',
          confidence: 0.95,
          temporalState: 'current',
          factKey: 'profession.workplace',
        }
      );

      expect(initialJob.status).toBe('active');
      expect(initialJob.temporalState).toBe('current');

      // Candidate representing transition
      const transitionCandidate = {
        factText: 'المستخدم يعمل في شركة Google',
        category: 'profession',
        temporalState: 'current' as const,
        factKey: 'profession.workplace',
        source: 'user_explicit',
      };

      // Pairwise comparison with transition phrasing
      const transitionRelation = contradictionService.compareFacts(initialJob, {
        factText: 'تركت شركة Vodafone وأعمل في Google',
        category: 'profession',
        source: 'user_explicit',
      });

      expect(transitionRelation.relation).toBe('evolves');
      expect(transitionRelation.signals).toContain('workplace_transition');
      expect(transitionRelation.suggestedAction).toBe('evolve_target_to_historical');

      // Save new transition fact
      const newJob = await memoryRepo.saveFact(
        user,
        'تركت شركة Vodafone وأعمل في Google',
        'profession',
        {
          source: 'user_explicit',
          confidence: 0.95,
          temporalState: 'current',
          factKey: 'profession.workplace',
        }
      );

      // Verify that old job evolved to historical without being discarded
      const allActive = await memoryRepo.getActiveMemories(user);
      const vodafoneMem = allActive.find((m) => m.id === initialJob.id);
      expect(vodafoneMem).toBeDefined();
      expect(vodafoneMem?.temporalState).toBe('historical');
      expect(vodafoneMem?.status).toBe('active');

      // New job is current
      const googleMem = allActive.find((m) => m.id === newJob.id);
      expect(googleMem).toBeDefined();
      expect(googleMem?.temporalState).toBe('current');
      expect(googleMem?.status).toBe('active');
    });
  });

  // ============================================================================
  // 4. Explicit Negation / Cessation
  // ============================================================================
  describe('4. Explicit Negation / Cessation', () => {
    test('"أستخدم React" + "لم أعد أستخدم React" evolves current memory to historical', async () => {
      const user = `user_negation_${Date.now()}`;

      // Existing active fact
      const reactCurrent = await memoryRepo.saveFact(
        user,
        'المستخدم يعمل مع رياكت (React)',
        'technical_context',
        {
          source: 'automatic_extraction',
          confidence: 0.85,
          temporalState: 'current',
          factKey: 'tech.react',
        }
      );

      // User explicitly ceases usage
      const cessationRelation = contradictionService.compareFacts(reactCurrent, {
        factText: 'لم أعد أستخدم React في أي مشروع',
        category: 'technical_context',
        source: 'user_explicit',
      });

      expect(cessationRelation.relation).toBe('evolves');
      expect(cessationRelation.signals).toContain('explicit_cessation_evolution');
      expect(cessationRelation.suggestedAction).toBe('evolve_target_to_historical');

      // Save cessation memory
      await memoryRepo.saveFact(
        user,
        'لم أعد أستخدم React في أي مشروع',
        'technical_context',
        {
          source: 'user_explicit',
          confidence: 0.95,
          temporalState: 'historical',
        }
      );

      // Verify that reactCurrent transitioned to historical
      const active = await memoryRepo.getActiveMemories(user);
      const reactFact = active.find((m) => m.id === reactCurrent.id);
      expect(reactFact?.temporalState).toBe('historical');
    });

    test('Total denial ("عمري ما استخدمت React") marks fact as superseded/invalid', () => {
      const reactCurrent = {
        id: 'mem-react-1',
        factText: 'المستخدم يعمل مع رياكت (React)',
        category: 'technical_context',
        temporalState: 'current' as const,
      };

      const denialRelation = contradictionService.compareFacts(reactCurrent, {
        factText: 'عمري ما استخدمت React',
        category: 'technical_context',
        source: 'user_explicit',
      });

      expect(denialRelation.relation).toBe('contradicts');
      expect(denialRelation.signals).toContain('explicit_total_denial');
      expect(denialRelation.suggestedAction).toBe('supersede_target');
    });
  });

  // ============================================================================
  // 5. Temporal Coexistence: Historical vs Current
  // ============================================================================
  describe('5. Temporal Coexistence: Historical vs Current', () => {
    test('Historical React + Current Flutter coexists peacefully', () => {
      const histReact = {
        factText: 'المستخدم كان يعمل مع رياكت (React) سابقاً',
        category: 'technical_context',
        temporalState: 'historical' as const,
      };

      const currFlutter = {
        factText: 'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        category: 'profession',
        temporalState: 'current' as const,
      };

      const relation = contradictionService.compareFacts(histReact, currFlutter);
      expect(relation.relation).toBe('coexists');
      expect(relation.signals).toContain('temporal_coexistence:historical_vs_current');
      expect(relation.suggestedAction).toBe('keep_both');
    });
  });

  // ============================================================================
  // 6. Planned vs Current Coexistence
  // ============================================================================
  describe('6. Planned vs Current Coexistence', () => {
    test('Planned Rust + Current Flutter coexists peacefully', () => {
      const currFlutter = {
        factText: 'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        category: 'profession',
        temporalState: 'current' as const,
      };

      const plannedRust = {
        factText: 'المستخدم يخطط لتعلم رست (Rust)',
        category: 'technical_context',
        temporalState: 'planned' as const,
      };

      const relation = contradictionService.compareFacts(currFlutter, plannedRust);
      expect(relation.relation).toBe('coexists');
      expect(relation.signals).toContain('temporal_coexistence:planned_vs_current');
      expect(relation.suggestedAction).toBe('keep_both');
    });
  });

  // ============================================================================
  // 7. Uncertain Relation
  // ============================================================================
  describe('7. Uncertain Relation', () => {
    test('Linguistically divergent statements without deterministic rule return "uncertain"', () => {
      const factA = {
        factText: 'المستخدم يحب قراءة كتب التاريخ الإسلامي',
        category: 'interest',
      };

      const factB = {
        factText: 'المستخدم مهتم بالفلسفة والعلوم الطبيعية',
        category: 'interest',
      };

      const relation = contradictionService.compareFacts(factA, factB);
      expect(relation.relation).toBe('uncertain');
      expect(relation.signals).toContain('uncertain_relation');
      // Must not mutate or supersede
      expect(relation.suggestedAction).toBe('keep_both');
    });
  });

  // ============================================================================
  // 8. Evidence & Source Authority Integration
  // ============================================================================
  describe('8. Evidence & Source Authority Integration', () => {
    test('Lower authority source (automatic_extraction) CANNOT supersede explicit user statement (user_explicit)', async () => {
      const user = `user_authority_test_${Date.now()}`;

      // Step 1: Explicit user declaration
      const explicitName = await memoryRepo.saveFact(
        user,
        'اسم المستخدم: محمد',
        'identity',
        {
          source: 'user_explicit', // Priority 4
          confidence: 1.0,
          factKey: 'identity.name',
        }
      );

      // Step 2: Automatic extraction candidate attempts to contradict
      const autoCandidate = await memoryRepo.saveFact(
        user,
        'اسم المستخدم: أحمد',
        'identity',
        {
          source: 'automatic_extraction', // Priority 2
          confidence: 0.85,
          factKey: 'identity.name',
        }
      );

      // The original user_explicit memory MUST remain active and unchanged
      const active = await memoryRepo.getActiveMemories(user);
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(explicitName.id);
      expect(active[0].factText).toBe('اسم المستخدم: محمد');
    });

    test('Higher authority source (user_explicit) successfully supersedes lower authority fact', async () => {
      const user = `user_authority_override_${Date.now()}`;

      // Step 1: Inferred/automatic fact
      const autoFact = await memoryRepo.saveFact(
        user,
        'اسم المستخدم: أحمد',
        'identity',
        {
          source: 'automatic_extraction', // Priority 2
          confidence: 0.70,
          factKey: 'identity.name',
        }
      );

      // Step 2: Explicit correction by user
      const explicitFact = await memoryRepo.saveFact(
        user,
        'اسم المستخدم: محمد',
        'identity',
        {
          source: 'user_explicit', // Priority 4
          confidence: 1.0,
          factKey: 'identity.name',
        }
      );

      // Explicit fact takes precedence
      const active = await memoryRepo.getActiveMemories(user);
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(explicitFact.id);
      expect(active[0].factText).toBe('اسم المستخدم: محمد');
    });
  });

  // ============================================================================
  // 9. Confidence Independence
  // ============================================================================
  describe('9. Confidence Independence', () => {
    test('Confidence is independent of relation: historical and evolved facts retain high confidence', async () => {
      const user = `user_conf_indep_${Date.now()}`;

      const saved = await memoryRepo.saveFact(
        user,
        'المستخدم كان يعمل مع رياكت (React) سابقاً',
        'technical_context',
        {
          source: 'user_explicit',
          confidence: 0.98,
          temporalState: 'historical',
        }
      );

      expect(saved.temporalState).toBe('historical');
      expect(saved.confidence).toBe(0.98); // High confidence despite being historical
    });
  });

  // ============================================================================
  // 10. Importance Independence
  // ============================================================================
  describe('10. Importance Independence', () => {
    test('Historical memory retains its importance: not demoted merely for being historical', async () => {
      const user = `user_imp_indep_${Date.now()}`;

      const saved = await memoryRepo.saveFact(
        user,
        'المستخدم أسس شركة برمجيات سابقة في 2020',
        'stable_fact',
        {
          source: 'user_explicit',
          importance: 'high',
          temporalState: 'historical',
        }
      );

      expect(saved.temporalState).toBe('historical');
      expect(saved.importance).toBe('high'); // Critical founding history remains high importance!
    });
  });

  // ============================================================================
  // 11. End-to-End Retrieval & Context Assembly Integration
  // ============================================================================
  describe('11. End-to-End Retrieval & Context Assembly Integration', () => {
    test('Superseded memories are excluded from retrieval; evolved historical memories are formatted with [Historical]', async () => {
      const user = `user_retrieval_e2e_${Date.now()}`;

      // Current Flutter
      await memoryRepo.saveFact(
        user,
        'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        'profession',
        {
          source: 'user_explicit',
          confidence: 0.95,
          temporalState: 'current',
        }
      );

      // Historical React (evolved)
      await memoryRepo.saveFact(
        user,
        'المستخدم كان يعمل مع رياكت (React) سابقاً',
        'technical_context',
        {
          source: 'user_explicit',
          confidence: 0.95,
          temporalState: 'historical',
        }
      );

      // Superseded old name
      const oldName = await memoryRepo.saveFact(
        user,
        'اسم المستخدم: مصطفى',
        'identity',
        {
          source: 'automatic_extraction',
          factKey: 'identity.name',
        }
      );
      // Corrected name
      await memoryRepo.saveFact(
        user,
        'اسم المستخدم: علي',
        'identity',
        {
          source: 'user_explicit',
          factKey: 'identity.name',
        }
      );

      // Query active profile
      const retrieved = await retrievalService.retrieve({
        userId: user,
        message: 'اسمي إيه وشغال بإيه زمان ودلوقتي؟',
      });

      // 1. Superseded name 'مصطفى' must NOT appear
      expect(retrieved.some((r) => r.memory.factText.includes('مصطفى'))).toBe(false);
      // 2. Active name 'علي' must appear
      expect(retrieved.some((r) => r.memory.factText.includes('علي'))).toBe(true);

      // Assemble prompt context
      const assembled = assembler.assemble(retrieved);
      const prompt = assembled.formattedPromptText || '';

      // Current Flutter has no tag
      expect(prompt).toContain('• المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر');
      expect(prompt).not.toContain('• [Current]');

      // Historical React has [Historical] tag
      expect(prompt).toContain('• [Historical] المستخدم كان يعمل مع رياكت (React) سابقاً');
    });
  });
});
