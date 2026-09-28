/**
 * WhatsApp Proactive Dispatch & Window Policy Types (Phase 7.4)
 *
 * Provides strongly-typed models for the WhatsApp 24-hour customer service window,
 * approved Meta templates, idempotent dispatch logging, and error classifications.
 */

import { DeliveryMode, ProactiveCandidateType } from '../proactive/types';

export type WhatsAppWindowState = 'within_24h' | 'outside_24h' | 'unknown';

export interface WhatsAppWindowEvaluation {
  readonly state: WhatsAppWindowState;
  readonly elapsedMs?: number;
  readonly remainingMs?: number;
  readonly lastInboundMessageAt?: Date;
  readonly evaluatedAt: Date;
  readonly isFreeformAllowed: boolean;
  readonly isTemplateRequired: boolean;
}

export type MetaErrorType = 'retryable' | 'non_retryable' | 'unknown';

export interface MetaErrorClassification {
  readonly type: MetaErrorType;
  readonly reason: string;
  readonly code?: number;
  readonly subcode?: number;
  readonly retryAfterSeconds?: number;
}

export type ProactiveDispatchStatus =
  | 'sent'
  | 'suppressed'
  | 'failed'
  | 'unknown'
  | 'duplicate'
  | 'template_unavailable'
  | 'window_expired'
  | 'mock_success'
  | 'configuration_missing';

export interface ProactiveDispatchResult {
  readonly status: ProactiveDispatchStatus;
  readonly actionId: string;
  readonly userId: string;
  readonly candidateType: ProactiveCandidateType;
  readonly deliveryMode: DeliveryMode;
  readonly payloadType?: 'freeform' | 'template';
  readonly windowState?: WhatsAppWindowState;
  readonly providerMessageId?: string;
  readonly reason?: string;
  readonly attemptCount?: number;
  readonly idempotencyKey?: string;
  readonly isRetryable?: boolean;
}

export interface MetaTemplateParameter {
  readonly type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface MetaTemplateComponent {
  readonly type: 'header' | 'body' | 'button';
  readonly sub_type?: 'quick_reply' | 'url';
  readonly index?: string;
  readonly parameters: MetaTemplateParameter[];
}

export interface MetaTemplatePayload {
  readonly name: string;
  readonly language: {
    readonly code: string;
  };
  readonly components: MetaTemplateComponent[];
}

export interface ProactiveDispatchLogEntity {
  id: string;
  actionId: string;
  idempotencyKey: string;
  userId: string;
  deliveryMode: string;
  channel: string;
  payloadType: 'freeform' | 'template';
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'suppressed' | 'delivered' | 'read';
  providerMessageId?: string | null;
  attemptCount: number;
  lastError?: string | null;
  createdAt: Date;
  sentAt?: Date | null;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
  // Phase 7.5 Receipt & Attribution Fields
  deliveredAt?: Date | null;
  readAt?: Date | null;
  failedAt?: Date | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  respondedAt?: Date | null;
  respondedMessageId?: string | null;
  conversationId?: string | null;
}

export interface CreateDispatchLogInput {
  actionId: string;
  idempotencyKey: string;
  userId: string;
  deliveryMode: string;
  channel?: string;
  payloadType: 'freeform' | 'template';
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface TemplateDefinition {
  readonly candidateType: ProactiveCandidateType;
  readonly envConfigKey: string;
  readonly defaultTemplateName?: string;
  readonly supportedLanguages: readonly string[];
  readonly parameterKeys: readonly string[];
}
