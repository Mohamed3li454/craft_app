/**
 * Mock AI Provider (Phase 8.4)
 *
 * Deterministic in-memory AI provider designed for testing routing policies,
 * failure recovery, circuit breaking, fallback cascades, tool calls, and token budgeting.
 */

import { AIProvider } from '../../provider';
import {
  AICapability,
  AIModelProfile,
  AIRequest,
  AIResponse,
  AIToolCall,
  AIFinishReason,
  AIUsage,
} from '../../types';
import { ProviderHealth, CircuitBreaker } from '../../health';
import { AIProviderError, ProviderErrorCategory } from '../../provider_error';

export interface MockProviderOptions {
  id?: string;
  defaultModel?: string;
  failureThreshold?: number;
  cooldownMs?: number;
}

export class MockAIProvider implements AIProvider {
  public readonly id: string;
  private defaultModel: string;
  private circuitBreaker: CircuitBreaker;
  private modelProfiles: AIModelProfile[];

  // Controllable test hooks
  private queuedActions: Array<
    | { type: 'response'; response: AIResponse }
    | { type: 'error'; error: AIProviderError }
  > = [];
  private simulatedLatencyMs = 0;
  private invocations: AIRequest[] = [];

  constructor(options?: MockProviderOptions) {
    this.id = options?.id || 'mock';
    this.defaultModel = options?.defaultModel || 'mock-model-v1';
    this.circuitBreaker = new CircuitBreaker(this.id, {
      failureThreshold: options?.failureThreshold ?? 3,
      cooldownMs: options?.cooldownMs ?? 30000,
    });

    this.modelProfiles = [
      {
        providerId: this.id,
        modelId: this.defaultModel,
        contextWindow: 16384,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
        capabilities: ['tools', 'vision', 'audio_transcription', 'streaming', 'system_instruction'],
        isDefault: true,
      },
    ];
  }

  public getDefaultModel(): string {
    return this.defaultModel;
  }

  public getModelProfiles(): AIModelProfile[] {
    return this.modelProfiles;
  }

  public supports(capability: AICapability): boolean {
    return this.modelProfiles.some((p) => p.capabilities.includes(capability));
  }

  public health(): ProviderHealth {
    return this.circuitBreaker.getHealth();
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public getInvocations(): AIRequest[] {
    return [...this.invocations];
  }

  public clearInvocations(): void {
    this.invocations = [];
  }

  public setSimulatedLatency(ms: number): void {
    this.simulatedLatencyMs = ms;
  }

  public queueResponse(response: Partial<AIResponse>): void {
    const fullResponse: AIResponse = {
      providerId: this.id,
      model: response.model || this.defaultModel,
      message: response.message || {
        role: 'assistant',
        content: 'Mock generated reply',
      },
      toolCalls: response.toolCalls || [],
      finishReason: response.finishReason || (response.toolCalls && response.toolCalls.length > 0 ? 'tool_calls' : 'stop'),
      usage: response.usage || { promptTokens: 25, completionTokens: 35, totalTokens: 60 },
      latencyMs: response.latencyMs ?? 5,
      requestId: response.requestId || `mock_req_${Date.now()}`,
    };
    this.queuedActions.push({ type: 'response', response: fullResponse });
  }

  public queueToolCall(name: string, args: Record<string, any>): void {
    const toolCall: AIToolCall = {
      id: `tc_mock_${Date.now()}`,
      type: 'function',
      function: {
        name,
        arguments: args,
        rawArguments: JSON.stringify(args),
      },
    };

    this.queueResponse({
      toolCalls: [toolCall],
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [toolCall],
      },
      finishReason: 'tool_calls',
    });
  }

  public queueError(params: {
    category: ProviderErrorCategory;
    message?: string;
    statusCode?: number;
    retryable?: boolean;
  }): void {
    const err = new AIProviderError({
      providerId: this.id,
      category: params.category,
      message: params.message || `Simulated ${params.category} error on ${this.id}`,
      retryable: params.retryable ?? (params.category !== 'authentication' && params.category !== 'authorization' && params.category !== 'invalid_request'),
      statusCode: params.statusCode,
    });
    this.queuedActions.push({ type: 'error', error: err });
  }

  public reset(): void {
    this.queuedActions = [];
    this.invocations = [];
    this.simulatedLatencyMs = 0;
    this.circuitBreaker.reset();
  }

  public async generate(request: AIRequest): Promise<AIResponse> {
    this.invocations.push(request);

    // 1. Check Circuit Breaker
    if (!this.circuitBreaker.canExecute()) {
      throw new AIProviderError({
        providerId: this.id,
        category: 'unavailable',
        message: `Provider [${this.id}] circuit breaker is OPEN`,
        retryable: true,
      });
    }

    // 2. Cancellation Check
    if (request.signal?.aborted) {
      throw new AIProviderError({
        providerId: this.id,
        category: 'timeout',
        message: 'Request aborted by caller signal',
        retryable: false,
      });
    }

    // 3. Simulate latency if requested
    if (this.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedLatencyMs));
    }

    // 4. Return queued action if any (in strict FIFO order)
    if (this.queuedActions.length > 0) {
      const nextAction = this.queuedActions.shift()!;
      if (nextAction.type === 'error') {
        this.circuitBreaker.recordFailure(nextAction.error.retryable);
        throw nextAction.error;
      }
      this.circuitBreaker.recordSuccess();
      return nextAction.response;
    }

    // 5. Return default fallback mock response if no queued actions
    const lastMsg = request.messages[request.messages.length - 1];
    const prompt = typeof lastMsg?.content === 'string' ? lastMsg.content : 'mock';

    const response: AIResponse = {
      providerId: this.id,
      model: request.model || this.defaultModel,
      message: {
        role: 'assistant',
        content: `Mock answer for: "${prompt.slice(0, 30)}"`,
      },
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50 },
      latencyMs: 5,
      requestId: `mock_${Date.now()}`,
    };

    this.circuitBreaker.recordSuccess();
    return response;
  }
}
