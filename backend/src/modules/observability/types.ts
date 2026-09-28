/**
 * Observability & Tracing Types (Phase 8.5)
 *
 * Defines core contracts for distributed-ready in-process structured tracing,
 * trace contexts, spans, low-cardinality metrics, and unified error categories.
 */

export interface TraceContext {
  /** Unique ID per external HTTP / Webhook request lifecycle */
  correlationId: string;
  /** Unique ID per agent pipeline execution */
  runId?: string;
  /** Multi-step execution step identifier */
  stepId?: string;
  /** Specific tool invocation identifier */
  toolCallId?: string;
  /** Current active span ID in call stack */
  parentSpanId?: string;
  /** Inbound channel (e.g. 'whatsapp', 'flutter', 'cron') */
  channel?: string;
  /** Internal user reference (redacted/minimized from public logs) */
  userId?: string;
  /** Internal conversation reference (redacted/minimized from public logs) */
  conversationId?: string;
}

export type SpanStatus = 'ok' | 'error' | 'cancelled';

export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: TraceEvent[];
}

export interface Trace {
  traceId: string; // Typically equal to correlationId
  rootSpanId: string;
  spans: TraceSpan[];
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  channel?: string;
  status: SpanStatus;
}

export type UnifiedErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'provider_unavailable'
  | 'tool_failure'
  | 'safety_block'
  | 'confirmation_required'
  | 'context_overflow'
  | 'configuration'
  | 'internal'
  | 'unknown';

export type MetricType = 'counter' | 'histogram' | 'gauge';

export interface MetricTagDefinition {
  provider?: string;
  model?: string;
  channel?: string;
  status?: string;
  tool?: string;
  errorCategory?: UnifiedErrorCategory | string;
  stage?: string;
  strategy?: string;
  candidateType?: string;
  [key: string]: string | undefined;
}

export interface HistogramSnapshot {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptimeSeconds: number;
  counters: Record<string, { value: number; tags?: Record<string, string> }>;
  histograms: Record<string, HistogramSnapshot>;
  gauges: Record<string, number>;
}

export interface SystemHealthSnapshot {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  requests: {
    total: number;
    success: number;
    error: number;
    cancelled: number;
    errorRate: number;
  };
  ai: {
    requests: number;
    failures: number;
    fallbacks: number;
    tokensTotal: number;
    providerHealth: Record<string, { status: string; circuitBreaker: string }>;
  };
  agent: {
    runs: number;
    steps: number;
    partial: number;
    failed: number;
  };
  tools: {
    calls: number;
    failures: number;
    confirmations: number;
  };
  memory: {
    retrievalCount: number;
    selectedCount: number;
    blockedCount: number;
  };
  proactive: {
    candidates: number;
    sent: number;
    blocked: number;
  };
}
