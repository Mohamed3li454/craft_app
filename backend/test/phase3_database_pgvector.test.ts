import { SemanticCacheRepository } from '../src/database/repositories/semantic_cache.repo';
import { FAQRepository } from '../src/database/repositories/faq.repo';
import { FAQCache } from '../src/modules/cache/faq_cache';
import { DatabaseManager } from '../src/database/connection';
import { CreateSemanticCacheDto, ResponseStrategy } from '../src/database/repositories/semantic_cache.types';

describe('Phase 3: Database Schema, pgvector & SemanticCacheRepository', () => {
  let repo: SemanticCacheRepository;
  let oldRepo: FAQRepository;
  let db: DatabaseManager;
  const createdTestIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseManager.getInstance();
    repo = new SemanticCacheRepository(db);
    oldRepo = new FAQRepository(db);
    // Run safe schema setup and migration
    await repo.ensureSchema();
  });

  afterAll(async () => {
    // Clean up all test records created
    const pool = db.getPool();
    if (pool && createdTestIds.length > 0) {
      await pool.query(`DELETE FROM faq_items WHERE id = ANY($1)`, [createdTestIds]);
    }
  });

  describe('1. Safe Migration & Schema Idempotency', () => {
    it('runs ensureSchema multiple times idempotently without throwing', async () => {
      await expect(repo.ensureSchema()).resolves.not.toThrow();
      await expect(repo.ensureSchema()).resolves.not.toThrow();
    });

    it('verifies all semantic columns exist on faq_items table', async () => {
      const pool = db.getPool();
      if (!pool) return;

      const res = await pool.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'faq_items';
      `);
      const cols = res.rows.map((r: any) => r.column_name);

      // Verify original columns preserved
      expect(cols).toContain('id');
      expect(cols).toContain('category');
      expect(cols).toContain('title');
      expect(cols).toContain('patterns');
      expect(cols).toContain('response');
      expect(cols).toContain('match_type');
      expect(cols).toContain('is_active');
      expect(cols).toContain('hit_count');

      // Verify new semantic columns
      expect(cols).toContain('intent');
      expect(cols).toContain('examples');
      expect(cols).toContain('response_strategy');
      expect(cols).toContain('response_templates');
      expect(cols).toContain('is_cacheable');
      expect(cols).toContain('is_dynamic');
      expect(cols).toContain('requires_search');
      expect(cols).toContain('requires_user_context');
      expect(cols).toContain('confidence_threshold');
      expect(cols).toContain('embedding');
      expect(cols).toContain('embedding_dimension');
      expect(cols).toContain('last_used_at');
    });

    it('preserves existing FAQ items and confirms language-neutral backfill logic', async () => {
      const items = await repo.getAll();
      expect(items.length).toBeGreaterThanOrEqual(5);

      const identityItem = items.find((i) => i.category === 'identity' || i.intent === 'identity');
      expect(identityItem).toBeDefined();
      expect(identityItem?.title).toBe('التعريف بـ كرافت');
      expect(identityItem?.intent).toBe('identity');
      expect(identityItem?.examples.length).toBeGreaterThan(0);
      expect(identityItem?.responseStrategy).toBe('dynamic_template');

      // Language-neutral backfill check: must have 'default'
      expect(identityItem?.responseTemplates).toBeDefined();
      expect(identityItem?.responseTemplates.default).toBeDefined();
      expect(identityItem?.responseTemplates.default[0]).toContain('كرافت');
      expect(identityItem?.isCacheable).toBe(true);
      expect(identityItem?.confidenceThreshold).toBe(0.88);
    });
  });

  describe('2. Response Strategy Contract', () => {
    it('supports all valid response strategies in the contract', async () => {
      const strategies: ResponseStrategy[] = [
        'static',
        'dynamic_template',
        'contextual_template',
        'slot_based',
        'ai_fallback',
      ];

      for (const strat of strategies) {
        const item = await repo.create({
          intent: `test_strat_${strat}`,
          category: 'strategy_test',
          title: `Strategy Test for ${strat}`,
          examples: [`test ${strat}`],
          response: `Verbatim response for ${strat}`,
          responseStrategy: strat,
          responseTemplates: {
            default: [`Verbatim response for ${strat}`],
          },
        });
        createdTestIds.push(item.id);

        expect(item.responseStrategy).toBe(strat);

        const fetched = await repo.findById(item.id);
        expect(fetched?.responseStrategy).toBe(strat);
      }
    });
  });

  describe('3. Confidence Threshold Semantics (Per-Entry Safety vs Global Query Floor)', () => {
    let highSafetyId: string;
    let standardSafetyId: string;

    beforeAll(async () => {
      // High-safety entry: e.g. sensitive query requiring similarity >= 0.95
      // Embedding: [1, 0, 0]
      const highSafety = await repo.create({
        intent: 'sensitive_payment_info',
        category: 'finance',
        title: 'Sensitive Financial Action',
        examples: ['تحويل بنكي'],
        response: 'يرجى تأكيد رقم الحساب بدقة.',
        confidenceThreshold: 0.95, // High safety requirement
        embedding: [1, 0, 0],
      });
      highSafetyId = highSafety.id;
      createdTestIds.push(highSafetyId);

      // Standard entry: confidence_threshold = 0.85
      // Embedding: [0.88, 0.4749, 0] -> unit vector near [1, 0, 0] with cos sim = 0.88
      const standard = await repo.create({
        intent: 'general_faq_info',
        category: 'general',
        title: 'General Info',
        examples: ['معلومات عامة'],
        response: 'معلومات عامة.',
        confidenceThreshold: 0.85,
        embedding: [0.88, 0.4749, 0],
      });
      standardSafetyId = standard.id;
      createdTestIds.push(standardSafetyId);
    });

    it('enforces per-entry threshold when caller passes no global threshold (null/undefined)', async () => {
      // Query vector [0.90, 0.4358, 0] -> cos sim to highSafety is 0.90, cos sim to standard is ~0.99
      const queryVec = [0.9, 0.4358, 0];
      const matches = await repo.findSimilar(queryVec, { category: 'finance' });

      // highSafety has similarity 0.90, but requires 0.95 -> MUST NOT MATCH
      const matchIds = matches.map((m) => m.item.id);
      expect(matchIds).not.toContain(highSafetyId);
    });

    it('prevents a permissive global threshold from bypassing the per-entry safety threshold', async () => {
      // Caller asks with permissive threshold = 0.70
      // Query vector [0.90, 0.4358, 0] -> cos sim to highSafety is 0.90 (< 0.95 safety threshold)
      const queryVec = [0.9, 0.4358, 0];
      const matches = await repo.findSimilar(queryVec, { threshold: 0.70, category: 'finance' });

      // The per-entry threshold (0.95) must NOT be bypassed by the permissive 0.70 global floor!
      const matchIds = matches.map((m) => m.item.id);
      expect(matchIds).not.toContain(highSafetyId);
    });

    it('applies a stricter global threshold when caller demands higher confidence', async () => {
      // standardSafety has threshold 0.85.
      // Query vector [0.95, 0.3122, 0] has cos sim to standard ~ 0.984
      // If caller sets threshold = 0.99 (stricter than standard's 0.85):
      const queryVec = [0.95, 0.3122, 0];
      const strictMatches = await repo.findSimilar(queryVec, { threshold: 0.99, category: 'general' });
      expect(strictMatches).toHaveLength(0);

      // But with normal threshold (e.g. 0.85), it matches
      const normalMatches = await repo.findSimilar(queryVec, { threshold: 0.85, category: 'general' });
      expect(normalMatches.length).toBeGreaterThan(0);
      expect(normalMatches[0].item.id).toBe(standardSafetyId);
    });

    it('strictly excludes any similarity below the effective threshold', async () => {
      // Completely orthogonal vector [0, 1, 0] -> similarity = 0
      const matches = await repo.findSimilar([0, 1, 0]);
      const financeOrGeneral = matches.filter((m) => m.item.category === 'finance' || m.item.category === 'general');
      expect(financeOrGeneral).toHaveLength(0);
    });
  });

  describe('4. SemanticCacheRepository CRUD Operations', () => {
    let testItemId: string;

    it('inserts a new semantic cache item with embedding and metadata', async () => {
      const dto: CreateSemanticCacheDto = {
        intent: 'shipping_policy',
        category: 'ecommerce',
        title: 'سياسة الشحن والتوصيل',
        examples: ['امتى بيوصل الطلب', 'مدة التوصيل كام يوم', 'تكلفة الشحن'],
        patterns: ['مدة التوصيل', 'الشحن كام'],
        response: 'مدة التوصيل من يومين إلى 4 أيام عمل لجميع المحافظات.',
        responseStrategy: 'dynamic_template',
        responseTemplates: {
          default: ['مدة التوصيل من يومين إلى 4 أيام عمل لجميع المحافظات.'],
          ar: [
            'مدة التوصيل من يومين إلى 4 أيام عمل لجميع المحافظات.',
            'التوصيل بيستغرق من 2 لـ 4 أيام عمل يا فندم.',
          ],
          en: ['Delivery takes 2-4 business days nationwide.'],
        },
        confidenceThreshold: 0.85,
        isCacheable: true,
        isDynamic: false,
        requiresSearch: false,
        requiresUserContext: false,
        embedding: [0.1, 0.2, 0.3, 0.4],
      };

      const created = await repo.create(dto);
      expect(created.id).toBeDefined();
      createdTestIds.push(created.id);
      testItemId = created.id;

      expect(created.intent).toBe('shipping_policy');
      expect(created.category).toBe('ecommerce');
      expect(created.responseStrategy).toBe('dynamic_template');
      expect(created.responseTemplates.en[0]).toBe('Delivery takes 2-4 business days nationwide.');
      expect(created.responseTemplates.default[0]).toBe('مدة التوصيل من يومين إلى 4 أيام عمل لجميع المحافظات.');
      expect(created.confidenceThreshold).toBe(0.85);
      expect(created.embeddingDimension).toBe(4);
      expect(created.embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(created.hitCount).toBe(0);
      expect(created.lastUsedAt).toBeNull();
    });

    it('retrieves item by id and intent', async () => {
      const byId = await repo.findById(testItemId);
      expect(byId).not.toBeNull();
      expect(byId?.id).toBe(testItemId);
      expect(byId?.intent).toBe('shipping_policy');

      const byIntent = await repo.findByIntent('shipping_policy');
      expect(byIntent).not.toBeNull();
      expect(byIntent?.id).toBe(testItemId);
    });

    it('updates fields including response templates and flags', async () => {
      const updated = await repo.update(testItemId, {
        title: 'سياسة الشحن المحدثة',
        isDynamic: true,
        confidenceThreshold: 0.90,
      });

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('سياسة الشحن المحدثة');
      expect(updated?.isDynamic).toBe(true);
      expect(updated?.confidenceThreshold).toBe(0.90);
    });

    it('updates embedding vector targetedly using updateEmbedding', async () => {
      const success = await repo.updateEmbedding(testItemId, [0.5, 0.6, 0.7, 0.8]);
      expect(success).toBe(true);

      const refreshed = await repo.findById(testItemId);
      expect(refreshed?.embedding).toEqual([0.5, 0.6, 0.7, 0.8]);
      expect(refreshed?.embeddingDimension).toBe(4);
    });

    it('records cache hit and updates last_used_at', async () => {
      const before = await repo.findById(testItemId);
      const hitBefore = before?.hitCount || 0;

      await repo.recordHit(testItemId);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const after = await repo.findById(testItemId);
      expect(after?.hitCount).toBe(hitBefore + 1);
      expect(after?.lastUsedAt).not.toBeNull();
    });

    it('deletes item cleanly', async () => {
      const deleted = await repo.delete(testItemId);
      expect(deleted).toBe(true);

      const check = await repo.findById(testItemId);
      expect(check).toBeNull();
    });
  });

  describe('5. pgvector Storage & Ranking', () => {
    let idA: string;
    let idB: string;

    beforeAll(async () => {
      const itemA = await repo.create({
        intent: 'geo_vector_a',
        category: 'geometry_rank',
        title: 'Vector A',
        examples: ['Example A'],
        response: 'Response A',
        confidenceThreshold: 0.75,
        embedding: [1, 0, 0],
      });
      idA = itemA.id;
      createdTestIds.push(idA);

      const itemB = await repo.create({
        intent: 'geo_vector_b',
        category: 'geometry_rank',
        title: 'Vector B',
        examples: ['Example B'],
        response: 'Response B',
        confidenceThreshold: 0.75,
        embedding: [0.8, 0.6, 0],
      });
      idB = itemB.id;
      createdTestIds.push(idB);
    });

    it('ranks matches in descending order of cosine similarity', async () => {
      const matches = await repo.findSimilar([1, 0, 0], { threshold: 0.5, limit: 5, category: 'geometry_rank' });

      expect(matches).toHaveLength(2);
      expect(matches[0].item.id).toBe(idA);
      expect(matches[0].similarity).toBeCloseTo(1.0, 3);

      expect(matches[1].item.id).toBe(idB);
      expect(matches[1].similarity).toBeCloseTo(0.8, 3);
    });
  });

  describe('6. Vector Dimension Validation & Safety', () => {
    it('throws error when vector is empty or invalid', async () => {
      await expect(repo.findSimilar([])).rejects.toThrow('Vector must be a non-empty array of numbers');
      await expect(repo.findSimilar([1, NaN, 3])).rejects.toThrow('Vector contains invalid element at index 1');
      await expect(repo.findSimilar([1, Infinity, 3])).rejects.toThrow('Vector contains invalid element at index 1');
    });

    it('filters out mismatched dimensions safely without database errors', async () => {
      const matches = await repo.findSimilar([0.1, 0.2, 0.3, 0.4, 0.5], { threshold: 0.5 });
      const geometryMatches = matches.filter((m) => m.item.category === 'geometry_rank');
      expect(geometryMatches).toHaveLength(0);
    });
  });

  describe('7. Security DEFINER, Permissions & Client Lock Down', () => {
    it('confirms RLS is enabled on faq_items table', async () => {
      const pool = db.getPool();
      if (!pool) return;

      const res = await pool.query(`
        SELECT relname, relrowsecurity
        FROM pg_class
        WHERE relname = 'faq_items';
      `);
      expect(res.rows[0].relrowsecurity).toBe(true);
    });

    it('stored procedure match_semantic_cache is defined with SECURITY DEFINER and search_path=public', async () => {
      const pool = db.getPool();
      if (!pool) return;

      const res = await pool.query(`
        SELECT proname, prosecdef, proconfig
        FROM pg_proc
        WHERE proname = 'match_semantic_cache';
      `);
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows[0].prosecdef).toBe(true);
      expect(res.rows[0].proconfig).toEqual(expect.arrayContaining(['search_path=public']));
    });

    it('verifies PUBLIC, anon, and authenticated roles CANNOT execute match_semantic_cache', async () => {
      const pool = db.getPool();
      if (!pool) return;

      const res = await pool.query(`
        SELECT grantee, privilege_type
        FROM information_schema.routine_privileges
        WHERE routine_schema = 'public' 
          AND routine_name = 'match_semantic_cache'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated');
      `);
      // Must be empty: no client roles have EXECUTE permissions!
      expect(res.rows).toHaveLength(0);
    });

    it('verifies ONLY server-side roles (postgres / service_role) have EXECUTE permissions', async () => {
      const pool = db.getPool();
      if (!pool) return;

      const res = await pool.query(`
        SELECT grantee, privilege_type
        FROM information_schema.routine_privileges
        WHERE routine_schema = 'public' 
          AND routine_name = 'match_semantic_cache'
          AND grantee IN ('postgres', 'service_role');
      `);
      const grantees = res.rows.map((r: any) => r.grantee);
      expect(grantees).toContain('postgres');
      expect(grantees).toContain('service_role');
    });
  });

  describe('8. Backward Compatibility with Existing FAQ Subsystem', () => {
    it('FAQRepository.getAll() continues to read items cleanly', async () => {
      const oldItems = await oldRepo.getAll();
      expect(oldItems.length).toBeGreaterThanOrEqual(5);
      const greeting = oldItems.find((i) => i.category === 'greetings');
      expect(greeting).toBeDefined();
      expect(greeting?.matchType).toBe('exact');
      expect(greeting?.patterns.length).toBeGreaterThan(5);
    });

    it('FAQCache in-memory match continues to perform instant matching', () => {
      const cache = FAQCache.getInstance();
      const res = cache.match('السلام عليكم');
      expect(res.matched).toBe(true);
      expect(res.intent).toBe('greetings');
    });
  });
});
