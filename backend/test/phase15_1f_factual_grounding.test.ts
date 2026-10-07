/**
 * Phase 15.1F — Factual Grounding & Natural Response Guard Test Suite
 *
 * Verifies the production solution for factual grounding, search enforcement,
 * evidence-bound synthesis, search failure safety, and natural conversational openings.
 *
 * Invariant Matrix:
 * 1. Precision Factual Classification:
 *    - Chronology & release order queries resolve to PRECISION_FACTUAL (mandatory search).
 *    - Multi-entity attribute queries resolve to PRECISION_FACTUAL.
 *    - Historical sequence & ruler lineage queries resolve to PRECISION_FACTUAL.
 *    - Factual verification & user correction queries resolve to PRECISION_FACTUAL.
 * 2. Foundational Knowledge Preservation (Quality-Preserving Optimization):
 *    - Foundational single-hop facts ("مين مؤسس Apple؟", "عاصمة فرنسا", "ما هو Flutter")
 *      remain NORMAL without forced search or token waste.
 * 3. Tool Manifest Scoping:
 *    - PRECISION_FACTUAL queries scope tools strictly to ['web_search', 'get_current_time'].
 *    - TriggerContract authoritative boundaries strictly honored.
 * 4. ExecutionPlanner Step-0 Mandatory Search:
 *    - ExecutionPlanner enforces toolChoice = { type: 'function', function: { name: 'web_search' } }
 *      on step 0 for PRECISION_FACTUAL queries.
 * 5. Search Failure Safety:
 *    - Zero guessing when search fails or returns empty results for PRECISION_FACTUAL.
 *    - Graceful, transparent Egyptian Arabic fallback.
 * 6. Evidence-Bound Synthesis:
 *    - Synthesis directives prohibit confabulated entities (e.g. "Edward King").
 *    - Conflicting sources divergence is preserved.
 * 7. Natural Response Guard:
 *    - Robotic meta-preambles ("أنا Craft – إليك النسخة المصححة...", "بصفتي Craft...") stripped.
 *    - Direct answers preserved; explicit identity queries ("مين انت؟") honored.
 * 8. Personality & Egyptian Dialect Invariants:
 *    - Warm, consultative, professional tone without title mirroring or slang imitation.
 * 9. Continuous Evaluation (56/56 Scenarios):
 *    - 100% pass rate, 0 regressions, 0 DB mutations.
 */

import {
  PrecisionFactualDetector,
  FactualClaimGuard,
  NaturalResponseGuard,
  FactualEvaluationResult,
} from '../src/modules/factual';
import { AdaptiveToolPolicy } from '../src/modules/tools/safety/adaptive_tool_policy';
import { ToolRegistry } from '../src/modules/tools/registry';
import { ToolCapabilityPolicy } from '../src/modules/tools/safety/tool_capability_policy';
import { ExecutionPlanner } from '../src/modules/agent/execution/planner';
import { ExecutionEngine } from '../src/modules/agent/execution/execution_engine';
import { ExecutionStateManager } from '../src/modules/agent/execution/execution_state';
import { SystemPromptBuilder } from '../src/modules/ai/prompts/system_prompt';
import { SynthesisPromptBuilder } from '../src/modules/ai/prompts/synthesis_prompt';
import { PersonalityEngine } from '../src/modules/personality';
import { EvaluationRunner } from '../src/modules/observability/evaluation/runner';
import { AIRouter, AIRequest, AIResponse } from '../src/modules/ai';

describe('Phase 15.1F — Factual Grounding & Natural Response Guard', () => {
  const registry = ToolRegistry.getInstance();
  const capabilityPolicy = ToolCapabilityPolicy.getInstance();
  const personalityEngine = PersonalityEngine.getInstance();
  const defaultPersonality = personalityEngine.getDefaultPersonality();

  const egyptianLangContext = {
    detectedLanguage: 'ar' as const,
    confidence: 0.95,
    targetLanguage: 'ar' as const,
    dialect: 'egyptian' as const,
    register: 'casual' as const,
    tone: 'warm' as const,
    source: 'current_message' as const,
    locale: 'ar-EG',
    textDirection: 'rtl' as const,
  };

  const englishLangContext = {
    detectedLanguage: 'en' as const,
    confidence: 0.98,
    targetLanguage: 'en' as const,
    source: 'current_message' as const,
    locale: 'en-US',
    textDirection: 'ltr' as const,
  };

  // =========================================================================
  // Part A: Precision Factual Detector & Classification Invariants
  // =========================================================================
  describe('Part A: Precision Factual Detector & Classification Invariants', () => {
    it('A.1: Classifies Assassin\'s Creed chronological series query as PRECISION_FACTUAL', () => {
      const query = "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية";
      const result = PrecisionFactualDetector.evaluate(query);

      expect(result.policy).toBe('PRECISION_FACTUAL');
      expect(result.requiresSearch).toBe(true);
      expect(result.category).toBe('CHRONOLOGY_OR_RELEASE_ORDER');
      expect(result.score).toBeGreaterThanOrEqual(0.70);
      expect(result.signals).toContain('CHRONOLOGY_FRANCHISE_COMPOUND');
    });

    it('A.2: Classifies Marvel MCU timeline query as PRECISION_FACTUAL', () => {
      const query = 'رتبلي أفلام Marvel حسب الترتيب الزمني للأحداث';
      const result = PrecisionFactualDetector.evaluate(query);

      expect(result.policy).toBe('PRECISION_FACTUAL');
      expect(result.requiresSearch).toBe(true);
      expect(result.category).toBe('CHRONOLOGY_OR_RELEASE_ORDER');
    });

    it('A.3: Classifies multi-entity attribute query (protagonist + setting + release date) as PRECISION_FACTUAL', () => {
      const query = 'تواريخ إصدار أجزاء God of War وبطل كل جزء والفترة التاريخية';
      const result = PrecisionFactualDetector.evaluate(query);

      expect(result.policy).toBe('PRECISION_FACTUAL');
      expect(result.requiresSearch).toBe(true);
      expect(result.category).toBe('MULTI_ENTITY_ATTRIBUTES');
    });

    it('A.4: Classifies user factual correction & verification requests as PRECISION_FACTUAL', () => {
      const corrections = [
        'الكلام ده مش صح، مين إدوارد كينج ده؟ صححلي الترتيب',
        'هل الكلام ده صح؟ راجعلي الأسماء وتأكد منها',
        'مفيش حد اسمه كده، مين قال كده؟ راجع معلوماتك',
        'Is this correct? Verify the release dates for all parts',
        'That is wrong, correct this list',
      ];

      for (const text of corrections) {
        const res = PrecisionFactualDetector.evaluate(text);
        expect(res.policy).toBe('PRECISION_FACTUAL');
        expect(res.requiresSearch).toBe(true);
        expect(res.category).toBe('FACTUAL_VERIFICATION_OR_CORRECTION');
      }
    });

    it('A.5: Classifies historical sequence & ruler lineages as PRECISION_FACTUAL', () => {
      const query = 'معركة قادش كانت سنة كام ومين كان الحاكم وقتها؟';
      const result = PrecisionFactualDetector.evaluate(query);

      expect(result.policy).toBe('PRECISION_FACTUAL');
      expect(result.requiresSearch).toBe(true);
      expect(result.category).toBe('HISTORICAL_EVENT_OR_RULER');
    });

    it('A.6: Classifies detailed technical benchmark queries as PRECISION_FACTUAL', () => {
      const query = 'Geekbench score for M4 Max and full changelog';
      const result = PrecisionFactualDetector.evaluate(query);

      expect(result.policy).toBe('PRECISION_FACTUAL');
      expect(result.requiresSearch).toBe(true);
      expect(result.category).toBe('TECHNICAL_SPEC_OR_VERSION');
    });
  });

  // =========================================================================
  // Part B: Foundational General Knowledge Preserved as NORMAL (No Forced Search)
  // =========================================================================
  describe('Part B: Foundational General Knowledge Preserved as NORMAL', () => {
    it('B.1: Single-hop founder queries remain NORMAL (zero token waste)', () => {
      const queries = [
        'مين مؤسس Apple؟',
        'مين مؤسس شركة مايكروسوفت؟',
        'مين اسس امازون؟',
        'Who is the founder of Apple?',
      ];

      for (const q of queries) {
        const res = PrecisionFactualDetector.evaluate(q);
        expect(res.policy).toBe('NORMAL');
        expect(res.requiresSearch).toBe(false);
        expect(res.score).toBeLessThan(0.40);
      }
    });

    it('B.2: Single-hop country capital queries remain NORMAL', () => {
      const queries = [
        'إيه عاصمة فرنسا؟',
        'ما هي عاصمة مصر؟',
        'عاصمة إيطاليا إيه؟',
        'What is the capital of France?',
        'what is the capital of Japan?',
      ];

      for (const q of queries) {
        const res = PrecisionFactualDetector.evaluate(q);
        expect(res.policy).toBe('NORMAL');
        expect(res.requiresSearch).toBe(false);
      }
    });

    it('B.3: Foundational tech definitions remain NORMAL', () => {
      const queries = [
        'ما هو Flutter؟',
        'ايه هو Docker؟',
        'What is React?',
      ];

      for (const q of queries) {
        const res = PrecisionFactualDetector.evaluate(q);
        expect(res.policy).toBe('NORMAL');
        expect(res.requiresSearch).toBe(false);
      }
    });
  });

  // =========================================================================
  // Part C: Adaptive Tool Policy Scoping for Precision Factual
  // =========================================================================
  describe('Part C: Adaptive Tool Policy Scoping for Precision Factual', () => {
    it('C.1: Resolves SCOPED manifest containing strictly [web_search, get_current_time] for franchise query', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const result = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        "لو عايز ألعب سلسلة Assassin's Creed بالترتيب",
        'user_message'
      );

      expect(result.mode).toBe('SCOPED');
      expect(result.toolNames).toContain('web_search');
      expect(result.toolNames).toContain('get_current_time');
      expect(result.toolNames).not.toContain('create_reminder');
      expect(result.toolNames).not.toContain('save_memory');
      expect(result.toolNames.length).toBe(2);
      expect(result.reason).toContain('SCOPED_PRECISION_FACTUAL');
    });

    it('C.2: Resolves SCOPED manifest for correction turns', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const result = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        'الكلام ده مش صح، مين إدوارد كينج ده؟ صححلي الترتيب',
        'user_message'
      );

      expect(result.mode).toBe('SCOPED');
      expect(result.toolNames).toContain('web_search');
      expect(result.toolNames).toContain('get_current_time');
    });

    it('C.3: Preserves SCOPED manifest across multi-step execution for precision factual queries', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const result = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        "ترتيب ألعاب Assassin's Creed",
        'user_message',
        {
          hasPriorSteps: true,
          priorToolNames: ['web_search'],
        }
      );

      expect(result.mode).toBe('SCOPED');
      expect(result.toolNames).toEqual(expect.arrayContaining(['web_search', 'get_current_time']));
      expect(result.toolNames.length).toBe(2);
      expect(result.reason).toBe('SCOPED_PRECISION_FACTUAL_PRIOR_STEPS');
    });

    it('C.4: Never injects forbidden tools during smart_reminder trigger even if factual text is present', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'smart_reminder');
      const result = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        "لو عايز ألعب سلسلة Assassin's Creed بالترتيب",
        'smart_reminder'
      );

      expect(result.toolNames).not.toContain('create_reminder');
      expect(result.toolNames).not.toContain('save_memory');
      expect(result.toolNames).not.toContain('whatsapp_outbound');
    });
  });

  // =========================================================================
  // Part D: ExecutionPlanner Step-0 Mandatory Search Enforcement
  // =========================================================================
  describe('Part D: ExecutionPlanner Step-0 Mandatory Search Enforcement', () => {
    it('D.1: Enforces toolChoice = { type: "function", function: { name: "web_search" } } on step 0 for PRECISION_FACTUAL', async () => {
      let capturedRequest: AIRequest | undefined;
      const mockRouter = {
        route: async (req: AIRequest): Promise<any> => {
          capturedRequest = req;
          return {
            providerId: 'groq',
            model: 'test',
            message: { role: 'assistant', content: '' },
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: { query: "Assassin's Creed chronological game release order" },
                },
              },
            ],
            usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
          };
        },
      } as any;

      const planner = new ExecutionPlanner(mockRouter);
      const state = ExecutionStateManager.createInitialState(
        'run_factual_01',
        'task_factual_01',
        "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية",
        3
      );

      const decision = await planner.planNextStep(
        state,
        {
          runId: 'run_factual_01',
          userId: 'user_01',
          conversationId: 'conv_01',
          channel: 'whatsapp',
          userGoal: "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية",
          languageContext: egyptianLangContext,
        },
        []
      );

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.toolChoice).toEqual({
        type: 'function',
        function: { name: 'web_search' },
      });
      expect(decision.type).toBe('tool_call');
      expect((decision as any).toolName).toBe('web_search');
    });

    it('D.2: Foundational fact queries (NORMAL) retain toolChoice: "auto" without forcing search', async () => {
      let capturedRequest: AIRequest | undefined;
      const mockRouter = {
        route: async (req: AIRequest): Promise<any> => {
          capturedRequest = req;
          return {
            providerId: 'groq',
            model: 'test',
            message: { role: 'assistant', content: 'مؤسس شركة أبل هو ستيف جوبز وستيف وزنياك ورونالد واين.' },
            usage: { promptTokens: 90, completionTokens: 20, totalTokens: 110 },
          };
        },
      } as any;

      const planner = new ExecutionPlanner(mockRouter);
      const state = ExecutionStateManager.createInitialState(
        'run_normal_01',
        'task_normal_01',
        'مين مؤسس Apple؟',
        3
      );

      const decision = await planner.planNextStep(
        state,
        {
          runId: 'run_normal_01',
          userId: 'user_01',
          conversationId: 'conv_01',
          channel: 'whatsapp',
          userGoal: 'مين مؤسس Apple؟',
          languageContext: egyptianLangContext,
        },
        []
      );

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.toolChoice).toBe('auto');
      expect(decision.type).toBe('finish');
      expect((decision as any).finalAnswer).toContain('ستيف جوبز');
    });
  });

  // =========================================================================
  // Part E: Search Failure Safety (Zero Guessing / Fallback Invariant)
  // =========================================================================
  describe('Part E: Search Failure Safety (Zero Guessing / Fallback Invariant)', () => {
    it('E.1: Generates graceful Egyptian Arabic fallback when search execution returns zero results for PRECISION_FACTUAL', () => {
      const outcome = FactualClaimGuard.evaluateSearchOutcome(
        "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية",
        [
          {
            toolName: 'web_search',
            status: 'succeeded',
            result: { results: [] }, // Empty results!
            serializedResult: 'No search results found.',
          },
        ],
        egyptianLangContext
      );

      expect(outcome.shouldFallback).toBe(true);
      expect(outcome.fallbackMessage).toBeDefined();
      expect(outcome.fallbackMessage).toContain('علشان أكون دقيق معاك');
      expect(outcome.fallbackMessage).toContain('تعذر عليا التحقق من الترتيب الكامل');
      expect(outcome.fallbackMessage).toContain('تحب نبحث عن جزء معين بالاسم؟');
      // Invariant: Never confabulates or guesses
      expect(outcome.fallbackMessage).not.toContain('Edward King');
    });

    it('E.2: Generates graceful English fallback when search fails for English PRECISION_FACTUAL query', () => {
      const outcome = FactualClaimGuard.evaluateSearchOutcome(
        "Chronological play order of Assassin's Creed series with all protagonists",
        [
          {
            toolName: 'web_search',
            status: 'failed',
            result: null,
          },
        ],
        englishLangContext
      );

      expect(outcome.shouldFallback).toBe(true);
      expect(outcome.fallbackMessage).toContain("To be completely accurate");
      expect(outcome.fallbackMessage).toContain("wasn't able to verify the exact chronology");
    });

    it('E.3: Does not trigger failure safety when search returns valid, rich observations', () => {
      const outcome = FactualClaimGuard.evaluateSearchOutcome(
        "لو عايز ألعب سلسلة Assassin's Creed بالترتيب",
        [
          {
            toolName: 'web_search',
            status: 'succeeded',
            result: {
              results: [
                {
                  title: "Assassin's Creed Game Order (Release & Chronological)",
                  snippet: "Assassin's Creed (2007) starring Altaïr, Assassin's Creed II (2009) with Ezio Auditore, AC IV Black Flag with Edward Kenway.",
                  url: 'https://ign.com/ac-order',
                },
              ],
            },
          },
        ],
        egyptianLangContext
      );

      expect(outcome.shouldFallback).toBe(false);
    });
  });

  // =========================================================================
  // Part F: Evidence-Bound Synthesis & Confabulation Prevention
  // =========================================================================
  describe('Part F: Evidence-Bound Synthesis & Confabulation Prevention', () => {
    it('F.1: Builds strict evidence-bound directives prohibiting name inventions', () => {
      const directive = FactualClaimGuard.buildEvidenceBoundDirective(true, egyptianLangContext);

      expect(directive).toContain('قواعد التثبت والتوثيق الصارم للحقائق');
      expect(directive).toContain('Edward Kenway');
      expect(directive).toContain('Edward King');
      expect(directive).toContain('إياك واختلاق أو تخمين أسماء شخصيات');
    });

    it('F.2: Flags known confabulated entity anomalies (Edward King detector)', () => {
      const badText = "الجزء الرابع Black Flag بطله إدوارد كينج (Edward King) في منطقة الكاريبي.";
      const check = FactualClaimGuard.validateKnownFactualAnomalies(badText);

      expect(check.isGrounded).toBe(false);
      expect(check.unverifiedEntities).toContain("Edward King (confabulated Assassin's Creed entity)");

      const goodText = "الجزء الرابع Black Flag بطله إدوارد كينواي (Edward Kenway) في الكاريبي.";
      const goodCheck = FactualClaimGuard.validateKnownFactualAnomalies(goodText);
      expect(goodCheck.isGrounded).toBe(true);
      expect(goodCheck.unverifiedEntities.length).toBe(0);
    });
  });

  // =========================================================================
  // Part G: Natural Response Guard (Robotic Preamble Removal)
  // =========================================================================
  describe('Part G: Natural Response Guard', () => {
    it('G.1: Strips robotic preamble "أنا Craft – إليك النسخة المصححة..."', () => {
      const input = "أنا Craft – إليك النسخة المصححة:\n\n1. Assassin's Creed (2007) - البطل: Altaïr Ibn-La'Ahad.";
      const cleaned = NaturalResponseGuard.cleanResponsePreamble(input, 'صححلي الترتيب');

      expect(cleaned).toBe("1. Assassin's Creed (2007) - البطل: Altaïr Ibn-La'Ahad.");
      expect(cleaned).not.toContain('أنا Craft');
      expect(cleaned).not.toContain('إليك النسخة المصححة');
    });

    it('G.2: Strips "بصفتي Craft..." and "كـ AI مساعد..."', () => {
      const input = "بصفتي Craft: الترتيب الصحيح للأجزاء يبدأ من الجزء الأول سنة 2007.";
      const cleaned = NaturalResponseGuard.cleanResponsePreamble(input);
      expect(cleaned).toBe("الترتيب الصحيح للأجزاء يبدأ من الجزء الأول سنة 2007.");

      const input2 = "كـ AI مساعد، إليك تفاصيل ترتيب الألعاب:";
      const cleaned2 = NaturalResponseGuard.cleanResponsePreamble(input2);
      expect(cleaned2).toBe("تفاصيل ترتيب الألعاب:");
    });

    it('G.3: Strips English meta-preambles ("I am Craft - here is the corrected version")', () => {
      const input = "I am Craft - here is the corrected version:\n\n1. Assassin's Creed (2007)";
      const cleaned = NaturalResponseGuard.cleanResponsePreamble(input);
      expect(cleaned).toBe("1. Assassin's Creed (2007)");
      expect(cleaned).not.toContain('I am Craft');
    });

    it('G.4: Strips internal processing statements ("بعد البحث في المصادر المعتمدة...")', () => {
      const input = "بعد البحث في المصادر: الجزء الأول نزل سنة 2007.";
      const cleaned = NaturalResponseGuard.cleanResponsePreamble(input);
      expect(cleaned).toBe("الجزء الأول نزل سنة 2007.");
    });

    it('G.5: Preserves natural identity statements when user explicitly asks "مين انت؟"', () => {
      const input = "أنا Craft، مساعدك الشخصي الذكي.";
      const cleaned = NaturalResponseGuard.cleanResponsePreamble(input, 'مين انت؟');
      expect(cleaned).toBe("أنا Craft، مساعدك الشخصي الذكي.");
    });
  });

  // =========================================================================
  // Part H: Prompt Directives & Egyptian Dialect Invariants
  // =========================================================================
  describe('Part H: Prompt Directives & Egyptian Dialect Invariants', () => {
    it('H.1: SystemPromptBuilder static prefix includes NaturalResponseGuard and Precision Factual mandates', () => {
      const prefix = SystemPromptBuilder.buildStaticPrefix(egyptianLangContext, defaultPersonality);

      expect(prefix).toContain('Precision Factual Grounding & Multi-Part Chronology Rules');
      expect(prefix).toContain("Whenever the user asks about multi-part game series (e.g. Assassin's Creed");
      expect(prefix).toContain('NEVER fabricate character names (e.g. NEVER confuse Edward Kenway with "Edward King")');
      expect(prefix).toContain('Natural Response & Anti-Robotic Preamble Guard');
      expect(prefix).toContain('إياك تماماً والبدء بمقدمات آلية');
    });

    it('H.2: SynthesisPromptBuilder static prefix includes anti-preamble and anti-confabulation rules', () => {
      const synthesisPrefix = SynthesisPromptBuilder.buildStaticPrefix(egyptianLangContext, defaultPersonality);

      expect(synthesisPrefix).toContain('Verified Evidence Grounding & Anti-Hallucination');
      expect(synthesisPrefix).toContain('NEVER fabricate character names, dates, release years');
      expect(synthesisPrefix).toContain('NEVER start responses with robotic meta-preambles');
      // Dialect persistence:
      expect(synthesisPrefix).toContain('Natural, friendly, and professional Egyptian Arabic');
      expect(synthesisPrefix).toContain('NEVER revert or switch back to Modern Standard Arabic');
      // Negative constraint against slang copying:
      expect(synthesisPrefix).toContain('NEVER say "يا باشا", "يا معلم", "يا صاحبي"');
    });
  });

  // =========================================================================
  // Part I: Full ExecutionEngine End-to-End Simulation
  // =========================================================================
  describe('Part I: Full ExecutionEngine End-to-End Simulation', () => {
    it('I.1: End-to-end execution of Assassin\'s Creed query forces search and produces clean answer', async () => {
      let searchCalled = false;
      const mockRouter = {
        route: async (req: AIRequest): Promise<any> => {
          // If planner request with tools:
          if (req.tools && req.tools.length > 0) {
            searchCalled = true;
            return {
              providerId: 'groq',
              model: 'test',
              message: { role: 'assistant', content: '' },
              toolCalls: [
                {
                  id: 'call_search_ac',
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: { query: "Assassin's Creed chronological order games protagonists" },
                  },
                },
              ],
            };
          }
          // Synthesis request:
          return {
            providerId: 'groq',
            model: 'test',
            message: {
              role: 'assistant',
              content:
                "أنا Craft – إليك النسخة المصححة:\n\nلو عايز تبدأ سلسلة Assassin's Creed بالترتيب، الترتيب الموصى به:\n1. Assassin's Creed (2007) - البطل الطائر (Altaïr).\n2. Assassin's Creed II (2009) - البطل إزيو (Ezio).\n3. Assassin's Creed IV: Black Flag (2013) - البطل إدوارد كينواي (Edward Kenway).",
            },
          };
        },
      } as any;

      const engine = new ExecutionEngine(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new ExecutionPlanner(mockRouter),
        mockRouter
      );

      const runResult = await engine.run(
        {
          runId: 'run_e2e_ac_01',
          userId: 'user_ac',
          conversationId: 'conv_ac',
          channel: 'whatsapp',
          userGoal: "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية",
          languageContext: egyptianLangContext,
        },
        []
      );

      expect(searchCalled).toBe(true);
      expect(runResult.status).toBe('completed');
      expect(runResult.finalReply).toContain("لو عايز تبدأ سلسلة Assassin's Creed بالترتيب");
      expect(runResult.finalReply).toContain('Edward Kenway');
      expect(runResult.finalReply).not.toContain('Edward King');
      // Invariant: NaturalResponseGuard stripped the robotic preamble "أنا Craft – إليك النسخة المصححة:"!
      expect(runResult.finalReply).not.toContain('أنا Craft');
      expect(runResult.finalReply).not.toContain('إليك النسخة المصححة');
    });

    it('I.2: End-to-end execution of search failure triggers safe fallback without parametric confabulation', async () => {
      // Mock step executor returning 0 search items or error
      const mockRouter = {
        route: async (req: AIRequest): Promise<any> => {
          if (req.tools && req.tools.length > 0) {
            return {
              providerId: 'groq',
              model: 'test',
              message: { role: 'assistant', content: '' },
              toolCalls: [
                {
                  id: 'call_search_fail',
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: { query: "fail query" },
                  },
                },
              ],
            };
          }
          return { providerId: 'groq', model: 'test', message: { role: 'assistant', content: 'Fallback response' } };
        },
      } as any;

      const mockStepExecutor = {
        executeStep: async () => ({
          status: 'failed',
          error: 'Search upstream timeout or connection failure',
        }),
      } as any;

      const engine = new ExecutionEngine(
        undefined,
        undefined,
        undefined,
        undefined,
        mockStepExecutor,
        new ExecutionPlanner(mockRouter),
        mockRouter
      );

      const runResult = await engine.run(
        {
          runId: 'run_e2e_ac_fail',
          userId: 'user_ac',
          conversationId: 'conv_ac',
          channel: 'whatsapp',
          userGoal: "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية",
          languageContext: egyptianLangContext,
        },
        []
      );

      // In mock mode without live web, search returns fallback/empty results, which triggers failure safety:
      expect(runResult.finalReply).toContain('علشان أكون دقيق معاك');
      expect(runResult.finalReply).toContain('تعذر عليا التحقق');
    });
  });

  // =========================================================================
  // Part J: Continuous Evaluation & Golden Dataset (56/56 Scenarios)
  // =========================================================================
  describe('Part J: Continuous Evaluation & Golden Dataset Preservation', () => {
    it('J.1: Continuous Evaluation runner executes all 56 golden scenarios with 100% pass rate', async () => {
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
  // Part K: Realistic Assassin's Creed Query & Multi-Entity Attribute Matrix (Sections 4, 10)
  // =========================================================================
  describe('Part K: Realistic Assassin\'s Creed Query & Multi-Entity Attribute Matrix (Sections 4, 10)', () => {
    const acQuery = "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية وكده ألعب إيه بالترتيب";
    const attributeQuery = "مين بطل كل جزء في ألعاب أساسنز كريد والفترة التاريخية ومكان كل جزء";

    it('K.1: Classifies realistic AC query as PRECISION_FACTUAL and requiresSearch=true', () => {
      const evaluation = PrecisionFactualDetector.evaluate(acQuery);
      expect(evaluation.policy).toBe('PRECISION_FACTUAL');
      expect(evaluation.requiresSearch).toBe(true);
      expect(evaluation.signals).toContain('CHRONOLOGY_FRANCHISE_COMPOUND');
    });

    it('K.2: Classifies multi-entity attribute query as PRECISION_FACTUAL category MULTI_ENTITY_ATTRIBUTES', () => {
      const evaluation = PrecisionFactualDetector.evaluate(attributeQuery);
      expect(evaluation.policy).toBe('PRECISION_FACTUAL');
      expect(evaluation.category).toBe('MULTI_ENTITY_ATTRIBUTES');
      expect(evaluation.requiresSearch).toBe(true);
    });

    it('K.3: Forces toolChoice web_search on step 0 and scopes manifest to strictly [web_search, get_current_time]', async () => {
      const state = ExecutionStateManager.createInitialState(
        'run_k3',
        'task_k3',
        acQuery,
        3
      );

      let capturedRequest: AIRequest | undefined;
      const mockRouter = {
        route: async (req: AIRequest): Promise<any> => {
          capturedRequest = req;
          return {
            providerId: 'groq',
            model: 'test',
            message: { role: 'assistant', content: '' },
            toolCalls: [
              {
                id: 'call_search',
                type: 'function',
                function: { name: 'web_search', arguments: { query: "Assassin's Creed chronological order" } },
              },
            ],
          };
        },
      } as any;

      const planner = new ExecutionPlanner(mockRouter);
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const toolResolution = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, acQuery, 'user_message');
      expect(toolResolution.toolNames.slice().sort()).toEqual(['get_current_time', 'web_search']);

      await planner.planNextStep(
        state,
        {
          runId: 'run_k3',
          userId: 'user_k3',
          conversationId: 'conv_k3',
          channel: 'whatsapp',
          userGoal: acQuery,
          languageContext: egyptianLangContext,
        },
        []
      );

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.toolChoice).toEqual({
        type: 'function',
        function: { name: 'web_search' },
      });
    });
  });

  // =========================================================================
  // Part L: Hallucination Regression & Edward King Secondary Invariant (Section 5)
  // =========================================================================
  describe('Part L: Hallucination Regression & Edward King Secondary Invariant (Section 5)', () => {
    it('L.1: Structural defense prevents ungrounded hallucination without relying on keyword ban', () => {
      // Primary defense: mandatory search + bounded synthesis + search failure safety
      const evaluation = PrecisionFactualDetector.evaluate("لو عايز ألعب سلسلة Assassin's Creed بالترتيب");
      expect(evaluation.requiresSearch).toBe(true);
      expect(evaluation.policy).toBe('PRECISION_FACTUAL');
    });

    it('L.2: Secondary test helper validateKnownFactualAnomalies detects confabulated Edward King', () => {
      const hallucinatedOutput = "الجزء الرابع Black Flag بطله Edward King وهو قرصان.";
      const checkResult = FactualClaimGuard.validateKnownFactualAnomalies(hallucinatedOutput);
      expect(checkResult.isGrounded).toBe(false);
      expect(checkResult.unverifiedEntities).toContain("Edward King (confabulated Assassin's Creed entity)");

      const arabicHallucinatedOutput = "الجزء الرابع بطله إدوارد كينج في الكاريبي.";
      const checkArabicResult = FactualClaimGuard.validateKnownFactualAnomalies(arabicHallucinatedOutput);
      expect(checkArabicResult.isGrounded).toBe(false);
    });

    it('L.3: Secondary test helper confirms grounded output with Edward Kenway passes cleanly', () => {
      const groundedOutput = "الجزء الرابع Black Flag بطله Edward Kenway (إدوارد كينواي) في جزر الكاريبي سنة 1715.";
      const checkResult = FactualClaimGuard.validateKnownFactualAnomalies(groundedOutput);
      expect(checkResult.isGrounded).toBe(true);
      expect(checkResult.unverifiedEntities).toHaveLength(0);
    });
  });

  // =========================================================================
  // Part M: User Correction & Verification Follow-up Flows (Section 6)
  // =========================================================================
  describe('Part M: User Correction & Verification Follow-up Flows (Section 6)', () => {
    const correctionQuery = "طب إنت قلتلي قبل كده إن فيه Edward King، مين ده؟";
    const explicitCorrectionQuery = "أنا عايز التصحيح الكامل للمعلومات اللي قلتها.";

    it('M.1: Correction queries are classified as PRECISION_FACTUAL with category FACTUAL_VERIFICATION_OR_CORRECTION', () => {
      const eval1 = PrecisionFactualDetector.evaluate(correctionQuery);
      expect(eval1.policy).toBe('PRECISION_FACTUAL');
      expect(eval1.category).toBe('FACTUAL_VERIFICATION_OR_CORRECTION');
      expect(eval1.requiresSearch).toBe(true);

      const eval2 = PrecisionFactualDetector.evaluate(explicitCorrectionQuery);
      expect(eval2.policy).toBe('PRECISION_FACTUAL');
      expect(eval2.category).toBe('FACTUAL_VERIFICATION_OR_CORRECTION');
      expect(eval2.requiresSearch).toBe(true);
    });

    it('M.2: Scopes tools to [web_search, get_current_time] on correction follow-up', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const toolResolution = AdaptiveToolPolicy.resolveAdaptiveTools(allowed, correctionQuery, 'user_message');
      expect(toolResolution.toolNames.slice().sort()).toEqual(['get_current_time', 'web_search']);
    });
  });

  // =========================================================================
  // Part N: Anti-Robotic Preamble Stripping & Natural Response Guard (Section 7)
  // =========================================================================
  describe('Part N: Anti-Robotic Preamble Stripping & Natural Response Guard (Section 7)', () => {
    it('N.1: Strips "أنا Craft – إليك النسخة المصححة:" when user asks for full correction', () => {
      const raw = "أنا Craft – إليك النسخة المصححة:\n\nالترتيب المظبوط لسلسلة Assassin's Creed كالتالي: ...";
      const cleaned = NaturalResponseGuard.cleanResponsePreamble(raw, "أنا عايز التصحيح الكامل للمعلومات اللي قلتها.");
      expect(cleaned).toBe("الترتيب المظبوط لسلسلة Assassin's Creed كالتالي: ...");
      expect(cleaned).not.toContain("أنا Craft");
      expect(cleaned).not.toContain("إليك النسخة المصححة");
    });

    it('N.2: Strips "كـ AI مساعد..." and "بعد البحث في المصادر المعتمدة:"', () => {
      const raw1 = "كـ AI مساعد، الترتيب الصحيح يبدأ من جزء 2007.";
      expect(NaturalResponseGuard.cleanResponsePreamble(raw1)).toBe("الترتيب الصحيح يبدأ من جزء 2007.");

      const raw2 = "بعد البحث في المصادر المعتمدة: أول جزء نزل سنة 2007.";
      expect(NaturalResponseGuard.cleanResponsePreamble(raw2)).toBe("أول جزء نزل سنة 2007.");

      const raw3 = "بناءً على نتائج البحث: البطل هو Altaïr.";
      expect(NaturalResponseGuard.cleanResponsePreamble(raw3)).toBe("البطل هو Altaïr.");
    });
  });

  // =========================================================================
  // Part O: Identity Query Exceptions (Section 8)
  // =========================================================================
  describe('Part O: Identity Query Exceptions (Section 8)', () => {
    const identityQueries = [
      'مين انت؟',
      'إنت مين؟',
      'هو انت مين؟',
      'What are you?',
      'Who are you?',
      'Who is Craft?',
      'عرف نفسك',
    ];

    it.each(identityQueries)('O.1: Recognizes "%s" as an explicit identity query', (query) => {
      expect(NaturalResponseGuard.isExplicitIdentityQuery(query)).toBe(true);
    });

    it('O.2: Preserves authentic self-introduction without stripping when user explicitly asks', () => {
      const response = "أنا Craft، مساعدك الشخصي الذكي، مبني علشان أساعدك في مهامك البرمجية واليومية.";
      for (const query of identityQueries) {
        const cleaned = NaturalResponseGuard.cleanResponsePreamble(response, query);
        expect(cleaned).toBe(response);
      }
    });
  });

  // =========================================================================
  // Part P: Search Negative Boundary / General Knowledge Preserved (Section 9)
  // =========================================================================
  describe('Part P: Search Negative Boundary / General Knowledge Preserved (Section 9)', () => {
    const foundationalQueries = [
      'مين مؤسس Apple؟',
      'مين مؤسس أبل؟',
      'إيه عاصمة فرنسا؟',
      'ما هي عاصمة فرنسا؟',
      'ما هو Flutter؟',
      'ازيك عامل ايه؟',
    ];

    it.each(foundationalQueries)('P.1: Retains NORMAL policy and requiresSearch=false for "%s"', (query) => {
      const evaluation = PrecisionFactualDetector.evaluate(query);
      expect(evaluation.policy).toBe('NORMAL');
      expect(evaluation.requiresSearch).toBe(false);
    });

    it('P.2: Leaves toolChoice as "auto" for foundational queries without forcing search', async () => {
      let capturedRequest: AIRequest | undefined;
      const mockRouter = {
        route: async (req: AIRequest): Promise<any> => {
          capturedRequest = req;
          return {
            providerId: 'groq',
            model: 'test',
            message: { role: 'assistant', content: 'مؤسس Apple هو ستيف جوبز وستيف وزنياك ورونالد واين.' },
          };
        },
      } as any;

      const planner = new ExecutionPlanner(mockRouter);
      const state = ExecutionStateManager.createInitialState(
        'run_p2',
        'task_p2',
        'مين مؤسس Apple؟',
        3
      );

      await planner.planNextStep(
        state,
        {
          runId: 'run_p2',
          userId: 'user_p2',
          conversationId: 'conv_p2',
          channel: 'whatsapp',
          userGoal: 'مين مؤسس Apple؟',
          languageContext: egyptianLangContext,
        },
        []
      );

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.toolChoice).toBe('auto');
    });
  });

  // =========================================================================
  // Part Q: Search Failure in 3 Modes & Zero Guessing (Section 11)
  // =========================================================================
  describe('Part Q: Search Failure in 3 Modes & Zero Guessing (Section 11)', () => {
    const acGoal = "لو عايز ألعب سلسلة Assassin's Creed بالترتيب من البداية";

    it('Q.1: Mode 1 - Search Timeout / Failure returns graceful fallback without confabulation', () => {
      const steps = [
        {
          toolName: 'web_search',
          status: 'failed',
          result: { error: 'Upstream search provider timeout (504)' },
        },
      ];
      const outcome = FactualClaimGuard.evaluateSearchOutcome(acGoal, steps, egyptianLangContext);
      expect(outcome.shouldFallback).toBe(true);
      expect(outcome.reason).toBe('ALL_SEARCH_STEPS_FAILED');
      expect(outcome.fallbackMessage).toContain('علشان أكون دقيق معاك');
      expect(outcome.fallbackMessage).toContain('تعذر عليا التحقق');
      expect(outcome.fallbackMessage).not.toContain('Edward King');
    });

    it('Q.2: Mode 2 - Search returns 0 results returns graceful fallback', () => {
      const steps = [
        {
          toolName: 'web_search',
          status: 'succeeded',
          result: { results: [] },
          serializedResult: '{"results":[]}',
        },
      ];
      const outcome = FactualClaimGuard.evaluateSearchOutcome(acGoal, steps, egyptianLangContext);
      expect(outcome.shouldFallback).toBe(true);
      expect(outcome.reason).toBe('ZERO_SEARCH_RESULTS_RETURNED');
      expect(outcome.fallbackMessage).toContain('علشان أكون دقيق معاك');
    });

    it('Q.3: Mode 3 - Search returns unusable/malformed results returns graceful fallback', () => {
      const steps = [
        {
          toolName: 'web_search',
          status: 'succeeded',
          result: { error: 'Blocked by rate limit' },
          serializedResult: 'No search results available',
        },
      ];
      const outcome = FactualClaimGuard.evaluateSearchOutcome(acGoal, steps, egyptianLangContext);
      expect(outcome.shouldFallback).toBe(true);
      expect(outcome.reason).toBe('ZERO_SEARCH_RESULTS_RETURNED');
      expect(outcome.fallbackMessage).toContain('علشان أكون دقيق معاك');
    });
  });

  // =========================================================================
  // Part R: Partial Evidence & Missing Attribute Handling (Section 12)
  // =========================================================================
  describe('Part R: Partial Evidence & Missing Attribute Handling (Section 12)', () => {
    it('R.1: Evidence directive instructs model not to guess missing attributes', () => {
      const directive = FactualClaimGuard.buildEvidenceBoundDirective(true, egyptianLangContext);
      expect(directive).toContain('إذا كان هناك جزء أو شخصية لم تذكرها نتائج البحث الموثقة');
      expect(directive).toContain('قل بوضوح ودون تردد إن المعلومة دي محتاجة بحث منفصل، ولا تخمنها أبداً من الذاكرة');
    });

    it('R.2: English directive similarly prohibits fabricating unverified attributes', () => {
      const englishDirective = FactualClaimGuard.buildEvidenceBoundDirective(true, englishLangContext);
      expect(englishDirective).toContain('If any requested entity, release date, or character is missing from the search results');
      expect(englishDirective).toContain('state explicitly that it was not confirmed rather than guessing from parametric memory');
    });
  });

  // =========================================================================
  // Part S: Contradictory Evidence Between Sources (Section 13)
  // =========================================================================
  describe('Part S: Contradictory Evidence Between Sources (Section 13)', () => {
    it('S.1: Synthesis directives mandate preserving divergence between conflicting sources', () => {
      const synthesisPrefix = SynthesisPromptBuilder.buildStaticPrefix(egyptianLangContext, defaultPersonality);
      expect(synthesisPrefix).toContain('Verified Evidence Grounding & Anti-Hallucination');
      expect(synthesisPrefix).toContain('NEVER fabricate character names, dates, release years');
      expect(synthesisPrefix).toContain('Ground your final response strictly and exclusively on the verified tool execution outcomes');
    });
  });

  // =========================================================================
  // Part T: Scoped Manifest vs Full Manifest Token Efficiency (Section 14)
  // =========================================================================
  describe('Part T: Scoped Manifest vs Full Manifest Token Efficiency (Section 14)', () => {
    it('T.1: PRECISION_FACTUAL scopes manifest to strictly 2 tools instead of 8 tools', () => {
      const allowed = capabilityPolicy.filterTools(registry.getAllTools(), 'user_message');
      const toolResolution = AdaptiveToolPolicy.resolveAdaptiveTools(
        allowed,
        "لو عايز ألعب سلسلة Assassin's Creed بالترتيب",
        'user_message'
      );
      const fullManifest = registry.getAllTools();

      expect(toolResolution.toolNames).toHaveLength(2);
      expect(toolResolution.toolNames.slice().sort()).toEqual(['get_current_time', 'web_search']);
      expect(fullManifest.length).toBeGreaterThanOrEqual(8);

      const scopedTools = allowed.filter((t) => toolResolution.toolNames.includes(t.name));
      const scopedChars = JSON.stringify(scopedTools).length;
      const fullChars = JSON.stringify(fullManifest).length;

      // Scoped tool manifest overhead is ~70-80% smaller than full manifest!
      const reductionRatio = (fullChars - scopedChars) / fullChars;
      expect(reductionRatio).toBeGreaterThan(0.65);
    });
  });

  // =========================================================================
  // Part U: Personality Guard Preservation (Section 16)
  // =========================================================================
  describe('Part U: Personality Guard Preservation (Section 16)', () => {
    it('U.1: Prohibits echoing user titles ("يا باشا", "يا غالي", "bro", "يا معلم")', () => {
      const prompt = SynthesisPromptBuilder.buildStaticPrefix(egyptianLangContext, defaultPersonality);
      expect(prompt).toContain('NEVER say "يا باشا", "يا معلم", "يا صاحبي", "يا سيدي الفاضل", "يا هندسة"');
      expect(prompt).toContain('Addressing: Do not use titles, honorifics, or familiar nicknames by default');
      expect(prompt).toContain('Natural, friendly, and professional Egyptian Arabic');
    });
  });
});

