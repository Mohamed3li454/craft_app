/**
 * Structured Observability Logger (Phase 8.5)
 *
 * Emits JSON-structured log entries automatically enriched with active
 * TraceContext (correlationId, runId, spanId) and deeply sanitized via
 * the centralized Redaction layer.
 */

import { TraceContextManager } from './trace_context';
import { redactObject, redactSecrets } from './redaction';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  runId?: string;
  spanId?: string;
  channel?: string;
  meta?: unknown;
  event?: string;
}

export class StructuredLogger {
  private static instance: StructuredLogger;

  private constructor() {}

  public static getInstance(): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger();
    }
    return StructuredLogger.instance;
  }

  public debug(message: string, meta?: unknown): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  public info(message: string, meta?: unknown): void {
    this.log(LogLevel.INFO, message, meta);
  }

  public warn(message: string, meta?: unknown): void {
    this.log(LogLevel.WARN, message, meta);
  }

  public error(message: string, meta?: unknown): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * Emits a discrete structured lifecycle event (e.g. 'ai.provider.completed').
   */
  public event(name: string, attributes: Record<string, unknown>): void {
    this.log(LogLevel.INFO, `Event: ${name}`, attributes, name);
  }

  private log(level: LogLevel, message: string, meta?: unknown, eventName?: string): void {
    try {
      const activeCtx = TraceContextManager.getActiveContext();
      const sanitizedMsg = redactSecrets(message);
      const sanitizedMeta = meta !== undefined ? redactObject(meta) : undefined;

      const entry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message: sanitizedMsg,
      };

      if (activeCtx?.correlationId) {
        entry.correlationId = activeCtx.correlationId;
      }
      if (activeCtx?.runId) {
        entry.runId = activeCtx.runId;
      }
      if (activeCtx?.parentSpanId) {
        entry.spanId = activeCtx.parentSpanId;
      }
      if (activeCtx?.channel) {
        entry.channel = activeCtx.channel;
      }
      if (eventName) {
        entry.event = eventName;
      }
      if (sanitizedMeta !== undefined) {
        entry.meta = sanitizedMeta;
      }

      const serialized = JSON.stringify(entry);

      if (level === LogLevel.ERROR) {
        console.error(serialized);
      } else if (level === LogLevel.WARN) {
        console.warn(serialized);
      } else {
        console.log(serialized);
      }
    } catch {
      // Fail-open: logging must never throw under any circumstances
    }
  }
}

export const logger = StructuredLogger.getInstance();
