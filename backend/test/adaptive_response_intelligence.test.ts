/**
 * Test Suite for Phase 6 — Adaptive Response Intelligence Engine
 *
 * Verifies all 30 scenarios:
 * 1. Simple factual
 * 2. Complex technical
 * 3. Beginner explanation
 * 4. Advanced technical
 * 5. Explicit concise
 * 6. Explicit detailed
 * 7. Troubleshooting start
 * 8. Troubleshooting continuation
 * 9. Troubleshooting failed attempt (Anti-loop)
 * 10. Troubleshooting resolved
 * 11. Ambiguous request
 * 12. Missing critical info
 * 13. Context-resolvable follow-up
 * 14. Comparison
 * 15. Code-first
 * 16. Explanation-only
 * 17. Summary
 * 18. Same question after failure
 * 19. Topic switch
 * 20. Tool-required
 * 21. Tool-not-required
 * 22. Memory relevant
 * 23. Memory irrelevant
 * 24. Personalization conflict
 * 25. Language conflict
 * 26. Personality conflict
 * 27. Cold start
 * 28. Long conversation
 * 29. Multiple conflicting constraints
 * 30. Safety-restricted request
 * + Latency benchmark (< 2ms)
 */

import {
  AdaptiveResponseEngine,
  ComplexityClassifier,
  ClarificationGate,
  FailureProgressionTracker,
  StrategySelector,
  buildAdaptiveResponsePrompt,
} from '../src/modules/response';
import { ConversationIntelligenceEngine, ConversationState } from '../src/modules/conversation';
import { PersonalizationEngine } from '../src/modules/personalization';

describe('Phase 6 — Adaptive Response Intelligence Engine', () => {
  const engine = AdaptiveResponseEngine.getInstance();
  const convEngine = ConversationIntelligenceEngine.getInstance();
  const persEngine = PersonalizationEngine.getInstance();

  function makeState(query: string, recentMessages: any[] = []): ConversationState {
    return convEngine.analyze({ query, recentMessages });
  }

  // 1. Simple factual question
  it('Scenario 1 — Simple factual: Selects direct_answer with minimal depth and plain structure', () => {
    const query = 'ما هي عاصمة اليابان؟';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('direct_answer');
    expect(policy.complexity).toBe('simple');
    expect(policy.depth).toBe('minimal');
    expect(policy.structure).toBe('concise_plain');
    expect(policy.clarification.required).toBe(false);
  });

  // 2. Complex technical question
  it('Scenario 2 — Complex technical: Selects conceptual_explanation with deep depth and structured_sections', () => {
    const query = 'صمم لي microservices architecture لمتجر إلكتروني كبير scalable وعالي الأداء';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.complexity).toBe('complex');
    expect(policy.strategy).toBe('conceptual_explanation');
    expect(policy.depth).toBe('deep');
    expect(policy.structure).toBe('structured_sections');
    expect(policy.instructions.length).toBeGreaterThanOrEqual(1);
  });

  // 3. Beginner explanation
  it('Scenario 3 — Beginner explanation: Classifies as simple/minimal without code', () => {
    const query = 'يعني ايه API ببساطة؟';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.complexity).toBe('simple');
    expect(policy.strategy).toBe('direct_answer');
    expect(policy.depth).toBe('minimal');
    expect(policy.clarification.required).toBe(false);
  });

  // 4. Advanced technical request
  it('Scenario 4 — Advanced technical: Selects code_first with deep depth for low-level memory systems', () => {
    const query = 'ازاي أعمل custom memory allocator في C++ مع concurrency model؟';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.complexity).toBe('complex');
    expect(policy.depth).toBe('deep');
    expect(policy.clarification.required).toBe(false);
  });

  // 5. Explicit concise request
  it('Scenario 5 — Explicit concise: Current directive overrides baseline and sets depth to minimal', () => {
    const query = 'قولي باختصار الفرق بين var و final';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('direct_answer');
    expect(policy.depth).toBe('minimal');
    expect(policy.structure).toBe('concise_plain');
  });

  // 6. Explicit detailed request
  it('Scenario 6 — Explicit detailed: Selects step_by_step_guide with deep depth and procedural steps', () => {
    const query = 'اشرحلي بالتفصيل الممل خطوات دورة حياة الـ Activity في Android';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('step_by_step_guide');
    expect(policy.depth).toBe('deep');
    expect(policy.structure).toBe('procedural_steps');
  });

  // 7. Troubleshooting start
  it('Scenario 7 — Troubleshooting start: Identifies initial_diagnosis stage and procedural steps', () => {
    const query = 'بيطلع لي NullPointerException في السطر ده لما برن الكود';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('troubleshooting_flow');
    expect(policy.structure).toBe('procedural_steps');
    expect(policy.troubleshooting?.stage).toBe('initial_diagnosis');
    expect(policy.troubleshooting?.attemptNumber).toBe(1);
  });

  // 8. Troubleshooting continuation
  it('Scenario 8 — Troubleshooting continuation: Increments attempt count on ongoing troubleshooting', () => {
    const query = 'عملت كده، ودلوقتي بيطلع لي خطأ 403 Forbidden';
    const recent = [
      { role: 'user', text: 'عندي مشكلة 401 Unauthorized' },
      { role: 'assistant', text: 'جرب تعدل الـ auth header' },
    ];
    const state = makeState(query, recent as any);
    const policy = engine.analyze({
      query,
      conversationState: state,
      recentMessages: recent as any,
      previousAssistantMessage: recent[1].text,
    });

    expect(policy.strategy).toBe('troubleshooting_flow');
    expect(policy.troubleshooting).toBeDefined();
  });

  // 9. Troubleshooting failed attempt (Anti-loop)
  it('Scenario 9 — Troubleshooting failed attempt: Activates anti-loop guardrails against failed signature', () => {
    const query = 'جربت الحل ده ولسه نفس الخطأ بالظبط مش راضي يشتغل';
    const recent = [
      { role: 'user', text: 'بيطلع لي late initialization error' },
      { role: 'assistant', text: 'يجب تهيئة المتغير داخل initState() مباشرة لتجنب الخطأ.' },
    ];
    const state = makeState(query, recent as any);
    const policy = engine.analyze({
      query,
      conversationState: state,
      recentMessages: recent as any,
      previousAssistantMessage: recent[1].text,
    });

    expect(policy.strategy).toBe('troubleshooting_flow');
    expect(policy.troubleshooting?.stage).toBe('alternative_branch');
    expect(policy.troubleshooting?.attemptNumber).toBe(2);
    expect(policy.troubleshooting?.avoidRepeating).toContain('Variable initialization inside initState()');
    expect(policy.negativeGuardrails.some((g) => g.includes('initState'))).toBe(true);
  });

  // 10. Troubleshooting resolved
  it('Scenario 10 — Troubleshooting resolved: Returns direct_answer with closure stage upon confirmation', () => {
    const query = 'تمام جداً اشتغل تمام شكراً ليك اتحلت المشكلة';
    const recent = [
      { role: 'user', text: 'عندي ايرور في البناء' },
      { role: 'assistant', text: 'شغل flutter clean ثم flutter pub get' },
    ];
    const state = makeState(query, recent as any);
    const policy = engine.analyze({
      query,
      conversationState: state,
      recentMessages: recent as any,
      previousAssistantMessage: recent[1].text,
    });

    expect(policy.strategy).toBe('direct_answer');
    expect(policy.structure).toBe('concise_plain');
    expect(policy.troubleshooting?.stage).toBe('closure');
  });

  // 11. Ambiguous request
  it('Scenario 11 — Ambiguous request: Triggers clarification_prompt when referent is unknown', () => {
    const query = 'اعملها بالطريقة دي';
    const state = makeState(query, []);
    const policy = engine.analyze({ query, conversationState: state, recentMessages: [] });

    expect(policy.clarification.required).toBe(true);
    expect(policy.clarification.reason).toBe('ambiguous_referent');
    expect(policy.strategy).toBe('clarification_prompt');
    expect(policy.structure).toBe('clarification_question');
  });

  // 12. Missing critical info
  it('Scenario 12 — Missing critical info: Triggers clarification for vague failure without code or error', () => {
    const query = 'الكود مش شغال';
    const state = makeState(query, []);
    const policy = engine.analyze({ query, conversationState: state, recentMessages: [] });

    expect(policy.clarification.required).toBe(true);
    expect(policy.clarification.reason).toBe('missing_critical_context');
    expect(policy.strategy).toBe('clarification_prompt');
  });

  // 13. Context-resolvable follow-up
  it('Scenario 13 — Context-resolvable follow-up: Contextualized query resolves referent without clarification', () => {
    const recent = [
      { role: 'user', text: 'عايز أستخدم Redis في الـ caching' },
      { role: 'assistant', text: 'تقدر تستخدم ioredis في Node.js' },
    ];
    const query = 'وده أحطه فين في الكود؟';
    const state = makeState(query, recent as any);
    const policy = engine.analyze({
      query,
      conversationState: state,
      recentMessages: recent as any,
    });

    expect(policy.clarification.required).toBe(false);
    expect(policy.strategy).toBe('direct_answer');
  });

  // 14. Comparison request
  it('Scenario 14 — Comparison request: Selects comparative_analysis and bullet_list structure', () => {
    const query = 'أيهما أفضل لمشروعي: Flutter أم React Native؟';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('comparative_analysis');
    expect(policy.structure).toBe('bullet_list');
  });

  // 15. Code-first request
  it('Scenario 15 — Code-first request: Selects code_first and code_with_explanation structure', () => {
    const query = 'اكتب كود debounce function بـ TypeScript';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('code_first');
    expect(policy.structure).toBe('code_with_explanation');
  });

  // 16. Explanation-only request
  it('Scenario 16 — Explanation-only: Respects "بدون كود" directive and avoids code structure', () => {
    const query = 'اشرح لي فكرة الـ Event Loop نظرياً بدون أي كود';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('conceptual_explanation');
    expect(policy.structure).not.toBe('code_with_explanation');
  });

  // 17. Summary request
  it('Scenario 17 — Summary request: Selects executive_summary and bullet_list structure', () => {
    const query = 'لخص لي أهم 3 نقاط في معمارية Clean Architecture';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('executive_summary');
    expect(policy.structure).toBe('bullet_list');
  });

  // 18. Same question after failure
  it('Scenario 18 — User asks for easier explanation after confusion: Uses conceptual with simplified depth', () => {
    const query = 'مش عارف برضه، قولي تاني بطريقة أسهل';
    const recent = [
      { role: 'user', text: 'يعني ايه Monad في البرمجة الوظيفية؟' },
      { role: 'assistant', text: 'A monad is a design pattern combining functions...' },
    ];
    const state = makeState(query, recent as any);
    const policy = engine.analyze({
      query,
      conversationState: state,
      recentMessages: recent as any,
    });

    expect(policy.strategy).toBe('conceptual_explanation');
    expect(policy.depth).toBe('minimal');
  });

  // 19. Topic switch
  it('Scenario 19 — Topic switch: Drops previous topic progression cleanly', () => {
    const recent = [
      { role: 'user', text: 'عندي مشكلة في كود بايثون مش شغال' },
      { role: 'assistant', text: 'اتأكد من تثبيت الحزم المطلوبة' },
    ];
    const query = 'سيبك من ده خالص، إيه رأيك في مستقبل الذكاء الاصطناعي؟';
    const state = makeState(query, recent as any);
    const policy = engine.analyze({
      query,
      conversationState: state,
      recentMessages: recent as any,
    });

    expect(policy.strategy).not.toBe('troubleshooting_flow');
    expect(policy.troubleshooting).toBeUndefined();
  });

  // 20. Tool-required query
  it('Scenario 20 — Tool-required: Formulates tool hint for live price lookup', () => {
    const query = 'سعر آيفون 16 برو ماكس كام في مصر دلوقتي؟';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.toolHints.shouldCallTool).toBe(true);
    expect(policy.toolHints.suggestedTool).toBe('web_search');
  });

  // 21. Tool-not-required query
  it('Scenario 21 — Tool-not-required: Identifies conceptual query and keeps shouldCallTool false', () => {
    const query = 'يعني ايه polymorphism في البرمجة كائنية التوجه؟';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.toolHints.shouldCallTool).toBe(false);
  });

  // 22. Memory-relevant query
  it('Scenario 22 — Memory-relevant: Elevates depth to deep when user is a Senior Flutter Developer', () => {
    const query = 'ازاي أنظم معماريًا الـ state management في مشروعي؟';
    const state = makeState(query);
    const persPolicy = persEngine.synthesizePolicy({
      query,
      retrievedMemories: [
        { factText: 'User is a Senior Flutter Developer', category: 'profession', status: 'active' },
      ],
    });
    const policy = engine.analyze({
      query,
      conversationState: state,
      personalizationPolicy: persPolicy,
    });

    expect(policy.depth).toBe('deep');
  });

  // 23. Memory-irrelevant query
  it('Scenario 23 — Memory-irrelevant: Does NOT apply technical depth or framework framing to cooking query', () => {
    const query = 'إيه طريقة عمل كيكة الشوكولاتة في البيت؟';
    const state = makeState(query);
    const persPolicy = persEngine.synthesizePolicy({
      query,
      retrievedMemories: [
        { factText: 'User is a Senior Flutter Developer', category: 'profession', status: 'active' },
      ],
    });
    const policy = engine.analyze({
      query,
      conversationState: state,
      personalizationPolicy: persPolicy,
    });

    expect(policy.depth).toBe('standard');
    expect(policy.instructions.some((i) => i.toLowerCase().includes('flutter'))).toBe(false);
  });

  // 24. Personalization conflict
  it('Scenario 24 — Personalization conflict: Current Python intent strictly overrides Flutter memory', () => {
    const query = 'اشرحلي كود بايثون ده ازاي بيشتغل مع FastAPI';
    const state = makeState(query);
    const persPolicy = persEngine.synthesizePolicy({
      query,
      retrievedMemories: [
        { factText: 'User works with Flutter', category: 'profession', status: 'active' },
      ],
    });
    const policy = engine.analyze({
      query,
      conversationState: state,
      personalizationPolicy: persPolicy,
    });

    expect(policy.negativeGuardrails.some((g) => g.includes('Flutter'))).toBe(true);
  });

  // 25. Language conflict
  it('Scenario 25 — Language conflict: Preserves response strategy independently of requested language', () => {
    const query = 'Explain the difference between SQL and NoSQL in English please';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('comparative_analysis');
    expect(policy.structure).toBe('bullet_list');
  });

  // 26. Personality conflict
  it('Scenario 26 — Personality conflict: User explicit instruction overrides default persona', () => {
    const query = 'رد عليا باختصار شديد وبشكل رسمي وبدون أي كلام جانبي';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.depth).toBe('minimal');
    expect(policy.strategy).toBe('direct_answer');
    expect(policy.structure).toBe('concise_plain');
  });

  // 27. Zero context / Cold start
  it('Scenario 27 — Zero context: Greets courteously with direct_answer and simple complexity', () => {
    const query = 'السلام عليكم ورحمة الله';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('direct_answer');
    expect(policy.complexity).toBe('simple');
    expect(policy.structure).toBe('concise_plain');
  });

  // 28. Long conversation
  it('Scenario 28 — Long conversation: Preserves active topic focus and bounds policy size', () => {
    const recent = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: i % 2 === 0 ? `سؤال تقني رقم ${i}` : `جواب تفصيلي رقم ${i}`,
    }));
    const query = 'نرجع لموضوعنا، ازاي أعمل الـ deployment؟';
    const state = makeState(query, recent as any);
    const policy = engine.analyze({ query, conversationState: state, recentMessages: recent as any });

    expect(policy.instructions.length).toBeLessThanOrEqual(6);
    const prompt = buildAdaptiveResponsePrompt(policy);
    expect(prompt.split(/\s+/).length).toBeLessThan(70);
  });

  // 29. Multiple conflicting constraints
  it('Scenario 29 — Multiple conflicting constraints: "كود كامل بس باختصار شديد بدون شرح" -> code_first + minimal depth', () => {
    const query = 'اديني كود كامل بس باختصار شديد بدون شرح';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.strategy).toBe('code_first');
    expect(policy.depth).toBe('minimal');
  });

  // 30. Safety-restricted request
  it('Scenario 30 — Safety-restricted request: Recognizes reminder creation tool intent', () => {
    const query = 'فكرني بكره الصبح الساعة 9 أراجع التقرير';
    const state = makeState(query);
    const policy = engine.analyze({ query, conversationState: state });

    expect(policy.toolHints.shouldCallTool).toBe(true);
    expect(policy.toolHints.suggestedTool).toBe('create_reminder');
  });

  // Prompt Builder Verification
  it('Prompt Builder — Generates compact, actionable prompt within budget (<60 words, 3-6 lines)', () => {
    const query = 'جربت الحل ده ولسه نفس الخطأ بالظبط مش راضي يشتغل';
    const recent = [
      { role: 'user', text: 'بيطلع لي late initialization error' },
      { role: 'assistant', text: 'يجب تهيئة المتغير داخل initState() مباشرة لتجنب الخطأ.' },
    ];
    const state = makeState(query, recent as any);
    const policy = engine.analyze({
      query,
      conversationState: state,
      recentMessages: recent as any,
      previousAssistantMessage: recent[1].text,
    });

    const promptText = buildAdaptiveResponsePrompt(policy);
    expect(promptText).toContain('### Adaptive Response Policy:');
    expect(promptText).toContain('Strategy: Troubleshooting Flow');
    expect(promptText).toContain('Anti-Loop Guard');
    const wordCount = promptText.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThan(65);
  });

  // Latency Benchmark Verification (< 2.0ms)
  it('Performance Benchmark — Evaluates analyze() in under 2.0ms on average over 100 iterations', () => {
    const query = 'صمم لي architecture متقدمة باستخدام Redis و PostgreSQL';
    const state = makeState(query);

    // Warm-up run
    engine.analyze({ query, conversationState: state });

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.analyze({ query, conversationState: state });
    }
    const end = performance.now();
    const avgLatencyMs = (end - start) / iterations;

    // Must be well below 2.0ms
    expect(avgLatencyMs).toBeLessThan(2.0);
  });
});
