import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { TemplateEngine } from '../src/modules/cache/template_engine';
import { isCacheEligible } from '../src/modules/cache/cache_safety';
import { MockEmbeddingProvider } from '../src/modules/cache/embedding/mock_embedding.provider';
import { SemanticCacheRepository } from '../src/database/repositories/semantic_cache.repo';
import { DatabaseManager } from '../src/database/connection';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';

describe('Phase 4: Semantic Cache Engine & Integration', () => {
  let db: DatabaseManager;
  let repo: SemanticCacheRepository;
  let mockProvider: MockEmbeddingProvider;
  let engine: SemanticCacheEngine;
  const createdItemIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseManager.getInstance();
    repo = new SemanticCacheRepository(db);
    mockProvider = new MockEmbeddingProvider(4); // 4-dim unit vectors for testing
    await repo.ensureSchema();

    engine = new SemanticCacheEngine(
      mockProvider,
      repo,
      TemplateEngine.getInstance(),
      { allowMockInProduction: true }
    );
  });

  afterAll(async () => {
    const pool = db.getPool();
    if (pool) {
      if (createdItemIds.length > 0) {
        await pool.query('DELETE FROM faq_items WHERE id = ANY($1)', [createdItemIds]);
      }
      // Clean up test user & conversation & messages generated during orchestrator test
      const testUser = await pool.query("SELECT id FROM users WHERE name = 'test_phase4_user'");
      if (testUser.rows.length > 0) {
        const userId = testUser.rows[0].id;
        const convs = await pool.query('SELECT id FROM conversations WHERE user_id = $1', [userId]);
        const convIds = convs.rows.map((r: any) => r.id);
        if (convIds.length > 0) {
          await pool.query('DELETE FROM messages WHERE conversation_id = ANY($1)', [convIds]);
          await pool.query('DELETE FROM conversations WHERE id = ANY($1)', [convIds]);
        }
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      }
      await pool.query("DELETE FROM semantic_cache_metrics_events");
    }
  });

  describe('1. Safety Gate Precedes Cache Lookup (Unsafe Queries Cannot Bypass Safety)', () => {
    it('blocks dynamic time query and returns miss to AI router', async () => {
      const res = await engine.process('الساعة كام دلوقتي؟');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('ineligible_dynamic');
      }
    });

    it('blocks current-price query and returns miss to AI router', async () => {
      const res = await engine.process('سعر الدولار اليوم كام؟');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('ineligible_search');
      }
    });

    it('blocks weather query from cache and returns miss to AI router', async () => {
      const res = await engine.process('الطقس اليوم عامل ايه؟');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('ineligible_search');
      }
    });

    it('blocks user-specific order/account query from cache and returns miss to AI router', async () => {
      const res = await engine.process('حالة طلبي ايه؟');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('ineligible_user_context');
      }
    });

    it('allows safe greeting query to pass safety gate', () => {
      const eligibility = isCacheEligible('السلام عليكم');
      expect(eligibility.eligible).toBe(true);
    });
  });

  describe('2. Strengthened Multi-Tier Deterministic Safety Architecture (Zero LLM)', () => {
    describe('Tier 1: Time & Date Variations (Arabic & English)', () => {
      it('rejects "الساعة كام؟"', () => {
        expect(isCacheEligible('الساعة كام؟').eligible).toBe(false);
        expect(isCacheEligible('الساعة كام؟').reason).toBe('ineligible_dynamic');
      });

      it('rejects "what time is it right now?"', () => {
        expect(isCacheEligible('what time is it right now?').eligible).toBe(false);
        expect(isCacheEligible('what time is it right now?').reason).toBe('ineligible_dynamic');
      });

      it('rejects "الوقت كام دلوقتي"', () => {
        expect(isCacheEligible('الوقت كام دلوقتي').eligible).toBe(false);
      });

      it('rejects "تاريخ اليوم ايه"', () => {
        expect(isCacheEligible('تاريخ اليوم ايه').eligible).toBe(false);
      });
    });

    describe('Tier 2: Currency, Gold, Exchange Rates Variations (Arabic & English)', () => {
      it('rejects "الدولار عامل كام النهارده؟"', () => {
        expect(isCacheEligible('الدولار عامل كام النهارده؟').eligible).toBe(false);
        expect(isCacheEligible('الدولار عامل كام النهارده؟').reason).toBe('ineligible_search');
      });

      it('rejects "ممكن أعرف سعر الدولار الحالي؟"', () => {
        expect(isCacheEligible('ممكن أعرف سعر الدولار الحالي؟').eligible).toBe(false);
        expect(isCacheEligible('ممكن أعرف سعر الدولار الحالي؟').reason).toBe('ineligible_search');
      });

      it('rejects "what\'s the current exchange rate?"', () => {
        expect(isCacheEligible("what's the current exchange rate?").eligible).toBe(false);
        expect(isCacheEligible("what's the current exchange rate?").reason).toBe('ineligible_search');
      });

      it('rejects "how much is the dollar right now?"', () => {
        expect(isCacheEligible('how much is the dollar right now?').eligible).toBe(false);
        expect(isCacheEligible('how much is the dollar right now?').reason).toBe('ineligible_search');
      });

      it('rejects "سعر الذهب اليوم عيار 21"', () => {
        expect(isCacheEligible('سعر الذهب اليوم عيار 21').eligible).toBe(false);
      });
    });

    describe('Tier 3: Weather Variations (Arabic & English)', () => {
      it('rejects "ممكن تقولي الجو عامل إيه؟"', () => {
        expect(isCacheEligible('ممكن تقولي الجو عامل إيه؟').eligible).toBe(false);
        expect(isCacheEligible('ممكن تقولي الجو عامل إيه؟').reason).toBe('ineligible_search');
      });

      it('rejects "what\'s the weather like right now?"', () => {
        expect(isCacheEligible("what's the weather like right now?").eligible).toBe(false);
        expect(isCacheEligible("what's the weather like right now?").reason).toBe('ineligible_search');
      });

      it('rejects "درجة الحرارة في القاهرة كام"', () => {
        expect(isCacheEligible('درجة الحرارة في القاهرة كام').eligible).toBe(false);
      });
    });

    describe('Tier 4 & 5: News & User-Specific State', () => {
      it('rejects "آخر الأخبار في مصر"', () => {
        expect(isCacheEligible('آخر الأخبار في مصر').eligible).toBe(false);
        expect(isCacheEligible('آخر الأخبار في مصر').reason).toBe('ineligible_search');
      });

      it('rejects "فكرني اشتري عيش بعد ساعة"', () => {
        expect(isCacheEligible('فكرني اشتري عيش بعد ساعة').eligible).toBe(false);
        expect(isCacheEligible('فكرني اشتري عيش بعد ساعة').reason).toBe('ineligible_user_context');
      });

      it('rejects "remind me to send the email at 3pm"', () => {
        expect(isCacheEligible('remind me to send the email at 3pm').eligible).toBe(false);
        expect(isCacheEligible('remind me to send the email at 3pm').reason).toBe('ineligible_user_context');
      });

      it('rejects "احسبلي 50 في 100"', () => {
        expect(isCacheEligible('احسبلي 50 في 100').eligible).toBe(false);
        expect(isCacheEligible('احسبلي 50 في 100').reason).toBe('ineligible_tool');
      });
    });

    describe('Safe / Informational Queries (Must be Eligible)', () => {
      it('permits "السلام عليكم"', () => {
        expect(isCacheEligible('السلام عليكم').eligible).toBe(true);
      });

      it('permits "مين اللي عملك"', () => {
        expect(isCacheEligible('مين اللي عملك').eligible).toBe(true);
      });

      it('permits "who made you?"', () => {
        expect(isCacheEligible('who made you?').eligible).toBe(true);
      });

      it('permits "ما هو كرافت"', () => {
        expect(isCacheEligible('ما هو كرافت').eligible).toBe(true);
      });

      it('permits "hello there"', () => {
        expect(isCacheEligible('hello there').eligible).toBe(true);
      });
    });
  });

  describe('3. Semantic Lookup & Item-Level Safety Flags', () => {
    let testSemanticItemId: string;
    let searchRequiredItemId: string;
    let userContextItemId: string;

    beforeAll(async () => {
      // 1. Regular cacheable semantic item
      // Embeddings: [1, 0, 0, 0]
      const item1 = await repo.create({
        intent: 'refund_policy_semantic',
        category: 'policies',
        title: 'سياسة الاسترجاع',
        examples: ['عايز ارجع المنتج', 'طريقة الاسترجاع'],
        response: 'يمكنك استرجاع المنتج خلال 14 يوماً من الاستلام.',
        confidenceThreshold: 0.80,
        isCacheable: true,
        embedding: [1, 0, 0, 0],
      });
      testSemanticItemId = item1.id;
      createdItemIds.push(testSemanticItemId);

      // 2. Item with requires_search = true
      const item2 = await repo.create({
        intent: 'realtime_stock_info',
        category: 'stock',
        title: 'فحص التوفر في المخزن',
        examples: ['هل المنتج متوفر في المخزن'],
        response: 'جاري فحص المخزن...',
        confidenceThreshold: 0.70,
        requiresSearch: true, // Safety flag
        embedding: [0, 1, 0, 0],
      });
      searchRequiredItemId = item2.id;
      createdItemIds.push(searchRequiredItemId);

      // 3. Item with requires_user_context = true
      const item3 = await repo.create({
        intent: 'user_active_orders',
        category: 'account',
        title: 'طلباتي الحالية',
        examples: ['طلبي فين دلوقتي'],
        response: 'طلبك قيد التجهيز.',
        confidenceThreshold: 0.70,
        requiresUserContext: true, // Safety flag
        embedding: [0, 0, 1, 0],
      });
      userContextItemId = item3.id;
      createdItemIds.push(userContextItemId);
    });

    it('matches semantic query when similarity meets threshold', async () => {
      const customProvider = {
        name: 'custom_mock',
        dimension: 4,
        embed: async () => [1, 0, 0, 0],
        embedBatch: async () => [[1, 0, 0, 0]],
      };
      const customEngine = new SemanticCacheEngine(customProvider, repo);

      const res = await customEngine.process('طريقة استرجاع الطلب المرفوض');
      expect(res.type).toBe('hit');
      if (res.type === 'hit') {
        expect(res.source).toBe('semantic');
        expect(res.intent).toBe('refund_policy_semantic');
        expect(res.similarity).toBeCloseTo(1.0, 2);
      }
    });

    it('returns miss when best match has requires_search = true', async () => {
      const customProvider = {
        name: 'custom_mock',
        dimension: 4,
        embed: async () => [0, 1, 0, 0],
        embedBatch: async () => [[0, 1, 0, 0]],
      };
      const customEngine = new SemanticCacheEngine(customProvider, repo);

      const res = await customEngine.process('كمية المنتج المتبقية في الفرع');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('ineligible_search');
      }
    });

    it('returns miss when best match has requires_user_context = true', async () => {
      const customProvider = {
        name: 'custom_mock',
        dimension: 4,
        embed: async () => [0, 0, 1, 0],
        embedBatch: async () => [[0, 0, 1, 0]],
      };
      const customEngine = new SemanticCacheEngine(customProvider, repo);

      const res = await customEngine.process('حالة الشحنة بتاعتي');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('ineligible_user_context');
      }
    });

    it('returns miss when similarity is below threshold', async () => {
      const customProvider = {
        name: 'custom_mock',
        dimension: 4,
        embed: async () => [0, 0, 0, 1],
        embedBatch: async () => [[0, 0, 0, 1]],
      };
      const customEngine = new SemanticCacheEngine(customProvider, repo);

      const res = await customEngine.process('استفسار غير متطابق أبداً');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('below_threshold');
      }
    });
  });

  describe('4. Multilingual Template Selection', () => {
    const templateEngine = TemplateEngine.getInstance();

    const sampleTemplates = {
      default: ['Universal default response'],
      ar: ['الرد باللغة العربية الفصحى'],
      en: ['Response in English language'],
      fr: ['Réponse en langue française'],
    };

    it('selects Arabic template for Arabic language input', () => {
      const selected = templateEngine.selectTemplate(sampleTemplates, 'ar', 'legacy');
      expect(selected).toBe('الرد باللغة العربية الفصحى');
    });

    it('selects English template for English language input', () => {
      const selected = templateEngine.selectTemplate(sampleTemplates, 'en', 'legacy');
      expect(selected).toBe('Response in English language');
    });

    it('falls back to default template for unconfigured language (e.g. German)', () => {
      const selected = templateEngine.selectTemplate(sampleTemplates, 'de', 'legacy');
      expect(selected).toBe('Universal default response');
    });

    it('falls back to legacy response if templates map is empty', () => {
      const selected = templateEngine.selectTemplate({}, 'es', 'Legacy fallback string');
      expect(selected).toBe('Legacy fallback string');
    });
  });

  describe('5. Response Strategies & Context Propagation', () => {
    const templateEngine = TemplateEngine.getInstance();

    it('strategy "static": returns template verbatim', () => {
      const res = templateEngine.render('static', 'سعر الاشتراك 100 جنيه.');
      expect(res.success).toBe(true);
      expect(res.text).toBe('سعر الاشتراك 100 جنيه.');
    });

    it('strategy "dynamic_template": populates {{user_name}} when provided in context', () => {
      const template = 'أهلاً بك يا {{user_name}} في منصة {{bot_name}}!';
      const res = templateEngine.render('dynamic_template', template, { userName: 'محمد علي' });
      expect(res.success).toBe(true);
      expect(res.text).toContain('أهلاً بك يا محمد علي في منصة كرافت (Craft)!');
    });

    it('strategy "dynamic_template": falls back politely when userName is omitted', () => {
      const template = 'أهلاً بك يا {{user_name}} في منصة {{bot_name}}!';
      const res = templateEngine.render('dynamic_template', template, {});
      expect(res.success).toBe(true);
      expect(res.text).toContain('أهلاً بك في منصة كرافت (Craft)!');
    });

    it('strategy "contextual_template": safely replaces channel and previousIntent', () => {
      const template = 'مرحباً عبر {{channel}}! استفسارك السابق: {{previous_intent}}.';
      const res = templateEngine.render('contextual_template', template, {
        channel: 'whatsapp',
        previousIntent: 'orders',
      });
      expect(res.success).toBe(true);
      expect(res.text).toBe('مرحباً عبر whatsapp! استفسارك السابق: orders.');
    });

    it('strategy "slot_based": succeeds when all required slots are present', () => {
      const template = 'سعر الشحن إلى مدينة {{city}} هو 35 جنيه.';
      const res = templateEngine.render('slot_based', template, {
        slots: { city: 'الإسكندرية' },
      });
      expect(res.success).toBe(true);
      expect(res.text).toBe('سعر الشحن إلى مدينة الإسكندرية هو 35 جنيه.');
    });

    it('strategy "slot_based": fails with missing_slot when slot is absent', () => {
      const template = 'سعر الشحن إلى مدينة {{city}} هو 35 جنيه.';
      const res = templateEngine.render('slot_based', template, { slots: {} });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('missing_slot_city');
    });

    it('strategy "ai_fallback": returns strategy_ai_fallback to route to AI router', () => {
      const res = templateEngine.render('ai_fallback', 'Some intent guide');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('strategy_ai_fallback');
    });
  });

  describe('6. Production Safety: Mock Provider Protection', () => {
    it('returns semantic_unavailable in production when using MockEmbeddingProvider', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const prodEngine = new SemanticCacheEngine(mockProvider, repo);
        const res = await prodEngine.process('سؤال غير موجود في الكاش الدقيق');
        expect(res.type).toBe('miss');
        if (res.type === 'miss') {
          expect(res.reason).toBe('semantic_unavailable');
        }
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('7. Failure & Resilience (Graceful Fallback to AI Router)', () => {
    it('recovers cleanly when embedding provider throws an error', async () => {
      const failingProvider = {
        name: 'failing_provider',
        dimension: 4,
        embed: async () => {
          throw new Error('Connection refused / 503 Service Unavailable');
        },
        embedBatch: async () => {
          throw new Error('503');
        },
      };
      const resilientEngine = new SemanticCacheEngine(failingProvider, repo);
      const res = await resilientEngine.process('سؤال دلالي أثناء عطل الـ Embedding');

      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('embedding_error');
      }
    });

    it('recovers cleanly when repository throws a database error', async () => {
      const brokenRepo: any = {
        findSimilar: async () => {
          throw new Error('Postgres connection pool exhausted');
        },
        recordHit: async () => {},
      };
      const resilientEngine = new SemanticCacheEngine(mockProvider, brokenRepo, undefined, {
        allowMockInProduction: true,
      });

      const res = await resilientEngine.process('سؤال دلالي أثناء عطل قاعدة البيانات');
      expect(res.type).toBe('miss');
      if (res.type === 'miss') {
        expect(res.reason).toBe('cache_engine_error');
      }
    });
  });

  describe('8. Orchestrator Step 0 End-to-End Verification with Context', () => {
    it('serves greeting via orchestrator with 0 tokens and model semantic-cache', async () => {
      const orchestrator = new AgentOrchestrator();
      const run = await orchestrator.run({
        userId: 'test_phase4_user',
        userName: 'محمد علي',
        channel: 'whatsapp',
        text: 'السلام عليكم',
      });

      expect(run.status).toBe('completed');
      expect(run.metrics?.totalTokens).toBe(0);
      expect(run.metrics?.modelUsed).toBe('semantic-cache');
      expect(run.replyText).toBeDefined();
      expect(run.metrics?.latencyMs).toBeLessThan(3000);
    });

    it('falls back to AI router when message is an AI task / dynamic question', async () => {
      const orchestrator = new AgentOrchestrator();
      const run = await orchestrator.run({
        userId: 'test_phase4_user',
        channel: 'whatsapp',
        text: 'الساعة كام دلوقتي؟', // Ineligible dynamic query intercepted by safety gate
      });

      expect(run.status).toBe('completed');
      // Should have passed through AI Router and executed tools or LLM
      expect(run.metrics?.modelUsed).not.toBe('semantic-cache');
      expect(run.replyText).toBeDefined();
    });
  });
});
