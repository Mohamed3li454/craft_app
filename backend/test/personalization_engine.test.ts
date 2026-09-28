/**
 * Test Suite: Phase 4 — True Personalization Engine
 *
 * Verifies all 13 core personalization and precedence scenarios:
 * 1. Explicit Preference
 * 2. Conflicting Current Instruction (Current Message Overrides Stored Preference)
 * 3. Relevant Technical Memory
 * 4. Irrelevant Technical Memory (Domain Withholding on Non-Technical Queries)
 * 5. Historical Memory (Historical Context Never Used as Active Preference)
 * 6. Temporary Context (Recent Turn Framing)
 * 7. Language Preference Integration
 * 8. Personality Preference Handling
 * 9. Multiple Harmonious Preferences
 * 10. Conflicting Tech Intent vs Memory (Current Intent Overrides Memory)
 * 11. No Personalization (Neutral Baseline)
 * 12. Zero Memory User
 * 13. Safety-Filtered / Inactive Memory
 */

import {
  PersonalizationEngine,
  buildPersonalizationPrompt,
  PersonalizationInput,
} from '../src/modules/personalization';

describe('Phase 4 — True Personalization Engine', () => {
  let engine: PersonalizationEngine;

  beforeEach(() => {
    engine = PersonalizationEngine.getInstance();
  });

  // Scenario 1: Explicit Preference
  test('Scenario 1 — Explicit Preference: Stored formality preference is respected without conflict', () => {
    const input: PersonalizationInput = {
      query: 'ما هي مواعيد العمل الرسمية؟',
      storedPreferences: {
        personality: {
          formality: 'formal',
        },
      },
    };

    const policy = engine.synthesizePolicy(input);

    expect(policy.formalityOverride).toBe('formal');
    const formalityDecision = policy.decisions.find((d) => d.dimension === 'formality');
    expect(formalityDecision).toBeDefined();
    expect(formalityDecision?.source).toBe('stored_preference');
    expect(formalityDecision?.appliedValue).toBe('formal');
  });

  // Scenario 2: Conflicting Current Instruction
  test('Scenario 2 — Conflicting Current Instruction: Explicit user instruction overrides stored verbosity', () => {
    const input: PersonalizationInput = {
      query: 'اشرح لي بالتفصيل الممل خطوة بخطوة كيف يعمل نظام التشفير',
      storedPreferences: {
        personality: {
          verbosity: 'concise', // Stored is concise
        },
      },
    };

    const policy = engine.synthesizePolicy(input);

    // Current message wins!
    expect(policy.verbosityOverride).toBe('comprehensive');
    expect(policy.explanationStyle).toBe('step_by_step');

    const verbosityDecision = policy.decisions.find((d) => d.dimension === 'verbosity');
    expect(verbosityDecision?.source).toBe('current_instruction');
    expect(verbosityDecision?.appliedValue).toBe('comprehensive');
    expect(verbosityDecision?.suppressedSignals).toHaveLength(1);
    expect(verbosityDecision?.suppressedSignals[0].source).toBe('stored_preference');
    expect(verbosityDecision?.suppressedSignals[0].value).toBe('concise');
  });

  // Scenario 3: Relevant Technical Memory
  test('Scenario 3 — Relevant Technical Memory: Active senior Flutter memory elevates depth and frames domain', () => {
    const input: PersonalizationInput = {
      query: 'ما هي أفضل ممارسة لهيكلة الـ state management والـ architecture في تطبيقي الكبير؟',
      retrievedMemories: [
        {
          factText: 'المستخدم يعمل كمطور برمجيات محترف Senior Flutter Architect',
          category: 'profession',
          lifecycleStatus: 'active',
          confidence: 0.95,
          importance: 'high',
          temporalState: 'current',
        },
      ],
    };

    const policy = engine.synthesizePolicy(input);

    expect(policy.technicalDepth).toBe('advanced');
    expect(policy.domainFraming).toBe('flutter');
    expect(policy.codeSnippetPolicy).toBe('concise');

    const prompt = buildPersonalizationPrompt(policy);
    expect(prompt).toContain('Advanced architectural level');
    expect(prompt).toContain('Flutter');
    expect(prompt).toContain('Negative Guardrails:');
  });

  // Scenario 4: Irrelevant Technical Memory
  test('Scenario 4 — Irrelevant Technical Memory: Non-technical query strictly withholds technical domain framing', () => {
    const input: PersonalizationInput = {
      query: 'ما هي مكونات كعكة الشوكولاتة وطريقة تحضيرها؟',
      retrievedMemories: [
        {
          factText: 'المستخدم مهندس برمجيات أول Senior Flutter Developer',
          category: 'profession',
          lifecycleStatus: 'active',
          confidence: 0.95,
          importance: 'high',
          temporalState: 'current',
        },
      ],
    };

    const policy = engine.synthesizePolicy(input);

    // Strict domain withholding: non-technical query must NOT mention Flutter or advanced code
    expect(policy.domainFraming).toBeNull();
    expect(policy.technicalDepth).toBe('foundational');
    expect(policy.codeSnippetPolicy).toBe('none');

    const domainDecision = policy.decisions.find((d) => d.dimension === 'domain_framing');
    expect(domainDecision?.appliedValue).toBe('none');
    expect(domainDecision?.suppressedSignals.length).toBeGreaterThan(0);
    expect(domainDecision?.suppressedSignals[0].reason).toContain('non-technical');

    const prompt = buildPersonalizationPrompt(policy);
    expect(prompt).not.toContain('Flutter');
    expect(prompt).toContain('STRICT DOMAIN SEPARATION');
  });

  // Scenario 5: Historical Memory
  test('Scenario 5 — Historical Memory: Historical facts are never used to frame current technical preferences', () => {
    const input: PersonalizationInput = {
      query: 'أريد ترقية بيئة التطوير والاعتماد على أدوات حديثة في الكود',
      retrievedMemories: [
        {
          factText: '[Historical] كان المستخدم يفضل العمل باستخدام Linux و Vim في 2019',
          category: 'technical_context',
          lifecycleStatus: 'active',
          confidence: 0.85,
          importance: 'normal',
          temporalState: 'historical', // Marked as historical
          isHistorical: true,
        },
      ],
    };

    const policy = engine.synthesizePolicy(input);

    // Historical memory must NOT be applied as current domain framing
    expect(policy.domainFraming).toBeNull();
    expect(policy.technicalDepth).toBe('intermediate');
  });

  // Scenario 6: Temporary Context
  test('Scenario 6 — Temporary Context: Recent turn technology informs technical domain framing', () => {
    const input: PersonalizationInput = {
      query: 'كيف أتعامل مع الـ Arrays والدوال البرمجية هنا؟',
      recentContext: [
        { role: 'user', content: 'أنا شغال على مشروع وبجرب لغة Python دلوقتي' },
        { role: 'assistant', content: 'ممتاز! بايثون لغة رائعة وقوية.' },
      ],
      retrievedMemories: [],
    };

    const policy = engine.synthesizePolicy(input);

    expect(policy.domainFraming).toBe('python');
    const domainDecision = policy.decisions.find((d) => d.dimension === 'domain_framing');
    expect(domainDecision?.source).toBe('current_context');
    expect(domainDecision?.appliedValue).toBe('python');
  });

  // Scenario 7: Language Preference Integration
  test('Scenario 7 — Language Preference: Stored preference is available, current query preserves autonomy', () => {
    const input: PersonalizationInput = {
      query: 'مرحبا، ما هي نصائحك لتنظيم الوقت؟',
      storedPreferences: {
        language: { language: 'en' },
        personality: { formality: 'casual' },
      },
    };

    const policy = engine.synthesizePolicy(input);

    // Formality is casual as per stored preference
    expect(policy.formalityOverride).toBe('casual');
    expect(policy.domainFraming).toBeNull();
  });

  // Scenario 8: Personality Preference Handling
  test('Scenario 8 — Personality Preference: Addressing style and formality preserved cleanly', () => {
    const input: PersonalizationInput = {
      query: 'أخبرني عن حالة الطقس المتوقعة اليوم',
      storedPreferences: {
        personality: {
          formality: 'formal',
          addressingStyle: 'respectful',
        },
      },
    };

    const policy = engine.synthesizePolicy(input);

    expect(policy.formalityOverride).toBe('formal');
    const formalityDecision = policy.decisions.find((d) => d.dimension === 'formality');
    expect(formalityDecision?.appliedValue).toBe('formal');
  });

  // Scenario 9: Multiple Harmonious Preferences
  test('Scenario 9 — Multiple Harmonious Preferences: Stored formal + runtime concise + no code combined', () => {
    const input: PersonalizationInput = {
      query: 'لخص لي مفهوم هندسة البيانات باختصار وبدون كود',
      storedPreferences: {
        personality: {
          formality: 'formal',
        },
      },
    };

    const policy = engine.synthesizePolicy(input);

    expect(policy.formalityOverride).toBe('formal');
    expect(policy.verbosityOverride).toBe('concise');
    expect(policy.codeSnippetPolicy).toBe('none');

    const prompt = buildPersonalizationPrompt(policy);
    expect(prompt).toContain('Do NOT include code snippets');
  });

  // Scenario 10: Conflicting Tech Intent vs Memory
  test('Scenario 10 — Conflicting Tech Intent: Current intent (Python) overrides stored memory (Flutter)', () => {
    const input: PersonalizationInput = {
      query: 'كيف أقوم بإنشاء دالة معالجة في Python باستخدام FastAPI؟',
      retrievedMemories: [
        {
          factText: 'المستخدم يعمل كمهندس تطبيقات فلاتر Flutter',
          category: 'profession',
          lifecycleStatus: 'active',
          confidence: 0.95,
          temporalState: 'current',
        },
      ],
    };

    const policy = engine.synthesizePolicy(input);

    // Current intent specifically asking about Python MUST win over Flutter memory!
    expect(policy.domainFraming).toBe('python');
    const domainDecision = policy.decisions.find((d) => d.dimension === 'domain_framing');
    expect(domainDecision?.source).toBe('current_intent');
    expect(domainDecision?.appliedValue).toBe('python');

    const suppressedFlutter = domainDecision?.suppressedSignals.find((s) => s.value.includes('Flutter'));
    expect(suppressedFlutter).toBeDefined();
    expect(suppressedFlutter?.reason).toContain('current intent specifically querying python');
  });

  // Scenario 11: No Personalization Triggered
  test('Scenario 11 — No Personalization: Brand new user with generic question receives baseline defaults', () => {
    const input: PersonalizationInput = {
      query: 'صباح الخير، كيف حالك؟',
    };

    const policy = engine.synthesizePolicy(input);

    expect(policy.technicalDepth).toBe('foundational');
    expect(policy.domainFraming).toBeNull();
    expect(policy.codeSnippetPolicy).toBe('none');
    expect(policy.verbosityOverride).toBeUndefined();
    expect(policy.formalityOverride).toBeUndefined();
  });

  // Scenario 12: Zero Memory User
  test('Scenario 12 — Zero Memory User: User has personality preferences but zero memories', () => {
    const input: PersonalizationInput = {
      query: 'ما هي مواعيد الصلاة في القاهرة؟',
      storedPreferences: {
        personality: {
          formality: 'formal',
          verbosity: 'concise',
        },
      },
      retrievedMemories: [],
    };

    const policy = engine.synthesizePolicy(input);

    expect(policy.formalityOverride).toBe('formal');
    expect(policy.verbosityOverride).toBe('concise');
    expect(policy.domainFraming).toBeNull();
    expect(policy.technicalDepth).toBe('foundational');
  });

  // Scenario 13: Safety-Filtered / Inactive Memory
  test('Scenario 13 — Safety-Filtered / Inactive Memory: Superseded or inactive memories are strictly excluded', () => {
    const input: PersonalizationInput = {
      query: 'كيف أقوم بتنظيم كود المشروع وهيكلته؟',
      retrievedMemories: [
        {
          factText: 'المستخدم ترك العمل في React وانتقل لتقنية أخرى',
          category: 'profession',
          lifecycleStatus: 'superseded', // Superseded
          confidence: 0.90,
          temporalState: 'historical',
        },
        {
          factText: 'كلمة مرور السيرفر الحساسة هي secret123',
          category: 'sensitive',
          lifecycleStatus: 'deleted', // Filtered / Deleted by safety gate
          confidence: 0.99,
        },
      ],
    };

    const policy = engine.synthesizePolicy(input);

    // No active valid memories -> domain framing remains null
    expect(policy.domainFraming).toBeNull();
    expect(policy.technicalDepth).toBe('intermediate');

    const prompt = buildPersonalizationPrompt(policy);
    expect(prompt).not.toContain('React');
    expect(prompt).not.toContain('secret123');
    expect(prompt).toContain('NEVER open or pad your response with forced retrospective phrases');
  });
});
