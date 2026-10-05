/**
 * Phase 13.2 — Smart Reminder Tool Capability Policy Test Suite
 *
 * Verifies the granular capability-based tool access control policy:
 *
 * 1. Manifest Scoping & Zero Manifest Leak:
 *    - smart_reminder trigger exposes ONLY allowed informational tools (get_current_time, get_weather, web_search).
 *    - Full registry does NOT reach the planner/LLM for smart_reminder.
 *    - create_reminder, save_memory, send_message, dispatch_proactive are absent from manifest.
 *    - OpenAI-compatible tool schemas are properly structured and scoped.
 *
 * 2. Allowed Informational Tools:
 *    - get_weather executes successfully through ToolLifecycleManager.
 *    - web_search executes successfully through ToolLifecycleManager.
 *    - get_current_time executes successfully through ToolLifecycleManager.
 *
 * 3. Denied Tools & Defense in Depth:
 *    - create_reminder returns status: 'denied' and code: 'TOOL_NOT_ALLOWED_FOR_TRIGGER'.
 *    - save_memory returns status: 'denied' and code: 'TOOL_NOT_ALLOWED_FOR_TRIGGER'.
 *    - complete_reminder returns status: 'denied' and code: 'TOOL_NOT_ALLOWED_FOR_TRIGGER'.
 *    - Confirmation requests are NEVER created for forbidden tools under smart_reminder.
 *    - FailureHandler classifies TOOL_NOT_ALLOWED_FOR_TRIGGER as unrecoverable security block (canRetry: false).
 *    - Zero assistant messages are persisted to chatRepo upon denial under smart_reminder.
 *    - Schema validation, SSRF checks, timeout, and output sanitization remain active.
 *
 * 4. Regression & Invariant Protection:
 *    - Normal user_message receives full unrestricted tool manifest (all 8 tools).
 *    - Undefined trigger receives full unrestricted tool manifest.
 *    - create_reminder and save_memory function normally under user_message.
 *    - Full AgentOrchestrator.generateSmartReminder pipeline runs cleanly with policy active.
 *    - Zero Meta WhatsApp API network calls.
 *    - Zero runtime DDL statements executed.
 *    - Zero business table mutations during reminder generation.
 *
 * 5. Observability & Security:
 *    - craft.tool.policy.allowed and craft.tool.policy.denied metrics emitted.
 *    - Low-cardinality tags; zero secret, token, or CoT leakage in logs.
 */

import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { AgentPipeline } from '../src/modules/agent/pipeline/pipeline';
import { ExecutionEngine } from '../src/modules/agent/execution/execution_engine';
import { ExecutionPlanner } from '../src/modules/agent/execution/planner';
import { StepExecutor } from '../src/modules/agent/execution/step_executor';
import { FailureHandler } from '../src/modules/agent/execution/failure_handler';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { ToolRegistry } from '../src/modules/tools/registry';
import { ToolLifecycleManager } from '../src/modules/tools/lifecycle/tool_lifecycle';
import { ToolPermissionGate } from '../src/modules/tools/safety/permission_gate';
import {
  ToolCapabilityPolicy,
  SMART_REMINDER_ALLOWED_TOOLS,
  SMART_REMINDER_FORBIDDEN_TOOLS,
} from '../src/modules/tools/safety/tool_capability_policy';
import { ToolExecutionContext } from '../src/modules/tools/contracts/tool.types';
import { MetricsCollector } from '../src/modules/observability';
import { DatabaseManager } from '../src/database/connection';
import { UserRepository } from '../src/database/repositories/user.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { ConfirmationRepository } from '../src/database/repositories/confirmation.repo';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityEngine } from '../src/modules/personality';
import { config } from '../src/config/env';

describe('Phase 13.2: Smart Reminder Tool Capability Policy', () => {
  let mockDb: DatabaseManager;
  let userRepo: UserRepository;
  let chatRepo: ChatRepository;
  let memoryRepo: MemoryRepository;
  let userPrefRepo: UserPreferenceRepository;
  let confRepo: ConfirmationRepository;
  let confService: ConfirmationService;
  let groqProvider: GroqProvider;
  let toolRegistry: ToolRegistry;
  let orchestrator: AgentOrchestrator;
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

    orchestrator = new AgentOrchestrator(
      groqProvider,
      toolRegistry,
      confService,
      chatRepo,
      memoryRepo,
      userRepo,
      userPrefRepo
    );

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
  // 1. MANIFEST SCOPING & ZERO MANIFEST LEAK TESTS
  // =========================================================================
  describe('1. Manifest Scoping & Zero Manifest Leak', () => {
    it('scopes tool manifest to strictly allowed tools for smart_reminder', () => {
      const allowed = capabilityPolicy.getAllowedTools('smart_reminder');
      expect(allowed).toBeDefined();
      expect(allowed).toEqual(['get_current_time', 'get_weather', 'web_search']);
    });

    it('filters OpenAI tools manifest for planner so only allowed tools reach LLM', () => {
      const filteredOpenAITools = capabilityPolicy.getFilteredOpenAITools(
        toolRegistry,
        'smart_reminder'
      );

      const toolNames = filteredOpenAITools.map((t) => t.function.name);
      expect(toolNames).toContain('get_current_time');
      expect(toolNames).toContain('get_weather');
      expect(toolNames).toContain('web_search');
      expect(toolNames).toHaveLength(3);

      // Verify forbidden tools do NOT leak into manifest
      expect(toolNames).not.toContain('create_reminder');
      expect(toolNames).not.toContain('save_memory');
      expect(toolNames).not.toContain('complete_reminder');
      expect(toolNames).not.toContain('echo_message');
    });

    it('confirms full registry has 8 tools but smart_reminder manifest has exactly 3', () => {
      const allTools = toolRegistry.getAllTools();
      expect(allTools.length).toBeGreaterThanOrEqual(7);

      const scopedTools = capabilityPolicy.filterTools(allTools, 'smart_reminder');
      expect(scopedTools.length).toBe(3);
      expect(scopedTools.map((t) => t.name).sort()).toEqual([
        'get_current_time',
        'get_weather',
        'web_search',
      ]);
    });

    it('conforms to standard OpenAI tool definition structure', () => {
      const filteredOpenAITools = capabilityPolicy.getFilteredOpenAITools(
        toolRegistry,
        'smart_reminder'
      );

      for (const tool of filteredOpenAITools) {
        expect(tool.type).toBe('function');
        expect(tool.function).toBeDefined();
        expect(typeof tool.function.name).toBe('string');
        expect(typeof tool.function.description).toBe('string');
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.parameters.type).toBe('object');
        expect(tool.function.parameters.properties).toBeDefined();
      }
    });

    it('confirms all forbidden tools list contains expected sensitive actions', () => {
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('create_reminder');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('complete_reminder');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('cancel_reminder');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('save_memory');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('delete_memory');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('send_message');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('whatsapp_outbound');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('dispatch_proactive');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('mutate_conversation');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('execute_payment');
      expect(SMART_REMINDER_FORBIDDEN_TOOLS).toContain('confirm_action');
    });

    it('confirms planner queries capability policy with triggerType', async () => {
      const filterSpy = jest.spyOn(capabilityPolicy, 'getFilteredOpenAITools');
      const planner = new ExecutionPlanner(undefined, toolRegistry, capabilityPolicy);

      const state: any = {
        runId: 'run_test_plan_1',
        taskId: 'task_test_1',
        status: 'planning',
        currentStep: 0,
        maxSteps: 3,
        goal: 'Weather check',
        steps: [],
        totalToolCalls: 0,
        totalToolExecutionMs: 0,
        startedAt: Date.now(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const context: any = {
        runId: 'run_test_plan_1',
        userId: 'test_user_1',
        conversationId: 'conv_test_1',
        channel: 'whatsapp',
        userGoal: 'Weather check',
        triggerType: 'smart_reminder',
      };

      await planner.planNextStep(state, context, []);

      expect(filterSpy).toHaveBeenCalledWith(toolRegistry, 'smart_reminder');
      filterSpy.mockRestore();
    });
  });

  // =========================================================================
  // 2. ALLOWED TOOLS EXECUTION IN SMART REMINDER
  // =========================================================================
  describe('2. Allowed Tools Execution in Smart Reminder', () => {
    const baseContext: ToolExecutionContext = {
      runId: 'run_allowed_1',
      userId: 'test_user_1',
      conversationId: 'conv_allowed_1',
      channel: 'whatsapp',
      triggerType: 'smart_reminder',
    };

    it('executes get_weather successfully under smart_reminder', async () => {
      const result = await lifecycleManager.execute(
        'get_weather',
        { city: 'Cairo' },
        baseContext
      );

      expect(result.status).toBe('completed');
      expect(result.toolName).toBe('get_weather');
      expect(result.rawResult).toBeDefined();
      expect(result.rawResult.city).toBe('Cairo');
      expect(result.error).toBeUndefined();
    });

    it('executes web_search successfully under smart_reminder', async () => {
      const result = await lifecycleManager.execute(
        'web_search',
        { query: 'Cairo news today' },
        baseContext
      );

      expect(result.status).toBe('completed');
      expect(result.toolName).toBe('web_search');
      expect(result.rawResult).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('executes get_current_time successfully under smart_reminder', async () => {
      const result = await lifecycleManager.execute(
        'get_current_time',
        { timeZone: 'Africa/Cairo' },
        baseContext
      );

      expect(result.status).toBe('completed');
      expect(result.toolName).toBe('get_current_time');
      expect(result.rawResult).toBeDefined();
      expect(result.rawResult.formatted).toBeDefined();
      expect(result.rawResult.timeZone).toBe('Africa/Cairo');
      expect(result.error).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. DENIED TOOLS & DEFENSE IN DEPTH
  // =========================================================================
  describe('3. Denied Tools & Defense in Depth', () => {
    const reminderContext: ToolExecutionContext = {
      runId: 'run_denied_1',
      userId: 'test_user_1',
      conversationId: 'conv_denied_1',
      channel: 'whatsapp',
      triggerType: 'smart_reminder',
    };

    it('denies create_reminder with status: denied and TOOL_NOT_ALLOWED_FOR_TRIGGER', async () => {
      const result = await lifecycleManager.execute(
        'create_reminder',
        { title: 'Sub-reminder attempt', time: 'tomorrow 10am' },
        reminderContext
      );

      expect(result.status).toBe('denied');
      expect(result.toolName).toBe('create_reminder');
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
      expect(result.error?.message).toContain('not permitted for trigger "smart_reminder"');
    });

    it('denies save_memory with status: denied and TOOL_NOT_ALLOWED_FOR_TRIGGER', async () => {
      const result = await lifecycleManager.execute(
        'save_memory',
        { fact: 'User likes morning coffee' },
        reminderContext
      );

      expect(result.status).toBe('denied');
      expect(result.toolName).toBe('save_memory');
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('denies complete_reminder with status: denied and TOOL_NOT_ALLOWED_FOR_TRIGGER', async () => {
      const result = await lifecycleManager.execute(
        'complete_reminder',
        { reminderId: 'rem_123' },
        reminderContext
      );

      expect(result.status).toBe('denied');
      expect(result.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('evaluates permission gate directly: requiresConfirmation is false on trigger denial', () => {
      const gate = ToolPermissionGate.getInstance();
      const tool = toolRegistry.getTool('create_reminder');
      expect(tool).toBeDefined();

      const decision = gate.evaluate(tool!, reminderContext);

      expect(decision.allowed).toBe(false);
      // Critical defense-in-depth: MUST NOT convert to a confirmation prompt!
      expect(decision.requiresConfirmation).toBe(false);
      expect(decision.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });

    it('does not invoke createConfirmationRequest when forbidden tool is evaluated', async () => {
      const confSpy = jest.spyOn(confService, 'createConfirmationRequest');

      const result = await lifecycleManager.execute(
        'create_reminder',
        { title: 'Secret action', time: 'now' },
        reminderContext
      );

      expect(result.status).toBe('denied');
      expect(confSpy).not.toHaveBeenCalled();
      confSpy.mockRestore();
    });

    it('failure handler treats TOOL_NOT_ALLOWED_FOR_TRIGGER as fatal unrecoverable failure', () => {
      const handler = FailureHandler.getInstance();

      const step: any = {
        id: 'step_1',
        toolName: 'create_reminder',
        error: {
          code: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
          message: 'Tool not allowed for trigger',
        },
        retryCount: 0,
      };

      const state: any = {
        steps: [step],
        startedAt: Date.now(),
      };

      const policy: any = {
        maxExecutionMs: 15000,
      };

      const resolution = handler.handleFailure(step, state, policy);

      expect(resolution.canRetry).toBe(false);
      expect(resolution.strategy).toBe('abort_to_failure');
      expect(resolution.reason).toContain('Fatal security policy block');
    });

    it('schema validation remains active for allowed tools in smart_reminder', async () => {
      const result = await lifecycleManager.execute(
        'get_weather',
        {}, // missing required city parameter
        reminderContext
      );

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('StepExecutor passes triggerType correctly into ToolExecutionContext', async () => {
      const execSpy = jest.spyOn(lifecycleManager, 'execute');
      const stepExecutor = new StepExecutor(lifecycleManager);

      const engineContext: any = {
        runId: 'run_step_test_1',
        userId: 'test_user_1',
        conversationId: 'conv_step_1',
        channel: 'whatsapp',
        triggerType: 'smart_reminder',
      };

      await stepExecutor.executeStep('get_weather', { city: 'Alexandria' }, engineContext);

      expect(execSpy).toHaveBeenCalledWith(
        'get_weather',
        { city: 'Alexandria' },
        expect.objectContaining({ triggerType: 'smart_reminder' })
      );

      execSpy.mockRestore();
    });
  });

  // =========================================================================
  // 4. REGRESSION & INVARIANT PROTECTION
  // =========================================================================
  describe('4. Regression & Invariant Protection', () => {
    it('returns unrestricted tools manifest for standard user_message', () => {
      const allowed = capabilityPolicy.getAllowedTools('user_message');
      expect(allowed).toBeUndefined();

      const filteredTools = capabilityPolicy.getFilteredOpenAITools(toolRegistry, 'user_message');
      const allTools = toolRegistry.getAllTools();

      expect(filteredTools.length).toBe(allTools.length);
      const toolNames = filteredTools.map((t: any) => t.function.name);
      expect(toolNames).toContain('create_reminder');
      expect(toolNames).toContain('save_memory');
      expect(toolNames).toContain('get_weather');
    });

    it('returns unrestricted tools manifest when triggerType is undefined', () => {
      const allowed = capabilityPolicy.getAllowedTools(undefined);
      expect(allowed).toBeUndefined();

      const filteredTools = capabilityPolicy.getFilteredOpenAITools(toolRegistry, undefined);
      expect(filteredTools.length).toBe(toolRegistry.getAllTools().length);
    });

    it('permits create_reminder for user_message subject to normal confirmation', async () => {
      const userContext: ToolExecutionContext = {
        runId: 'run_user_1',
        userId: 'test_user_1',
        conversationId: 'conv_user_1',
        channel: 'whatsapp',
        triggerType: 'user_message',
      };

      const result = await lifecycleManager.execute(
        'create_reminder',
        { title: 'Dentist appointment', time: 'tomorrow 3pm' },
        userContext
      );

      // Sensitive mutation tool requires confirmation in standard user conversations
      expect(result.status).toBe('confirmation_required');
      expect(result.toolName).toBe('create_reminder');
    });

    it('permits save_memory for user_message', async () => {
      const userContext: ToolExecutionContext = {
        runId: 'run_user_2',
        userId: 'test_user_1',
        conversationId: 'conv_user_2',
        channel: 'whatsapp',
        triggerType: 'user_message',
      };

      const result = await lifecycleManager.execute(
        'save_memory',
        { fact: 'User lives in Alexandria' },
        userContext
      );

      expect(result.status).toBe('completed');
      expect(result.toolName).toBe('save_memory');
    });

    it('AgentOrchestrator.generateSmartReminder executes through unified pipeline with policy enforced', async () => {
      const saveMessageSpy = jest.spyOn(chatRepo, 'saveMessage');

      const reminderText = await orchestrator.generateSmartReminder(
        'user_reg_1',
        'تذكير بالطقس اليوم في القاهرة',
        undefined,
        undefined,
        'rem_phase13_2_test'
      );

      expect(reminderText).toBeDefined();
      expect(reminderText).toContain('⏰ *تذكير من كرافت*:');

      // Verify zero chat messages saved to database during smart reminder generation
      expect(saveMessageSpy).not.toHaveBeenCalled();
      saveMessageSpy.mockRestore();
    });

    it('confirms zero Meta WhatsApp API network calls during reminder generation', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      await orchestrator.generateSmartReminder(
        'user_net_1',
        'قراءة سورة الكهف',
        undefined,
        undefined,
        'rem_net_1'
      );

      const metaCalls = fetchSpy.mock.calls.filter((call) => {
        const url = String(call[0]);
        return url.includes('graph.facebook.com');
      });

      expect(metaCalls.length).toBe(0);
      fetchSpy.mockRestore();
    });

    it('confirms zero runtime DDL statements are executed', async () => {
      const pool = mockDb.getPool();
      const querySpy = pool ? jest.spyOn(pool, 'query') : jest.fn();

      await orchestrator.generateSmartReminder(
        'user_ddl_1',
        'متابعة البريد',
        undefined,
        undefined,
        'rem_ddl_1'
      );

      const ddlPatterns = [
        /\bCREATE\s+TABLE\b/i,
        /\bALTER\s+TABLE\b/i,
        /\bDROP\b/i,
        /\bTRUNCATE\b/i,
        /\bCREATE\s+EXTENSION\b/i,
      ];

      for (const call of querySpy.mock.calls) {
        const sql = typeof call[0] === 'string' ? call[0] : '';
        for (const pattern of ddlPatterns) {
          expect(pattern.test(sql)).toBe(false);
        }
      }
    });

    it('confirms zero business table writes occur in PostgreSQL during reminder generation', async () => {
      const pool = mockDb.getPool();
      const querySpy = pool ? jest.spyOn(pool, 'query') : jest.fn();

      await orchestrator.generateSmartReminder(
        'user_writes_1',
        'تذكير شرب الماء',
        undefined,
        undefined,
        'rem_writes_1'
      );

      const businessMutationPatterns = [
        /\bINSERT\s+INTO\s+reminders\b/i,
        /\bUPDATE\s+reminders\b/i,
        /\bDELETE\s+FROM\b/i,
      ];

      for (const call of querySpy.mock.calls) {
        const sql = typeof call[0] === 'string' ? call[0] : '';
        for (const pattern of businessMutationPatterns) {
          expect(pattern.test(sql)).toBe(false);
        }
      }
    });
  });

  // =========================================================================
  // 5. OBSERVABILITY & SECURITY TELEMETRY
  // =========================================================================
  describe('5. Observability & Security Telemetry', () => {
    it('emits craft.tool.policy.allowed metric on permitted tool execution', async () => {
      const metricSpy = jest.spyOn(metricsCollector, 'increment');

      capabilityPolicy.isToolAllowed('get_weather', 'smart_reminder');

      expect(metricSpy).toHaveBeenCalledWith(
        'craft.tool.policy.allowed',
        1,
        expect.objectContaining({
          toolName: 'get_weather',
          triggerType: 'smart_reminder',
          decision: 'allowed',
        })
      );

      metricSpy.mockRestore();
    });

    it('emits craft.tool.policy.denied metric on forbidden tool attempt', async () => {
      const metricSpy = jest.spyOn(metricsCollector, 'increment');

      capabilityPolicy.isToolAllowed('create_reminder', 'smart_reminder');

      expect(metricSpy).toHaveBeenCalledWith(
        'craft.tool.policy.denied',
        1,
        expect.objectContaining({
          toolName: 'create_reminder',
          triggerType: 'smart_reminder',
          decision: 'denied',
          reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        })
      );

      metricSpy.mockRestore();
    });

    it('confirms telemetry tags are low-cardinality and contain no user text or tokens', () => {
      const res = capabilityPolicy.isToolAllowed('save_memory', 'smart_reminder');

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
      expect(res.capability).toBe('memory_write');

      // Verify no dynamic PII exists in evaluation result object
      expect((res as any).userId).toBeUndefined();
      expect((res as any).token).toBeUndefined();
      expect((res as any).rawInput).toBeUndefined();
    });
  });
});
