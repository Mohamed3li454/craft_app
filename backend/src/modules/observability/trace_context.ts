/**
 * Trace Context Manager (Phase 8.5)
 *
 * Implements asynchronous context propagation across async boundaries using
 * Node.js AsyncLocalStorage. Ensures correlationId and execution IDs flow
 * transparently across Webhooks, Pipeline stages, AIRouter, and Tools.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';
import { TraceContext } from './types';

export class TraceContextManager {
  private static readonly storage = new AsyncLocalStorage<TraceContext>();

  /**
   * Creates a new root context for an inbound request.
   */
  public static createRootContext(options?: {
    correlationId?: string;
    channel?: string;
    userId?: string;
    conversationId?: string;
  }): TraceContext {
    return {
      correlationId: options?.correlationId || uuidv4(),
      channel: options?.channel || 'unknown',
      userId: options?.userId,
      conversationId: options?.conversationId,
    };
  }

  /**
   * Derives a child context inheriting parent IDs with scoped overrides.
   */
  public static forkContext(
    parent: TraceContext,
    updates: Partial<TraceContext>
  ): TraceContext {
    return {
      correlationId: parent.correlationId,
      runId: updates.runId ?? parent.runId,
      stepId: updates.stepId ?? parent.stepId,
      toolCallId: updates.toolCallId ?? parent.toolCallId,
      parentSpanId: updates.parentSpanId ?? parent.parentSpanId,
      channel: updates.channel ?? parent.channel,
      userId: updates.userId ?? parent.userId,
      conversationId: updates.conversationId ?? parent.conversationId,
    };
  }

  /**
   * Runs an asynchronous callback within the given TraceContext.
   */
  public static runWithContext<T>(
    context: TraceContext,
    fn: () => T | Promise<T>
  ): T | Promise<T> {
    return this.storage.run(context, fn);
  }

  /**
   * Retrieves the currently active TraceContext in the async call stack.
   */
  public static getActiveContext(): TraceContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Returns active correlationId or generates a fallback if outside context.
   */
  public static getCorrelationId(): string {
    return this.getActiveContext()?.correlationId || 'corr_orphan';
  }

  /**
   * Returns active runId if present.
   */
  public static getRunId(): string | undefined {
    return this.getActiveContext()?.runId;
  }
}
