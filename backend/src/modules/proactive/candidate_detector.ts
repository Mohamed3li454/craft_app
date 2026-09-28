/**
 * Candidate Detector (Phase 7.1)
 *
 * Deterministically analyzes conversation state, unresolved items, and user query
 * to identify in-turn proactive suggestion opportunities.
 *
 * Invariants:
 * 1. Zero external network/LLM calls.
 * 2. Pure deterministic heuristics.
 * 3. Memory NEVER triggers proactive intelligence.
 * 4. Topic switch suppresses stale proactive continuation.
 * 5. Sensitive/credential/health topics are strictly suppressed.
 */

import {
  ProactiveDetectionInput,
  ProactiveOpportunity,
} from './types';

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

export class CandidateDetector {
  private static readonly SENSITIVE_KEYWORDS = [
    // Credentials & Secrets
    'password', 'token', 'secret', 'api_key', 'apikey', 'credential', 'private_key',
    'كلمة السر', 'كلمة المرور', 'الباسورد', 'توكن', 'مفتاح سري', 'api key',
    // Financial
    'credit card', 'creditcard', 'cvv', 'bank account', 'iban',
    'رقم الحساب', 'كارت البنك', 'البطاقة الائتمانية', 'فيزا',
    // Medical & Health
    'blood pressure', 'prescription', 'diagnosis', 'disease', 'medication dose',
    'ضغط الدم', 'روشتة', 'جرعة دواء', 'تشخيص طبي', 'مرض خطير',
  ];

  private static readonly EXPLICIT_FOLLOW_UP_SIGNALS = [
    'تابع معايا', 'تابع الموضوع', 'كمل معايا', 'خليك معايا',
    'follow up with me', 'keep following up', 'stay with me on this',
  ];

  /**
   * Deterministically evaluates if an in-turn proactive opportunity exists.
   */
  public static detect(input: ProactiveDetectionInput): ProactiveOpportunity | null {
    const { query, conversationState } = input;
    const normalizedQuery = normalize(query || '');

    // 1. Hard Safety Gate: Sensitive, credential, financial, or medical content
    const containsSensitiveQuery = this.SENSITIVE_KEYWORDS.some((kw) => normalizedQuery.includes(kw));
    if (containsSensitiveQuery) {
      return null;
    }

    const hasSensitiveUnresolved = (conversationState.unresolvedItems || []).some((item) => {
      const normItem = normalize(item);
      return this.SENSITIVE_KEYWORDS.some((kw) => normItem.includes(kw));
    });
    if (hasSensitiveUnresolved) {
      return null;
    }

    // 2. Resolution Gate: Resolved items cannot produce proactive candidates
    if (conversationState.resolutionState === 'resolved') {
      return null;
    }

    // 3. Topic Switch Gate: Suppress continuation of old topics
    if (conversationState.isTopicSwitch) {
      return null;
    }

    // 4. Casual or Informational Suppression (unless explicit user follow-up request)
    const hasExplicitFollowUpSignal = this.EXPLICIT_FOLLOW_UP_SIGNALS.some((sig) => normalizedQuery.includes(sig));

    if (conversationState.goal === 'casual') {
      return null;
    }

    if (conversationState.goal === 'informational' && !hasExplicitFollowUpSignal) {
      return null;
    }

    // 5. Explicit Follow-Up Signal from User
    if (hasExplicitFollowUpSignal) {
      return {
        type: 'follow_up_offer',
        topic: conversationState.activeTopic,
        context: query,
        confidence: 0.90,
        urgency: 'medium',
        reason: 'explicit_user_follow_up_signal',
      };
    }

    // 6. Troubleshooting Unresolved Opportunity
    if (
      conversationState.goal === 'troubleshooting' &&
      conversationState.resolutionState === 'unresolved' &&
      conversationState.unresolvedItems &&
      conversationState.unresolvedItems.length > 0
    ) {
      return {
        type: 'unresolved_follow_up',
        topic: conversationState.activeTopic,
        context: conversationState.unresolvedItems[0],
        confidence: 0.92,
        urgency: 'medium',
        reason: 'unresolved_troubleshooting_issue',
      };
    }

    // 7. Troubleshooting In-Progress Opportunity
    if (
      conversationState.goal === 'troubleshooting' &&
      conversationState.resolutionState === 'in_progress'
    ) {
      return {
        type: 'next_step_offer',
        topic: conversationState.activeTopic,
        context: query,
        confidence: 0.86,
        urgency: 'low',
        reason: 'in_progress_troubleshooting_next_step',
      };
    }

    // 8. Planning Unresolved Opportunity
    if (
      conversationState.goal === 'planning' &&
      (conversationState.resolutionState === 'unresolved' ||
        (conversationState.unresolvedItems && conversationState.unresolvedItems.length > 0))
    ) {
      return {
        type: 'follow_up_offer',
        topic: conversationState.activeTopic,
        context: query,
        confidence: 0.80,
        urgency: 'low',
        reason: 'unresolved_planning_continuation',
      };
    }

    // No valid proactive opportunity
    return null;
  }
}
