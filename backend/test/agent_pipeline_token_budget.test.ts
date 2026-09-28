/**
 * Phase 8.1 Dedicated Unit & Integration Test Suite
 *
 * Validates:
 * 1. TokenCounter deterministic estimations (Latin, Arabic, Mixed, Messages)
 * 2. Model Context Profiles lookup and fallback mechanics
 * 3. TokenBudgetManager deterministic priority allocation and truncation
 * 4. AgentPipeline stage execution, early exits (Cache Hit, Rate Limit), and confirmation flow
 * 5. AgentOrchestrator backward compatibility and helper exports
 */

import {
  TokenCounter,
  getModelProfile,
  DEFAULT_MODEL_PROFILE,
  TokenBudgetManager,
} from '../src/modules/context';
import {
  AgentPipeline,
  AgentPipelineContext,
  AgentPipelineDependencies,
  AgentRunInput,
  PreflightStage,
  CognitiveStage,
  ExecutionStage,
  PostProcessStage,
  processMediaAttachment,
  formatGroqConversationHistory,
  serializeToolResultForGroq,
} from '../src/modules/agent/pipeline';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';

describe('Phase 8.1: Centralized Token Budget Manager & Agent Pipeline', () => {
  // =========================================================================
  // 1. TokenCounter Tests
  // =========================================================================
  describe('TokenCounter', () => {
    it('returns 0 for empty, null, or undefined text', () => {
      expect(TokenCounter.countTokens('')).toBe(0);
      expect(TokenCounter.countTokens(null)).toBe(0);
      expect(TokenCounter.countTokens(undefined)).toBe(0);
    });

    it('estimates Latin/ASCII text accurately (~4 chars/token)', () => {
      const text = 'Hello world this is a test'; // 26 chars -> ceil(26 / 4) = 7
      const tokens = TokenCounter.countTokens(text);
      expect(tokens).toBe(7);
    });

    it('estimates Arabic text accurately (~2.8 chars/token)', () => {
      const arabicText = 'مرحبا بك في كرافت'; // 14 Arabic chars (14/2.8 = 5.0) + 3 spaces (3/4 = 0.75) -> ceil(5.75) = 6
      const tokens = TokenCounter.countTokens(arabicText);
      expect(tokens).toBe(6);
      expect(TokenCounter.hasArabicScript(arabicText)).toBe(true);
    });

    it('estimates mixed Latin and Arabic text accurately', () => {
      const mixedText = 'Hello مرحبا'; // 6 Latin + 5 Arabic = 11 chars
      // 5 / 2.8 = 1.785, 6 / 4 = 1.5 -> ceil(3.285) = 4
      const tokens = TokenCounter.countTokens(mixedText);
      expect(tokens).toBe(4);
    });

    it('estimates message turn tokens with framing overhead', () => {
      const messages = [
        { role: 'user', content: 'Hello' }, // 4 overhead + 2 tokens = 6
        { role: 'assistant', content: 'World' }, // 4 overhead + 2 tokens = 6
      ];
      const tokens = TokenCounter.countMessageTokens(messages);
      expect(tokens).toBe(12);
    });

    it('estimates character limits based on token allowances and script type', () => {
      expect(TokenCounter.estimateCharLimit(100, false)).toBe(400); // Latin: 100 * 4 = 400
      expect(TokenCounter.estimateCharLimit(100, true)).toBe(280); // Arabic: 100 * 2.8 = 280
      expect(TokenCounter.estimateCharLimit(0, false)).toBe(0);
    });
  });

  // =========================================================================
  // 2. Model Profiles Tests
  // =========================================================================
  describe('Model Context Profiles', () => {
    it('retrieves exact match for known Groq models', () => {
      const profile = getModelProfile('openai/gpt-oss-120b');
      expect(profile.modelId).toBe('openai/gpt-oss-120b');
      expect(profile.contextWindowTokens).toBe(128000);
      expect(profile.outputReserveTokens).toBe(4096);
      expect(profile.defaultSafetyTokens).toBe(1500);
    });

    it('retrieves profile for qwen models with smaller context window', () => {
      const profile = getModelProfile('qwen/qwen3.8-27b');
      expect(profile.contextWindowTokens).toBe(32768);
      expect(profile.outputReserveTokens).toBe(4096);
      expect(profile.defaultSafetyTokens).toBe(1200);
    });

    it('falls back gracefully to default profile for unknown models', () => {
      const profile = getModelProfile('unknown-provider/obscure-model');
      expect(profile.contextWindowTokens).toBe(DEFAULT_MODEL_PROFILE.contextWindowTokens);
      expect(profile.outputReserveTokens).toBe(DEFAULT_MODEL_PROFILE.outputReserveTokens);
      expect(profile.defaultSafetyTokens).toBe(DEFAULT_MODEL_PROFILE.defaultSafetyTokens);
    });

    it('falls back to default profile when modelId is undefined', () => {
      const profile = getModelProfile(undefined);
      expect(profile).toEqual(DEFAULT_MODEL_PROFILE);
    });
  });

  // =========================================================================
  // 3. TokenBudgetManager Tests
  // =========================================================================
  describe('TokenBudgetManager', () => {
    const manager = TokenBudgetManager.getInstance();

    it('allocates budget with strict priority ordering under standard conditions', () => {
      const result = manager.allocate({
        modelId: 'openai/gpt-oss-120b',
        systemInstructionText: 'You are Craft AI assistant.',
        userQueryText: 'How are you today?',
        candidateMemoryTokens: 200,
        candidateHistoryTurns: 6,
        candidateHistoryChars: 1200,
      });

      expect(result.budget.modelContextLimit).toBe(128000);
      expect(result.budget.systemTokens).toBeGreaterThan(0);
      expect(result.budget.userQueryTokens).toBeGreaterThan(0);
      expect(result.budget.allocatedMemoryTokens).toBe(200);
      expect(result.budget.allocatedHistoryTokens).toBeGreaterThan(1000);
      expect(result.truncationOccurred).toBe(false);
      expect(result.truncationDetails).toHaveLength(0);
    });

    it('caps memory allocation at sensible upper limit', () => {
      const result = manager.allocate({
        modelId: 'openai/gpt-oss-120b',
        systemInstructionText: 'System prompt',
        userQueryText: 'User query',
        candidateMemoryTokens: 5000, // Very large memory request
      });

      // Max memory capped at 2048 tokens
      expect(result.maxMemoryTokens).toBe(2048);
      expect(result.truncationOccurred).toBe(true);
      expect(result.truncationDetails[0]).toContain('Memory truncated');
    });

    it('enforces tool result token cap at 50% of usable tokens', () => {
      // 8192 context window - 2048 reserve - 1000 safety = 5144 usable tokens -> 50% cap = 2572
      const longToolText = 'x'.repeat(20000); // 5000 tokens
      const result = manager.allocate({
        modelId: 'default-fallback',
        userQueryText: 'Short query',
        toolResultText: longToolText,
      });

      expect(result.truncationOccurred).toBe(true);
      expect(result.truncationDetails.some((d) => d.includes('Tool results truncated'))).toBe(true);
      expect(result.budget.toolResultTokens).toBeLessThan(5000);
    });

    it('truncates conversation history while preserving newest messages', () => {
      const history = [
        { senderRole: 'user', text: 'First oldest message that should be dropped' },
        { senderRole: 'assistant', text: 'Second message' },
        { senderRole: 'user', text: 'Third message' },
        { senderRole: 'assistant', text: 'Fourth message newest' },
      ];

      // Max 2 turns and 100 chars
      const truncated = manager.truncateHistory(history, 2, 100);
      expect(truncated.length).toBe(2);
      expect(truncated[0].text).toBe('Third message');
      expect(truncated[1].text).toBe('Fourth message newest');
    });

    it('handles empty history arrays safely in truncateHistory', () => {
      const empty: Array<{ role: string; text: string }> = [];
      const truncated = manager.truncateHistory(empty, 5, 500);
      expect(truncated).toEqual([]);
    });
  });

  // =========================================================================
  // 4. AgentPipeline Architecture & Stages Tests
  // =========================================================================
  describe('AgentPipeline & Stages', () => {
    it('initializes default dependencies in AgentPipeline', () => {
      const pipeline = new AgentPipeline();
      const deps = pipeline.getDependencies();

      expect(deps.groqProvider).toBeDefined();
      expect(deps.toolRegistry).toBeDefined();
      expect(deps.confirmationService).toBeDefined();
      expect(deps.chatRepo).toBeDefined();
      expect(deps.memoryRepo).toBeDefined();
      expect(deps.userRepo).toBeDefined();
      expect(deps.userPreferenceRepo).toBeDefined();
      expect(deps.tokenBudgetManager).toBeDefined();
    });

    it('preflight stage triggers Semantic Cache early exit on cache hit', async () => {
      const mockChatRepo: any = {
        getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'conv-cache-123' }),
        saveMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      };

      const mockDeps: AgentPipelineDependencies = {
        groqProvider: {} as any,
        toolRegistry: {} as any,
        confirmationService: {} as any,
        chatRepo: mockChatRepo,
        memoryRepo: {} as any,
        userRepo: {} as any,
        userPreferenceRepo: {
          getLanguagePreference: jest.fn().mockResolvedValue(null),
          getPersonalityPreference: jest.fn().mockResolvedValue(null),
        } as any,
        tokenBudgetManager: TokenBudgetManager.getInstance(),
      };

      const preflight = new PreflightStage();
      const ctx: AgentPipelineContext = {
        input: { userId: 'u1', channel: 'flutter', text: 'من أنت؟' },
        agentRunId: 'run-1',
        startTime: Date.now(),
        cleanUserText: 'من أنت؟',
        channel: 'flutter',
        conversationId: '',
        textToProcess: 'من أنت؟',
        mediaType: 'text',
        isAudio: false,
        isImage: false,
        effectivePrompt: 'من أنت؟',
        historyRecordText: 'من أنت؟',
        interimSent: false,
        sendInterim: jest.fn(),
        languageContext: {} as any,
        personalityContext: {} as any,
        recentMessages: [],
        toolCallsExecuted: [],
        finalReply: '',
        lastModelUsed: 'primary',
        accumulatedPromptTokens: 0,
        accumulatedCompletionTokens: 0,
        accumulatedTotalTokens: 0,
        status: 'completed',
      };

      // Mock SemanticCacheEngine process to simulate cache hit
      const { SemanticCacheEngine } = require('../src/modules/cache/semantic_cache_engine');
      jest.spyOn(SemanticCacheEngine.getInstance(), 'process').mockResolvedValueOnce({
        type: 'hit',
        response: 'أنا كرافت، مساعدك الذكي الشخصي!',
        metadata: { strategy: 'static', similarity: 1.0 },
      });

      await preflight.execute(ctx, mockDeps);

      expect(ctx.earlyExitOutput).toBeDefined();
      expect(ctx.earlyExitOutput?.replyText).toBe('أنا كرافت، مساعدك الذكي الشخصي!');
      expect(ctx.earlyExitOutput?.metrics?.modelUsed).toBe('semantic-cache');
      expect(ctx.earlyExitOutput?.metrics?.totalTokens).toBe(0);
      expect(mockChatRepo.saveMessage).toHaveBeenCalledTimes(2);
    });

    it('preflight stage triggers Daily Rate Limit early exit when limit exceeded', async () => {
      const mockChatRepo: any = {
        getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'conv-limit-123' }),
        saveMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      };

      const mockUserRepo: any = {
        checkAndIncrementDailyLimit: jest.fn().mockResolvedValue({ allowed: false, currentCount: 40 }),
      };

      const mockDeps: AgentPipelineDependencies = {
        groqProvider: {} as any,
        toolRegistry: {} as any,
        confirmationService: {} as any,
        chatRepo: mockChatRepo,
        memoryRepo: {} as any,
        userRepo: mockUserRepo,
        userPreferenceRepo: {
          getLanguagePreference: jest.fn().mockResolvedValue(null),
          getPersonalityPreference: jest.fn().mockResolvedValue(null),
        } as any,
        tokenBudgetManager: TokenBudgetManager.getInstance(),
      };

      const preflight = new PreflightStage();
      const ctx: AgentPipelineContext = {
        input: { userId: 'u-exceeded', channel: 'flutter', text: 'هل من الممكن مساعدتي؟' },
        agentRunId: 'run-limit',
        startTime: Date.now(),
        cleanUserText: 'هل من الممكن مساعدتي؟',
        channel: 'flutter',
        conversationId: '',
        textToProcess: 'هل من الممكن مساعدتي؟',
        mediaType: 'text',
        isAudio: false,
        isImage: false,
        effectivePrompt: 'هل من الممكن مساعدتي؟',
        historyRecordText: 'هل من الممكن مساعدتي؟',
        interimSent: false,
        sendInterim: jest.fn(),
        languageContext: {} as any,
        personalityContext: {} as any,
        recentMessages: [],
        toolCallsExecuted: [],
        finalReply: '',
        lastModelUsed: 'primary',
        accumulatedPromptTokens: 0,
        accumulatedCompletionTokens: 0,
        accumulatedTotalTokens: 0,
        status: 'completed',
      };

      const { SemanticCacheEngine } = require('../src/modules/cache/semantic_cache_engine');
      jest.spyOn(SemanticCacheEngine.getInstance(), 'process').mockResolvedValueOnce({
        type: 'miss',
      });

      await preflight.execute(ctx, mockDeps);

      expect(ctx.earlyExitOutput).toBeDefined();
      expect(ctx.earlyExitOutput?.metrics?.modelUsed).toBe('rate-limiter');
      expect(ctx.earlyExitOutput?.replyText).toContain('الحد الأقصى للرسائل المجانية اليومية');
      expect(mockChatRepo.saveMessage).toHaveBeenCalledTimes(2);
    });

    it('postProcess stage harmonizes text and saves assistant message', async () => {
      const mockChatRepo: any = {
        saveMessage: jest.fn().mockResolvedValue({ id: 'msg-assist' }),
      };

      const mockDeps: AgentPipelineDependencies = {
        groqProvider: {} as any,
        toolRegistry: {} as any,
        confirmationService: {} as any,
        chatRepo: mockChatRepo,
        memoryRepo: {} as any,
        userRepo: {} as any,
        userPreferenceRepo: {} as any,
        tokenBudgetManager: TokenBudgetManager.getInstance(),
      };

      const postProcess = new PostProcessStage();
      const ctx: AgentPipelineContext = {
        input: { userId: 'u1', channel: 'whatsapp', text: 'hi' },
        agentRunId: 'run-post',
        startTime: Date.now() - 50,
        cleanUserText: 'hi',
        channel: 'whatsapp',
        conversationId: 'conv-post',
        textToProcess: 'hi',
        mediaType: 'text',
        isAudio: false,
        isImage: false,
        effectivePrompt: 'hi',
        historyRecordText: 'hi',
        interimSent: false,
        sendInterim: jest.fn(),
        languageContext: {} as any,
        personalityContext: {} as any,
        recentMessages: [],
        toolCallsExecuted: [],
        finalReply: '### Title\n\n| Col 1 | Col 2 |\n|---|---|\n| A | B |',
        lastModelUsed: 'openai/gpt-oss-120b',
        accumulatedPromptTokens: 10,
        accumulatedCompletionTokens: 20,
        accumulatedTotalTokens: 30,
        status: 'completed',
      };

      await postProcess.execute(ctx, mockDeps);

      expect(ctx.interimSent).toBe(true);
      // cleanWhatsAppText transforms markdown tables to clean bullet points
      expect(ctx.finalReply).not.toContain('| Col 1 | Col 2 |');
      expect(mockChatRepo.saveMessage).toHaveBeenCalledWith(
        'conv-post',
        'assistant',
        'Craft',
        ctx.finalReply,
        undefined,
        expect.objectContaining({
          tokensUsed: 30,
          modelName: 'openai/gpt-oss-120b',
        })
      );
    });
  });

  // =========================================================================
  // 5. AgentOrchestrator Backward Compatibility Tests
  // =========================================================================
  describe('AgentOrchestrator Backward Compatibility', () => {
    it('exports all expected helper functions from pipeline', () => {
      expect(typeof processMediaAttachment).toBe('function');
      expect(typeof formatGroqConversationHistory).toBe('function');
      expect(typeof serializeToolResultForGroq).toBe('function');
    });

    it('instantiates AgentOrchestrator and exposes pipeline instance', () => {
      const orchestrator = new AgentOrchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator.getPipeline()).toBeInstanceOf(AgentPipeline);
    });

    it('serializes web search tool results into compact synthesized format', () => {
      const mockSearchResults = {
        query: 'iPhone 15 price egypt',
        results: [
          { title: 'iPhone 15 - Store A', snippet: 'Price is 45,000 EGP', url: 'https://storea.com/item' },
        ],
      };

      const serialized = serializeToolResultForGroq('web_search', mockSearchResults);
      const parsed = JSON.parse(serialized);

      expect(parsed.status).toBe('search_complete');
      expect(parsed.query).toBe('iPhone 15 price egypt');
      expect(parsed.results[0].title).toBe('iPhone 15 - Store A');
      expect(parsed.results[0].source).toBe('storea.com');
      expect(parsed.instruction).toContain('Live search completed');
    });
  });
});
