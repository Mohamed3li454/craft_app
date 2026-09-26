import { LearningEligibilityFilter } from '../src/modules/cache/learning/learning_eligibility';
import { DeduplicationEngine } from '../src/modules/cache/learning/deduplication_engine';
import { CandidateValidator } from '../src/modules/cache/learning/candidate_validator';
import { PromotionService } from '../src/modules/cache/learning/promotion_service';
import { LearningPipeline } from '../src/modules/cache/learning/learning_pipeline';
import { SemanticCandidateRepository } from '../src/database/repositories/semantic_candidate.repo';
import { SemanticCacheRepository } from '../src/database/repositories/semantic_cache.repo';
import { MockEmbeddingProvider } from '../src/modules/cache/embedding/mock_embedding.provider';
import { DatabaseManager } from '../src/database/connection';

describe('Phase 5: Safe Learning & Candidate Cache Pipeline', () => {
  let db: DatabaseManager;
  let candidateRepo: SemanticCandidateRepository;
  let semanticCacheRepo: SemanticCacheRepository;
  let mockEmbeddingProvider: MockEmbeddingProvider;
  let promotionService: PromotionService;
  let learningPipeline: LearningPipeline;

  const testCandidateIds: string[] = [];
  const testFaqIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseManager.getInstance();
    candidateRepo = new SemanticCandidateRepository(db);
    semanticCacheRepo = new SemanticCacheRepository(db);
    mockEmbeddingProvider = new MockEmbeddingProvider(4); // 4-dim deterministic mock vector

    await semanticCacheRepo.ensureSchema();
    await candidateRepo.ensureSchema();

    promotionService = new PromotionService(
      candidateRepo,
      semanticCacheRepo,
      mockEmbeddingProvider,
      db
    );

    learningPipeline = new LearningPipeline(
      candidateRepo,
      semanticCacheRepo,
      mockEmbeddingProvider
    );
  });

  afterAll(async () => {
    const pool = db.getPool();
    if (pool) {
      if (testCandidateIds.length > 0) {
        await pool.query('DELETE FROM semantic_cache_candidates WHERE id = ANY($1)', [testCandidateIds]);
      }
      if (testFaqIds.length > 0) {
        await pool.query('DELETE FROM faq_items WHERE id = ANY($1)', [testFaqIds]);
      }
    }
  });

  describe('1. Learning Eligibility Filter — Deterministic Safety Rules', () => {
    it('accepts reusable, static, high-quality knowledge answer', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'ما هي مواعيد العمل الرسمية في كرافت؟',
        replyText: 'مواعيد العمل الرسمية لدينا من الأحد إلى الخميس من الساعة 9 صباحاً حتى 5 مساءً بتوقيت القاهرة.',
      });
      expect(res.eligible).toBe(true);
      expect(res.reason).toBe('static_reusable');
    });

    it('rejects dynamic current time queries', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'الساعة كام دلوقتي في مصر؟',
        replyText: 'الوقت الحالي في القاهرة هو 04:30 مساءً.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('dynamic');
    });

    it('rejects dynamic weather queries', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'الجو عامل ايه النهاردة في اسكندرية؟',
        replyText: 'الطقس اليوم معتدل مع درجة حرارة 24 مئوية وفرصة لسقوط أمطار خفيفة.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('dynamic');
    });

    it('rejects dynamic currency and gold price queries', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'سعر الدولار اليوم مقابل الجنيه؟',
        replyText: 'سعر صرف الدولار اليوم في البنوك المصرية حوالي 48.5 جنيه للشراء.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('dynamic');
    });

    it('rejects current news queries', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'اخر اخبار التكنولوجيا النهاردة',
        replyText: 'أعلنت الشركات العالمية اليوم عن أحدث التطورات في مجال الذكاء الاصطناعي.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('dynamic');
    });

    it('rejects user-specific / personalized account queries', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'عايز اعرف رصيدي المتبقي كام',
        replyText: 'رصيد حسابك المتبقي هو 150 نقطة متاحة للاستخدام.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('user_specific');
    });

    it('rejects order status queries', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'فين اوردر الشحن بتاعي؟',
        replyText: 'طلبك رقم 1234 قيد التوصيل وسيصل خلال 48 ساعة.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('user_specific');
    });

    it('rejects reminder management queries', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'فكرني اشتري دواء بكرة',
        replyText: 'تم إنشاء التذكير بنجاح وسأقوم بتنبيهك غداً.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('user_specific');
    });

    it('rejects tool-dependent results (non-search tool)', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'احجز لي ميعاد مع الطبيب',
        replyText: 'تم فحص المواعيد المتاحة وتأكيد الحجز بنجاح.',
        toolCallsExecuted: [
          { toolName: 'create_event', arguments: { title: 'طبيب' }, result: { success: true } },
        ],
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('tool_result');
    });

    it('rejects search-dependent results (web_search tool)', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'ما هي مواصفات الهاتف الجديد وسعره؟',
        replyText: 'بناءً على نتائج البحث الرسمية، سعر الهاتف 35000 جنيه.',
        toolCallsExecuted: [
          { toolName: 'web_search', arguments: { query: 'phone specs' }, result: { items: [] } },
        ],
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('search_result');
    });

    it('rejects responses containing private phone numbers', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'رقم خدمة العملاء',
        replyText: 'يمكنك التواصل مع الموظف المباشر على الرقم الشخصي 01012345678 فوراً.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('private');
    });

    it('rejects responses containing private email addresses', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'البريد الخاص',
        replyText: 'البريد الخاص هو admin.private@company-internal.com.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('private');
    });

    it('rejects responses containing API keys or secret tokens', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'ما هو مفتاح الاتصال؟',
        replyText: 'المفتاح هو sk-live-1234567890abcdef1234567890.',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('private');
    });

    it('rejects empty or whitespace responses', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'ازيك',
        replyText: '   ',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('empty_response');
    });

    it('rejects too short responses (< 15 chars)', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'شغالين امتى؟',
        replyText: 'تمام ماشي',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('low_confidence');
    });

    it('rejects error fallback or degraded bot responses', () => {
      const res = LearningEligibilityFilter.evaluate({
        userInput: 'سؤال تقني',
        replyText: 'يا باشا أنا معاك وسامعك، حصل تهنيجة بسيطة في الاتصال بس أنا جاهز، تحب أساعدك في إيه؟',
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('low_confidence');
    });
  });

  describe('2. Deduplication Engine (Deterministic + Vector Similarity)', () => {
    let prodFaqId: string;

    beforeAll(async () => {
      const item = await semanticCacheRepo.create({
        intent: 'shipping_policy',
        category: 'policies',
        title: 'سياسة الشحن والتوصيل',
        examples: ['ما هي سياسة الشحن لديكم', 'كيف يتم شحن الطلبات'],
        response: 'يتم شحن الطلبات خلال 2 إلى 4 أيام عمل لجميع المحافظات.',
        embedding: [0.5, 0.5, 0.5, 0.5],
      });
      prodFaqId = item.id;
      testFaqIds.push(prodFaqId);
    });

    it('detects exact normalized duplicate against production cache', async () => {
      const dedup = new DeduplicationEngine(semanticCacheRepo, candidateRepo, mockEmbeddingProvider);
      const res = await dedup.check('ما هي سياسة الشحن لديكم؟', 'shipping_inquiry');
      expect(res.isDuplicate).toBe(true);
      expect(res.duplicateOf).toBe('production_exact');
      expect(res.matchedId).toBe(prodFaqId);
    });

    it('detects high token overlap duplicate against production cache', async () => {
      const dedup = new DeduplicationEngine(semanticCacheRepo, candidateRepo, mockEmbeddingProvider);
      const res = await dedup.check('ما هي سياسة الشحن لديكم بالظبط', 'shipping_inquiry');
      expect(res.isDuplicate).toBe(true);
      expect(res.duplicateOf).toBe('production_exact');
    });

    it('detects exact duplicate against existing pending candidate', async () => {
      const cand = await candidateRepo.create({
        intent: 'candidate_refund_rules',
        inputExamples: ['كيف يمكن استرجاع المنتج المباع'],
        response: 'يمكنك استرجاع أي منتج خلال 14 يوماً من تاريخ الاستلام بشرط حالته الأصلية.',
      });
      testCandidateIds.push(cand.id);

      const dedup = new DeduplicationEngine(semanticCacheRepo, candidateRepo, mockEmbeddingProvider);
      const res = await dedup.check('كيف يمكن استرجاع المنتج المباع؟', 'new_refund_intent');
      expect(res.isDuplicate).toBe(true);
      expect(res.duplicateOf).toBe('candidate_exact');
      expect(res.matchedId).toBe(cand.id);
    });

    it('detects intent duplicate against existing candidate', async () => {
      const dedup = new DeduplicationEngine(semanticCacheRepo, candidateRepo, mockEmbeddingProvider);
      const res = await dedup.check('سؤال مختلف تماماً عن الاسترجاع', 'candidate_refund_rules');
      expect(res.isDuplicate).toBe(true);
      expect(res.duplicateOf).toBe('candidate_intent');
    });

    it('allows clean, distinct query through with no duplication', async () => {
      const dedup = new DeduplicationEngine(semanticCacheRepo, candidateRepo, mockEmbeddingProvider);
      const res = await dedup.check('ما هي شروط التقسيط والضمان البنكي؟', 'installment_inquiry');
      expect(res.isDuplicate).toBe(false);
      expect(res.isUncertain).toBe(false);
    });

    it('prevents intent collision between distinct target entities (e.g. password vs email)', async () => {
      // Create production FAQ for changing password
      const pwdItem = await semanticCacheRepo.create({
        intent: 'change_password_faq',
        category: 'account',
        title: 'طريقة تغيير كلمة المرور والباسورد',
        examples: ['ازاي اغير الباسورد'],
        response: 'لتغيير الباسورد، توجه إلى إعدادات الحساب ثم اضغط على تغيير كلمة المرور.',
      });
      testFaqIds.push(pwdItem.id);

      const dedup = new DeduplicationEngine(semanticCacheRepo, candidateRepo, mockEmbeddingProvider);

      // Query for changing email: shares phrasing ("ازاي اغير") but has distinct target ("الايميل" vs "الباسورد")
      const res = await dedup.check('ازاي اغير الايميل؟', 'faq_اغير_ايميل');
      expect(res.isDuplicate).toBe(false);
    });
  });

  describe('3. Candidate Lifecycle & Human Review Readiness', () => {
    it('creates candidate strictly in "pending" status (never auto-promoted)', async () => {
      const candidate = await candidateRepo.create({
        intent: 'warranty_terms',
        category: 'policies',
        inputExamples: ['ما هي مدة الضمان للأجهزة الكهربائية'],
        response: 'مدة الضمان لجميع الأجهزة الكهربائية هي عامان كاملان من تاريخ الشراء.',
        language: 'ar',
      });
      testCandidateIds.push(candidate.id);

      expect(candidate.status).toBe('pending');
      expect(candidate.promotedFaqId).toBeNull();
      expect(candidate.promotedAt).toBeNull();
    });

    it('transitions from pending to validated via validateCandidate()', async () => {
      const candidate = await candidateRepo.create({
        intent: 'warranty_terms_2',
        inputExamples: ['مدة الضمان المعتمدة'],
        response: 'مدة الضمان لجميع الأجهزة الكهربائية هي عامان كاملان من تاريخ الشراء.',
        language: 'ar',
      });
      testCandidateIds.push(candidate.id);

      const ok = await promotionService.validateCandidate(candidate.id);
      expect(ok).toBe(true);

      const updated = await candidateRepo.findById(candidate.id);
      expect(updated?.status).toBe('validated');
      expect(updated?.validatedAt).toBeTruthy();
    });

    it('rejects candidate with documented reason via rejectCandidate()', async () => {
      const candidate = await candidateRepo.create({
        intent: 'junk_intent',
        inputExamples: ['كلام غير مفهوم'],
        response: 'إجابة عامة غير دقيقة بالمرة.',
        language: 'ar',
      });
      testCandidateIds.push(candidate.id);

      const ok = await promotionService.rejectCandidate(candidate.id, 'Low relevance and imprecise wording');
      expect(ok).toBe(true);

      const updated = await candidateRepo.findById(candidate.id);
      expect(updated?.status).toBe('rejected');
      expect(updated?.rejectionReason).toBe('Low relevance and imprecise wording');
    });
  });

  describe('4. Explicit Promotion Service & Transaction Safety', () => {
    it('promotes a valid candidate atomically to production cache (faq_items)', async () => {
      const candidate = await candidateRepo.create({
        intent: 'return_steps',
        category: 'policies',
        inputExamples: ['ما هي خطوات عمل طلب إرجاع'],
        response: 'لعمل طلب إرجاع، يرجى فتح لوحة التحكم واختيار الطلب ثم الضغط على طلب استرجاع.',
        language: 'ar',
        status: 'validated',
        promotionEligible: true,
      });
      testCandidateIds.push(candidate.id);

      const result = await promotionService.promoteCandidate(candidate.id);
      expect(result.success).toBe(true);
      expect(result.promotedFaqId).toBeTruthy();

      testFaqIds.push(result.promotedFaqId!);

      // Verify candidate is now promoted
      const updatedCand = await candidateRepo.findById(candidate.id);
      expect(updatedCand?.status).toBe('promoted');
      expect(updatedCand?.promotedFaqId).toBe(result.promotedFaqId);
      expect(updatedCand?.promotedAt).toBeTruthy();

      // Verify production faq_items record exists and has valid embedding
      const faqItem = await semanticCacheRepo.findById(result.promotedFaqId!);
      expect(faqItem).not.toBeNull();
      expect(faqItem?.intent).toBe('return_steps');
      expect(faqItem?.embedding).toBeDefined();
    });

    it('blocks promotion if candidate content fails validation', async () => {
      const invalidCand = await candidateRepo.create({
        intent: 'unsafe_candidate',
        inputExamples: ['رقم الاتصال'],
        response: 'تواصل معي على رقم التليفون 01099998888 شكراً.', // Contains phone number!
        status: 'validated',
        promotionEligible: true,
      });
      testCandidateIds.push(invalidCand.id);

      const result = await promotionService.promoteCandidate(invalidCand.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');

      // Candidate must be marked rejected
      const cand = await candidateRepo.findById(invalidCand.id);
      expect(cand?.status).toBe('rejected');
    });

    it('strictly forbids mock embedding provider in production mode', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const candidate = await candidateRepo.create({
          intent: 'production_guard_test',
          inputExamples: ['سؤال تجريبي للإنتاج'],
          response: 'إجابة تجريبية للتأكد من حماية الإنتاج ضد موك البروفايدر.',
          status: 'validated',
          promotionEligible: true,
        });
        testCandidateIds.push(candidate.id);

        const prodPromotionService = new PromotionService(
          candidateRepo,
          semanticCacheRepo,
          new MockEmbeddingProvider(4),
          db
        );

        const result = await prodPromotionService.promoteCandidate(candidate.id);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Mock embedding provider is forbidden for production promotion');

        // Candidate must remain validated, not promoted
        const cand = await candidateRepo.findById(candidate.id);
        expect(cand?.status).toBe('validated');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('safely aborts and rolls back if embedding dimension mismatch occurs', async () => {
      const candidate = await candidateRepo.create({
        intent: 'dimension_mismatch_test',
        inputExamples: ['سؤال دايمنشن'],
        response: 'إجابة تجريبية للتأكد من فحص الدايمنشن.',
        status: 'validated',
        promotionEligible: true,
      });
      testCandidateIds.push(candidate.id);

      // Faulty provider that returns wrong dimension
      const brokenProvider: any = {
        name: 'faulty',
        dimension: 768,
        embed: async () => [0.1, 0.2, 0.3], // Returns 3 dims instead of 768!
      };

      const brokenPromotionService = new PromotionService(
        candidateRepo,
        semanticCacheRepo,
        brokenProvider,
        db
      );

      const result = await brokenPromotionService.promoteCandidate(candidate.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('dimension mismatch');

      // Candidate remains validated, production faq_items not corrupted
      const cand = await candidateRepo.findById(candidate.id);
      expect(cand?.status).toBe('validated');
    });
  });

  describe('5. Security, Privacy & Observer Isolation', () => {
    it('learning candidate record never stores private conversation or user identifiers', async () => {
      const runId = 'opaque-run-uuid-12345';
      await learningPipeline.observeRun({
        runId,
        userInput: 'ما هي طرق الدفع المتاحة في المتجر؟',
        replyText: 'نوفر الدفع عبر البطاقات الائتمانية وفيزا وميزة والمحافظ الإلكترونية.',
        modelUsed: 'openai/gpt-oss-120b',
        provider: 'groq',
        channel: 'whatsapp',
      });

      const candidates = await candidateRepo.list({ status: 'pending', limit: 20 });
      const cand = candidates.find((c) => c.sourceRunId === runId);
      expect(cand).toBeDefined();
      if (cand) {
        testCandidateIds.push(cand.id);

        // Verification of privacy guarantees
        expect(cand.sourceRunId).toBe(runId);
        expect((cand as any).userId).toBeUndefined();
        expect((cand as any).userPhone).toBeUndefined();
        expect((cand as any).conversationId).toBeUndefined();
        expect((cand as any).rawMessages).toBeUndefined();
      }
    });

    it('sanitizes input_examples by stripping conversational greetings, noise, and pleasantries', async () => {
      const runId = 'opaque-run-uuid-99999';
      await learningPipeline.observeRun({
        runId,
        userInput: 'يا باشا لو سمحت قولي ما هي وسائل التوصيل المعتمدة شكراً جزيلاً',
        replyText: 'نعتمد التوصيل عبر شركات الشحن السريع المعتمدة لجميع المحافظات.',
        modelUsed: 'openai/gpt-oss-120b',
        provider: 'groq',
        channel: 'whatsapp',
      });

      const candidates = await candidateRepo.list({ status: 'pending', limit: 20 });
      const created = candidates.find((c) => c.sourceRunId === runId);
      expect(created).toBeDefined();
      if (created) {
        testCandidateIds.push(created.id);
        expect(created.inputExamples[0]).toBe('ما هي وسائل التوصيل المعتمدة؟');
        expect(created.inputExamples[0]).not.toContain('يا باشا');
        expect(created.inputExamples[0]).not.toContain('لو سمحت');
        expect(created.inputExamples[0]).not.toContain('شكراً جزيلاً');
      }
    });

    it('strips user conversational name introductions from input_examples', async () => {
      const runId = 'opaque-run-uuid-88888';
      await learningPipeline.observeRun({
        runId,
        userInput: 'أنا اسمي أحمد، ما هي سياسة الاستبدال المعتمدة؟',
        replyText: 'يمكنك استبدال أي منتج خلال 14 يوماً من الاستلام في حالته الأصلية.',
        modelUsed: 'openai/gpt-oss-120b',
        provider: 'groq',
        channel: 'whatsapp',
      });

      const candidates = await candidateRepo.list({ status: 'pending', limit: 20 });
      const created = candidates.find((c) => c.sourceRunId === runId);
      expect(created).toBeDefined();
      if (created) {
        testCandidateIds.push(created.id);
        expect(created.inputExamples[0]).toBe('ما هي سياسة الاستبدال المعتمدة؟');
        expect(created.inputExamples[0]).not.toContain('أحمد');
        expect(created.inputExamples[0]).not.toContain('أنا اسمي');
      }
    });

    it('observer pipeline catches internal errors gracefully without crashing caller', async () => {
      // Intentionally pass inputs that trigger edge cases
      await expect(
        learningPipeline.observeRun({
          runId: 'err-test',
          userInput: '',
          replyText: '',
        })
      ).resolves.not.toThrow();
    });
  });
});
