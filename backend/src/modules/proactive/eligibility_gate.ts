/**
 * Proactive Eligibility Gate (Phase 7.2)
 *
 * Deterministic Hard-Gate Pipeline evaluating whether a proactive action
 * is authorized, suppressed, or deferred.
 *
 * Hard Gate Evaluation Ordering:
 * 1. Safety & Credential Gate
 * 2. Explicit User Opt-Out Gate
 * 3. Candidate Validity & Confidence Gate
 * 4. Issue Resolution Gate
 * 5. Explicit Consent Gate (for out-of-turn)
 * 6. Delivery Mode Check (in-turn proceeds immediately)
 * 7. Quiet Hours Gate
 * 8. Recent User Activity Gate
 * 9. Cooldown Gate (18h)
 * 10. Rolling Rate Limit Gate (1/24h)
 * 11. Deduplication Gate
 * 12. WhatsApp 24h Session Window Gate
 * 13. Authorization (Allowed)
 */

import {
  EligibilityEvaluationInput,
  ProactiveDecision,
} from './types';
import { SuppressionEngine } from './suppression_engine';
import { ProactiveTemplateRegistry } from '../whatsapp/template_registry';

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

export class ProactiveEligibilityGate {
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

  /**
   * Evaluates the hard-gate pipeline in strictly deterministic order.
   */
  public static evaluate(input: EligibilityEvaluationInput): ProactiveDecision {
    const {
      opportunity,
      conversationState,
      deliveryMode,
      query,
      consent,
      now = new Date(),
      quietHours,
      lastUserMessageAt,
      lastInboundMessageAt,
      historySnapshot,
    } = input;

    // -----------------------------------------------------------------------
    // Gate 1: Safety & Sensitive Data Gate (Safety > Consent)
    // -----------------------------------------------------------------------
    const textToCheck = `${query || ''} ${opportunity?.context || ''} ${(conversationState.unresolvedItems || []).join(' ')}`;
    const normText = normalize(textToCheck);

    const hasSafetyViolation = this.SENSITIVE_KEYWORDS.some((kw) => normText.includes(kw));
    if (hasSafetyViolation) {
      return {
        status: 'suppressed',
        reason: 'Hard safety violation: sensitive credential, financial, or medical content detected',
        suppressionReason: 'safety_violation',
        deliveryMode,
      };
    }

    // -----------------------------------------------------------------------
    // Gate 2: Explicit Opt-Out Gate
    // -----------------------------------------------------------------------
    if (consent?.hasExplicitOptOut === true) {
      return {
        status: 'suppressed',
        reason: 'User has explicitly opted out of proactive outreach',
        suppressionReason: 'user_opted_out',
        deliveryMode,
      };
    }

    // -----------------------------------------------------------------------
    // Gate 3: Candidate Validity & Confidence Gate
    // -----------------------------------------------------------------------
    if (!opportunity) {
      return {
        status: 'suppressed',
        reason: 'No valid proactive opportunity present',
        suppressionReason: 'invalid_candidate',
        deliveryMode,
      };
    }

    if (opportunity.confidence < 0.70) {
      return {
        status: 'suppressed',
        reason: 'Opportunity confidence is below the minimum threshold (0.70)',
        suppressionReason: 'suppressed_below_confidence_threshold',
        deliveryMode,
        opportunity,
      };
    }

    // -----------------------------------------------------------------------
    // Gate 4: Issue Resolution Gate
    // -----------------------------------------------------------------------
    if (conversationState.resolutionState === 'resolved') {
      return {
        status: 'suppressed',
        reason: 'The conversational issue or task is already resolved',
        suppressionReason: 'issue_resolved',
        deliveryMode,
        opportunity,
      };
    }

    // -----------------------------------------------------------------------
    // Gate 5: Explicit Consent Gate (Required for out-of-turn outreach)
    // -----------------------------------------------------------------------
    if (deliveryMode === 'out_of_turn') {
      if (!consent || !consent.allowsProactiveFollowUp) {
        return {
          status: 'suppressed',
          reason: 'No explicit consent granted for out-of-turn proactive outreach',
          suppressionReason: 'no_consent',
          deliveryMode,
          opportunity,
        };
      }
    }

    // -----------------------------------------------------------------------
    // Gate 6: Delivery Mode Check (In-Turn suggestions bypass out-of-turn gates)
    // -----------------------------------------------------------------------
    if (deliveryMode === 'in_turn') {
      return {
        status: 'allowed',
        reason: 'In-turn proactive suggestion authorized under policy',
        deliveryMode,
        opportunity,
      };
    }

    // =======================================================================
    // OUT-OF-TURN TEMPORAL & ANTI-SPAM HARD GATES
    // =======================================================================

    // Gate 7: Quiet Hours Gate
    if (SuppressionEngine.isQuietHours(now, quietHours)) {
      return {
        status: 'suppressed',
        reason: 'Outbound proactive messaging is prohibited during quiet hours',
        suppressionReason: 'quiet_hours',
        deliveryMode,
        opportunity,
      };
    }

    // Gate 8: Recent User Activity Gate
    const activityStatus = SuppressionEngine.checkRecentActivity(now, lastUserMessageAt);
    if (activityStatus === 'recently_active') {
      return {
        status: 'suppressed',
        reason: 'User is actively conversing; out-of-turn reach suppressed to prevent interruption',
        suppressionReason: 'user_recently_active',
        deliveryMode,
        opportunity,
      };
    }
    if (activityStatus === 'unknown') {
      return {
        status: 'suppressed',
        reason: 'User recent activity is unknown; out-of-turn reach suppressed conservatively',
        suppressionReason: 'user_recently_active',
        deliveryMode,
        opportunity,
      };
    }

    // Gate 9: Cooldown Gate (18 hours)
    const cooldownStatus = SuppressionEngine.checkCooldown(now, historySnapshot?.lastProactiveAt);
    if (cooldownStatus === 'cooldown_active') {
      return {
        status: 'suppressed',
        reason: 'Proactive cooldown is still active (minimum 18 hours between touches)',
        suppressionReason: 'cooldown_active',
        deliveryMode,
        opportunity,
      };
    }

    // Gate 10: Rolling Rate Limit Gate (1 per 24 hours)
    const rateLimitStatus = SuppressionEngine.checkRollingLimit(historySnapshot?.proactiveCountInRollingWindow ?? 0);
    if (rateLimitStatus === 'limit_exceeded') {
      return {
        status: 'suppressed',
        reason: 'Rolling 24-hour proactive message quota exceeded (max 1 touch)',
        suppressionReason: 'rate_limit_exceeded',
        deliveryMode,
        opportunity,
      };
    }

    // Gate 11: Deduplication Gate
    if (SuppressionEngine.isDuplicateOpportunity(opportunity, historySnapshot?.recentOpportunities)) {
      return {
        status: 'suppressed',
        reason: 'Duplicate proactive opportunity already addressed recently',
        suppressionReason: 'duplicate_opportunity',
        deliveryMode,
        opportunity,
      };
    }

    // Gate 12: WhatsApp 24-Hour Customer Service Session Window Gate
    const waStatus = SuppressionEngine.checkWhatsAppWindow(now, lastInboundMessageAt);
    if (waStatus === 'outside_24h') {
      const templateName = ProactiveTemplateRegistry.getTemplateName(opportunity.type);
      if (!templateName) {
        return {
          status: 'suppressed',
          reason: 'WhatsApp 24-hour session window expired; pre-approved Meta Template required for outbound contact',
          suppressionReason: 'whatsapp_window_expired_template_required',
          deliveryMode,
          opportunity,
        };
      }
    }
    if (waStatus === 'unknown') {
      return {
        status: 'suppressed',
        reason: 'WhatsApp last inbound message timestamp is unknown; outbound text suppressed conservatively',
        suppressionReason: 'unknown_inbound_time',
        deliveryMode,
        opportunity,
      };
    }

    // Gate 13: Authorized!
    return {
      status: 'allowed',
      reason: 'Out-of-turn proactive outreach authorized under policy',
      deliveryMode,
      opportunity,
    };
  }
}
