import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { ConversationEntity, MessageEntity } from './types';
import { logger } from '../../core/logger';

import { UserRepository, normalizePhoneNumber } from './user.repo';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class ChatRepository {
  private inMemoryConversations: Map<string, ConversationEntity> = new Map();
  private inMemoryMessages: Map<string, MessageEntity[]> = new Map();

  constructor(
    private db: DatabaseManager = DatabaseManager.getInstance(),
    private userRepo: UserRepository = new UserRepository(db)
  ) {}

  public async getOrCreateConversation(
    userId: string,
    channel: 'flutter' | 'whatsapp',
    title = 'New Chat'
  ): Promise<ConversationEntity> {
    const pool = this.db.getPool();

    // Check if userId is already a UUID, or if it is or contains a phone number
    let userUuid: string;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      userUuid = userId;
    } else {
      const cleanPhone = normalizePhoneNumber(userId.replace(/^wa_/, ''));
      if (cleanPhone && cleanPhone.length >= 8) {
        const user = await this.userRepo.findOrCreateUserByPhone(cleanPhone);
        userUuid = user.id;
      } else {
        userUuid = toDeterministicUuid(userId);
      }
    }

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, userId]
        );

        const findRes = await pool.query(
          `SELECT id, user_id as "userId", channel, title, is_archived as "isArchived", created_at as "createdAt", updated_at as "updatedAt"
           FROM conversations 
           WHERE user_id = $1 AND channel = $2 AND is_archived = false 
           ORDER BY ${channel === 'whatsapp' ? 'created_at ASC' : 'updated_at DESC'} LIMIT 1`,
          [userUuid, channel]
        );

        if (findRes.rows.length > 0) {
          return findRes.rows[0];
        }

        const insertRes = await pool.query(
          `INSERT INTO conversations (id, user_id, channel, title) 
           VALUES ($1, $2, $3, $4) 
           RETURNING id, user_id as "userId", channel, title, is_archived as "isArchived", created_at as "createdAt", updated_at as "updatedAt"`,
          [uuidv4(), userUuid, channel, title]
        );
        return insertRes.rows[0];
      } catch (err: any) {
        logger.warn('Database query failed in getOrCreateConversation, using in-memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    for (const conv of this.inMemoryConversations.values()) {
      if (conv.userId === userId && conv.channel === channel && !conv.isArchived) {
        return conv;
      }
    }

    const newConv: ConversationEntity = {
      id: uuidv4(),
      userId,
      channel,
      title,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryConversations.set(newConv.id, newConv);
    return newConv;
  }

  private schemaChecked = false;

  private async ensureSchema() {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;
    try {
      await pool.query(`
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens_used INT DEFAULT 0;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS prompt_tokens INT DEFAULT 0;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS completion_tokens INT DEFAULT 0;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS model_name VARCHAR(100);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS latency_ms INT DEFAULT 0;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(50);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS tools_used VARCHAR(255);
      `);
      this.schemaChecked = true;
    } catch (err: any) {
      logger.debug('Schema check for messages table skipped', { error: err.message });
    }
  }

  public getInMemoryConversations(): Map<string, ConversationEntity> {
    return this.inMemoryConversations;
  }

  public getInMemoryMessages(): Map<string, MessageEntity[]> {
    return this.inMemoryMessages;
  }

  public async saveMessage(
    conversationId: string,
    senderRole: 'user' | 'assistant' | 'system' | 'tool',
    senderName: string,
    text: string,
    mediaUrl?: string,
    metadata?: {
      tokensUsed?: number;
      promptTokens?: number;
      completionTokens?: number;
      modelName?: string;
      latencyMs?: number;
      mediaType?: string;
      toolsUsed?: string;
    }
  ): Promise<MessageEntity> {
    const pool = this.db.getPool();
    const messageId = uuidv4();

    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(
          `INSERT INTO messages (id, conversation_id, sender_role, sender_name, text, media_url, tokens_used, prompt_tokens, completion_tokens, model_name, latency_ms, media_type, tools_used)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id, conversation_id as "conversationId", sender_role as "senderRole", sender_name as "senderName", text, media_url as "mediaUrl", tokens_used as "tokensUsed", prompt_tokens as "promptTokens", completion_tokens as "completionTokens", model_name as "modelName", latency_ms as "latencyMs", media_type as "mediaType", tools_used as "toolsUsed", created_at as "createdAt"`,
          [
            messageId,
            conversationId,
            senderRole,
            senderName,
            text,
            mediaUrl || null,
            metadata?.tokensUsed || 0,
            metadata?.promptTokens || 0,
            metadata?.completionTokens || 0,
            metadata?.modelName || null,
            metadata?.latencyMs || 0,
            metadata?.mediaType || null,
            metadata?.toolsUsed || null,
          ]
        );
        await pool.query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );
        return res.rows[0];
      } catch (err: any) {
        logger.warn('Database insert failed in saveMessage, using in-memory store', {
          error: err.message,
        });
      }
    }

    const newMsg: MessageEntity = {
      id: messageId,
      conversationId,
      senderRole,
      senderName,
      text,
      mediaUrl,
      mediaType: metadata?.mediaType,
      tokensUsed: metadata?.tokensUsed || 0,
      promptTokens: metadata?.promptTokens || 0,
      completionTokens: metadata?.completionTokens || 0,
      modelName: metadata?.modelName,
      latencyMs: metadata?.latencyMs || 0,
      toolsUsed: metadata?.toolsUsed,
      createdAt: new Date(),
    };

    const existing = this.inMemoryMessages.get(conversationId) || [];
    existing.push(newMsg);
    this.inMemoryMessages.set(conversationId, existing);
    return newMsg;
  }

  public async saveToolCall(
    agentRunId: string,
    conversationId: string,
    toolName: string,
    args: Record<string, any>,
    result: any,
    status: 'success' | 'failed' = 'success',
    errorMessage?: string
  ): Promise<void> {
    const pool = this.db.getPool();
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO agent_runs (id, conversation_id, user_prompt)
         VALUES ($1, $2, 'agent_run')
         ON CONFLICT (id) DO NOTHING`,
        [agentRunId, conversationId]
      );

      await pool.query(
        `INSERT INTO tool_calls (id, agent_run_id, tool_name, arguments, status, result, error_message, created_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          uuidv4(),
          agentRunId,
          toolName,
          JSON.stringify(args || {}),
          status,
          result ? JSON.stringify(result) : null,
          errorMessage || null,
        ]
      );
    } catch (err: any) {
      logger.warn('Database insert failed in saveToolCall', { error: err.message, toolName });
    }
  }

  public async getRecentMessages(
    conversationId: string,
    limit = 20
  ): Promise<MessageEntity[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(
          `SELECT id, conversation_id as "conversationId", sender_role as "senderRole", sender_name as "senderName", text, media_url as "mediaUrl", tokens_used as "tokensUsed", prompt_tokens as "promptTokens", completion_tokens as "completionTokens", model_name as "modelName", latency_ms as "latencyMs", media_type as "mediaType", tools_used as "toolsUsed", created_at as "createdAt"
           FROM messages 
           WHERE conversation_id = $1 
           ORDER BY created_at DESC 
           LIMIT $2`,
          [conversationId, limit]
        );
        return res.rows.reverse();
      } catch (err: any) {
        logger.warn('Database query failed in getRecentMessages, using in-memory store', {
          error: err.message,
        });
      }
    }

    const messages = this.inMemoryMessages.get(conversationId) || [];
    return messages.slice(-limit);
  }

  public async listConversations(userId: string): Promise<ConversationEntity[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id as "userId", channel, title, is_archived as "isArchived", created_at as "createdAt", updated_at as "updatedAt"
           FROM conversations 
           WHERE user_id = $1 
           ORDER BY updated_at DESC`,
          [userId]
        );
        return res.rows;
      } catch (err: any) {
        logger.warn('Database query failed in listConversations, using in-memory store', {
          error: err.message,
        });
      }
    }

    return Array.from(this.inMemoryConversations.values()).filter(
      (c) => c.userId === userId
    );
  }

  /**
   * Consolidates all fragmented WhatsApp conversations for a user into a single primary conversation.
   */
  public async consolidateWhatsAppConversations(userId: string): Promise<string | null> {
    const pool = this.db.getPool();
    if (!pool) return null;

    try {
      const userUuid = toDeterministicUuid(userId);
      const convs = await pool.query(
        `SELECT id FROM conversations WHERE user_id = $1 AND channel = 'whatsapp' ORDER BY created_at ASC`,
        [userUuid]
      );

      if (convs.rows.length <= 1) {
        return convs.rows[0]?.id || null;
      }

      const primaryId = convs.rows[0].id;
      const secondaryIds = convs.rows.slice(1).map((r: any) => r.id);

      // Move all messages to primary conversation
      await pool.query(
        `UPDATE messages SET conversation_id = $1 WHERE conversation_id = ANY($2::uuid[])`,
        [primaryId, secondaryIds]
      );

      // Archive secondary conversations
      await pool.query(
        `UPDATE conversations SET is_archived = true WHERE id = ANY($1::uuid[])`,
        [secondaryIds]
      );

      logger.info(`Consolidated [${secondaryIds.length}] WhatsApp conversations into primary [${primaryId}] for user [${userId}]`);
      return primaryId;
    } catch (err: any) {
      logger.warn('Failed to consolidate WhatsApp conversations', { error: err.message });
      return null;
    }
  }

  public async getConversationById(id: string): Promise<ConversationEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id as "userId", channel, title, is_archived as "isArchived", created_at as "createdAt", updated_at as "updatedAt"
           FROM conversations WHERE id = $1 LIMIT 1`,
          [id]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Database query failed in getConversationById', { error: err.message });
      }
    }
    return this.inMemoryConversations.get(id) || null;
  }

  public async getAllMessages(conversationId: string): Promise<MessageEntity[]> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, conversation_id as "conversationId", sender_role as "senderRole", sender_name as "senderName", text, media_url as "mediaUrl", tokens_used as "tokensUsed", prompt_tokens as "promptTokens", completion_tokens as "completionTokens", model_name as "modelName", latency_ms as "latencyMs", media_type as "mediaType", created_at as "createdAt"
           FROM messages 
           WHERE conversation_id = $1 
           ORDER BY created_at ASC`,
          [conversationId]
        );
        return res.rows;
      } catch (err: any) {
        logger.warn('Database query failed in getAllMessages', { error: err.message });
      }
    }
    return this.inMemoryMessages.get(conversationId) || [];
  }

  public async getUserConversationsDetailed(userIdOrPhone: string): Promise<any[]> {
    let userUuid: string;
    const cleanPhone = normalizePhoneNumber(userIdOrPhone.replace(/^wa_/, ''));
    if (cleanPhone && cleanPhone.length >= 8) {
      const user = await this.userRepo.findOrCreateUserByPhone(cleanPhone);
      userUuid = user.id;
    } else {
      userUuid = toDeterministicUuid(userIdOrPhone);
    }

    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT 
             c.id,
             c.user_id as "userId",
             c.channel,
             c.title,
             c.is_archived as "isArchived",
             c.created_at as "createdAt",
             c.updated_at as "updatedAt",
             COUNT(m.id) as "messagesCount",
             COALESCE(SUM(m.tokens_used), 0) as "totalTokens",
             (
               SELECT m2.text 
               FROM messages m2 
               WHERE m2.conversation_id = c.id 
               ORDER BY m2.created_at DESC 
               LIMIT 1
             ) as "lastMessage",
             (
               SELECT m2.created_at 
               FROM messages m2 
               WHERE m2.conversation_id = c.id 
               ORDER BY m2.created_at DESC 
               LIMIT 1
             ) as "lastMessageAt"
           FROM conversations c
           LEFT JOIN messages m ON m.conversation_id = c.id
           WHERE c.user_id = $1 AND c.is_archived = false
           GROUP BY c.id
           ORDER BY c.updated_at DESC`,
          [userUuid]
        );
        return res.rows.map((r: any) => ({
          ...r,
          messagesCount: parseInt(r.messagesCount || '0', 10),
          totalTokens: parseInt(r.totalTokens || '0', 10),
        }));
      } catch (err: any) {
        logger.warn('Database query failed in getUserConversationsDetailed', { error: err.message });
      }
    }

    const convs = Array.from(this.inMemoryConversations.values()).filter(
      (c) => (c.userId === userUuid || c.userId === userIdOrPhone) && !c.isArchived
    );
    return convs.map((c) => {
      const msgs = this.inMemoryMessages.get(c.id) || [];
      const lastMsg = msgs[msgs.length - 1];
      return {
        ...c,
        messagesCount: msgs.length,
        totalTokens: msgs.reduce((acc, m) => acc + (m.tokensUsed || 0), 0),
        lastMessage: lastMsg?.text || '',
        lastMessageAt: lastMsg?.createdAt || c.updatedAt,
      };
    });
  }
}
