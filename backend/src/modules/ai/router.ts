/**
 * Resilient AI Router (Phase 8.4)
 *
 * Coordinates intelligent, policy-governed routing across AI providers:
 * - Deterministic primary provider selection
 * - Capability matching (tools, vision, streaming)
 * - Circuit breaker health evaluation
 * - Bounded fallback (MAX_PROVIDER_ATTEMPTS = 2)
 * - Token budget preservation across fallback hops
 * - Terminal cancellation handling via AbortSignal
 * - Structured, secure telemetry and error classification
 */

import { logger } from '../../core/logger';
import { AIRequest, AIResponse, AICapability } from './types';
import { AIProvider } from './provider';
import { ProviderRegistry } from './provider_registry';
import { RoutingPolicy, RoutingPolicyManager, HARD_LIMIT_MAX_ATTEMPTS } from './routing_policy';
import { AIProviderError } from './provider_error';
import { TokenBudgetManager, TokenCounter } from '../context';
import { MetricsCollector, Tracer } from '../observability';

export interface AIRouterRunOptions {
  policy?: Partial<RoutingPolicy>;
  remainingTokenBudget?: number;
}

export class AIRouter {
  private static instance: AIRouter;

  constructor(
    private registry: ProviderRegistry = ProviderRegistry.getInstance(),
    private policyManager: RoutingPolicyManager = RoutingPolicyManager.getInstance(),
    private tokenBudgetManager: TokenBudgetManager = TokenBudgetManager.getInstance()
  ) {}

  public static getInstance(): AIRouter {
    if (!AIRouter.instance) {
      AIRouter.instance = new AIRouter();
    }
    return AIRouter.instance;
  }

  public getRegistry(): ProviderRegistry {
    return this.registry;
  }

  public getPolicyManager(): RoutingPolicyManager {
    return this.policyManager;
  }

  public getTokenBudgetManager(): TokenBudgetManager {
    return this.tokenBudgetManager;
  }

  public resolveActiveModelId(requestedModel?: string): string {
    const policy = this.policyManager.getDefaultPolicy();
    const primary = this.registry.getProvider(policy.primaryProvider);
    return requestedModel || primary?.getDefaultModel() || 'openai/gpt-oss-120b';
  }

  /**
   * Routes an AIRequest through the active policy, attempting the primary provider
   * and falling back to secondary providers if permitted by retryability rules.
   */
  public async route(
    request: AIRequest,
    options?: AIRouterRunOptions
  ): Promise<AIResponse> {
    const policy = this.policyManager.resolvePolicy(options?.policy);

    // 0. Cancellation Check: Terminal abort, never dispatch or fallback after cancellation
    if (request.signal?.aborted) {
      logger.warn('AIRouter request cancelled by AbortSignal prior to dispatch');
      throw new AIProviderError({
        providerId: policy.primaryProvider,
        category: 'timeout',
        message: 'Operation cancelled by caller AbortSignal',
        retryable: false,
      });
    }

    const candidateProviders = this.resolveCandidateProviders(request, policy);

    if (candidateProviders.length === 0) {
      throw new AIProviderError({
        providerId: policy.primaryProvider,
        category: 'unavailable',
        message: `No available or capable AI provider found for request (primary: ${policy.primaryProvider})`,
        retryable: false,
      });
    }

    let lastError: AIProviderError | undefined;
    let accumulatedTokens = 0;
    const maxAttempts = Math.min(policy.maxProviderAttempts, candidateProviders.length, HARD_LIMIT_MAX_ATTEMPTS);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const provider = candidateProviders[attempt];
      const isFallback = attempt > 0;

      // 1. Cancellation Check: Terminal abort, never fallback after cancellation
      if (request.signal?.aborted) {
        logger.warn(`AIRouter request cancelled by AbortSignal prior to attempt ${attempt + 1}`);
        throw new AIProviderError({
          providerId: provider.id,
          category: 'timeout',
          message: 'Operation cancelled by caller AbortSignal',
          retryable: false,
        });
      }

      // 2. Circuit Breaker Pre-flight Check
      const health = provider.health();
      if (health.circuitState === 'open') {
        logger.warn(`Skipping provider [${provider.id}]: circuit breaker is OPEN (${health.details})`);
        continue;
      }

      // 3. Model & Context Window Verification
      const modelProfiles = provider.getModelProfiles();
      const targetModelId = request.model || provider.getDefaultModel();
      const targetProfile = modelProfiles.find((p) => p.modelId === targetModelId) || modelProfiles[0];

      if (targetProfile) {
        const estimatedPromptTokens = this.estimateRequestTokens(request);
        if (estimatedPromptTokens > targetProfile.contextWindow) {
          logger.warn(`Context overflow detected for provider [${provider.id}] model [${targetProfile.modelId}] (${estimatedPromptTokens} > ${targetProfile.contextWindow})`);
          throw new AIProviderError({
            providerId: provider.id,
            category: 'context_overflow',
            message: `Context size (${estimatedPromptTokens} tokens) exceeds model limit (${targetProfile.contextWindow})`,
            retryable: false,
          });
        }
      }

      // 4. Adjust Request Bounded by Remaining Token Budget
      const currentRequest: AIRequest = {
        ...request,
        maxTokens: options?.remainingTokenBudget !== undefined
          ? Math.min(request.maxTokens ?? 2048, Math.max(128, options.remainingTokenBudget - accumulatedTokens))
          : request.maxTokens,
      };

      const attemptStartTime = Date.now();
      const metrics = MetricsCollector.getInstance();
      metrics.increment('craft.ai.requests', 1, { provider: provider.id, model: targetProfile?.modelId });

      logger.info(`AIRouter dispatching to provider [${provider.id}] (attempt ${attempt + 1}/${maxAttempts})`, {
        providerId: provider.id,
        isFallback,
        runId: request.metadata?.runId,
        channel: request.metadata?.channel,
      });

      try {
        const response = await provider.generate(currentRequest);
        const latencyMs = Date.now() - attemptStartTime;

        // Track accumulated tokens across successful call
        if (response.usage) {
          accumulatedTokens += response.usage.totalTokens;
          metrics.increment('craft.ai.tokens.prompt', response.usage.promptTokens, { provider: provider.id });
          metrics.increment('craft.ai.tokens.completion', response.usage.completionTokens, { provider: provider.id });
          metrics.increment('craft.ai.tokens.total', response.usage.totalTokens, { provider: provider.id });
        }
        metrics.observe('craft.ai.latency', latencyMs, { provider: provider.id, status: 'success' });

        // Structured audit logging
        logger.info(`AIRouter invocation succeeded on provider [${provider.id}] in ${latencyMs}ms`, {
          providerId: provider.id,
          modelId: response.model,
          attempt: attempt + 1,
          status: 'success',
          latencyMs,
          totalTokens: response.usage?.totalTokens || 0,
          fallbackUsed: isFallback,
        });

        return response;
      } catch (err: any) {
        const latencyMs = Date.now() - attemptStartTime;
        const providerError = AIProviderError.classify(provider.id, err);
        lastError = providerError;

        metrics.increment('craft.ai.failures', 1, { provider: provider.id, errorCategory: providerError.category });
        metrics.observe('craft.ai.latency', latencyMs, { provider: provider.id, status: 'error' });

        logger.warn(`AIRouter attempt ${attempt + 1} on provider [${provider.id}] failed: [${providerError.category}] ${providerError.message}`, {
          providerId: provider.id,
          category: providerError.category,
          retryable: providerError.retryable,
          latencyMs,
          attempt: attempt + 1,
        });

        // 5. Hard Stop on AbortSignal
        if (request.signal?.aborted) {
          throw new AIProviderError({
            providerId: provider.id,
            category: 'timeout',
            message: 'Execution aborted during provider call',
            retryable: false,
            originalError: err,
          });
        }

        // 6. Check if Fallback is Allowed for this Error Category
        const canFallback =
          attempt + 1 < maxAttempts &&
          providerError.retryable &&
          this.policyManager.isFallbackAllowed(providerError.category, policy);

        if (!canFallback) {
          logger.info(`AIRouter halting: fallback not permitted for category [${providerError.category}] or max attempts reached`);
          throw providerError;
        }

        metrics.increment('craft.ai.fallbacks', 1, { provider: provider.id, errorCategory: providerError.category });
        logger.info(`AIRouter initiating fallback from [${provider.id}] after [${providerError.category}] failure...`);
      }
    }

    throw lastError || new AIProviderError({
      providerId: policy.primaryProvider,
      category: 'unavailable',
      message: 'All configured AI providers failed',
      retryable: false,
    });
  }

  /**
   * Identifies eligible providers matching required capabilities (tools, vision).
   */
  private resolveCandidateProviders(request: AIRequest, policy: RoutingPolicy): AIProvider[] {
    const requiredCapabilities: AICapability[] = [];
    if (request.tools && request.tools.length > 0) {
      requiredCapabilities.push('tools');
    }
    const hasImage = request.messages.some((m) =>
      Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url')
    );
    if (hasImage) {
      requiredCapabilities.push('vision');
    }

    let candidateIds = [policy.primaryProvider, ...policy.fallbackProviders];
    const registered = this.registry.listProviders();
    const hasAnyConfigured = candidateIds.some((id) => this.registry.hasProvider(id));
    if (!hasAnyConfigured && registered.length > 0) {
      candidateIds = registered.map((p) => p.id);
    }

    const uniqueIds = Array.from(new Set(candidateIds));
    const eligibleProviders: AIProvider[] = [];

    for (const id of uniqueIds) {
      const provider = this.registry.getProvider(id);
      if (!provider) continue;

      // Capability matching check
      const supportsAllRequired = requiredCapabilities.every((cap) => provider.supports(cap));
      if (!supportsAllRequired) {
        logger.debug(`Provider [${provider.id}] does not support required capabilities: ${requiredCapabilities.join(', ')}`);
        continue;
      }

      eligibleProviders.push(provider);
    }

    return eligibleProviders;
  }

  /**
   * Helper to estimate token consumption for pre-flight context window bounding.
   */
  private estimateRequestTokens(request: AIRequest): number {
    let totalChars = 0;
    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') totalChars += part.text.length;
        }
      }
    }
    return TokenCounter.countTokens(totalChars > 0 ? 'x'.repeat(totalChars) : '');
  }
}
