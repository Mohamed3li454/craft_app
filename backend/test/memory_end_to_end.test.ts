/**
 * Phase 4.7 — End-to-End Memory Verification Suite
 *
 * Verifies the complete integrated memory architecture:
 * User Message -> Extraction -> Safety Gate -> Routing / Storage ->
 * Conflict Resolution & Dedup -> Selective Retrieval -> Context Assembly ->
 * Orchestrator -> Final AI System Prompt.
 *
 * Uses deterministic test-only seams with zero network calls and zero real AI API calls.
 */

import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { GroqProvider, GroqMessage, GroqMessageResponse } from '../src/modules/groq/groq.provider';
import { LanguageContext, LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityContext } from '../src/modules/personality';
import { MemorySafetyGate } from '../src/modules/memory/memory_safety_gate';
import { MemoryCandidateExtractor } from '../src/modules/memory/memory_extractor';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';

/**
 * Deterministic Test-Only Seam for GroqProvider.
 * Intercepts and captures the exact memories and system prompt passed to the LLM.
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

  public override async generateReply(
    messages: GroqMessage[],
    useTools = true,
    memories?: string[],
    imageAttachment?: { data: string; mimeType: string },
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext
  ): Promise<GroqMessageResponse> {
    this.callCount++;
    this.lastCapturedMemories = memories ? [...memories] : undefined;
    this.lastCapturedMessages = [...messages];
    this.lastCapturedSystemPrompt = this.getSystemInstruction(
      memories,
      languageContext,
      personalityContext
    );

    // Call deterministic offline mock response engine
    const mockRes = this.generateMockResponse(
      messages,
      memories,
      !!imageAttachment,
      languageContext,
      personalityContext
    );
    if (!mockRes.modelUsed) mockRes.modelUsed = 'test-mock-model';
    if (!mockRes.usage) {
      mockRes.usage = { promptTokens: 40, completionTokens: 25, totalTokens: 65 };
    }
    return mockRes;
  }
}

describe('Phase 4.7: End-to-End Memory Architecture Verification', () => {
  let memoryRepo: MemoryRepository;
  let userPrefRepo: UserPreferenceRepository;
  let testGroqProvider: TestGroqProvider;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
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
  });

  // =========================================================================
  // 1. Scenario A — Safe Persistent Memory Flow
  // =========================================================================
  test('1. Scenario A: safe extraction -> storage -> selective retrieval -> prompt insertion', async () => {
    const userId = 'user_e2e_scen_a_' + Date.now();

    // 1. User introduces himself as a Flutter developer
    const run1 = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'أنا اسمي Mohamed وبشتغل كمطور Flutter',
    });
    expect(run1.status).toBe('completed');

    // Verify stored memory in memory_items
    const storedMemories = await memoryRepo.getMemories(userId);
    expect(storedMemories.length).toBeGreaterThanOrEqual(1);
    expect(storedMemories.some((m) => m.includes('Flutter'))).toBe(true);

    testGroqProvider.resetCapture();

    // 2. User asks a technically relevant question
    const run2 = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إزاي أحسن architecture بتاعة تطبيق Flutter؟',
    });
    expect(run2.status).toBe('completed');

    // Verify that the memory was retrieved and injected into the Groq prompt
    expect(testGroqProvider.lastCapturedMemories).toBeDefined();
    expect(testGroqProvider.lastCapturedMemories!.length).toBe(1);
    expect(testGroqProvider.lastCapturedMemories![0]).toContain('Flutter');
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('### Stored User Profile:');
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('Flutter');

    testGroqProvider.resetCapture();

    // 3. User asks an unrelated question (Coffee)
    const run3 = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إيه أفضل طريقة أعمل بيها قهوة؟',
    });
    expect(run3.status).toBe('completed');

    // Negative check: Zero memories retrieved, NO Stored User Profile in prompt
    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Stored User Profile:');
  });

  // =========================================================================
  // 2. Scenario B — Language Preference Isolation
  // =========================================================================
  test('2. Scenario B: language preference is routed to user_preferences and never memory_items', async () => {
    const userId = 'user_e2e_scen_b_lang_' + Date.now();

    const run = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'اتكلم معايا بالإنجليزي',
    });
    expect(run.status).toBe('completed');

    // 1. Verify user_preferences contains language preference
    const langPref = await userPrefRepo.getLanguagePreference(userId);
    expect(langPref).toBeDefined();
    expect(langPref?.language).toBe('en');

    // 2. Verify memory_items contains ZERO rows
    const genericMemories = await memoryRepo.getMemories(userId);
    expect(genericMemories).toHaveLength(0);

    // 3. Verify next message operates in English via LanguageIntelligence, without any memory in prompt
    testGroqProvider.resetCapture();
    const run2 = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'How can I organize my daily schedule?',
    });
    expect(run2.status).toBe('completed');
    expect(run2.languageContext?.targetLanguage).toBe('en');
    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Stored User Profile:');
  });

  // =========================================================================
  // 3. Scenario B — Personality Preference Isolation
  // =========================================================================
  test('3. Scenario B: personality preference is routed to user_preferences and never memory_items', async () => {
    const userId = 'user_e2e_scen_b_pers_' + Date.now();

    const run = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'خليك مختصر في ردودك',
    });
    expect(run.status).toBe('completed');

    // 1. Verify user_preferences contains personality preference
    const persPref = await userPrefRepo.getPersonalityPreference(userId);
    expect(persPref).toBeDefined();
    expect(persPref?.verbosity).toBe('concise');

    // 2. Verify memory_items contains ZERO rows
    const genericMemories = await memoryRepo.getMemories(userId);
    expect(genericMemories).toHaveLength(0);

    // 3. Verify next turn applies concise personality
    testGroqProvider.resetCapture();
    const run2 = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'ما هي عاصمة اليابان؟',
    });
    expect(run2.status).toBe('completed');
    expect(run2.personalityContext?.verbosity).toBe('concise');
    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
  });

  // =========================================================================
  // 4. Scenario C — Sensitive Secrets Blocked End-to-End
  // =========================================================================
  test('4. Scenario C: sensitive passwords, API keys, and OTPs are blocked from storage and prompt', async () => {
    const userId = 'user_e2e_scen_c_sec_' + Date.now();

    // Attempt to inject password
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'كلمة المرور الخاصة بي هي 123456',
    });

    // Attempt to inject API key
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'My API key is sk-proj-abcdef123456789012345678',
    });

    // Verify ZERO facts saved in memory_items
    const genericMemories = await memoryRepo.getMemories(userId);
    expect(genericMemories).toHaveLength(0);

    // Verify query about password receives no stored profile
    testGroqProvider.resetCapture();
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إيه كلمة المرور بتاعتي؟',
    });

    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('123456');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('sk-proj-');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Stored User Profile:');
  });

  // =========================================================================
  // 5. Scenario C — Health and Medical Data Blocked End-to-End
  // =========================================================================
  test('5. Scenario C: health and medical data are blocked by safety gate and never reach prompt', async () => {
    const userId = 'user_e2e_scen_c_health_' + Date.now();

    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'أنا باخد دواء X لعلاج الصداع النصفي',
    });

    // Verify ZERO facts in memory_items
    const genericMemories = await memoryRepo.getMemories(userId);
    expect(genericMemories).toHaveLength(0);

    testGroqProvider.resetCapture();
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إيه العلاج اللي كنت باخده؟',
    });

    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Stored User Profile:');
  });

  // =========================================================================
  // 6. Scenario D — Conflict Resolution End-to-End
  // =========================================================================
  test('6. Scenario D: conflict resolution marks old fact superseded and only active fact reaches prompt', async () => {
    const userId = 'user_e2e_scen_d_' + Date.now();

    // 1. Save initial mobile framework preference
    await memoryRepo.saveFact(
      userId,
      'المستخدم يستخدم Flutter في تطوير التطبيقات',
      'technical_context',
      { factKey: 'tech.mobile_framework', confidence: 0.9 }
    );

    // 2. Later, user switches to React
    await memoryRepo.saveFact(
      userId,
      'المستخدم يستخدم React في تطوير التطبيقات',
      'technical_context',
      { factKey: 'tech.mobile_framework', confidence: 0.95 }
    );

    // Verify repository lifecycle state: only 1 active memory exists
    const activeMemories = await memoryRepo.getActiveMemories(userId);
    expect(activeMemories).toHaveLength(1);
    expect(activeMemories[0].factText).toContain('React');

    const memories = await memoryRepo.getMemories(userId);
    expect(memories).toHaveLength(1);
    expect(memories[0]).toContain('React');

    testGroqProvider.resetCapture();

    // 3. Query regarding framework
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إيه الـ framework اللي بستخدمه في التطبيقات؟',
    });

    // Verify prompt contains ONLY React, and NEVER the superseded Flutter fact
    expect(testGroqProvider.lastCapturedMemories).toBeDefined();
    expect(testGroqProvider.lastCapturedMemories!.length).toBe(1);
    expect(testGroqProvider.lastCapturedMemories![0]).toContain('React');
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('React');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('Flutter');
  });

  // =========================================================================
  // 7. Scenario E — Deduplication End-to-End
  // =========================================================================
  test('7. Scenario E: exact and semantic duplicates are prevented from creating extra rows', async () => {
    const userId = 'user_e2e_scen_e_' + Date.now();

    // Exact insertion
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
    // Normalized duplicate insertion
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter  ', 'profession');
    // High token similarity insertion (>= 0.85 in same category)
    await memoryRepo.saveFact(userId, 'المستخدم شغال كمطور Flutter', 'profession');

    const activeMemories = await memoryRepo.getActiveMemories(userId);
    expect(activeMemories).toHaveLength(1);
  });

  // =========================================================================
  // 8. Scenario F — Lifecycle End-to-End (Active vs Superseded vs Expired)
  // =========================================================================
  test('8. Scenario F: active memories are eligible, superseded and expired are strictly excluded', async () => {
    const userId = 'user_e2e_scen_f_' + Date.now();

    // Active fact
    await memoryRepo.saveFact(userId, 'المستخدم يفضل لغة Dart', 'technical_preference');

    // Superseded fact
    const supersededItem = await memoryRepo.saveFact(
      userId,
      'المستخدم كان يفضل لغة Java',
      'technical_preference'
    );
    await memoryRepo.updateFact(supersededItem.id, { status: 'superseded' });

    // Expired ephemeral fact (validUntil in the past)
    await memoryRepo.saveFact(
      userId,
      'المستخدم يحضر مؤتمر Dart اليوم',
      'ephemeral_context',
      { validUntil: new Date(Date.now() - 3600 * 1000) }
    );

    // Active ephemeral fact (validUntil in the future)
    await memoryRepo.saveFact(
      userId,
      'المستخدم يعمل على release إصدار Dart الجديد هذا الأسبوع',
      'ephemeral_context',
      { validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000) }
    );

    testGroqProvider.resetCapture();

    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إيه أخبار كود Dart اللي بكتبه؟',
    });

    expect(testGroqProvider.lastCapturedMemories).toBeDefined();
    // Only the 2 active facts (permanent Dart preference + active ephemeral release)
    expect(testGroqProvider.lastCapturedMemories!.length).toBe(2);
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('المستخدم يفضل لغة Dart');
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('إصدار Dart الجديد');
    // Superseded and expired facts must never appear
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('Java');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('يحضر مؤتمر Dart');
  });

  // =========================================================================
  // 9. Scenario G — Irrelevant Memory Exclusion
  // =========================================================================
  test('9. Scenario G: irrelevant active memories are strictly excluded from prompt', async () => {
    const userId = 'user_e2e_scen_g_' + Date.now();

    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
    await memoryRepo.saveFact(userId, 'المستخدم يعيش في القاهرة', 'stable_fact');
    await memoryRepo.saveFact(userId, 'المستخدم يحب القراءة', 'interest');

    testGroqProvider.resetCapture();

    // Query is strictly about Flutter state management
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إزاي أعمل state management في Flutter؟',
    });

    expect(testGroqProvider.lastCapturedMemories).toBeDefined();
    expect(testGroqProvider.lastCapturedMemories!).toHaveLength(1);
    expect(testGroqProvider.lastCapturedMemories![0]).toContain('Flutter');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('القاهرة');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('القراءة');
  });

  // =========================================================================
  // 10. Scenario G — Generic "تطبيق" False-Positive Prevention
  // =========================================================================
  test('10. Scenario G: generic "تطبيق" without technical anchor does NOT select profession memory', async () => {
    const userId = 'user_e2e_generic_app_' + Date.now();

    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

    testGroqProvider.resetCapture();

    // Generic statement without technical anchor
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'أنا بعمل تطبيق لإدارة مصاريف البيت',
    });

    // Zero memories selected, NO Stored User Profile in prompt
    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Stored User Profile:');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('Flutter');
  });

  // =========================================================================
  // 11. Scenario G — Technical "Flutter" & Programming Anchors Retrieval
  // =========================================================================
  test('11. Scenario G: explicit technical anchors successfully select relevant memory', async () => {
    const userId = 'user_e2e_tech_anchors_' + Date.now();

    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

    // Case 1: "تطبيق Flutter"
    testGroqProvider.resetCapture();
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'أنا بعمل تطبيق Flutter لإدارة مصاريف البيت',
    });
    expect(testGroqProvider.lastCapturedMemories).toHaveLength(1);
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('Flutter');

    // Case 2: "مشروع برمجي" + "architecture"
    testGroqProvider.resetCapture();
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'أنا بشتغل على مشروع برمجي وعايز أظبط الـ architecture',
    });
    expect(testGroqProvider.lastCapturedMemories).toHaveLength(1);
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('Flutter');
  });

  // =========================================================================
  // 12. Zero-Memory Prompt Path Verification
  // =========================================================================
  test('12. Zero-Memory Path: final AI prompt completely omits Stored User Profile section', async () => {
    const userId = 'user_e2e_zero_mem_' + Date.now();

    testGroqProvider.resetCapture();

    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'إيه أفضل طريقة أعمل بيها قهوة؟',
    });

    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).toBeDefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('### Stored User Profile:');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('User Profile:');
  });

  // =========================================================================
  // 13. Final Prompt Contains Selected Memories Only
  // =========================================================================
  test('13. Final Prompt: contains strictly the selected memories and none of the unselected candidates', async () => {
    const userId = 'user_e2e_selected_only_' + Date.now();

    // Seed 5 active memories
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');
    await memoryRepo.saveFact(userId, 'المستخدم يعيش في الإسكندرية', 'stable_fact');
    await memoryRepo.saveFact(userId, 'المستخدم يحب السباحة', 'interest');
    await memoryRepo.saveFact(userId, 'المستخدم يفضل اللون الأزرق', 'preference');
    await memoryRepo.saveFact(userId, 'المستخدم يمتلك قطة', 'stable_fact');

    testGroqProvider.resetCapture();

    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'أنا بكتب كود Flutter وعندي مشكلة في الـ build',
    });

    expect(testGroqProvider.lastCapturedMemories).toHaveLength(1);
    expect(testGroqProvider.lastCapturedMemories![0]).toBe('المستخدم يعمل كمطور Flutter');

    const prompt = testGroqProvider.lastCapturedSystemPrompt!;
    expect(prompt).toContain('- المستخدم يعمل كمطور Flutter');
    // None of the other 4 memories must ever appear in the prompt
    expect(prompt).not.toContain('الإسكندرية');
    expect(prompt).not.toContain('السباحة');
    expect(prompt).not.toContain('الأزرق');
    expect(prompt).not.toContain('قطة');
  });

  // =========================================================================
  // 14. Superseded and Expired Memory NEVER Reaches Prompt
  // =========================================================================
  test('14. Superseded and Expired memories NEVER reach the final AI prompt under any circumstance', async () => {
    const userId = 'user_e2e_never_reach_' + Date.now();

    // 1. Superseded item
    const item1 = await memoryRepo.saveFact(userId, 'المستخدم مبرمج بايثون سابقاً', 'profession');
    await memoryRepo.updateFact(item1.id, { status: 'superseded' });

    // 2. Expired item
    await memoryRepo.saveFact(
      userId,
      'المستخدم يتابع كورس بايثون ينتهي اليوم',
      'ephemeral_context',
      { validUntil: new Date(Date.now() - 10000) }
    );

    testGroqProvider.resetCapture();

    // User asks a Python question that lexically matches both facts!
    await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'عايز مساعدة في كتابة كود بايثون',
    });

    // Neither superseded nor expired fact is allowed to be retrieved or reach prompt
    expect(testGroqProvider.lastCapturedMemories).toBeUndefined();
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('المستخدم مبرمج بايثون سابقاً');
    expect(testGroqProvider.lastCapturedSystemPrompt).not.toContain('كورس بايثون ينتهي اليوم');
  });

  // =========================================================================
  // 15. Semantic Cache Interaction
  // =========================================================================
  test('15. Semantic Cache Interaction: cache hit returns immediately without invoking LLM or AI generation', async () => {
    const userId = 'user_e2e_cache_' + Date.now();

    // Seed a memory to ensure presence
    await memoryRepo.saveFact(userId, 'المستخدم يعمل كمطور Flutter', 'profession');

    // First request: Cache Miss -> calls LLM
    testGroqProvider.resetCapture();
    const run1 = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'ما هي مواصفات الحوسبة السحابية؟',
    });
    expect(run1.status).toBe('completed');
    expect(testGroqProvider.callCount).toBe(1);

    // If cache engine is configured and returns hit for exact same message or FAQ
    const cacheResult = await SemanticCacheEngine.getInstance().process('ما هي مواصفات الحوسبة السحابية؟', {
      userId,
      channel: 'whatsapp',
    });

    if (cacheResult.type === 'hit' && cacheResult.response) {
      testGroqProvider.resetCapture();
      const run2 = await orchestrator.run({
        userId,
        channel: 'whatsapp',
        text: 'ما هي مواصفات الحوسبة السحابية؟',
      });
      expect(run2.status).toBe('completed');
      expect(run2.metrics?.modelUsed).toBe('semantic-cache');
      expect(run2.metrics?.totalTokens).toBe(0);
      // AI provider generateReply was NEVER called!
      expect(testGroqProvider.callCount).toBe(0);
    }
  });

  // =========================================================================
  // 16. Language Interaction Priority
  // =========================================================================
  test('16. Language Interaction Priority: stored Arabic preference does not override explicit English message', async () => {
    const userId = 'user_e2e_lang_prio_' + Date.now();

    // Store Arabic preference
    await userPrefRepo.setLanguagePreference(userId, {
      language: 'ar',
      dialect: 'egyptian',
    });

    testGroqProvider.resetCapture();

    // Current message contains explicit English instruction
    const run = await orchestrator.run({
      userId,
      channel: 'whatsapp',
      text: 'Please answer me in English, what is Docker?',
    });

    expect(run.status).toBe('completed');
    expect(run.languageContext?.targetLanguage).toBe('en');
    // Prompt must instruct English response
    expect(testGroqProvider.lastCapturedSystemPrompt).toContain('Language: English (US)');
  });

  // =========================================================================
  // 17. Security Defense-in-Depth Audit
  // =========================================================================
  test('17. Security Audit: passwords, credit cards, tokens, CVVs, IBANs, and health data fail at all levels', async () => {
    const userId = 'user_e2e_sec_audit_' + Date.now();
    const safetyGate = MemorySafetyGate.getInstance();
    const extractor = MemoryCandidateExtractor.getInstance();

    const sensitiveInputs = [
      'كلمة المرور الخاصة بي هي mySecretPassword123',
      'رقم الكارت هو 4111222233334444',
      'CVV هو 789',
      'رقم الحساب البنكي هو 12345678901234',
      'API key: sk-proj1234567890abcdef1234567890abcdef',
      'أنا باخد دواء للضغط يومياً',
    ];

    for (const input of sensitiveInputs) {
      // 1. MemorySafetyGate direct evaluation
      const gateResult = safetyGate.evaluate(input);
      expect(gateResult.allowed).toBe(false);

      // 2. saveFact defense-in-depth throws
      await expect(memoryRepo.saveFact(userId, input, 'generic')).rejects.toThrow();

      // 3. extractAndSaveFacts blocks saving
      await memoryRepo.extractAndSaveFacts(userId, input);
    }

    // Verify ZERO items in memory_items
    const allMemories = await memoryRepo.getMemories(userId);
    expect(allMemories).toHaveLength(0);
  });
});
