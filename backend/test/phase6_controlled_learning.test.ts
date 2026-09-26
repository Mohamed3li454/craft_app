import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../src/database/connection';
import { SemanticCandidateRepository } from '../src/database/repositories/semantic_candidate.repo';
import { SemanticCacheRepository } from '../src/database/repositories/semantic_cache.repo';
import { SemanticCacheCandidate } from '../src/database/repositories/semantic_candidate.types';
import { PromotionEvaluator } from '../src/modules/cache/learning/promotion_evaluator';
import { ConflictDetector } from '../src/modules/cache/learning/conflict_detector';
import { StalenessEvaluator } from '../src/modules/cache/learning/staleness_evaluator';
import { PromotionService } from '../src/modules/cache/learning/promotion_service';
import { LearningPipeline } from '../src/modules/cache/learning/learning_pipeline';
import { MockEmbeddingProvider } from '../src/modules/cache/embedding/mock_embedding.provider';
import { DEFAULT_EVIDENCE_CONFIG } from '../src/modules/cache/learning/evidence.config';

describe('Phase 6: Controlled Learning & Promotion', () => {
  let db: DatabaseManager;
  let candidateRepo: SemanticCandidateRepository;
  let semanticCacheRepo: SemanticCacheRepository;
  let promotionService: PromotionService;
  let learningPipeline: LearningPipeline;
  let mockProvider: MockEmbeddingProvider;

  const testCandidateIds: string[] = [];
  const testFaqIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseManager.getInstance();
    candidateRepo = new SemanticCandidateRepository(db);
    semanticCacheRepo = new SemanticCacheRepository(db);
    mockProvider = new MockEmbeddingProvider(768);

    await candidateRepo.ensureSchema();
    await semanticCacheRepo.ensureSchema();

    promotionService = new PromotionService(candidateRepo, semanticCacheRepo, mockProvider, db);
    learningPipeline = new LearningPipeline(candidateRepo, semanticCacheRepo, mockProvider);
  });

  afterAll(async () => {
    for (const id of testCandidateIds) {
      await candidateRepo.delete(id);
    }
    for (const id of testFaqIds) {
      await semanticCacheRepo.delete(id);
    }
    await db.close();
  });

  describe('1. Evidence Accumulation Model', () => {
    it('creates initial candidate with baseline evidence signals', async () => {
      const candidate = await candidateRepo.create({
        intent: 'evidence_baseline_test',
        inputExamples: ['كيف اشترك في الخدمة'],
        response: 'يمكنك الاشتراك من خلال زيارة موقعنا واختيار الباقة المناسبة.',
        language: 'ar',
      });
      testCandidateIds.push(candidate.id);

      expect(candidate.observationCount).toBe(1);
      expect(candidate.uniqueExampleCount).toBe(1);
      expect(candidate.validationCount).toBe(0);
      expect(candidate.safetyViolationCount).toBe(0);
      expect(candidate.duplicateCount).toBe(0);
      expect(candidate.conflictCount).toBe(0);
      expect(candidate.promotionEligible).toBe(false);
      expect(candidate.firstObservedAt).toBeTruthy();
      expect(candidate.lastObservedAt).toBeTruthy();
    });

    it('accumulates observations and unique examples when diverse queries are observed', async () => {
      const runId = 'evidence-obs-run-1';
      // First observation -> creates candidate
      await learningPipeline.observeRun({
        runId,
        userInput: 'ما هي مواعيد العمل الرسمية للمتجر؟',
        replyText: 'مواعيد العمل الرسمية من الأحد إلى الخميس من 9 صباحاً حتى 5 مساءً.',
        modelUsed: 'gemini-2.5-flash',
        provider: 'gemini',
      });

      const candidates = await candidateRepo.list({ limit: 10 });
      const cand = candidates.find((c) => c.response.includes('مواعيد العمل الرسمية من الأحد'));
      expect(cand).toBeDefined();
      if (cand) {
        testCandidateIds.push(cand.id);

        expect(cand.observationCount).toBe(1);
        expect(cand.uniqueExampleCount).toBe(1);

        // Second observation with overlapping intent but distinct phrasing -> increments observation & uniqueExampleCount
        await learningPipeline.observeRun({
          runId: 'evidence-obs-run-2',
          userInput: 'مواعيد العمل الرسمية للمتجر في الفرع',
          replyText: 'مواعيد العمل الرسمية من الأحد إلى الخميس من 9 صباحاً حتى 5 مساءً.',
          modelUsed: 'gemini-2.5-flash',
          provider: 'gemini',
        });

        const updatedCand = await candidateRepo.findById(cand.id);
        expect(updatedCand?.observationCount).toBe(2);
        expect(updatedCand?.uniqueExampleCount).toBe(2);
        expect(updatedCand?.inputExamples.length).toBe(2);
      }
    });

    it('increments duplicateCount without expanding uniqueExampleCount on identical queries', async () => {
      const candidate = await candidateRepo.create({
        intent: 'faq_duplicate_count_test',
        inputExamples: ['كيف استرد المبلغ المالي'],
        response: 'يتم استرداد المبلغ خلال 14 يوم عمل لنفس وسيلة الدفع المستخدمة.',
        language: 'ar',
      });
      testCandidateIds.push(candidate.id);

      // Same query observed again
      await learningPipeline.observeRun({
        runId: 'dup-obs-1',
        userInput: 'كيف استرد المبلغ المالي؟',
        replyText: 'يتم استرداد المبلغ خلال 14 يوم عمل لنفس وسيلة الدفع المستخدمة.',
      });

      const updated = await candidateRepo.findById(candidate.id);
      expect(updated?.observationCount).toBe(2);
      expect(updated?.uniqueExampleCount).toBe(1);
      expect(updated?.duplicateCount).toBe(1);
    });
  });

  describe('2. Deterministic Promotion Evaluator & Confidence Scoring', () => {
    it('accurately computes confidence score and blocks unvalidated candidates', async () => {
      const candidate: SemanticCacheCandidate = {
        id: uuidv4(),
        intent: 'score_eval_test',
        category: 'general',
        inputExamples: ['مثال أول', 'مثال ثاني', 'مثال ثالث'],
        response: 'إجابة اختبار درجات الثقة الحسابية الدقيقة.',
        responseStrategy: 'static',
        responseTemplates: { default: ['إجابة اختبار درجات الثقة الحسابية الدقيقة.'] },
        language: 'ar',
        confidence: 0.5,
        eligibilityReason: 'static_reusable',
        status: 'pending', // Pending, NOT validated
        observationCount: 10, // Max observations factor = 1.0
        uniqueExampleCount: 5, // Max diversity factor = 1.0
        semanticConsistency: 0.95,
        validationCount: 0,
        rejectionCount: 0,
        safetyViolationCount: 0,
        duplicateCount: 2,
        conflictCount: 0,
        promotionEligible: false,
        promotionReasons: [],
        promotionBlockers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        firstObservedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
      };

      const result = await PromotionEvaluator.evaluate(candidate, []);
      // Score calculation:
      // (0.30 * 1.0) + (0.25 * 1.0) + (0.25 * 0.95) + (0.20 * 0.5 [pending]) = 0.30 + 0.25 + 0.2375 + 0.10 = 0.8875
      expect(result.score).toBeCloseTo(0.8875, 2);
      expect(result.eligible).toBe(false);
      expect(result.blockers).toContain('not_validated: current status is pending');
    });

    it('blocks promotion eligibility if observations are below minimum threshold', async () => {
      const candidate: SemanticCacheCandidate = {
        id: uuidv4(),
        intent: 'low_observations_test',
        category: 'general',
        inputExamples: ['مثال 1', 'مثال 2', 'مثال 3'],
        response: 'إجابة نموذجية صالحة.',
        responseStrategy: 'static',
        responseTemplates: { default: ['إجابة نموذجية صالحة.'] },
        language: 'ar',
        confidence: 0.9,
        eligibilityReason: 'static_reusable',
        status: 'validated',
        observationCount: 3, // < minObservations (5)
        uniqueExampleCount: 3,
        semanticConsistency: 0.95,
        validationCount: 1,
        rejectionCount: 0,
        safetyViolationCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        promotionEligible: false,
        promotionReasons: [],
        promotionBlockers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        firstObservedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
      };

      const result = await PromotionEvaluator.evaluate(candidate, []);
      expect(result.eligible).toBe(false);
      expect(result.blockers.some((b) => b.includes('insufficient_observations'))).toBe(true);
    });

    it('blocks promotion eligibility if diversity is below minimum unique examples', async () => {
      const candidate: SemanticCacheCandidate = {
        id: uuidv4(),
        intent: 'low_diversity_test',
        category: 'general',
        inputExamples: ['مثال وحيد فقط'],
        response: 'إجابة نموذجية صالحة.',
        responseStrategy: 'static',
        responseTemplates: { default: ['إجابة نموذجية صالحة.'] },
        language: 'ar',
        confidence: 0.9,
        eligibilityReason: 'static_reusable',
        status: 'validated',
        observationCount: 8,
        uniqueExampleCount: 1, // < minUniqueExamples (3)
        semanticConsistency: 0.95,
        validationCount: 1,
        rejectionCount: 0,
        safetyViolationCount: 0,
        duplicateCount: 7,
        conflictCount: 0,
        promotionEligible: false,
        promotionReasons: [],
        promotionBlockers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        firstObservedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
      };

      const result = await PromotionEvaluator.evaluate(candidate, []);
      expect(result.eligible).toBe(false);
      expect(result.blockers.some((b) => b.includes('insufficient_unique_examples'))).toBe(true);
    });

    it('blocks promotion eligibility if safety violations are present', async () => {
      const candidate: SemanticCacheCandidate = {
        id: uuidv4(),
        intent: 'safety_penalty_test',
        category: 'general',
        inputExamples: ['مثال 1', 'مثال 2', 'مثال 3'],
        response: 'إجابة صالحة.',
        responseStrategy: 'static',
        responseTemplates: { default: ['إجابة صالحة.'] },
        language: 'ar',
        confidence: 0.95,
        eligibilityReason: 'static_reusable',
        status: 'validated',
        observationCount: 10,
        uniqueExampleCount: 4,
        semanticConsistency: 0.95,
        validationCount: 1,
        rejectionCount: 0,
        safetyViolationCount: 1, // Safety violation!
        duplicateCount: 2,
        conflictCount: 0,
        promotionEligible: false,
        promotionReasons: [],
        promotionBlockers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        firstObservedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
      };

      const result = await PromotionEvaluator.evaluate(candidate, []);
      expect(result.eligible).toBe(false);
      expect(result.blockers).toContain('safety_violations_present: 1');
    });

    it('qualifies candidate as promotionEligible = true when all evidence criteria pass', async () => {
      const candidate: SemanticCacheCandidate = {
        id: uuidv4(),
        intent: 'fully_qualified_test',
        category: 'general',
        inputExamples: ['كيف اشترك في الخطة السنوية', 'طريقة الاشتراك السنوي', 'خطوات تفعيل الاشتراك السنوي'],
        response: 'لتفعيل الاشتراك السنوي قم بفتح الإعدادات واختيار الخطة السنوية.',
        responseStrategy: 'static',
        responseTemplates: { default: ['لتفعيل الاشتراك السنوي قم بفتح الإعدادات واختيار الخطة السنوية.'] },
        language: 'ar',
        confidence: 0.95,
        eligibilityReason: 'static_reusable',
        status: 'validated',
        observationCount: 10, // Full 1.0 factor
        uniqueExampleCount: 5, // Full 1.0 factor
        semanticConsistency: 0.95,
        validationCount: 1,
        rejectionCount: 0,
        safetyViolationCount: 0,
        duplicateCount: 3,
        conflictCount: 0,
        promotionEligible: false,
        promotionReasons: [],
        promotionBlockers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        firstObservedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
      };

      const result = await PromotionEvaluator.evaluate(candidate, []);
      expect(result.eligible).toBe(true);
      expect(result.blockers.length).toBe(0);
      expect(result.score).toBeGreaterThanOrEqual(DEFAULT_EVIDENCE_CONFIG.minConfidenceScore);
      expect(result.reasons).toContain('adequate_observations: 10');
      expect(result.reasons).toContain('diverse_examples: 5');
      expect(result.reasons).toContain('human_or_rule_validated');
    });

    describe('Explicit Boundary Tests (A, B, C, D, E)', () => {
      it('Test A: baseline candidate at exact thresholds achieves eligibility (0.725 >= 0.70)', async () => {
        const candidate: SemanticCacheCandidate = {
          id: uuidv4(),
          intent: 'test_a_baseline',
          category: 'general',
          inputExamples: ['مثال أ', 'مثال ب', 'مثال ج'],
          response: 'إجابة أساسية.',
          responseStrategy: 'static',
          responseTemplates: { default: ['إجابة أساسية.'] },
          language: 'ar',
          confidence: 0.725,
          eligibilityReason: 'static_reusable',
          status: 'validated',
          observationCount: 5, // Exact minObservations
          uniqueExampleCount: 3, // Exact minUniqueExamples
          semanticConsistency: 0.90, // Exact minSemanticConsistency
          validationCount: 1,
          rejectionCount: 0,
          safetyViolationCount: 0,
          duplicateCount: 0,
          conflictCount: 0,
          promotionEligible: false,
          promotionReasons: [],
          promotionBlockers: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          firstObservedAt: new Date().toISOString(),
          lastObservedAt: new Date().toISOString(),
        };

        const result = await PromotionEvaluator.evaluate(candidate, []);
        expect(result.score).toBeCloseTo(0.725, 3);
        expect(result.eligible).toBe(true);
        expect(result.blockers).toEqual([]);
      });

      it('Test B: saturated strong candidate achieves maximum confidence (1.00)', async () => {
        const candidate: SemanticCacheCandidate = {
          id: uuidv4(),
          intent: 'test_b_strong',
          category: 'general',
          inputExamples: ['مثال 1', 'مثال 2', 'مثال 3', 'مثال 4', 'مثال 5'],
          response: 'إجابة قوية جداً ومجربة.',
          responseStrategy: 'static',
          responseTemplates: { default: ['إجابة قوية جداً ومجربة.'] },
          language: 'ar',
          confidence: 1.0,
          eligibilityReason: 'static_reusable',
          status: 'validated',
          observationCount: 10, // Full saturation
          uniqueExampleCount: 5, // Full saturation
          semanticConsistency: 1.0, // Perfect consistency
          validationCount: 2,
          rejectionCount: 0,
          safetyViolationCount: 0,
          duplicateCount: 5,
          conflictCount: 0,
          promotionEligible: false,
          promotionReasons: [],
          promotionBlockers: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          firstObservedAt: new Date().toISOString(),
          lastObservedAt: new Date().toISOString(),
        };

        const result = await PromotionEvaluator.evaluate(candidate, []);
        expect(result.score).toBe(1.0);
        expect(result.eligible).toBe(true);
        expect(result.blockers).toEqual([]);
      });

      it('Test C: candidate with high confidence but safety_violation_count = 1 remains blocked', async () => {
        const candidate: SemanticCacheCandidate = {
          id: uuidv4(),
          intent: 'test_c_safety_blocked',
          category: 'general',
          inputExamples: ['مثال 1', 'مثال 2', 'مثال 3', 'مثال 4', 'مثال 5'],
          response: 'إجابة.',
          responseStrategy: 'static',
          responseTemplates: { default: ['إجابة.'] },
          language: 'ar',
          confidence: 1.0,
          eligibilityReason: 'static_reusable',
          status: 'validated',
          observationCount: 10,
          uniqueExampleCount: 5,
          semanticConsistency: 1.0,
          validationCount: 1,
          rejectionCount: 0,
          safetyViolationCount: 1, // HARD BLOCKER
          duplicateCount: 0,
          conflictCount: 0,
          promotionEligible: false,
          promotionReasons: [],
          promotionBlockers: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          firstObservedAt: new Date().toISOString(),
          lastObservedAt: new Date().toISOString(),
        };

        const result = await PromotionEvaluator.evaluate(candidate, []);
        expect(result.eligible).toBe(false);
        expect(result.blockers).toContain('safety_violations_present: 1');
      });

      it('Test D: candidate with high confidence but conflict_count = 1 remains blocked', async () => {
        const candidate: SemanticCacheCandidate = {
          id: uuidv4(),
          intent: 'test_d_conflict_blocked',
          category: 'general',
          inputExamples: ['مثال 1', 'مثال 2', 'مثال 3', 'مثال 4', 'مثال 5'],
          response: 'إجابة.',
          responseStrategy: 'static',
          responseTemplates: { default: ['إجابة.'] },
          language: 'ar',
          confidence: 1.0,
          eligibilityReason: 'static_reusable',
          status: 'validated',
          observationCount: 10,
          uniqueExampleCount: 5,
          semanticConsistency: 1.0,
          validationCount: 1,
          rejectionCount: 0,
          safetyViolationCount: 0,
          duplicateCount: 0,
          conflictCount: 1, // HARD BLOCKER
          promotionEligible: false,
          promotionReasons: [],
          promotionBlockers: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          firstObservedAt: new Date().toISOString(),
          lastObservedAt: new Date().toISOString(),
        };

        const result = await PromotionEvaluator.evaluate(candidate, []);
        expect(result.eligible).toBe(false);
        expect(result.blockers).toContain('conflict_count_present: 1');
      });

      it('Test E: candidate with sufficient evidence but status = pending remains blocked', async () => {
        const candidate: SemanticCacheCandidate = {
          id: uuidv4(),
          intent: 'test_e_pending_blocked',
          category: 'general',
          inputExamples: ['مثال 1', 'مثال 2', 'مثال 3'],
          response: 'إجابة.',
          responseStrategy: 'static',
          responseTemplates: { default: ['إجابة.'] },
          language: 'ar',
          confidence: 0.85,
          eligibilityReason: 'static_reusable',
          status: 'pending', // HARD BLOCKER
          observationCount: 6,
          uniqueExampleCount: 3,
          semanticConsistency: 0.92,
          validationCount: 0,
          rejectionCount: 0,
          safetyViolationCount: 0,
          duplicateCount: 0,
          conflictCount: 0,
          promotionEligible: false,
          promotionReasons: [],
          promotionBlockers: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          firstObservedAt: new Date().toISOString(),
          lastObservedAt: new Date().toISOString(),
        };

        const result = await PromotionEvaluator.evaluate(candidate, []);
        expect(result.eligible).toBe(false);
        expect(result.blockers).toContain('not_validated: current status is pending');
      });
    });
  });

  describe('3. Deterministic Conflict Detection', () => {
    it('demonstrates limitation: does not flag subtle stylistic/semantic nuance without numbers or polar antonyms', () => {
      const candA: any = {
        id: 'cand-1',
        intent: 'shipping_duration',
        response: 'الشحن يستغرق من يومين إلى ثلاثة أيام.',
        status: 'validated',
      };

      const candB: any = {
        id: 'cand-2',
        intent: 'shipping_duration',
        response: 'التوصيل يتم خلال يومين إلى ثلاثة أيام عمل.',
        status: 'pending',
      };

      // Both mention days 2 and 3, have no polar antonyms -> deterministic detector correctly passes without false alarm
      const result = ConflictDetector.detectConflict(candA, [candB]);
      expect(result.hasConflict).toBe(false);
    });
    it('detects numerical discrepancy conflicts for the same semantic intent', () => {
      const candA: any = {
        id: 'cand-1',
        intent: 'shipping_fee',
        response: 'رسوم الشحن هي 50 جنيه لجميع المحافظات.',
        status: 'validated',
      };

      const candB: any = {
        id: 'cand-2',
        intent: 'shipping_fee',
        response: 'رسوم الشحن هي 85 جنيه لجميع المحافظات.',
        status: 'pending',
      };

      const result = ConflictDetector.detectConflict(candA, [candB]);
      expect(result.hasConflict).toBe(true);
      expect(result.reasons).toContain('conflicting_numbers_detected');
      expect(result.conflictingCandidateId).toBe('cand-2');
    });

    it('detects polar antonym contradiction (e.g. Free vs Paid)', () => {
      const candA: any = {
        id: 'cand-pos',
        intent: 'returns_policy',
        response: 'إرجاع المنتجات مجاني بالكامل وبدون أي رسوم إضافية.',
        status: 'validated',
      };

      const candB: any = {
        id: 'cand-neg',
        intent: 'returns_policy',
        response: 'إرجاع المنتجات مدفوع وغير مجاني ويتم خصم مصاريف الشحن.',
        status: 'pending',
      };

      const result = ConflictDetector.detectConflict(candA, [candB]);
      expect(result.hasConflict).toBe(true);
      expect(result.reasons).toContain('contradictory_factual_claim');
    });

    it('allows non-conflicting distinct intents to coexist without false conflicts', () => {
      const candA: any = {
        id: 'cand-1',
        intent: 'shipping_fee',
        response: 'رسوم الشحن 50 جنيه.',
        status: 'validated',
      };

      const candB: any = {
        id: 'cand-2',
        intent: 'return_policy_days',
        response: 'فترة الإرجاع المسموحة هي 14 يوم.',
        status: 'validated',
      };

      const result = ConflictDetector.detectConflict(candA, [candB]);
      expect(result.hasConflict).toBe(false);
    });
  });

  describe('4. Deterministic Staleness Evaluation', () => {
    it('marks recent candidates as fresh (not stale)', () => {
      const candidate: any = {
        intent: 'general_faq',
        response: 'إجابة عادية.',
        createdAt: new Date().toISOString(),
        lastObservedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        observationCount: 10,
      };

      const result = StalenessEvaluator.isStale(candidate);
      expect(result.isStale).toBe(false);
      expect(result.daysInactive).toBe(5);
    });

    it('marks volatile policy/pricing candidates inactive > 90 days as stale', () => {
      const candidate: any = {
        intent: 'pricing_plans_subscription',
        response: 'سعر الاشتراك الشهري في الخطة المميزة هو 200 جنيه.',
        createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
        lastObservedAt: new Date(Date.now() - 110 * 24 * 60 * 60 * 1000).toISOString(), // 110 days ago
        observationCount: 6,
      };

      const result = StalenessEvaluator.isStale(candidate);
      expect(result.isStale).toBe(true);
      expect(result.reason).toContain('inactive for 110 days');
    });
  });

  describe('5. Strict Promotion Guards in PromotionService', () => {
    it('rejects promotion if candidate has not been validated first', async () => {
      const candidate = await candidateRepo.create({
        intent: 'unvalidated_promote_test',
        inputExamples: ['سؤال غير معتمد بعد'],
        response: 'إجابة اختبار لمنع الترقية قبل الاعتماد البشري.',
        status: 'pending',
      });
      testCandidateIds.push(candidate.id);

      const result = await promotionService.promoteCandidate(candidate.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Candidate must be validated before promotion');
    });

    it('rejects promotion if candidate is validated but lacks sufficient evidence (promotionEligible = false)', async () => {
      const candidate = await candidateRepo.create({
        intent: 'insufficient_evidence_test',
        inputExamples: ['سؤال واحد فقط'],
        response: 'إجابة اختبار لمنع الترقية بدون أدلة كافية.',
        status: 'validated',
        promotionEligible: false,
        promotionBlockers: ['insufficient_observations: 1/5', 'insufficient_unique_examples: 1/3'],
      });
      testCandidateIds.push(candidate.id);

      const result = await promotionService.promoteCandidate(candidate.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Candidate is not eligible for promotion');
      expect(result.error).toContain('insufficient_observations');
    });

    it('rejects promotion if candidate has unresolved conflicts with knowledge base', async () => {
      const conflictingOther = await candidateRepo.create({
        intent: 'conflicting_promotion_target',
        inputExamples: ['سعر كورس البرمجة'],
        response: 'سعر كورس البرمجة هو 500 جنيه.',
        status: 'validated',
      });
      testCandidateIds.push(conflictingOther.id);

      const candidate = await candidateRepo.create({
        intent: 'conflicting_promotion_target',
        inputExamples: ['سعر كورس البرمجة كام'],
        response: 'سعر كورس البرمجة هو 900 جنيه.',
        status: 'validated',
        promotionEligible: true,
      });
      testCandidateIds.push(candidate.id);

      const result = await promotionService.promoteCandidate(candidate.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Candidate has unresolved conflict');
    });

    it('promotes candidate atomically and marks status = promoted when all guards pass', async () => {
      const candidate = await candidateRepo.create({
        intent: 'perfect_candidate_promotion',
        category: 'support',
        inputExamples: [
          'طريقة تغيير كلمة المرور',
          'ازاي اغير الباسورد الخاص بالحساب',
          'خطوات تعيين كلمة سر جديدة',
        ],
        response: 'لتغيير كلمة المرور اذهب إلى إعدادات الحساب ثم اضغط على تغيير كلمة المرور.',
        language: 'ar',
        status: 'validated',
        promotionEligible: true,
        observationCount: 12,
        uniqueExampleCount: 3,
        confidence: 0.95,
      });
      testCandidateIds.push(candidate.id);

      const result = await promotionService.promoteCandidate(candidate.id);
      expect(result.success).toBe(true);
      expect(result.promotedFaqId).toBeTruthy();

      testFaqIds.push(result.promotedFaqId!);

      // Candidate state verification
      const updatedCand = await candidateRepo.findById(candidate.id);
      expect(updatedCand?.status).toBe('promoted');
      expect(updatedCand?.promotedFaqId).toBe(result.promotedFaqId);
      expect(updatedCand?.promotedAt).toBeTruthy();

      // Production Semantic Cache (faq_items) verification
      const faqItem = await semanticCacheRepo.findById(result.promotedFaqId!);
      expect(faqItem).not.toBeNull();
      expect(faqItem?.intent).toBe('perfect_candidate_promotion');
      expect(faqItem?.embedding).toBeDefined();
    });

    it('re-evaluates promotion eligibility when validateCandidate() is called', async () => {
      const candidate = await candidateRepo.create({
        intent: 'human_validation_transition_test',
        inputExamples: ['مثال أ', 'مثال ب', 'مثال ج', 'مثال د', 'مثال هـ'],
        response: 'إجابة صالحة للتأكد من إعادة التقييم عند التحقق.',
        status: 'pending',
        observationCount: 10,
        uniqueExampleCount: 5,
        confidence: 0.70,
        semanticConsistency: 0.95,
      });
      testCandidateIds.push(candidate.id);

      expect(candidate.status).toBe('pending');
      expect(candidate.promotionEligible).toBe(false);

      const success = await promotionService.validateCandidate(candidate.id);
      expect(success).toBe(true);

      const updated = await candidateRepo.findById(candidate.id);
      expect(updated?.status).toBe('validated');
      expect(updated?.promotionEligible).toBe(true);
      expect(updated?.confidence).toBeGreaterThanOrEqual(0.90);
    });
  });
});
