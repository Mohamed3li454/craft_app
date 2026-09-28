/**
 * Test Suite: Phase 5 — Conversation Intelligence Engine
 *
 * Verifies all 24 core conversation intelligence, topic tracking, follow-up detection,
 * context budgeting, and troubleshooting resolution scenarios:
 * 1. Single standalone question
 * 2. Simple follow-up
 * 3. Multi-turn follow-up
 * 4. Explicit topic continuation
 * 5. Topic switch
 * 6. Ambiguous short message
 * 7. Context-dependent question
 * 8. New topic after long discussion
 * 9. Troubleshooting flow
 * 10. Resolved troubleshooting
 * 11. Unresolved troubleshooting
 * 12. Planning conversation
 * 13. Implementation conversation
 * 14. Multiple topics in one session
 * 15. Temporary conversation context
 * 16. Memory + conversation context interaction
 * 17. Personalization + conversation context interaction
 * 18. Language + conversation context
 * 19. Empty conversation
 * 20. Long conversation / context budget limit
 * 21. Tool result followed by user question
 * 22. Search result followed by user question
 * 23. Contradictory conversation signals
 * 24. Stale context protection
 */

import {
  ConversationIntelligenceEngine,
  ContextWindowManager,
  ConversationMessage,
} from '../src/modules/conversation';

describe('Phase 5 — Conversation Intelligence Engine', () => {
  let engine: ConversationIntelligenceEngine;

  beforeEach(() => {
    engine = ConversationIntelligenceEngine.getInstance();
  });

  // Scenario 1: Single standalone question
  test('Scenario 1 — Single standalone question: Identifies complete question without follow-up requirement', () => {
    const state = engine.analyze({
      query: 'ما هو الفرق بين SQL و NoSQL في قواعد البيانات؟',
      recentMessages: [],
    });

    expect(state.isFollowUp).toBe(false);
    expect(state.requiresContext).toBe(false);
    expect(state.activeTopic).toBe('Databases');
    expect(state.goal).toBe('informational');
    expect(state.contextualizedQuery).toBe('ما هو الفرق بين SQL و NoSQL في قواعد البيانات؟');
  });

  // Scenario 2: Simple follow-up
  test('Scenario 2 — Simple follow-up: Detects context-dependent question and enriches contextualizedQuery', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'إزاي أعمل Caching في Express باستخدام Redis؟' },
      { role: 'assistant', text: 'يمكنك تثبيت redis وعمل middleware للتخزين المؤقت.' },
    ];

    const state = engine.analyze({
      query: 'وده أحطه فين في الكود؟',
      recentMessages,
      previousState: {
        activeTopic: 'Redis',
        topicHistory: [{ topic: 'Redis', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'إزاي أعمل Caching في Express باستخدام Redis؟',
        goal: 'implementation',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['Redis'],
        confidence: 0.9,
      },
    });

    expect(state.isFollowUp).toBe(true);
    expect(state.requiresContext).toBe(true);
    expect(state.activeTopic).toBe('Redis');
    expect(state.contextualizedQuery).toContain('Redis');
  });

  // Scenario 3: Multi-turn follow-up
  test('Scenario 3 — Multi-turn follow-up: Preserves topic continuity across 3 consecutive turns', () => {
    const turn1State = engine.analyze({
      query: 'عندي مشكلة في Flutter',
      recentMessages: [],
    });
    expect(turn1State.activeTopic).toBe('Flutter');

    const recentMessagesTurn2: ConversationMessage[] = [
      { role: 'user', text: 'عندي مشكلة في Flutter' },
      { role: 'assistant', text: 'ما هي المشكلة التي تواجهها؟' },
    ];
    const turn2State = engine.analyze({
      query: 'الـ build بيفشل لما أعمل compile',
      recentMessages: recentMessagesTurn2,
      previousState: turn1State,
    });
    expect(turn2State.activeTopic).toBe('Flutter');
    expect(turn2State.goal).toBe('troubleshooting');

    const recentMessagesTurn3: ConversationMessage[] = [
      ...recentMessagesTurn2,
      { role: 'user', text: 'الـ build بيفشل لما أعمل compile' },
      { role: 'assistant', text: 'تأكد من توافق إصدار الـ Gradle.' },
    ];
    const turn3State = engine.analyze({
      query: 'والـ error ده بيظهر في الـ release بس',
      recentMessages: recentMessagesTurn3,
      previousState: turn2State,
    });
    expect(turn3State.activeTopic).toBe('Flutter');
    expect(turn3State.isFollowUp).toBe(true);
    expect(turn3State.goal).toBe('troubleshooting');
  });

  // Scenario 4: Explicit topic continuation
  test('Scenario 4 — Explicit topic continuation: Connects explicitly linked query to active topic', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'كيف يعمل الـ BLoC pattern في Flutter؟' },
      { role: 'assistant', text: 'يعتمد BLoC على فصل الـ UI عن الـ Business Logic باستخدام Streams.' },
    ];

    const state = engine.analyze({
      query: 'وعلى نفس النقطة في Flutter، إزاي أنظم الـ Events والـ States؟',
      recentMessages,
      previousState: {
        activeTopic: 'Flutter',
        topicHistory: [{ topic: 'Flutter', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'كيف يعمل الـ BLoC pattern في Flutter؟',
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['Flutter'],
        confidence: 0.9,
      },
    });

    expect(state.isTopicSwitch).toBe(false);
    expect(state.activeTopic).toBe('Flutter');
  });

  // Scenario 5: Topic switch
  test('Scenario 5 — Topic switch: Detects explicit topic transition and updates state', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'إزاي أصلح الـ Flutter build error؟' },
      { role: 'assistant', text: 'قم بتحديث الـ Android NDK في ملف build.gradle.' },
    ];

    const state = engine.analyze({
      query: 'بالمناسبة، إيه أفضل database لمشروعي الجديد؟',
      recentMessages,
      previousState: {
        activeTopic: 'Flutter',
        topicHistory: [{ topic: 'Flutter', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'إزاي أصلح الـ Flutter build error؟',
        goal: 'troubleshooting',
        resolutionState: 'in_progress',
        unresolvedItems: ['إيرور البيلد'],
        sessionEntities: ['Flutter'],
        confidence: 0.9,
      },
    });

    expect(state.isTopicSwitch).toBe(true);
    expect(state.previousTopic).toBe('Flutter');
    expect(state.activeTopic).toBe('Databases');
    expect(state.goal).toBe('decision_support');
  });

  // Scenario 6: Ambiguous short message
  test('Scenario 6 — Ambiguous short message: "ليه؟" flagged as requiring context and linked to topic', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'هل تنصحني بـ MongoDB أم PostgreSQL لتطبيق بنكي؟' },
      { role: 'assistant', text: 'أنصحك بشدة بـ PostgreSQL لتوافر الـ ACID transactions الصارمة.' },
    ];

    const state = engine.analyze({
      query: 'ليه؟',
      recentMessages,
      previousState: {
        activeTopic: 'PostgreSQL',
        topicHistory: [{ topic: 'PostgreSQL', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'PostgreSQL',
        goal: 'decision_support',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['PostgreSQL'],
        confidence: 0.9,
      },
    });

    expect(state.isFollowUp).toBe(true);
    expect(state.requiresContext).toBe(true);
    expect(state.activeTopic).toBe('PostgreSQL');
    expect(state.contextualizedQuery).toContain('PostgreSQL');
  });

  // Scenario 7: Context-dependent question
  test('Scenario 7 — Context-dependent question: "هل ينفع أستخدمه هنا؟" binds to previous entity', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'ما هي مميزات Redis؟' },
      { role: 'assistant', text: 'سرعة الاستجابة الفائقة وتخزين البيانات في الذاكرة RAM.' },
    ];

    const state = engine.analyze({
      query: 'هل ينفع أستخدمه هنا كـ Session Store؟',
      recentMessages,
      previousState: {
        activeTopic: 'Redis',
        topicHistory: [{ topic: 'Redis', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'ما هي مميزات Redis؟',
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['Redis'],
        confidence: 0.9,
      },
    });

    expect(state.isFollowUp).toBe(true);
    expect(state.requiresContext).toBe(true);
    expect(state.contextualizedQuery).toContain('Redis');
  });

  // Scenario 8: New topic after long discussion
  test('Scenario 8 — New topic after long discussion: Switches cleanly without topic leakage', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'كيف أجهز Dockerfile للـ production؟' },
      { role: 'assistant', text: 'استخدم multi-stage build لتقليل حجم الـ Image.' },
      { role: 'user', text: 'وماذا عن الـ security scanning؟' },
      { role: 'assistant', text: 'استخدم أدوات مثل Trivy لفحص الثغرات.' },
    ];

    const state = engine.analyze({
      query: 'ما هي مقادير وطريقة عمل كعكة الشوكولاتة في المنزل؟',
      recentMessages,
      previousState: {
        activeTopic: 'Docker',
        topicHistory: [{ topic: 'Docker', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 3 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'Dockerfile',
        goal: 'implementation',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['Docker'],
        confidence: 0.9,
      },
    });

    expect(state.isTopicSwitch).toBe(true);
    expect(state.activeTopic).toBe('Cooking & Recipes');
    expect(state.previousTopic).toBe('Docker');
    expect(state.requiresContext).toBe(false);
  });

  // Scenario 9: Troubleshooting flow
  test('Scenario 9 — Troubleshooting flow: Error report initiates troubleshooting in unresolved state', () => {
    const state = engine.analyze({
      query: 'عندي مشكلة في webhook السيرفر وبيطلع لي 500 Internal Server Error',
      recentMessages: [],
    });

    expect(state.goal).toBe('troubleshooting');
    expect(state.resolutionState).toBe('unresolved');
    expect(state.unresolvedItems).toHaveLength(1);
    expect(state.activeTopic).toBe('Webhooks');
  });

  // Scenario 10: Resolved troubleshooting
  test('Scenario 10 — Resolved troubleshooting: User confirmation seals issue as resolved', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'الـ webhook بيطلع إيرور 500' },
      { role: 'assistant', text: 'تأكد من عمل JSON.parse للـ payload بشكل صحيح.' },
    ];

    const state = engine.analyze({
      query: 'اشتغل تمام تسلم المشكلة اتحلت!',
      recentMessages,
      previousState: {
        activeTopic: 'Webhooks',
        topicHistory: [{ topic: 'Webhooks', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: true,
        requiresContext: true,
        contextualizedQuery: 'الـ webhook بيطلع إيرور 500',
        goal: 'troubleshooting',
        resolutionState: 'in_progress',
        unresolvedItems: ['إيرور 500'],
        sessionEntities: ['Webhooks'],
        confidence: 0.9,
      },
    });

    expect(state.resolutionState).toBe('resolved');
    expect(state.unresolvedItems).toHaveLength(0);
  });

  // Scenario 11: Unresolved troubleshooting
  test('Scenario 11 — Unresolved troubleshooting: Error recurrence keeps state in_progress', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'الـ webhook بيطلع إيرور 500' },
      { role: 'assistant', text: 'تأكد من فحص الـ secret key.' },
    ];

    const state = engine.analyze({
      query: 'لسه نفس الإيرور 500 بيظهر ومش شغال',
      recentMessages,
      previousState: {
        activeTopic: 'Webhooks',
        topicHistory: [{ topic: 'Webhooks', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: true,
        requiresContext: true,
        contextualizedQuery: 'الـ webhook بيطلع إيرور 500',
        goal: 'troubleshooting',
        resolutionState: 'in_progress',
        unresolvedItems: ['إيرور 500'],
        sessionEntities: ['Webhooks'],
        confidence: 0.9,
      },
    });

    expect(state.goal).toBe('troubleshooting');
    expect(state.resolutionState).toBe('in_progress');
    expect(state.unresolvedItems).toHaveLength(1);
  });

  // Scenario 12: Planning conversation
  test('Scenario 12 — Planning conversation: Categorizes architectural planning query', () => {
    const state = engine.analyze({
      query: 'عايز أعمل خطة وتخطيط لهيكلة معمارية نظام microservices كبير',
      recentMessages: [],
    });

    expect(state.goal).toBe('planning');
    expect(state.activeTopic).toBe('Software Architecture');
  });

  // Scenario 13: Implementation conversation
  test('Scenario 13 — Implementation conversation: Categorizes direct code writing request', () => {
    const state = engine.analyze({
      query: 'اكتب كود كامل لدالة تشفير البيانات باستخدام AES في Node.js',
      recentMessages: [],
    });

    expect(state.goal).toBe('implementation');
    expect(state.activeTopic).toBe('Cryptography & Encryption');
  });

  // Scenario 14: Multiple topics in one session
  test('Scenario 14 — Multiple topics in one session: Accumulates topicHistory across transitions', () => {
    const state1 = engine.analyze({ query: 'عايز أتعلم Flutter', recentMessages: [] });
    const state2 = engine.analyze({
      query: 'وبالمناسبة إيه هو PostgreSQL؟',
      recentMessages: [{ role: 'user', text: 'عايز أتعلم Flutter' }, { role: 'assistant', text: 'فلاتر إطار ممتاز.' }],
      previousState: state1,
    });
    const state3 = engine.analyze({
      query: 'على جنب كده، فكرني بموعد الاجتماع بكرة',
      recentMessages: [
        { role: 'user', text: 'وبالمناسبة إيه هو PostgreSQL؟' },
        { role: 'assistant', text: 'قاعدة بيانات علائقية متطورة.' },
      ],
      previousState: state2,
    });

    expect(state3.topicHistory.length).toBeGreaterThanOrEqual(3);
    const topics = state3.topicHistory.map((t) => t.topic);
    expect(topics).toContain('Flutter');
    expect(topics).toContain('PostgreSQL');
    expect(topics).toContain('Reminders & Tasks');
  });

  // Scenario 15: Temporary conversation context
  test('Scenario 15 — Temporary conversation context: Tracks sessionEntities without permanent memory leakage', () => {
    const state = engine.analyze({
      query: 'أنا حالياً بجرب مكتبة Prisma في مشروعي التجريبي',
      recentMessages: [],
    });

    expect(state.sessionEntities).toContain('Prisma');
    expect(state.activeTopic).toBe('Prisma');
  });

  // Scenario 16: Memory + conversation context interaction
  test('Scenario 16 — Memory + Context: Follow-up query enriches contextualizedQuery for memory retrieval', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'أنا شغال على مشروع فلاتر كبير مع BLoC' },
      { role: 'assistant', text: 'ممتاز! تنظيم الـ BLoC يساعد على الاستقرار.' },
    ];

    const state = engine.analyze({
      query: 'وده يشتغل مع معماريته؟',
      recentMessages,
      previousState: {
        activeTopic: 'Flutter',
        topicHistory: [{ topic: 'Flutter', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'Flutter',
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['Flutter'],
        confidence: 0.9,
      },
    });

    expect(state.contextualizedQuery).toContain('Flutter');
  });

  // Scenario 17: Personalization + conversation context interaction
  test('Scenario 17 — Personalization + Context: Identifies troubleshooting goal to guide explanation depth', () => {
    const state = engine.analyze({
      query: 'عندي مشكلة عطل في السيرفر ومش عارف الخطوات المطلوبة',
      recentMessages: [],
    });

    expect(state.goal).toBe('troubleshooting');
  });

  // Scenario 18: Language + conversation context
  test('Scenario 18 — Language + Context: Preserves autonomy when user switches language in follow-up', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'كيف يعمل Redis؟' },
      { role: 'assistant', text: 'هو مخزن بيانات في الذاكرة.' },
    ];

    const state = engine.analyze({
      query: 'Where does it store keys in memory?',
      recentMessages,
      previousState: {
        activeTopic: 'Redis',
        topicHistory: [{ topic: 'Redis', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'كيف يعمل Redis؟',
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['Redis'],
        confidence: 0.9,
      },
    });

    expect(state.isFollowUp).toBe(true);
    expect(state.activeTopic).toBe('Redis');
  });

  // Scenario 19: Empty conversation
  test('Scenario 19 — Empty conversation: Initializes cleanly without previous context', () => {
    const state = engine.analyze({
      query: 'صباح الخير',
      recentMessages: [],
    });

    expect(state.isFollowUp).toBe(false);
    expect(state.requiresContext).toBe(false);
    expect(state.goal).toBe('casual');
    expect(state.topicHistory).toHaveLength(0);
  });

  // Scenario 20: Long conversation / context budget limit
  test('Scenario 20 — Context Budget: ContextWindowManager strictly bounds formatted history within 2500 chars', () => {
    const longMessages: ConversationMessage[] = [];
    for (let i = 0; i < 20; i++) {
      longMessages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: `هذه رسالة رقم ${i} تحتوي على نصوص تفصيلية وشروحات طويلة ومتكررة لملء السياق ببيانات كثيرة جداً للتأكد من ميزانية الحروف والـ tokens ${i}.`,
      });
    }

    const formatted = ContextWindowManager.formatHistory(longMessages, 'سؤال أخير بعد المحادثة الطويلة');
    const totalChars = formatted.reduce((sum, t) => sum + (typeof t.content === 'string' ? t.content.length : 0), 0);

    expect(totalChars).toBeLessThanOrEqual(ContextWindowManager.DEFAULT_MAX_CHARACTERS + 200);
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted[formatted.length - 1].content).toBe('سؤال أخير بعد المحادثة الطويلة');
  });

  // Scenario 21: Tool result followed by user question
  test('Scenario 21 — Tool result followed by user question: Strips internal tool traces from prompt window', () => {
    const messagesWithTools: ConversationMessage[] = [
      { role: 'user', text: 'فكرني باجتماع بكرة' },
      { role: 'assistant', text: 'Called tool: create_reminder with {"title":"اجتماع بكرة"}' },
      { role: 'tool', text: 'Tool [create_reminder] output: {"status":"success","id":"rem_123"}' },
      { role: 'assistant', text: 'تم ضبط التذكير بنجاح لموعد اجتماع الغد.' },
    ];

    const formatted = ContextWindowManager.formatHistory(messagesWithTools, 'تمام وعايز كمان تذكير بالليل');
    const texts = formatted.map((t) => t.content).join(' ');

    expect(texts).not.toContain('Called tool:');
    expect(texts).not.toContain('Tool [create_reminder]');
    expect(texts).toContain('تم ضبط التذكير بنجاح');
  });

  // Scenario 22: Search result followed by user question
  test('Scenario 22 — Search result follow-up: Contextualizes pricing follow-up query', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'ما هو سعر iPhone 16 في مصر؟' },
      { role: 'assistant', text: 'سعر آيفون 16 يبدأ من حوالي 48000 جنيه مصري حسب السعة.' },
    ];

    const state = engine.analyze({
      query: 'سعرو كام بره مصر بالدولار؟',
      recentMessages,
      previousState: {
        activeTopic: 'Product Pricing',
        topicHistory: [{ topic: 'Product Pricing', domain: 'general', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'ما هو سعر iPhone 16 في مصر؟',
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['Product Pricing'],
        confidence: 0.9,
      },
    });

    expect(state.isFollowUp).toBe(true);
    expect(state.requiresContext).toBe(true);
    expect(state.contextualizedQuery).toContain('Product Pricing');
  });

  // Scenario 23: Contradictory conversation signals
  test('Scenario 23 — Contradictory signals: Handles mixed continuation and new entity gracefully', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'مشروع React Native' },
      { role: 'assistant', text: 'رياكت نيتف ممتاز للتطبيقات.' },
    ];

    const state = engine.analyze({
      query: 'وعلى نفس السياق بالمناسبة، إيه رأيك في Flutter؟',
      recentMessages,
      previousState: {
        activeTopic: 'React Native',
        topicHistory: [{ topic: 'React Native', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 1 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'مشروع React Native',
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        sessionEntities: ['React Native'],
        confidence: 0.9,
      },
    });

    // Explicit switch marker "بالمناسبة" takes priority
    expect(state.isTopicSwitch).toBe(true);
    expect(state.activeTopic).toBe('Flutter');
  });

  // Scenario 24: Stale context protection
  test('Scenario 24 — Stale context protection: Resolved issue does not pollute new query', () => {
    const recentMessages: ConversationMessage[] = [
      { role: 'user', text: 'عندي إيرور 500 في الويب هوك' },
      { role: 'assistant', text: 'أصلحنا الـ middleware.' },
      { role: 'user', text: 'اشتغل تمام تسلم المشكلة اتحلت!' },
      { role: 'assistant', text: 'الحمد لله، تحت أمرك دائماً.' },
    ];

    const state = engine.analyze({
      query: 'عايز أسألك عن أفضل طريقة لتقسيم الكود إلى موديولات',
      recentMessages,
      previousState: {
        activeTopic: 'Webhooks',
        topicHistory: [{ topic: 'Webhooks', domain: 'technical', startedAtTurnIndex: 0, lastSeenAtTurnIndex: 3 }],
        isTopicSwitch: false,
        previousTopic: null,
        isFollowUp: false,
        requiresContext: false,
        contextualizedQuery: 'اشتغل تمام تسلم',
        goal: 'troubleshooting',
        resolutionState: 'resolved',
        unresolvedItems: [],
        sessionEntities: ['Webhooks'],
        confidence: 0.9,
      },
    });

    expect(state.resolutionState).toBe('not_applicable');
    expect(state.unresolvedItems).toHaveLength(0);
    expect(state.goal).toBe('planning');
  });
});
