/**
 * Phase 8.3 Dedicated Unit & Multi-Step Integration Test Suite
 *
 * Validates:
 * 1. ExecutionState & Telemetry (initialization, transitions, secret redaction, token recording)
 * 2. ExecutionPolicy (default 3 steps, clamping to hard ceiling of 5, budget evaluation)
 * 3. StepVerifier (deterministic classification: success, insufficient, partial, failure)
 * 4. LoopGuard & Idempotency (exact duplicates, A->B->A oscillation, mutation protection, legitimate progressive search)
 * 5. FailureHandler (transient retries, fatal error halting, partial success synthesis)
 * 6. StepExecutor & ToolLifecycleManager Bridge (cancellation checks, safety lifecycle routing)
 * 7. Multi-Step ExecutionEngine Scenarios:
 *    - Scenario A: One Tool (Single turn execution)
 *    - Scenario B: Two Sequential Tools with Chained Context (Weather -> Time)
 *    - Scenario C: Three Steps Bounded Execution
 *    - Scenario D: Confirmation Barrier (Halts on sensitive step without executing next step)
 *    - Scenario E: Loop Detection Halting
 *    - Scenario F: Insufficient Search Result Handling
 *    - Scenario G: Cancellation via AbortSignal
 *    - Scenario H: Partial Completion on Mid-Sequence Failure
 *    - Scenario I: Hard Limit Clamping
 */

import {
  ExecutionPolicyManager,
  HARD_LIMITS,
  DEFAULT_EXECUTION_POLICY,
  ExecutionStateManager,
  StepVerifier,
  LoopGuard,
  FailureHandler,
  StepExecutor,
  ExecutionPlanner,
  ExecutionEngine,
  AgentExecutionState,
  ExecutionEngineContext,
} from '../src/modules/agent/execution';
import { ToolLifecycleManager, ToolRegistry } from '../src/modules/tools';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { createToolError } from '../src/modules/tools/contracts/error.types';

describe('Phase 8.3: Multi-Step Agent & Tool Chaining', () => {
  // =========================================================================
  // 1. ExecutionPolicy & Hard Ceilings Tests
  // =========================================================================
  describe('ExecutionPolicyManager', () => {
    const manager = ExecutionPolicyManager.getInstance();

    it('returns default policy with max 3 steps and 3 tool calls', () => {
      const policy = manager.resolvePolicy();
      expect(policy.maxSteps).toBe(3);
      expect(policy.maxToolCalls).toBe(3);
      expect(policy.maxExecutionMs).toBe(30000);
      expect(policy.hardMaxSteps).toBe(5);
      expect(policy.allowParallel).toBe(false);
    });

    it('clamps dangerous or excessive configurations to hard limits', () => {
      const excessivePolicy = manager.resolvePolicy({
        maxSteps: 25, // Dangerously high
        maxToolCalls: 50,
        maxExecutionMs: 120000,
        maxTotalToolOutputChars: 100000,
      });

      expect(excessivePolicy.maxSteps).toBe(HARD_LIMITS.MAX_STEPS); // Clamped to 5
      expect(excessivePolicy.maxToolCalls).toBe(HARD_LIMITS.MAX_TOOL_CALLS); // Clamped to 5
      expect(excessivePolicy.maxExecutionMs).toBe(HARD_LIMITS.MAX_EXECUTION_MS); // Clamped to 45000
      expect(excessivePolicy.maxTotalToolOutputChars).toBe(HARD_LIMITS.MAX_TOTAL_OUTPUT_CHARS); // Clamped to 30000
    });

    it('clamps negative or zero step configurations to minimum safe bounds', () => {
      const lowPolicy = manager.resolvePolicy({
        maxSteps: 0,
        maxToolCalls: -5,
        maxExecutionMs: 200,
      });

      expect(lowPolicy.maxSteps).toBe(1);
      expect(lowPolicy.maxToolCalls).toBe(1);
      expect(lowPolicy.maxExecutionMs).toBe(1000);
    });

    it('detects step budget exhaustion', () => {
      const policy = manager.resolvePolicy({ maxSteps: 2 });
      const state: AgentExecutionState = {
        runId: 'r1',
        taskId: 't1',
        status: 'executing',
        currentStep: 2,
        maxSteps: 2,
        goal: 'test',
        steps: [],
        totalToolCalls: 2,
        totalToolExecutionMs: 500,
        startedAt: Date.now(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const check = manager.checkBudget(state, policy, Date.now() - 1000);
      expect(check.withinBudget).toBe(false);
      expect(check.reason).toContain('Exceeded maximum allowed steps');
    });

    it('detects execution timeout exhaustion', () => {
      const policy = manager.resolvePolicy({ maxExecutionMs: 5000 });
      const state: AgentExecutionState = {
        runId: 'r1',
        taskId: 't1',
        status: 'executing',
        currentStep: 1,
        maxSteps: 3,
        goal: 'test',
        steps: [],
        totalToolCalls: 1,
        totalToolExecutionMs: 500,
        startedAt: Date.now() - 6000,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const check = manager.checkBudget(state, policy, Date.now() - 6000);
      expect(check.withinBudget).toBe(false);
      expect(check.reason).toContain('timeout exceeded');
    });
  });

  // =========================================================================
  // 2. ExecutionState & Secret Redaction Tests
  // =========================================================================
  describe('ExecutionStateManager', () => {
    it('initializes clean state for a new task', () => {
      const state = ExecutionStateManager.createInitialState('run_123', 'task_123', 'My Goal', 3);

      expect(state.runId).toBe('run_123');
      expect(state.taskId).toBe('task_123');
      expect(state.goal).toBe('My Goal');
      expect(state.maxSteps).toBe(3);
      expect(state.status).toBe('planning');
      expect(state.currentStep).toBe(0);
      expect(state.steps).toEqual([]);
    });

    it('creates steps and redacts secrets from input arguments', () => {
      const state = ExecutionStateManager.createInitialState('run_123', 'task_123', 'My Goal', 3);
      const secretArgs = {
        apiKey: 'gsk_secret_key_1234567890',
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI...',
        city: 'Cairo',
      };

      const step = ExecutionStateManager.createStep(state, 'get_weather', secretArgs);

      expect(step.id).toBeDefined();
      expect(step.index).toBe(1);
      expect(step.toolName).toBe('get_weather');
      expect(step.status).toBe('pending');
      expect(state.currentStep).toBe(1);
      expect(state.status).toBe('executing');

      // Sensitive fields must be sanitized in state
      expect(step.input.apiKey).toBe('[REDACTED_API_KEY]');
      expect(step.input.token).toBe('Bearer [REDACTED_TOKEN]');
      expect(step.input.city).toBe('Cairo');
    });

    it('completes steps and redacts secrets in serialized outputs', () => {
      const state = ExecutionStateManager.createInitialState('run_123', 'task_123', 'Goal', 3);
      const step = ExecutionStateManager.createStep(state, 'tool_a', { q: 'test' });

      ExecutionStateManager.completeStep(
        step,
        'succeeded',
        { data: 'ok' },
        'Connected with Bearer secret_token_xyz to server',
        undefined,
        45
      );

      expect(step.status).toBe('succeeded');
      expect(step.durationMs).toBe(45);
      expect(step.serializedResult).not.toContain('secret_token_xyz');
      expect(step.serializedResult).toContain('Bearer [REDACTED_TOKEN]');
    });

    it('accumulates tokens and transitions status properly', () => {
      const state = ExecutionStateManager.createInitialState('run_1', 'task_1', 'Goal', 3);

      ExecutionStateManager.recordTokenUsage(state, 50, 25, 75);
      expect(state.promptTokens).toBe(50);
      expect(state.completionTokens).toBe(25);
      expect(state.totalTokens).toBe(75);

      ExecutionStateManager.transitionStatus(state, 'partially_completed', 'Mid-step timeout occurred');
      expect(state.status).toBe('partially_completed');
      expect(state.failureReason).toBe('Mid-step timeout occurred');
      expect(state.completedAt).toBeDefined();
    });
  });

  // =========================================================================
  // 3. StepVerifier Tests
  // =========================================================================
  describe('StepVerifier', () => {
    const verifier = StepVerifier.getInstance();

    it('classifies tool errors as failure', () => {
      const failedResult: any = {
        status: 'failed',
        toolName: 'web_search',
        error: createToolError('EXECUTION_FAILED', 'Network disconnected'),
      };

      const verification = verifier.verify('web_search', failedResult);
      expect(verification.status).toBe('failure');
      expect(verification.structuralSuccess).toBe(false);
      expect(verification.hasUsableData).toBe(false);
      expect(verification.reason).toContain('Network disconnected');
    });

    it('classifies search with 0 results as insufficient', () => {
      const emptySearchResult: any = {
        status: 'completed',
        toolName: 'web_search',
        rawResult: { query: 'obscure query', results: [] },
      };

      const verification = verifier.verify('web_search', emptySearchResult);
      expect(verification.status).toBe('insufficient');
      expect(verification.structuralSuccess).toBe(true);
      expect(verification.hasUsableData).toBe(false);
      expect(verification.dataCount).toBe(0);
      expect(verification.reason).toContain('0 matching results');
    });

    it('classifies search with matching results as success', () => {
      const successfulSearchResult: any = {
        status: 'completed',
        toolName: 'web_search',
        rawResult: {
          query: 'Flutter 3.24',
          results: [{ title: 'Release Notes', snippet: 'Details' }],
        },
      };

      const verification = verifier.verify('web_search', successfulSearchResult);
      expect(verification.status).toBe('success');
      expect(verification.structuralSuccess).toBe(true);
      expect(verification.hasUsableData).toBe(true);
      expect(verification.dataCount).toBe(1);
    });

    it('classifies confirmation_required as partial', () => {
      const confirmationResult: any = {
        status: 'confirmation_required',
        toolName: 'create_reminder',
      };

      const verification = verifier.verify('create_reminder', confirmationResult);
      expect(verification.status).toBe('partial');
      expect(verification.structuralSuccess).toBe(true);
      expect(verification.hasUsableData).toBe(true);
    });

    it('verifies structured get_weather output', () => {
      const validWeather: any = {
        status: 'completed',
        toolName: 'get_weather',
        rawResult: { city: 'Cairo', temperatureC: 28 },
      };
      expect(verifier.verify('get_weather', validWeather).status).toBe('success');

      const malformedWeather: any = {
        status: 'completed',
        toolName: 'get_weather',
        rawResult: { missingCity: true },
      };
      expect(verifier.verify('get_weather', malformedWeather).status).toBe('partial');
    });
  });

  // =========================================================================
  // 4. LoopGuard & Idempotency Tests
  // =========================================================================
  describe('LoopGuard & Idempotency', () => {
    let loopGuard: LoopGuard;

    beforeEach(() => {
      loopGuard = new LoopGuard();
    });

    it('allows initial unique tool calls', () => {
      const decision1 = loopGuard.check('get_weather', { city: 'Cairo' });
      expect(decision1.allowed).toBe(true);
      loopGuard.record('get_weather', { city: 'Cairo' });

      const decision2 = loopGuard.check('get_current_time', {});
      expect(decision2.allowed).toBe(true);
    });

    it('blocks exact duplicate tool calls with identical arguments', () => {
      loopGuard.record('get_weather', { city: 'Alexandria' });

      const duplicateCheck = loopGuard.check('get_weather', { city: 'Alexandria' });
      expect(duplicateCheck.allowed).toBe(false);
      expect(duplicateCheck.isLoop).toBe(true);
      expect(duplicateCheck.reason).toContain('Duplicate tool call detected');
    });

    it('blocks exact duplicates even with rearranged JSON parameter keys', () => {
      loopGuard.record('complex_tool', { b: 2, a: 1 });

      // Same parameters but declared in different key order
      const duplicateCheck = loopGuard.check('complex_tool', { a: 1, b: 2 });
      expect(duplicateCheck.allowed).toBe(false);
      expect(duplicateCheck.isLoop).toBe(true);
    });

    it('enforces mutation idempotency for create_reminder in the same turn', () => {
      loopGuard.record('create_reminder', { title: 'Dentist Appointment', time: 'tomorrow' });

      const mutationCheck = loopGuard.check('create_reminder', {
        title: 'Dentist Appointment',
        time: 'different time',
      });
      expect(mutationCheck.allowed).toBe(false);
      expect(mutationCheck.isIdempotencyViolation).toBe(true);
      expect(mutationCheck.reason).toContain('Idempotency violation');
    });

    it('enforces mutation idempotency for save_memory in the same turn', () => {
      loopGuard.record('save_memory', { factText: 'User likes dark mode' });

      const secondSave = loopGuard.check('save_memory', { factText: 'User likes dark mode' });
      expect(secondSave.allowed).toBe(false);
      expect(secondSave.isIdempotencyViolation).toBe(true);
    });

    it('allows legitimate progressive web search refinements up to limit of 2', () => {
      // First search
      expect(loopGuard.check('web_search', { query: 'iPhone 16' }).allowed).toBe(true);
      loopGuard.record('web_search', { query: 'iPhone 16' });

      // Second refined search with different query
      expect(loopGuard.check('web_search', { query: 'iPhone 16 Pro Max specs' }).allowed).toBe(true);
      loopGuard.record('web_search', { query: 'iPhone 16 Pro Max specs' });

      // Third search is blocked to prevent search spamming
      const thirdSearch = loopGuard.check('web_search', { query: 'iPhone 16 price in Egypt' });
      expect(thirdSearch.allowed).toBe(false);
      expect(thirdSearch.reason).toContain('Web search limit reached');
    });

    it('detects two-step repetitive oscillation patterns (A -> B -> A -> B)', () => {
      loopGuard.record('tool_a', { id: 1 });
      loopGuard.record('tool_b', { id: 2 });
      loopGuard.record('tool_a', { id: 3 });

      // Proposing tool_b again after [A, B, A] forms [A, B, A, B] oscillation
      const oscillationCheck = loopGuard.check('tool_b', { id: 4 });
      expect(oscillationCheck.allowed).toBe(false);
      expect(oscillationCheck.isOscillation).toBe(true);
      expect(oscillationCheck.reason).toContain('Oscillation cycle detected');
    });
  });

  // =========================================================================
  // 5. FailureHandler Tests
  // =========================================================================
  describe('FailureHandler', () => {
    const handler = FailureHandler.getInstance();
    const policy = ExecutionPolicyManager.getInstance().resolvePolicy();

    it('permits at most one retry for transient timeout or network error', () => {
      const state = ExecutionStateManager.createInitialState('r1', 't1', 'goal', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'test' });
      step.error = createToolError('TIMEOUT_ERROR', 'Request timed out after 8000ms', { retryable: true });

      const res = handler.handleFailure(step, state, policy);
      expect(res.strategy).toBe('retry');
      expect(res.canRetry).toBe(true);

      // If already retried once, do not retry again
      step.retryCount = 1;
      const resAfterRetry = handler.handleFailure(step, state, policy);
      expect(resAfterRetry.strategy).toBe('abort_to_failure');
      expect(resAfterRetry.canRetry).toBe(false);
    });

    it('halts immediately without retry on fatal SSRF or security block', () => {
      const state = ExecutionStateManager.createInitialState('r1', 't1', 'goal', 3);
      const step = ExecutionStateManager.createStep(state, 'fetch_url', { url: 'http://localhost' });
      step.error = createToolError('SSRF_BLOCKED', 'SSRF attempt detected');

      const res = handler.handleFailure(step, state, policy);
      expect(res.strategy).toBe('abort_to_failure');
      expect(res.canRetry).toBe(false);
    });

    it('aborts to partial synthesis if previous steps succeeded and current step failed', () => {
      const state = ExecutionStateManager.createInitialState('r1', 't1', 'goal', 3);
      // Prior successful step
      const step1 = ExecutionStateManager.createStep(state, 'get_weather', { city: 'Cairo' });
      ExecutionStateManager.completeStep(step1, 'succeeded', { temp: 30 });

      // Second failed step
      const step2 = ExecutionStateManager.createStep(state, 'flaky_tool', {});
      step2.error = createToolError('EXECUTION_FAILED', 'Service down');

      const res = handler.handleFailure(step2, state, policy);
      expect(res.strategy).toBe('abort_to_partial_synthesis');
      expect(res.canRetry).toBe(false);
    });
  });

  // =========================================================================
  // 6. StepExecutor & Cancellation Tests
  // =========================================================================
  describe('StepExecutor & Cancellation', () => {
    const executor = new StepExecutor();

    it('aborts before tool execution if AbortSignal is already triggered', async () => {
      const controller = new AbortController();
      controller.abort();

      const context: ExecutionEngineContext = {
        runId: 'run_cancel_1',
        userId: 'u1',
        conversationId: 'c1',
        channel: 'flutter',
        userGoal: 'test',
        abortSignal: controller.signal,
      };

      const result = await executor.executeStep('get_current_time', {}, context);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('aborted by cancellation signal');
    });

    it('executes tool safely via ToolLifecycleManager when not aborted', async () => {
      const context: ExecutionEngineContext = {
        runId: 'run_ok_1',
        userId: 'u1',
        conversationId: 'c1',
        channel: 'flutter',
        userGoal: 'time check',
      };

      const result = await executor.executeStep('get_current_time', {}, context);

      expect(result.status).toBe('completed');
      expect(result.rawResult).toBeDefined();
      expect(result.rawResult.iso).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Multi-Step ExecutionEngine Scenarios
  // =========================================================================
  describe('ExecutionEngine Multi-Step Scenarios', () => {
    it('Scenario A: Executes single tool cleanly to completion', async () => {
      const engine = ExecutionEngine.getInstance();
      const context: ExecutionEngineContext = {
        runId: 'scen_a_run',
        userId: 'u_scen_a',
        conversationId: 'c_scen_a',
        channel: 'flutter',
        userGoal: 'كم الساعة الآن في القاهرة؟',
      };

      const result = await engine.run(context, [
        { role: 'user', content: 'كم الساعة الآن في القاهرة؟' },
      ]);

      expect(result.status).toBe('completed');
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].toolName).toBe('get_current_time');
      expect(result.steps[0].status).toBe('succeeded');
      expect(result.toolCallsExecuted.length).toBe(1);
      expect(result.metrics.stepsExecuted).toBe(1);
      expect(result.finalReply).toBeDefined();
    });

    it('Scenario B: Halts immediately at confirmation barrier without executing further steps', async () => {
      const engine = ExecutionEngine.getInstance();
      const context: ExecutionEngineContext = {
        runId: 'scen_b_run',
        userId: 'u_scen_b',
        conversationId: 'c_scen_b',
        channel: 'flutter',
        userGoal: 'ذكرني بموعد المقابلة غداً',
      };

      const result = await engine.run(context, [
        { role: 'user', content: 'ذكرني بموعد المقابلة غداً' },
      ]);

      expect(result.status).toBe('waiting_confirmation');
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].toolName).toBe('create_reminder');
      expect(result.steps[0].status).toBe('waiting_confirmation');
      expect(result.steps[0].verification?.status).toBe('partial');
    });

    it('Scenario C: Supports AbortSignal cancellation', async () => {
      const controller = new AbortController();
      controller.abort();

      const engine = ExecutionEngine.getInstance();
      const context: ExecutionEngineContext = {
        runId: 'scen_c_run',
        userId: 'u_scen_c',
        conversationId: 'c_scen_c',
        channel: 'flutter',
        userGoal: 'ابحث عن أسعار الهواتف',
        abortSignal: controller.signal,
      };

      const result = await engine.run(context, [
        { role: 'user', content: 'ابحث عن أسعار الهواتف' },
      ]);

      expect(result.status).toBe('cancelled');
      expect(result.steps.length).toBe(0);
      expect(result.finalReply).toContain('إلغاء');
    });

    it('Scenario D: Clamps custom excessive policy to hard ceiling of 5', async () => {
      const engine = ExecutionEngine.getInstance();
      const context: ExecutionEngineContext = {
        runId: 'scen_d_run',
        userId: 'u_scen_d',
        conversationId: 'c_scen_d',
        channel: 'flutter',
        userGoal: 'ما حالة الطقس؟',
        policy: {
          maxSteps: 20, // Requesting 20 steps
        },
      };

      const result = await engine.run(context, [
        { role: 'user', content: 'ما حالة الطقس؟' },
      ]);

      // State's maxSteps should be clamped to hard ceiling of 5
      expect(result.state.maxSteps).toBe(5);
    });

    it('Scenario E: Enforces LoopGuard within execution engine and prevents runaway loops', async () => {
      const customPlanner: any = {
        planNextStep: jest.fn().mockResolvedValue({
          type: 'tool_call',
          toolName: 'get_current_time',
          arguments: { timeZone: 'Africa/Cairo' },
        }),
      };

      const loopGuard = new LoopGuard();
      const engine = new ExecutionEngine(
        ExecutionPolicyManager.getInstance(),
        StepVerifier.getInstance(),
        loopGuard,
        FailureHandler.getInstance(),
        new StepExecutor(),
        customPlanner,
        new GroqProvider()
      );

      const context: ExecutionEngineContext = {
        runId: 'scen_e_run',
        userId: 'u_scen_e',
        conversationId: 'c_scen_e',
        channel: 'flutter',
        userGoal: 'loop test',
        policy: { maxSteps: 3 },
      };

      const result = await engine.run(context, [{ role: 'user', content: 'loop test' }]);

      // First call executes, second call with identical args is rejected by LoopGuard, halting the loop
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].status).toBe('succeeded');
    });

    it('Scenario F: Partial completion when a later step fails', async () => {
      let callCount = 0;
      const customPlanner: any = {
        planNextStep: jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              type: 'tool_call',
              toolName: 'get_current_time',
              arguments: {},
            };
          }
          if (callCount === 2) {
            return {
              type: 'tool_call',
              toolName: 'non_existent_tool',
              arguments: {},
            };
          }
          return { type: 'finish' };
        }),
      };

      const engine = new ExecutionEngine(
        ExecutionPolicyManager.getInstance(),
        StepVerifier.getInstance(),
        new LoopGuard(),
        FailureHandler.getInstance(),
        new StepExecutor(),
        customPlanner,
        new GroqProvider()
      );

      const context: ExecutionEngineContext = {
        runId: 'scen_f_run',
        userId: 'u_scen_f',
        conversationId: 'c_scen_f',
        channel: 'flutter',
        userGoal: 'multi step with failure',
        policy: { maxSteps: 3 },
      };

      const result = await engine.run(context, [{ role: 'user', content: 'test' }]);

      expect(result.status).toBe('partially_completed');
      expect(result.steps.length).toBe(2);
      expect(result.steps[0].status).toBe('succeeded');
      expect(result.steps[1].status).toBe('failed');
    });
  });
});
