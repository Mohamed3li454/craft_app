/**
 * Core Logger Facade (Phase 8.5)
 *
 * Delegates all logging and redaction to the centralized Observability layer,
 * ensuring automatic trace context enrichment (correlationId, runId, spanId)
 * and deep secret sanitization across the entire system.
 */

import {
  logger as structuredLogger,
  LogLevel as StructuredLogLevel,
  redactObject,
} from '../modules/observability';

export { StructuredLogLevel as LogLevel };

export function redactSensitiveData(data: unknown): unknown {
  return redactObject(data);
}

export const logger = structuredLogger;
