/**
 * Proactive Policy Engine (Phase 7.1)
 *
 * Converts a detected ProactiveOpportunity into an actionable in-turn policy,
 * enforcing negative guardrails, confidence gates, and suggestion types.
 */

import {
  ProactiveOpportunity,
  ProactivePolicy,
  SuggestionType,
} from './types';

export const DEFAULT_PROACTIVE_GUARDRAILS: readonly string[] = Object.freeze([
  'Do not interrupt the current answer.',
  'Do not repeat the unresolved issue unnecessarily.',
  'Do not force a reminder.',
  'Do not mention old topics after a topic switch.',
  'Do not claim that Craft will follow up later.',
  'Never promise autonomous future contact.',
]);

export class ProactivePolicyResolver {
  public static readonly MINIMUM_CONFIDENCE_THRESHOLD = 0.70;

  public static resolve(opportunity: ProactiveOpportunity | null): ProactivePolicy {
    if (!opportunity) {
      return {
        shouldSuggest: false,
        suggestionType: 'none',
        confidence: 0,
        urgency: 'low',
        reason: 'no_opportunity_detected',
        guardrails: DEFAULT_PROACTIVE_GUARDRAILS,
      };
    }

    if (opportunity.confidence < this.MINIMUM_CONFIDENCE_THRESHOLD) {
      return {
        shouldSuggest: false,
        suggestionType: 'none',
        confidence: opportunity.confidence,
        urgency: opportunity.urgency,
        reason: 'suppressed_below_confidence_threshold',
        guardrails: DEFAULT_PROACTIVE_GUARDRAILS,
      };
    }

    let suggestionType: SuggestionType = 'none';
    switch (opportunity.type) {
      case 'unresolved_follow_up':
      case 'follow_up_offer':
        suggestionType = 'follow_up_offer';
        break;
      case 'next_step_offer':
        suggestionType = 'next_step';
        break;
      default:
        suggestionType = 'none';
        break;
    }

    return {
      shouldSuggest: suggestionType !== 'none',
      suggestionType,
      confidence: opportunity.confidence,
      urgency: opportunity.urgency,
      reason: opportunity.reason,
      guardrails: DEFAULT_PROACTIVE_GUARDRAILS,
    };
  }
}
