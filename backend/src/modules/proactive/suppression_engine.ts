/**
 * Suppression Engine (Phase 7.2)
 *
 * Deterministically evaluates anti-spam, timing, and frequency boundaries:
 * 1. Quiet Hours (Default: 22:00 -> 08:00 Africa/Cairo UTC+3)
 * 2. Recent User Inactivity (Default: 15 minutes)
 * 3. Cooldown (Default: 18 hours)
 * 4. Rolling Rate Limits (Default: 1 touch / 24h)
 * 5. Deduplication of Topics & Opportunities
 * 6. WhatsApp Customer Service 24h Window
 */

import {
  QuietHoursConfig,
  ProactiveOpportunity,
} from './types';

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = Object.freeze({
  startHour: 22,
  endHour: 8,
  timezone: 'Africa/Cairo',
});

export class SuppressionEngine {
  public static readonly DEFAULT_INACTIVITY_WINDOW_MS = 15 * 60 * 1000; // 15 mins
  public static readonly DEFAULT_COOLDOWN_MS = 18 * 60 * 60 * 1000;     // 18 hours
  public static readonly DEFAULT_WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
  public static readonly DEFAULT_ROLLING_MAX_TOUCHES = 1;

  /**
   * Checks whether the given date falls within quiet hours in the specified timezone.
   * Overnight logic (e.g. 22:00 -> 08:00):
   * 21:59 -> allowed (false)
   * 22:00 -> blocked (true)
   * 23:30 -> blocked (true)
   * 07:59 -> blocked (true)
   * 08:00 -> allowed (false)
   */
  public static isQuietHours(now: Date = new Date(), config: QuietHoursConfig = DEFAULT_QUIET_HOURS): boolean {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const currentMinutes = hour * 60 + minute;

    const startMinutes = config.startHour * 60;
    const endMinutes = config.endHour * 60;

    if (startMinutes > endMinutes) {
      // Overnight span (e.g. 22:00 to 08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      // Intraday span (e.g. 13:00 to 15:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
  }

  /**
   * Checks recent user conversation activity.
   */
  public static checkRecentActivity(
    now: Date = new Date(),
    lastUserMessageAt?: Date,
    inactivityWindowMs = SuppressionEngine.DEFAULT_INACTIVITY_WINDOW_MS
  ): 'recently_active' | 'not_recently_active' | 'unknown' {
    if (!lastUserMessageAt) {
      return 'unknown';
    }
    const elapsed = now.getTime() - lastUserMessageAt.getTime();
    if (elapsed < inactivityWindowMs) {
      return 'recently_active';
    }
    return 'not_recently_active';
  }

  /**
   * Checks proactive cooldown window.
   */
  public static checkCooldown(
    now: Date = new Date(),
    lastProactiveAt?: Date,
    cooldownMs = SuppressionEngine.DEFAULT_COOLDOWN_MS
  ): 'cooldown_active' | 'cooldown_expired' | 'no_prior_touch' {
    if (!lastProactiveAt) {
      return 'no_prior_touch';
    }
    const elapsed = now.getTime() - lastProactiveAt.getTime();
    if (elapsed < cooldownMs) {
      return 'cooldown_active';
    }
    return 'cooldown_expired';
  }

  /**
   * Checks rolling window touch rate limit.
   */
  public static checkRollingLimit(
    countInWindow: number,
    maxAllowed = SuppressionEngine.DEFAULT_ROLLING_MAX_TOUCHES
  ): 'under_limit' | 'limit_exceeded' {
    return countInWindow >= maxAllowed ? 'limit_exceeded' : 'under_limit';
  }

  /**
   * Checks WhatsApp 24-hour Customer Service Session Window.
   */
  public static checkWhatsAppWindow(
    now: Date = new Date(),
    lastInboundMessageAt?: Date,
    windowMs = SuppressionEngine.DEFAULT_WHATSAPP_WINDOW_MS
  ): 'within_24h' | 'outside_24h' | 'unknown' {
    if (!lastInboundMessageAt) {
      return 'unknown';
    }
    const elapsed = now.getTime() - lastInboundMessageAt.getTime();
    if (elapsed <= windowMs) {
      return 'within_24h';
    }
    return 'outside_24h';
  }

  /**
   * Checks whether the candidate opportunity duplicates a recently sent or active opportunity.
   */
  public static isDuplicateOpportunity(
    opportunity: ProactiveOpportunity,
    recentOpportunities: readonly string[] = []
  ): boolean {
    if (!recentOpportunities || recentOpportunities.length === 0) {
      return false;
    }
    const signature = `${opportunity.type}:${opportunity.topic || 'general'}:${opportunity.context.trim().toLowerCase()}`;
    const topicSignature = `${opportunity.type}:${opportunity.topic || 'general'}`;

    return recentOpportunities.some((item) => {
      const normItem = item.trim().toLowerCase();
      return normItem === signature.toLowerCase() || normItem === topicSignature.toLowerCase();
    });
  }
}
