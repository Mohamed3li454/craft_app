/**
 * AI Provider Health & Bounded Circuit Breaker (Phase 8.4)
 *
 * Implements deterministic, in-memory circuit breaking and health state tracking
 * without external infrastructure or background dependencies.
 */

import { logger } from '../../core/logger';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  lastCheckedAt: Date;
  consecutiveFailures: number;
  circuitState: CircuitBreakerState;
  details?: string;
}

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Consecutive failures before opening (default: 3)
  cooldownMs?: number;       // Time in open state before half-open probe (default: 30,000ms)
  successThreshold?: number; // Successes in half-open before closing (default: 1)
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly successThreshold: number;

  constructor(
    public readonly providerId: string,
    options?: CircuitBreakerOptions
  ) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 30000;
    this.successThreshold = options?.successThreshold ?? 1;
  }

  public getState(): CircuitBreakerState {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'half-open';
        this.consecutiveSuccesses = 0;
        logger.info(`Circuit breaker for provider [${this.providerId}] transitioned from OPEN to HALF-OPEN (probe allowed)`);
      }
    }
    return this.state;
  }

  public canExecute(): boolean {
    const currentState = this.getState();
    return currentState === 'closed' || currentState === 'half-open';
  }

  public recordSuccess(): void {
    if (this.state === 'half-open') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.state = 'closed';
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        logger.info(`Circuit breaker for provider [${this.providerId}] recovered to CLOSED (healthy)`);
      }
    } else if (this.state === 'closed') {
      this.consecutiveFailures = 0;
    }
  }

  public recordFailure(isRetryable = true): void {
    // Non-retryable errors (e.g. invalid user input) do NOT trip the circuit breaker
    if (!isRetryable) {
      return;
    }

    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;

    if (this.state === 'half-open') {
      this.state = 'open';
      this.consecutiveSuccesses = 0;
      logger.warn(`Circuit breaker probe failed for provider [${this.providerId}]: returning to OPEN`);
    } else if (this.state === 'closed' && this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      logger.warn(
        `Circuit breaker for provider [${this.providerId}] tripped to OPEN after ${this.consecutiveFailures} consecutive failures (cooldown: ${Math.round(this.cooldownMs / 1000)}s)`
      );
    }
  }

  public reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = 0;
  }

  public getHealth(): ProviderHealth {
    const currentState = this.getState();
    let status: ProviderHealthStatus = 'healthy';

    if (currentState === 'open') {
      status = 'unavailable';
    } else if (currentState === 'half-open' || this.consecutiveFailures > 0) {
      status = 'degraded';
    }

    return {
      status,
      lastCheckedAt: new Date(),
      consecutiveFailures: this.consecutiveFailures,
      circuitState: currentState,
      details:
        currentState === 'open'
          ? `Circuit open (cooldown remaining: ${Math.max(0, Math.round((this.lastFailureTime + this.cooldownMs - Date.now()) / 1000))}s)`
          : undefined,
    };
  }
}
