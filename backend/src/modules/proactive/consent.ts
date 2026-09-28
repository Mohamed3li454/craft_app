/**
 * Proactive Consent Engine (Phase 7.2)
 *
 * Deterministically evaluates user consent, explicit opt-in, and opt-out commands
 * for proactive outreach.
 */

import { ProactiveConsent } from './types';

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

export class ConsentManager {
  private static readonly OPT_OUT_PATTERNS = [
    // Arabic opt-out patterns
    /وقف\s+(التذكيرات|الرسايل|التنبيهات|المتابعه)/i,
    /كفايه\s+رسايل/i,
    /متبعتليش/i,
    /الغاء\s+(التنبيهات|التذكيرات|المتابعه)/i,
    /لا\s+ترسل\s+لي/i,
    /بلاش\s+تنبيهات/i,
    // English opt-out patterns
    /\bstop\b/i,
    /\bunsubscribe\b/i,
    /\bdon'?t\s+remind\s+me\b/i,
    /\bstop\s+messages?\b/i,
    /\bopt[- ]?out\b/i,
    /\bcancel\s+reminders?\b/i,
  ];

  /**
   * Checks whether the user's text contains an explicit command to opt out of proactive messages.
   */
  public static isExplicitOptOut(text: string): boolean {
    const norm = normalize(text || '');
    if (!norm) return false;
    return this.OPT_OUT_PATTERNS.some((p) => p.test(norm));
  }

  /**
   * Resolves the current consent snapshot.
   */
  public static resolveConsent(input: {
    query?: string;
    storedOptOut?: boolean;
    storedAllowsFollowUp?: boolean;
    userRequestedReminder?: boolean;
  }): ProactiveConsent {
    const isCommandOptOut = input.query ? this.isExplicitOptOut(input.query) : false;
    const hasExplicitOptOut = isCommandOptOut || input.storedOptOut === true;

    return {
      hasExplicitOptOut,
      // If user explicitly opted out, allowsProactiveFollowUp is strictly FALSE
      allowsProactiveFollowUp: hasExplicitOptOut ? false : (input.storedAllowsFollowUp ?? false),
      userRequestedReminder: input.userRequestedReminder ?? false,
    };
  }
}
