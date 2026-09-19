import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { ConversationEntity, MessageEntity } from './types';
import { logger } from '../../core/logger';

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

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async getOrCreateConversation(
    userId: string,
    channel: 'flutter' | 'whatsapp',
    title = 'New Chat'
  ): Promise<ConversationEntity> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const userUuid = toDeterministicUuid(userId);
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

  public async saveMessage(
    conversationId: string,
    senderRole: 'user' | 'assistant' | 'system' | 'tool',
    senderName: string,
    text: string,
    mediaUrl?: string
  ): Promise<MessageEntity> {
    const pool = this.db.getPool();
    const messageId = uuidv4();

    if (pool) {
      try {
        const res = await pool.query(
          `INSERT INTO messages (id, conversation_id, sender_role, sender_name, text, media_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, conversation_id as "conversationId", sender_role as "senderRole", sender_name as "senderName", text, media_url as "mediaUrl", created_at as "createdAt"`,
          [messageId, conversationId, senderRole, senderName, text, mediaUrl || null]
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
      createdAt: new Date(),
    };

    const existing = this.inMemoryMessages.get(conversationId) || [];
    existing.push(newMsg);
    this.inMemoryMessages.set(conversationId, existing);
    return newMsg;
  }

  public async getRecentMessages(
    conversationId: string,
    limit = 20
  ): Promise<MessageEntity[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, conversation_id as "conversationId", sender_role as "senderRole", sender_name as "senderName", text, media_url as "mediaUrl", created_at as "createdAt"
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

    const list = this.inMemoryMessages.get(conversationId) || [];
    return list.slice(-limit);
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
}
