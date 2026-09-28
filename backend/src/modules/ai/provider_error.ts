/**
 * Provider Error Taxonomy & Classification (Phase 8.4)
 *
 * Normalizes vendor-specific error responses, status codes, and exceptions
 * into structured, typed AIProviderError classifications with explicit retryability.
 */

import { redactSecrets } from '../tools/contracts/error.types';

export type ProviderErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'unavailable'
  | 'invalid_request'
  | 'context_overflow'
  | 'model_unavailable'
  | 'malformed_response'
  | 'unknown';

export interface AIProviderErrorParams {
  providerId: string;
  category: ProviderErrorCategory;
  message: string;
  retryable: boolean;
  statusCode?: number;
  providerCode?: string;
  requestId?: string;
  userSafeMessage?: string;
  originalError?: any;
}

export class AIProviderError extends Error {
  public readonly providerId: string;
  public readonly category: ProviderErrorCategory;
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly providerCode?: string;
  public readonly requestId?: string;
  public readonly userSafeMessage: string;
  public readonly originalError?: any;

  constructor(params: AIProviderErrorParams) {
    const sanitizedMsg = redactSecrets(params.message);
    super(`[${params.providerId}] ${params.category.toUpperCase()}: ${sanitizedMsg}`);
    this.name = 'AIProviderError';
    this.providerId = params.providerId;
    this.category = params.category;
    this.retryable = params.retryable;
    this.statusCode = params.statusCode;
    this.providerCode = params.providerCode;
    this.requestId = params.requestId;
    this.originalError = params.originalError;
    this.userSafeMessage =
      params.userSafeMessage ||
      AIProviderError.getDefaultUserSafeMessage(params.category);

    Object.setPrototypeOf(this, AIProviderError.prototype);
  }

  public static getDefaultUserSafeMessage(category: ProviderErrorCategory): string {
    switch (category) {
      case 'authentication':
      case 'authorization':
        return 'The AI service encountered an authentication issue. Please contact administrator.';
      case 'rate_limit':
        return 'The AI service is experiencing heavy demand. Please try again in a moment.';
      case 'timeout':
      case 'network':
        return 'The request to the AI service timed out. Please try again.';
      case 'unavailable':
      case 'model_unavailable':
        return 'The AI service is temporarily unavailable. Please try again shortly.';
      case 'context_overflow':
        return 'The conversation context exceeds the maximum allowed length. Please start a new session.';
      case 'invalid_request':
      case 'malformed_response':
      case 'unknown':
      default:
        return 'An error occurred while communicating with the AI service.';
    }
  }

  /**
   * Deterministically classifies HTTP status codes, error bodies, and messages
   * into normalized AIProviderError categories and retryability flags.
   */
  public static classify(
    providerId: string,
    statusOrError: number | Error | any,
    bodyText?: string,
    requestId?: string
  ): AIProviderError {
    // 1. If already an AIProviderError, return directly
    if (statusOrError instanceof AIProviderError) {
      return statusOrError;
    }

    let statusCode: number | undefined;
    let rawMessage = '';
    let originalError: any;

    if (typeof statusOrError === 'number') {
      statusCode = statusOrError;
      rawMessage = bodyText || '';
    } else if (statusOrError instanceof Error) {
      originalError = statusOrError;
      rawMessage = `${statusOrError.message} ${bodyText || ''}`;
      if ('status' in statusOrError && typeof (statusOrError as any).status === 'number') {
        statusCode = (statusOrError as any).status;
      }
    } else if (statusOrError && typeof statusOrError === 'object') {
      originalError = statusOrError;
      rawMessage = JSON.stringify(statusOrError);
      if (typeof statusOrError.status === 'number') {
        statusCode = statusOrError.status;
      }
    }

    const lower = rawMessage.toLowerCase();

    // 2. Authentication & Authorization (401, 403, invalid api key) -> Non-retryable
    if (
      statusCode === 401 ||
      lower.includes('invalid_api_key') ||
      lower.includes('unauthorized') ||
      lower.includes('invalid api key')
    ) {
      return new AIProviderError({
        providerId,
        category: 'authentication',
        message: rawMessage || 'Invalid API key or authentication credentials',
        retryable: false,
        statusCode: 401,
        requestId,
        originalError,
      });
    }

    if (
      statusCode === 403 ||
      lower.includes('permission_denied') ||
      lower.includes('forbidden') ||
      lower.includes('access denied')
    ) {
      return new AIProviderError({
        providerId,
        category: 'authorization',
        message: rawMessage || 'Access forbidden or account suspended',
        retryable: false,
        statusCode: 403,
        requestId,
        originalError,
      });
    }

    // 3. Rate Limit / Quota Exhaustion (429, tokens per minute, requests per minute) -> Retryable
    if (
      statusCode === 429 ||
      lower.includes('rate_limit_exceeded') ||
      lower.includes('too many requests') ||
      lower.includes('tokens per minute') ||
      lower.includes('requests per minute') ||
      lower.includes('quota')
    ) {
      return new AIProviderError({
        providerId,
        category: 'rate_limit',
        message: rawMessage || 'Rate limit or quota threshold reached',
        retryable: true,
        statusCode: 429,
        requestId,
        originalError,
      });
    }

    // 4. Timeout (ETIMEDOUT, timed out, aborted signal) -> Retryable
    if (
      statusCode === 408 ||
      statusCode === 504 ||
      lower.includes('timed out') ||
      lower.includes('timeout') ||
      lower.includes('aborterror') ||
      lower.includes('etimedout')
    ) {
      return new AIProviderError({
        providerId,
        category: 'timeout',
        message: rawMessage || 'AI provider request timed out',
        retryable: true,
        statusCode: statusCode || 408,
        requestId,
        originalError,
      });
    }

    // 5. Network errors (ECONNRESET, fetch failed, network error) -> Retryable
    if (
      lower.includes('econnreset') ||
      lower.includes('econnrefused') ||
      lower.includes('fetch failed') ||
      lower.includes('network error') ||
      lower.includes('socket hang up')
    ) {
      return new AIProviderError({
        providerId,
        category: 'network',
        message: rawMessage || 'Network transport failure connecting to AI provider',
        retryable: true,
        statusCode,
        requestId,
        originalError,
      });
    }

    // 6. Context Overflow (maximum context length, prompt too long) -> Non-retryable
    if (
      lower.includes('context_length_exceeded') ||
      lower.includes('maximum context length') ||
      lower.includes('prompt is too long') ||
      lower.includes('token count exceeds')
    ) {
      return new AIProviderError({
        providerId,
        category: 'context_overflow',
        message: rawMessage || 'Request exceeds model context window limit',
        retryable: false,
        statusCode: 400,
        requestId,
        originalError,
      });
    }

    // 7. Model Unavailable / Deprecated (model_not_found, decommissioned) -> Retryable via fallback
    if (
      lower.includes('model_not_found') ||
      lower.includes('model is decommissioned') ||
      lower.includes('unsupported model') ||
      lower.includes('model unavailable')
    ) {
      return new AIProviderError({
        providerId,
        category: 'model_unavailable',
        message: rawMessage || 'Specified model is not available or decommissioned',
        retryable: true,
        statusCode: statusCode || 404,
        requestId,
        originalError,
      });
    }

    // 8. Server Unavailable / 5xx -> Retryable
    if (statusCode && statusCode >= 500 && statusCode < 600) {
      return new AIProviderError({
        providerId,
        category: 'unavailable',
        message: rawMessage || `AI provider returned server error (${statusCode})`,
        retryable: true,
        statusCode,
        requestId,
        originalError,
      });
    }

    // 9. Malformed / Empty output -> Retryable
    if (
      lower.includes('empty choices') ||
      lower.includes('empty output') ||
      lower.includes('unexpected token') ||
      lower.includes('malformed')
    ) {
      return new AIProviderError({
        providerId,
        category: 'malformed_response',
        message: rawMessage || 'Provider returned malformed or unparseable response',
        retryable: true,
        statusCode: 502,
        requestId,
        originalError,
      });
    }

    // 10. Invalid Request (400, schema violations) -> Non-retryable
    if (statusCode === 400 || lower.includes('invalid_request_error')) {
      return new AIProviderError({
        providerId,
        category: 'invalid_request',
        message: rawMessage || 'Invalid request syntax or parameter schema violation',
        retryable: false,
        statusCode: 400,
        requestId,
        originalError,
      });
    }

    // 11. Default fallback
    return new AIProviderError({
      providerId,
      category: 'unknown',
      message: rawMessage || 'Unknown AI provider error occurred',
      retryable: false,
      statusCode,
      requestId,
      originalError,
    });
  }
}
