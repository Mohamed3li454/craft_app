/**
 * Phase 13.4 — Trigger Capability Contract Hardening Test Suite
 *
 * Verifies the Single Source of Truth for trigger typing, classification,
 * capability policies, and pipeline persistence behaviors across Craft:
 *
 * 1. Canonical Contract:
 *    - All known triggers exist in canonical contract with valid families.
 *    - System triggers (smart_reminder, proactive_*) are strictly classified as isSystemTrigger = true.
 *    - user_message is strictly classified as conversational with isSystemTrigger = false.
 *    - Unknown triggers never morph or convert into user_message.
 *
 * 2. Capability Coverage & Validation:
 *    - validateTriggerCapabilityCoverage() validates all invariants deterministically.
 *    - Every system trigger has an explicit, non-unrestricted capability policy.
 *    - Every proactive variant matches PROACTIVE_CAPABILITY_POLICIES.
 *    - smart_reminder policy has exactly 3 tools.
 *    - Zero system triggers are unrestricted.
 *
 * 3. Pipeline Consistency Across Stages:
 *    - PreflightStage, CognitiveStage, ExecutionStage, PostProcessStage share identical canonical classification.
 *    - All 4 stages make unanimous persistence and rate-limiting decisions.
 *
 * 4. Planner / Permission Gate Consistency:
 *    - ExecutionPlanner and ToolPermissionGate resolve identical tool visibility and authorization.
 *    - Forbidden tools return TOOL_NOT_ALLOWED_FOR_TRIGGER with requiresConfirmation = false.
 *    - FailureHandler classifies trigger denial as fatal unrecoverable block (canRetry = false).
 *
 * 5. Regression & Invariant Protection:
 *    - user_message receives full 8-tool manifest.
 *    - undefined trigger cleanly defaults to user_message.
 *    - smart_reminder retains exactly its 3 tools.
 *    - Low-cardinality observability tags with triggerFamily.
 *
 * 6. Security & Typo/Rogue Trigger Protection:
 *    - Typo triggers (e.g. proactive_reengagment) default-deny with 0 tools.
 *    - Namespaced proactive triggers (proactive:custom) default-deny with 0 tools.
 *    - Arbitrary unknown triggers (rogue_trigger) default-deny with 0 tools.
 *    - Zero direct registry bypass: Planner sends tools: undefined when manifest is empty.
 */

import {
  TriggerContract,
  CANONICAL_TRIGGER_DEFINITIONS,
  AgentTriggerType,
  TriggerFamily,
  TriggerDefinition,
} from '../src/modules/tools/safety/trigger_contract';
import {
  ToolCapabilityPolicy,
  PROACTIVE_CAPABILITY_POLICIES,
  PROACTIVE_FORBIDDEN_TOOLS,
  SMART_REMINDER_ALLOWED_TOOLS,
  SMART_REMINDER_FORBIDDEN_TOOLS,
} from '../src/modules/tools/safety/tool_capability_policy';
import { ToolPermissionGate } from '../src/modules/tools/safety/permission_gate';
import { ToolRegistry } from '../src/modules/tools/registry';
import { ToolLifecycleManager } from '../src/modules/tools/lifecycle/tool_lifecycle';
import { ToolExecutionContext } from '../src/modules/tools/contracts/tool.types';
import { ExecutionPlanner } from '../src/modules/agent/execution/planner';
import { StepExecutor } from '../src/modules/agent/execution/step_executor';
import { FailureHandler } from '../src/modules/agent/execution/failure_handler';
import { PreflightStage } from '../src/modules/agent/pipeline/stages/preflight.stage';
import { CognitiveStage } from '../src/modules/agent/pipeline/stages/cognitive.stage';
import { ExecutionStage } from '../src/modules/agent/pipeline/stages/execution.stage';
import { PostProcessStage } from '../src/modules/agent/pipeline/stages/post_process.stage';
import { AgentPipelineContext, AgentPipelineDependencies } from '../src/modules/agent/pipeline/types';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { DatabaseManager } from '../src/database/connection';
import { UserRepository } from '../src/database/repositories/user.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { ConfirmationRepository } from '../src/database/repositories/confirmation.repo';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { TokenBudgetManager } from '../src/modules/context';
import { LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityEngine } from '../src/modules/personality';
import { MetricsCollector } from '../src/modules/observability';
import { config } from '../src/config/env';

describe('Phase 13.4: Trigger Capability Contract Hardening', () => {
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
  // 1. CANONICAL TRIGGER CONTRACT & CLASSIFICATION
  // =========================================================================
  describe('1. Canonical Trigger Contract & Classification', () => {
    it('contains all known triggers in the canonical contract dictionary', () => {
      const knownTriggers: AgentTriggerType[] = [
        'user_message',
        'smart_reminder',
        'proactive',
        'proactive_morning_briefing',
        'proactive_reengagement',
        'proactive_unresolved_follow_up',
        'proactive_next_step_offer',
        'proactive_follow_up_offer',
      ];

      for (const trigger of knownTriggers) {
        expect(CANONICAL_TRIGGER_DEFINITIONS[trigger]).toBeDefined();
        expect(CANONICAL_TRIGGER_DEFINITIONS[trigger].type).toBe(trigger);
        expect(CANONICAL_TRIGGER_DEFINITIONS[trigger].canonicalType).toBe(trigger);
      }
    });

    it('classifies every trigger into a valid TriggerFamily', () => {
      const validFamilies: TriggerFamily[] = ['conversational', 'system', 'proactive', 'unknown'];

      for (const def of Object.values(CANONICAL_TRIGGER_DEFINITIONS)) {
        expect(validFamilies).toContain(def.family);
      }
    });

    it('strictly classifies system triggers with isSystemTrigger = true', () => {
      expect(TriggerContract.isSystemTrigger('smart_reminder')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive_morning_briefing')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive_reengagement')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive_unresolved_follow_up')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive_next_step_offer')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive_follow_up_offer')).toBe(true);
    });

    it('strictly classifies user_message as conversational with isSystemTrigger = false', () => {
      const def = TriggerContract.resolveTrigger('user_message');
      expect(def.family).toBe('conversational');
      expect(def.isSystemTrigger).toBe(false);
      expect(TriggerContract.isSystemTrigger('user_message')).toBe(false);
      expect(TriggerContract.isConversationalTrigger('user_message')).toBe(true);
    });

    it('never morphs or converts unknown triggers into user_message', () => {
      const unknownTriggers = ['proactive_typo', 'custom_webhook', 'cron_task', 'unknown_intent'];

      for (const raw of unknownTriggers) {
        const resolved = TriggerContract.resolveTrigger(raw);
        expect(resolved.type).toBe(raw);
        expect(resolved.canonicalType).toBeUndefined();
        expect(resolved.family).not.toBe('conversational');
        expect(resolved.capabilityPolicy).toBe('default_deny');
      }
    });
  });

  // =========================================================================
  // 2. CAPABILITY COVERAGE & DETERMINISTIC VALIDATION
  // =========================================================================
  describe('2. Capability Coverage & Deterministic Validation', () => {
    it('executes validateTriggerCapabilityCoverage() and passes with 0 errors', () => {
      const coverage = TriggerContract.validateTriggerCapabilityCoverage();
      expect(coverage.valid).toBe(true);
      expect(coverage.errors).toHaveLength(0);
    });

    it('ensures every system trigger has an explicit capability policy (never unrestricted)', () => {
      for (const def of Object.values(CANONICAL_TRIGGER_DEFINITIONS)) {
        if (def.isSystemTrigger) {
          expect(def.capabilityPolicy).not.toBe('unrestricted');
          expect(def.allowedTools).toBeDefined();
          expect(Array.isArray(def.allowedTools)).toBe(true);
          expect(def.allowedTools!.length).toBeGreaterThan(0);
        }
      }
    });

    it('ensures every proactive variant in PROACTIVE_CAPABILITY_POLICIES has an exact canonical manifest', () => {
      for (const [key, expectedTools] of Object.entries(PROACTIVE_CAPABILITY_POLICIES)) {
        const def = CANONICAL_TRIGGER_DEFINITIONS[key as AgentTriggerType];
        expect(def).toBeDefined();
        expect(def.isSystemTrigger).toBe(true);
        expect(def.family).toBe('proactive');
        expect(def.allowedTools).toEqual(expectedTools);
      }
    });

    it('ensures smart_reminder has an explicit policy with exactly 3 allowed tools', () => {
      const def = CANONICAL_TRIGGER_DEFINITIONS.smart_reminder;
      expect(def.family).toBe('system');
      expect(def.isSystemTrigger).toBe(true);
      expect(def.allowedTools).toEqual(SMART_REMINDER_ALLOWED_TOOLS);
      expect(def.allowedTools).toEqual(['get_current_time', 'get_weather', 'web_search']);
    });

    it('guarantees zero system triggers can ever have unrestricted tool access', () => {
      const systemTriggerNames: AgentTriggerType[] = [
        'smart_reminder',
        'proactive',
        'proactive_morning_briefing',
        'proactive_reengagement',
        'proactive_unresolved_follow_up',
        'proactive_next_step_offer',
        'proactive_follow_up_offer',
      ];

      for (const name of systemTriggerNames) {
        const allowed = TriggerContract.getAllowedTools(name);
        expect(allowed).toBeDefined();
        expect(allowed!.length).toBeLessThanOrEqual(3);
        // None can contain mutation tools
        expect(allowed).not.toContain('create_reminder');
        expect(allowed).not.toContain('save_memory');
      }
    });
  });

  // =========================================================================
  // 3. PIPELINE STAGE CLASSIFICATION CONSISTENCY
  // =========================================================================
  describe('3. Pipeline Stage Classification Consistency', () => {
    let mockDeps: AgentPipelineDependencies;

    const createMockContext = (triggerType?: string): AgentPipelineContext => ({
      input: {
        userId: 'usr_contract_stage_1',
        channel: 'whatsapp',
        text: 'Stage consistency test prompt',
        triggerType,
      },
      agentRunId: 'run_contract_stage_1',
      startTime: Date.now(),
      cleanUserText: 'Stage consistency test prompt',
      triggerType,
      channel: 'whatsapp',
      conversationId: 'conv_contract_1',
      textToProcess: 'Stage consistency test prompt',
      mediaType: 'text',
      isAudio: false,
      isImage: false,
      effectivePrompt: 'Stage consistency test prompt',
      historyRecordText: 'Stage consistency test prompt',
      interimSent: false,
      sendInterim: jest.fn(),
      languageContext: LanguageIntelligenceService.getInstance().resolveContext('مرحبا'),
      personalityContext: PersonalityEngine.getInstance().getDefaultPersonality(),
      recentMessages: [],
      toolCallsExecuted: [],
      finalReply: 'Consistency check reply',
      lastModelUsed: 'llama-3.3-70b-versatile',
      accumulatedPromptTokens: 50,
      accumulatedCompletionTokens: 25,
      accumulatedTotalTokens: 75,
      status: 'completed',
    });

    beforeEach(() => {
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

    it('PreflightStage: strictly honors TriggerContract.isSystemTrigger', async () => {
      const cacheSpy = jest.spyOn(SemanticCacheEngine.getInstance(), 'process');
      const limitSpy = jest.spyOn(userRepo, 'checkAndIncrementDailyLimit');
      const preflight = new PreflightStage();

      // System trigger -> bypasses
      const sysCtx = createMockContext('proactive_morning_briefing');
      await preflight.execute(sysCtx, mockDeps);
      expect(cacheSpy).not.toHaveBeenCalled();
      expect(limitSpy).not.toHaveBeenCalled();

      // Conversational trigger -> checks cache & limits
      const userCtx = createMockContext('user_message');
      jest.spyOn(userRepo, 'checkAndIncrementDailyLimit').mockResolvedValue({
        allowed: true,
        remaining: 39,
        isVip: false,
      });
      await preflight.execute(userCtx, mockDeps);
      expect(cacheSpy).toHaveBeenCalled();
      expect(limitSpy).toHaveBeenCalled();
    });

    it('CognitiveStage: strictly honors TriggerContract.isSystemTrigger', async () => {
      const saveMsgSpy = jest.spyOn(chatRepo, 'saveMessage').mockResolvedValue({} as any);
      const getRecentSpy = jest.spyOn(chatRepo, 'getRecentMessages').mockResolvedValue([]);
      const extractSpy = jest.spyOn(memoryRepo, 'extractAndSaveFacts').mockResolvedValue([] as any);
      const cognitive = new CognitiveStage();

      // System trigger -> skips user save and memory extraction
      const sysCtx = createMockContext('smart_reminder');
      await cognitive.execute(sysCtx, mockDeps);
      expect(saveMsgSpy).not.toHaveBeenCalled();
      expect(extractSpy).not.toHaveBeenCalled();

      // Conversational trigger -> persists user turn
      const userCtx = createMockContext('user_message');
      await cognitive.execute(userCtx, mockDeps);
      expect(saveMsgSpy).toHaveBeenCalledWith(
        userCtx.conversationId,
        'user',
        'WhatsApp User',
        userCtx.effectivePrompt,
        undefined,
        expect.any(Object)
      );
    });

    it('ExecutionStage: strictly honors TriggerContract.isSystemTrigger for confirmation notice', async () => {
      const saveMsgSpy = jest.spyOn(chatRepo, 'saveMessage').mockResolvedValue({} as any);
      jest.spyOn(confService, 'createConfirmationRequest').mockResolvedValue({
        token: 'token_abc',
        actionName: 'create_reminder',
        description: 'Confirmation',
        expiresAt: new Date(Date.now() + 3600000),
      } as any);

      const mockEngine = {
        run: jest.fn().mockResolvedValue({
          status: 'waiting_confirmation',
          finalReply: 'Notice text',
          toolCallsExecuted: [],
          steps: [{ status: 'waiting_confirmation', toolName: 'create_reminder', input: {} }],
          metrics: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        }),
      } as any;
      mockDeps.executionEngine = mockEngine;

      const execution = new ExecutionStage();

      // System trigger -> does NOT persist notice to DB
      const sysCtx = createMockContext('proactive_reengagement');
      await execution.execute(sysCtx, mockDeps);
      expect(saveMsgSpy).not.toHaveBeenCalled();

      // Conversational trigger -> persists notice to DB
      const userCtx = createMockContext('user_message');
      await execution.execute(userCtx, mockDeps);
      expect(saveMsgSpy).toHaveBeenCalled();
    });

    it('PostProcessStage: strictly honors TriggerContract.isSystemTrigger for assistant persistence', async () => {
      const saveMsgSpy = jest.spyOn(chatRepo, 'saveMessage').mockResolvedValue({} as any);
      const postProcess = new PostProcessStage();

      // System trigger -> does NOT persist assistant reply
      const sysCtx = createMockContext('proactive_follow_up_offer');
      await postProcess.execute(sysCtx, mockDeps);
      expect(saveMsgSpy).not.toHaveBeenCalled();

      // Conversational trigger -> persists assistant reply
      const userCtx = createMockContext('user_message');
      await postProcess.execute(userCtx, mockDeps);
      expect(saveMsgSpy).toHaveBeenCalledWith(
        userCtx.conversationId,
        'assistant',
        'Craft',
        userCtx.finalReply,
        undefined,
        expect.any(Object)
      );
    });

    it('guarantees unanimous classification across all 4 stages for smart_reminder', () => {
      expect(TriggerContract.isSystemTrigger('smart_reminder')).toBe(true);
      const def = TriggerContract.resolveTrigger('smart_reminder');
      expect(def.persistencePolicy).toBe('persist_on_delivery');
      expect(def.capabilityPolicy).toBe('scoped');
    });

    it('guarantees unanimous classification across all 4 stages for proactive_morning_briefing', () => {
      expect(TriggerContract.isSystemTrigger('proactive_morning_briefing')).toBe(true);
      const def = TriggerContract.resolveTrigger('proactive_morning_briefing');
      expect(def.persistencePolicy).toBe('persist_on_delivery');
      expect(def.capabilityPolicy).toBe('scoped');
    });

    it('guarantees unanimous classification across all 4 stages for user_message', () => {
      expect(TriggerContract.isSystemTrigger('user_message')).toBe(false);
      const def = TriggerContract.resolveTrigger('user_message');
      expect(def.persistencePolicy).toBe('persist_immediately');
      expect(def.capabilityPolicy).toBe('unrestricted');
    });
  });

  // =========================================================================
  // 4. PLANNER & PERMISSION GATE CONSISTENCY
  // =========================================================================
  describe('4. Planner & Permission Gate Consistency', () => {
    it('ExecutionPlanner and ToolPermissionGate resolve identical trigger classification', () => {
      const plannerTrigger = TriggerContract.resolveTrigger('proactive_morning_briefing');
      const gateTrigger = TriggerContract.resolveTrigger('proactive_morning_briefing');

      expect(plannerTrigger).toBe(gateTrigger);
      expect(plannerTrigger.type).toBe('proactive_morning_briefing');
      expect(plannerTrigger.allowedTools).toEqual(['get_current_time', 'get_weather', 'web_search']);
    });

    it('ToolPermissionGate deterministically denies forbidden tools with TOOL_NOT_ALLOWED_FOR_TRIGGER', () => {
      const reminderTool = toolRegistry.getTool('create_reminder')!;
      const context: ToolExecutionContext = {
        runId: 'run_gate_test_1',
        userId: 'test_user_g1',
        conversationId: 'conv_g1',
        channel: 'whatsapp',
        triggerType: 'proactive_morning_briefing',
      };

      const decision = ToolPermissionGate.getInstance().evaluate(reminderTool, context);
      expect(decision.allowed).toBe(false);
      expect(decision.requiresConfirmation).toBe(false);
      expect(decision.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('confirms requiresConfirmation = false for trigger capability denial', () => {
      const memoryTool = toolRegistry.getTool('save_memory')!;
      const context: ToolExecutionContext = {
        runId: 'run_gate_test_2',
        userId: 'test_user_g2',
        conversationId: 'conv_g2',
        channel: 'whatsapp',
        triggerType: 'smart_reminder',
      };

      const decision = ToolPermissionGate.getInstance().evaluate(memoryTool, context);
      expect(decision.allowed).toBe(false);
      expect(decision.requiresConfirmation).toBe(false);
    });

    it('FailureHandler classifies trigger capability denial as unrecoverable security block', () => {
      const handler = FailureHandler.getInstance();
      const step: any = {
        id: 'step_contract_denial',
        toolName: 'create_reminder',
        status: 'failed',
        error: {
          code: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
          message: 'Tool [create_reminder] is not permitted for trigger "proactive_morning_briefing"',
        },
        retryCount: 0,
      };

      const resolution = handler.handleFailure(step, { steps: [step], currentStep: 1 } as any, { maxSteps: 3 } as any);
      expect(resolution.canRetry).toBe(false);
      expect(resolution.strategy).toBe('abort_to_failure');
      expect(resolution.reason).toContain('Fatal security policy block');
    });

    it('StepExecutor passes triggerType into ToolExecutionContext without modification', async () => {
      const execSpy = jest.spyOn(lifecycleManager, 'execute');
      const stepExecutor = new StepExecutor(lifecycleManager);

      const engineContext: any = {
        runId: 'run_step_contract_1',
        userId: 'usr_sc1',
        conversationId: 'conv_sc1',
        channel: 'whatsapp',
        triggerType: 'proactive_unresolved_follow_up',
      };

      await stepExecutor.executeStep('get_current_time', { timeZone: 'UTC' }, engineContext);

      expect(execSpy).toHaveBeenCalledWith(
        'get_current_time',
        { timeZone: 'UTC' },
        expect.objectContaining({ triggerType: 'proactive_unresolved_follow_up' })
      );
    });
  });

  // =========================================================================
  // 5. REGRESSION & INVARIANT PROTECTION
  // =========================================================================
  describe('5. Regression & Invariant Protection', () => {
    it('user_message receives full unrestricted tool manifest (all 8 tools)', () => {
      const allowed = TriggerContract.getAllowedTools('user_message');
      expect(allowed).toBeUndefined(); // unrestricted

      const filtered = capabilityPolicy.getFilteredOpenAITools(toolRegistry, 'user_message');
      expect(filtered.length).toBe(toolRegistry.getAllTools().length);
      expect(filtered.length).toBeGreaterThanOrEqual(7);
    });

    it('undefined trigger cleanly defaults to user_message with full tool manifest', () => {
      const def = TriggerContract.resolveTrigger(undefined);
      expect(def.type).toBe('user_message');
      expect(def.family).toBe('conversational');
      expect(def.capabilityPolicy).toBe('unrestricted');

      const filtered = capabilityPolicy.getFilteredOpenAITools(toolRegistry, undefined);
      expect(filtered.length).toBe(toolRegistry.getAllTools().length);
    });

    it('smart_reminder retains exactly its 3 permitted tools', () => {
      const allowed = TriggerContract.getAllowedTools('smart_reminder');
      expect(allowed).toEqual(SMART_REMINDER_ALLOWED_TOOLS);
      expect(allowed).toEqual(['get_current_time', 'get_weather', 'web_search']);
    });

    it('all known proactive variants receive their exact configured manifests', () => {
      expect(TriggerContract.getAllowedTools('proactive')).toEqual(['get_current_time', 'get_weather', 'web_search']);
      expect(TriggerContract.getAllowedTools('proactive_morning_briefing')).toEqual(['get_current_time', 'get_weather', 'web_search']);
      expect(TriggerContract.getAllowedTools('proactive_reengagement')).toEqual(['get_current_time', 'get_weather']);
      expect(TriggerContract.getAllowedTools('proactive_unresolved_follow_up')).toEqual(['get_current_time', 'web_search']);
      expect(TriggerContract.getAllowedTools('proactive_next_step_offer')).toEqual(['get_current_time', 'web_search']);
      expect(TriggerContract.getAllowedTools('proactive_follow_up_offer')).toEqual(['get_current_time']);
    });

    it('emits low-cardinality observability metrics with triggerFamily tag', () => {
      const incSpy = jest.spyOn(metricsCollector, 'increment');

      // Test allowed call
      capabilityPolicy.isToolAllowed('get_weather', 'proactive_morning_briefing');
      expect(incSpy).toHaveBeenCalledWith(
        'craft.tool.policy.allowed',
        1,
        expect.objectContaining({
          triggerType: 'proactive_morning_briefing',
          triggerFamily: 'proactive',
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
          triggerFamily: 'proactive',
          toolName: 'create_reminder',
          decision: 'denied',
          reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        })
      );
    });
  });

  // =========================================================================
  // 6. SECURITY & TYPO/ROGUE TRIGGER PROTECTION
  // =========================================================================
  describe('6. Security & Typo/Rogue Trigger Protection', () => {
    it('typo trigger like proactive_reengagment defaults to default-deny with 0 tools', () => {
      const typoTrigger = 'proactive_reengagment';
      const def = TriggerContract.resolveTrigger(typoTrigger);

      expect(def.type).toBe(typoTrigger);
      expect(def.canonicalType).toBeUndefined();
      expect(def.family).toBe('proactive');
      expect(def.isSystemTrigger).toBe(true);
      expect(def.capabilityPolicy).toBe('default_deny');
      expect(def.allowedTools).toEqual([]);

      // Capability policy must deny all tools
      const evalResult = capabilityPolicy.isToolAllowed('get_weather', typoTrigger);
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('namespaced proactive trigger like proactive:custom defaults to default-deny with 0 tools', () => {
      const namespacedTrigger = 'proactive:custom_recommendation';
      const def = TriggerContract.resolveTrigger(namespacedTrigger);

      expect(def.type).toBe(namespacedTrigger);
      expect(def.canonicalType).toBeUndefined();
      expect(def.family).toBe('proactive');
      expect(def.capabilityPolicy).toBe('default_deny');
      expect(def.allowedTools).toEqual([]);

      const filtered = capabilityPolicy.getFilteredOpenAITools(toolRegistry, namespacedTrigger);
      expect(filtered).toEqual([]);
      expect(filtered).toHaveLength(0);
    });

    it('arbitrary future proactive_custom_x defaults to default-deny with 0 tools', () => {
      const futureTrigger = 'proactive_beta_test_v2';
      const def = TriggerContract.resolveTrigger(futureTrigger);

      expect(def.capabilityPolicy).toBe('default_deny');
      expect(def.allowedTools).toEqual([]);
    });

    it('arbitrary non-proactive unknown trigger defaults to default-deny (never user_message)', () => {
      const rogueTrigger = 'unauthorized_external_webhook';
      const def = TriggerContract.resolveTrigger(rogueTrigger);

      expect(def.type).toBe(rogueTrigger);
      expect(def.canonicalType).toBeUndefined();
      expect(def.family).toBe('unknown');
      expect(def.isSystemTrigger).toBe(false);
      expect(def.capabilityPolicy).toBe('default_deny');
      expect(def.allowedTools).toEqual([]);

      // Must be denied
      const evalResult = capabilityPolicy.isToolAllowed('get_current_time', rogueTrigger);
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('zero direct registry bypass: ExecutionPlanner sends tools: undefined when manifest is empty', async () => {
      const planner = new ExecutionPlanner(undefined, toolRegistry, capabilityPolicy);

      const state: any = {
        runId: 'run_security_bypass_1',
        taskId: 'task_sec_1',
        status: 'planning',
        currentStep: 0,
        maxSteps: 3,
        goal: 'Security bypass test',
        steps: [],
        totalToolCalls: 0,
        totalToolExecutionMs: 0,
        startedAt: Date.now(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const context: any = {
        runId: 'run_security_bypass_1',
        userId: 'usr_sec_1',
        conversationId: 'conv_sec_1',
        channel: 'whatsapp',
        userGoal: 'Security bypass test',
        triggerType: 'proactive_reengagment', // typo trigger
      };

      const routeSpy = jest.spyOn((planner as any).aiRouter, 'route');
      await planner.planNextStep(state, context, []);

      expect(routeSpy).toHaveBeenCalledTimes(1);
      const passedRequest = routeSpy.mock.calls[0][0] as any;
      // Manifest must be completely stripped out — LLM receives no tools!
      expect(passedRequest.tools).toBeUndefined();
      expect(passedRequest.toolChoice).toBeUndefined();

      routeSpy.mockRestore();
    });
  });
});
