/**
 * Trace Span Implementation (Phase 8.5)
 *
 * Encapsulates the lifecycle, attributes, timing, and error tracking of
 * a discrete high-level operation in the system.
 */

import { v4 as uuidv4 } from 'uuid';
import { SpanStatus, TraceEvent, TraceSpan } from './types';
import { redactObject } from './redaction';

export class TraceSpanImpl implements TraceSpan {
  public readonly spanId: string;
  public readonly parentSpanId?: string;
  public readonly name: string;
  public readonly startedAt: number;
  public endedAt?: number;
  public durationMs?: number;
  public status: SpanStatus = 'ok';
  public attributes: Record<string, unknown> = {};
  public events: TraceEvent[] = [];

  constructor(name: string, parentSpanId?: string, initialAttributes?: Record<string, unknown>) {
    this.spanId = `sp_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    this.name = name;
    this.parentSpanId = parentSpanId;
    this.startedAt = Date.now();
    if (initialAttributes) {
      this.attributes = redactObject({ ...initialAttributes }) as Record<string, unknown>;
    }
  }

  public setAttribute(key: string, value: unknown): this {
    if (this.endedAt) return this;
    this.attributes[key] = redactObject(value);
    return this;
  }

  public setAttributes(attrs: Record<string, unknown>): this {
    if (this.endedAt) return this;
    const sanitized = redactObject(attrs) as Record<string, unknown>;
    Object.assign(this.attributes, sanitized);
    return this;
  }

  public recordEvent(name: string, attributes?: Record<string, unknown>): this {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes: attributes ? (redactObject(attributes) as Record<string, unknown>) : undefined,
    });
    return this;
  }

  public recordError(error: unknown): this {
    this.status = 'error';
    const errObj = error instanceof Error ? error : new Error(String(error));
    this.recordEvent('exception', {
      'exception.type': errObj.name,
      'exception.message': errObj.message,
    });
    this.setAttribute('error', true);
    this.setAttribute('error.message', errObj.message);
    return this;
  }

  public end(status?: SpanStatus, attributes?: Record<string, unknown>): this {
    if (this.endedAt) return this; // Idempotent
    this.endedAt = Date.now();
    this.durationMs = Math.max(0, this.endedAt - this.startedAt);
    if (status) {
      this.status = status;
    }
    if (attributes) {
      this.setAttributes(attributes);
    }
    return this;
  }

  public toJSON(): TraceSpan {
    return {
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: this.durationMs,
      status: this.status,
      attributes: this.attributes,
      events: this.events,
    };
  }
}
