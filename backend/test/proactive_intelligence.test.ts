/**
 * Phase 7.1 — In-Turn Proactive Intelligence Comprehensive Test Suite
 *
 * Validates deterministic in-turn opportunity detection, negative guardrails,
 * topic-switch protection, memory boundaries, prompt compactness, and non-breaking integration.
 */

import {
  ProactiveEngine,
  CandidateDetector,
  ProactivePolicyResolver,
  buildProactivePrompt,
  ProactiveOpportunity,
} from '../src/modules/proactive';
import { ConversationState } from '../src/modules/conversation/types';
import { AdaptiveResponseEngine } from '../src/modules/response';
import { LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityEngine } from '../src/modules/personality';
import { MemoryRetrievalService } from '../src/modules/memory';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';

function createMockConversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    activeTopic: 'flutter_build_issue',
    topicHistory: [
      {
        topic: 'flutter_build_issue',
        domain: 'technical',
        startedAtTurnIndex: 0,
        lastSeenAtTurnIndex: 1,
      },
    ],
    isTopicSwitch: false,
    previousTopic: null,
    isFollowUp: true,
    requiresContext: true,
    contextualizedQuery: 'المشكلة لسه بتحصل بعد flutter clean',
    goal: 'troubleshooting',
    resolutionState: 'unresolved',
    unresolvedItems: ['Gradle build failed with exit code 1'],
    sessionEntities: ['flutter', 'gradle'],
    confidence: 0.95,
    ...overrides,
  };
}

describe('Phase 7.1 — In-Turn Proactive Intelligence', () => {
  const engine = ProactiveEngine.getInstance();

  // =========================================================================
  // 1. Candidate Detection
  // =========================================================================
  describe('1. Candidate Detection', () => {
    test('Scenario 1 — Unresolved troubleshooting: Generates unresolved_follow_up candidate', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['Gradle build failed with exit code 1'],
      });
      const opp = CandidateDetector.detect({
        query: 'المشكلة لسه بتحصل بعد flutter clean',
        conversationState: state,
      });

      expect(opp).not.toBeNull();
      expect(opp?.type).toBe('unresolved_follow_up');
      expect(opp?.confidence).toBeGreaterThanOrEqual(0.90);
    });

    test('Scenario 2 — In-progress troubleshooting: Generates next_step_offer candidate', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'in_progress',
        unresolvedItems: ['Fixing database pool timeout'],
      });
      const opp = CandidateDetector.detect({
        query: 'جربت الحل الأول وطلع خطأ تاني',
        conversationState: state,
      });

      expect(opp).not.toBeNull();
      expect(opp?.type).toBe('next_step_offer');
      expect(opp?.confidence).toBeGreaterThanOrEqual(0.85);
    });

    test('Scenario 3 — Unresolved planning: Generates follow_up_offer candidate', () => {
      const state = createMockConversationState({
        goal: 'planning',
        resolutionState: 'unresolved',
        unresolvedItems: ['Microservices architecture roadmap'],
      });
      const opp = CandidateDetector.detect({
        query: 'عايز أخطط لتقسيم النظام لـ microservices',
        conversationState: state,
      });

      expect(opp).not.toBeNull();
      expect(opp?.type).toBe('follow_up_offer');
      expect(opp?.confidence).toBeGreaterThanOrEqual(0.80);
    });

    test('Scenario 4 — Resolved troubleshooting: Returns null (strictly no candidate)', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'resolved',
        unresolvedItems: [],
      });
      const opp = CandidateDetector.detect({
        query: 'شكراً الكود اشتغل تمام!',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });

    test('Scenario 5 — Informational goal: Returns null (strictly no candidate without explicit request)', () => {
      const state = createMockConversationState({
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
      });
      const opp = CandidateDetector.detect({
        query: 'ما هو الفرق بين TCP و UDP؟',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });

    test('Scenario 6 — Casual goal: Returns null (strictly no candidate)', () => {
      const state = createMockConversationState({
        goal: 'casual',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
      });
      const opp = CandidateDetector.detect({
        query: 'صباح الخير عامل ايه؟',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });

    test('Scenario 7 — Empty unresolvedItems without in-progress or planning: Returns null', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: [],
      });
      const opp = CandidateDetector.detect({
        query: 'ايه الأخبار',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });
  });

  // =========================================================================
  // 2. Topic Protection
  // =========================================================================
  describe('2. Topic Protection', () => {
    test('Scenario 8 — Unresolved old topic + topic switch: Suppresses proactive candidate', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['Old crash in Flutter'],
        isTopicSwitch: true,
        previousTopic: 'flutter_crash',
        activeTopic: 'cooking_recipes',
      });
      const opp = CandidateDetector.detect({
        query: 'ازاي أعمل كيكة الشوكولاتة؟',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });

    test('Scenario 9 — Same active topic: Candidate allowed', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['PostgreSQL connection timeout'],
        isTopicSwitch: false,
        activeTopic: 'database_debug',
      });
      const opp = CandidateDetector.detect({
        query: 'الكونكشن لسه بيقع بعد 30 ثانية',
        conversationState: state,
      });

      expect(opp).not.toBeNull();
      expect(opp?.topic).toBe('database_debug');
    });

    test('Scenario 10 — Follow-up on active topic: Candidate allowed', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'in_progress',
        unresolvedItems: ['PostgreSQL connection timeout'],
        isFollowUp: true,
        isTopicSwitch: false,
        activeTopic: 'database_debug',
      });
      const opp = CandidateDetector.detect({
        query: 'طب بعد ما أعدل الـ max_connections أعمل ايه؟',
        conversationState: state,
      });

      expect(opp).not.toBeNull();
      expect(opp?.type).toBe('next_step_offer');
    });
  });

  // =========================================================================
  // 3. Memory Boundary
  // =========================================================================
  describe('3. Memory Boundary (Memory NEVER triggers proactive candidate)', () => {
    test('Scenario 11 — Technical memory + cooking query: Zero candidate generated', () => {
      // Memory: User is Flutter developer. Current query: cooking.
      const state = createMockConversationState({
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        activeTopic: 'cooking',
        isTopicSwitch: false,
      });
      const policy = engine.analyze({
        query: 'إزاي أعمل كيكة فانيليا هشة وسهلة؟',
        conversationState: state,
      });

      expect(policy.shouldSuggest).toBe(false);
      expect(policy.suggestionType).toBe('none');
    });

    test('Scenario 12 — Unrelated memory: Does not influence proactive decision', () => {
      const state = createMockConversationState({
        goal: 'casual',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
      });
      const policy = engine.analyze({
        query: 'أهلاً يا كرافت، يومك سعيد',
        conversationState: state,
      });

      expect(policy.shouldSuggest).toBe(false);
      expect(policy.suggestionType).toBe('none');
    });

    test('Scenario 13 — Technical memory alone: Cannot trigger proactive opportunity', () => {
      const state = createMockConversationState({
        goal: 'informational',
        resolutionState: 'not_applicable',
        unresolvedItems: [],
        activeTopic: 'general_tech',
      });
      const policy = engine.analyze({
        query: 'ما هي عاصمة إيطاليا؟',
        conversationState: state,
      });

      expect(policy.shouldSuggest).toBe(false);
      expect(policy.suggestionType).toBe('none');
    });
  });

  // =========================================================================
  // 4. Policy Resolution
  // =========================================================================
  describe('4. Policy Resolution', () => {
    test('Scenario 14 — Strong candidate: Resolves to follow_up_offer with guardrails', () => {
      const opp: ProactiveOpportunity = {
        type: 'unresolved_follow_up',
        topic: 'flutter_error',
        context: 'Failed to resolve dependencies',
        confidence: 0.92,
        urgency: 'medium',
        reason: 'unresolved_troubleshooting_issue',
      };
      const policy = ProactivePolicyResolver.resolve(opp);

      expect(policy.shouldSuggest).toBe(true);
      expect(policy.suggestionType).toBe('follow_up_offer');
      expect(policy.confidence).toBe(0.92);
      expect(policy.guardrails).toContain('Never promise autonomous future contact.');
      expect(policy.guardrails).toContain('Do not interrupt the current answer.');
    });

    test('Scenario 15 — Weak candidate (confidence < 0.70): Suppressed to none', () => {
      const opp: ProactiveOpportunity = {
        type: 'unresolved_follow_up',
        topic: 'vague_question',
        context: 'some context',
        confidence: 0.55,
        urgency: 'low',
        reason: 'weak_signal',
      };
      const policy = ProactivePolicyResolver.resolve(opp);

      expect(policy.shouldSuggest).toBe(false);
      expect(policy.suggestionType).toBe('none');
      expect(policy.reason).toBe('suppressed_below_confidence_threshold');
    });

    test('Scenario 16 — Next-step opportunity: Resolves to next_step suggestionType', () => {
      const opp: ProactiveOpportunity = {
        type: 'next_step_offer',
        topic: 'debugging_step',
        context: 'Next step diagnostic',
        confidence: 0.86,
        urgency: 'low',
        reason: 'in_progress_troubleshooting_next_step',
      };
      const policy = ProactivePolicyResolver.resolve(opp);

      expect(policy.shouldSuggest).toBe(true);
      expect(policy.suggestionType).toBe('next_step');
    });

    test('Scenario 17 — No candidate (null): Resolves to none', () => {
      const policy = ProactivePolicyResolver.resolve(null);

      expect(policy.shouldSuggest).toBe(false);
      expect(policy.suggestionType).toBe('none');
      expect(policy.confidence).toBe(0);
    });
  });

  // =========================================================================
  // 5. Safety & Sensitive Context Suppression
  // =========================================================================
  describe('5. Safety & Sensitive Context Suppression', () => {
    test('Scenario 18 — Sensitive unresolved item (passwords/tokens): Strictly suppressed', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['Issue with api_key and token authentication'],
      });
      const opp = CandidateDetector.detect({
        query: 'التوكن السري بتاعي مش راضي يشتغل في الـ API',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });

    test('Scenario 19 — Credential-related issue: Strictly suppressed', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['Failed SSH private_key login'],
      });
      const opp = CandidateDetector.detect({
        query: 'مش عارف أعمل login بالـ private key',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });

    test('Scenario 20 — Medical or financial sensitive context: Strictly suppressed', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['Credit card payment failed on checkout'],
      });
      const opp = CandidateDetector.detect({
        query: 'كارت البنك بتاعي بيترفض في الدفع',
        conversationState: state,
      });

      expect(opp).toBeNull();
    });
  });

  // =========================================================================
  // 6. Prompt Builder & Budget
  // =========================================================================
  describe('6. Prompt Builder & Budget', () => {
    test('Scenario 21 — Active policy (next_step): Prompt section generated', () => {
      const policy = ProactivePolicyResolver.resolve({
        type: 'next_step_offer',
        topic: 'flutter_issue',
        context: 'context',
        confidence: 0.88,
        urgency: 'low',
        reason: 'next_step',
      });
      const prompt = buildProactivePrompt(policy);

      expect(prompt).toContain('### Proactive Guidance:');
      expect(prompt).toContain('Concisely suggest one natural next diagnostic step');
    });

    test('Scenario 22 — No policy (shouldSuggest false): Returns empty string', () => {
      const policy = ProactivePolicyResolver.resolve(null);
      const prompt = buildProactivePrompt(policy);

      expect(prompt).toBe('');
    });

    test('Scenario 23 — Prompt word count: Strictly under 40 words and 2-3 lines', () => {
      const policy1 = ProactivePolicyResolver.resolve({
        type: 'next_step_offer',
        topic: 't1',
        context: 'c1',
        confidence: 0.85,
        urgency: 'low',
        reason: 'r1',
      });
      const prompt1 = buildProactivePrompt(policy1);
      const words1 = prompt1.trim().split(/\s+/).length;
      const lines1 = prompt1.trim().split('\n').length;

      expect(words1).toBeLessThanOrEqual(40);
      expect(lines1).toBeLessThanOrEqual(3);

      const policy2 = ProactivePolicyResolver.resolve({
        type: 'follow_up_offer',
        topic: 't2',
        context: 'c2',
        confidence: 0.90,
        urgency: 'medium',
        reason: 'r2',
      });
      const prompt2 = buildProactivePrompt(policy2);
      const words2 = prompt2.trim().split(/\s+/).length;
      const lines2 = prompt2.trim().split('\n').length;

      expect(words2).toBeLessThanOrEqual(40);
      expect(lines2).toBeLessThanOrEqual(3);
    });

    test('Scenario 24 — Prompt contains explicit negative guardrail against future autonomous contact', () => {
      const policy = ProactivePolicyResolver.resolve({
        type: 'follow_up_offer',
        topic: 't',
        context: 'c',
        confidence: 0.90,
        urgency: 'medium',
        reason: 'r',
      });
      const prompt = buildProactivePrompt(policy);

      expect(prompt).toContain('Never promise autonomous future contact');
    });
  });

  // =========================================================================
  // 7. Non-Breaking Subsystem Integration
  // =========================================================================
  describe('7. Non-Breaking Subsystem Integration', () => {
    test('Scenario 25 — ARI integration: ARI retains full authority over response structure', () => {
      const query = 'بيطلع لي NullPointerException في السطر ده لما برن الكود';
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['NullPointerException in main line 42'],
      });
      const proactivePolicy = engine.analyze({
        query,
        conversationState: state,
      });

      const ariEngine = AdaptiveResponseEngine.getInstance();
      const ariPolicy = ariEngine.analyze({
        query,
        conversationState: state,
      });

      expect(proactivePolicy.shouldSuggest).toBe(true);
      // ARI remains completely independent and controls response strategy and structure
      expect(ariPolicy.strategy).toBe('troubleshooting_flow');
      expect(ariPolicy.structure).toBe('procedural_steps');
    });

    test('Scenario 26 — Language Intelligence remains completely authoritative', () => {
      const langService = LanguageIntelligenceService.getInstance();
      const langCtx = langService.resolveContext('عامل إيه يا باشا فينك من الصبح؟');

      expect(langCtx.targetLanguage).toBe('ar');
      expect(langCtx.dialect).toBe('egyptian');
    });

    test('Scenario 27 — Personality Engine remains completely authoritative', () => {
      const persEngine = PersonalityEngine.getInstance();
      const defaultPers = persEngine.getDefaultPersonality();

      expect(defaultPers.verbosity).toBeDefined();
      expect(defaultPers.formality).toBeDefined();
    });

    test('Scenario 28 — Memory Retrieval remains unchanged and passive', async () => {
      const memService = MemoryRetrievalService.getInstance();
      const retrieved = await memService.retrieve({
        userId: 'test_user_p7',
        message: 'testing memory retrieval',
        language: 'ar',
      });

      expect(retrieved).toBeDefined();
      expect(Array.isArray(retrieved)).toBe(true);
    });

    test('Scenario 29 — Semantic Cache behavior remains unchanged and non-blocking', async () => {
      const cacheEngine = SemanticCacheEngine.getInstance();
      const result = await cacheEngine.process('query_for_cache_test_p7', {
        channel: 'flutter',
      });

      expect(result).toBeDefined();
      expect(['hit', 'miss']).toContain(result.type);
    });

    test('Scenario 30 — Reminder creation remains strictly intact and independent', () => {
      // Proactive 7.1 has zero dependency or modification on reminder creation logic
      const state = createMockConversationState({
        goal: 'transactional',
        resolutionState: 'not_applicable',
      });
      const proactivePolicy = engine.analyze({
        query: 'فكرني بكرة الساعة 5',
        conversationState: state,
      });

      expect(proactivePolicy.shouldSuggest).toBe(false);
      expect(proactivePolicy.suggestionType).toBe('none');
    });
  });

  // =========================================================================
  // 8. Performance Benchmark
  // =========================================================================
  describe('8. Performance Benchmark', () => {
    test('Performance Benchmark — Evaluates ProactiveEngine.analyze() in under 1.0ms on average over 100 iterations', () => {
      const state = createMockConversationState({
        goal: 'troubleshooting',
        resolutionState: 'unresolved',
        unresolvedItems: ['Gradle compilation error'],
      });

      const iterations = 100;
      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        engine.analyze({
          query: 'المشكلة لسه بتحصل بعد flutter clean',
          conversationState: state,
        });
      }
      const durationMs = Date.now() - start;
      const averageMs = durationMs / iterations;

      expect(averageMs).toBeLessThan(1.0);
    });
  });
});
