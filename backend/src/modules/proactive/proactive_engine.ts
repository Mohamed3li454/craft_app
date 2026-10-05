/**
 * Proactive Engine (Phases 7.1 & 7.2)
 *
 * Facade coordinating in-turn candidate detection, negative guardrail enforcement,
 * policy resolution, and the deterministic eligibility & suppression gate pipeline.
 *
 * Performance Guarantee: < 1.0ms execution time, 0 DB queries, 0 network calls.
 */

import { CandidateDetector } from './candidate_detector';
import { ProactivePolicyResolver, DEFAULT_PROACTIVE_GUARDRAILS } from './proactive_policy';
import { ConsentManager } from './consent';
import { ProactiveEligibilityGate } from './eligibility_gate';
import { RuntimePolicyResolver } from '../../config/runtime_policy';
import {
  ProactiveDetectionInput,
  ProactivePolicy,
  EligibilityEvaluationInput,
  ProactiveDecision,
} from './types';

export class ProactiveEngine {
  private static instance: ProactiveEngine;

  private constructor() {}

  public static getInstance(): ProactiveEngine {
    if (!ProactiveEngine.instance) {
      ProactiveEngine.instance = new ProactiveEngine();
    }
    return ProactiveEngine.instance;
  }

  /**
   * Deterministically analyzes conversation state and query to yield an In-Turn ProactivePolicy.
   */
  public analyze(input: ProactiveDetectionInput): ProactivePolicy {
    if (!RuntimePolicyResolver.getPolicy().proactiveEnabled) {
      return {
        shouldSuggest: false,
        suggestionType: 'none',
        confidence: 0,
        urgency: 'low',
        reason: 'proactive_disabled_by_policy',
        guardrails: DEFAULT_PROACTIVE_GUARDRAILS,
      };
    }

    if (ConsentManager.isExplicitOptOut(input.query)) {
      return {
        shouldSuggest: false,
        suggestionType: 'none',
        confidence: 0,
        urgency: 'low',
        reason: 'user_opted_out',
        guardrails: DEFAULT_PROACTIVE_GUARDRAILS,
      };
    }
    const opportunity = CandidateDetector.detect(input);
    return ProactivePolicyResolver.resolve(opportunity);
  }

  /**
   * Deterministically evaluates whether a proactive action is authorized, suppressed, or deferred.
   */
  public evaluateEligibility(input: EligibilityEvaluationInput): ProactiveDecision {
    return ProactiveEligibilityGate.evaluate(input);
  }
}
