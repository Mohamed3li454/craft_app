/**
 * Production Observability & Evaluation Harness Test Suite (Phase 8.5)
 *
 * Exhaustive verification covering:
 * 1. Trace Context & Async Context Propagation
 * 2. Nested Span Lifecycles & Bounded Ring Buffer
 * 3. Centralized Secret, Credential & PII Redaction
 * 4. Low-Cardinality Metrics & Percentile Histograms
 * 5. Fail-Open Instrumentation Behavior
 * 6. Subsystem Observability (AI Router, Agent Engine, Tool Lifecycle, Memory)
 * 7. System Health Snapshots
 * 8. Deterministic Evaluation Assertions & Replay Bundles
 * 9. Golden Dataset Execution (56 Scenarios)
 */

import {
  TraceContextManager,
  Tracer,
  TraceSpanImpl,
  MetricsCollector,
  redactSecrets,
  redactObject,
  logger,
  HealthSnapshotService,
  EvaluationAssertions,
  EvaluationEvaluator,
  EvaluationRunner,
  GOLDEN_EVALUATION_DATASET,
} from '../src/modules/observability';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { ProviderRegistry, MockAIProvider, AIRouter } from '../src/modules/ai';
import { ToolLifecycleManager } from '../src/modules/tools/lifecycle/tool_lifecycle';

describe('Phase 8.5: Production Observability & Evaluation Harness', () => {
  beforeEach(() => {
    Tracer.getInstance().clearCompletedTraces();
    MetricsCollector.getInstance().reset();
  });

  // =========================================================================
  // 1. Trace Context & Async Propagation
  // =========================================================================
  describe('Trace Context & Async Propagation', () => {
    it('Scenario 1: Creates root context with generated correlationId and propagates across async calls', async () => {
      const rootCtx = TraceContextManager.createRootContext({ channel: 'whatsapp' });
      expect(rootCtx.correlationId).toBeDefined();
      expect(rootCtx.channel).toBe('whatsapp');

      await TraceContextManager.runWithContext(rootCtx, async () => {
        const active = TraceContextManager.getActiveContext();
        expect(active?.correlationId).toBe(rootCtx.correlationId);
        expect(TraceContextManager.getCorrelationId()).toBe(rootCtx.correlationId);

        // Async boundary check
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(TraceContextManager.getCorrelationId()).toBe(rootCtx.correlationId);
      });
    });

    it('Scenario 2: Forks context preserving correlationId while assigning runId and stepId', () => {
      const parent = TraceContextManager.createRootContext({ correlationId: 'corr_test_1', channel: 'flutter' });
      const child = TraceContextManager.forkContext(parent, { runId: 'run_123', stepId: 'step_1' });

      expect(child.correlationId).toBe('corr_test_1');
      expect(child.runId).toBe('run_123');
      expect(child.stepId).toBe('step_1');
      expect(child.channel).toBe('flutter');
    });

    it('Scenario 3: Returns fallback correlationId when outside of async context', () => {
      const id = TraceContextManager.getCorrelationId();
      expect(id).toBe('corr_orphan');
    });
  });

  // =========================================================================
  // 2. Trace Span Lifecycle & Bounded Tracer
  // =========================================================================
  describe('Trace Span Lifecycle & Bounded Tracer', () => {
    it('Scenario 4: Span records execution duration and ends with ok status', async () => {
      const tracer = Tracer.getInstance();
      const res = await tracer.withSpan('test.operation', async (span) => {
        span.setAttribute('testKey', 'testValue');
        await new Promise((resolve) => setTimeout(resolve, 15));
        return 42;
      });

      expect(res).toBe(42);
      const traces = tracer.getCompletedTraces();
      expect(traces.length).toBe(1);
      expect(traces[0].status).toBe('ok');
      expect(traces[0].spans.length).toBe(1);
      expect(traces[0].spans[0].name).toBe('test.operation');
      expect(traces[0].spans[0].durationMs).toBeGreaterThanOrEqual(10);
      expect(traces[0].spans[0].attributes.testKey).toBe('testValue');
    });

    it('Scenario 5: Nested spans establish parentSpanId linkage', async () => {
      const tracer = Tracer.getInstance();
      await tracer.withSpan('parent.operation', async () => {
        await tracer.withSpan('child.operation', async (childSpan) => {
          childSpan.setAttribute('childAttr', 'hello');
        });
      });

      const traces = tracer.getCompletedTraces();
      expect(traces.length).toBe(1);
      const spans = traces[0].spans;
      expect(spans.length).toBe(2);

      const parentSpan = spans.find((s) => s.name === 'parent.operation');
      const childSpan = spans.find((s) => s.name === 'child.operation');

      expect(parentSpan).toBeDefined();
      expect(childSpan).toBeDefined();
      expect(childSpan?.parentSpanId).toBe(parentSpan?.spanId);
    });

    it('Scenario 6: Span records errors, status error, and re-throws cleanly', async () => {
      const tracer = Tracer.getInstance();
      await expect(
        tracer.withSpan('failing.operation', async (span) => {
          throw new Error('Database connection failed');
        })
      ).rejects.toThrow('Database connection failed');

      const traces = tracer.getCompletedTraces();
      expect(traces.length).toBe(1);
      expect(traces[0].status).toBe('error');
      expect(traces[0].spans[0].attributes.error).toBe(true);
      expect(traces[0].spans[0].attributes['error.message']).toContain('Database connection failed');
    });

    it('Scenario 7: Tracer maintains a bounded ring buffer of at most 100 completed traces', async () => {
      const tracer = Tracer.getInstance();
      for (let i = 0; i < 110; i++) {
        const root = TraceContextManager.createRootContext({ correlationId: `corr_${i}` });
        await TraceContextManager.runWithContext(root, async () => {
          await tracer.withSpan(`span_${i}`, async () => {});
        });
      }

      const completed = tracer.getCompletedTraces();
      expect(completed.length).toBe(100);
      expect(completed[0].traceId).toBe('corr_10');
      expect(completed[99].traceId).toBe('corr_109');
    });
  });

  // =========================================================================
  // 3. Centralized Redaction Layer
  // =========================================================================
  describe('Centralized Redaction Layer', () => {
    it('Scenario 8: Redacts Groq API keys, Bearer tokens, Meta tokens, and passwords from strings', () => {
      const text =
        'Failed auth using Bearer eyJhbGciOiJIUzI1NiJ9.test and gsk_1234567890abcdef1234 with password=SecretPassword123 and EAAabcdef1234567890token';
      const sanitized = redactSecrets(text);

      expect(sanitized).not.toContain('gsk_1234567890abcdef1234');
      expect(sanitized).not.toContain('SecretPassword123');
      expect(sanitized).not.toContain('EAAabcdef1234567890token');
      expect(sanitized).toContain('[REDACTED_API_KEY]');
      expect(sanitized).toContain('[REDACTED_PASSWORD]');
      expect(sanitized).toContain('[REDACTED_TOKEN]');
    });

    it('Scenario 9: Redacts database URLs and OTP verification codes from strings', () => {
      const text = 'Connected to postgres://app_user:super_secret_pw@db.craft.internal:5432/craft_db with otp=482910';
      const sanitized = redactSecrets(text);

      expect(sanitized).not.toContain('super_secret_pw');
      expect(sanitized).not.toContain('482910');
      expect(sanitized).toContain('postgres://[REDACTED_USER]:[REDACTED_PASSWORD]@[REDACTED_HOST]/[REDACTED_DB]');
      expect(sanitized).toContain('[REDACTED_OTP]');
    });

    it('Scenario 10: Deeply sanitizes objects, masking sensitive key names and recursively processing nested fields', () => {
      const payload = {
        userId: 'u_1',
        credentials: {
          api_key: 'gsk_secret12345678',
          password: 'myPassword!',
          nested: {
            authHeader: 'Bearer my_token_123',
          },
        },
        publicData: 'hello world',
      };

      const sanitized = redactObject(payload) as any;

      expect(sanitized.credentials.api_key).toBe('[REDACTED]');
      expect(sanitized.credentials.password).toBe('[REDACTED]');
      expect(sanitized.credentials.nested.authHeader).toBe('Bearer [REDACTED_TOKEN]');
      expect(sanitized.publicData).toBe('hello world');
    });
  });

  // =========================================================================
  // 4. Low-Cardinality In-Memory Metrics Registry
  // =========================================================================
  describe('Low-Cardinality In-Memory Metrics Registry', () => {
    let metrics: MetricsCollector;

    beforeEach(() => {
      metrics = MetricsCollector.getInstance();
      metrics.reset();
    });

    it('Scenario 11: Accurately increments monotonic counters with low-cardinality tags', () => {
      metrics.increment('craft.requests.total', 1, { channel: 'whatsapp', status: 'success' });
      metrics.increment('craft.requests.total', 2, { channel: 'whatsapp', status: 'success' });

      expect(metrics.getCounter('craft.requests.total', { channel: 'whatsapp', status: 'success' })).toBe(3);
    });

    it('Scenario 12: Strictly rejects or strips high-cardinality tags (userId, messageId, prompt)', () => {
      metrics.increment('craft.requests.total', 1, {
        channel: 'flutter',
        userId: 'user_1234567890',
        messageId: 'msg_987654321',
        prompt: 'sensitive text query',
      } as any);

      const snapshot = metrics.getSnapshot();
      const keys = Object.keys(snapshot.counters);
      expect(keys.length).toBe(1);
      expect(keys[0]).toBe('craft.requests.total{channel=flutter}');
      expect(keys[0]).not.toContain('user_1234567890');
      expect(keys[0]).not.toContain('msg_987654321');
    });

    it('Scenario 13: Computes percentiles, averages, and bounds for latency histograms', () => {
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const lat of latencies) {
        metrics.observe('craft.request.latency', lat, { channel: 'flutter' });
      }

      const hist = metrics.getHistogram('craft.request.latency', { channel: 'flutter' });
      expect(hist).toBeDefined();
      expect(hist?.count).toBe(10);
      expect(hist?.min).toBe(10);
      expect(hist?.max).toBe(100);
      expect(hist?.avg).toBe(55);
      expect(hist?.p50).toBe(60);
      expect(hist?.p90).toBe(100);
    });

    it('Scenario 14: Fail-open guarantee: metrics methods never throw even under abnormal conditions', () => {
      expect(() => {
        metrics.increment(null as any, NaN as any, null as any);
        metrics.observe(undefined as any, null as any, {} as any);
        metrics.gauge(null as any, undefined as any);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 5. Subsystem Observability Integration
  // =========================================================================
  describe('Subsystem Observability Integration', () => {
    let metrics: MetricsCollector;
    let tracer: Tracer;

    beforeEach(() => {
      metrics = MetricsCollector.getInstance();
      tracer = Tracer.getInstance();
    });

    it('Scenario 15: AIRouter records AI requests, latencies, tokens, and fallback metrics', async () => {
      const registry = new ProviderRegistry();
      const primaryMock = new MockAIProvider({ id: 'primary-groq' });
      const fallbackMock = new MockAIProvider({ id: 'fallback-groq' });

      // Primary encounters 500 server error
      primaryMock.queueError({ category: 'unavailable', statusCode: 500, retryable: true });
      // Secondary succeeds with usage
      fallbackMock.queueResponse({
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        message: { role: 'assistant', content: 'Fallback response' },
      });

      registry.registerProvider(primaryMock);
      registry.registerProvider(fallbackMock);

      const router = new AIRouter(registry);
      await router.route(
        { messages: [{ role: 'user', content: 'test query' }] },
        { policy: { primaryProvider: 'primary-groq', fallbackProviders: ['fallback-groq'] } }
      );

      expect(metrics.getCounter('craft.ai.requests', { provider: 'primary-groq' })).toBe(1);
      expect(metrics.getCounter('craft.ai.requests', { provider: 'fallback-groq' })).toBe(1);
      expect(metrics.getCounter('craft.ai.failures', { provider: 'primary-groq', errorCategory: 'unavailable' })).toBe(1);
      expect(metrics.getCounter('craft.ai.fallbacks', { provider: 'primary-groq', errorCategory: 'unavailable' })).toBe(1);
      expect(metrics.getCounter('craft.ai.tokens.total', { provider: 'fallback-groq' })).toBe(150);
    });

    it('Scenario 16: ToolLifecycleManager records tool calls, latencies, confirmations, and failures', async () => {
      const manager = ToolLifecycleManager.getInstance();

      // Unknown tool failure
      await manager.execute('invalid_tool_xyz', {}, { userId: 'u1', conversationId: 'c1', channel: 'flutter' });
      expect(metrics.getCounter('craft.tool.calls', { tool: 'invalid_tool_xyz', channel: 'flutter' })).toBe(1);
      expect(metrics.getCounter('craft.tool.failures', { tool: 'invalid_tool_xyz', errorCategory: 'TOOL_NOT_FOUND' })).toBe(1);

      // Sensitive action confirmation
      await manager.execute('create_reminder', { title: 'Test', time: 'tomorrow 10am' }, { userId: 'u1', conversationId: 'c1', channel: 'flutter' });
      expect(metrics.getCounter('craft.tool.confirmations', { tool: 'create_reminder', channel: 'flutter' })).toBe(1);
    });

    it('Scenario 17: Agent Pipeline execution wraps stages in spans and records run metrics', async () => {
      const orchestrator = new AgentOrchestrator();
      const result = await orchestrator.run({
        userId: 'u_obs_test',
        channel: 'flutter',
        text: 'Hello Craft',
        correlationId: 'corr_test_e2e',
      });

      expect(result.status).toBe('completed');
      expect(metrics.getCounter('craft.agent.runs', { channel: 'flutter' })).toBeGreaterThanOrEqual(1);

      const completedTraces = tracer.getCompletedTraces();
      const pipelineTrace = completedTraces.find((t) => t.traceId === 'corr_test_e2e');
      expect(pipelineTrace).toBeDefined();
      expect(pipelineTrace?.spans.some((s) => s.name === 'pipeline.run')).toBe(true);
      expect(pipelineTrace?.spans.some((s) => s.name === 'pipeline.preflight')).toBe(true);
      expect(pipelineTrace?.spans.some((s) => s.name === 'pipeline.cognitive')).toBe(true);
    });
  });

  // =========================================================================
  // 6. System Health Snapshot
  // =========================================================================
  describe('System Health Snapshot', () => {
    it('Scenario 18: Aggregates real-time operational status, circuit breaker states, and error rates without secrets', () => {
      const metrics = MetricsCollector.getInstance();
      metrics.reset();
      metrics.increment('craft.requests.total', 10, { channel: 'flutter' });
      metrics.increment('craft.requests.success', 9, { channel: 'flutter' });
      metrics.increment('craft.requests.error', 1, { channel: 'flutter' });

      const service = HealthSnapshotService.getInstance();
      const snapshot = service.getSnapshot();

      expect(snapshot.status).toBe('healthy');
      expect(snapshot.requests.total).toBe(10);
      expect(snapshot.requests.success).toBe(9);
      expect(snapshot.requests.error).toBe(1);
      expect(snapshot.requests.errorRate).toBe(10); // 10%
      expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);

      // Verify no secrets exposed in snapshot
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain('gsk_');
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('Bearer');
    });

    it('Scenario 19: Degrades system health status when error rate exceeds threshold', () => {
      const metrics = MetricsCollector.getInstance();
      metrics.reset();
      metrics.increment('craft.requests.total', 10, { channel: 'flutter' });
      metrics.increment('craft.requests.error', 4, { channel: 'flutter' }); // 40% error rate

      const service = HealthSnapshotService.getInstance();
      const snapshot = service.getSnapshot();

      expect(snapshot.status).toBe('degraded');
      expect(snapshot.requests.errorRate).toBe(40);
    });
  });

  // =========================================================================
  // 7. Deterministic Evaluation Assertions & Replay Bundles
  // =========================================================================
  describe('Deterministic Evaluation Assertions & Replay Bundles', () => {
    it('Scenario 20: EvaluationAssertions accurately verifies tool usage, strategies, and boundaries', () => {
      const actual = {
        toolCalls: ['get_current_time', 'web_search'],
        strategy: 'direct_answer',
        provider: 'groq',
        fallbackUsed: false,
        memorySelectedCount: 2,
        clarificationNeeded: false,
        status: 'completed',
      };

      expect(EvaluationAssertions.assertToolUsed(actual, 'get_current_time').ok).toBe(true);
      expect(EvaluationAssertions.assertToolNotUsed(actual, 'delete_reminder').ok).toBe(true);
      expect(EvaluationAssertions.assertStrategy(actual, 'direct_answer').ok).toBe(true);
      expect(EvaluationAssertions.assertProvider(actual, 'groq').ok).toBe(true);
      expect(EvaluationAssertions.assertFallback(actual, false).ok).toBe(true);
      expect(EvaluationAssertions.assertMemorySelected(actual, 1).ok).toBe(true);
      expect(EvaluationAssertions.assertClarification(actual, false).ok).toBe(true);
      expect(EvaluationAssertions.assertFinalState(actual, 'completed').ok).toBe(true);
    });

    it('Scenario 21: EvaluationEvaluator produces complete replay bundle with correlationId, steps, and latencies', async () => {
      const evaluator = EvaluationEvaluator.getInstance();
      const testCase = GOLDEN_EVALUATION_DATASET.find((c) => c.id === 'conv_01')!;

      const result = await evaluator.evaluate(testCase);

      expect(result.passed).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.replayBundle).toBeDefined();
      expect(result.replayBundle.correlationId).toMatch(/^eval_/);
      expect(result.replayBundle.caseId).toBe('conv_01');
      expect(result.replayBundle.category).toBe('conversation');
      expect(result.replayBundle.latencies.total).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // 8. Golden Dataset Comprehensive Evaluation (56 Scenarios)
  // =========================================================================
  describe('Golden Dataset Comprehensive Evaluation (56 Scenarios)', () => {
    it('Scenario 22: EvaluationRunner executes all 56 golden scenarios across 7 subsystems with 100% pass rate', async () => {
      const runner = new EvaluationRunner();
      const report = await runner.run();

      expect(report.totalCases).toBe(56);
      expect(report.passed).toBe(56);
      expect(report.failed).toBe(0);
      expect(report.passRate).toBe(100);

      // Verify all 7 architectural subsystems have 100% pass rates
      expect(report.categoryBreakdown.memory.passRate).toBe(100);
      expect(report.categoryBreakdown.conversation.passRate).toBe(100);
      expect(report.categoryBreakdown.personalization.passRate).toBe(100);
      expect(report.categoryBreakdown.adaptive_response.passRate).toBe(100);
      expect(report.categoryBreakdown.agent.passRate).toBe(100);
      expect(report.categoryBreakdown.provider.passRate).toBe(100);
      expect(report.categoryBreakdown.proactive.passRate).toBe(100);

      // Verify zero failures
      expect(report.failures.length).toBe(0);
    });

    it('Scenario 23: EvaluationRunner can execute filtered subsets by category or tag', async () => {
      const runner = new EvaluationRunner();

      const memoryReport = await runner.run({ category: 'memory' });
      expect(memoryReport.totalCases).toBe(8);
      expect(memoryReport.passed).toBe(8);

      const agentReport = await runner.run({ category: 'agent' });
      expect(agentReport.totalCases).toBe(8);
      expect(agentReport.passed).toBe(8);

      const tagReport = await runner.run({ tag: 'fallback' });
      expect(tagReport.totalCases).toBe(3);
      expect(tagReport.passed).toBe(3);
    });
  });
});
