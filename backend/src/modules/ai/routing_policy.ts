/**
 * Routing Policy & Fallback Rules (Phase 8.4)
 *
 * Governs provider selection, bounded fallback rules, and error category gating.
 * Enforces hard ceiling of MAX_PROVIDER_ATTEMPTS = 2 and prohibits blind fallback
 * on non-retryable configuration or schema errors.
 */

import { ProviderErrorCategory } from './provider_error';
import { config } from '../../config/env';

export interface RoutingPolicy {
  primaryProvider: string;
  fallbackProviders: string[];
  maxProviderAttempts: number;
  allowFallbackOn: ProviderErrorCategory[];
  providerTimeoutMs: number;
}

export const HARD_LIMIT_MAX_ATTEMPTS = 2;

export const DEFAULT_ALLOW_FALLBACK_ON: ProviderErrorCategory[] = [
  'timeout',
  'network',
  'rate_limit',
  'unavailable',
  'model_unavailable',
  'malformed_response',
];

export const FORBIDDEN_FALLBACK_CATEGORIES: ReadonlyArray<ProviderErrorCategory> = [
  'authentication',
  'authorization',
  'invalid_request',
  'context_overflow',
];

export class RoutingPolicyManager {
  private static instance: RoutingPolicyManager;

  public static getInstance(): RoutingPolicyManager {
    if (!RoutingPolicyManager.instance) {
      RoutingPolicyManager.instance = new RoutingPolicyManager();
    }
    return RoutingPolicyManager.instance;
  }

  public getDefaultPolicy(): RoutingPolicy {
    const primary = config.ai?.primaryProvider || 'groq';
    const fallback = config.ai?.fallbackProvider ? [config.ai.fallbackProvider] : [];
    const maxAttempts = Math.min(
      HARD_LIMIT_MAX_ATTEMPTS,
      Math.max(1, config.ai?.maxProviderAttempts ?? 2)
    );
    const timeoutMs = config.ai?.providerTimeoutMs || 30000;

    return {
      primaryProvider: primary,
      fallbackProviders: fallback,
      maxProviderAttempts: maxAttempts,
      allowFallbackOn: [...DEFAULT_ALLOW_FALLBACK_ON],
      providerTimeoutMs: timeoutMs,
    };
  }

  public resolvePolicy(custom?: Partial<RoutingPolicy>): RoutingPolicy {
    const defaultPolicy = this.getDefaultPolicy();
    if (!custom) return defaultPolicy;

    // Hard ceiling clamping: never allow more than 2 attempts in the same request
    const requestedAttempts = custom.maxProviderAttempts ?? defaultPolicy.maxProviderAttempts;
    const clampedAttempts = Math.min(HARD_LIMIT_MAX_ATTEMPTS, Math.max(1, requestedAttempts));

    // Filter out forbidden fallback categories even if requested
    const requestedFallbackCategories = custom.allowFallbackOn || defaultPolicy.allowFallbackOn;
    const sanitizedCategories = requestedFallbackCategories.filter(
      (cat) => !FORBIDDEN_FALLBACK_CATEGORIES.includes(cat)
    );

    return {
      primaryProvider: custom.primaryProvider || defaultPolicy.primaryProvider,
      fallbackProviders: custom.fallbackProviders !== undefined
        ? custom.fallbackProviders.filter((p) => p !== (custom.primaryProvider || defaultPolicy.primaryProvider))
        : defaultPolicy.fallbackProviders,
      maxProviderAttempts: clampedAttempts,
      allowFallbackOn: sanitizedCategories,
      providerTimeoutMs: custom.providerTimeoutMs || defaultPolicy.providerTimeoutMs,
    };
  }

  public isFallbackAllowed(category: ProviderErrorCategory, policy: RoutingPolicy): boolean {
    if (FORBIDDEN_FALLBACK_CATEGORIES.includes(category)) {
      return false;
    }
    return policy.allowFallbackOn.includes(category);
  }
}
