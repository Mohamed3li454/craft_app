/**
 * Core type definitions for Craft Proactive Intelligence (Phases 7.1, 7.2 & 7.3)
 *
 * Strictly deterministic, concurrency-safe, and decoupled from outbound network dispatchers.
 */

import { ConversationState, ConversationMessage } from '../conversation/types';

export type ProactiveCandidateType =
  | 'unresolved_follow_up'
  | 'next_step_offer'
  | 'follow_up_offer';

export type SuggestionType =
  | 'next_step'
  | 'follow_up_offer'
  | 'none';

export type DeliveryMode = 'in_turn' | 'out_of_turn';

export type DecisionStatus = 'allowed' | 'suppressed' | 'deferred';

export type ProactiveUrgency = 'low' | 'medium' | 'high';

export type ProactiveActionStatus =
  | 'pending'
  | 'deferred'
  | 'claimed'
  | 'completed'
  | 'suppressed'
  | 'expired'
  | 'failed';

export type SuppressionReason =
  | 'safety_violation'
  | 'user_opted_out'
  | 'invalid_candidate'
  | 'issue_resolved'
  | 'no_consent'
  | 'quiet_hours'
  | 'user_recently_active'
  | 'cooldown_active'
  | 'rate_limit_exceeded'
  | 'duplicate_opportunity'
  | 'whatsapp_window_expired_template_required'
  | 'unknown_inbound_time'
  | 'suppressed_below_confidence_threshold';

export interface ProactiveOpportunity {
  readonly type: ProactiveCandidateType;
  readonly topic: string | null;
  readonly context: string;
  readonly confidence: number;
  readonly urgency: ProactiveUrgency;
  readonly reason: string;
}

export interface ProactiveCandidate {
  readonly opportunity: ProactiveOpportunity | null;
  readonly eligible: boolean;
  readonly suppressionReason?: SuppressionReason;
}

export interface ProactivePolicy {
  readonly shouldSuggest: boolean;
  readonly suggestionType: SuggestionType;
  readonly confidence: number;
  readonly urgency: ProactiveUrgency;
  readonly reason?: string;
  readonly guardrails: readonly string[];
}

export interface ProactiveDecision {
  readonly status: DecisionStatus;
  readonly reason: string;
  readonly suppressionReason?: SuppressionReason;
  readonly retryAt?: Date;
  readonly deliveryMode: DeliveryMode;
  readonly opportunity?: ProactiveOpportunity | null;
}

export interface ProactiveConsent {
  readonly hasExplicitOptOut: boolean;
  readonly allowsProactiveFollowUp: boolean;
  readonly userRequestedReminder: boolean;
}

export interface QuietHoursConfig {
  readonly startHour: number; // e.g. 22 (10:00 PM)
  readonly endHour: number;   // e.g. 8  (08:00 AM)
  readonly timezone: string;  // e.g. 'Africa/Cairo'
}

export interface ProactiveHistorySnapshot {
  readonly lastProactiveAt?: Date;
  readonly proactiveCountInRollingWindow: number;
  readonly recentOpportunities?: readonly string[];
}

export interface ProactiveDetectionInput {
  readonly query: string;
  readonly conversationState: ConversationState;
  readonly recentMessages?: readonly ConversationMessage[];
}

export interface EligibilityEvaluationInput {
  readonly opportunity: ProactiveOpportunity | null;
  readonly conversationState: ConversationState;
  readonly deliveryMode: DeliveryMode;
  readonly query?: string;
  readonly consent?: ProactiveConsent;
  readonly now?: Date;
  readonly quietHours?: QuietHoursConfig;
  readonly lastUserMessageAt?: Date;
  readonly lastInboundMessageAt?: Date;
  readonly historySnapshot?: ProactiveHistorySnapshot;
}

export interface ProactiveActionEntity {
  id: string;
  userId: string;
  conversationId?: string;
  candidateType: ProactiveCandidateType;
  topic: string | null;
  contextDigest: string;
  reason: string;
  status: ProactiveActionStatus;
  deliveryMode: DeliveryMode;
  eligibleAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
  attemptCount: number;
  lastError?: string | null;
  dedupKey: string;
  metadata?: Record<string, unknown>;
}

export interface CreateProactiveActionInput {
  userId: string;
  conversationId?: string;
  candidateType: ProactiveCandidateType;
  topic?: string | null;
  contextDigest: string;
  reason: string;
  deliveryMode?: DeliveryMode;
  eligibleAt?: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ProactiveDispatchIntent {
  readonly actionId: string;
  readonly userId: string;
  readonly conversationId?: string;
  readonly deliveryMode: DeliveryMode;
  readonly candidateType: ProactiveCandidateType;
  readonly topic: string | null;
  readonly contextDigest: string;
  readonly reason: string;
  readonly status: 'dispatch_ready';
  readonly createdAt: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface ProactiveSchedulerResult {
  readonly claimedCount: number;
  readonly dispatchedIntents: readonly ProactiveDispatchIntent[];
  readonly suppressedCount: number;
  readonly deferredCount: number;
  readonly expiredCount: number;
  readonly failedCount: number;
}
