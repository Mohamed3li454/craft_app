/**
 * Tool Error Taxonomy & Security Redaction (Phase 8.2)
 *
 * Defines strongly-typed error codes, structured error representations,
 * and secret redaction utilities for safe logging and user messaging.
 */

export type ToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'CHANNEL_NOT_ALLOWED'
  | 'UNAUTHENTICATED'
  | 'CONFIRMATION_REQUIRED'
  | 'SSRF_BLOCKED'
  | 'TIMEOUT_ERROR'
  | 'NETWORK_ERROR'
  | 'EXECUTION_FAILED'
  | 'OUTPUT_TOO_LARGE'
  | 'OUTPUT_SANITIZATION_FAILED'
  | 'TOOL_NOT_ALLOWED_FOR_TRIGGER'
  | 'INTERNAL_ERROR';

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly userSafeMessage: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly details?: Record<string, unknown>;
}

import { redactSecrets as centralRedactSecrets } from '../../observability/redaction';

/**
 * Redacts secrets, tokens, passwords, and sensitive credentials from any text or object.
 */
export function redactSecrets(input: string): string {
  return centralRedactSecrets(input);
}

/**
 * Creates a normalized, safe ToolError instance with sanitized messages.
 */
export function createToolError(
  code: ToolErrorCode,
  rawMessage: string,
  options?: {
    userSafeMessage?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  }
): ToolError {
  const safeMessage = redactSecrets(rawMessage);
  return {
    code,
    message: safeMessage,
    userSafeMessage: options?.userSafeMessage || safeMessage,
    retryable: options?.retryable ?? false,
    retryAfterMs: options?.retryAfterMs,
    details: options?.details,
  };
}
