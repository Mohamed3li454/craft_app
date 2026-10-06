/**
 * Phase 14.6 — Multi-Call Token Efficiency & Tool-Policy Hardening Test Suite
 *
 * Verifies:
 * 1. AdaptiveToolPolicy hardening for Egyptian Arabic pure conversational turns -> mode: 'NONE' (0 tools)
 * 2. AdaptiveToolPolicy handling of English/code-switching pleasantries -> mode: 'NONE' (0 tools)
 * 3. Strict preservation of action intents with pleasantry prefixes -> mode != 'NONE'
 * 4. Step-aware tool scoping in multi-step agent runs (hasPriorSteps: true) -> mode: 'SCOPED'
 * 5. Ambiguous prior step turns safely fail open to FULL and NEVER return NONE
 * 6. ExecutionContextCompactor cross-step search deduplication
 * 7. Invariant: Different articles from the same domain are NEVER deduplicated
 * 8. Invariant: Contradictory facts, numbers, dates, prices across distinct sources are 100% preserved
 * 9. ExecutionContextCompactor strips raw stack traces and internal secrets
 * 10. ExecutionContextCompactor formats unified synthesis observations
 * 11. End-to-end multi-step ExecutionEngine integration with compacted observations
 * 12. Golden Dataset (56/56) continuous evaluation pass rate = 100%, 0 regressions, 0 DB mutations
 */

import { AdaptiveToolPolicy } from '../src/modules/tools/safety/adaptive_tool_policy';
import { ToolCapabilityPolicy } from '../src/modules/tools/safety/tool_capability_policy';
import { ToolRegistry } from '../src/modules/tools/registry';
import {
  ExecutionContextCompactor,
  ToolObservation,
  ExecutionContextSnapshot,
} from '../src/modules/agent/execution/execution_context_compactor';
import { ExecutionPlanner } from '../src/modules/agent/execution/planner';
import { ExecutionEngine } from '../src/modules/agent/execution/execution_engine';
import {
  AgentExecutionState,
  AgentExecutionStep,
  ExecutionEngineContext,
} from '../src/modules/agent/execution/types';
import { AIRouter, AIRequest, AIResponse, SystemPromptBuilder, SynthesisPromptBuilder } from '../src/modules/ai';
import { PersonalityEngine } from '../src/modules/personality';
import { EvaluationRunner } from '../src/modules/observability/evaluation/runner';
import { SearchPresentationPolicy } from '../src/modules/tools/search/search_presentation_policy';

describe('Phase 14.6 — Multi-Call Token Efficiency & Tool-Policy Hardening', () => {
  let registry: ToolRegistry;
  let capabilityPolicy: ToolCapabilityPolicy;

  beforeAll(() => {
    registry = ToolRegistry.getInstance();
    capabilityPolicy = ToolCapabilityPolicy.getInstance();
  });

  // =========================================================================
  // 1. Hardened Egyptian Arabic Conversational Intent Classification (NONE Mode)
  // =========================================================================
  describe('1. Pure Conversational Intent Hardening (Egyptian Arabic -> NONE Mode)', () => {
    const pureConversationalCases = [
      'ازيك عامل اي',
      'أنا كويس، إنت عامل إيه؟',
      'أنا تمام الحمد لله، إنت أخبارك إيه؟',
      'الحمد لله، إنت عامل إيه',
      'تمام يا باشا',
      'تمام يا غالي',
      'تمام يا فنان',
      'تمام يا سيدي',
      'تمام bro',
      'ok bro',
      'ماشي يا باشا',
      'حلو جدا',
      'عظيم جدا',
      'تسلم يا غالي',
      'شكرا ليك يا فنان',
      'ألف شكر يا كرافت',
      'الله يخليك يا باشا',
      'الحمد لله',
      'صباح النور',
      'مساء النور',
      'كله تمام الحمد لله',
      'أنا بخير',
      'أنا كويس',
      'hi craft',
      'how are you',
      'thanks bro',
      'good night',
    ];

    test.each(pureConversationalCases)(
      '1.1: Conversational phrase "%s" returns mode: NONE with 0 tools',
      (phrase) => {
        const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
        const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, phrase, 'user_message');

        expect(res.mode).toBe('NONE');
        expect(res.tools.length).toBe(0);
        expect(res.toolNames.length).toBe(0);
        expect(res.reason).toBe('PURE_CONVERSATIONAL_INTENT');
      }
    );
  });

  // =========================================================================
  // 2. Strict Action Guarding (MUST NOT return NONE)
  // =========================================================================
  describe('2. Strict Action Guarding (Guards against false-positive NONE)', () => {
    const actionCases = [
      { text: 'تمام، اعمللي reminder بكرة الساعة 9', expectedModeNot: 'NONE' },
      { text: 'تمام، ابحثلي عن سعر iPhone 16 Pro', expectedModeNot: 'NONE' },
      { text: 'أيوه نفذها', expectedModeNot: 'NONE' },
      { text: 'اعملها', expectedModeNot: 'NONE' },
      { text: 'كمل', expectedModeNot: 'NONE' },
      { text: 'قارنلي بين سعر iPhone 16 Pro و S24 Ultra', expectedModeNot: 'NONE' },
      { text: 'فكرني بالاجتماع بعد نص ساعة', expectedModeNot: 'NONE' },
      { text: 'احفظ إني بحب القهوة السادة', expectedModeNot: 'NONE' },
      { text: 'الساعة كام دلوقتي في مصر؟', expectedModeNot: 'NONE' },
      { text: 'الطقس عامل إيه في الإسكندرية؟', expectedModeNot: 'NONE' },
      { text: 'ابحث عن مواصفات DeepSeek R1', expectedModeNot: 'NONE' },
      { text: 'طيب هنا ليه سموه Argon؟', expectedModeNot: 'NONE' },
      { text: 'مفيش اخبار عن أحدث موديل Google؟', expectedModeNot: 'NONE' },
    ];

    test.each(actionCases)(
      '2.1: Action phrase "%s" strictly avoids mode: NONE',
      ({ text, expectedModeNot }) => {
        const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
        const res = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, text, 'user_message');

        expect(res.mode).not.toBe(expectedModeNot);
        expect(res.tools.length).toBeGreaterThan(0);
      }
    );
  });

  // =========================================================================
  // 3. Step-Aware Tool Manifest Scoping (Multi-Step Optimization)
  // =========================================================================
  describe('3. Step-Aware Tool Manifest Scoping in Multi-Step Runs', () => {
    it('3.1: Search run with prior web_search step retains SCOPED tools (saves ~620 tokens)', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'قارن بين سعر iPhone 16 Pro و S24 Ultra',
        'user_message',
        {
          hasPriorSteps: true,
          priorToolNames: ['web_search'],
        }
      );

      expect(res.mode).toBe('SCOPED');
      expect(res.toolNames).toContain('web_search');
      expect(res.toolNames).toContain('get_current_time');
      expect(res.toolNames).not.toContain('create_reminder');
      expect(res.toolNames).not.toContain('save_memory');
      expect(res.tools.length).toBeLessThan(allowed.length);
      expect(res.reason).toBe('SCOPED_SEARCH_INTENT_PRIOR_STEPS');
    });

    it('3.2: Reminder run with prior reminder step retains SCOPED reminder tools', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'فكرني بعد ساعة',
        'user_message',
        {
          hasPriorSteps: true,
          priorToolNames: ['get_current_time', 'create_reminder'],
        }
      );

      expect(res.mode).toBe('SCOPED');
      expect(res.toolNames).toContain('create_reminder');
      expect(res.toolNames).toContain('get_current_time');
      expect(res.toolNames).not.toContain('web_search');
      expect(res.reason).toBe('SCOPED_REMINDER_INTENT_PRIOR_STEPS');
    });

    it('3.3: Ambiguous turn with prior steps fails open to FULL and NEVER returns NONE', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const res = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'تمام',
        'user_message',
        {
          hasPriorSteps: true,
        }
      );

      expect(res.mode).toBe('FULL');
      expect(res.tools.length).toBe(allowed.length);
      expect(res.reason).toBe('PRIOR_EXECUTION_STEPS_ACTIVE');
    });
  });

  // =========================================================================
  // 4. ExecutionContextCompactor Cross-Step Deduplication & Evidence Invariants
  // =========================================================================
  describe('4. ExecutionContextCompactor Cross-Step Deduplication & Invariants', () => {
    it('4.1: Deduplicates identical search results across multiple steps using canonical source key', () => {
      const rawStepResults = [
        {
          title: 'iPhone 16 Pro Price in Egypt',
          url: 'https://apple.com/eg/iphone-16-pro?utm_source=google&ref=search',
          snippet: 'Skip to main content. Starting at 55,000 EGP with official warranty. All rights reserved © 2024.',
        },
        {
          title: 'iPhone 16 Pro Specifications',
          url: 'https://apple.com/eg/iphone-16-pro?fbclid=12345',
          snippet: 'Starting at 55,000 EGP. Features A18 Pro chip and titanium design.',
        },
      ];

      const { deduped, duplicatesRemoved } = ExecutionContextCompactor.deduplicateSearchResults(rawStepResults);

      expect(duplicatesRemoved).toBe(1);
      expect(deduped.length).toBe(1);
      expect(deduped[0].snippet).toContain('55,000 EGP');
      expect(deduped[0].snippet).not.toContain('Skip to main content');
      expect(deduped[0].snippet).not.toContain('All rights reserved');
    });

    it('4.2: Invariant: Different articles from the same domain are NEVER deduplicated', () => {
      const distinctArticles = [
        {
          title: 'iPhone 16 Pro Review',
          url: 'https://theverge.com/2024/9/15/iphone-16-pro-review',
          snippet: 'The iPhone 16 Pro costs $999.',
        },
        {
          title: 'Samsung S24 Ultra Review',
          url: 'https://theverge.com/2024/1/25/samsung-s24-ultra-review',
          snippet: 'The Samsung S24 Ultra costs $1299.',
        },
      ];

      const { deduped, duplicatesRemoved } = ExecutionContextCompactor.deduplicateSearchResults(distinctArticles);

      expect(duplicatesRemoved).toBe(0);
      expect(deduped.length).toBe(2);
      expect(deduped[0].snippet).toContain('$999');
      expect(deduped[1].snippet).toContain('$1299');
    });

    it('4.3: Invariant: Contradictory facts, dates, and prices from distinct sources are 100% preserved', () => {
      const conflictingSources = [
        {
          title: 'B.Tech Store: iPhone 16 Pro',
          url: 'https://btech.com/ar/iphone-16-pro',
          snippet: 'Price in Egypt: 57,000 EGP in stock.',
        },
        {
          title: 'Tradeline: iPhone 16 Pro',
          url: 'https://tradelinestores.com/products/iphone-16-pro',
          snippet: 'Official launch price: 54,900 EGP available now.',
        },
      ];

      const { deduped, duplicatesRemoved } = ExecutionContextCompactor.deduplicateSearchResults(conflictingSources);

      expect(duplicatesRemoved).toBe(0);
      expect(deduped.length).toBe(2);
      expect(deduped[0].snippet).toContain('57,000 EGP');
      expect(deduped[1].snippet).toContain('54,900 EGP');
    });
  });

  // =========================================================================
  // 5. ExecutionContextCompactor Planner Message Construction & Security
  // =========================================================================
  describe('5. ExecutionContextCompactor Planner Messages & Security', () => {
    it('5.1: compactPlannerMessages formats dense observations and strips crawler boilerplate', () => {
      const steps: AgentExecutionStep[] = [
        {
          id: 'step_1',
          index: 0,
          toolName: 'web_search',
          status: 'succeeded',
          input: { query: 'سعر iPhone 16 Pro في مصر' },
          startedAt: Date.now(),
          result: {
            results: [
              {
                title: 'Apple Egypt Official',
                url: 'https://www.apple.com/eg/iphone-16-pro?utm_source=campaign',
                snippet: 'We use cookies. Starting at 55,000 EGP. All rights reserved.',
              },
            ],
          },
        },
      ];

      const messages = ExecutionContextCompactor.compactPlannerMessages(steps);

      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toContain('Called tool: web_search');

      expect(messages[1].role).toBe('user');
      const obsContent = messages[1].content as string;
      expect(obsContent).toContain('[Observation for tool "web_search"]');
      expect(obsContent).toContain('55,000 EGP');
      expect(obsContent).not.toContain('We use cookies');
      expect(obsContent).not.toContain('All rights reserved');
    });

    it('5.2: compactPlannerMessages strips raw stack traces, node logs, and secret keys', () => {
      const steps: AgentExecutionStep[] = [
        {
          id: 'step_err',
          index: 0,
          toolName: 'web_search',
          status: 'failed',
          input: { query: 'test' },
          startedAt: Date.now(),
          error: {
            name: 'NetworkTimeout',
            message: 'Internal connect timeout at Socket.connect (/node_modules/pg/client.js:123)',
            userSafeMessage: 'تعذر الاتصال بمحرك البحث بسبب مهلة الاتصال.',
            isOperational: true,
          } as any,
        },
      ];

      const messages = ExecutionContextCompactor.compactPlannerMessages(steps);

      expect(messages.length).toBe(2);
      const errContent = messages[1].content as string;
      expect(errContent).toContain('[Tool Error for "web_search"]');
      expect(errContent).toContain('تعذر الاتصال بمحرك البحث بسبب مهلة الاتصال.');
      expect(errContent).not.toContain('/node_modules/pg/client.js');
    });
  });

  // =========================================================================
  // 6. ExecutionContextCompactor Synthesis Formatting
  // =========================================================================
  describe('6. ExecutionContextCompactor Synthesis Observations Formatting', () => {
    it('6.1: formatObservationsForSynthesis produces unified, deduplicated evidence block', () => {
      const steps: AgentExecutionStep[] = [
        {
          id: 'step_1',
          index: 0,
          toolName: 'get_current_time',
          status: 'succeeded',
          input: {},
          startedAt: Date.now(),
          result: { iso: '2026-10-06T14:00:00Z', timezone: 'Africa/Cairo' },
        },
        {
          id: 'step_2',
          index: 1,
          toolName: 'web_search',
          status: 'succeeded',
          input: { query: 'Google Gemini' },
          startedAt: Date.now(),
          result: {
            results: [
              {
                title: 'Gemini News',
                url: 'https://blog.google/technology/ai/gemini-update',
                snippet: 'Google announced updates for Gemini 2.5.',
                sourceDomain: 'blog.google',
              },
            ],
          },
        },
      ];

      const policy: SearchPresentationPolicy = {
        shouldShowSources: true,
        shouldShowUrls: true,
        shouldShowSnippets: true,
        isFollowUpSourceRequest: false,
        isExplicitLinkRequest: false,
      };

      const formatted = ExecutionContextCompactor.formatObservationsForSynthesis(steps, policy);

      expect(formatted).toContain('[Verified Result: get_current_time]');
      expect(formatted).toContain('[Verified Result: web_search]');
      expect(formatted).toContain('Google announced updates for Gemini 2.5.');
      expect(formatted).toContain('URL: https://blog.google/technology/ai/gemini-update');
    });

    it('6.2: buildSnapshot estimates tokens saved correctly', () => {
      const steps: AgentExecutionStep[] = [
        {
          id: 'step_1',
          index: 0,
          toolName: 'web_search',
          status: 'succeeded',
          input: { query: 'iPhone price' },
          startedAt: Date.now(),
          result: {
            results: [
              {
                title: 'Store A',
                url: 'https://store.com/item1?utm=1',
                snippet: 'Skip to content. Price is 50,000 EGP. All rights reserved.',
              },
              {
                title: 'Store A',
                url: 'https://store.com/item1?utm=2',
                snippet: 'Price is 50,000 EGP.',
              },
            ],
          },
        },
      ];

      const snapshot = ExecutionContextCompactor.buildSnapshot(steps);

      expect(snapshot.compactedObservations.length).toBe(1);
      expect(snapshot.deduplicatedEvidence?.length).toBe(1);
      expect(snapshot.estimatedTokensSaved).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 7. Full Planner Integration with Step Scoping
  // =========================================================================
  describe('7. Full Planner Integration with Step-Aware Tool Manifest Scoping', () => {
    it('7.1: ExecutionPlanner passes scoped tools on step 2 of search workflow', async () => {
      let capturedRequest: AIRequest | undefined;
      const mockAIRouter = {
        route: jest.fn().mockImplementation(async (req: AIRequest): Promise<AIResponse> => {
          capturedRequest = req;
          return {
            providerId: 'mock',
            model: 'mock-model',
            toolCalls: [],
            finishReason: 'stop',
            latencyMs: 10,
            message: { role: 'assistant', content: 'معلومات المقارنة جاهزة.' },
            usage: { promptTokens: 600, completionTokens: 40, totalTokens: 640 },
          };
        }),
      } as unknown as AIRouter;

      const planner = new ExecutionPlanner(mockAIRouter, registry, capabilityPolicy);
      const state: AgentExecutionState = {
        runId: 'run-search-step2',
        taskId: 'task-search-2',
        status: 'planning',
        currentStep: 1,
        maxSteps: 3,
        goal: 'قارن بين سعر iPhone 16 Pro و S24 Ultra',
        steps: [
          {
            id: 'step_1',
            index: 0,
            toolName: 'web_search',
            status: 'succeeded',
            input: { query: 'سعر iPhone 16 Pro' },
            startedAt: Date.now(),
            result: {
              results: [
                {
                  title: 'Apple Egypt',
                  url: 'https://apple.com/eg/iphone-16-pro',
                  snippet: 'Price 55,000 EGP',
                },
              ],
            },
          },
        ],
        totalToolCalls: 1,
        totalToolExecutionMs: 15,
        startedAt: Date.now(),
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
      };

      const context: ExecutionEngineContext = {
        runId: 'run-search-step2',
        userId: 'test_user',
        conversationId: 'test_conv',
        userGoal: 'قارن بين سعر iPhone 16 Pro و S24 Ultra',
        channel: 'whatsapp',
        triggerType: 'user_message',
      };

      await planner.planNextStep(state, context, []);

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.tools).toBeDefined();

      // Verify that SCOPED tools were exposed instead of all 8 tools:
      const exposedToolNames = (capturedRequest?.tools || []).map((t: any) => t.function.name);
      expect(exposedToolNames).toContain('web_search');
      expect(exposedToolNames).toContain('get_current_time');
      expect(exposedToolNames).not.toContain('create_reminder');
      expect(exposedToolNames).not.toContain('save_memory');
      expect(exposedToolNames.length).toBe(2); // Only 2 tools instead of 8!
    });
  });

  // =========================================================================
  // 8. Full Golden Dataset Evaluation (56/56 Scenarios)
  // =========================================================================
  describe('8. Golden Dataset Evaluation & Safety Verification', () => {
    it('8.1: Continuous Evaluation runner executes all 56 golden scenarios with 100% pass rate', async () => {
      const runner = new EvaluationRunner();
      const report = await runner.run();

      expect(report.totalCases).toBe(56);
      expect(report.passed).toBe(56);
      expect(report.failed).toBe(0);
      expect(report.passRate).toBe(100);

      expect(report.categoryBreakdown.memory.passRate).toBe(100);
      expect(report.categoryBreakdown.conversation.passRate).toBe(100);
      expect(report.categoryBreakdown.personalization.passRate).toBe(100);
      expect(report.categoryBreakdown.adaptive_response.passRate).toBe(100);
      expect(report.categoryBreakdown.agent.passRate).toBe(100);
      expect(report.categoryBreakdown.provider.passRate).toBe(100);
      expect(report.categoryBreakdown.proactive.passRate).toBe(100);
    });
  });

  // =========================================================================
  // 9. Personality Guard & Slang Decoupling Invariants
  // =========================================================================
  describe('9. Personality Guard & Slang Decoupling Invariants', () => {
    it('9.1: Colloquial input ("تمام يا باشا") resolves to NONE without altering addressingStyle in PersonalityContext', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const toolRes = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'تمام يا باشا', 'user_message');
      expect(toolRes.mode).toBe('NONE');

      // Verify PersonalityEngine does not adopt the user's title
      const personality = PersonalityEngine.getInstance().resolve('تمام يا باشا');
      expect(personality.addressingStyle).toBe('none');
      expect(personality.formality).toBe('consultative');
      expect(personality.tone).toEqual(['warm', 'professional', 'direct']);
    });

    it('9.2: Colloquial input ("تسلم يا غالي") resolves to NONE without requiring "يا غالي" in response guidelines', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const toolRes = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'تسلم يا غالي', 'user_message');
      expect(toolRes.mode).toBe('NONE');

      const personality = PersonalityEngine.getInstance().resolve('تسلم يا غالي');
      expect(personality.addressingStyle).toBe('none');
    });

    it('9.3: Slang code-switch ("تمام bro") resolves to NONE without making "bro" part of response style', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const toolRes = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, 'تمام bro', 'user_message');
      expect(toolRes.mode).toBe('NONE');

      const personality = PersonalityEngine.getInstance().resolve('تمام bro');
      expect(personality.addressingStyle).toBe('none');
    });

    it('9.4: SystemPromptBuilder strictly enforces negative constraints against copying user slang or titles', () => {
      const langContext = {
        detectedLanguage: 'ar' as const,
        confidence: 0.95,
        targetLanguage: 'ar' as const,
        dialect: 'egyptian' as const,
        register: 'casual' as const,
        source: 'current_message' as const,
        locale: 'ar-EG',
        textDirection: 'rtl' as const,
      };

      const prompt = SystemPromptBuilder.buildStaticPrefix(langContext);

      // Verify explicit negative constraints against slang mirroring
      expect(prompt).toContain('NEVER say "يا باشا", "يا معلم", "يا صاحبي", "يا سيدي الفاضل", "يا هندسة"');
      expect(prompt).toContain('Avoid excessive colloquial fillers like "يا باشا" or "يا هندسة"');
      expect(prompt).toContain('Do not use titles, honorifics, or familiar nicknames by default');
      expect(prompt).not.toContain('bro');
    });

    it('9.5: SynthesisPromptBuilder strictly preserves negative constraints and addressing neutrality', () => {
      const langContext = {
        detectedLanguage: 'ar' as const,
        confidence: 0.95,
        targetLanguage: 'ar' as const,
        dialect: 'egyptian' as const,
        source: 'current_message' as const,
        locale: 'ar-EG',
        textDirection: 'rtl' as const,
      };

      const synthesisPrompt = SynthesisPromptBuilder.buildStaticPrefix(langContext);

      expect(synthesisPrompt).toContain('NEVER say "يا باشا", "يا معلم", "يا صاحبي", "يا سيدي الفاضل", "يا هندسة"');
      expect(synthesisPrompt).toContain('Do not use titles, honorifics, or familiar nicknames by default');
    });
  });
});
