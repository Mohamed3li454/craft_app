/**
 * WhatsApp 24-Hour Customer Service Window Policy Calculator (Phase 7.4)
 *
 * Strictly evaluates whether the user is inside or outside the Meta 24-hour customer service window.
 * Within 24h: Freeform text permitted.
 * Outside 24h: Freeform text strictly prohibited; approved Meta Template required.
 * Unknown / missing timestamp: Fail-closed conservative suppression.
 */

import { WhatsAppWindowEvaluation, WhatsAppWindowState } from './types';

export class WhatsAppWindowPolicy {
  /**
   * Exactly 24 hours in milliseconds: 24 * 60 * 60 * 1000 = 86,400,000 ms.
   */
  public static readonly WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;

  /**
   * Pure, deterministic evaluation of the WhatsApp 24-hour customer service window.
   *
   * Exact boundary behavior:
   * - 23h 59m 59s: within_24h (freeform allowed)
   * - Exactly 24h: within_24h (freeform allowed)
   * - 24h + 1ms: outside_24h (freeform blocked, template required)
   * - undefined / null: unknown (freeform blocked, template required)
   */
  public static evaluateWindow(
    now: Date = new Date(),
    lastInboundMessageAt?: Date,
    windowDurationMs: number = WhatsAppWindowPolicy.WINDOW_DURATION_MS
  ): WhatsAppWindowEvaluation {
    if (!lastInboundMessageAt || isNaN(lastInboundMessageAt.getTime())) {
      return {
        state: 'unknown',
        remainingMs: 0,
        evaluatedAt: now,
        isFreeformAllowed: false,
        isTemplateRequired: true,
      };
    }

    const elapsedMs = now.getTime() - lastInboundMessageAt.getTime();

    // Guard against negative elapsed time due to invalid clock skew
    if (elapsedMs < 0) {
      return {
        state: 'unknown',
        elapsedMs,
        lastInboundMessageAt,
        evaluatedAt: now,
        isFreeformAllowed: false,
        isTemplateRequired: true,
      };
    }

    const isWithin = elapsedMs <= windowDurationMs;
    const remainingMs = Math.max(0, windowDurationMs - elapsedMs);
    const state: WhatsAppWindowState = isWithin ? 'within_24h' : 'outside_24h';

    return {
      state,
      elapsedMs,
      remainingMs,
      lastInboundMessageAt,
      evaluatedAt: now,
      isFreeformAllowed: isWithin,
      isTemplateRequired: !isWithin,
    };
  }
}
