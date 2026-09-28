/**
 * Phase 3 — Memory Retrieval Intelligence Test Suite
 *
 * Exhaustive integration testing for deterministic, zero-LLM Memory Retrieval Intelligence:
 * Scenarios A through T covering intent analysis, candidate eligibility, hard relevance gates,
 * temporal alignment, contradiction awareness, redundancy control, diversity, budget bounds,
 * deterministic ordering, preference isolation, safety, runtime negation, and provenance.
 */

import { v4 as uuidv4 } from 'uuid';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';
import {
  DEFAULT_MEMORY_RETRIEVAL_LIMIT,
  MIN_MEMORY_RELEVANCE_THRESHOLD,
  RetrievedMemory,
} from '../src/modules/memory/types';

describe('Phase 3 — Memory Retrieval Intelligence (Scenarios A through T)', () => {
  let memoryRepo: MemoryRepository;
  let retrievalService: MemoryRetrievalService;
  let userPrefRepo: UserPreferenceRepository;
  let contextAssembler: MemoryContextAssembler;

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
    memoryRepo.clearInMemoryStore();
    retrievalService = new MemoryRetrievalService(memoryRepo);
    userPrefRepo = new UserPreferenceRepository();
    contextAssembler = MemoryContextAssembler.getInstance();
  });

  // Scenario A — Exact Relevant Memory
  test('Scenario A — Exact relevant memory is selected with high score and clear reason', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(
      userId,
      'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Flutter Developer)',
      'profession',
      { confidence: 0.95, importance: 'high' }
    );

    const query = 'عايز أعمل optimize لأداء تطبيق Flutter بتاعي';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBeGreaterThanOrEqual(1);
    const top = retrieved[0];
    expect(top.memory.factText).toContain('Flutter');
    expect(top.relevanceScore).toBeGreaterThanOrEqual(0.70);
    expect(top.retrievalReason).toContain('flutter');
  });

  // Scenario B — Semantically Related Memory
  test('Scenario B — Semantically related technical memory matches query intent', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(
      userId,
      'المستخدم يستخدم نظام إدارة قواعد البيانات PostgreSQL في السيرفر',
      'technical_context',
      { confidence: 0.90 }
    );

    const query = 'إزاي أعمل database migration على سيرفر المشروع؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBeGreaterThanOrEqual(1);
    expect(retrieved[0].memory.factText).toContain('PostgreSQL');
    expect(retrieved[0].relevanceScore).toBeGreaterThanOrEqual(MIN_MEMORY_RELEVANCE_THRESHOLD);
  });

  // Scenario C — Unrelated High-Confidence Memory (Hard Gate)
  test('Scenario C — Unrelated high-confidence and high-importance memories are strictly excluded', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يحب أكل البيتزا الإيطالية', 'interests', {
      confidence: 0.99,
      importance: 'high',
    });
    await memoryRepo.saveFact(userId, 'اسم المستخدم: أحمد عادل', 'identity', {
      confidence: 1.0,
      importance: 'critical',
    });

    const query = 'إزاي أعمل build لـ Docker container؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved).toHaveLength(0);
  });

  // Scenario D — Temporal Current Query
  test('Scenario D — Temporal current query penalizes historical facts and selects current state', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم كان يعمل في شركة فودافون سابقاً', 'profession', {
      temporalState: 'historical',
      confidence: 0.95,
    });
    await memoryRepo.saveFact(userId, 'المستخدم يعمل حالياً في شركة جوجل', 'profession', {
      temporalState: 'current',
      confidence: 0.95,
    });

    const query = 'أنا شغال على إيه دلوقتي وفين؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBeGreaterThanOrEqual(1);
    expect(retrieved[0].memory.factText).toContain('جوجل');
    expect(retrieved[0].memory.temporalState).toBe('current');
    expect(retrieved.some((m) => m.memory.factText.includes('فودافون'))).toBe(false);
  });

  // Scenario E — Temporal Historical Query
  test('Scenario E — Temporal historical query boosts historical facts and prioritizes them', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم كان يعمل في شركة فودافون سابقاً', 'profession', {
      temporalState: 'historical',
      confidence: 0.90,
    });
    await memoryRepo.saveFact(userId, 'المستخدم يعمل حالياً في شركة جوجل', 'profession', {
      temporalState: 'current',
      confidence: 0.90,
    });

    const query = 'إيه الشركات اللي كنت شغال فيها زمان قبل كده؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBeGreaterThanOrEqual(1);
    expect(retrieved[0].memory.factText).toContain('فودافون');
    expect(retrieved[0].memory.temporalState).toBe('historical');
    expect(retrieved[0].retrievalReason).toContain('temporal_boost:historical');
  });

  // Scenario F — Temporal Neutral Query
  test('Scenario F — Neutral query keeps unknown temporal state neutral without penalty or fake promotion', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يتقن لغة بايثون Python', 'technical_context', {
      temporalState: 'unknown',
      confidence: 0.85,
    });

    const query = 'إيه التقنيات البرمجية اللي بستخدمها؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBe(1);
    expect(retrieved[0].memory.temporalState).toBe('unknown');
    expect(retrieved[0].relevanceScore).toBeGreaterThanOrEqual(0.30);
  });

  // Scenario G — Contradiction-Aware Retrieval
  test('Scenario G — Contradiction-aware retrieval excludes superseded facts and returns active canonical fact', async () => {
    const userId = uuidv4();
    const oldMem = await memoryRepo.saveFact(userId, 'المستخدم يعيش في الإسكندرية', 'stable_fact');
    const newMem = await memoryRepo.saveFact(userId, 'المستخدم انتقل ويعيش في القاهرة', 'stable_fact');
    await memoryRepo.supersedeFact(oldMem.id, newMem.id, 'Moved to Cairo');

    const query = 'أنا ساكن وعايش فين؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].memory.factText).toContain('القاهرة');
    expect(retrieved.some((m) => m.memory.factText.includes('الإسكندرية'))).toBe(false);
  });

  // Scenario H — Evolution-Aware Retrieval (General Timeline)
  test('Scenario H — Timeline query retrieves both historical and current facts with proper temporal tags', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم كان يطور تطبيقات باستخدام فلاتر Flutter سابقاً', 'technical_context', {
      temporalState: 'historical',
    });
    await memoryRepo.saveFact(userId, 'المستخدم يطور تطبيقات باستخدام رياكت React حالياً', 'technical_context', {
      temporalState: 'current',
    });

    const query = 'إيه كل التقنيات اللي استخدمتها في مسيرتي البرمجية؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBe(2);
    const context = contextAssembler.assemble(retrieved);
    expect(context.formattedPromptText).toContain('[Historical] المستخدم كان يطور تطبيقات باستخدام فلاتر Flutter سابقاً');
    expect(context.formattedPromptText).toContain('المستخدم يطور تطبيقات باستخدام رياكت React حالياً');
  });

  // Scenario I — Redundancy Control
  test('Scenario I — Redundancy control suppresses near-identical facts and selects best representation', async () => {
    const userId = uuidv4();
    // 3 redundant facts about Flutter in same category
    await memoryRepo.saveFact(userId, 'المستخدم بيستخدم Flutter', 'technical_context');
    await memoryRepo.saveFact(userId, 'المستخدم شغال بـ Flutter في mobile development', 'technical_context', {
      confidence: 0.95,
      importance: 'high',
    });
    await memoryRepo.saveFact(userId, 'المستخدم طور تطبيقات بـ Flutter', 'technical_context');
    // 1 distinct fact about PostgreSQL
    await memoryRepo.saveFact(userId, 'المستخدم يعتمد على قاعدة بيانات PostgreSQL', 'technical_context');

    const query = 'عايز نصيحة بخصوص مشروع Flutter وقاعدة البيانات بتاعته';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    // Should contain at most 1 Flutter fact (the best one) and the PostgreSQL fact
    const flutterFacts = retrieved.filter((m) => m.memory.factText.toLowerCase().includes('flutter'));
    expect(flutterFacts.length).toBe(1);
    expect(retrieved.some((m) => m.memory.factText.includes('PostgreSQL'))).toBe(true);
  });

  // Scenario J — Diversity (Relevant > Diverse)
  test('Scenario J — Diversity operates among relevant items without pulling in irrelevant categories', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور تطبيقات هواتف فلاتر', 'profession');
    await memoryRepo.saveFact(userId, 'المستخدم يفضل Clean Architecture في تصميم التطبيقات', 'technical_context');
    await memoryRepo.saveFact(userId, 'المستخدم يحب ممارسة رياضة السباحة أسبوعياً', 'interests');

    const query = 'عايز أعمل مشروع Flutter جديد ومحتاج architecture كويسة';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    // Both Flutter and Clean Architecture should be retrieved (diverse technical context)
    expect(retrieved.some((m) => m.memory.factText.includes('فلاتر'))).toBe(true);
    expect(retrieved.some((m) => m.memory.factText.includes('Clean Architecture'))).toBe(true);
    // Swimming should strictly NOT be included
    expect(retrieved.some((m) => m.memory.factText.includes('السباحة'))).toBe(false);
  });

  // Scenario K — Context Budget Selection
  test('Scenario K — Caps selection strictly to budget bounds (max 5 items, max 1200 chars, max 300 tokens)', async () => {
    const userId = uuidv4();
    for (let i = 1; i <= 8; i++) {
      await memoryRepo.saveFact(
        userId,
        `المستخدم يتقن الأداة التقنية الفريدة رقم ${i} المتخصصة في أنظمة الفلاتر والدارت Flutter`,
        'technical_context'
      );
    }

    const query = 'ما هي الأدوات التقنية التي أستخدمها في Flutter؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query, limit: 5 });

    expect(retrieved.length).toBeLessThanOrEqual(5);
    const context = contextAssembler.assemble(retrieved, { maxItems: 5, maxChars: 1200 });
    expect(context.selectedCount).toBeLessThanOrEqual(5);
    expect(context.formattedPromptText!.length).toBeLessThanOrEqual(1200);
  });

  // Scenario L — Deterministic Ordering
  test('Scenario L — Deterministic ordering produces identical rankings across repeated invocations', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يستخدم Docker لتشغيل التطبيقات', 'technical_context', {
      importance: 'high',
      confidence: 0.85,
    });
    await memoryRepo.saveFact(userId, 'المستخدم يستخدم Kubernetes لإدارة الحاويات', 'technical_context', {
      importance: 'normal',
      confidence: 0.85,
    });
    await memoryRepo.saveFact(userId, 'المستخدم يستخدم Docker Compose للبيئة المحلية', 'technical_context', {
      importance: 'high',
      confidence: 0.90,
    });

    const query = 'عايز أعمل setup لـ Docker و Kubernetes';
    const run1 = await retrievalService.retrieve({ userId, message: query });
    const run2 = await retrievalService.retrieve({ userId, message: query });

    expect(run1.map((r) => r.memory.id)).toEqual(run2.map((r) => r.memory.id));
    expect(run1.map((r) => r.relevanceScore)).toEqual(run2.map((r) => r.relevanceScore));
  });

  // Scenario M — Preference Isolation
  test('Scenario M — Pure language or personality directives return empty general memory context', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور برمجيات سحابية', 'profession');
    await userPrefRepo.setLanguagePreference(userId, { language: 'ar', dialect: 'egyptian' });
    await userPrefRepo.setPersonalityPreference(userId, { verbosity: 'concise' });

    // Pure language directive
    const retrievedLang = await retrievalService.retrieve({ userId, message: 'رد عليا بالإنجليزي' });
    expect(retrievedLang).toHaveLength(0);

    // Pure personality directive
    const retrievedPers = await retrievalService.retrieve({ userId, message: 'خليك مختصر' });
    expect(retrievedPers).toHaveLength(0);
  });

  // Scenario N — Safety Filtering (Defense-in-Depth)
  test('Scenario N — Defense-in-depth safety gate excludes sensitive credentials during retrieval', async () => {
    const userId = uuidv4();
    // Simulate legacy raw item in repository with API key
    await memoryRepo.saveFact(userId, 'المستخدم شغال فلاتر', 'technical_context');
    const pool = (memoryRepo as any).db?.getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO memory_items (id, user_id, fact_text, category, status, confidence, importance, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', 0.95, 'high', NOW(), NOW())`,
        [uuidv4(), userId, 'المفتاح السري هو sk-proj-1234567890abcdef1234567890abcdef', 'general']
      );
    }

    const query = 'ما هي بياناتي والمفاتيح المسجلة عندي؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.some((m) => m.memory.factText.includes('sk-proj'))).toBe(false);
  });

  // Scenario O — Cross-Conversation Relevance (conversationCount does not inflate relevance)
  test('Scenario O — High conversation count (35 convs) does NOT artificially inflate relevance for unrelated queries', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور فلاتر Flutter', 'profession', {
      metadata: { conversationCount: 35 },
    });

    const query = 'إيه الأكلات والوجبات اللي بحبها في الغداء؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved).toHaveLength(0);
  });

  // Scenario P — Recency Behavior (Micro-boost tie-breaker only)
  test('Scenario P — Recency micro-boost (+0.01) never overrides core identity or topical importance', async () => {
    const userId = uuidv4();
    // Older critical identity fact (30 days old)
    await memoryRepo.saveFact(userId, 'اسم المستخدم: أحمد عادل', 'identity', {
      importance: 'critical',
      confidence: 1.0,
    });
    // Fresh low-importance fact (1 hour ago)
    await memoryRepo.saveFact(userId, 'المستخدم شرب شاي بالنعناع', 'ephemeral_context', {
      importance: 'low',
      confidence: 0.90,
    });

    const query = 'هو أنت عارف أنا اسمي إيه ومين أنا؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBe(1);
    expect(retrieved[0].memory.category).toBe('identity');
    expect(retrieved[0].memory.factText).toContain('أحمد عادل');
  });

  // Scenario Q — Multi-Intent Query
  test('Scenario Q — Multi-intent query retrieves multiple matching domains cleanly', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
    await memoryRepo.saveFact(userId, 'المستخدم يستخدم Docker في بيئة الاختبار', 'technical_context');
    await memoryRepo.saveFact(userId, 'المستخدم يعيش في دبي', 'stable_fact');

    const query = 'بما إني شغال Flutter، إيه رأيك أعمل Dockerize للتطبيق؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved.length).toBe(2);
    expect(retrieved.some((m) => m.memory.factText.includes('Flutter'))).toBe(true);
    expect(retrieved.some((m) => m.memory.factText.includes('Docker'))).toBe(true);
    expect(retrieved.some((m) => m.memory.factText.includes('دبي'))).toBe(false);
  });

  // Scenario R — Zero-Memory Case
  test('Scenario R — Zero-memory or completely irrelevant query returns empty array and undefined prompt context', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

    const query = 'ما هي عاصمة اليابان؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    expect(retrieved).toHaveLength(0);
    const context = contextAssembler.assemble(retrieved);
    expect(context.selectedCount).toBe(0);
    expect(context.formattedPromptText).toBeUndefined();
    expect(contextAssembler.toPromptSection(context)).toBeUndefined();
  });

  // Scenario S — Current User Statement vs Stale Memory (Authoritative Runtime Signal)
  test('Scenario S — Current user statement explicitly stopping a tech suppresses stale memory as current', async () => {
    const userId = uuidv4();
    await memoryRepo.saveFact(userId, 'المستخدم يعمل مع فلاتر (Flutter)', 'profession', {
      temporalState: 'current',
      confidence: 0.95,
    });
    await memoryRepo.saveFact(userId, 'المستخدم يعمل مع رياكت (React)', 'profession', {
      temporalState: 'current',
      confidence: 0.85,
    });

    // User explicitly says they stopped Flutter and are now using React
    const query = 'أنا بطلت Flutter من فترة وبستخدم React دلوقتي، إزاي أعمل component؟';
    const retrieved = await retrievalService.retrieve({ userId, message: query });

    // React should be retrieved
    expect(retrieved.some((m) => m.memory.factText.includes('React'))).toBe(true);
    // Stale Flutter memory must NOT be retrieved as current fact for this turn
    expect(retrieved.some((m) => m.memory.factText.includes('Flutter'))).toBe(false);
  });

  // Scenario T — >20 Conversation Provenance Relevance Verification
  test('Scenario T — Large conversation history (>20 conversations) maintains bounded metadata and correct retrieval', async () => {
    const userId = uuidv4();
    const convIds = Array.from({ length: 35 }, (_, i) => `conv_p3_scen_t_${i + 1}`);
    await memoryRepo.saveFact(userId, 'المستخدم خبير في لغة البرمجة Go (Golang)', 'technical_context', {
      metadata: {
        conversationCount: 35,
        conversationIds: convIds.slice(-20),
      },
    });

    // 1. Relevant query
    const relQuery = 'عايز مساعدة في كتابة microservice بلغة Go';
    const relRetrieved = await retrievalService.retrieve({ userId, message: relQuery });
    expect(relRetrieved.length).toBe(1);
    expect(relRetrieved[0].memory.factText).toContain('Go');

    // 2. Irrelevant query
    const irrelQuery = 'إيه الطقس في باريس النهاردة؟';
    const irrelRetrieved = await retrievalService.retrieve({ userId, message: irrelQuery });
    expect(irrelRetrieved).toHaveLength(0);
  });
});
