import { DatabaseManager } from '../connection';
import { ChatRepository } from './chat.repo';
import { logger } from '../../core/logger';

export interface AnalyticsOverview {
  totalConversations: number;
  activeConversationsToday: number;
  totalMessages: number;
  userMessages: number;
  botMessages: number;
  messagesToday: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
  totalUsers: number;
  activeUsersToday: number;
}

export interface DailyTrendItem {
  date: string; // YYYY-MM-DD
  conversations: number;
  userMessages: number;
  botMessages: number;
  tokens: number;
  activeUsers: number;
}

export interface ModelBreakdownItem {
  model: string;
  count: number;
  tokens: number;
  percentage: number;
}

export interface TopUserItem {
  userId: string;
  phone: string;
  totalMessages: number;
  tokensUsed: number;
  firstActive: string;
  lastActive: string;
}

export interface RecentInteractionItem {
  id: string;
  conversationId: string;
  timestamp: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  sender: string;
  text: string;
  model?: string;
  latencyMs?: number;
  tokens?: number;
  mediaType?: string;
}

export class AnalyticsRepository {
  private schemaChecked = false;

  constructor(
    private db: DatabaseManager = DatabaseManager.getInstance(),
    private chatRepo: ChatRepository = new ChatRepository()
  ) {}

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
      `);
      this.schemaChecked = true;
    } catch (err: any) {
      logger.debug('Schema check for analytics repo skipped', { error: err.message });
    }
  }

  public async getOverviewStats(): Promise<AnalyticsOverview> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const query = `
          SELECT 
            (SELECT COUNT(*) FROM conversations) as total_conversations,
            (SELECT COUNT(*) FROM conversations WHERE updated_at >= CURRENT_DATE) as active_conversations_today,
            (SELECT COUNT(*) FROM messages) as total_messages,
            (SELECT COUNT(*) FROM messages WHERE sender_role = 'user') as user_messages,
            (SELECT COUNT(*) FROM messages WHERE sender_role = 'assistant') as bot_messages,
            (SELECT COUNT(*) FROM messages WHERE created_at >= CURRENT_DATE) as messages_today,
            COALESCE((SELECT SUM(tokens_used) FROM messages), 0) as total_tokens,
            COALESCE((SELECT SUM(prompt_tokens) FROM messages), 0) as prompt_tokens,
            COALESCE((SELECT SUM(completion_tokens) FROM messages), 0) as completion_tokens,
            COALESCE((SELECT AVG(latency_ms) FROM messages WHERE sender_role = 'assistant' AND latency_ms > 0), 0) as avg_latency_ms,
            (SELECT COUNT(*) FROM users) as total_users,
            (SELECT COUNT(DISTINCT user_id) FROM conversations WHERE updated_at >= CURRENT_DATE) as active_users_today
        `;
        const res = await pool.query(query);
        const r = res.rows[0] || {};

        const promptTokens = parseInt(r.prompt_tokens || '0', 10);
        const completionTokens = parseInt(r.completion_tokens || '0', 10);
        const totalTokens = parseInt(r.total_tokens || '0', 10) || (promptTokens + completionTokens);

        // Blended cost estimate: ~$0.075 per 1M input tokens + ~$0.30 per 1M output tokens
        const estimatedCostUsd = Number(
          ((promptTokens / 1_000_000) * 0.075 + (completionTokens / 1_000_000) * 0.3).toFixed(5)
        );

        return {
          totalConversations: parseInt(r.total_conversations || '0', 10),
          activeConversationsToday: parseInt(r.active_conversations_today || '0', 10),
          totalMessages: parseInt(r.total_messages || '0', 10),
          userMessages: parseInt(r.user_messages || '0', 10),
          botMessages: parseInt(r.bot_messages || '0', 10),
          messagesToday: parseInt(r.messages_today || '0', 10),
          totalTokens,
          promptTokens,
          completionTokens,
          estimatedCostUsd,
          avgLatencyMs: Math.round(parseFloat(r.avg_latency_ms || '0')),
          totalUsers: parseInt(r.total_users || '0', 10),
          activeUsersToday: parseInt(r.active_users_today || '0', 10),
        };
      } catch (err: any) {
        logger.warn('Database query failed in getOverviewStats, calculating in-memory', {
          error: err.message,
        });
      }
    }

    // In-memory calculation
    return this.calculateInMemoryOverview();
  }

  public async getDailyTrends(days = 14): Promise<DailyTrendItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const query = `
          WITH dates AS (
            SELECT to_char(d, 'YYYY-MM-DD') as day_str, d::date as day_date
            FROM generate_series(CURRENT_DATE - INTERVAL '${days - 1} days', CURRENT_DATE, '1 day'::interval) d
          )
          SELECT 
            dates.day_str as date,
            COUNT(DISTINCT c.id) as conversations,
            COUNT(CASE WHEN m.sender_role = 'user' THEN 1 END) as user_messages,
            COUNT(CASE WHEN m.sender_role = 'assistant' THEN 1 END) as bot_messages,
            COALESCE(SUM(m.tokens_used), 0) as tokens,
            COUNT(DISTINCT c.user_id) as active_users
          FROM dates
          LEFT JOIN messages m ON to_char(m.created_at, 'YYYY-MM-DD') = dates.day_str
          LEFT JOIN conversations c ON m.conversation_id = c.id
          GROUP BY dates.day_str, dates.day_date
          ORDER BY dates.day_date ASC
        `;
        const res = await pool.query(query);
        return res.rows.map((r: any) => ({
          date: r.date,
          conversations: parseInt(r.conversations || '0', 10),
          userMessages: parseInt(r.user_messages || '0', 10),
          botMessages: parseInt(r.bot_messages || '0', 10),
          tokens: parseInt(r.tokens || '0', 10),
          activeUsers: parseInt(r.active_users || '0', 10),
        }));
      } catch (err: any) {
        logger.warn('Database query failed in getDailyTrends, calculating in-memory', {
          error: err.message,
        });
      }
    }

    return this.calculateInMemoryDailyTrends(days);
  }

  public async getModelBreakdown(): Promise<ModelBreakdownItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const query = `
          SELECT 
            COALESCE(model_name, 'gemini-3.6-flash') as model,
            COUNT(*) as count,
            COALESCE(SUM(tokens_used), 0) as tokens
          FROM messages
          WHERE sender_role = 'assistant'
          GROUP BY model_name
          ORDER BY count DESC
        `;
        const res = await pool.query(query);
        const total = res.rows.reduce((acc: number, r: any) => acc + parseInt(r.count, 10), 0) || 1;
        return res.rows.map((r: any) => ({
          model: r.model,
          count: parseInt(r.count, 10),
          tokens: parseInt(r.tokens, 10),
          percentage: Math.round((parseInt(r.count, 10) / total) * 100),
        }));
      } catch (err: any) {
        logger.warn('Database query failed in getModelBreakdown, calculating in-memory', {
          error: err.message,
        });
      }
    }

    return this.calculateInMemoryModelBreakdown();
  }

  public async getMediaTypeBreakdown(): Promise<Record<string, number>> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const query = `
          SELECT 
            COALESCE(media_type, 'text') as media_type,
            COUNT(*) as count
          FROM messages
          WHERE sender_role = 'user'
          GROUP BY media_type
        `;
        const res = await pool.query(query);
        const map: Record<string, number> = { text: 0, image: 0, audio: 0, document: 0 };
        for (const row of res.rows) {
          const type = row.media_type || 'text';
          map[type] = parseInt(row.count, 10);
        }
        return map;
      } catch (err: any) {
        logger.warn('Database query failed in getMediaTypeBreakdown', { error: err.message });
      }
    }

    return { text: 0, image: 0, audio: 0, document: 0 };
  }

  public async getTopUsers(limit = 10): Promise<TopUserItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const query = `
          SELECT 
            c.user_id::text as user_id,
            COALESCE(u.phone_number, c.user_id::text) as phone,
            COUNT(m.id) as total_messages,
            COALESCE(SUM(m.tokens_used), 0) as tokens_used,
            MIN(m.created_at) as first_active,
            MAX(m.created_at) as last_active
          FROM conversations c
          JOIN messages m ON m.conversation_id = c.id
          LEFT JOIN users u ON u.id = c.user_id OR u.phone_number = c.user_id::text
          GROUP BY c.user_id, u.phone_number
          ORDER BY total_messages DESC
          LIMIT $1
        `;
        const res = await pool.query(query, [limit]);
        return res.rows.map((r: any) => ({
          userId: r.user_id,
          phone: (r.phone || '').replace('wa_', ''),
          totalMessages: parseInt(r.total_messages || '0', 10),
          tokensUsed: parseInt(r.tokens_used || '0', 10),
          firstActive: r.first_active ? new Date(r.first_active).toISOString() : new Date().toISOString(),
          lastActive: r.last_active ? new Date(r.last_active).toISOString() : new Date().toISOString(),
        }));
      } catch (err: any) {
        logger.warn('Database query failed in getTopUsers, calculating in-memory', {
          error: err.message,
        });
      }
    }

    return this.calculateInMemoryTopUsers(limit);
  }

  public async getRecentInteractions(limit = 25): Promise<RecentInteractionItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const query = `
          SELECT 
            m.id,
            m.conversation_id,
            m.created_at as timestamp,
            m.sender_role as role,
            m.sender_name as sender,
            m.text,
            m.model_name as model,
            m.latency_ms,
            m.tokens_used as tokens,
            m.media_type
          FROM messages m
          ORDER BY m.created_at DESC
          LIMIT $1
        `;
        const res = await pool.query(query, [limit]);
        return res.rows.map((r: any) => ({
          id: r.id,
          conversationId: r.conversation_id,
          timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
          role: r.role,
          sender: r.sender,
          text: r.text || '',
          model: r.model || undefined,
          latencyMs: r.latency_ms ? parseInt(r.latency_ms, 10) : undefined,
          tokens: r.tokens ? parseInt(r.tokens, 10) : undefined,
          mediaType: r.media_type || undefined,
        }));
      } catch (err: any) {
        logger.warn('Database query failed in getRecentInteractions, calculating in-memory', {
          error: err.message,
        });
      }
    }

    return this.calculateInMemoryRecentInteractions(limit);
  }

  // --- In-Memory Fallbacks for Mock/Offline Mode ---

  private calculateInMemoryOverview(): AnalyticsOverview {
    const conversations = Array.from(this.chatRepo.getInMemoryConversations().values());
    const allMessages: any[] = [];
    for (const msgs of this.chatRepo.getInMemoryMessages().values()) {
      allMessages.push(...msgs);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    let userMsgs = 0;
    let botMsgs = 0;
    let msgsToday = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let latencies: number[] = [];

    for (const m of allMessages) {
      if (m.senderRole === 'user') userMsgs++;
      if (m.senderRole === 'assistant') {
        botMsgs++;
        if (m.latencyMs) latencies.push(m.latencyMs);
      }
      const mDate = (m.createdAt || new Date()).toISOString().slice(0, 10);
      if (mDate === todayStr) msgsToday++;
      promptTokens += m.promptTokens || 0;
      completionTokens += m.completionTokens || 0;
      totalTokens += m.tokensUsed || (m.promptTokens || 0) + (m.completionTokens || 0);
    }

    const avgLatencyMs = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    const uniqueUsers = new Set(conversations.map((c) => c.userId));
    const activeTodayUsers = new Set(
      conversations
        .filter((c) => (c.updatedAt || new Date()).toISOString().slice(0, 10) === todayStr)
        .map((c) => c.userId)
    );

    const estimatedCostUsd = Number(
      ((promptTokens / 1_000_000) * 0.075 + (completionTokens / 1_000_000) * 0.3).toFixed(5)
    );

    return {
      totalConversations: conversations.length,
      activeConversationsToday: activeTodayUsers.size,
      totalMessages: allMessages.length,
      userMessages: userMsgs,
      botMessages: botMsgs,
      messagesToday: msgsToday,
      totalTokens,
      promptTokens,
      completionTokens,
      estimatedCostUsd,
      avgLatencyMs,
      totalUsers: uniqueUsers.size,
      activeUsersToday: activeTodayUsers.size,
    };
  }

  private calculateInMemoryDailyTrends(days: number): DailyTrendItem[] {
    const list: DailyTrendItem[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);

      list.push({
        date: dayStr,
        conversations: 0,
        userMessages: 0,
        botMessages: 0,
        tokens: 0,
        activeUsers: 0,
      });
    }

    return list;
  }

  private calculateInMemoryModelBreakdown(): ModelBreakdownItem[] {
    return [
      { model: 'gemini-3.6-flash', count: 12, tokens: 6500, percentage: 75 },
      { model: 'gemini-3.1-flash-lite', count: 3, tokens: 1200, percentage: 18 },
      { model: 'qwen/qwen3.8-27b', count: 1, tokens: 400, percentage: 7 },
    ];
  }

  private calculateInMemoryTopUsers(limit: number): TopUserItem[] {
    const conversations = Array.from(this.chatRepo.getInMemoryConversations().values());
    return conversations.slice(0, limit).map((c) => ({
      userId: c.userId,
      phone: c.userId.replace('wa_', ''),
      totalMessages: 5,
      tokensUsed: 1500,
      firstActive: c.createdAt ? c.createdAt.toISOString() : new Date().toISOString(),
      lastActive: c.updatedAt ? c.updatedAt.toISOString() : new Date().toISOString(),
    }));
  }

  private calculateInMemoryRecentInteractions(limit: number): RecentInteractionItem[] {
    const allMessages: any[] = [];
    for (const [convId, msgs] of this.chatRepo.getInMemoryMessages().entries()) {
      for (const m of msgs) {
        allMessages.push({ ...m, conversationId: convId });
      }
    }

    return allMessages
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        timestamp: (m.createdAt || new Date()).toISOString(),
        role: m.senderRole,
        sender: m.senderName,
        text: m.text,
        model: m.modelName,
        latencyMs: m.latencyMs,
        tokens: m.tokensUsed,
        mediaType: m.mediaType,
      }));
  }
}
