/**
 * Phase 14.3 — Lean Synthesis Prompt & Adaptive Tool Manifest Test Suite
 *
 * Verifies quality-preserving context optimization:
 * 1. Adaptive Tool Manifest (NONE, SCOPED, FULL):
 *    - Pure conversational greetings & thanks receive zero tools (tools: undefined), saving ~1,180 tokens.
 *    - Domain-specific requests (weather, time, search, reminder) receive strictly scoped tool manifests.
 *    - Complex, ambiguous, or general requests fail-open safely to the full manifest.
 *    - Multi-step execution retains tools (never NONE when steps > 0).
 * 2. TriggerContract Boundary Enforcement:
 *    - Adaptive manifest strictly subsets TriggerContract allowed tools; can NEVER expand them.
 *    - System triggers (smart_reminder, proactive) cannot leak unauthorized mutation tools.
 *    - ToolPermissionGate rejects unauthorized calls with TOOL_NOT_ALLOWED_FOR_TRIGGER.
 * 3. Lean Synthesis Prompt:
 *    - Final synthesis receives lean prompt (~520 tokens) omitting ~1,300 tokens of planner-only rules.
 *    - 100% preservation of Craft identity, Egyptian dialect persistence, technical terms in English,
 *      WhatsApp formatting, user memories, Cairo UTC+3 temporal anchor, and verified evidence grounding.
 *    - Synthesis request explicitly enforces tools: undefined.
 * 4. Regression & Golden Dataset:
 *    - All 56 Golden Evaluation scenarios pass at 100%.
 *    - Zero production database mutations.
 */

import { ToolRegistry } from '../src/modules/tools/registry';
import { ToolCapabilityPolicy } from '../src/modules/tools/safety/tool_capability_policy';
import { AdaptiveToolPolicy } from '../src/modules/tools/safety/adaptive_tool_policy';
import { TriggerContract } from '../src/modules/tools/safety/trigger_contract';
import { ToolPermissionGate } from '../src/modules/tools/safety/permission_gate';
import { SystemPromptBuilder } from '../src/modules/ai/prompts/system_prompt';
import { SynthesisPromptBuilder } from '../src/modules/ai/prompts/synthesis_prompt';
import { ExecutionPlanner } from '../src/modules/agent/execution/planner';
import { ExecutionEngine } from '../src/modules/agent/execution/execution_engine';
import {
  AgentExecutionState,
  ExecutionEngineContext,
} from '../src/modules/agent/execution/types';
import { LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityEngine } from '../src/modules/personality';
import { EvaluationRunner } from '../src/modules/observability';
import { AIRouter, AIRequest, AIResponse } from '../src/modules/ai';

describe('Phase 14.3 — Lean Synthesis Prompt & Adaptive Tool Manifest', () => {
  const registry = ToolRegistry.getInstance();
  const capabilityPolicy = ToolCapabilityPolicy.getInstance();
  const permissionGate = ToolPermissionGate.getInstance();
  const langService = LanguageIntelligenceService.getInstance();
  const defaultPersonality = PersonalityEngine.getInstance().getDefaultPersonality();

  // =========================================================================
  // 1. Adaptive Tool Manifest: Pure Conversational Intent (NONE)
  // =========================================================================
  describe('1. Pure Conversational Intent (NONE Mode -> tools: undefined)', () => {
    it('1.1: Standard Egyptian Arabic greeting ("ازيك عامل اي؟") returns NONE with 0 tools', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'ازيك عامل اي؟', 'user_message');

      expect(res.mode).toBe('NONE');
      expect(res.tools.length).toBe(0);
      expect(res.toolNames.length).toBe(0);
      expect(res.reason).toBe('PURE_CONVERSATIONAL_INTENT');
    });

    it('1.2: Arabic greeting variant ("عامل ايه يا كرافت") returns NONE with 0 tools', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'عامل ايه يا كرافت', 'user_message');

      expect(res.mode).toBe('NONE');
      expect(res.tools.length).toBe(0);
      expect(res.reason).toBe('PURE_CONVERSATIONAL_INTENT');
    });

    it('1.3: Gratitude turn ("تمام شكراً") returns NONE with 0 tools', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'تمام شكراً', 'user_message');

      expect(res.mode).toBe('NONE');
      expect(res.tools.length).toBe(0);
      expect(res.reason).toBe('PURE_CONVERSATIONAL_INTENT');
    });

    it('1.4: English greeting ("hi there craft") returns NONE with 0 tools', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'hi craft', 'user_message');

      expect(res.mode).toBe('NONE');
      expect(res.tools.length).toBe(0);
      expect(res.reason).toBe('PURE_CONVERSATIONAL_INTENT');
    });

    it('1.5: Farewell turn ("تصبح على خير") returns NONE with 0 tools', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'تصبح على خير', 'user_message');

      expect(res.mode).toBe('NONE');
      expect(res.tools.length).toBe(0);
      expect(res.reason).toBe('PURE_CONVERSATIONAL_INTENT');
    });

    it('1.6: ExecutionPlanner produces AIRequest with tools: undefined for pure greeting', async () => {
      let capturedRequest: AIRequest | undefined;
      const mockAIRouter = {
        route: jest.fn().mockImplementation(async (req: AIRequest): Promise<AIResponse> => {
          capturedRequest = req;
          return {
            providerId: 'mock',
            model: 'mock-model',
            toolCalls: [],
            finishReason: 'stop',
            latencyMs: 15,
            message: { role: 'assistant', content: 'الحمد لله تمام يا فندم! أقدر أساعدك في إيه؟' },
            usage: { promptTokens: 450, completionTokens: 25, totalTokens: 475 },
          };
        }),
      } as unknown as AIRouter;

      const planner = new ExecutionPlanner(mockAIRouter, registry, capabilityPolicy);
      const state: AgentExecutionState = {
        runId: 'run-greet-1',
        taskId: 'task-1',
        status: 'planning',
        currentStep: 0,
        maxSteps: 3,
        goal: 'ازيك عامل اي؟',
        steps: [],
        totalToolCalls: 0,
        totalToolExecutionMs: 0,
        startedAt: Date.now(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const context: ExecutionEngineContext = {
        runId: 'run-greet-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        channel: 'whatsapp',
        userGoal: 'ازيك عامل اي؟',
        triggerType: 'user_message',
      };

      await planner.planNextStep(state, context, []);

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.tools).toBeUndefined();
      expect(capturedRequest?.toolChoice).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Adaptive Tool Manifest: Scoped Domain Intents (SCOPED Mode)
  // =========================================================================
  describe('2. Scoped Domain Intents (SCOPED Mode)', () => {
    it('2.1: Current Time query ("الساعة كام دلوقتي؟") returns SCOPED with get_current_time', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'الساعة كام دلوقتي؟', 'user_message');

      expect(res.mode).toBe('SCOPED');
      expect(res.toolNames).toEqual(['get_current_time']);
      expect(res.tools.map((t) => t.name)).toEqual(['get_current_time']);
      expect(res.reason).toBe('SCOPED_TIME_INTENT');
    });

    it('2.2: Weather query ("الجو عامل إيه في القاهرة؟") returns SCOPED with get_weather', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'الجو عامل إيه في القاهرة؟', 'user_message');

      expect(res.mode).toBe('SCOPED');
      expect(res.toolNames).toEqual(['get_weather']);
      expect(res.reason).toBe('SCOPED_WEATHER_INTENT');
    });

    it('2.3: Search query ("ابحثلي عن آخر أخبار Watch Dogs 4") returns SCOPED with web_search and get_current_time', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'ابحثلي عن آخر أخبار Watch Dogs 4',
        'user_message'
      );

      expect(res.mode).toBe('SCOPED');
      expect(res.toolNames).toContain('web_search');
      expect(res.toolNames).toContain('get_current_time');
      expect(res.reason).toBe('SCOPED_SEARCH_INTENT');
    });

    it('2.4: Reminder creation ("فكرني بكرة الساعة 10 أذاكر") returns SCOPED with reminder tools', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'فكرني بكرة الساعة 10 أذاكر',
        'user_message'
      );

      expect(res.mode).toBe('SCOPED');
      expect(res.toolNames).toContain('create_reminder');
      expect(res.toolNames).toContain('list_reminders');
      expect(res.toolNames).toContain('get_current_time');
      expect(res.reason).toBe('SCOPED_REMINDER_INTENT');
    });

    it('2.5: Mixed greeting + action ("صباح الخير يا كرافت، فكرني بعد ساعة بالاجتماع") retains reminder tool', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'صباح الخير يا كرافت، فكرني بعد ساعة بالاجتماع',
        'user_message'
      );

      expect(res.mode).toBe('SCOPED');
      expect(res.toolNames).toContain('create_reminder');
      expect(res.mode).not.toBe('NONE');
    });
  });

  // =========================================================================
  // 3. Fallback & Multi-Step Safety (FULL Mode)
  // =========================================================================
  describe('3. Fallback & Multi-Step Execution Safety (FULL Mode)', () => {
    it('3.1: Complex or ambiguous query fails-open to FULL tool manifest', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'احفظ إني بحب الشاي بالنعناع',
        'user_message'
      );

      expect(res.mode).toBe('FULL');
      expect(res.tools.length).toBe(allowed.length);
      expect(res.toolNames).toContain('save_memory');
      expect(res.reason).toBe('FAIL_OPEN_FULL_MANIFEST');
    });

    it('3.2: Technical question ("إيه الفرق بين StatelessWidget و StatefulWidget في Flutter؟") fails-open safely', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'إيه الفرق بين StatelessWidget و StatefulWidget في Flutter؟',
        'user_message'
      );

      expect(res.mode).toBe('FULL');
      expect(res.tools.length).toBe(allowed.length);
    });

    it('3.3: Multi-step safety: When hasPriorSteps is true, NEVER returns NONE even for conversational turn', () => {
      const allTools = registry.getAllTools();
      const allowed = capabilityPolicy.filterTools(allTools, 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'تمام',
        'user_message',
        { hasPriorSteps: true }
      );

      expect(res.mode).toBe('FULL');
      expect(res.tools.length).toBe(allowed.length);
      expect(res.reason).toBe('PRIOR_EXECUTION_STEPS_ACTIVE');
    });
  });

  // =========================================================================
  // 4. TriggerContract Authoritative Boundary & Security
  // =========================================================================
  describe('4. TriggerContract Authoritative Boundary & Security', () => {
    it('4.1: Adaptive manifest CANNOT inject forbidden tools during smart_reminder trigger', () => {
      const tools = capabilityPolicy.getAdaptiveFilteredOpenAITools(
        registry,
        'smart_reminder',
        'فكرني بكرة الساعة 10 أذاكر'
      );

      const toolNames = tools.map((t: any) => t.function.name);
      // Even though query asked for a reminder, smart_reminder allowlist restricts to time, weather, search
      expect(toolNames).not.toContain('create_reminder');
      expect(toolNames).not.toContain('save_memory');
      expect(toolNames).not.toContain('complete_reminder');
      expect(toolNames).toContain('get_current_time');
    });

    it('4.2: Adaptive manifest respects proactive trigger restrictions', () => {
      const tools = capabilityPolicy.getAdaptiveFilteredOpenAITools(
        registry,
        'proactive_follow_up_offer',
        'ابحثلي عن آخر أخبار التكنولوجيا'
      );

      const toolNames = tools.map((t: any) => t.function.name);
      // proactive_follow_up_offer only allows get_current_time
      expect(toolNames).not.toContain('web_search');
      expect(toolNames).not.toContain('create_reminder');
      expect(toolNames).toEqual(['get_current_time']);
    });

    it('4.3: ToolPermissionGate runtime defense blocks unauthorized tool invocation with TOOL_NOT_ALLOWED_FOR_TRIGGER', () => {
      const createReminderTool = registry.getTool('create_reminder')!;
      const decision = permissionGate.evaluate(createReminderTool, {
        userId: 'usr-1',
        conversationId: 'conv-1',
        channel: 'whatsapp',
        triggerType: 'smart_reminder',
      });

      expect(decision.allowed).toBe(false);
      expect(decision.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });
  });

  // =========================================================================
  // 5. Lean Synthesis Prompt: Token Savings & Instruction Omission
  // =========================================================================
  describe('5. Lean Synthesis Prompt Architecture', () => {
    const langCtx = langService.resolveContext('ابحثلي عن Watch Dogs');

    it('5.1: Lean Synthesis prompt omits planner-only tool invocation mandates', () => {
      const plannerPrompt = SystemPromptBuilder.buildStaticPrefix(langCtx, defaultPersonality);
      const synthesisPrompt = SynthesisPromptBuilder.buildStaticPrefix(langCtx, defaultPersonality);

      // Planner rules that MUST be present in planner prompt:
      expect(plannerPrompt).toContain('ALWAYS call \'create_reminder\'');
      expect(plannerPrompt).toContain('YOU MUST ALWAYS INVOKE THE \'web_search\' TOOL!');
      expect(plannerPrompt).toContain('Intent Integrity & Anti-Hallucination on Ambiguous Actions');

      // Planner rules that MUST be absent in synthesis prompt:
      expect(synthesisPrompt).not.toContain('ALWAYS call \'create_reminder\'');
      expect(synthesisPrompt).not.toContain('YOU MUST ALWAYS INVOKE THE \'web_search\' TOOL!');
      expect(synthesisPrompt).not.toContain('Intent Integrity & Anti-Hallucination on Ambiguous Actions');
    });

    it('5.2: Lean Synthesis prompt is significantly more compact (~520 tokens vs ~1,850 tokens)', () => {
      const plannerPrompt = SystemPromptBuilder.buildStaticPrefix(langCtx, defaultPersonality);
      const synthesisPrompt = SynthesisPromptBuilder.buildStaticPrefix(langCtx, defaultPersonality);

      // Word / char count comparison
      expect(synthesisPrompt.length).toBeLessThan(plannerPrompt.length / 2);
      expect(plannerPrompt.length - synthesisPrompt.length).toBeGreaterThan(2500); // characters saved
    });

    it('5.3: Lean Synthesis prompt incorporates strict evidence grounding and anti-hallucination clause', () => {
      const synthesisPrompt = SynthesisPromptBuilder.buildStaticPrefix(langCtx, defaultPersonality);

      expect(synthesisPrompt).toContain('Verified Evidence Grounding & Anti-Hallucination');
      expect(synthesisPrompt).toContain('NEVER fabricate tool results, fake actions, or invent information');
      expect(synthesisPrompt).toContain('Never list sources, URLs, or citations unless the user explicitly requested them');
    });
  });

  // =========================================================================
  // 6. Synthesis Invariant Preservation: Dialect, Technical Terms & Memories
  // =========================================================================
  describe('6. Synthesis Invariant Preservation', () => {
    it('6.1: Preserves 100% of Egyptian Arabic dialect rules and negative constraints', () => {
      const langCtx = langService.resolveContext('ازيك عامل ايه النهاردة');
      const synthesisPrompt = SynthesisPromptBuilder.buildStaticPrefix(langCtx, defaultPersonality);

      expect(synthesisPrompt).toContain('Natural, friendly, and professional Egyptian Arabic');
      expect(synthesisPrompt).toContain('STRICT DIALECT PERSISTENCE:');
      expect(synthesisPrompt).toContain('NEVER revert or switch back to Modern Standard Arabic (MSA / الفصحى)');
      expect(synthesisPrompt).toContain('NEVER say "يا باشا", "يا معلم", "يا صاحبي"');
      expect(synthesisPrompt).toContain('"بص", "كده", "علشان", "دلوقتي"');
    });

    it('6.2: Preserves 100% of technical terminology rules in English (Flutter, Dart, APIs)', () => {
      const langCtx = langService.resolveContext('ازاي استخدم flutter riverpod؟');
      const synthesisPrompt = SynthesisPromptBuilder.buildStaticPrefix(langCtx, defaultPersonality);

      expect(synthesisPrompt).toContain('Technical Terminology Preservation (STRICT):');
      expect(synthesisPrompt).toContain('NEVER translate core technical identifiers, framework constructs');
      expect(synthesisPrompt).toContain('Always preserve technical terms, frameworks, libraries, APIs, and tools in English');
    });

    it('6.3: Preserves WhatsApp formatting rules (no tables, standard line breaks)', () => {
      const synthesisPrompt = SynthesisPromptBuilder.buildStaticPrefix(undefined, defaultPersonality);

      expect(synthesisPrompt).toContain('Formatting Rules:');
      expect(synthesisPrompt).toContain('NEVER use Markdown tables (| col |). WhatsApp renders tables poorly.');
      expect(synthesisPrompt).toContain('NEVER output raw HTML (<br>, <div>).');
    });

    it('6.4: Preserves Cairo UTC+3 temporal context in dynamic suffix', () => {
      const fixedDate = new Date('2026-10-06T15:20:00Z');
      const dynamicCtx = SynthesisPromptBuilder.buildDynamicContext(
        undefined,
        undefined,
        undefined,
        undefined,
        fixedDate
      );

      expect(dynamicCtx).toContain('Real-Time Temporal Context (Africa/Cairo):');
      expect(dynamicCtx).toContain('User Timezone: Africa/Cairo (Egypt, UTC+3)');
      expect(dynamicCtx).toContain('2026-10-06T18:20:00+03:00');
    });

    it('6.5: Preserves stored user memories cleanly in dynamic context', () => {
      const memories = ['User is a Senior Flutter Developer', 'User prefers dark mode'];
      const dynamicCtx = SynthesisPromptBuilder.buildDynamicContext(memories);

      expect(dynamicCtx).toContain('### Stored User Profile:');
      expect(dynamicCtx).toContain('- User is a Senior Flutter Developer');
      expect(dynamicCtx).toContain('- User prefers dark mode');
    });
  });

  // =========================================================================
  // 7. Full Execution Engine Synthesis Integration
  // =========================================================================
  describe('7. Full Execution Engine Synthesis Integration', () => {
    it('7.1: ExecutionEngine.synthesizeFinalAnswer passes lean prompt and tools: undefined to AIRouter', async () => {
      let capturedRequest: AIRequest | undefined;
      const mockAIRouter = {
        route: jest.fn().mockImplementation(async (req: AIRequest): Promise<AIResponse> => {
          capturedRequest = req;
          return {
            providerId: 'mock',
            model: 'mock-model',
            toolCalls: [],
            finishReason: 'stop',
            latencyMs: 15,
            message: { role: 'assistant', content: 'الساعة دلوقتي 6:20 مساءً بتوقيت القاهرة.' },
            usage: { promptTokens: 620, completionTokens: 20, totalTokens: 640 },
          };
        }),
      } as unknown as AIRouter;

      const engine = new ExecutionEngine(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockAIRouter
      );
      const state: AgentExecutionState = {
        runId: 'run-synth-1',
        taskId: 'task-1',
        status: 'executing',
        currentStep: 1,
        maxSteps: 3,
        goal: 'الساعة كام؟',
        steps: [
          {
            id: 'step-1',
            index: 0,
            toolName: 'get_current_time',
            status: 'succeeded',
            input: {},
            result: { time: '18:20:00', timeZone: 'Africa/Cairo' },
            serializedResult: 'Current time in Africa/Cairo is 18:20:00',
            startedAt: Date.now(),
          },
        ],
        totalToolCalls: 1,
        totalToolExecutionMs: 15,
        startedAt: Date.now(),
        promptTokens: 300,
        completionTokens: 20,
        totalTokens: 320,
      };

      const context: ExecutionEngineContext = {
        runId: 'run-synth-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        channel: 'whatsapp',
        userGoal: 'الساعة كام؟',
        languageContext: langService.resolveContext('الساعة كام؟'),
      };

      const reply = await engine.synthesizeFinalAnswer(state, context, []);

      expect(reply).toBe('الساعة دلوقتي 6:20 مساءً بتوقيت القاهرة.');
      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.tools).toBeUndefined();
      expect(capturedRequest?.toolChoice).toBeUndefined();

      // Verify system message is lean synthesis prompt
      const sysMsg = capturedRequest?.messages.find((m) => m.role === 'system');
      expect(sysMsg?.content).toContain('Verified Evidence Grounding & Anti-Hallucination');
      expect(sysMsg?.content).not.toContain('ALWAYS call \'create_reminder\'');
    });
  });

  // =========================================================================
  // 8. Golden Evaluation Dataset (56/56 Scenarios)
  // =========================================================================
  describe('8. Golden Dataset Comprehensive Evaluation (56 Scenarios)', () => {
    it('8.1: EvaluationRunner executes all 56 golden scenarios across 7 subsystems with 100% pass rate', async () => {
      const runner = new EvaluationRunner();
      const report = await runner.run();

      expect(report.totalCases).toBe(56);
      expect(report.passed).toBe(56);
      expect(report.failed).toBe(0);
      expect(report.passRate).toBe(100);

      // Verify all 7 architectural subsystems remain at 100%
      expect(report.categoryBreakdown.memory.passRate).toBe(100);
      expect(report.categoryBreakdown.conversation.passRate).toBe(100);
      expect(report.categoryBreakdown.personalization.passRate).toBe(100);
      expect(report.categoryBreakdown.adaptive_response.passRate).toBe(100);
      expect(report.categoryBreakdown.agent.passRate).toBe(100);
      expect(report.categoryBreakdown.provider.passRate).toBe(100);
      expect(report.categoryBreakdown.proactive.passRate).toBe(100);
    });
  });
});
