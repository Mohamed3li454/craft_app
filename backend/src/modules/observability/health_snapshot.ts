/**
 * System Health Snapshot (Phase 8.5)
 *
 * Compiles a real-time operational health snapshot combining metrics,
 * AI provider circuit breaker states, and error rates without exposing secrets.
 */

import { MetricsCollector } from './metrics';
import { SystemHealthSnapshot } from './types';
import { ProviderRegistry } from '../ai/provider_registry';

export class HealthSnapshotService {
  private static instance: HealthSnapshotService;
  private readonly startTime: number = Date.now();
  private readonly metrics: MetricsCollector = MetricsCollector.getInstance();
  private readonly registry: ProviderRegistry = ProviderRegistry.getInstance();

  private constructor() {}

  public static getInstance(): HealthSnapshotService {
    if (!HealthSnapshotService.instance) {
      HealthSnapshotService.instance = new HealthSnapshotService();
    }
    return HealthSnapshotService.instance;
  }

  /**
   * Generates a safe, consolidated health overview for monitoring endpoints.
   */
  public getSnapshot(): SystemHealthSnapshot {
    const totalRequests = this.metrics.getCounter('craft.requests.total');
    const successRequests = this.metrics.getCounter('craft.requests.success');
    const errorRequests = this.metrics.getCounter('craft.requests.error');
    const cancelledRequests = this.metrics.getCounter('craft.requests.cancelled');
    const errorRate = totalRequests > 0 ? Math.round((errorRequests / totalRequests) * 1000) / 10 : 0;

    // AI Provider Health
    const providerHealth: Record<string, { status: string; circuitBreaker: string }> = {};
    for (const provider of this.registry.listProviders()) {
      const h = provider.health();
      providerHealth[provider.id] = {
        status: h.status,
        circuitBreaker: h.circuitState,
      };
    }

    // Determine aggregate system status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const hasOpenCircuit = Object.values(providerHealth).some((p) => p.circuitBreaker === 'open');
    if (errorRate > 25 || hasOpenCircuit) {
      status = 'degraded';
    }
    if (errorRate > 75) {
      status = 'unhealthy';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      requests: {
        total: totalRequests,
        success: successRequests,
        error: errorRequests,
        cancelled: cancelledRequests,
        errorRate,
      },
      ai: {
        requests: this.metrics.getCounter('craft.ai.requests'),
        failures: this.metrics.getCounter('craft.ai.failures'),
        fallbacks: this.metrics.getCounter('craft.ai.fallbacks'),
        tokensTotal: this.metrics.getCounter('craft.ai.tokens.total'),
        providerHealth,
      },
      agent: {
        runs: this.metrics.getCounter('craft.agent.runs'),
        steps: this.metrics.getCounter('craft.agent.steps'),
        partial: this.metrics.getCounter('craft.agent.partial'),
        failed: this.metrics.getCounter('craft.agent.failed'),
      },
      tools: {
        calls: this.metrics.getCounter('craft.tool.calls'),
        failures: this.metrics.getCounter('craft.tool.failures'),
        confirmations: this.metrics.getCounter('craft.tool.confirmations'),
      },
      memory: {
        retrievalCount: this.metrics.getCounter('craft.memory.retrieval'),
        selectedCount: this.metrics.getCounter('craft.memory.selected'),
        blockedCount: this.metrics.getCounter('craft.memory.blocked'),
      },
      proactive: {
        candidates: this.metrics.getCounter('craft.proactive.candidates'),
        sent: this.metrics.getCounter('craft.proactive.sent'),
        blocked: this.metrics.getCounter('craft.proactive.blocked'),
      },
    };
  }
}
