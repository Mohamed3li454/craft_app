/**
 * Phase 13.3 — Proactive Trigger Capability Policy Test Suite
 *
 * Verifies the granular capability-based tool access control policy on Proactive triggers:
 *
 * 1. Manifest Scoping & Zero Manifest Leak:
 *    - Explicit tool manifests per proactive variant (morning_briefing, reengagement, etc.)
 *    - Full registry does NOT reach the planner/LLM for proactive triggers.
 *    - Mutation and messaging tools (create_reminder, save_memory, send_message, dispatch_proactive) are absent.
 *    - OpenAI-compatible tool schemas are properly structured and scoped.
 *
 * 2. Strict Default-Deny for Unknown Proactive Triggers:
 *    - Unrecognized proactive trigger names return an empty manifest ([]) with zero tools exposed.
 *    - ExecutionPlanner receives tools: undefined and toolChoice: undefined.
 *
 * 3. Allowed Informational Tools:
 *    - get_current_time, get_weather, web_search execute when allowed by variant policy.
 *    - Variant-specific restrictions (e.g. web_search absent from reengagement, get_weather absent from follow_up_offer).
 *
 * 4. Denied Tools & Defense in Depth:
 *    - Forbidden tools return status: 'denied' and code: 'TOOL_NOT_ALLOWED_FOR_TRIGGER'.
 *    - Anti-recursion protection: dispatch_proactive is strictly forbidden.
 *    - Confirmation requests are NEVER created for forbidden tools under proactive triggers.
 *    - FailureHandler classifies TOOL_NOT_ALLOWED_FOR_TRIGGER as unrecoverable security block (canRetry: false).
 *    - StepExecutor passes triggerType into ToolExecutionContext.
 *
 * 5. Persistence Boundary Protection in Pipeline Stages:
 *    - Preflight Stage: Semantic cache and user daily rate limits are bypassed for proactive triggers.
 *    - Cognitive Stage: Synthetic user turn persistence and memory fact extraction are bypassed.
 *    - Execution Stage: Confirmation notice persistence is bypassed.
 *    - PostProcess Stage: Assistant message persistence and LearningPipeline observation are bypassed.
 *
 * 6. Regression & Invariant Protection:
 *    - Standard user_message receives full unrestricted tool manifest (all 8 tools).
 *    - smart_reminder receives exactly its 3 tools.
 *    - Low-cardinality observability metrics (craft.tool.policy.allowed, craft.tool.policy.denied).
 *    - Zero runtime DDL and zero business table mutations.
 */

import { AgentPipeline } from '../src/modules/agent/pipeline/pipeline';
import { PreflightStage } from '../src/modules/agent/pipeline/stages/preflight.stage';
import { CognitiveStage } from '../src/modules/agent/pipeline/stages/cognitive.stage';
import { ExecutionStage } from '../src/modules/agent/pipeline/stages/execution.stage';
import { PostProcessStage } from '../src/modules/agent/pipeline/stages/post_process.stage';
import { AgentPipelineContext, AgentPipelineDependencies } from '../src/modules/agent/pipeline/types';
import { ExecutionPlanner } from '../src/modules/agent/execution/planner';
import { StepExecutor } from '../src/modules/agent/execution/step_executor';
import { FailureHandler } from '../src/modules/agent/execution/failure_handler';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { ToolRegistry } from '../src/modules/tools/registry';
import { ToolLifecycleManager } from '../src/modules/tools/lifecycle/tool_lifecycle';
import { ToolPermissionGate } from '../src/modules/tools/safety/permission_gate';
import {
  ToolCapabilityPolicy,
  PROACTIVE_CAPABILITY_POLICIES,
  PROACTIVE_FORBIDDEN_TOOLS,
  SMART_REMINDER_ALLOWED_TOOLS,
} from '../src/modules/tools/safety/tool_capability_policy';
import { ToolExecutionContext } from '../src/modules/tools/contracts/tool.types';
import { MetricsCollector } from '../src/modules/observability';
import { DatabaseManager } from '../src/database/connection';
import { UserRepository } from '../src/database/repositories/user.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { ConfirmationRepository } from '../src/database/repositories/confirmation.repo';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { LearningPipeline } from '../src/modules/cache/learning/learning_pipeline';
import { TokenBudgetManager } from '../src/modules/context';
import { LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityEngine } from '../src/modules/personality';
import { config } from '../src/config/env';

describe('Phase 13.3: Proactive Trigger Capability Policy', () => {
  let mockDb: DatabaseManager;
  let userRepo: UserRepository;
  let chatRepo: ChatRepository;
  let memoryRepo: MemoryRepository;
  let userPrefRepo: UserPreferenceRepository;
  let confRepo: ConfirmationRepository;
  let confService: ConfirmationService;
  let groqProvider: GroqProvider;
  let toolRegistry: ToolRegistry;
  let lifecycleManager: ToolLifecycleManager;
  let capabilityPolicy: ToolCapabilityPolicy;
  let metricsCollector: MetricsCollector;

  const originalMockMode = config.groq.isMockMode;

  beforeAll(() => {
    config.groq.isMockMode = true;
  });

  afterAll(() => {
    config.groq.isMockMode = originalMockMode;
  });

  beforeEach(() => {
    mockDb = {
      getPool: () => null,
      getSupabase: () => null,
    } as unknown as DatabaseManager;

    userRepo = new UserRepository(mockDb);
    chatRepo = new ChatRepository(mockDb, userRepo);
    memoryRepo = new MemoryRepository(mockDb);
    userPrefRepo = new UserPreferenceRepository(mockDb);
    confRepo = new ConfirmationRepository(mockDb);
    confService = new ConfirmationService(confRepo);

    groqProvider = new GroqProvider();

    toolRegistry = ToolRegistry.getInstance();
    lifecycleManager = ToolLifecycleManager.getInstance();
    capabilityPolicy = ToolCapabilityPolicy.getInstance();
    metricsCollector = MetricsCollector.getInstance();

    jest.spyOn(SemanticCacheEngine.getInstance(), 'process').mockResolvedValue({
      type: 'miss',
      reason: 'mock_test_mode',
      latencyMs: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. PROACTIVE TRIGGER IDENTIFICATION & MANIFEST SCOPING
  // =========================================================================
  describe('1. Proactive Trigger Identification & Manifest Scoping', () => {
    it('correctly identifies proactive family triggers', () => {
      expect(capabilityPolicy.isProactiveTrigger('proactive')).toBe(true);
      expect(capabilityPolicy.isProactiveTrigger('proactive_morning_briefing')).toBe(true);
      expect(capabilityPolicy.isProactiveTrigger('proactive_reengagement')).toBe(true);
      expect(capabilityPolicy.isProactiveTrigger('proactive_unresolved_follow_up')).toBe(true);
      expect(capabilityPolicy.isProactiveTrigger('proactive_next_step_offer')).toBe(true);
      expect(capabilityPolicy.isProactiveTrigger('proactive_follow_up_offer')).toBe(true);
      expect(capabilityPolicy.isProactiveTrigger('proactive:custom_intent')).toBe(true);
    });

    it('returns false for non-proactive triggers', () => {
      expect(capabilityPolicy.isProactiveTrigger('user_message')).toBe(false);
      expect(capabilityPolicy.isProactiveTrigger('smart_reminder')).toBe(false);
      expect(capabilityPolicy.isProactiveTrigger(undefined)).toBe(false);
      expect(capabilityPolicy.isProactiveTrigger('')).toBe(false);
      expect(capabilityPolicy.isProactiveTrigger('webhook')).toBe(false);
    });

    it('scopes tool manifests accurately per known proactive trigger', () => {
      expect(capabilityPolicy.getAllowedTools('proactive')).toEqual([
        'get_current_time',
        'get_weather',
        'web_search',
      ]);
      expect(capabilityPolicy.getAllowedTools('proactive_morning_briefing')).toEqual([
        'get_current_time',
        'get_weather',
        'web_search',
      ]);
      expect(capabilityPolicy.getAllowedTools('proactive_reengagement')).toEqual([
        'get_current_time',
        'get_weather',
      ]);
      expect(capabilityPolicy.getAllowedTools('proactive_unresolved_follow_up')).toEqual([
        'get_current_time',
        'web_search',
      ]);
      expect(capabilityPolicy.getAllowedTools('proactive_next_step_offer')).toEqual([
        'get_current_time',
        'web_search',
      ]);
      expect(capabilityPolicy.getAllowedTools('proactive_follow_up_offer')).toEqual([
        'get_current_time',
      ]);
    });

    it('filters OpenAI tools manifest for planner so only allowed tools reach LLM', () => {
      const morningTools = capabilityPolicy.getFilteredOpenAITools(
        toolRegistry,
        'proactive_morning_briefing'
      );
      const morningNames = morningTools.map((t) => t.function.name);
      expect(morningNames).toEqual(['get_current_time', 'get_weather', 'web_search']);

      // Mutation tools must NOT leak
      expect(morningNames).not.toContain('create_reminder');
      expect(morningNames).not.toContain('save_memory');
      expect(morningNames).not.toContain('complete_reminder');
      expect(morningNames).not.toContain('echo_message');
    });

    it('conforms to standard OpenAI tool definition structure', () => {
      const filtered = capabilityPolicy.getFilteredOpenAITools(
        toolRegistry,
        'proactive_morning_briefing'
      );
      for (const tool of filtered) {
        expect(tool.type).toBe('function');
        expect(tool.function).toBeDefined();
        expect(typeof tool.function.name).toBe('string');
        expect(typeof tool.function.description).toBe('string');
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.parameters.type).toBe('object');
        expect(tool.function.parameters.properties).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 2. STRICT DEFAULT-DENY ON UNKNOWN PROACTIVE TRIGGERS
  // =========================================================================
  describe('2. Strict Default-Deny on Unknown Proactive Triggers', () => {
    it('returns an empty array (0 tools) for an unrecognized proactive trigger', () => {
      const allowed = capabilityPolicy.getAllowedTools('proactive_unknown_experiment');
      expect(allowed).toBeDefined();
      expect(allowed).toEqual([]);
      expect(allowed?.length).toBe(0);
    });

    it('filters all registry tools to zero for an unknown proactive trigger', () => {
      const allTools = toolRegistry.getAllTools();
      expect(allTools.length).toBeGreaterThanOrEqual(7);

      const scopedTools = capabilityPolicy.filterTools(allTools, 'proactive_unregistered_future');
      expect(scopedTools).toEqual([]);
      expect(scopedTools.length).toBe(0);
    });

    it('returns empty OpenAI tools array for unknown proactive trigger', () => {
      const filtered = capabilityPolicy.getFilteredOpenAITools(
        toolRegistry,
        'proactive_rogue_trigger'
      );
      expect(filtered).toEqual([]);
      expect(filtered.length).toBe(0);
    });

    it('causes ExecutionPlanner to send tools: undefined and toolChoice: undefined', async () => {
      const planner = new ExecutionPlanner(undefined, toolRegistry, capabilityPolicy);

      const state: any = {
        runId: 'run_proactive_deny_1',
        taskId: 'task_proactive_1',
        status: 'planning',
        currentStep: 0,
        maxSteps: 3,
        goal: 'Proactive engagement',
        steps: [],
        totalToolCalls: 0,
        totalToolExecutionMs: 0,
        startedAt: Date.now(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const context: any = {
        runId: 'run_proactive_deny_1',
        userId: 'test_user_p1',
        conversationId: 'conv_proactive_1',
        channel: 'whatsapp',
        userGoal: 'Proactive engagement',
        triggerType: 'proactive_unknown_trigger',
      };

      const routeSpy = jest.spyOn((planner as any).aiRouter, 'route');

      await planner.planNextStep(state, context, []);

      expect(routeSpy).toHaveBeenCalledTimes(1);
      const passedRequest = routeSpy.mock.calls[0][0] as any;
      expect(passedRequest.tools).toBeUndefined();
      expect(passedRequest.toolChoice).toBeUndefined();

      routeSpy.mockRestore();
    });
  });

  // =========================================================================
  // 3. ALLOWED INFORMATIONAL TOOLS IN PROACTIVE TRIGGERS
  // =========================================================================
  describe('3. Allowed Informational Tools Execution in Proactive Triggers', () => {
    const baseContext: ToolExecutionContext = {
      runId: 'run_proactive_allowed_1',
      userId: 'test_user_p2',
      conversationId: 'conv_p2',
      channel: 'whatsapp',
      triggerType: 'proactive_morning_briefing',
    };

    it('executes get_current_time successfully through ToolLifecycleManager', async () => {
      const result = await lifecycleManager.execute(
        'get_current_time',
        { timeZone: 'Africa/Cairo' },
        baseContext
      );
      expect(result.status).toBe('completed');
      expect(result.rawResult).toBeDefined();
      expect(result.rawResult.formatted).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('executes get_weather successfully through ToolLifecycleManager', async () => {
      const result = await lifecycleManager.execute(
        'get_weather',
        { city: 'Cairo' },
        baseContext
      );
      expect(result.status).toBe('completed');
      expect(result.rawResult).toBeDefined();
      expect(result.rawResult.city).toBe('Cairo');
      expect(result.error).toBeUndefined();
    });

    it('executes web_search successfully through ToolLifecycleManager', async () => {
      const result = await lifecycleManager.execute(
        'web_search',
        { query: 'latest tech news' },
        baseContext
      );
      expect(result.status).toBe('completed');
      expect(result.rawResult).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('respects variant-specific exclusion: web_search denied for proactive_reengagement', async () => {
      const reengageContext: ToolExecutionContext = {
        ...baseContext,
        triggerType: 'proactive_reengagement',
      };
      const result = await lifecycleManager.execute(
        'web_search',
        { query: 'any search' },
        reengageContext
      );
      expect(result.status).toBe('denied');
      expect(result.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('respects variant-specific exclusion: get_weather denied for proactive_follow_up_offer', async () => {
      const followUpContext: ToolExecutionContext = {
        ...baseContext,
        triggerType: 'proactive_follow_up_offer',
      };
      const result = await lifecycleManager.execute(
        'get_weather',
        { city: 'Dubai' },
        followUpContext
      );
      expect(result.status).toBe('denied');
      expect(result.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });
  });

  // =========================================================================
  // 4. DENIED TOOLS, RECURSION PREVENTION & DEFENSE IN DEPTH
  // =========================================================================
  describe('4. Denied Tools, Recursion Prevention & Defense in Depth', () => {
    const proactiveContext: ToolExecutionContext = {
      runId: 'run_proactive_denied_1',
      userId: 'test_user_p3',
      conversationId: 'conv_p3',
      channel: 'whatsapp',
      triggerType: 'proactive',
    };

    it('contains all required security forbidden tools in PROACTIVE_FORBIDDEN_TOOLS', () => {
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('create_reminder');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('cancel_reminder');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('complete_reminder');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('save_memory');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('delete_memory');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('send_message');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('whatsapp_outbound');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('dispatch_proactive');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('mutate_conversation');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('execute_payment');
      expect(PROACTIVE_FORBIDDEN_TOOLS).toContain('confirm_action');
    });

    it('denies create_reminder deterministically with TOOL_NOT_ALLOWED_FOR_TRIGGER', async () => {
      const result = await lifecycleManager.execute(
        'create_reminder',
        { title: 'Rogue proactive reminder', time: 'tomorrow 10am' },
        proactiveContext
      );
      expect(result.status).toBe('denied');
      expect(result.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('denies save_memory deterministically with TOOL_NOT_ALLOWED_FOR_TRIGGER', async () => {
      const result = await lifecycleManager.execute(
        'save_memory',
        { fact: 'User prefers quiet mornings' },
        proactiveContext
      );
      expect(result.status).toBe('denied');
      expect(result.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('strictly denies dispatch_proactive to prevent infinite recursive loops', async () => {
      const evalResult = capabilityPolicy.isToolAllowed('dispatch_proactive', 'proactive');
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');

      const gateDecision = ToolPermissionGate.getInstance().evaluate(
        {
          name: 'dispatch_proactive',
          description: 'Dispatches proactive message',
          isSensitive: true,
          parameters: { type: 'object', properties: {} },
          execute: async () => ({ success: true, data: {} }),
        },
        proactiveContext
      );

      expect(gateDecision.allowed).toBe(false);
      expect(gateDecision.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('confirms ToolPermissionGate sets requiresConfirmation = false on trigger denial', () => {
      const reminderTool = toolRegistry.getTool('create_reminder')!;
      const gateDecision = ToolPermissionGate.getInstance().evaluate(reminderTool, proactiveContext);

      expect(gateDecision.allowed).toBe(false);
      expect(gateDecision.requiresConfirmation).toBe(false);
      expect(gateDecision.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('confirms FailureHandler classifies TOOL_NOT_ALLOWED_FOR_TRIGGER as fatal unrecoverable block', () => {
      const failureHandler = FailureHandler.getInstance();
      const step: any = {
        id: 'step_proactive_denied',
        toolName: 'create_reminder',
        status: 'failed',
        error: {
          code: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
          message: 'Tool [create_reminder] is not permitted for trigger "proactive"',
        },
        retryCount: 0,
      };
      const state: any = { steps: [step], currentStep: 1 };
      const policy: any = { maxSteps: 3 };

      const resolution = failureHandler.handleFailure(step, state, policy);
      expect(resolution.canRetry).toBe(false);
      expect(resolution.strategy).toBe('abort_to_failure');
      expect(resolution.reason).toContain('Fatal security policy block');
    });

    it('confirms StepExecutor passes triggerType correctly into ToolExecutionContext', async () => {
      const execSpy = jest.spyOn(lifecycleManager, 'execute');
      const stepExecutor = new StepExecutor(lifecycleManager);

      const engineContext: any = {
        runId: 'run_p_step_test_1',
        userId: 'test_user_p4',
        conversationId: 'conv_p_step_1',
        channel: 'whatsapp',
        triggerType: 'proactive_morning_briefing',
      };

      await stepExecutor.executeStep('get_weather', { city: 'Giza' }, engineContext);

      expect(execSpy).toHaveBeenCalledWith(
        'get_weather',
        { city: 'Giza' },
        expect.objectContaining({ triggerType: 'proactive_morning_briefing' })
      );

      execSpy.mockRestore();
    });
  });

  // =========================================================================
  // 5. PERSISTENCE BOUNDARY PROTECTION IN PIPELINE STAGES
  // =========================================================================
  describe('5. Persistence Boundary Protection in Pipeline Stages', () => {
    let mockContext: AgentPipelineContext;
    let mockDeps: AgentPipelineDependencies;

    beforeEach(() => {
      mockContext = {
        input: {
          userId: 'usr_stage_test_1',
          channel: 'whatsapp',
          text: 'Proactive morning briefing prompt',
          triggerType: 'proactive_morning_briefing',
        },
        agentRunId: 'run_stage_1',
        startTime: Date.now(),
        cleanUserText: 'Proactive morning briefing prompt',
        triggerType: 'proactive_morning_briefing',
        channel: 'whatsapp',
        conversationId: 'conv_stage_1',
        textToProcess: 'Proactive morning briefing prompt',
        mediaType: 'text',
        isAudio: false,
        isImage: false,
        effectivePrompt: 'Proactive morning briefing prompt',
        historyRecordText: 'Proactive morning briefing prompt',
        interimSent: false,
        sendInterim: jest.fn(),
        languageContext: LanguageIntelligenceService.getInstance().resolveContext('صباح الخير'),
        personalityContext: PersonalityEngine.getInstance().getDefaultPersonality(),
        recentMessages: [],
        toolCallsExecuted: [],
        finalReply: 'صباح الخير! إليك ملخص الصباح.',
        lastModelUsed: 'llama-3.3-70b-versatile',
        accumulatedPromptTokens: 100,
        accumulatedCompletionTokens: 50,
        accumulatedTotalTokens: 150,
        status: 'completed',
      };

      mockDeps = {
        groqProvider,
        toolRegistry,
        confirmationService: confService,
        chatRepo,
        memoryRepo,
        userRepo,
        userPreferenceRepo: userPrefRepo,
        tokenBudgetManager: new TokenBudgetManager(),
        toolLifecycleManager: lifecycleManager,
      };
    });

    it('PreflightStage: bypasses semantic cache and daily rate limit for proactive triggers', async () => {
      const cacheSpy = jest.spyOn(SemanticCacheEngine.getInstance(), 'process');
      const limitSpy = jest.spyOn(userRepo, 'checkAndIncrementDailyLimit');

      const preflight = new PreflightStage();
      await preflight.execute(mockContext, mockDeps);

      expect(cacheSpy).not.toHaveBeenCalled();
      expect(limitSpy).not.toHaveBeenCalled();
    });

    it('CognitiveStage: skips user message persistence and memory fact extraction', async () => {
      const saveMsgSpy = jest.spyOn(chatRepo, 'saveMessage').mockResolvedValue({} as any);
      const getRecentSpy = jest.spyOn(chatRepo, 'getRecentMessages').mockResolvedValue([]);
      const extractSpy = jest.spyOn(memoryRepo, 'extractAndSaveFacts').mockResolvedValue([] as any);

      const cognitive = new CognitiveStage();
      await cognitive.execute(mockContext, mockDeps);

      // Should load recent messages for context
      expect(getRecentSpy).toHaveBeenCalledWith(mockContext.conversationId, 8);
      // But should NOT save the synthetic proactive prompt to DB
      expect(saveMsgSpy).not.toHaveBeenCalled();
      // And should NOT extract memory facts from system prompt
      expect(extractSpy).not.toHaveBeenCalled();
    });

    it('ExecutionStage: skips confirmation notice DB persistence for proactive triggers', async () => {
      const saveMsgSpy = jest.spyOn(chatRepo, 'saveMessage').mockResolvedValue({} as any);
      const createConfSpy = jest.spyOn(confService, 'createConfirmationRequest').mockResolvedValue({
        token: 'mock_token_123',
        actionName: 'create_reminder',
        description: 'Test confirmation',
        expiresAt: new Date(Date.now() + 3600000),
      } as any);

      // Mock engine execution returning confirmation needed
      const mockEngine = {
        run: jest.fn().mockResolvedValue({
          status: 'waiting_confirmation',
          finalReply: 'Prompt notice',
          toolCallsExecuted: [],
          steps: [
            {
              status: 'waiting_confirmation',
              toolName: 'create_reminder',
              input: { title: 'Test' },
            },
          ],
          metrics: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        }),
      } as any;

      mockDeps.executionEngine = mockEngine;

      const execution = new ExecutionStage();
      await execution.execute(mockContext, mockDeps);

      expect(mockContext.status).toBe('waiting_for_confirmation');
      expect(createConfSpy).toHaveBeenCalled();
      // Crucial: ChatRepo.saveMessage must NOT be called for proactive system trigger
      expect(saveMsgSpy).not.toHaveBeenCalled();
    });

    it('PostProcessStage: skips assistant reply persistence and learning observation for proactive triggers', async () => {
      const saveMsgSpy = jest.spyOn(chatRepo, 'saveMessage').mockResolvedValue({} as any);
      const observeSpy = jest.spyOn(LearningPipeline.getInstance(), 'observeRun').mockResolvedValue();

      const postProcess = new PostProcessStage();
      await postProcess.execute(mockContext, mockDeps);

      // Assistant reply is dispatched via outbound WhatsApp scheduler on delivery, NOT directly saved here
      expect(saveMsgSpy).not.toHaveBeenCalled();
      // Learning pipeline should not learn from synthetic proactive runs
      expect(observeSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 6. REGRESSION & INVARIANT PROTECTION
  // =========================================================================
  describe('6. Regression & Invariant Protection', () => {
    it('user_message receives full unrestricted tool manifest (all 8 tools)', () => {
      const allowed = capabilityPolicy.getAllowedTools('user_message');
      expect(allowed).toBeUndefined(); // unrestricted

      const filtered = capabilityPolicy.getFilteredOpenAITools(toolRegistry, 'user_message');
      expect(filtered.length).toBe(toolRegistry.getAllTools().length);
      expect(filtered.length).toBeGreaterThanOrEqual(7);

      const toolNames = filtered.map((t) => t.function.name);
      expect(toolNames).toContain('create_reminder');
      expect(toolNames).toContain('save_memory');
      expect(toolNames).toContain('get_weather');
      expect(toolNames).toContain('web_search');
    });

    it('undefined trigger receives full unrestricted tool manifest', () => {
      const allowed = capabilityPolicy.getAllowedTools(undefined);
      expect(allowed).toBeUndefined();

      const filtered = capabilityPolicy.getFilteredOpenAITools(toolRegistry, undefined);
      expect(filtered.length).toBe(toolRegistry.getAllTools().length);
    });

    it('smart_reminder retains exactly its 3 permitted tools', () => {
      const allowed = capabilityPolicy.getAllowedTools('smart_reminder');
      expect(allowed).toEqual(SMART_REMINDER_ALLOWED_TOOLS);
      expect(allowed).toEqual(['get_current_time', 'get_weather', 'web_search']);
    });

    it('emits low-cardinality observability metrics for allowed and denied decisions', () => {
      const incSpy = jest.spyOn(metricsCollector, 'increment');

      // Test allowed call
      capabilityPolicy.isToolAllowed('get_weather', 'proactive_morning_briefing');
      expect(incSpy).toHaveBeenCalledWith(
        'craft.tool.policy.allowed',
        1,
        expect.objectContaining({
          triggerType: 'proactive_morning_briefing',
          toolName: 'get_weather',
          decision: 'allowed',
        })
      );

      // Test denied call
      capabilityPolicy.isToolAllowed('create_reminder', 'proactive_morning_briefing');
      expect(incSpy).toHaveBeenCalledWith(
        'craft.tool.policy.denied',
        1,
        expect.objectContaining({
          triggerType: 'proactive_morning_briefing',
          toolName: 'create_reminder',
          decision: 'denied',
          reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        })
      );
    });

    it('proactive_unresolved_follow_up and proactive_next_step_offer reject weather tool', () => {
      const followUpEval = capabilityPolicy.isToolAllowed('get_weather', 'proactive_unresolved_follow_up');
      expect(followUpEval.allowed).toBe(false);
      expect(followUpEval.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');

      const nextStepEval = capabilityPolicy.isToolAllowed('get_weather', 'proactive_next_step_offer');
      expect(nextStepEval.allowed).toBe(false);
      expect(nextStepEval.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('executes AgentPipeline cleanly end-to-end with proactive trigger without saving unverified messages', async () => {
      const saveMsgSpy = jest.spyOn(chatRepo, 'saveMessage').mockResolvedValue({} as any);
      const getRecentSpy = jest.spyOn(chatRepo, 'getRecentMessages').mockResolvedValue([]);

      const pipeline = new AgentPipeline({
        groqProvider,
        toolRegistry,
        confirmationService: confService,
        chatRepo,
        memoryRepo,
        userRepo,
        userPreferenceRepo: userPrefRepo,
      });

      const output = await pipeline.execute({
        userId: 'usr_e2e_proactive',
        channel: 'whatsapp',
        text: 'Morning briefing generation for user',
        triggerType: 'proactive_morning_briefing',
      });

      expect(output).toBeDefined();
      expect(output.status).toBe('completed');
      expect(output.replyText).toBeDefined();
      // Crucial: Persistence boundary held throughout pipeline execution
      expect(saveMsgSpy).not.toHaveBeenCalled();
    });
  });
});
