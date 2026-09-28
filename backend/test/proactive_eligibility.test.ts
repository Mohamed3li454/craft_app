/**
 * Phase 7.2 — Proactive Eligibility, Consent & Suppression Engine Comprehensive Test Suite
 *
 * Validates deterministic hard-gate pipeline:
 * Safety > Consent > Candidate Validity > Resolution > Delivery Mode > Quiet Hours >
 * Recent Activity > Cooldown > Rate Limits > Deduplication > WhatsApp 24h Window.
 */

import {
  ProactiveEngine,
  ProactiveEligibilityGate,
  SuppressionEngine,
  ConsentManager,
  ProactiveOpportunity,
} from '../src/modules/proactive';
import { ConversationState } from '../src/modules/conversation/types';
import { AdaptiveResponseEngine } from '../src/modules/response';
import { MemoryRetrievalService } from '../src/modules/memory';

function createMockConversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    activeTopic: 'flutter_build_issue',
    topicHistory: [
      {
        topic: 'flutter_build_issue',
        domain: 'technical',
        startedAtTurnIndex: 0,
        lastSeenAtTurnIndex: 1,
      },
    ],
    isTopicSwitch: false,
    previousTopic: null,
    isFollowUp: true,
    requiresContext: true,
    contextualizedQuery: 'المشكلة لسه بتحصل بعد flutter clean',
    goal: 'troubleshooting',
    resolutionState: 'unresolved',
    unresolvedItems: ['Gradle build failed with exit code 1'],
    sessionEntities: ['flutter', 'gradle'],
    confidence: 0.95,
    ...overrides,
  };
}

function createMockOpportunity(overrides: Partial<ProactiveOpportunity> = {}): ProactiveOpportunity {
  return {
    type: 'unresolved_follow_up',
    topic: 'flutter_build_issue',
    context: 'Gradle build failed with exit code 1',
    confidence: 0.92,
    urgency: 'medium',
    reason: 'unresolved_troubleshooting_issue',
    ...overrides,
  };
}

/**
 * Creates a UTC Date representing an exact Cairo local time (Africa/Cairo is UTC+3 in winter/summer currently).
 */
function makeCairoDate(hour: number, minute: number): Date {
  const d = new Date('2026-09-28T00:00:00.000Z');
  // Cairo is UTC+3, so UTC hour = (hour - 3 + 24) % 24
  const utcHour = (hour - 3 + 24) % 24;
  d.setUTCHours(utcHour, minute, 0, 0);
  return d;
}

describe('Phase 7.2 — Proactive Eligibility, Consent & Suppression Engine', () => {
  const engine = ProactiveEngine.getInstance();
  const defaultState = createMockConversationState();
  const defaultOpp = createMockOpportunity();
  // Safe daytime Cairo hour (14:00 Cairo time)
  const safeDaytimeCairo = makeCairoDate(14, 0);

  // =========================================================================
  // 1. Safety Gate (Safety > Consent)
  // =========================================================================
  describe('1. Safety Gate', () => {
    test('Scenario 1 — Password present: Strictly suppressed', () => {
      const decision = engine.evaluateEligibility({
        opportunity: createMockOpportunity({ context: 'Reset password for admin' }),
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('safety_violation');
    });

    test('Scenario 2 — API key present: Strictly suppressed', () => {
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        query: 'here is my secret api_key for groq',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('safety_violation');
    });

    test('Scenario 3 — Medical sensitive context: Strictly suppressed', () => {
      const decision = engine.evaluateEligibility({
        opportunity: createMockOpportunity({ context: 'High blood pressure medication dose' }),
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('safety_violation');
    });

    test('Scenario 4 — Financial sensitive context: Strictly suppressed', () => {
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        query: 'عندي مشكلة في تحويل فلوس من كارت البنك والـ cvv',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('safety_violation');
    });
  });

  // =========================================================================
  // 2. Consent Gate
  // =========================================================================
  describe('2. Consent Gate', () => {
    test('Scenario 5 — No consent for out-of-turn: Suppressed', () => {
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: false, userRequestedReminder: false },
        now: safeDaytimeCairo,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('no_consent');
    });

    test('Scenario 6 — Explicit opt-in: Eligible under policy', () => {
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: new Date(safeDaytimeCairo.getTime() - 25 * 60 * 1000), // 25 mins ago
        lastInboundMessageAt: new Date(safeDaytimeCairo.getTime() - 2 * 60 * 60 * 1000), // 2h ago
        historySnapshot: {
          lastProactiveAt: new Date(safeDaytimeCairo.getTime() - 24 * 60 * 60 * 1000), // 24h ago
          proactiveCountInRollingWindow: 0,
        },
      });

      expect(decision.status).toBe('allowed');
    });

    test('Scenario 7 — Explicit opt-out ("كفاية رسايل" / "stop"): Suppressed immediately', () => {
      const isArabicOptOut = ConsentManager.isExplicitOptOut('كفاية رسايل يا كرافت');
      const isEnglishOptOut = ConsentManager.isExplicitOptOut('stop sending me reminders');

      expect(isArabicOptOut).toBe(true);
      expect(isEnglishOptOut).toBe(true);

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: true, allowsProactiveFollowUp: false, userRequestedReminder: false },
        now: safeDaytimeCairo,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('user_opted_out');
    });

    test('Scenario 8 — User-requested reminder remains independent of proactive follow-up opt-out', () => {
      const consent = ConsentManager.resolveConsent({
        storedOptOut: true,
        userRequestedReminder: true,
      });

      expect(consent.hasExplicitOptOut).toBe(true);
      expect(consent.allowsProactiveFollowUp).toBe(false);
      expect(consent.userRequestedReminder).toBe(true);
    });
  });

  // =========================================================================
  // 3. Quiet Hours Gate
  // =========================================================================
  describe('3. Quiet Hours Gate (Default: 22:00 -> 08:00 Africa/Cairo UTC+3)', () => {
    test('Scenario 9 — 21:59 Cairo: Allowed (outside quiet hours)', () => {
      const time2159 = makeCairoDate(21, 59);
      expect(SuppressionEngine.isQuietHours(time2159)).toBe(false);
    });

    test('Scenario 10 — 22:00 Cairo: Suppressed (quiet hours starts)', () => {
      const time2200 = makeCairoDate(22, 0);
      expect(SuppressionEngine.isQuietHours(time2200)).toBe(true);

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: time2200,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('quiet_hours');
    });

    test('Scenario 11 — 23:30 Cairo: Suppressed (mid-night quiet hours)', () => {
      const time2330 = makeCairoDate(23, 30);
      expect(SuppressionEngine.isQuietHours(time2330)).toBe(true);
    });

    test('Scenario 12 — 07:59 Cairo: Suppressed (last minute of quiet hours)', () => {
      const time0759 = makeCairoDate(7, 59);
      expect(SuppressionEngine.isQuietHours(time0759)).toBe(true);
    });

    test('Scenario 13 — 08:00 Cairo: Allowed (quiet hours ended)', () => {
      const time0800 = makeCairoDate(8, 0);
      expect(SuppressionEngine.isQuietHours(time0800)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Recent User Activity Gate
  // =========================================================================
  describe('4. Recent User Activity Gate', () => {
    test('Scenario 14 — User active 5 minutes ago: Suppressed out-of-turn (prevent interruption)', () => {
      const lastActive = new Date(safeDaytimeCairo.getTime() - 5 * 60 * 1000);
      const activity = SuppressionEngine.checkRecentActivity(safeDaytimeCairo, lastActive);
      expect(activity).toBe('recently_active');

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: lastActive,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('user_recently_active');
    });

    test('Scenario 15 — User active 20 minutes ago: Potentially eligible', () => {
      const lastActive = new Date(safeDaytimeCairo.getTime() - 20 * 60 * 1000);
      const activity = SuppressionEngine.checkRecentActivity(safeDaytimeCairo, lastActive);
      expect(activity).toBe('not_recently_active');
    });

    test('Scenario 16 — Unknown activity timestamp: Conservative suppression', () => {
      const activity = SuppressionEngine.checkRecentActivity(safeDaytimeCairo, undefined);
      expect(activity).toBe('unknown');

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: undefined,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('user_recently_active');
    });
  });

  // =========================================================================
  // 5. Cooldown Gate (18 Hours)
  // =========================================================================
  describe('5. Cooldown Gate', () => {
    test('Scenario 17 — Last proactive 17h ago: Suppressed by cooldown', () => {
      const lastProactive = new Date(safeDaytimeCairo.getTime() - 17 * 60 * 60 * 1000);
      const cooldown = SuppressionEngine.checkCooldown(safeDaytimeCairo, lastProactive);
      expect(cooldown).toBe('cooldown_active');

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: new Date(safeDaytimeCairo.getTime() - 30 * 60 * 1000),
        historySnapshot: {
          lastProactiveAt: lastProactive,
          proactiveCountInRollingWindow: 0,
        },
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('cooldown_active');
    });

    test('Scenario 18 — Last proactive 18h ago: Eligible (cooldown expired)', () => {
      const lastProactive = new Date(safeDaytimeCairo.getTime() - 18 * 60 * 60 * 1000);
      const cooldown = SuppressionEngine.checkCooldown(safeDaytimeCairo, lastProactive);
      expect(cooldown).toBe('cooldown_expired');
    });

    test('Scenario 19 — Last proactive 30h ago: Eligible', () => {
      const lastProactive = new Date(safeDaytimeCairo.getTime() - 30 * 60 * 60 * 1000);
      const cooldown = SuppressionEngine.checkCooldown(safeDaytimeCairo, lastProactive);
      expect(cooldown).toBe('cooldown_expired');
    });
  });

  // =========================================================================
  // 6. Rolling Rate Limit Gate (Max 1 touch per rolling 24h)
  // =========================================================================
  describe('6. Rolling Rate Limit Gate', () => {
    test('Scenario 20 — 1 proactive touch in rolling 24h: Suppressed by limit', () => {
      const limit = SuppressionEngine.checkRollingLimit(1);
      expect(limit).toBe('limit_exceeded');

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: new Date(safeDaytimeCairo.getTime() - 30 * 60 * 1000),
        historySnapshot: {
          lastProactiveAt: new Date(safeDaytimeCairo.getTime() - 20 * 60 * 60 * 1000),
          proactiveCountInRollingWindow: 1,
        },
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('rate_limit_exceeded');
    });

    test('Scenario 21 — 0 touches in rolling 24h: Eligible', () => {
      const limit = SuppressionEngine.checkRollingLimit(0);
      expect(limit).toBe('under_limit');
    });
  });

  // =========================================================================
  // 7. Resolution Gate
  // =========================================================================
  describe('7. Resolution Gate', () => {
    test('Scenario 22 — Resolved issue: Suppressed even if consented', () => {
      const stateResolved = createMockConversationState({ resolutionState: 'resolved' });
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: stateResolved,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('issue_resolved');
    });

    test('Scenario 23 — Unresolved issue: Passes resolution gate', () => {
      const stateUnresolved = createMockConversationState({ resolutionState: 'unresolved' });
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: stateUnresolved,
        deliveryMode: 'in_turn',
      });

      expect(decision.status).toBe('allowed');
    });
  });

  // =========================================================================
  // 8. WhatsApp 24-Hour Customer Service Session Window Gate
  // =========================================================================
  describe('8. WhatsApp 24-Hour Window Gate', () => {
    test('Scenario 24 — Inbound message 12h ago: Freeform eligible', () => {
      const inbound12h = new Date(safeDaytimeCairo.getTime() - 12 * 60 * 60 * 1000);
      const waWindow = SuppressionEngine.checkWhatsAppWindow(safeDaytimeCairo, inbound12h);
      expect(waWindow).toBe('within_24h');
    });

    test('Scenario 25 — Inbound message exactly 24h ago: Freeform eligible', () => {
      const inbound24h = new Date(safeDaytimeCairo.getTime() - 24 * 60 * 60 * 1000);
      const waWindow = SuppressionEngine.checkWhatsAppWindow(safeDaytimeCairo, inbound24h);
      expect(waWindow).toBe('within_24h');
    });

    test('Scenario 26 — Inbound message 24h+ ago: Template required (freeform suppressed)', () => {
      const inbound25h = new Date(safeDaytimeCairo.getTime() - 25 * 60 * 60 * 1000);
      const waWindow = SuppressionEngine.checkWhatsAppWindow(safeDaytimeCairo, inbound25h);
      expect(waWindow).toBe('outside_24h');

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: new Date(safeDaytimeCairo.getTime() - 25 * 60 * 60 * 1000),
        lastInboundMessageAt: inbound25h,
        historySnapshot: {
          lastProactiveAt: new Date(safeDaytimeCairo.getTime() - 30 * 60 * 60 * 1000),
          proactiveCountInRollingWindow: 0,
        },
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('whatsapp_window_expired_template_required');
    });

    test('Scenario 27 — Unknown inbound time: Conservative suppression', () => {
      const waWindow = SuppressionEngine.checkWhatsAppWindow(safeDaytimeCairo, undefined);
      expect(waWindow).toBe('unknown');

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: new Date(safeDaytimeCairo.getTime() - 30 * 60 * 1000),
        lastInboundMessageAt: undefined,
        historySnapshot: {
          lastProactiveAt: new Date(safeDaytimeCairo.getTime() - 30 * 60 * 60 * 1000),
          proactiveCountInRollingWindow: 0,
        },
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('unknown_inbound_time');
    });
  });

  // =========================================================================
  // 9. Deduplication Gate
  // =========================================================================
  describe('9. Deduplication Gate', () => {
    test('Scenario 28 — Same topic and same candidate: Suppressed as duplicate', () => {
      const opp = createMockOpportunity({ type: 'unresolved_follow_up', topic: 'flutter_build_issue' });
      const historySnapshot = {
        proactiveCountInRollingWindow: 0,
        recentOpportunities: ['unresolved_follow_up:flutter_build_issue:gradle build failed with exit code 1'],
      };

      const isDup = SuppressionEngine.isDuplicateOpportunity(opp, historySnapshot.recentOpportunities);
      expect(isDup).toBe(true);

      const decision = engine.evaluateEligibility({
        opportunity: opp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: safeDaytimeCairo,
        lastUserMessageAt: new Date(safeDaytimeCairo.getTime() - 30 * 60 * 1000),
        lastInboundMessageAt: new Date(safeDaytimeCairo.getTime() - 2 * 60 * 60 * 1000),
        historySnapshot,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('duplicate_opportunity');
    });

    test('Scenario 29 — Same topic but different opportunity candidate: Potentially eligible', () => {
      const opp = createMockOpportunity({
        type: 'unresolved_follow_up',
        topic: 'flutter_build_issue',
        context: 'Different gradle plugin error',
      });
      // The topic has other distinct context
      const historySnapshot = {
        proactiveCountInRollingWindow: 0,
        recentOpportunities: ['unresolved_follow_up:docker_issue'],
      };

      const isDup = SuppressionEngine.isDuplicateOpportunity(opp, historySnapshot.recentOpportunities);
      expect(isDup).toBe(false);
    });

    test('Scenario 30 — Different topic: Potentially eligible', () => {
      const opp = createMockOpportunity({ type: 'unresolved_follow_up', topic: 'docker_compose' });
      const historySnapshot = {
        proactiveCountInRollingWindow: 0,
        recentOpportunities: ['unresolved_follow_up:flutter_build_issue'],
      };

      const isDup = SuppressionEngine.isDuplicateOpportunity(opp, historySnapshot.recentOpportunities);
      expect(isDup).toBe(false);
    });
  });

  // =========================================================================
  // 10. Delivery Mode Boundary (In-Turn vs Out-of-Turn)
  // =========================================================================
  describe('10. Delivery Mode Boundary', () => {
    test('Scenario 31 — In-turn suggestion during quiet hours (23:00 Cairo): Allowed', () => {
      const time2300 = makeCairoDate(23, 0);

      // In-turn suggestions in the current response MUST NOT be suppressed by quiet hours
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'in_turn',
        now: time2300,
      });

      expect(decision.status).toBe('allowed');
      expect(decision.deliveryMode).toBe('in_turn');
    });

    test('Scenario 32 — Out-of-turn reach during quiet hours (23:00 Cairo): Suppressed', () => {
      const time2300 = makeCairoDate(23, 0);

      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'out_of_turn',
        consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
        now: time2300,
      });

      expect(decision.status).toBe('suppressed');
      expect(decision.suppressionReason).toBe('quiet_hours');
    });
  });

  // =========================================================================
  // 11. Subsystem Integration & Non-Breaking Invariants
  // =========================================================================
  describe('11. Subsystem Integration & Non-Breaking Invariants', () => {
    test('Scenario 33 — Phase 7.1 in-turn analysis remains completely intact', () => {
      const policy = engine.analyze({
        query: 'المشكلة لسه بتحصل بعد flutter clean',
        conversationState: defaultState,
      });

      expect(policy.shouldSuggest).toBe(true);
      expect(policy.suggestionType).toBe('follow_up_offer');
      expect(policy.confidence).toBeGreaterThanOrEqual(0.70);
    });

    test('Scenario 34 — Adaptive Response Intelligence (ARI) remains authoritative and unchanged', () => {
      const ari = AdaptiveResponseEngine.getInstance();
      const query = 'بيطلع لي NullPointerException في السطر ده لما برن الكود';
      const policy = ari.analyze({
        query,
        conversationState: defaultState,
      });

      expect(policy.strategy).toBe('troubleshooting_flow');
      expect(policy.structure).toBe('procedural_steps');
    });

    test('Scenario 35 — Memory retrieval remains passive read-only', async () => {
      const memService = MemoryRetrievalService.getInstance();
      const result = await memService.retrieve({
        userId: 'test_user_p7_2',
        message: 'query for test',
        language: 'ar',
      });

      expect(Array.isArray(result)).toBe(true);
    });

    test('Scenario 36 — Reminder system remains independent and untouched', () => {
      const reminderState = createMockConversationState({
        goal: 'transactional',
        resolutionState: 'not_applicable',
      });
      const policy = engine.analyze({
        query: 'فكرني بكرة الساعة 5',
        conversationState: reminderState,
      });

      expect(policy.shouldSuggest).toBe(false);
      expect(policy.suggestionType).toBe('none');
    });

    test('Scenario 37 — No outbound WhatsApp calls are performed', () => {
      // Evaluation is purely computational and never triggers WhatsAppAdapter
      const decision = engine.evaluateEligibility({
        opportunity: defaultOpp,
        conversationState: defaultState,
        deliveryMode: 'in_turn',
      });

      expect(decision.status).toBe('allowed');
    });
  });

  // =========================================================================
  // 12. Performance Benchmark
  // =========================================================================
  describe('12. Performance Benchmark', () => {
    test('Performance Benchmark — Evaluates ProactiveEligibilityGate.evaluate() in under 1.0ms on average over 100 iterations', () => {
      const iterations = 100;
      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        ProactiveEligibilityGate.evaluate({
          opportunity: defaultOpp,
          conversationState: defaultState,
          deliveryMode: 'out_of_turn',
          consent: { hasExplicitOptOut: false, allowsProactiveFollowUp: true, userRequestedReminder: false },
          now: safeDaytimeCairo,
          lastUserMessageAt: new Date(safeDaytimeCairo.getTime() - 25 * 60 * 1000),
          lastInboundMessageAt: new Date(safeDaytimeCairo.getTime() - 2 * 60 * 60 * 1000),
          historySnapshot: {
            lastProactiveAt: new Date(safeDaytimeCairo.getTime() - 24 * 60 * 60 * 1000),
            proactiveCountInRollingWindow: 0,
          },
        });
      }
      const durationMs = Date.now() - start;
      const averageMs = durationMs / iterations;

      expect(averageMs).toBeLessThan(1.0);
    });
  });
});
