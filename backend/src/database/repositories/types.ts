export interface UserEntity {
  id: string;
  name: string;
  email?: string;
  phoneNumber?: string;
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

export interface ReminderEntity {
  id: string;
  userId: string;
  title: string;
  dueAt?: Date | null;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly' | string;
  isCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryItemEntity {
  id: string;
  userId: string;
  factText: string;
  category: string;
  createdAt: Date;
}


