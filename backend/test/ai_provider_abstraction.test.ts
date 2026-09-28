/**
 * Phase 8.4 — Multi-Provider AI Abstraction & Resilient Routing Test Suite
 *
 * Verifies:
 * 1. Provider Contract & Normalization (Scenarios 1-7)
 * 2. Error Classification & Taxonomy (Scenarios 8-18)
 * 3. Circuit Breaker Mechanics (Scenarios 19-25)
 * 4. AIRouter Provider Selection & Resilient Fallback (Scenarios 26-34)
 * 5. Token Budget Preservation & Context Window (Scenarios 35-36)
 * 6. Cancellation Semantics (Scenarios 37-38)
 * 7. Tool Continuity & Mutation Protection Across Provider Switch (Scenarios 39-41)
 * 8. Configuration & Policy Management (Scenarios 42-44)
 */

import {
  AIMessage,
  AIRequest,
  AIResponse,
  AIRouter,
  AIProviderError,
  CircuitBreaker,
  ProviderRegistry,
  RoutingPolicyManager,
  HARD_LIMIT_MAX_ATTEMPTS,
  GroqMapper,
  GroqAIProvider,
  MockAIProvider,
  SystemPromptBuilder,
} from '../src/modules/ai';
import { ExecutionEngine } from '../src/modules/agent/execution/execution_engine';
import { ExecutionPlanner } from '../src/modules/agent/execution/planner';
import { ExecutionPolicyManager } from '../src/modules/agent/execution/execution_policy';
import { StepVerifier } from '../src/modules/agent/execution/step_verifier';
import { LoopGuard } from '../src/modules/agent/execution/loop_guard';
import { FailureHandler } from '../src/modules/agent/execution/failure_handler';
import { StepExecutor } from '../src/modules/agent/execution/step_executor';
import { ExecutionEngineContext } from '../src/modules/agent/execution/types';
import { ToolRegistry } from '../src/modules/tools/registry';

describe('Phase 8.4: Multi-Provider AI Abstraction & Resilient Routing', () => {
  // =========================================================================
  // 1. Provider Contract & Normalization
  // =========================================================================
  describe('Provider Contract & Normalization', () => {
    it('Scenario 1: GroqMapper transforms normalized AIRequest with text to Groq payload', () => {
      const request: AIRequest = {
        messages: [
          { role: 'system', content: 'You are Craft' },
          { role: 'user', content: 'Hello there' },
        ],
        temperature: 0.5,
        maxTokens: 1024,
      };

      const payload = GroqMapper.toGroqPayload(request, 'openai/gpt-oss-120b');

      expect(payload.model).toBe('openai/gpt-oss-120b');
      expect(payload.temperature).toBe(0.5);
      expect(payload.max_tokens).toBe(1024);
      expect(payload.messages.length).toBe(2);
      expect(payload.messages[0]).toEqual({ role: 'system', content: 'You are Craft' });
      expect(payload.messages[1]).toEqual({ role: 'user', content: 'Hello there' });
    });

    it('Scenario 2: GroqMapper transforms normalized AIRequest with tools to Groq payload with auto tool choice', () => {
      const request: AIRequest = {
        messages: [{ role: 'user', content: 'What is the time?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_current_time',
              description: 'Get current time',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      };

      const payload = GroqMapper.toGroqPayload(request, 'openai/gpt-oss-120b');

      expect(payload.tools).toBeDefined();
      expect(payload.tools.length).toBe(1);
      expect(payload.tool_choice).toBe('auto');
    });

    it('Scenario 3: GroqMapper normalizes Groq Chat API response with assistant text and usage into AIResponse', () => {
      const rawData = {
        id: 'chatcmpl-test-123',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello, I am Craft AI Assistant.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 15,
          total_tokens: 40,
        },
      };

      const normalized = GroqMapper.fromGroqResponse(rawData, 'groq', 'openai/gpt-oss-120b', 120);

      expect(normalized.providerId).toBe('groq');
      expect(normalized.model).toBe('openai/gpt-oss-120b');
      expect(normalized.message.role).toBe('assistant');
      expect(normalized.message.content).toBe('Hello, I am Craft AI Assistant.');
      expect(normalized.toolCalls.length).toBe(0);
      expect(normalized.finishReason).toBe('stop');
      expect(normalized.usage).toEqual({
        promptTokens: 25,
        completionTokens: 15,
        totalTokens: 40,
      });
      expect(normalized.latencyMs).toBe(120);
      expect(normalized.requestId).toBe('chatcmpl-test-123');
    });

    it('Scenario 4: GroqMapper normalizes Groq Chat API response with function calls into structured AIToolCall[]', () => {
      const rawData = {
        id: 'chatcmpl-tool-456',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc_1',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"Cairo"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
      };

      const normalized = GroqMapper.fromGroqResponse(rawData, 'groq', 'openai/gpt-oss-120b', 95);

      expect(normalized.finishReason).toBe('tool_calls');
      expect(normalized.toolCalls.length).toBe(1);
      expect(normalized.toolCalls[0].id).toBe('call_abc_1');
      expect(normalized.toolCalls[0].function.name).toBe('get_weather');
      expect(normalized.toolCalls[0].function.arguments).toEqual({ city: 'Cairo' });
      expect(normalized.toolCalls[0].function.rawArguments).toBe('{"city":"Cairo"}');
    });

    it('Scenario 5: GroqMapper parses raw tool arguments safely and handles malformed JSON without crashing', () => {
      const rawData = {
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_bad_json',
                  type: 'function',
                  function: {
                    name: 'echo_message',
                    arguments: 'INVALID_JSON_STRING',
                  },
                },
              ],
            },
          },
        ],
      };

      const normalized = GroqMapper.fromGroqResponse(rawData, 'groq', 'test-model', 50);

      expect(normalized.toolCalls.length).toBe(1);
      expect(normalized.toolCalls[0].function.name).toBe('echo_message');
      expect(normalized.toolCalls[0].function.arguments).toEqual({});
      expect(normalized.toolCalls[0].function.rawArguments).toBe('INVALID_JSON_STRING');
    });

    it('Scenario 6: GroqAIProvider.supports() correctly checks capabilities (tools, vision, system_instruction)', () => {
      const provider = new GroqAIProvider();

      expect(provider.supports('tools')).toBe(true);
      expect(provider.supports('system_instruction')).toBe(true);
      expect(provider.supports('vision')).toBe(true); // Supported via qwen vision model
    });

    it('Scenario 7: GroqAIProvider.getModelProfiles() returns catalog with correct context windows and limits', () => {
      const provider = new GroqAIProvider();
      const profiles = provider.getModelProfiles();

      expect(profiles.length).toBeGreaterThanOrEqual(3);
      const defaultProfile = profiles.find((p) => p.isDefault);
      expect(defaultProfile).toBeDefined();
      expect(defaultProfile?.contextWindow).toBe(8192);
      expect(defaultProfile?.supportsTools).toBe(true);
    });
  });

  // =========================================================================
  // 2. Error Classification & Taxonomy
  // =========================================================================
  describe('Error Classification & Taxonomy', () => {
    it('Scenario 8: HTTP 401 / invalid API key classifies as authentication with retryable: false', () => {
      const err = AIProviderError.classify('groq', 401, 'Invalid API Key provided');

      expect(err.category).toBe('authentication');
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(401);
    });

    it('Scenario 9: HTTP 403 / permission denied classifies as authorization with retryable: false', () => {
      const err = AIProviderError.classify('groq', 403, 'Permission denied for organization');

      expect(err.category).toBe('authorization');
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(403);
    });

    it('Scenario 10: HTTP 429 / rate limit exceeded classifies as rate_limit with retryable: true', () => {
      const err = AIProviderError.classify('groq', 429, 'Rate limit exceeded: 6000 tokens per minute');

      expect(err.category).toBe('rate_limit');
      expect(err.retryable).toBe(true);
      expect(err.statusCode).toBe(429);
    });

    it('Scenario 11: HTTP 408 / 504 / AbortError classifies as timeout with retryable: true', () => {
      const err = AIProviderError.classify('groq', new Error('Request timed out after 30000ms'));

      expect(err.category).toBe('timeout');
      expect(err.retryable).toBe(true);
    });

    it('Scenario 12: Network connection failures (ECONNRESET, fetch failed) classify as network with retryable: true', () => {
      const err = AIProviderError.classify('groq', new Error('fetch failed: ECONNRESET'));

      expect(err.category).toBe('network');
      expect(err.retryable).toBe(true);
    });

    it('Scenario 13: HTTP 500 / 502 / 503 classify as unavailable with retryable: true', () => {
      const err = AIProviderError.classify('groq', 503, 'Service Temporarily Unavailable');

      expect(err.category).toBe('unavailable');
      expect(err.retryable).toBe(true);
      expect(err.statusCode).toBe(503);
    });

    it('Scenario 14: Context length exceeded classifies as context_overflow with retryable: false', () => {
      const err = AIProviderError.classify('groq', 400, 'Context_length_exceeded: maximum context length is 8192');

      expect(err.category).toBe('context_overflow');
      expect(err.retryable).toBe(false);
    });

    it('Scenario 15: Model decommissioned classifies as model_unavailable with retryable: true', () => {
      const err = AIProviderError.classify('groq', 404, 'The requested model is decommissioned or model_not_found');

      expect(err.category).toBe('model_unavailable');
      expect(err.retryable).toBe(true);
    });

    it('Scenario 16: Malformed response / empty choices classifies as malformed_response with retryable: true', () => {
      const err = AIProviderError.classify('groq', new Error('Groq returned empty choices array'));

      expect(err.category).toBe('malformed_response');
      expect(err.retryable).toBe(true);
    });

    it('Scenario 17: HTTP 400 / invalid parameters classifies as invalid_request with retryable: false', () => {
      const err = AIProviderError.classify('groq', 400, 'invalid_request_error: parameter temperature out of range');

      expect(err.category).toBe('invalid_request');
      expect(err.retryable).toBe(false);
    });

    it('Scenario 18: Error messages containing sensitive keys or tokens are redacted', () => {
      const rawMsg = 'Failed auth with token Bearer gsk_secretApiKey1234567890abcdef and password secretPass';
      const err = AIProviderError.classify('groq', 401, rawMsg);

      expect(err.message).not.toContain('gsk_secretApiKey1234567890abcdef');
      expect(err.message).toContain('[REDACTED_TOKEN]');
    });
  });

  // =========================================================================
  // 3. Circuit Breaker Mechanics
  // =========================================================================
  describe('Circuit Breaker Mechanics', () => {
    let cb: CircuitBreaker;

    beforeEach(() => {
      cb = new CircuitBreaker('test-provider', { failureThreshold: 3, cooldownMs: 100 });
    });

    it('Scenario 19: Circuit breaker starts in closed state and allows execution', () => {
      expect(cb.getState()).toBe('closed');
      expect(cb.canExecute()).toBe(true);
      expect(cb.getHealth().status).toBe('healthy');
    });

    it('Scenario 20: Circuit breaker trips to open after 3 consecutive retryable failures', () => {
      cb.recordFailure(true);
      expect(cb.getState()).toBe('closed');
      cb.recordFailure(true);
      expect(cb.getState()).toBe('closed');
      cb.recordFailure(true);

      expect(cb.getState()).toBe('open');
      expect(cb.canExecute()).toBe(false);
      expect(cb.getHealth().status).toBe('unavailable');
    });

    it('Scenario 21: Non-retryable errors (e.g. invalid user request) do NOT increment circuit breaker failure count', () => {
      cb.recordFailure(false);
      cb.recordFailure(false);
      cb.recordFailure(false);

      expect(cb.getState()).toBe('closed');
      expect(cb.canExecute()).toBe(true);
    });

    it('Scenario 22: While circuit breaker is open, requests are blocked immediately with unavailable error', async () => {
      cb.recordFailure(true);
      cb.recordFailure(true);
      cb.recordFailure(true);

      const mockProvider = new MockAIProvider({ id: 'blocked-mock' });
      (mockProvider as any).circuitBreaker = cb;

      await expect(
        mockProvider.generate({ messages: [{ role: 'user', content: 'test' }] })
      ).rejects.toThrow('circuit breaker is OPEN');
    });

    it('Scenario 23: After cooldown period, circuit breaker transitions to half-open allowing a probe request', async () => {
      cb.recordFailure(true);
      cb.recordFailure(true);
      cb.recordFailure(true);
      expect(cb.getState()).toBe('open');

      // Wait for cooldown (100ms)
      await new Promise((r) => setTimeout(r, 110));

      expect(cb.getState()).toBe('half-open');
      expect(cb.canExecute()).toBe(true);
      expect(cb.getHealth().status).toBe('degraded');
    });

    it('Scenario 24: Successful probe in half-open state recovers circuit breaker back to closed', async () => {
      cb.recordFailure(true);
      cb.recordFailure(true);
      cb.recordFailure(true);
      await new Promise((r) => setTimeout(r, 110));

      expect(cb.getState()).toBe('half-open');
      cb.recordSuccess();

      expect(cb.getState()).toBe('closed');
      expect(cb.canExecute()).toBe(true);
      expect(cb.getHealth().status).toBe('healthy');
    });

    it('Scenario 25: Failed probe in half-open state trips circuit breaker back to open', async () => {
      cb.recordFailure(true);
      cb.recordFailure(true);
      cb.recordFailure(true);
      await new Promise((r) => setTimeout(r, 110));

      expect(cb.getState()).toBe('half-open');
      cb.recordFailure(true);

      expect(cb.getState()).toBe('open');
      expect(cb.canExecute()).toBe(false);
    });
  });

  // =========================================================================
  // 4. AIRouter Provider Selection & Resilient Fallback
  // =========================================================================
  describe('AIRouter Provider Selection & Resilient Fallback', () => {
    let registry: ProviderRegistry;
    let router: AIRouter;
    let primaryMock: MockAIProvider;
    let fallbackMock: MockAIProvider;

    beforeEach(() => {
      registry = new ProviderRegistry();
      registry.clear();

      primaryMock = new MockAIProvider({ id: 'provider-a' });
      fallbackMock = new MockAIProvider({ id: 'provider-b' });

      registry.registerProvider(primaryMock);
      registry.registerProvider(fallbackMock);

      router = new AIRouter(registry);
    });

    it('Scenario 26: Routes to primary provider on clean execution', async () => {
      primaryMock.queueResponse({
        message: { role: 'assistant', content: 'Response from Provider A' },
      });

      const response = await router.route(
        { messages: [{ role: 'user', content: 'Hello' }] },
        { policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] } }
      );

      expect(response.providerId).toBe('provider-a');
      expect(response.message.content).toBe('Response from Provider A');
      expect(primaryMock.getInvocations().length).toBe(1);
      expect(fallbackMock.getInvocations().length).toBe(0);
    });

    it('Scenario 27: Falls back to secondary provider when primary encounters retryable 500 server error', async () => {
      primaryMock.queueError({ category: 'unavailable', statusCode: 500 });
      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Fallback response from Provider B' },
      });

      const response = await router.route(
        { messages: [{ role: 'user', content: 'Calculate 2+2' }] },
        { policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] } }
      );

      expect(response.providerId).toBe('provider-b');
      expect(response.message.content).toBe('Fallback response from Provider B');
      expect(primaryMock.getInvocations().length).toBe(1);
      expect(fallbackMock.getInvocations().length).toBe(1);
    });

    it('Scenario 28: Falls back to secondary provider when primary encounters 429 rate limit', async () => {
      primaryMock.queueError({ category: 'rate_limit', statusCode: 429 });
      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Response after rate limit fallback' },
      });

      const response = await router.route(
        { messages: [{ role: 'user', content: 'Summarize text' }] },
        { policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] } }
      );

      expect(response.providerId).toBe('provider-b');
      expect(primaryMock.getInvocations().length).toBe(1);
      expect(fallbackMock.getInvocations().length).toBe(1);
    });

    it('Scenario 29: Falls back to secondary provider when primary times out', async () => {
      primaryMock.queueError({ category: 'timeout', statusCode: 408 });
      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Response after timeout' },
      });

      const response = await router.route(
        { messages: [{ role: 'user', content: 'Long reasoning' }] },
        { policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] } }
      );

      expect(response.providerId).toBe('provider-b');
      expect(response.message.content).toBe('Response after timeout');
    });

    it('Scenario 30: Does NOT fallback when primary encounters 401 authentication error (fail-fast)', async () => {
      primaryMock.queueError({ category: 'authentication', statusCode: 401, retryable: false });
      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Should never be called' },
      });

      await expect(
        router.route(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] } }
        )
      ).rejects.toThrow('AUTHENTICATION');

      expect(primaryMock.getInvocations().length).toBe(1);
      expect(fallbackMock.getInvocations().length).toBe(0); // Fallback was prohibited!
    });

    it('Scenario 31: Does NOT fallback when primary encounters 400 invalid request error', async () => {
      primaryMock.queueError({ category: 'invalid_request', statusCode: 400, retryable: false });

      await expect(
        router.route(
          { messages: [{ role: 'user', content: 'Bad query' }] },
          { policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] } }
        )
      ).rejects.toThrow('INVALID_REQUEST');

      expect(fallbackMock.getInvocations().length).toBe(0);
    });

    it('Scenario 32: Bounded fallback: strictly stops after maxProviderAttempts = 2 without infinite chaining', async () => {
      const thirdMock = new MockAIProvider({ id: 'provider-c' });
      registry.registerProvider(thirdMock);

      primaryMock.queueError({ category: 'unavailable', statusCode: 503 });
      fallbackMock.queueError({ category: 'unavailable', statusCode: 503 });
      thirdMock.queueResponse({ message: { role: 'assistant', content: 'Provider C' } });

      // Even if fallbackProviders has 2 secondary providers, maxProviderAttempts is clamped to 2
      await expect(
        router.route(
          { messages: [{ role: 'user', content: 'Hello' }] },
          {
            policy: {
              primaryProvider: 'provider-a',
              fallbackProviders: ['provider-b', 'provider-c'],
              maxProviderAttempts: 2,
            },
          }
        )
      ).rejects.toThrow('UNAVAILABLE');

      expect(primaryMock.getInvocations().length).toBe(1);
      expect(fallbackMock.getInvocations().length).toBe(1);
      expect(thirdMock.getInvocations().length).toBe(0); // 3rd provider never attempted!
    });

    it('Scenario 33: Capability matching: skips providers that do not support tools when tool calling is required', async () => {
      const noToolsMock = new MockAIProvider({ id: 'no-tools-provider' });
      (noToolsMock as any).modelProfiles = [
        {
          providerId: 'no-tools-provider',
          modelId: 'text-only-model',
          contextWindow: 4096,
          maxOutputTokens: 2048,
          supportsTools: false,
          supportsVision: false,
          supportsStreaming: false,
          capabilities: [],
        },
      ];
      registry.registerProvider(noToolsMock);

      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Handled with tools support' },
      });

      const response = await router.route(
        {
          messages: [{ role: 'user', content: 'Check weather' }],
          tools: [
            {
              type: 'function',
              function: { name: 'get_weather', parameters: {} },
            },
          ],
        },
        { policy: { primaryProvider: 'no-tools-provider', fallbackProviders: ['provider-b'] } }
      );

      // 'no-tools-provider' was skipped because it lacks tools capability!
      expect(response.providerId).toBe('provider-b');
      expect(noToolsMock.getInvocations().length).toBe(0);
    });

    it('Scenario 34: Capability matching: skips providers that do not support vision when image is attached', async () => {
      const textOnlyMock = new MockAIProvider({ id: 'text-only' });
      (textOnlyMock as any).modelProfiles = [
        {
          providerId: 'text-only',
          modelId: 'text-model',
          contextWindow: 4096,
          maxOutputTokens: 2048,
          supportsTools: true,
          supportsVision: false,
          supportsStreaming: false,
          capabilities: ['tools'],
        },
      ];
      registry.registerProvider(textOnlyMock);

      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Image analyzed successfully' },
      });

      const response = await router.route(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is this?' },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,123' } },
              ],
            },
          ],
        },
        { policy: { primaryProvider: 'text-only', fallbackProviders: ['provider-b'] } }
      );

      expect(response.providerId).toBe('provider-b');
      expect(textOnlyMock.getInvocations().length).toBe(0);
    });
  });

  // =========================================================================
  // 5. Token Budget Preservation & Context Window
  // =========================================================================
  describe('Token Budget Preservation & Context Window', () => {
    let registry: ProviderRegistry;
    let router: AIRouter;
    let primaryMock: MockAIProvider;
    let fallbackMock: MockAIProvider;

    beforeEach(() => {
      registry = new ProviderRegistry();
      registry.clear();

      primaryMock = new MockAIProvider({ id: 'provider-a' });
      fallbackMock = new MockAIProvider({ id: 'provider-b' });

      registry.registerProvider(primaryMock);
      registry.registerProvider(fallbackMock);

      router = new AIRouter(registry);
    });

    it('Scenario 35: Token budget is shared across fallback: remaining tokens forwarded, never reset to zero', async () => {
      primaryMock.queueError({ category: 'unavailable', statusCode: 500 });
      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Budget-aware reply' },
      });

      // Starting with 1000 tokens remaining in turn budget
      await router.route(
        { messages: [{ role: 'user', content: 'Test budget' }], maxTokens: 2048 },
        {
          policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] },
          remainingTokenBudget: 1000,
        }
      );

      const fallbackInvocations = fallbackMock.getInvocations();
      expect(fallbackInvocations.length).toBe(1);
      // maxTokens was clamped to the remaining budget of 1000 rather than resetting to 2048
      expect(fallbackInvocations[0].maxTokens).toBe(1000);
    });

    it('Scenario 36: Context window check: blocks dispatch before sending if request exceeds model context limit', async () => {
      const tinyContextMock = new MockAIProvider({ id: 'tiny-model-provider' });
      (tinyContextMock as any).modelProfiles = [
        {
          providerId: 'tiny-model-provider',
          modelId: 'tiny-model',
          contextWindow: 50, // Tiny context limit of 50 tokens
          maxOutputTokens: 50,
          supportsTools: true,
          supportsVision: true,
          supportsStreaming: true,
          capabilities: ['tools'],
        },
      ];
      registry.registerProvider(tinyContextMock);

      // Huge message containing > 50 tokens
      const hugePrompt = 'A'.repeat(5000);

      await expect(
        router.route(
          { messages: [{ role: 'user', content: hugePrompt }] },
          { policy: { primaryProvider: 'tiny-model-provider' } }
        )
      ).rejects.toThrow('CONTEXT_OVERFLOW');

      expect(tinyContextMock.getInvocations().length).toBe(0);
    });
  });

  // =========================================================================
  // 6. Cancellation Semantics
  // =========================================================================
  describe('Cancellation Semantics', () => {
    let registry: ProviderRegistry;
    let router: AIRouter;
    let primaryMock: MockAIProvider;
    let fallbackMock: MockAIProvider;

    beforeEach(() => {
      registry = new ProviderRegistry();
      registry.clear();

      primaryMock = new MockAIProvider({ id: 'provider-a' });
      fallbackMock = new MockAIProvider({ id: 'provider-b' });

      registry.registerProvider(primaryMock);
      registry.registerProvider(fallbackMock);

      router = new AIRouter(registry);
    });

    it('Scenario 37: AbortSignal already aborted halts immediately on primary without dispatching', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        router.route({
          messages: [{ role: 'user', content: 'test' }],
          signal: controller.signal,
        })
      ).rejects.toThrow('TIMEOUT');

      expect(primaryMock.getInvocations().length).toBe(0);
      expect(fallbackMock.getInvocations().length).toBe(0);
    });

    it('Scenario 38: Aborted signal during primary execution halts immediately without attempting fallback', async () => {
      const controller = new AbortController();

      primaryMock.queueError({
        category: 'timeout',
        message: 'Aborted during network wait',
        retryable: true,
      });

      // Simulate abortion
      controller.abort();

      await expect(
        router.route(
          {
            messages: [{ role: 'user', content: 'test' }],
            signal: controller.signal,
          },
          { policy: { primaryProvider: 'provider-a', fallbackProviders: ['provider-b'] } }
        )
      ).rejects.toThrow('TIMEOUT');

      expect(primaryMock.getInvocations().length).toBe(0);
      expect(fallbackMock.getInvocations().length).toBe(0); // Never fell back to provider B!
    });
  });

  // =========================================================================
  // 7. Tool Continuity & Mutation Protection Across Provider Switch
  // =========================================================================
  describe('Tool Continuity & Mutation Protection Across Provider Switch', () => {
    let registry: ProviderRegistry;
    let router: AIRouter;
    let primaryMock: MockAIProvider;
    let fallbackMock: MockAIProvider;

    beforeEach(() => {
      registry = new ProviderRegistry();
      registry.clear();

      primaryMock = new MockAIProvider({ id: 'provider-a' });
      fallbackMock = new MockAIProvider({ id: 'provider-b' });

      registry.registerProvider(primaryMock);
      registry.registerProvider(fallbackMock);

      router = new AIRouter(registry);
    });

    it('Scenario 39: In multi-step workflow, previous step tool results are preserved and fed to fallback provider', async () => {
      const planner = new ExecutionPlanner(router);

      // Step 1: Provider A decides to call get_current_time
      primaryMock.queueToolCall('get_current_time', { timeZone: 'Africa/Cairo' });

      // Step 2: Provider A encounters 500 error, Provider B takes over and finishes using the observation
      primaryMock.queueError({ category: 'unavailable', statusCode: 500 });
      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'The current time in Cairo is 10:00 PM.' },
      });

      const engine = new ExecutionEngine(
        ExecutionPolicyManager.getInstance(),
        StepVerifier.getInstance(),
        new LoopGuard(),
        FailureHandler.getInstance(),
        new StepExecutor(),
        planner,
        router
      );

      const context: ExecutionEngineContext = {
        runId: 'run-continuity-test',
        userId: 'user-cont',
        conversationId: 'conv-cont',
        channel: 'flutter',
        userGoal: 'What time is it in Cairo?',
        policy: { maxSteps: 3 },
      };

      const result = await engine.run(context, [{ role: 'user', content: 'What time is it in Cairo?' }]);

      expect(result.status).toBe('completed');
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].toolName).toBe('get_current_time');
      expect(result.steps[0].status).toBe('succeeded');
      expect(result.finalReply).toContain('10:00 PM');
    });

    it('Scenario 40: Provider switch preserves the existing execution state, current step index, and task ID', async () => {
      const planner = new ExecutionPlanner(router);

      // Provider A fails on first step, Provider B takes over
      primaryMock.queueError({ category: 'rate_limit', statusCode: 429 });
      fallbackMock.queueResponse({
        message: { role: 'assistant', content: 'Direct answer from fallback provider.' },
      });

      const engine = new ExecutionEngine(
        ExecutionPolicyManager.getInstance(),
        StepVerifier.getInstance(),
        new LoopGuard(),
        FailureHandler.getInstance(),
        new StepExecutor(),
        planner,
        router
      );

      const context: ExecutionEngineContext = {
        runId: 'run-state-preservation-test',
        userId: 'u_pres',
        conversationId: 'c_pres',
        channel: 'flutter',
        userGoal: 'Hello',
        policy: { maxSteps: 3 },
      };

      const result = await engine.run(context, [{ role: 'user', content: 'Hello' }]);

      expect(result.state.runId).toBe('run-state-preservation-test');
      expect(result.state.taskId).toBe('task_run-stat');
      expect(result.status).toBe('completed');
    });

    it('Scenario 41: Duplicate mutation protection: LoopGuard prevents duplicate tool calls even if provider is switched', async () => {
      const loopGuard = new LoopGuard();

      // Tool 1 executes cleanly
      const initial = loopGuard.check('create_reminder', { title: 'Call Mom' });
      expect(initial.allowed).toBe(true);
      loopGuard.record('create_reminder', { title: 'Call Mom' });

      // Even if provider B subsequently attempts to invoke create_reminder again in the same turn:
      const secondary = loopGuard.check('create_reminder', { title: 'Call Mom' });
      expect(secondary.allowed).toBe(false);
      expect(secondary.isIdempotencyViolation).toBe(true);
    });
  });

  // =========================================================================
  // 8. Configuration & Policy Management
  // =========================================================================
  describe('Configuration & Policy Management', () => {
    it('Scenario 42: Policy manager clamps excessive attempt configurations to HARD_LIMIT_MAX_ATTEMPTS = 2', () => {
      const pm = RoutingPolicyManager.getInstance();
      const resolved = pm.resolvePolicy({ maxProviderAttempts: 10 });

      expect(resolved.maxProviderAttempts).toBe(HARD_LIMIT_MAX_ATTEMPTS);
    });

    it('Scenario 43: Policy manager prohibits fallback on forbidden error categories even if user config specifies them', () => {
      const pm = RoutingPolicyManager.getInstance();
      const resolved = pm.resolvePolicy({
        allowFallbackOn: ['authentication', 'authorization', 'invalid_request', 'timeout'],
      });

      // Authentication, authorization, and invalid_request must be stripped!
      expect(resolved.allowFallbackOn).not.toContain('authentication');
      expect(resolved.allowFallbackOn).not.toContain('authorization');
      expect(resolved.allowFallbackOn).not.toContain('invalid_request');
      expect(resolved.allowFallbackOn).toContain('timeout');
    });

    it('Scenario 44: Throws descriptive AIProviderError when primary provider is not registered in registry', async () => {
      const emptyRegistry = new ProviderRegistry();
      emptyRegistry.clear();
      const router = new AIRouter(emptyRegistry);

      await expect(
        router.route(
          { messages: [{ role: 'user', content: 'test' }] },
          { policy: { primaryProvider: 'non-existent-provider' } }
        )
      ).rejects.toThrow('No available or capable AI provider found for request (primary: non-existent-provider)');
    });
  });
});
