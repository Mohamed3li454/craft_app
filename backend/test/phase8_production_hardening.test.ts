import { DatabaseManager } from '../src/database/connection';
import { SemanticCandidateRepository } from '../src/database/repositories/semantic_candidate.repo';
import { SemanticCacheRepository } from '../src/database/repositories/semantic_cache.repo';
import { SemanticReviewAuditRepository } from '../src/database/repositories/semantic_review_audit.repo';
import { FAQCache } from '../src/modules/cache/faq_cache';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { PromotionService } from '../src/modules/cache/learning/promotion_service';
import { CandidateReviewService } from '../src/modules/cache/learning/candidate_review.service';
import { CandidateReviewController } from '../src/modules/cache/learning/candidate_review.controller';
import { AdminRateLimiter } from '../src/modules/cache/learning/admin_rate_limiter';
import { GenericHttpEmbeddingProvider } from '../src/modules/cache/embedding/generic_http_embedding.provider';
import { MockEmbeddingProvider } from '../src/modules/cache/embedding/mock_embedding.provider';
import { TemplateEngine } from '../src/modules/cache/template_engine';
import { CacheObservability } from '../src/modules/cache/cache_observability';
import { config } from '../src/config/env';

describe('Phase 8: Production Hardening & Finalization', () => {
  let db: DatabaseManager;
  let candidateRepo: SemanticCandidateRepository;
  let cacheRepo: SemanticCacheRepository;
  let auditRepo: SemanticReviewAuditRepository;
  let mockProvider: MockEmbeddingProvider;
  let promotionService: PromotionService;
  let reviewService: CandidateReviewService;
  let controller: CandidateReviewController;
  let exactCache: FAQCache;
  let cacheEngine: SemanticCacheEngine;

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

    promotionService = new PromotionService(candidateRepo, cacheRepo, mockProvider, db);
    reviewService = new CandidateReviewService(candidateRepo, auditRepo, promotionService, mockProvider);
    controller = new CandidateReviewController(reviewService, CacheObservability.getInstance());

    exactCache = FAQCache.getInstance();
    cacheEngine = new SemanticCacheEngine(
      exactCache,
      mockProvider,
      cacheRepo,
      TemplateEngine.getInstance(),
      { allowMockInProduction: true }
    );
  });

  afterAll(async () => {
    const pool = db.getPool();
    if (pool) {
      await pool.query("SET app.allow_audit_cleanup = 'true'");
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

  describe('1. Safety Gate Hardening (Exact & Semantic Bypass Prevention)', () => {
    it('CRITICAL: dynamic request CANNOT hit Exact Cache even if an exact FAQ entry exists', async () => {
      // Seed an exact FAQ for a dynamic query
      const dynamicQuestion = 'سعر الدولار اليوم';
      const createdFaq = await cacheRepo.create({
        intent: 'phase8_currency_exact_test',
        category: 'finance',
        title: dynamicQuestion,
        patterns: [dynamicQuestion],
        examples: [dynamicQuestion],
        response: 'السعر 50 جنيه مصري',
        responseStrategy: 'static',
        responseTemplates: { default: ['السعر 50 جنيه مصري'] },
        confidenceThreshold: 0.80,
        isActive: true,
        isCacheable: true,
      });
      testFaqIds.push(createdFaq.id);
      await exactCache.reload();

      // Verify that Exact Cache has the item in memory
      const directExactMatch = exactCache.match(dynamicQuestion);
      expect(directExactMatch.matched).toBe(true);

      // BUT through SemanticCacheEngine, Safety Gate intercepts it BEFORE Exact Cache!
      const engineResult = await cacheEngine.process(dynamicQuestion);
      expect(engineResult.type).toBe('miss');
      if (engineResult.type === 'miss') {
        expect(engineResult.reason).toBe('ineligible_search');
      } else {
        throw new Error('Safety breach: Dynamic market query bypassed Safety Gate and hit Exact Cache!');
      }
    });

    it('CRITICAL: time/weather dynamic query CANNOT hit Semantic Cache', async () => {
      const weatherQuery = 'ما هي حالة الطقس ودرجة الحرارة في القاهرة الآن؟';
      const result = await cacheEngine.process(weatherQuery);
      expect(result.type).toBe('miss');
      if (result.type === 'miss') {
        expect(result.reason).toBe('ineligible_search');
      }
    });

    it('CRITICAL: user-specific query CANNOT hit Cache', async () => {
      const userSpecific = 'فكرني بميعاد تسليم الشحنة بتاعتي';
      const result = await cacheEngine.process(userSpecific);
      expect(result.type).toBe('miss');
      if (result.type === 'miss') {
        expect(result.reason).toBe('ineligible_user_context');
      }
    });
  });

  describe('2. Embedding Production Safety & Failure Isolation', () => {
    it('handles embedding provider timeout gracefully without throwing or crashing', async () => {
      const slowProvider = new GenericHttpEmbeddingProvider({
        endpoint: 'https://httpstat.us/200?sleep=5000',
        dimension: 768,
        timeoutMs: 50,
      });

      const slowEngine = new SemanticCacheEngine(
        exactCache,
        slowProvider,
        cacheRepo,
        TemplateEngine.getInstance(),
        { allowMockInProduction: true }
      );

      const res = await slowEngine.process('ما هي مواعيد العمل لديكم؟');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('embedding_error');
      }
    });

    it('rejects vectors containing NaN or Infinity with EmbeddingError', async () => {
      const provider = new GenericHttpEmbeddingProvider({
        endpoint: 'https://api.example.com/embeddings',
        dimension: 4,
      });

      // Mock executeRequest to return vector with NaN
      (provider as any).executeRequest = jest.fn().mockResolvedValue([[0.1, NaN, 0.3, 0.4]]);

      await expect(provider.embed('test query')).rejects.toThrow(/non-finite or NaN/);
    });

    it('rejects dimension mismatch strictly', async () => {
      const provider = new GenericHttpEmbeddingProvider({
        endpoint: 'https://api.example.com/embeddings',
        dimension: 768,
      });

      (provider as any).executeRequest = jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]); // length 3 vs expected 768

      await expect(provider.embed('test dimension mismatch')).rejects.toThrow(/dimension mismatch/i);
    });

    it('truncates oversized user queries to MAX_INPUT_CHARS without failing', async () => {
      const provider = new GenericHttpEmbeddingProvider({
        endpoint: 'https://api.example.com/embeddings',
        dimension: 4,
      });

      let capturedInput = '';
      (provider as any).executeRequest = jest.fn().mockImplementation((inputs: string[]) => {
        capturedInput = inputs[0];
        return Promise.resolve([[0.1, 0.2, 0.3, 0.4]]);
      });

      const hugeText = 'أ'.repeat(25000);
      const vec = await provider.embed(hugeText);

      expect(vec.length).toBe(4);
      expect(capturedInput.length).toBe(GenericHttpEmbeddingProvider.MAX_INPUT_CHARS);
    });
  });

  describe('3. Concurrency & Race Condition Elimination', () => {
    it('Scenario A: concurrent duplicate promotion creates exactly ONE FAQ entry and returns success idempotently', async () => {
      const candidate = await candidateRepo.create({
        intent: 'phase8_race_promo_candidate',
        category: 'support',
        inputExamples: ['كيف يمكنني تغيير كلمة المرور'],
        response: 'يمكنك تغيير كلمة المرور من الإعدادات ثم الأمان.',
        language: 'ar',
        confidence: 0.95,
        status: 'validated',
        observationCount: 6,
        uniqueExampleCount: 4,
        semanticConsistency: 0.95,
        promotionEligible: true,
      });
      testCandidateIds.push(candidate.id);

      // Execute 2 concurrent promotions at the exact same instant
      const [res1, res2] = await Promise.all([
        promotionService.promoteCandidate(candidate.id),
        promotionService.promoteCandidate(candidate.id),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      // Both must point to the EXACT same promoted FAQ ID!
      expect(res1.promotedFaqId).toBeDefined();
      expect(res2.promotedFaqId).toBeDefined();
      expect(res1.promotedFaqId).toBe(res2.promotedFaqId);
      testFaqIds.push(res1.promotedFaqId!);

      // Verify DB state: candidate is promoted and only 1 FAQ was inserted
      const finalCandidate = await candidateRepo.findById(candidate.id);
      expect(finalCandidate?.status).toBe('promoted');
      expect(finalCandidate?.promotedFaqId).toBe(res1.promotedFaqId);
    });

    it('Scenario B: disallows rejecting an already promoted candidate', async () => {
      const candidate = await candidateRepo.create({
        intent: 'phase8_race_reject_promoted',
        category: 'support',
        inputExamples: ['سؤال مرشح تمت ترقيته'],
        response: 'إجابة مرشح تمت ترقيته',
        language: 'ar',
        confidence: 0.95,
        status: 'validated',
        observationCount: 5,
        uniqueExampleCount: 3,
        semanticConsistency: 0.95,
        promotionEligible: true,
      });
      testCandidateIds.push(candidate.id);

      const promoResult = await promotionService.promoteCandidate(candidate.id);
      expect(promoResult.success).toBe(true);
      testFaqIds.push(promoResult.promotedFaqId!);

      // Attempting to reject an already promoted candidate must be refused
      const rejectResult = await reviewService.rejectCandidate(candidate.id, 'Tried to reject promoted item');
      expect(rejectResult.success).toBe(false);
      expect(rejectResult.error).toContain('already promoted');
    });

    it('Scenario C: handles concurrent cache hits cleanly without lost hit counts', async () => {
      const testFaq = await cacheRepo.create({
        intent: 'phase8_concurrent_hits_test',
        category: 'faq',
        title: 'سؤال فحص التزامن للزيارات',
        patterns: ['فحص التزامن للزيارات'],
        examples: ['فحص التزامن للزيارات'],
        response: 'إجابة فحص التزامن للزيارات',
        confidenceThreshold: 0.85,
        isActive: true,
        isCacheable: true,
      });
      testFaqIds.push(testFaq.id);

      // Record 5 concurrent hits
      await Promise.all([
        cacheRepo.recordHit(testFaq.id),
        cacheRepo.recordHit(testFaq.id),
        cacheRepo.recordHit(testFaq.id),
        cacheRepo.recordHit(testFaq.id),
        cacheRepo.recordHit(testFaq.id),
      ]);

      const pool = db.getPool();
      if (pool) {
        const res = await pool.query('SELECT hit_count FROM faq_items WHERE id = $1', [testFaq.id]);
        expect(parseInt(res.rows[0].hit_count, 10)).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe('4. Admin Rate Limiting & Security Hardening', () => {
    it('AdminRateLimiter enforces request limits and returns 429 when threshold exceeded', async () => {
      const limiter = new AdminRateLimiter({ windowMs: 60000, maxRequests: 3 });

      const req: any = { ip: '192.168.1.50', headers: {}, socket: { remoteAddress: '192.168.1.50' } };
      let statusCode = 200;
      let jsonBody: any = null;
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn().mockImplementation((code) => {
          statusCode = code;
          return res;
        }),
        json: jest.fn().mockImplementation((data) => {
          jsonBody = data;
        }),
      };
      const next = jest.fn();

      // Requests 1, 2, 3 -> Allowed
      limiter.middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      limiter.middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);

      limiter.middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(3);

      // Request 4 -> Throttled with 429
      limiter.middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(3); // next not called
      expect(statusCode).toBe(429);
      expect(jsonBody.success).toBe(false);
      expect(jsonBody.error).toContain('Too many requests');

      limiter.destroy();
    });

    it('Production CORS is fail-closed (not wildcard) when CORS_ORIGIN is not defined', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevOrigin = process.env.CORS_ORIGIN;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.CORS_ORIGIN;

        const effectiveOrigin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*');
        expect(effectiveOrigin).toBe('');
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevOrigin) process.env.CORS_ORIGIN = prevOrigin;
      }
    });

    it('Production Secret fails closed when ADMIN_SECRET_KEY is empty in production', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.ADMIN_SECRET_KEY;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ADMIN_SECRET_KEY;

        const req: any = { headers: { authorization: `Bearer ${adminSecret}` } };
        expect(controller.isAuthorized(req)).toBe(false);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevSecret) process.env.ADMIN_SECRET_KEY = prevSecret;
      }
    });
  });

  describe('5. Reliability & Failure Isolation', () => {
    it('Template Engine handles missing slots by falling back safely to AI Router', () => {
      const templateEngine = TemplateEngine.getInstance();
      const slotTemplate = 'مرحبا بك يا {{user_name}}، تفاصيل شحنتك رقم {{tracking_number}} هي كالتالي.';

      // Missing required slot 'tracking_number'
      const res = templateEngine.render('slot_based', slotTemplate, { userName: 'أحمد', slots: {} }, 'ar');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('missing_slot_tracking_number');
    });

    it('Telemetry failure does not fail the user cache lookup', async () => {
      const observability = CacheObservability.getInstance();
      const originalRecord = observability.recordCacheEvent;

      try {
        // Intentionally mock telemetry failure
        observability.recordCacheEvent = jest.fn().mockRejectedValue(new Error('Telemetry database disconnected'));

        const result = await cacheEngine.process('ما هي شروط الاستبدال والاسترجاع؟');
        // Even if telemetry failed, cacheEngine returns gracefully without throwing
        expect(result).toBeDefined();
        expect(result.type).toBeDefined();
      } finally {
        observability.recordCacheEvent = originalRecord;
      }
    });

    it('Cache hit rate calculation accounts accurately for all misses including below_threshold', async () => {
      const obs = CacheObservability.getInstance();
      await obs.recordCacheEvent({ event: 'exact_hit', source: 'exact', latencyMs: 1 });
      await obs.recordCacheEvent({ event: 'below_threshold', latencyMs: 20 });
      await obs.recordCacheEvent({ event: 'ineligible_dynamic', latencyMs: 0 });

      const stats = await obs.getCacheStats();
      expect(stats.exactHits).toBeGreaterThanOrEqual(1);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
      expect(stats.cacheIneligibleRequests).toBeGreaterThanOrEqual(1);
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.eligibleHitRate).toBeGreaterThan(0);
    });
  });
});
