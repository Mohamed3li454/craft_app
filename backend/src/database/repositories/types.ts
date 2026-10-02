export interface UserEntity {
  id: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  bsuid?: string;
  isVip?: boolean;
  isBanned?: boolean;
  bannedAt?: Date | null;
  banReason?: string | null;
  createdAt: Date;
}

export interface ConversationEntity {
  id: string;
  userId: string;
  channel: 'flutter' | 'whatsapp';
  title: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageEntity {
  id: string;
  conversationId: string;
  senderRole: 'user' | 'assistant' | 'system' | 'tool';
  senderName: string;
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
  modelName?: string;
  latencyMs?: number;
  toolsUsed?: string;
  createdAt: Date;
}

export interface ConfirmationEntity {
  id: string;
  agentRunId: string;
  userId: string;
  actionName: string;
  description: string;
  payload: Record<string, any>;
  token: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt: Date;
  createdAt: Date;
}

export interface WebhookEventEntity {
  id: string;
  eventId: string;
  channel: string;
  payload: Record<string, any>;
  processed: boolean;
  receivedAt: Date;
}

export type ReminderState =
  | 'scheduled'
  | 'due'
  | 'claimed'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'retry_pending'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

export interface ReminderEntity {
  id: string;
  userId: string;
  title: string;
  dueAt?: Date | null;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly' | string;
  isCompleted: boolean;
  state: ReminderState;
  attempts: number;
  lockedUntil?: Date | null;
  lastError?: string | null;
  wamid?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

import {
  MemoryCategory,
  MemorySource,
  MemoryStatus,
  MemoryImportance,
  MemoryMetadata,
  TemporalState,
} from '../../modules/memory/types';

export interface MemoryItemEntity {
  id: string;
  userId: string;
  factText: string;
  category: MemoryCategory | string;
  status?: MemoryStatus;
  factKey?: string;
  source?: MemorySource;
  confidence?: number;
  importance?: MemoryImportance;
  temporalState?: TemporalState;
  validFrom?: Date | null;
  validUntil?: Date | null;
  metadata?: MemoryMetadata;
  createdAt: Date;
  updatedAt?: Date;
}

export * from '../../modules/memory/types';


