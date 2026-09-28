/**
 * In-Memory Structured Tracer (Phase 8.5)
 *
 * Provides a lightweight, high-performance in-process tracer managing
 * nested spans and recording trace traces into a bounded ring-buffer.
 * Designed to fail open so instrumentation never disrupts user requests.
 */

import { TraceContextManager } from './trace_context';
import { TraceSpanImpl } from './trace_span';
import { Trace, TraceSpan, SpanStatus } from './types';

export interface SpanOptions {
  attributes?: Record<string, unknown>;
  runId?: string;
  stepId?: string;
  toolCallId?: string;
}

export class Tracer {
  private static instance: Tracer;
  private readonly maxTraces: number = 100;
  private readonly completedTraces: Trace[] = [];
  private readonly activeTraceSpans: Map<string, TraceSpanImpl[]> = new Map();

  private constructor() {}

  public static getInstance(): Tracer {
    if (!Tracer.instance) {
      Tracer.instance = new Tracer();
    }
    return Tracer.instance;
  }

  /**
   * Executes an asynchronous operation wrapped within an observable trace span.
   */
  public async withSpan<T>(
    name: string,
    fn: (span: TraceSpanImpl) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    let currentContext = TraceContextManager.getActiveContext();
    if (!currentContext) {
      currentContext = TraceContextManager.createRootContext();
    }

    const span = new TraceSpanImpl(name, currentContext.parentSpanId, options?.attributes);
    const traceId = currentContext.correlationId;

    // Register active span
    try {
      const activeList = this.activeTraceSpans.get(traceId) || [];
      activeList.push(span);
      this.activeTraceSpans.set(traceId, activeList);
    } catch {
      // Fail-open
    }

    const forkedContext = TraceContextManager.forkContext(currentContext, {
      parentSpanId: span.spanId,
      runId: options?.runId ?? currentContext.runId,
      stepId: options?.stepId ?? currentContext.stepId,
      toolCallId: options?.toolCallId ?? currentContext.toolCallId,
    });

    let result: T;
    try {
      result = await TraceContextManager.runWithContext(forkedContext, () => fn(span));
      if (!span.endedAt) {
        span.end('ok');
      }
    } catch (err: any) {
      if (!span.endedAt) {
        if (err.name === 'AbortError' || err.message?.includes('cancelled')) {
          span.end('cancelled');
        } else {
          span.recordError(err);
          span.end('error');
        }
      }
      this.finalizeSpan(traceId, span, currentContext.channel);
      throw err;
    }

    this.finalizeSpan(traceId, span, currentContext.channel);
    return result;
  }

  /**
   * Finalizes a completed span and archives trace if root span ended.
   */
  private finalizeSpan(traceId: string, span: TraceSpanImpl, channel?: string): void {
    try {
      const activeList = this.activeTraceSpans.get(traceId);
      if (!activeList) return;

      // If this was the root span (no parent), package the full trace into ring buffer
      if (!span.parentSpanId) {
        const fullTrace: Trace = {
          traceId,
          rootSpanId: span.spanId,
          spans: activeList.map((s) => s.toJSON()),
          startedAt: span.startedAt,
          endedAt: span.endedAt || Date.now(),
          durationMs: span.durationMs || (Date.now() - span.startedAt),
          channel,
          status: span.status,
        };

        if (this.completedTraces.length >= this.maxTraces) {
          this.completedTraces.shift();
        }
        this.completedTraces.push(fullTrace);
        this.activeTraceSpans.delete(traceId);
      }
    } catch {
      // Fail-open: tracing must never throw
    }
  }

  /**
   * Retrieves completed traces from bounded memory buffer.
   */
  public getCompletedTraces(): Trace[] {
    return [...this.completedTraces];
  }

  /**
   * Finds a trace by its correlationId.
   */
  public findTraceByCorrelationId(correlationId: string): Trace | undefined {
    return this.completedTraces.find((t) => t.traceId === correlationId);
  }

  /**
   * Clears trace buffer (primarily for unit test isolation).
   */
  public clearCompletedTraces(): void {
    this.completedTraces.length = 0;
    this.activeTraceSpans.clear();
  }
}
