/**
 * WhatsApp Outbound Webhook Receipts & Engagement Tracking Types (Phase 7.5)
 *
 * Provides strongly-typed models for Meta WhatsApp status webhook payloads,
 * monotonic delivery states, user response attribution, and engagement auditing.
 */

export type ProactiveReceiptStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown'
  | 'suppressed'
  | 'duplicate';

/**
 * Strictly monotonic status precedence rank.
 * Higher rank always supersedes lower rank; out-of-order receipt deliveries
 * must NEVER regress a higher rank status back to a lower one.
 */
export const RECEIPT_STATUS_RANK: Readonly<Record<string, number>> = Object.freeze({
  pending: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
});

export type ProactiveEngagementEventType =
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'user_replied';

export type AttributionSource =
  | 'meta_webhook'
  | 'inbound_message'
  | 'manual';

export interface MetaStatusError {
  readonly code: number;
  readonly title?: string;
  readonly message?: string;
  readonly error_data?: {
    readonly details?: string;
  };
}

export interface MetaStatusPayload {
  readonly id: string; // provider_message_id (wamid)
  readonly status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  readonly timestamp: string | number;
  readonly recipient_id?: string;
  readonly conversation?: {
    readonly id?: string;
    readonly expiration_timestamp?: string;
    readonly origin?: {
      readonly type?: string;
    };
  };
  readonly pricing?: Record<string, unknown>;
  readonly errors?: readonly MetaStatusError[];
}

export interface ProactiveReceipt {
  readonly providerMessageId: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
  readonly timestamp: Date;
  readonly recipientId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly rawPayload?: Record<string, unknown>;
}

export interface ProactiveEngagementEntity {
  readonly id: string;
  readonly dispatchId: string;
  readonly actionId?: string | null;
  readonly userId: string;
  readonly eventType: ProactiveEngagementEventType;
  readonly occurredAt: Date;
  readonly attributionSource: AttributionSource;
  readonly metadata?: Record<string, unknown>;
}

export interface CreateEngagementInput {
  readonly dispatchId: string;
  readonly actionId?: string | null;
  readonly userId: string;
  readonly eventType: ProactiveEngagementEventType;
  readonly occurredAt?: Date;
  readonly attributionSource?: AttributionSource;
  readonly metadata?: Record<string, unknown>;
}

export interface UserResponseAttributionInput {
  readonly userId: string;
  readonly text: string;
  readonly messageId?: string; // Inbound user wamid
  readonly conversationId?: string;
  readonly receivedAt?: Date;
  readonly attributionWindowMs?: number; // Defaults to 2 hours (7,200,000 ms)
  readonly activeTopic?: string | null;
  readonly isTopicSwitch?: boolean;
}

export type AttributionFailureReason =
  | 'attributed_successfully'
  | 'no_eligible_dispatch'
  | 'outside_attribution_window'
  | 'trivial_message'
  | 'topic_switch_detected'
  | 'already_attributed'
  | 'different_conversation';

export interface AttributionResult {
  readonly attributed: boolean;
  readonly dispatchId?: string;
  readonly actionId?: string;
  readonly reason: AttributionFailureReason;
}

export interface ReceiptProcessingResult {
  readonly providerMessageId: string;
  readonly updated: boolean;
  readonly currentStatus: string;
  readonly engagementRecorded: boolean;
  readonly reason?: string;
}
