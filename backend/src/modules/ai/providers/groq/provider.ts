/**
 * Groq AI Provider Adapter (Phase 8.4)
 *
 * Implements the AIProvider contract for Groq LPU engine.
 * Connects normalized AIRequests to Groq Chat Completions, integrates key pooling,
 * handles vision routing, and maps outputs/errors to normalized AIResponse/AIProviderError.
 */

import { config } from '../../../../config/env';
import { logger } from '../../../../core/logger';
import { AIProvider } from '../../provider';
import {
  AICapability,
  AIModelProfile,
  AIRequest,
  AIResponse,
} from '../../types';
import { ProviderHealth, CircuitBreaker } from '../../health';
import { AIProviderError } from '../../provider_error';
import { GroqMapper } from './mapper';
import { GroqProvider } from '../../../groq/groq.provider';

export class GroqAIProvider implements AIProvider {
  public readonly id = 'groq';
  private circuitBreaker: CircuitBreaker;
  private underlyingGroq: GroqProvider;
  private modelProfiles: AIModelProfile[];

  constructor(
    groqProvider?: GroqProvider,
    circuitBreaker?: CircuitBreaker
  ) {
    this.underlyingGroq = groqProvider || new GroqProvider();
    this.circuitBreaker = circuitBreaker || new CircuitBreaker(this.id);

    this.modelProfiles = [
      {
        providerId: this.id,
        modelId: config.groq.primaryModel,
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: false,
        capabilities: ['tools', 'system_instruction'],
        isDefault: true,
      },
      {
        providerId: this.id,
        modelId: config.groq.fallbackModel,
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: false,
        capabilities: ['tools', 'system_instruction'],
      },
      {
        providerId: this.id,
        modelId: 'qwen/qwen3.8-27b',
        contextWindow: 32768,
        maxOutputTokens: 2048,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: false,
        capabilities: ['tools', 'vision', 'system_instruction'],
      },
    ];
  }

  public getDefaultModel(): string {
    return config.groq.primaryModel;
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

  public getUnderlyingProvider(): GroqProvider {
    return this.underlyingGroq;
  }

  /**
   * Executes AI generation using Groq LPU engine.
   */
  public async generate(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    // 1. Check Circuit Breaker
    if (!this.circuitBreaker.canExecute()) {
      const health = this.circuitBreaker.getHealth();
      throw new AIProviderError({
        providerId: this.id,
        category: 'unavailable',
        message: `Provider [${this.id}] circuit breaker is OPEN (${health.details || 'cooldown active'})`,
        retryable: true,
      });
    }

    // 2. Cancellation Check
    if (request.signal?.aborted) {
      throw new AIProviderError({
        providerId: this.id,
        category: 'timeout',
        message: 'Request aborted by caller signal prior to dispatch',
        retryable: false,
      });
    }

    // 3. Resolve Target Model
    const requestedModel = request.model || this.getDefaultModel();

    // Detect image in messages to route to vision model if needed
    const hasImage = request.messages.some((m) =>
      Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url')
    );
    const targetModel = hasImage ? 'qwen/qwen3.8-27b' : requestedModel;

    // 4. Check for Test Mock Mode
    if (config.groq.isMockMode) {
      try {
        const mockGroqMessages = request.messages.map((m) => ({
          role: m.role as any,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          name: m.name,
          tool_call_id: m.toolCallId,
        }));

        const mockRes = this.underlyingGroq.generateMockResponse(mockGroqMessages, undefined, hasImage);
        const latencyMs = Date.now() - startTime;

        this.circuitBreaker.recordSuccess();

        const toolCalls = (mockRes.functionCalls || []).map((fc, idx) => ({
          id: fc.id || `tc_mock_${idx}_${Date.now()}`,
          type: 'function' as const,
          function: {
            name: fc.name,
            arguments: fc.args,
            rawArguments: JSON.stringify(fc.args),
          },
        }));

        return {
          providerId: this.id,
          model: targetModel,
          message: {
            role: 'assistant',
            content: mockRes.text || '',
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          toolCalls,
          finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          usage: mockRes.usage || { promptTokens: 30, completionTokens: 40, totalTokens: 70 },
          latencyMs,
          requestId: `mock_${Date.now()}`,
        };
      } catch (mockErr: any) {
        const provErr = GroqMapper.toProviderError(mockErr, this.id);
        this.circuitBreaker.recordFailure(provErr.retryable);
        throw provErr;
      }
    }

    // 5. Build Request Payload
    const payload = GroqMapper.toGroqPayload(request, targetModel);

    // 6. Execute Dispatch with Key Pool Rotation & Timeout
    const timeoutMs = request.timeoutMs || config.ai?.providerTimeoutMs || 30000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    // If caller provided an external AbortSignal, chain it
    if (request.signal) {
      request.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const activeKey = (this.underlyingGroq as any).getNextHealthyApiKey
        ? (this.underlyingGroq as any).getNextHealthyApiKey()
        : config.groq.apiKey;

      if (!activeKey) {
        throw new AIProviderError({
          providerId: this.id,
          category: 'authentication',
          message: 'No Groq API key available in key pool',
          retryable: false,
          statusCode: 401,
        });
      }

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutTimer);
      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw AIProviderError.classify(this.id, res.status, errorText);
      }

      const data = await res.json();
      const response = GroqMapper.fromGroqResponse(data, this.id, targetModel, latencyMs);

      this.circuitBreaker.recordSuccess();
      return response;
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      const latencyMs = Date.now() - startTime;

      let providerError: AIProviderError;
      if (err.name === 'AbortError' || controller.signal.aborted) {
        providerError = new AIProviderError({
          providerId: this.id,
          category: 'timeout',
          message: `Groq request timed out after ${timeoutMs}ms or was aborted`,
          retryable: true,
          statusCode: 408,
          originalError: err,
        });
      } else {
        providerError = GroqMapper.toProviderError(err, this.id);
      }

      this.circuitBreaker.recordFailure(providerError.retryable);
      logger.warn(`Groq provider request failed [${providerError.category}]: ${providerError.message}`, {
        model: targetModel,
        latencyMs,
        retryable: providerError.retryable,
      });

      throw providerError;
    }
  }
}
