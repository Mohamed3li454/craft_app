/**
 * Golden Evaluation Dataset (Phase 8.5)
 *
 * Contains 56 deterministic evaluation scenarios covering all core architecture
 * subsystems: Memory, Conversation, Personalization, Adaptive Response, Agent,
 * Provider Abstraction, and Proactive Intelligence.
 */

import { EvaluationCase } from './types';

export const GOLDEN_EVALUATION_DATASET: EvaluationCase[] = [
  // =========================================================================
  // 1. Memory Subsystem (Cases 1 - 8)
  // =========================================================================
  {
    id: 'mem_01',
    name: 'Relevant memory selected for technical query',
    category: 'memory',
    input: 'How do I optimize Riverpod rebuilds in Flutter?',
    context: {
      memories: [
        { id: 'm1', content: 'Senior Flutter Developer with 5 years experience', active: true, confidence: 0.9 },
        { id: 'm2', content: 'Prefers vegetarian cooking recipes', active: true, confidence: 0.8 },
      ],
    },
    expected: {
      memoryUsage: 'required',
      expectedDepth: 'deep',
    },
    tags: ['memory', 'relevance', 'selection'],
  },
  {
    id: 'mem_02',
    name: 'Irrelevant memory excluded for non-technical query',
    category: 'memory',
    input: 'What is a good recipe for lentil soup?',
    context: {
      memories: [
        { id: 'm1', content: 'Senior Flutter Developer with 5 years experience', active: true, confidence: 0.9 },
      ],
    },
    expected: {
      memoryUsage: 'none',
    },
    tags: ['memory', 'filtering', 'data-minimization'],
  },
  {
    id: 'mem_03',
    name: 'Historical memory not framed as current framework',
    category: 'memory',
    input: 'What state management should I use for a new Python project?',
    context: {
      memories: [
        { id: 'm1', content: 'Used to write Django in 2019', active: true, confidence: 0.85, isHistorical: true },
      ],
    },
    expected: {
      memoryUsage: 'none',
    },
    tags: ['memory', 'temporal', 'historical'],
  },
  {
    id: 'mem_04',
    name: 'Semantic contradiction prefers latest runtime preference',
    category: 'memory',
    input: 'Write this solution in TypeScript without classes',
    context: {
      memories: [
        { id: 'm1', content: 'Prefers Object-Oriented Class patterns', active: true, confidence: 0.7 },
      ],
    },
    expected: {
      strategy: 'code_first',
    },
    tags: ['memory', 'contradiction', 'runtime-override'],
  },
  {
    id: 'mem_05',
    name: 'Low confidence memory filtered out by safety gate',
    category: 'memory',
    input: 'Remind me of my favorite IDE',
    context: {
      memories: [
        { id: 'm1', content: 'Might use Vim occasionally', active: true, confidence: 0.3 },
      ],
    },
    expected: {
      memoryUsage: 'none',
    },
    tags: ['memory', 'confidence', 'threshold'],
  },
  {
    id: 'mem_06',
    name: 'Preference isolation keeps transient session facts out of profile',
    category: 'memory',
    input: 'I am currently sitting in Terminal 2 at Cairo Airport',
    context: {
      sessionEntity: 'Cairo Airport Terminal 2',
    },
    expected: {
      memoryUsage: 'none',
    },
    tags: ['memory', 'isolation', 'transient'],
  },
  {
    id: 'mem_07',
    name: 'Dynamic importance retains critical facts in bounded budget',
    category: 'memory',
    input: 'What was my company name again?',
    context: {
      memories: [
        { id: 'm1', content: 'Company name is Craft Tech LLC', active: true, confidence: 0.95, importance: 0.9 },
      ],
    },
    expected: {
      memoryUsage: 'required',
    },
    tags: ['memory', 'importance', 'budget'],
  },
  {
    id: 'mem_08',
    name: 'Inactive memory withheld by safety gate',
    category: 'memory',
    input: 'Where do I live?',
    context: {
      memories: [
        { id: 'm1', content: 'Lives in London', active: false, confidence: 0.9 },
      ],
    },
    expected: {
      memoryUsage: 'none',
      blockedReason: 'inactive',
    },
    tags: ['memory', 'safety', 'lifecycle'],
  },

  // =========================================================================
  // 2. Conversation Subsystem (Cases 9 - 16)
  // =========================================================================
  {
    id: 'conv_01',
    name: 'Standalone complete query needs no follow-up resolution',
    category: 'conversation',
    input: 'What is the capital of France?',
    expected: {
      strategy: 'direct_answer',
      clarification: false,
    },
    tags: ['conversation', 'standalone'],
  },
  {
    id: 'conv_02',
    name: 'Context-dependent follow-up query contextualizes previous entity',
    category: 'conversation',
    input: 'How much does it cost?',
    context: {
      recentTopic: 'iPhone 15 Pro Max',
    },
    expected: {
      clarification: false,
      toolCalls: ['web_search'],
    },
    tags: ['conversation', 'contextualization'],
  },
  {
    id: 'conv_03',
    name: 'Multi-turn topic continuation preserves active thread',
    category: 'conversation',
    input: 'And what about battery life?',
    context: {
      activeTopic: 'iPhone 15 Pro Max',
      turnCount: 3,
    },
    expected: {
      strategy: 'direct_answer',
    },
    tags: ['conversation', 'continuation'],
  },
  {
    id: 'conv_04',
    name: 'Explicit topic switch cleanly drops previous focus',
    category: 'conversation',
    input: 'Moving on to another topic, let us discuss Docker compose.',
    context: {
      activeTopic: 'iPhone 15 Pro Max',
    },
    expected: {
      strategy: 'direct_answer',
    },
    tags: ['conversation', 'topic-switch'],
  },
  {
    id: 'conv_05',
    name: 'Ambiguous short message resolved using prior message context',
    category: 'conversation',
    input: 'ليه؟',
    context: {
      previousAssistantReply: 'We recommend PostgreSQL over MongoDB for structured financial data.',
    },
    expected: {
      clarification: false,
    },
    tags: ['conversation', 'ambiguity-resolution'],
  },
  {
    id: 'conv_06',
    name: 'Error report initiates structured troubleshooting',
    category: 'conversation',
    input: 'Unhandled Exception: Null check operator used on a null value in user_profile.dart:45',
    expected: {
      strategy: 'initial_diagnosis',
    },
    tags: ['conversation', 'troubleshooting'],
  },
  {
    id: 'conv_07',
    name: 'User confirmation closes active troubleshooting thread',
    category: 'conversation',
    input: 'Thanks! That fixed the problem completely.',
    context: {
      troubleshootingState: 'in_progress',
    },
    expected: {
      strategy: 'direct_answer',
      outcome: 'resolved',
    },
    tags: ['conversation', 'resolution'],
  },
  {
    id: 'conv_08',
    name: 'Context window bounds formatted history within token budget',
    category: 'conversation',
    input: 'Summarize our conversation',
    context: {
      messageCount: 50,
    },
    expected: {
      strategy: 'executive_summary',
    },
    tags: ['conversation', 'budget'],
  },

  // =========================================================================
  // 3. Personalization Subsystem (Cases 17 - 24)
  // =========================================================================
  {
    id: 'pers_01',
    name: 'Technical depth elevated for senior developer persona',
    category: 'personalization',
    input: 'Explain how Node.js event loop handles libuv thread pool tasks',
    context: {
      userRole: 'senior_developer',
    },
    expected: {
      expectedDepth: 'deep',
    },
    tags: ['personalization', 'technical-depth'],
  },
  {
    id: 'pers_02',
    name: 'Explicit runtime instruction overrides stored formality preference',
    category: 'personalization',
    input: 'جاوبني بالعامية المصرية وبشكل غير رسمي تماماً',
    context: {
      storedPreference: { formality: 'formal' },
    },
    expected: {
      strategy: 'direct_answer',
    },
    tags: ['personalization', 'override'],
  },
  {
    id: 'pers_03',
    name: 'Preference conflict strictly resolves to runtime directive',
    category: 'personalization',
    input: 'اشرح بدون كود نهائياً',
    context: {
      storedPreference: { codePreference: 'code_first' },
    },
    expected: {
      forbiddenTools: [],
    },
    tags: ['personalization', 'conflict'],
  },
  {
    id: 'pers_04',
    name: 'Anti-overpersonalization does not frame cooking in tech terms',
    category: 'personalization',
    input: 'How to bake sourdough bread?',
    context: {
      storedPreference: { domain: 'flutter_tech' },
    },
    expected: {
      strategy: 'step_by_step_guide',
    },
    tags: ['personalization', 'anti-overpersonalization'],
  },
  {
    id: 'pers_05',
    name: 'Formality preference respected when no conflicting instruction',
    category: 'personalization',
    input: 'What are the office hours for the embassy?',
    context: {
      storedPreference: { formality: 'formal' },
    },
    expected: {
      strategy: 'direct_answer',
    },
    tags: ['personalization', 'formality'],
  },
  {
    id: 'pers_06',
    name: 'Language autonomy preserved when user changes input language',
    category: 'personalization',
    input: 'Please write the summary in English',
    context: {
      nativeLanguage: 'ar',
    },
    expected: {
      strategy: 'executive_summary',
    },
    tags: ['personalization', 'language-autonomy'],
  },
  {
    id: 'pers_07',
    name: 'Personality addressing style preserved',
    category: 'personalization',
    input: 'Good morning Craft',
    context: {
      addressingStyle: 'polite',
    },
    expected: {
      strategy: 'direct_answer',
    },
    tags: ['personalization', 'addressing'],
  },
  {
    id: 'pers_08',
    name: 'Zero memory user receives safe baseline defaults',
    category: 'personalization',
    input: 'What can you help me with?',
    context: {
      memories: [],
      preferences: {},
    },
    expected: {
      strategy: 'direct_answer',
      memoryUsage: 'none',
    },
    tags: ['personalization', 'defaults'],
  },

  // =========================================================================
  // 4. Adaptive Response Subsystem (Cases 25 - 32)
  // =========================================================================
  {
    id: 'resp_01',
    name: 'Direct answer for simple factual query',
    category: 'adaptive_response',
    input: 'كم عدد قارات العالم؟',
    expected: {
      strategy: 'direct_answer',
    },
    tags: ['adaptive_response', 'direct'],
  },
  {
    id: 'resp_02',
    name: 'Step-by-step guide for procedural tutorial',
    category: 'adaptive_response',
    input: 'خطوات تثبيت Flutter SDK على نظام Mac خطوة بخطوة',
    expected: {
      strategy: 'step_by_step_guide',
    },
    tags: ['adaptive_response', 'step-by-step'],
  },
  {
    id: 'resp_03',
    name: 'Comparative analysis for architectural choices',
    category: 'adaptive_response',
    input: 'قارن بين Supabase و Firebase من حيث الأمان والتكلفة',
    expected: {
      strategy: 'comparative_analysis',
    },
    tags: ['adaptive_response', 'comparative'],
  },
  {
    id: 'resp_04',
    name: 'Code-first for explicit implementation request',
    category: 'adaptive_response',
    input: 'كود كامل لـ Express middleware يقوم بحساب latency',
    expected: {
      strategy: 'code_first',
    },
    tags: ['adaptive_response', 'code-first'],
  },
  {
    id: 'resp_05',
    name: 'Executive summary for high-level briefing',
    category: 'adaptive_response',
    input: 'ملخص تنفيذي لأداء مبيعات الربع الأول',
    expected: {
      strategy: 'executive_summary',
    },
    tags: ['adaptive_response', 'executive-summary'],
  },
  {
    id: 'resp_06',
    name: 'Initial diagnosis for runtime stack trace',
    category: 'adaptive_response',
    input: 'Error: Cannot read property "map" of undefined at renderList()',
    expected: {
      strategy: 'initial_diagnosis',
    },
    tags: ['adaptive_response', 'diagnosis'],
  },
  {
    id: 'resp_07',
    name: 'Anti-loop guardrail triggered on recurring failure signature',
    category: 'adaptive_response',
    input: 'جربت نفس الحل وبرضو مطلع نفس الخطأ',
    context: {
      troubleshootingAttempt: 2,
    },
    expected: {
      strategy: 'step_by_step_guide',
    },
    tags: ['adaptive_response', 'anti-loop'],
  },
  {
    id: 'resp_08',
    name: 'Clarification prompt triggered on missing critical details',
    category: 'adaptive_response',
    input: 'مش راضي يشتغل معايا خالص',
    expected: {
      strategy: 'clarification_prompt',
      clarification: true,
    },
    tags: ['adaptive_response', 'clarification'],
  },

  // =========================================================================
  // 5. Agent Execution Subsystem (Cases 33 - 40)
  // =========================================================================
  {
    id: 'agent_01',
    name: 'Single tool invocation executes and finishes',
    category: 'agent',
    input: 'الساعة كام دلوقتي في القاهرة؟',
    expected: {
      toolCalls: ['get_current_time'],
      maxSteps: 2,
      status: 'completed',
    },
    tags: ['agent', 'single-tool'],
  },
  {
    id: 'agent_02',
    name: 'Two tools chained sequentially to satisfy request',
    category: 'agent',
    input: 'ابحث عن مواعيد الصلاة في الجيزة واخبرني بالوقت الحالي',
    expected: {
      toolCalls: ['web_search', 'get_current_time'],
      maxSteps: 3,
      status: 'completed',
    },
    tags: ['agent', 'tool-chaining'],
  },
  {
    id: 'agent_03',
    name: 'Three tools bounded within strict policy limits',
    category: 'agent',
    input: 'ما هو الطقس في القاهرة والوقت الحالي وتفاصيل صلاة الظهر؟',
    expected: {
      maxSteps: 4,
      status: 'completed',
    },
    tags: ['agent', 'multi-step-bounded'],
  },
  {
    id: 'agent_04',
    name: 'Sensitive tool action halts on confirmation barrier',
    category: 'agent',
    input: 'أنشئ تذكير مهم بخصم مبلغ 5000 جنيه من حسابي غداً',
    expected: {
      status: 'waiting_for_confirmation',
      blockedReason: 'confirmation_required',
    },
    tags: ['agent', 'confirmation-barrier'],
  },
  {
    id: 'agent_05',
    name: 'LoopGuard blocks duplicate identical tool call',
    category: 'agent',
    input: 'create_reminder title="Test" time="tomorrow"',
    context: {
      alreadyExecuted: [{ tool: 'create_reminder', args: { title: 'Test', time: 'tomorrow' } }],
    },
    expected: {
      blockedReason: 'loop_detected',
    },
    tags: ['agent', 'loopguard'],
  },
  {
    id: 'agent_06',
    name: 'SSRF protection blocks internal IP network request',
    category: 'agent',
    input: 'web_search url="http://169.254.169.254/latest/meta-data/"',
    expected: {
      blockedReason: 'ssrf_blocked',
    },
    tags: ['agent', 'security', 'ssrf'],
  },
  {
    id: 'agent_07',
    name: 'Tool execution timeout fails safely without crashing engine',
    category: 'agent',
    input: 'slow_tool_query',
    context: {
      simulateTimeout: true,
    },
    expected: {
      status: 'completed',
    },
    tags: ['agent', 'timeout'],
  },
  {
    id: 'agent_08',
    name: 'Partial completion safely handled when tool encounters unrecoverable error',
    category: 'agent',
    input: 'weather_for_invalid_location_xyz123',
    context: {
      simulateFailure: true,
    },
    expected: {
      status: 'completed',
    },
    tags: ['agent', 'partial-completion'],
  },

  // =========================================================================
  // 6. Provider Abstraction Subsystem (Cases 41 - 48)
  // =========================================================================
  {
    id: 'prov_01',
    name: 'Primary provider handles clean request',
    category: 'provider',
    input: 'Hello Craft',
    expected: {
      fallbackUsed: false,
      status: 'ok',
    },
    tags: ['provider', 'primary'],
  },
  {
    id: 'prov_02',
    name: 'Server 500 triggers resilient fallback to secondary provider',
    category: 'provider',
    input: 'Query triggering primary 500 error',
    context: {
      primaryError: { category: 'unavailable', statusCode: 500 },
    },
    expected: {
      fallbackUsed: true,
      status: 'ok',
    },
    tags: ['provider', 'fallback', '500'],
  },
  {
    id: 'prov_03',
    name: 'Rate limit 429 triggers resilient fallback',
    category: 'provider',
    input: 'Query triggering 429 rate limit',
    context: {
      primaryError: { category: 'rate_limit', statusCode: 429 },
    },
    expected: {
      fallbackUsed: true,
      status: 'ok',
    },
    tags: ['provider', 'fallback', '429'],
  },
  {
    id: 'prov_04',
    name: 'Network timeout triggers resilient fallback',
    category: 'provider',
    input: 'Query triggering timeout',
    context: {
      primaryError: { category: 'timeout' },
    },
    expected: {
      fallbackUsed: true,
      status: 'ok',
    },
    tags: ['provider', 'fallback', 'timeout'],
  },
  {
    id: 'prov_05',
    name: 'Authentication 401 error fails fast without fallback',
    category: 'provider',
    input: 'Query with bad API key',
    context: {
      primaryError: { category: 'authentication', statusCode: 401 },
    },
    expected: {
      fallbackUsed: false,
      status: 'error',
      blockedReason: 'authentication',
    },
    tags: ['provider', 'fail-fast', '401'],
  },
  {
    id: 'prov_06',
    name: 'Invalid request 400 fails fast without fallback',
    category: 'provider',
    input: 'Query with invalid parameters',
    context: {
      primaryError: { category: 'invalid_request', statusCode: 400 },
    },
    expected: {
      fallbackUsed: false,
      status: 'error',
      blockedReason: 'invalid_request',
    },
    tags: ['provider', 'fail-fast', '400'],
  },
  {
    id: 'prov_07',
    name: 'Context overflow fails pre-flight check before dispatch',
    category: 'provider',
    input: 'x'.repeat(40000), // Huge input exceeding context limit
    expected: {
      fallbackUsed: false,
      status: 'error',
      blockedReason: 'context_overflow',
    },
    tags: ['provider', 'context-overflow'],
  },
  {
    id: 'prov_08',
    name: 'Terminal cancellation signal halts without fallback',
    category: 'provider',
    input: 'Cancelled request',
    context: {
      aborted: true,
    },
    expected: {
      fallbackUsed: false,
      status: 'cancelled',
      blockedReason: 'timeout',
    },
    tags: ['provider', 'cancellation'],
  },

  // =========================================================================
  // 7. Proactive Intelligence Subsystem (Cases 49 - 56)
  // =========================================================================
  {
    id: 'pro_01',
    name: 'Eligible candidate dispatched within allowable window',
    category: 'proactive',
    input: 'due_reminder_check',
    context: {
      nowHour: 14, // 2 PM (within awake window 09:00 - 22:00)
      lastActiveHoursAgo: 5,
      consent: true,
    },
    expected: {
      status: 'eligible',
    },
    tags: ['proactive', 'eligibility'],
  },
  {
    id: 'pro_02',
    name: 'Quiet hours suppresses proactive candidate',
    category: 'proactive',
    input: 'due_reminder_check_at_night',
    context: {
      nowHour: 2, // 2 AM (quiet hours)
      consent: true,
    },
    expected: {
      status: 'suppressed',
      blockedReason: 'quiet_hours',
    },
    tags: ['proactive', 'quiet-hours'],
  },
  {
    id: 'pro_03',
    name: 'Recent inbound user activity suppresses proactive outreach',
    category: 'proactive',
    input: 'due_proactive_recent_activity',
    context: {
      lastInboundMinutesAgo: 8, // < 15 min threshold
      consent: true,
    },
    expected: {
      status: 'suppressed',
      blockedReason: 'recent_inbound',
    },
    tags: ['proactive', 'suppression'],
  },
  {
    id: 'pro_04',
    name: 'Minimum cooldown suppresses frequent proactive messages',
    category: 'proactive',
    input: 'due_proactive_cooldown',
    context: {
      lastOutboundMinutesAgo: 60, // < 120 min cooldown
      consent: true,
    },
    expected: {
      status: 'suppressed',
      blockedReason: 'cooldown_active',
    },
    tags: ['proactive', 'cooldown'],
  },
  {
    id: 'pro_05',
    name: 'User opt-out suppresses all proactive candidate dispatch',
    category: 'proactive',
    input: 'due_proactive_opt_out',
    context: {
      optedOut: true,
    },
    expected: {
      status: 'suppressed',
      blockedReason: 'opted_out',
    },
    tags: ['proactive', 'opt-out'],
  },
  {
    id: 'pro_06',
    name: 'Expired WhatsApp 24h window blocks freeform outbound message',
    category: 'proactive',
    input: 'freeform_outbound_window_expired',
    context: {
      lastInboundHoursAgo: 26, // > 24 hours
      isTemplate: false,
    },
    expected: {
      status: 'blocked',
      blockedReason: 'window_expired',
    },
    tags: ['proactive', 'whatsapp-window'],
  },
  {
    id: 'pro_07',
    name: 'Template adapter maps blocked freeform to approved template',
    category: 'proactive',
    input: 'reminder_intent_window_expired',
    context: {
      lastInboundHoursAgo: 28,
      intentType: 'reminder_alert',
    },
    expected: {
      status: 'template_mapped',
    },
    tags: ['proactive', 'template-adapter'],
  },
  {
    id: 'pro_08',
    name: 'Webhook status receipt attributes user engagement',
    category: 'proactive',
    input: 'user_replied_to_proactive_message',
    context: {
      recentDispatchId: 'disp_12345',
      receiptStatus: 'read',
    },
    expected: {
      status: 'attributed',
    },
    tags: ['proactive', 'engagement-receipt'],
  },
];
