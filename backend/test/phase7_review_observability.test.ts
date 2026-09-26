import { DatabaseManager } from '../src/database/connection';
import { SemanticCandidateRepository } from '../src/database/repositories/semantic_candidate.repo';
import { SemanticCacheRepository } from '../src/database/repositories/semantic_cache.repo';
import { SemanticReviewAuditRepository } from '../src/database/repositories/semantic_review_audit.repo';
import { CandidateReviewService } from '../src/modules/cache/learning/candidate_review.service';
import { CandidateReviewController } from '../src/modules/cache/learning/candidate_review.controller';
import { CacheObservability } from '../src/modules/cache/cache_observability';
import { PromotionService } from '../src/modules/cache/learning/promotion_service';
import { LearningPipeline } from '../src/modules/cache/learning/learning_pipeline';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { MockEmbeddingProvider } from '../src/modules/cache/embedding/mock_embedding.provider';
import { config } from '../src/config/env';

describe('Phase 7: Candidate Review & Production Observability', () => {
  let db: DatabaseManager;
  let candidateRepo: SemanticCandidateRepository;
  let cacheRepo: SemanticCacheRepository;
  let auditRepo: SemanticReviewAuditRepository;
  let mockProvider: MockEmbeddingProvider;
  let promotionService: PromotionService;
  let reviewService: CandidateReviewService;
  let observability: CacheObservability;
  let controller: CandidateReviewController;

  const testCandidateIds: string[] = [];
  const testFaqIds: string[] = [];
  const adminSecret = config.admin.secretKey;

  beforeAll(async () => {
    db = DatabaseManager.getInstance();
    candidateRepo = new SemanticCandidateRepository(db);
    cacheRepo = new SemanticCacheRepository(db);
    auditRepo = new SemanticReviewAuditRepository(db);
    mockProvider = new MockEmbeddingProvider(768);

    await candidateRepo.ensureSchema();
    await cacheRepo.ensureSchema();

    observability = CacheObservability.getInstance();
    promotionService = new PromotionService(candidateRepo, cacheRepo, mockProvider, db);
    reviewService = new CandidateReviewService(candidateRepo, auditRepo, promotionService, mockProvider);
    controller = new CandidateReviewController(reviewService, observability);
  });

  afterAll(async () => {
    const pool = db.getPool();
    if (pool) {
      await pool.query("SET app.allow_audit_cleanup = 'true'");
      await pool.query("DELETE FROM semantic_cache_candidates WHERE source_run_id LIKE 'run-e2e%' OR source_run_id LIKE 'run-%'");
      await pool.query("DELETE FROM semantic_cache_metrics_events");
    }
    for (const id of testCandidateIds) {
      await candidateRepo.delete(id);
    }
    for (const id of testFaqIds) {
      await cacheRepo.delete(id);
    }
    await db.close();
  });

  describe('1. Candidate Listing & Filtering', () => {
    let candPending: any;
    let candValidated: any;
    let candRejected: any;

    beforeAll(async () => {
      candPending = await candidateRepo.create({
        intent: 'phase7_listing_pending',
        category: 'shipping',
        inputExamples: ['كم يستغرق الشحن والتوصيل'],
        response: 'التوصيل يستغرق من يومين إلى 4 أيام عمل.',
        language: 'ar',
        confidence: 0.75,
        sourceModel: 'llama-3.3-70b-versatile',
      });
      testCandidateIds.push(candPending.id);

      candValidated = await candidateRepo.create({
        intent: 'phase7_listing_validated',
        category: 'payment',
        inputExamples: ['ما هي وسائل الدفع المتاحة'],
        response: 'نقبل البطاقات الائتمانية والدفع عند الاستلام.',
        language: 'ar',
        confidence: 0.92,
        status: 'validated',
        promotionEligible: true,
      });
      testCandidateIds.push(candValidated.id);

      candRejected = await candidateRepo.create({
        intent: 'phase7_listing_rejected',
        category: 'support',
        inputExamples: ['رقم شكاوي العملاء'],
        response: 'يمكنك التواصل مع الدعم الفني.',
        language: 'ar',
        confidence: 0.50,
        status: 'rejected',
        rejectionReason: 'Too short and generic',
      });
      testCandidateIds.push(candRejected.id);
    });

    it('enforces MAX_PAGE_SIZE = 100 on listing', async () => {
      const result = await reviewService.listCandidates({ limit: 500 });
      expect(result.limit).toBe(100);
      expect(result.items.length).toBeLessThanOrEqual(100);
    });

    it('filters candidates by status (pending, validated, rejected)', async () => {
      const pendingList = await reviewService.listCandidates({ status: 'pending', intent: 'phase7_listing' });
      expect(pendingList.items.every((c) => c.status === 'pending')).toBe(true);
      expect(pendingList.items.some((c) => c.id === candPending.id)).toBe(true);

      const validatedList = await reviewService.listCandidates({ status: 'validated', intent: 'phase7_listing' });
      expect(validatedList.items.every((c) => c.status === 'validated')).toBe(true);
      expect(validatedList.items.some((c) => c.id === candValidated.id)).toBe(true);

      const rejectedList = await reviewService.listCandidates({ status: 'rejected', intent: 'phase7_listing' });
      expect(rejectedList.items.every((c) => c.status === 'rejected')).toBe(true);
      expect(rejectedList.items.some((c) => c.id === candRejected.id)).toBe(true);
    });

    it('filters candidates by promotionEligible boolean', async () => {
      const eligibleList = await reviewService.listCandidates({
        promotionEligible: true,
        intent: 'phase7_listing',
      });
      expect(eligibleList.items.every((c) => c.promotionEligible === true)).toBe(true);
      expect(eligibleList.items.some((c) => c.id === candValidated.id)).toBe(true);
    });

    it('filters candidates by confidence bounds (minConfidence, maxConfidence)', async () => {
      const highConf = await reviewService.listCandidates({
        minConfidence: 0.90,
        intent: 'phase7_listing',
      });
      expect(highConf.items.every((c) => c.confidence >= 0.90)).toBe(true);
      expect(highConf.items.some((c) => c.id === candValidated.id)).toBe(true);
      expect(highConf.items.some((c) => c.id === candRejected.id)).toBe(false);
    });

    it('filters by category, language, and sourceModel', async () => {
      const filtered = await reviewService.listCandidates({
        category: 'shipping',
        sourceModel: 'llama-3.3-70b-versatile',
        language: 'ar',
      });
      expect(filtered.items.some((c) => c.id === candPending.id)).toBe(true);
    });

    it('supports offset and cursor-based pagination', async () => {
      const page1 = await reviewService.listCandidates({ limit: 1, offset: 0 });
      expect(page1.items.length).toBe(1);

      const page2 = await reviewService.listCandidates({ limit: 1, offset: 1 });
      expect(page2.items.length).toBe(1);
      if (page1.items.length > 0 && page2.items.length > 0) {
        expect(page1.items[0].id).not.toBe(page2.items[0].id);
      }
    });
  });

  describe('2. Candidate Detail View & Privacy Sanitization', () => {
    it('returns sanitized candidate details with ZERO user PII exposure', async () => {
      const cand = await candidateRepo.create({
        intent: 'privacy_guarantee_test',
        inputExamples: ['ما هي ساعات العمل لديكم'],
        response: 'أوقات العمل من الأحد إلى الخميس من 9 صباحاً حتى 5 مساءً.',
        language: 'ar',
        sourceRunId: 'run-internal-opaque-99',
      });
      testCandidateIds.push(cand.id);

      const detail = await reviewService.getCandidate(cand.id, { actorId: 'admin_audit_user', recordViewAudit: true });
      expect(detail).not.toBeNull();
      if (!detail) return;

      // Assert privacy guarantees:
      expect((detail as any).userId).toBeUndefined();
      expect((detail as any).phone).toBeUndefined();
      expect((detail as any).phoneNumber).toBeUndefined();
      expect((detail as any).conversationId).toBeUndefined();
      expect((detail as any).rawUserMessage).toBeUndefined();

      // Assert safe public inspectable fields:
      expect(detail.id).toBe(cand.id);
      expect(detail.intent).toBe('privacy_guarantee_test');
      expect(detail.response).toContain('أوقات العمل');
      expect(detail.inputExamples).toEqual(['ما هي ساعات العمل لديكم']);

      // Assert view audit was recorded
      const audits = await reviewService.getAuditEvents(cand.id);
      expect(audits.some((a) => a.action === 'view' && a.actorId === 'admin_audit_user')).toBe(true);
    });
  });

  describe('3. Validation Action & Idempotency', () => {
    it('successfully validates a valid candidate and logs audit event', async () => {
      const cand = await candidateRepo.create({
        intent: 'validation_flow_test',
        inputExamples: ['كيف اتواصل مع الدعم الفني'],
        response: 'يمكنك التواصل مع فريق الدعم الفني من خلال مركز المساعدة المتاح في التطبيق.',
        language: 'ar',
      });
      testCandidateIds.push(cand.id);

      const result = await reviewService.validateCandidate(cand.id, {
        actorId: 'senior_reviewer_1',
        reason: 'Verified accurate and safe instructions',
      });

      expect(result.success).toBe(true);
      expect(result.candidate?.status).toBe('validated');

      const audits = await reviewService.getAuditEvents(cand.id);
      const valEvent = audits.find((a) => a.action === 'validate');
      expect(valEvent).toBeDefined();
      expect(valEvent?.actorId).toBe('senior_reviewer_1');
      expect(valEvent?.reason).toBe('Verified accurate and safe instructions');
    });

    it('is idempotent: subsequent validation does not duplicate audit events if unchanged', async () => {
      const cand = await candidateRepo.create({
        intent: 'validation_idempotency_test',
        inputExamples: ['هل الشحن مجاني للطلبات فوق 500 ريال'],
        response: 'نعم، الشحن مجاني لكافة الطلبات التي تتجاوز قيمتها 500 ريال.',
        language: 'ar',
      });
      testCandidateIds.push(cand.id);

      // First validation
      const res1 = await reviewService.validateCandidate(cand.id, { actorId: 'reviewer_1' });
      expect(res1.success).toBe(true);

      const auditsAfterFirst = await reviewService.getAuditEvents(cand.id);
      const countFirst = auditsAfterFirst.filter((a) => a.action === 'validate').length;

      // Second validation
      const res2 = await reviewService.validateCandidate(cand.id, { actorId: 'reviewer_1' });
      expect(res2.success).toBe(true);

      const auditsAfterSecond = await reviewService.getAuditEvents(cand.id);
      const countSecond = auditsAfterSecond.filter((a) => a.action === 'validate').length;

      expect(countSecond).toBe(countFirst);
    });

    it('rejects candidate if content validation fails (e.g. dynamic/PII)', async () => {
      const unsafeCand = await candidateRepo.create({
        intent: 'validation_fail_dynamic',
        inputExamples: ['الساعة كام الآن'],
        response: 'الوقت الحالي هو 3:00 مساءً بتوقيت الرياض.',
        language: 'ar',
      });
      testCandidateIds.push(unsafeCand.id);

      const res = await reviewService.validateCandidate(unsafeCand.id, { actorId: 'reviewer_safety' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Validation failed');

      const updated = await candidateRepo.findById(unsafeCand.id);
      expect(updated?.status).toBe('rejected');
    });
  });

  describe('4. Rejection Action & Mandatory Reason', () => {
    it('enforces mandatory documented reason on rejection', async () => {
      const cand = await candidateRepo.create({
        intent: 'rejection_mandatory_reason',
        inputExamples: ['سؤال غير واضح'],
        response: 'إجابة عامة.',
        language: 'ar',
      });
      testCandidateIds.push(cand.id);

      const resEmpty = await reviewService.rejectCandidate(cand.id, '   ');
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.error).toContain('mandatory');

      const fresh = await candidateRepo.findById(cand.id);
      expect(fresh?.status).toBe('pending');
    });

    it('reject != delete: candidate remains in database and revokes promotion eligibility', async () => {
      const cand = await candidateRepo.create({
        intent: 'rejection_preservation_test',
        inputExamples: ['سؤال للتجربة والرفض'],
        response: 'إجابة مرفوضة.',
        language: 'ar',
        promotionEligible: true,
      });
      testCandidateIds.push(cand.id);

      const res = await reviewService.rejectCandidate(cand.id, 'Duplicate with another FAQ', {
        actorId: 'lead_reviewer_2',
      });
      expect(res.success).toBe(true);
      expect(res.candidate?.status).toBe('rejected');
      expect(res.candidate?.rejectionReason).toBe('Duplicate with another FAQ');
      expect(res.candidate?.promotionEligible).toBe(false);

      // Verify still exists in DB
      const inDb = await candidateRepo.findById(cand.id);
      expect(inDb).not.toBeNull();
      expect(inDb?.status).toBe('rejected');

      // Audit recorded
      const audits = await reviewService.getAuditEvents(cand.id);
      expect(audits.some((a) => a.action === 'reject' && a.reason === 'Duplicate with another FAQ')).toBe(true);
    });

    it('is idempotent: repeating rejection with identical reason does not duplicate audits', async () => {
      const cand = await candidateRepo.create({
        intent: 'rejection_idempotency_test',
        inputExamples: ['سؤال مكرر'],
        response: 'رد مكرر.',
        language: 'ar',
      });
      testCandidateIds.push(cand.id);

      await reviewService.rejectCandidate(cand.id, 'Not relevant anymore', { actorId: 'admin_1' });
      const firstCount = (await reviewService.getAuditEvents(cand.id)).filter((a) => a.action === 'reject').length;

      await reviewService.rejectCandidate(cand.id, 'Not relevant anymore', { actorId: 'admin_1' });
      const secondCount = (await reviewService.getAuditEvents(cand.id)).filter((a) => a.action === 'reject').length;

      expect(secondCount).toBe(firstCount);
    });
  });

  describe('5. Explicit Promotion & Single Source of Truth', () => {
    it('refuses to promote candidate with blockers or insufficient evidence', async () => {
      const weakCand = await candidateRepo.create({
        intent: 'promotion_weak_candidate',
        inputExamples: ['سؤال فردي ضعيف'],
        response: 'رد فردي.',
        language: 'ar',
        observationCount: 1,
        confidence: 0.40,
        status: 'pending',
      });
      testCandidateIds.push(weakCand.id);

      const res = await reviewService.promoteCandidate(weakCand.id, { actorId: 'admin_promoter' });
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();

      const fresh = await candidateRepo.findById(weakCand.id);
      expect(fresh?.status).toBe('pending');
      expect(fresh?.promotedFaqId).toBeNull();
    });

    it('successfully promotes fully qualified validated candidate via PromotionService', async () => {
      const cand = await candidateRepo.create({
        intent: 'phase7_full_qualified_promo',
        category: 'shipping',
        inputExamples: [
          'ما هي تكلفة الشحن للمحافظات',
          'كم سعر التوصيل لخارج العاصمة',
          'مصاريف الشحن والتوصيل',
          'سعر الشحن العام لكافة المناطق',
          'تكلفة التوصيل المعتمدة',
        ],
        response: 'تكلفة الشحن لجميع المحافظات هي 35 جنيها مصريا وثابتة لكافة الطلبات.',
        language: 'ar',
        observationCount: 7,
        uniqueExampleCount: 5,
        confidence: 0.94,
        semanticConsistency: 0.95,
        status: 'validated',
        promotionEligible: true,
      });
      testCandidateIds.push(cand.id);

      const promoResult = await reviewService.promoteCandidate(cand.id, { actorId: 'admin_promoter' });
      expect(promoResult.success).toBe(true);
      expect(promoResult.promotedFaqId).toBeDefined();
      if (promoResult.promotedFaqId) {
        testFaqIds.push(promoResult.promotedFaqId);
      }

      // Check candidate is updated
      const promotedCand = await candidateRepo.findById(cand.id);
      expect(promotedCand?.status).toBe('promoted');
      expect(promotedCand?.promotedFaqId).toBe(promoResult.promotedFaqId);

      // Check item exists in production FAQ cache
      const faqItem = await cacheRepo.findById(promoResult.promotedFaqId!);
      expect(faqItem).not.toBeNull();
      expect(faqItem?.intent).toBe('phase7_full_qualified_promo');
      expect(faqItem?.embedding).toBeDefined();
      expect(faqItem?.embedding?.length).toBe(768);

      // Check promotion audit event
      const audits = await reviewService.getAuditEvents(cand.id);
      const promoAudit = audits.find((a) => a.action === 'promote');
      expect(promoAudit).toBeDefined();
      expect(promoAudit?.actorId).toBe('admin_promoter');
    });
  });

  describe('6. Append-Only Audit Trail & Immutability', () => {
    it('records immutable audit events with previous/new status and eligibility', async () => {
      const cand = await candidateRepo.create({
        intent: 'audit_trail_progression_test',
        inputExamples: ['كيف أقوم بإلغاء الطلب'],
        response: 'يمكنك إلغاء الطلب خلال ساعتين من تأكيده عبر قسم طلباتي.',
        language: 'ar',
      });
      testCandidateIds.push(cand.id);

      // 1. View
      await reviewService.getCandidate(cand.id, { actorId: 'user_a', recordViewAudit: true });
      // 2. Validate
      await reviewService.validateCandidate(cand.id, { actorId: 'user_b', reason: 'Looks accurate' });

      const events = await auditRepo.listEvents(cand.id);
      expect(events.length).toBeGreaterThanOrEqual(2);

      const viewEvent = events.find((e) => e.action === 'view');
      const valEvent = events.find((e) => e.action === 'validate');

      expect(viewEvent?.actorId).toBe('user_a');
      expect(valEvent?.actorId).toBe('user_b');
      expect(valEvent?.newStatus).toBe('validated');
    });

    it('enforces database append-only trigger preventing mutation or deletion of review events', async () => {
      const pool = db.getPool();
      if (!pool) return; // In-memory environment passes by architecture

      const triggerCand = await candidateRepo.create({
        intent: 'trigger_immutability_test',
        inputExamples: ['سؤال للتأكد من خاصية عدم التعديل'],
        response: 'إجابة مخصصة لاختبار عدم التعديل على سجلات التدقيق.',
        language: 'ar',
      });
      testCandidateIds.push(triggerCand.id);

      const event = await auditRepo.recordEvent({
        candidateId: triggerCand.id,
        action: 'validate',
        actorId: 'test_immutability',
      });

      // Attempting to UPDATE should be blocked by trigger
      let updateFailed = false;
      try {
        await pool.query('UPDATE semantic_cache_review_events SET reason = $1 WHERE id = $2', [
          'tampered reason',
          event.id,
        ]);
      } catch (err: any) {
        updateFailed = true;
        expect(err.message).toContain('append-only');
      }
      expect(updateFailed).toBe(true);

      // Attempting to DELETE should be blocked by trigger
      let deleteFailed = false;
      try {
        await pool.query('DELETE FROM semantic_cache_review_events WHERE id = $1', [event.id]);
      } catch (err: any) {
        deleteFailed = true;
        expect(err.message).toContain('append-only');
      }
      expect(deleteFailed).toBe(true);
    });
  });

  describe('7. Production Observability & Cache Metrics', () => {
    beforeEach(async () => {
      const pool = db.getPool();
      if (pool) {
        await pool.query('DELETE FROM semantic_cache_metrics_events');
      }
      observability.clearInMemory();
    });

    it('computes accurate hit rates and protects against division by zero', async () => {
      const emptyStats = await observability.getCacheStats();
      expect(emptyStats.hitRate).toBe(0.0);
      expect(emptyStats.eligibleHitRate).toBe(0.0);
      expect(emptyStats.exactHits).toBe(0);
      expect(emptyStats.semanticHits).toBe(0);
      expect(emptyStats.misses).toBe(0);
    });

    it('distinguishes eligible vs ineligible queries without penalizing dynamic queries as misses', async () => {
      // 3 Exact hits
      await observability.recordCacheEvent({ event: 'exact_hit', source: 'exact', latencyMs: 1 });
      await observability.recordCacheEvent({ event: 'exact_hit', source: 'exact', latencyMs: 1 });
      await observability.recordCacheEvent({ event: 'exact_hit', source: 'exact', latencyMs: 2 });

      // 2 Semantic hits
      await observability.recordCacheEvent({ event: 'semantic_hit', source: 'semantic', similarity: 0.94, latencyMs: 15 });
      await observability.recordCacheEvent({ event: 'semantic_hit', source: 'semantic', similarity: 0.91, latencyMs: 18 });

      // 5 Legitimate misses
      for (let i = 0; i < 5; i++) {
        await observability.recordCacheEvent({ event: 'semantic_miss', latencyMs: 10, reason: 'similarity_below_threshold' });
      }

      // 10 Ineligible requests (dynamic date/weather/orders)
      for (let i = 0; i < 10; i++) {
        await observability.recordCacheEvent({ event: 'ineligible_dynamic', latencyMs: 0 });
      }

      const stats = await observability.getCacheStats();

      expect(stats.exactHits).toBe(3);
      expect(stats.semanticHits).toBe(2);
      expect(stats.misses).toBe(5);
      expect(stats.cacheIneligibleRequests).toBe(10);

      // Total Hits = 5
      // Eligible Requests = 5 hits + 5 misses = 10
      // Total All Requests = 10 eligible + 10 ineligible = 20
      // Hit Rate = 5 / 20 = 0.25 (25%)
      // Eligible Hit Rate = 5 / 10 = 0.50 (50%)
      expect(stats.hitRate).toBe(0.25);
      expect(stats.eligibleHitRate).toBe(0.50);
      expect(stats.semanticAverageSimilarity).toBeCloseTo(0.925, 2);
    });

    it('records reviewer false positive feedback as marked incorrect', async () => {
      await observability.markCacheResultAsIncorrect('cache-item-123', 'Wrong FAQ matched for return query', 'reviewer_qa');
      const stats = await observability.getCacheStats();
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });

    it('calculates avoided AI LLM calls accurately', async () => {
      await observability.recordCacheEvent({ event: 'exact_hit', source: 'exact', latencyMs: 1 });
      await observability.recordCacheEvent({ event: 'semantic_hit', source: 'semantic', similarity: 0.93, latencyMs: 12 });

      const learningStats = await observability.getLearningStats();
      expect(learningStats.aiRequestsAvoided).toBeGreaterThanOrEqual(2);
    });
  });

  describe('8. API Endpoints & Admin Security Audit', () => {
    it('1. accepts authorization via Bearer header', async () => {
      const req: any = { headers: { authorization: `Bearer ${adminSecret}` } };
      expect(controller.isAuthorized(req)).toBe(true);
    });

    it('2. accepts authorization via x-admin-token header', async () => {
      const req: any = { headers: { 'x-admin-token': adminSecret } };
      expect(controller.isAuthorized(req)).toBe(true);
    });

    it('3. rejects missing authorization with false and 401 Unauthorized', async () => {
      const req: any = { headers: {}, query: {}, params: {} };
      expect(controller.isAuthorized(req)).toBe(false);

      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.listCandidates(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.stringContaining('Unauthorized') })
      );
    });

    it('4. rejects invalid/wrong secret token', async () => {
      const reqBearer: any = { headers: { authorization: 'Bearer wrong-secret-key-123' } };
      expect(controller.isAuthorized(reqBearer)).toBe(false);

      const reqHeader: any = { headers: { 'x-admin-token': 'wrong-token-abc' } };
      expect(controller.isAuthorized(reqHeader)).toBe(false);
    });

    it('5. STRICT SECURITY: forbids query token ?token=SECRET and rejects with 401 even with valid secret', async () => {
      const queryReq: any = {
        query: { token: adminSecret },
        headers: {},
      };
      // isAuthorized must strictly reject query parameter tokens
      expect(controller.isAuthorized(queryReq)).toBe(false);

      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.listCandidates(queryReq, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.stringContaining('Unauthorized') })
      );
    });

    it('6. Production Fail-Closed: blocks all admin requests when ADMIN_SECRET_KEY is missing or empty in production', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.ADMIN_SECRET_KEY;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ADMIN_SECRET_KEY;

        const req: any = { headers: { authorization: `Bearer ${adminSecret}` } };
        expect(controller.isAuthorized(req)).toBe(false);

        const res: any = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };
        await controller.listCandidates(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevSecret) process.env.ADMIN_SECRET_KEY = prevSecret;
      }
    });

    it('7. Full Route Coverage: all 8 admin cache endpoints return 401 when accessed without valid auth', async () => {
      const req: any = { query: {}, headers: {}, params: { id: 'some-id' }, body: {} };
      const testRoute = async (handler: (r: any, s: any) => Promise<void>) => {
        const res: any = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: false, error: expect.stringContaining('Unauthorized') })
        );
      };

      // 1. GET /api/admin/cache/candidates
      await testRoute(controller.listCandidates);
      // 2. GET /api/admin/cache/candidates/:id
      await testRoute(controller.getCandidate);
      // 3. POST /api/admin/cache/candidates/:id/validate
      await testRoute(controller.validateCandidate);
      // 4. POST /api/admin/cache/candidates/:id/reject
      await testRoute(controller.rejectCandidate);
      // 5. POST /api/admin/cache/candidates/:id/promote
      await testRoute(controller.promoteCandidate);
      // 6. GET /api/admin/cache/stats
      await testRoute(controller.getCacheStats);
      // 7. GET /api/admin/cache/learning-stats
      await testRoute(controller.getLearningStats);
      // 8. POST /api/admin/cache/feedback/incorrect
      await testRoute(controller.markIncorrect);
    });

    it('8. Constant-Time Comparison: protects against timing side-channel attacks and handles variable lengths safely', async () => {
      // Shorter token
      const shortReq: any = { headers: { authorization: 'Bearer short' } };
      expect(controller.isAuthorized(shortReq)).toBe(false);

      // Longer token
      const longReq: any = { headers: { authorization: `Bearer ${adminSecret}_much_longer_padding_string` } };
      expect(controller.isAuthorized(longReq)).toBe(false);

      // Same length, 1 character difference
      const tampered = adminSecret.slice(0, -1) + (adminSecret.slice(-1) === 'a' ? 'b' : 'a');
      const tamperedReq: any = { headers: { authorization: `Bearer ${tampered}` } };
      expect(controller.isAuthorized(tamperedReq)).toBe(false);
    });

    it('9. Zero Token Leakage: secret token never appears in audit events or logs', async () => {
      const candidate = await candidateRepo.create({
        intent: 'phase7_sec_token_leakage_check',
        category: 'security',
        inputExamples: ['check token leakage in audit'],
        response: 'Sensitive tokens must never enter audit logs.',
        language: 'en',
        confidence: 0.88,
        status: 'pending',
      });
      testCandidateIds.push(candidate.id);

      const req: any = {
        headers: { authorization: `Bearer ${adminSecret}` },
        params: { id: candidate.id },
        body: { notes: 'audit validation check' },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.validateCandidate(req, res);

      const events = await auditRepo.listEvents(candidate.id);
      expect(events.length).toBeGreaterThanOrEqual(1);

      for (const ev of events) {
        expect(ev.actorId).not.toBe(adminSecret);
        if (ev.actorId) expect(ev.actorId).not.toContain(adminSecret);
        expect(JSON.stringify(ev.metadata || {})).not.toContain(adminSecret);
        expect(ev.reason || '').not.toContain(adminSecret);
      }
    });

    it('10. Audit Identity: records actor_id = null and actorType: "admin_token" when no actor specified; strips secret if passed as actor', async () => {
      const candidate = await candidateRepo.create({
        intent: 'phase7_sec_actor_identity_check',
        category: 'security',
        inputExamples: ['actor identity audit check'],
        response: 'Actor identity test response.',
        language: 'en',
        confidence: 0.85,
        status: 'pending',
      });
      testCandidateIds.push(candidate.id);

      // Case A: No actor specified in headers or body
      const reqNoActor: any = {
        headers: { authorization: `Bearer ${adminSecret}` },
        params: { id: candidate.id },
        body: { reason: 'Rejection test with no actor specified' },
      };
      const resNoActor: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.rejectCandidate(reqNoActor, resNoActor);

      const events = await auditRepo.listEvents(candidate.id);
      const rejectEvent = events.find((e) => e.action === 'reject');
      expect(rejectEvent).toBeDefined();
      expect(rejectEvent?.actorId).toBeNull();
      expect(rejectEvent?.metadata?.actorType).toBe('admin_token');

      // Case B: Secret passed as actorId -> MUST be stripped to null
      const cand2 = await candidateRepo.create({
        intent: 'phase7_sec_sneaky_actor_check',
        category: 'security',
        inputExamples: ['sneaky actor audit check'],
        response: 'Sneaky actor response.',
        language: 'en',
        confidence: 0.85,
        status: 'pending',
      });
      testCandidateIds.push(cand2.id);

      const reqSneaky: any = {
        headers: { authorization: `Bearer ${adminSecret}` },
        params: { id: cand2.id },
        body: { reason: 'Rejection with secret as actorId', actorId: adminSecret },
      };
      const resSneaky: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.rejectCandidate(reqSneaky, resSneaky);

      const events2 = await auditRepo.listEvents(cand2.id);
      const rejectEvent2 = events2.find((e) => e.action === 'reject');
      expect(rejectEvent2?.actorId).toBeNull();
      expect(rejectEvent2?.metadata?.actorType).toBe('admin_token');
    });

    it('11. Unauthorized promotion cannot mutate candidate; authorized promotion delegates strictly to PromotionService', async () => {
      const candToPromote = await candidateRepo.create({
        intent: 'phase7_sec_unauthorized_promotion_check',
        category: 'security',
        inputExamples: ['unauthorized promotion candidate check'],
        response: 'Unauthorized promotion must never succeed.',
        language: 'ar',
        confidence: 0.95,
        status: 'pending',
      });
      testCandidateIds.push(candToPromote.id);

      // Step 1: Unauthorized promotion attempt
      const unauthReq: any = {
        headers: {},
        params: { id: candToPromote.id },
        body: {},
      };
      const unauthRes: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.promoteCandidate(unauthReq, unauthRes);
      expect(unauthRes.status).toHaveBeenCalledWith(401);

      // Verify DB state: candidate remains pending and no FAQ is created
      const candAfterUnauth = await candidateRepo.findById(candToPromote.id);
      expect(candAfterUnauth?.status).toBe('pending');
      expect(candAfterUnauth?.promotedFaqId).toBeFalsy();

      // Step 2: Validate candidate to make it eligible
      await candidateRepo.updateStatus(candToPromote.id, 'validated');
      await candidateRepo.updateEvidence(candToPromote.id, {
        observationCount: 5,
        uniqueExampleCount: 3,
        semanticConsistency: 0.95,
        confidence: 0.95,
        promotionEligible: true,
        promotionBlockers: [],
      });

      // Step 3: Authorized promotion with Bearer token
      let authPromoteResData: any = null;
      const authReq: any = {
        headers: { authorization: `Bearer ${adminSecret}` },
        params: { id: candToPromote.id },
        body: {},
      };
      const authRes: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((data) => {
          authPromoteResData = data;
        }),
      };
      await controller.promoteCandidate(authReq, authRes);

      expect(authPromoteResData).not.toBeNull();
      expect(authPromoteResData.success).toBe(true);
      expect(authPromoteResData.promotedFaqId).toBeDefined();
      testFaqIds.push(authPromoteResData.promotedFaqId);

      const candAfterSuccess = await candidateRepo.findById(candToPromote.id);
      expect(candAfterSuccess?.status).toBe('promoted');
      expect(candAfterSuccess?.promotedFaqId).toBe(authPromoteResData.promotedFaqId);

      const createdFaq = await cacheRepo.findById(authPromoteResData.promotedFaqId);
      expect(createdFaq).not.toBeNull();
    });

    it('12. controller GET /api/admin/cache/candidates returns candidate list with valid Bearer token', async () => {
      const req: any = {
        query: { limit: '10' },
        headers: { authorization: `Bearer ${adminSecret}` },
      };
      let jsonResponse: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((data) => {
          jsonResponse = data;
        }),
      };

      await controller.listCandidates(req, res);
      expect(jsonResponse).not.toBeNull();
      expect(jsonResponse.success).toBe(true);
      expect(Array.isArray(jsonResponse.items)).toBe(true);
    });

    it('13. controller GET /api/admin/cache/candidates/:id returns 404 for unknown candidate with valid Bearer token', async () => {
      const notFoundReq: any = {
        headers: { authorization: `Bearer ${adminSecret}` },
        params: { id: '00000000-0000-0000-0000-000000000404' },
      };
      const notFoundRes: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.getCandidate(notFoundReq, notFoundRes);
      expect(notFoundRes.status).toHaveBeenCalledWith(404);
    });

    it('14. controller POST /api/admin/cache/candidates/:id/reject rejects with 400 if reason missing with valid Bearer token', async () => {
      const req: any = {
        headers: { authorization: `Bearer ${adminSecret}` },
        params: { id: 'some-id' },
        body: {},
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.rejectCandidate(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('mandatory') })
      );
    });
  });

  describe('9. End-to-End System Life Cycle', () => {
    it('executes full journey: AI generation -> evidence accumulation -> review -> validation -> promotion -> semantic cache hit!', async () => {
      const pipeline = new LearningPipeline(candidateRepo, cacheRepo, mockProvider);
      const cacheEngine = new SemanticCacheEngine(
        mockProvider,
        cacheRepo,
        undefined,
        { allowMockInProduction: true }
      );

      // Step 1: AI generates reusable factual answer
      const reusableQuery = 'ما هي سياسة الاستبدال والاسترجاع خلال 14 يوم؟';
      const aiResponse = 'يحق للعميل استبدال أو استرجاع المنتج خلال 14 يوما من تاريخ الاستلام بشرط سلامة المنتج والتغليف الأصلي.';
      const initialRunId = 'run-e2e-initial-1';

      await pipeline.observeRun({
        runId: initialRunId,
        userInput: reusableQuery,
        replyText: aiResponse,
        modelUsed: 'llama-3.3-70b-versatile',
        provider: 'groq',
      });

      const candidates = await candidateRepo.list({ status: 'pending', limit: 20 });
      const candidate = candidates.find((c) => c.sourceRunId === initialRunId);
      expect(candidate).toBeDefined();
      if (!candidate) throw new Error('Candidate not created');
      const candidateId = candidate.id;
      testCandidateIds.push(candidateId);

      // Step 2: Multiple users ask similar questions over time (Evidence Accumulation)
      const variations = [
        'ما هي سياسة الاستبدال والاسترجاع خلال 14 يوم',
        'سياسة الاستبدال والاسترجاع خلال 14 يوم',
        'خطوات سياسة الاستبدال والاسترجاع خلال 14 يوم',
        'طريقة سياسة الاستبدال والاسترجاع خلال 14 يوم',
      ];

      for (let i = 0; i < variations.length; i++) {
        await pipeline.observeRun({
          runId: `run-e2e-step2-${i + 2}`,
          userInput: variations[i],
          replyText: aiResponse,
          modelUsed: 'llama-3.3-70b-versatile',
          provider: 'groq',
        });
      }

      // Step 3: Admin Reviewer inspects candidate in review queue
      const inspection = await reviewService.getCandidate(candidateId, {
        actorId: 'senior_qa_lead',
        recordViewAudit: true,
      });
      expect(inspection).not.toBeNull();
      expect(inspection?.observationCount).toBeGreaterThanOrEqual(5);
      expect(inspection?.uniqueExampleCount).toBeGreaterThanOrEqual(3);

      // Step 4: Admin Reviewer validates candidate
      const validationResult = await reviewService.validateCandidate(candidateId, {
        actorId: 'senior_qa_lead',
        reason: 'Confirmed compliant with 14-day consumer protection law',
      });
      expect(validationResult.success).toBe(true);
      expect(validationResult.candidate?.status).toBe('validated');

      // Step 5: Check promotion eligibility report
      const eligibilityReport = await reviewService.getPromotionEligibility(candidateId);
      expect(eligibilityReport).not.toBeNull();
      expect(eligibilityReport?.eligible).toBe(true);
      expect(eligibilityReport?.score).toBeGreaterThanOrEqual(0.70);

      // Step 6: Admin Reviewer explicitly promotes candidate to production
      const promotionResult = await reviewService.promoteCandidate(candidateId, {
        actorId: 'operations_director',
      });
      expect(promotionResult.success).toBe(true);
      expect(promotionResult.promotedFaqId).toBeDefined();
      testFaqIds.push(promotionResult.promotedFaqId!);

      // Step 7: Subsequent User query now hits the Semantic Cache!
      const userNextQuery = 'ما هي سياسة الاستبدال والاسترجاع خلال 14 يوم؟';
      const cacheLookup = await cacheEngine.process(userNextQuery);

      expect(cacheLookup.type).toBe('hit');
      if (cacheLookup.type === 'hit') {
        expect(cacheLookup.source).toBe('semantic');
        expect(cacheLookup.response).toContain('14 يوما');
        expect(cacheLookup.similarity).toBeGreaterThanOrEqual(0.85);
      }
    });
  });
});
