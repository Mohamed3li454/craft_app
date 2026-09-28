/**
 * Meta WhatsApp Cloud API Error Classifier (Phase 7.4)
 *
 * Deterministically classifies Meta HTTP status codes and error payloads into:
 * - retryable: 5xx, rate limits, temporary network glitches
 * - non_retryable: 4xx, invalid recipient, unapproved template, auth errors, 24h window violations
 * - unknown: timeouts, dropped connections, unparseable responses
 */

import { MetaErrorClassification } from './types';

export class MetaErrorClassifier {
  public static classify(
    status: number,
    responseData?: any,
    networkError?: Error
  ): MetaErrorClassification {
    // 1. Network level errors / Timeouts
    if (networkError) {
      const msg = networkError.message.toLowerCase();
      if (
        msg.includes('timeout') ||
        msg.includes('etimedout') ||
        msg.includes('abort') ||
        msg.includes('econnreset')
      ) {
        return {
          type: 'unknown',
          reason: `Network timeout awaiting Meta response: ${networkError.message}`,
        };
      }
      return {
        type: 'retryable',
        reason: `Transient network failure: ${networkError.message}`,
      };
    }

    const metaErrorCode = responseData?.error?.code;
    const metaErrorSubcode = responseData?.error?.error_subcode;
    const metaErrorMsg = responseData?.error?.message || responseData?.error?.error_data?.details || '';

    // 2. Rate Limits (HTTP 429 or Meta code 80007, 130429)
    if (status === 429 || metaErrorCode === 80007 || metaErrorCode === 130429) {
      return {
        type: 'retryable',
        reason: `Meta rate limit exceeded: ${metaErrorMsg || 'Too Many Requests'}`,
        code: metaErrorCode || 429,
        subcode: metaErrorSubcode,
      };
    }

    // 3. Server Errors (5xx)
    if (status >= 500 && status < 600) {
      return {
        type: 'retryable',
        reason: `Meta internal server error (HTTP ${status}): ${metaErrorMsg || 'Downstream Server Error'}`,
        code: metaErrorCode || status,
        subcode: metaErrorSubcode,
      };
    }

    // 4. Meta-specific Non-Retryable Client Codes
    if (metaErrorCode === 131047) {
      return {
        type: 'non_retryable',
        reason: 'WhatsApp 24-hour customer service session expired; Meta template required',
        code: 131047,
        subcode: metaErrorSubcode,
      };
    }

    if (metaErrorCode === 132000 || metaErrorCode === 132001) {
      return {
        type: 'non_retryable',
        reason: 'WhatsApp template does not exist or has not been approved by Meta',
        code: metaErrorCode,
        subcode: metaErrorSubcode,
      };
    }

    if (metaErrorCode === 131026) {
      return {
        type: 'non_retryable',
        reason: 'Message undeliverable to target recipient phone number',
        code: 131026,
        subcode: metaErrorSubcode,
      };
    }

    if (metaErrorCode === 190 || status === 401) {
      return {
        type: 'non_retryable',
        reason: 'Invalid OAuth access token or authentication failure',
        code: metaErrorCode || 401,
        subcode: metaErrorSubcode,
      };
    }

    if (metaErrorCode === 100 || status === 400) {
      return {
        type: 'non_retryable',
        reason: `Invalid request parameters: ${metaErrorMsg || 'Bad Request'}`,
        code: metaErrorCode || 400,
        subcode: metaErrorSubcode,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        type: 'non_retryable',
        reason: `Client request rejected (HTTP ${status}): ${metaErrorMsg || 'Unprocessable'}`,
        code: metaErrorCode || status,
        subcode: metaErrorSubcode,
      };
    }

    // 5. Unrecognized / Malformed response
    if (status !== 200) {
      return {
        type: 'unknown',
        reason: `Unrecognized Meta response (HTTP ${status}): ${metaErrorMsg || 'Unknown payload'}`,
        code: metaErrorCode || status,
      };
    }

    return {
      type: 'unknown',
      reason: 'Malformed successful Meta response (missing message identifier)',
    };
  }
}
