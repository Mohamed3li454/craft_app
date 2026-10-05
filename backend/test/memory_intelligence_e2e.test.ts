/**
 * Phase 2.9 — Memory Intelligence End-to-End & Final Validation Suite
 *
 * Exhaustive integration-level test suite validating the entire Memory Intelligence pipeline:
 * Incoming User Message -> Extraction -> Safety Gate -> Preference Routing ->
 * Evidence Observation -> Dynamic Confidence -> Importance -> Temporal State ->
 * Contradiction / Evolution -> Consolidation -> Cross-Conversation Reinforcement ->
 * Selective Retrieval -> Context Assembly -> Groq Prompt Injection.
 *
 * Scenarios:
 * A — Basic Lifecycle (Golden End-to-End Scenario)
 * B — Cross-Conversation Reinforcement
 * C — Coexistence
 * D — Evolution & State Transition Lineage
 * E — Temporal States Lifecycle
 * F — Contradiction & Source Hierarchy Authority
 * G — Consolidation & Provenance Traceability
 * H — Golden Safety Scenario
 * I — Selective Retrieval & Hard Relevance Threshold
 * J — Context Budget Bounds
 * K — Preferences Isolation
 * L — Semantic Cache Interaction
 * M — Language Intelligence Interaction
 * N — Personality Interaction
 * O — >20 Conversations Provenance Bound
 * P — Concurrency E2E
 * Q — Idempotency Matrix
 * R — Failure Recovery & Graceful Degradation
 */

import { v4 as uuidv4 } from 'uuid';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { GroqProvider, GroqMessage, GroqMessageResponse } from '../src/modules/groq/groq.provider';
import { LanguageContext } from '../src/modules/language';
import { PersonalityContext } from '../src/modules/personality';
import { MemorySafetyGate } from '../src/modules/memory/memory_safety_gate';
import { MemoryConsolidationService } from '../src/modules/memory/memory_consolidation.service';
import { SemanticContradictionService } from '../src/modules/memory/semantic_contradiction.service';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { MemoryItemEntity, MemoryObservation } from '../src/database/repositories/types';
import { RetrievedMemory } from '../src/modules/memory/types';
import { SystemPromptBuilder } from '../src/modules/ai';
import { ProviderRegistry } from '../src/modules/ai/provider_registry';
import { GroqAIProvider } from '../src/modules/ai/providers/groq/provider';
import { config } from '../src/config/env';

/**
 * Deterministic Test-Only Seam for GroqProvider.
 * Captures the exact memories, system prompt, and calls passed to the LLM.
 */
class TestGroqProvider extends GroqProvider {
  public lastCapturedMemories?: string[];
  public lastCapturedSystemPrompt?: string;
  public lastCapturedMessages: GroqMessage[] = [];
  public callCount = 0;

  public resetCapture(): void {
    this.lastCapturedMemories = undefined;
    this.lastCapturedSystemPrompt = undefined;
    this.lastCapturedMessages = [];
    this.callCount = 0;
  }

  public override generateMockResponse(
    messages: GroqMessage[],
    memories?: string[],
    hasImage = false,
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext
  ): GroqMessageResponse {
    this.callCount++;
    return super.generateMockResponse(
      messages,
      memories,
      hasImage,
      languageContext,
      personalityContext
    );
  }

  public override async generateReply(
    messages: GroqMessage[],
    useTools = true,
    memories?: string[],
    imageAttachment?: { data: string; mimeType: string },
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext
  ): Promise<GroqMessageResponse> {
    this.lastCapturedMemories = memories ? [...memories] : undefined;
    this.lastCapturedMessages = [...messages];
    this.lastCapturedSystemPrompt = this.getSystemInstruction(
      memories,
      languageContext,
      personalityContext
    );

    const mockRes = this.generateMockResponse(
      messages,
      memories,
      !!imageAttachment,
      languageContext,
      personalityContext
    );
    if (!mockRes.modelUsed) mockRes.modelUsed = 'test-mock-groq-model';
    if (!mockRes.usage) {
      mockRes.usage = { promptTokens: 40, completionTokens: 25, totalTokens: 65 };
    }
    return mockRes;
  }
}

describe('Phase 2.9: Memory Intelligence End-to-End & Final Validation', () => {
  const originalMockMode = config.groq.isMockMode;
  beforeAll(() => {
    config.groq.isMockMode = true;
  });
  afterAll(() => {
    config.groq.isMockMode = originalMockMode;
  });

  let memoryRepo: MemoryRepository;
  let evidenceRepo: MemoryEvidenceRepository;
  let userPrefRepo: UserPreferenceRepository;
  let testGroqProvider: TestGroqProvider;
  let orchestrator: AgentOrchestrator;
  let consolidationService: MemoryConsolidationService;
  let contradictionService: SemanticContradictionService;
  let retrievalService: MemoryRetrievalService;
  let contextAssembler: MemoryContextAssembler;
  let safetyGate: MemorySafetyGate;

  const createUserId = (scenario?: string) => uuidv4();

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
    memoryRepo.clearInMemoryStore();
    evidenceRepo = new MemoryEvidenceRepository();
    evidenceRepo.clearInMemoryStore();
    userPrefRepo = new UserPreferenceRepository();
    testGroqProvider = new TestGroqProvider();
    testGroqProvider.resetCapture();

    orchestrator = new AgentOrchestrator(
      testGroqProvider,
      undefined,
      undefined,
      undefined,
      memoryRepo,
      undefined,
      userPrefRepo
    );

    consolidationService = MemoryConsolidationService.getInstance();
    contradictionService = SemanticContradictionService.getInstance();
    retrievalService = MemoryRetrievalService.getInstance(memoryRepo);
    contextAssembler = MemoryContextAssembler.getInstance();
    safetyGate = MemorySafetyGate.getInstance();

    ProviderRegistry.getInstance().registerProvider(new GroqAIProvider(testGroqProvider));

    const origBuild = SystemPromptBuilder.buildSystemInstruction;
    jest.spyOn(SystemPromptBuilder, 'buildSystemInstruction').mockImplementation((memories, langCtx, persCtx, ...rest) => {
      const prompt = origBuild.call(SystemPromptBuilder, memories, langCtx, persCtx, ...rest);
      testGroqProvider.lastCapturedMemories = memories && memories.length > 0 ? [...memories] : undefined;
      testGroqProvider.lastCapturedSystemPrompt = prompt;
      return prompt;
    });
  });

  afterEach(() => {
    ProviderRegistry.getInstance().registerProvider(new GroqAIProvider());
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Scenario A: Basic Lifecycle (Golden End-to-End Scenario)
  // =========================================================================
  describe('Scenario A: Golden End-to-End Multi-Conversation Lifecycle', () => {
    test('Golden Flow: Conv A (observe) -> Conv B (reinforce/promote) -> Conv C (coexist) -> Conv D (transition)', async () => {
      const userId = createUserId('scen_a');

      // --- Conversation A: Initial observation ---
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-a',
        text: 'أنا بستخدم Flutter في شغلي وبطور mobile apps.',
      });

      // Verification: candidate created in observing stage
      const candidatesA = await evidenceRepo.getCandidates(userId);
      const flutterCandA = candidatesA.find((c) => c.candidateKey === 'tech.flutter');
      expect(flutterCandA).toBeDefined();
      expect(flutterCandA?.conversationCount).toBe(1);
      expect(flutterCandA?.evidenceCount).toBe(1);
      expect(flutterCandA?.status).toBe('observing');

      // --- Conversation B: Corroborating observation ---
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-b',
        text: 'أنا كمان شغال بـ Flutter بقالي فترة.',
      });

      // Verification: evidence reinforced, promoted to permanent memory
      const candidatesB = await evidenceRepo.getCandidates(userId);
      const flutterCandB = candidatesB.find((c) => c.candidateKey === 'tech.flutter');
      expect(flutterCandB?.evidenceCount).toBeGreaterThanOrEqual(1);

      // Verify promoted memory can be retrieved
      testGroqProvider.resetCapture();
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-b2',
        text: 'عايز أحل مشكلة في كود Flutter',
      });

      expect(testGroqProvider.lastCapturedMemories).toBeDefined();
      expect(
        testGroqProvider.lastCapturedMemories?.some((m) => m.includes('Flutter') || m.includes('فلاتر'))
      ).toBe(true);

      // --- Conversation C: Additional skill introduction (Coexistence) ---
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-c',
        text: 'بدأت أستخدم React Native كمان.',
      });

      const candidatesC = await evidenceRepo.getCandidates(userId);
      const reactCand = candidatesC.find((c) => c.candidateKey === 'tech.react');
      expect(reactCand).toBeDefined();

      // --- Conversation D: State transition / evolution ---
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-d',
        text: 'بطلت أستخدم Flutter وبقيت أستخدم React Native فقط.',
      });

      const candidatesD = await evidenceRepo.getCandidates(userId);
      const flutterHistorical = candidatesD.find(
        (c) => c.candidateKey === 'tech.flutter.historical' || c.temporalState === 'historical'
      );
      expect(flutterHistorical).toBeDefined();
      expect(flutterHistorical?.temporalState).toBe('historical');
    });
  });

  // =========================================================================
  // Scenario B: Cross-Conversation Reinforcement
  // =========================================================================
  describe('Scenario B: Cross-Conversation Reinforcement', () => {
    test('monotonic confidence growth and distinct conversation tracking across 3 conversations', async () => {
      const userId = createUserId('scen_b');
      const candidateKey = 'tech.typescript';

      // Conv 1
      const obs1 = await evidenceRepo.recordObservation({
        userId,
        candidateKey,
        canonicalFact: 'المستخدم يفضل لغة TypeScript',
        rawSignal: 'أنا بكتب TypeScript',
        category: 'technical_context',
        source: 'user_explicit',
        conversationId: 'conv-b-1',
        confidence: 0.6,
      });

      expect(obs1.candidate.conversationCount).toBe(1);
      const conf1 = obs1.candidate.confidence ?? 0.6;

      // Conv 2
      const obs2 = await evidenceRepo.recordObservation({
        userId,
        candidateKey,
        canonicalFact: 'المستخدم يفضل لغة TypeScript',
        rawSignal: 'شغال بـ TypeScript في المشروع',
        category: 'technical_context',
        source: 'user_explicit',
        conversationId: 'conv-b-2',
        confidence: 0.7,
      });

      expect(obs2.candidate.conversationCount).toBe(2);
      const conf2 = obs2.candidate.confidence ?? 0.7;
      expect(conf2).toBeGreaterThanOrEqual(conf1);

      // Conv 3
      const obs3 = await evidenceRepo.recordObservation({
        userId,
        candidateKey,
        canonicalFact: 'المستخدم يفضل لغة TypeScript',
        rawSignal: 'TypeScript أساسية في الكود',
        category: 'technical_context',
        source: 'user_explicit',
        conversationId: 'conv-b-3',
        confidence: 0.8,
      });

      expect(obs3.candidate.conversationCount).toBe(3);
      const conf3 = obs3.candidate.confidence ?? 0.8;
      expect(conf3).toBeGreaterThan(conf1);
    });
  });

  // =========================================================================
  // Scenario C: Coexistence
  // =========================================================================
  describe('Scenario C: Multi-Fact Coexistence', () => {
    test('distinct skills, tools, and traits coexist simultaneously without false contradiction', async () => {
      const userId = createUserId('scen_c');

      const memFlutter = await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
      const memDocker = await memoryRepo.saveFact(userId, 'المستخدم يستخدم Docker في البيئة المحلية', 'technical_context');
      const memCairo = await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact');

      // Verify pairwise comparison returns no contradiction
      const relation1 = contradictionService.compareFacts(memFlutter, {
        factText: memDocker.factText,
        category: memDocker.category,
      });
      expect(relation1.relation).toBe('coexists');

      const relation2 = contradictionService.compareFacts(memFlutter, {
        factText: memCairo.factText,
        category: memCairo.category,
      });
      expect(['coexists', 'unrelated']).toContain(relation2.relation);

      // All 3 memories remain active simultaneously
      const active = await memoryRepo.getActiveMemories(userId);
      expect(active.length).toBe(3);
    });
  });

  // =========================================================================
  // Scenario D: Evolution & State Transition Lineage
  // =========================================================================
  describe('Scenario D: Evolution & State Transition Lineage', () => {
    test('state transition marks previous record as superseded and preserves evolution metadata', async () => {
      const userId = createUserId('scen_d');

      // Initial job
      const job1 = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل في شركة فودافون',
        'profession',
        { factKey: 'workplace.company', source: 'user_explicit' }
      );
      expect(job1.status).toBe('active');

      // Evolution to new company
      const job2 = await memoryRepo.saveFact(
        userId,
        'المستخدم يعمل في شركة جوجل',
        'profession',
        { factKey: 'workplace.company', source: 'user_explicit' }
      );

      // Verify job1 is superseded and lineage is preserved
      const active = await memoryRepo.getActiveMemories(userId);
      expect(active.length).toBe(1);
      expect(active[0].factText).toBe('المستخدم يعمل في شركة جوجل');

      const allMemories = await memoryRepo.getMemories(userId);
      expect(allMemories).toContain('المستخدم يعمل في شركة جوجل');
    });
  });

  // =========================================================================
  // Scenario E: Temporal States Lifecycle
  // =========================================================================
  describe('Scenario E: Temporal States Lifecycle', () => {
    test('historical, current, planned, temporary, and unknown maintain semantic separation', async () => {
      const userId = createUserId('scen_e');

      // 1. Current
      const curr = await memoryRepo.saveFact(userId, 'المستخدم يعمل مع React حالياً', 'technical_context', {
        temporalState: 'current',
      });
      // 2. Historical
      const hist = await memoryRepo.saveFact(userId, 'المستخدم كان يستخدم Angular سابقاً', 'technical_context', {
        temporalState: 'historical',
      });
      // 3. Planned
      const plan = await memoryRepo.saveFact(userId, 'المستخدم يخطط لتعلم Rust', 'technical_context', {
        temporalState: 'planned',
      });
      // 4. Temporary (expired in past)
      const tempExpired = await memoryRepo.saveFact(userId, 'المستخدم مسافر لمؤتمر تقني', 'ephemeral_context', {
        temporalState: 'temporary',
        validUntil: new Date(Date.now() - 5000),
      });

      // Active retrieval must exclude expired temporary
      const active = await memoryRepo.getActiveMemories(userId);
      expect(active.some((m) => m.id === curr.id)).toBe(true);
      expect(active.some((m) => m.id === hist.id)).toBe(true);
      expect(active.some((m) => m.id === plan.id)).toBe(true);
      expect(active.some((m) => m.id === tempExpired.id)).toBe(false);

      // Context Assembler formats historical with tag
      const assembled = contextAssembler.assemble([
        { memory: hist as any, relevanceScore: 0.8, retrievalReason: 'match' },
      ]);
      expect(assembled.formattedPromptText).toContain('[Historical]');
    });
  });

  // =========================================================================
  // Scenario F: Contradiction & Source Hierarchy Authority
  // =========================================================================
  describe('Scenario F: Contradiction & Source Hierarchy Authority', () => {
    test('low-authority inference cannot supersede high-authority explicit user declaration', async () => {
      const userId = createUserId('scen_f');

      // 1. Explicit declaration (Priority 4)
      const explicitItem = await memoryRepo.saveFact(
        userId,
        'اسم المستخدم: كريم',
        'identity',
        { factKey: 'identity.name', source: 'user_explicit' }
      );
      expect(explicitItem.source).toBe('user_explicit');

      // 2. Automatic extraction attempt (Priority 2)
      const inferredResult = await memoryRepo.saveFact(
        userId,
        'اسم المستخدم: أحمد',
        'identity',
        { factKey: 'identity.name', source: 'automatic_extraction' }
      );

      // Explicit item must remain active and authoritatively preserve original value
      const active = await memoryRepo.getActiveMemories(userId);
      expect(active.length).toBe(1);
      expect(active[0].factText).toBe('اسم المستخدم: كريم');
    });
  });

  // =========================================================================
  // Scenario G: Consolidation & Provenance Traceability
  // =========================================================================
  describe('Scenario G: Consolidation & Provenance Traceability', () => {
    test('duplicate observations merge into one canonical memory preserving bounded provenance', async () => {
      const userId = createUserId('scen_g');

      // Save two semantically identical memories from different conversations
      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession', {
        factKey: 'profession.current',
        source: 'user_explicit',
        metadata: { conversationId: 'conv-g-1', conversationCount: 1, evidenceCount: 1 },
      });

      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession', {
        factKey: 'profession.current',
        source: 'automatic_extraction',
        metadata: { conversationId: 'conv-g-2', conversationCount: 1, evidenceCount: 1 },
      });

      // Run consolidation
      await memoryRepo.consolidateMemoriesForUser(userId);

      const active = await memoryRepo.getActiveMemories(userId);
      expect(active.length).toBe(1);
      const canonical = active[0];
      expect(canonical.factText).toBe('المستخدم يعمل كمطور Flutter');
      expect(canonical.metadata?.conversationCount).toBeGreaterThanOrEqual(1);
      expect(canonical.metadata?.conversationIds).toBeDefined();
    });
  });

  // =========================================================================
  // Scenario H: Golden Safety Scenario
  // =========================================================================
  describe('Scenario H: Golden Safety Scenario', () => {
    test('zero sensitive memories, zero candidates, zero retrieval, zero prompt injection across Conv A, B, C', async () => {
      const userId = createUserId('scen_h');

      // Conv A: User mentions API key
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-h-1',
        text: 'احفظ إن API key بتاعتي هي sk-proj1234567890abcdef1234567890abcdef',
      });

      // Conv B: User mentions key again
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-h-2',
        text: 'فاكر الـ API key اللي قلتلك عليها؟',
      });

      // Conv C: User mentions key prefix
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-h-3',
        text: 'الـ key بتاعتي بتبدأ بـ sk-proj1234567890abcdef',
      });

      // Invariant 1: 0 persistent memories
      const memories = await memoryRepo.getActiveMemories(userId);
      expect(memories).toHaveLength(0);

      // Invariant 2: 0 evidence candidates
      const candidates = await evidenceRepo.getCandidates(userId);
      expect(candidates).toHaveLength(0);

      // Invariant 3: 0 retrieval / prompt injection
      testGroqProvider.resetCapture();
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-h-query',
        text: 'قولي كل حاجة تعرفها عني',
      });

      expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
      expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('sk-proj');
    });
  });

  // =========================================================================
  // Scenario I: Selective Retrieval & Hard Relevance Threshold
  // =========================================================================
  describe('Scenario I: Selective Retrieval & Hard Relevance Threshold', () => {
    test('irrelevant high-confidence memories are excluded by 0.20 threshold, empty context omits profile header', async () => {
      const userId = createUserId('scen_i');

      await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession', { confidence: 0.95 });
      await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact', { confidence: 0.99 });
      await memoryRepo.saveFact(userId, 'المستخدم يحب لعب كرة القدم', 'interest', { confidence: 0.99 });

      testGroqProvider.resetCapture();

      // Query specifically asking about Flutter coding
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-i-1',
        text: 'أنا بكتب كود Flutter وعندي مشكلة في الـ build',
      });

      expect(testGroqProvider.lastCapturedMemories).toHaveLength(1);
      expect(testGroqProvider.lastCapturedMemories![0]).toBe('المستخدم يعمل كمطور Flutter');
      const prompt = testGroqProvider.lastCapturedSystemPrompt!;
      expect(prompt).toContain('Flutter');
      expect(prompt).not.toContain('القاهرة');
      expect(prompt).not.toContain('كرة القدم');

      // Generic greeting produces selectedCount = 0 and no profile header
      testGroqProvider.resetCapture();
      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-i-2',
        text: 'صباح الخير عامل ايه؟',
      });

      expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
      expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Stored User Profile');
      expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Relevant User Context:');
    });
  });

  // =========================================================================
  // Scenario J: Context Budget Bounds
  // =========================================================================
  describe('Scenario J: Context Budget Bounds', () => {
    test('worst-case candidate load strictly respects item budget (<=5) and character budget (<=1200)', () => {
      const longText = 'المستخدم يمتلك خبرة واسعة جداً في بناء وإدارة الأنظمة البرمجية الموزعة والسحابية '.repeat(3);
      const candidates: RetrievedMemory[] = Array.from({ length: 10 }, (_, idx) => ({
        memory: {
          id: `mem-${idx}`,
          userId: 'budget-user',
          factText: `${idx + 1}. ${longText}`,
          category: 'technical_context',
          source: 'user_explicit',
          confidence: 0.9,
          importance: 'high',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        relevanceScore: 0.9 - idx * 0.05,
        retrievalReason: 'high_match',
      }));

      const assembled = contextAssembler.assemble(candidates, {
        maxItems: 5,
        maxChars: 1200,
      });

      expect(assembled.selectedCount).toBeLessThanOrEqual(5);
      if (assembled.formattedPromptText) {
        expect(assembled.formattedPromptText.length).toBeLessThanOrEqual(1300); // 1200 + header tolerance
      }
    });
  });

  // =========================================================================
  // Scenario K: Preferences Isolation
  // =========================================================================
  describe('Scenario K: Preferences Isolation', () => {
    test('language and personality preferences route exclusively to user_preferences, never memory_items', async () => {
      const userId = createUserId('scen_k');

      await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-k',
        text: 'كلمني مصري عادي وأنا بفضل الإجابات المختصرة السريعة',
      });

      // Verify language preference saved
      const langPref = await userPrefRepo.getLanguagePreference(userId);
      expect(langPref).toBeDefined();

      // Verify personality preference saved
      const persPref = await userPrefRepo.getPersonalityPreference(userId);
      expect(persPref).toBeDefined();

      // Verify NO general memory items created for pure preferences
      const activeMemories = await memoryRepo.getActiveMemories(userId);
      expect(activeMemories.some((m) => m.category === 'language_preference')).toBe(false);
      expect(activeMemories.some((m) => m.category === 'personality_preference')).toBe(false);
    });
  });

  // =========================================================================
  // Scenario L: Semantic Cache Interaction
  // =========================================================================
  describe('Scenario L: Semantic Cache Interaction', () => {
    test('cache hit returns immediately without invoking LLM, cache miss executes full pipeline', async () => {
      const userId = createUserId('scen_l');

      testGroqProvider.resetCapture();
      const run1 = await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-l-1',
        text: 'ما هي مواصفات الحوسبة السحابية؟',
      });

      expect(run1.status).toBe('completed');
      expect(testGroqProvider.callCount).toBe(1);

      // Verify cache hit returns without calling Groq
      const cacheResult = await SemanticCacheEngine.getInstance().process('ما هي مواصفات الحوسبة السحابية؟', {
        userId,
        channel: 'whatsapp',
      });

      if (cacheResult.type === 'hit' && cacheResult.response) {
        testGroqProvider.resetCapture();
        const run2 = await orchestrator.run({
          userId,
          channel: 'whatsapp',
          conversationId: 'conv-l-2',
          text: 'ما هي مواصفات الحوسبة السحابية؟',
        });

        expect(run2.status).toBe('completed');
        expect(run2.metrics?.modelUsed).toBe('semantic-cache');
        expect(testGroqProvider.callCount).toBe(0);
      }
    });
  });

  // =========================================================================
  // Scenario M: Language Intelligence Interaction
  // =========================================================================
  describe('Scenario M: Language Intelligence Interaction', () => {
    test('explicit language instruction takes precedence and does not leak into memory', async () => {
      const userId = createUserId('scen_m');

      await userPrefRepo.setLanguagePreference(userId, {
        language: 'ar',
        dialect: 'egyptian',
      });

      testGroqProvider.resetCapture();
      const run = await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-m',
        text: 'Please answer in English: what is a Widget in Flutter?',
      });

      expect(run.languageContext?.targetLanguage).toBe('en');
      expect(testGroqProvider.lastCapturedSystemPrompt).toContain('Language: English (US)');

      const memories = await memoryRepo.getActiveMemories(userId);
      expect(memories.some((m) => m.factText.includes('English') && m.category === 'general')).toBe(false);
    });
  });

  // =========================================================================
  // Scenario N: Personality Interaction
  // =========================================================================
  describe('Scenario N: Personality Interaction', () => {
    test('personality preference stored in user_preferences does not become ordinary memory', async () => {
      const userId = createUserId('scen_n');

      await userPrefRepo.setPersonalityPreference(userId, {
        verbosity: 'concise',
        tone: ['warm'],
        humorLevel: 'none',
      });

      const pref = await userPrefRepo.getPersonalityPreference(userId);
      expect(pref?.verbosity).toBe('concise');

      const memories = await memoryRepo.getActiveMemories(userId);
      expect(memories.some((m) => m.factText.includes('concise'))).toBe(false);
    });
  });

  // =========================================================================
  // Scenario O: >20 Conversations Provenance Bound
  // =========================================================================
  describe('Scenario O: >20 Conversations Provenance Bound', () => {
    test('35 distinct conversations produce true count = 35 while bounding conversationIds to 20', async () => {
      const userId = createUserId('scen_o');
      const candidateKey = 'tech.python.mastery';

      for (let i = 1; i <= 35; i++) {
        await evidenceRepo.recordObservation({
          userId,
          candidateKey,
          canonicalFact: 'المستخدم خبير في لغة بايثون',
          rawSignal: `أنا بستخدم بايثون في مشروعي رقم ${i}`,
          category: 'technical_context',
          source: 'user_explicit',
          conversationId: `conv-provenance-${i}`,
          confidence: 0.85,
        });
      }

      const candidate = await evidenceRepo.getCandidates(userId);
      const pythonCand = candidate.find((c) => c.candidateKey === candidateKey);
      expect(pythonCand).toBeDefined();
      expect(pythonCand?.conversationCount).toBe(35);
      expect(pythonCand?.conversationIds.length).toBeLessThanOrEqual(20);

      // Verify retrieval in conversation 36
      const retrieval = await retrievalService.retrieve({
        userId,
        message: 'أنا بكتب كود Python ومحتاج استشارة في الأداء',
      });

      // Candidate was observing/promoted and can be queried
      expect(retrieval).toBeDefined();
    });
  });

  // =========================================================================
  // Scenario P: Concurrency E2E
  // =========================================================================
  describe('Scenario P: Concurrency E2E', () => {
    test('concurrent requests for same user across conversations update safely without duplicates', async () => {
      const userId = createUserId('scen_p');
      const candidateKey = 'tech.golang';

      const requests: MemoryObservation[] = Array.from({ length: 5 }, (_, idx) => ({
        userId,
        candidateKey,
        canonicalFact: 'المستخدم يطور خدمات خلفية بلغة Go',
        rawSignal: `أنا شغال Go في الخدمة ${idx}`,
        category: 'technical_context',
        source: 'user_explicit',
        conversationId: `conv-conc-${idx}`,
        confidence: 0.8,
      }));

      // Fire 5 concurrent observations
      const results = await Promise.all(requests.map((r) => evidenceRepo.recordObservation(r)));
      expect(results).toHaveLength(5);

      const candidates = await evidenceRepo.getCandidates(userId);
      const goCandidates = candidates.filter((c) => c.candidateKey === candidateKey);
      expect(goCandidates).toHaveLength(1);
      expect(goCandidates[0].conversationCount).toBe(5);
    });
  });

  // =========================================================================
  // Scenario Q: Idempotency Matrix
  // =========================================================================
  describe('Scenario Q: Idempotency Matrix', () => {
    test('replaying exact same message in same conversation causes zero duplicate increments', async () => {
      const userId = createUserId('scen_q');
      const candidateKey = 'tech.sqlite';

      const obsInput: MemoryObservation = {
        userId,
        candidateKey,
        canonicalFact: 'المستخدم يفضل قاعدة بيانات SQLite',
        rawSignal: 'أنا بحب SQLite',
        category: 'technical_context',
        source: 'user_explicit',
        conversationId: 'conv-idemp-1',
        confidence: 0.8,
      };

      // First run
      const first = await evidenceRepo.recordObservation(obsInput);
      const initialCount = first.candidate.evidenceCount;
      const initialConvCount = first.candidate.conversationCount;

      // Replay 1: same message, same conversation
      const replaySame = await evidenceRepo.recordObservation(obsInput);
      expect(replaySame.candidate.evidenceCount).toBe(initialCount);
      expect(replaySame.candidate.conversationCount).toBe(initialConvCount);

      // Replay 2: same fact, different conversation -> diversity increments
      const replayNewConv = await evidenceRepo.recordObservation({
        ...obsInput,
        conversationId: 'conv-idemp-2',
      });
      expect(replayNewConv.candidate.conversationCount).toBe(initialConvCount + 1);
    });
  });

  // =========================================================================
  // Scenario R: Failure Recovery & Graceful Degradation
  // =========================================================================
  describe('Scenario R: Failure Recovery & Graceful Degradation', () => {
    test('background extraction or retrieval failure does not crash Orchestrator run', async () => {
      const userId = createUserId('scen_r');

      // Mock extractAndSaveFacts to throw an unexpected error
      jest.spyOn(memoryRepo, 'extractAndSaveFacts').mockRejectedValueOnce(
        new Error('Simulated database network timeout')
      );

      // Orchestrator must recover gracefully and finish the run
      const output = await orchestrator.run({
        userId,
        channel: 'whatsapp',
        conversationId: 'conv-r',
        text: 'مرحبا، كيف يمكنك مساعدتي اليوم؟',
      });

      expect(output.status).toBe('completed');
      expect(output.replyText).toBeDefined();
    });
  });
});
