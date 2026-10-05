import { DatabaseManager } from '../connection';
import { ChatRepository } from './chat.repo';
import { UserRepository, normalizePhoneNumber } from './user.repo';
import { logger } from '../../core/logger';
import { config } from '../../config/env';

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
  modelCosts: {
    groqPrimary: number;
    groqFallback: number;
    groqQwen: number;
    geminiFlash?: number;
    geminiFlashLite?: number;
  };
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
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

export interface HourlyDistributionItem {
  hour: number; // 0..23
  userMessages: number;
  botMessages: number;
  totalMessages: number;
}

export interface ModelBreakdownItem {
  model: string;
  count: number;
  tokens: number;
  percentage: number;
}

export interface TopUserItem {
  id?: string;
  userId: string;
  phone: string;
  phoneNumber?: string;
  name: string;
  isVip?: boolean;
  isBanned?: boolean;
  bannedAt?: string;
  banReason?: string;
  dailyMessageCount?: number;
  messageCount?: number;
  totalMessages: number;
  conversationCount?: number;
  reminderCount?: number;
  tokensUsed: number;
  estimatedCostUsd: number;
  firstActive: string;
  lastActive?: string;
  lastActiveAt?: string;
  createdAt?: string;
}

export interface ConversationListItem {
  id: string;
  userId: string;
  phone: string;
  userPhone?: string;
  userName: string;
  channel: 'flutter' | 'whatsapp';
  title: string;
  isArchived?: boolean;
  status?: string;
  messagesCount: number;
  messageCount?: number;
  tokensUsed: number;
  lastMessage: string;
  lastMessageSnippet?: string;
  lastMessageAt: string;
  updatedAt?: string;
  createdAt: string;
}

export interface ToolCallDetailItem {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
  result: any;
  status: string;
  durationMs?: number;
  createdAt?: string;
}

export interface ConversationMessageMetadata {
  model?: string | null;
  tokens?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  tools?: string[];
  source?: 'ai' | 'semantic-cache' | 'system';
  toolCalls?: ToolCallDetailItem[];
}

export interface RecentInteractionItem {
  id: string;
  conversationId: string;
  timestamp: string;
  createdAt?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  sender: string;
  text: string;
  content?: string;
  model?: string | null;
  latencyMs?: number | null;
  tokens?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  mediaType?: string;
  mediaUrl?: string;
  toolsUsed?: string | null;
  source?: 'ai' | 'semantic-cache' | 'system';
  toolCalls?: ToolCallDetailItem[];
  metadata?: ConversationMessageMetadata;
}

export type ConversationTranscriptResult = RecentInteractionItem[] & {
  messages: RecentInteractionItem[];
  total: number;
};

export interface UserDetailsResponse {
  user: {
    id: string;
    name: string;
    phoneNumber?: string;
    email?: string;
    bsuid?: string;
    isVip?: boolean;
    isBanned?: boolean;
    bannedAt?: string;
    banReason?: string;
    createdAt: string;
  };
  whatsappContact?: {
    waId: string;
    profileName?: string;
    verified: boolean;
    bsuid?: string;
  } | null;
  preferences?: Record<string, string>;
  stats?: {
    totalConversations: number;
    totalMessages: number;
    totalReminders: number;
    activeReminders: number;
    memoryCount: number;
    tokenCount: number;
    costUsd: number;
  };
  metrics: {
    totalConversations: number;
    totalMessages: number;
    tokensUsed: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    dailyMessageCount?: number;
    lastActive?: string;
    memoryCount?: number;
    reminderCount?: number;
    activeRemindersCount?: number;
  };
  memories: { id: string; key?: string; value?: string; factText: string; category: string; createdAt: string }[];
  reminders: { id: string; title: string; dueAt?: string; scheduledTime?: string; recurrence: string; isCompleted: boolean; state?: string; status?: string; createdAt: string }[];
  recentConversations?: ConversationListItem[];
  conversations: ConversationListItem[];
}

export interface ToolsStatsResponse {
  totalWebSearches: number;
  recentSearches: { query: string; timestamp: string }[];
  totalRemindersCreated: number;
  recurringRemindersCount: number;
  totalAudioTranscribed: number;
  confirmations: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  };
}

export class AnalyticsRepository {
  private schemaChecked = false;

  constructor(
    private db: DatabaseManager = DatabaseManager.getInstance(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private userRepo: UserRepository = new UserRepository(db)
  ) {}

  private async ensureSchema() {
    // Phase 10.1: Analytical read paths MUST NOT execute DDL mutations (ALTER TABLE).
    // Schema alterations belong strictly in versioned database migrations.
    this.schemaChecked = true;
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
            COALESCE((SELECT AVG(latency_ms) FROM messages WHERE sender_role = 'assistant' AND latency_ms > 0), 0) as avg_latency,
            COALESCE((SELECT MIN(latency_ms) FROM messages WHERE sender_role = 'assistant' AND latency_ms > 0), 0) as min_latency,
            COALESCE((SELECT MAX(latency_ms) FROM messages WHERE sender_role = 'assistant' AND latency_ms > 0), 0) as max_latency,
            (SELECT COUNT(DISTINCT user_id) FROM conversations) as total_users,
            (SELECT COUNT(DISTINCT user_id) FROM conversations WHERE updated_at >= CURRENT_DATE) as active_users_today
        `;
        const res = await pool.query(query);
        const row = res.rows[0] || {};

        const promptTok = parseInt(row.prompt_tokens || '0', 10);
        const compTok = parseInt(row.completion_tokens || '0', 10);
        const totalTok = parseInt(row.total_tokens || '0', 10) || (promptTok + compTok);

        // Fetch model-specific tokens for precise cost calculation
        const modelCostQuery = `
          SELECT
            COALESCE(model_name, 'openai/gpt-oss-120b') as model,
            COALESCE(SUM(prompt_tokens), 0) as pt,
            COALESCE(SUM(completion_tokens), 0) as ct
          FROM messages
          WHERE sender_role = 'assistant'
          GROUP BY model_name
        `;
        const modelRes = await pool.query(modelCostQuery);
        let groqPrimaryCost = 0;
        let groqFallbackCost = 0;
        let groqQwenCost = 0;

        for (const m of modelRes.rows) {
          const pt = parseInt(m.pt, 10);
          const ct = parseInt(m.ct, 10);
          const name = (m.model || '').toLowerCase();
          if (name.includes('qwen')) {
            groqQwenCost += (pt / 1_000_000) * 0.15 + (ct / 1_000_000) * 0.6;
          } else if (name.includes('20b') || name.includes('8b') || name.includes('lite') || name.includes('fallback')) {
            groqFallbackCost += (pt / 1_000_000) * 0.05 + (ct / 1_000_000) * 0.1;
          } else {
            // Primary Groq model (e.g. 120b, 70b, or default)
            groqPrimaryCost += (pt / 1_000_000) * 0.15 + (ct / 1_000_000) * 0.6;
          }
        }

        const totalCost = Number((groqPrimaryCost + groqFallbackCost + groqQwenCost).toFixed(5));

        return {
          totalConversations: parseInt(row.total_conversations || '0', 10),
          activeConversationsToday: parseInt(row.active_conversations_today || '0', 10),
          totalMessages: parseInt(row.total_messages || '0', 10),
          userMessages: parseInt(row.user_messages || '0', 10),
          botMessages: parseInt(row.bot_messages || '0', 10),
          messagesToday: parseInt(row.messages_today || '0', 10),
          totalTokens: totalTok,
          promptTokens: promptTok,
          completionTokens: compTok,
          estimatedCostUsd: totalCost,
          modelCosts: {
            groqPrimary: Number(groqPrimaryCost.toFixed(5)),
            groqFallback: Number(groqFallbackCost.toFixed(5)),
            groqQwen: Number(groqQwenCost.toFixed(5)),
            geminiFlash: Number(groqPrimaryCost.toFixed(5)),
            geminiFlashLite: Number(groqFallbackCost.toFixed(5)),
          },
          avgLatencyMs: Math.round(parseFloat(row.avg_latency || '0')),
          minLatencyMs: Math.round(parseFloat(row.min_latency || '0')),
          maxLatencyMs: Math.round(parseFloat(row.max_latency || '0')),
          totalUsers: parseInt(row.total_users || '0', 10),
          activeUsersToday: parseInt(row.active_users_today || '0', 10),
        };
      } catch (err: any) {
        logger.error('Database query failed in getOverviewStats', {
          error: err.message,
        });
        if (config.nodeEnv === 'production') {
          throw new Error(`Database error in getOverviewStats: ${err.message}`);
        }
      }
    }

    return this.calculateInMemoryOverview();
  }

  public async getDailyTrends(days = 14): Promise<DailyTrendItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const query = `
          WITH dates AS (
            SELECT generate_series(
              CURRENT_DATE - INTERVAL '${days - 1} days',
              CURRENT_DATE,
              '1 day'::interval
            )::date AS day
          )
          SELECT
            d.day::text as date,
            COALESCE(COUNT(DISTINCT c.id), 0) as conversations,
            COALESCE(COUNT(CASE WHEN m.sender_role = 'user' THEN 1 END), 0) as user_messages,
            COALESCE(COUNT(CASE WHEN m.sender_role = 'assistant' THEN 1 END), 0) as bot_messages,
            COALESCE(SUM(m.tokens_used), 0) as tokens,
            COALESCE(COUNT(DISTINCT c.user_id), 0) as active_users
          FROM dates d
          LEFT JOIN messages m ON m.created_at::date = d.day
          LEFT JOIN conversations c ON c.id = m.conversation_id
          GROUP BY d.day
          ORDER BY d.day ASC
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
        logger.error('Database query failed in getDailyTrends', {
          error: err.message,
        });
        if (config.nodeEnv === 'production') {
          throw new Error(`Database error in getDailyTrends: ${err.message}`);
        }
      }
    }

    return this.calculateInMemoryDailyTrends(days);
  }

  public async getHourlyDistribution(): Promise<HourlyDistributionItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const query = `
          SELECT
            EXTRACT(HOUR FROM created_at)::int as hour,
            COUNT(CASE WHEN sender_role = 'user' THEN 1 END) as user_messages,
            COUNT(CASE WHEN sender_role = 'assistant' THEN 1 END) as bot_messages,
            COUNT(*) as total_messages
          FROM messages
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY hour
          ORDER BY hour ASC
        `;
        const res = await pool.query(query);
        const map = new Map<number, { userMessages: number; botMessages: number; totalMessages: number }>();
        for (const row of res.rows) {
          map.set(row.hour, {
            userMessages: parseInt(row.user_messages || '0', 10),
            botMessages: parseInt(row.bot_messages || '0', 10),
            totalMessages: parseInt(row.total_messages || '0', 10),
          });
        }

        const result: HourlyDistributionItem[] = [];
        for (let h = 0; h < 24; h++) {
          const entry = map.get(h) || { userMessages: 0, botMessages: 0, totalMessages: 0 };
          result.push({ hour: h, ...entry });
        }
        return result;
      } catch (err: any) {
        logger.error('Database query failed in getHourlyDistribution', { error: err.message });
        if (config.nodeEnv === 'production') {
          throw new Error(`Database error in getHourlyDistribution: ${err.message}`);
        }
      }
    }

    // In-memory fallback: compute from in-memory messages deterministically (no random fake numbers)
    const map = new Map<number, { userMessages: number; botMessages: number; totalMessages: number }>();
    for (const msgs of this.chatRepo.getInMemoryMessages().values()) {
      for (const m of msgs) {
        const hour = new Date(m.createdAt || new Date()).getHours();
        const current = map.get(hour) || { userMessages: 0, botMessages: 0, totalMessages: 0 };
        if (m.senderRole === 'user') current.userMessages++;
        if (m.senderRole === 'assistant') current.botMessages++;
        current.totalMessages++;
        map.set(hour, current);
      }
    }
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      ...(map.get(i) || { userMessages: 0, botMessages: 0, totalMessages: 0 }),
    }));
  }

  public async getModelBreakdown(): Promise<ModelBreakdownItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const query = `
          SELECT
            COALESCE(model_name, 'openai/gpt-oss-120b') as model,
            COUNT(*) as count,
            COALESCE(SUM(tokens_used), 0) as tokens
          FROM messages
          WHERE sender_role = 'assistant'
          GROUP BY model_name
          ORDER BY count DESC
        `;
        const res = await pool.query(query);
        const total = res.rows.reduce((sum: number, r: any) => sum + parseInt(r.count, 10), 0);

        return res.rows.map((r: any) => {
          const count = parseInt(r.count, 10);
          return {
            model: r.model,
            count,
            tokens: parseInt(r.tokens || '0', 10),
            percentage: total > 0 ? Math.round((count / total) * 100) : 0,
          };
        });
      } catch (err: any) {
        logger.error('Database query failed in getModelBreakdown', {
          error: err.message,
        });
        if (config.nodeEnv === 'production') {
          throw new Error(`Database error in getModelBreakdown: ${err.message}`);
        }
      }
    }

    return this.calculateInMemoryModelBreakdown();
  }

  public async getMediaTypeBreakdown(): Promise<Record<string, number>> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
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

  public async getTopUsers(limit = 15): Promise<TopUserItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const query = `
          SELECT
            c.user_id::text as user_id,
            COALESCE(u.phone_number, wc.wa_id, c.user_id::text) as phone,
            COALESCE(u.name, wc.profile_name, 'User') as name,
            COALESCE(u.is_vip, false) as is_vip,
            COALESCE(u.daily_message_count, 0) as daily_message_count,
            COUNT(m.id) as total_messages,
            COALESCE(SUM(m.tokens_used), 0) as tokens_used,
            COALESCE(SUM(m.prompt_tokens), 0) as prompt_tokens,
            COALESCE(SUM(m.completion_tokens), 0) as completion_tokens,
            MIN(m.created_at) as first_active,
            MAX(m.created_at) as last_active
          FROM conversations c
          JOIN messages m ON m.conversation_id = c.id
          LEFT JOIN users u ON u.id = c.user_id OR u.phone_number = c.user_id::text
          LEFT JOIN whatsapp_contacts wc ON wc.user_id = c.user_id
          GROUP BY c.user_id, u.phone_number, wc.wa_id, u.name, wc.profile_name, u.is_vip, u.daily_message_count
          ORDER BY total_messages DESC
          LIMIT $1
        `;
        const res = await pool.query(query, [limit]);
        return res.rows.map((r: any) => {
          const pt = parseInt(r.prompt_tokens || '0', 10);
          const ct = parseInt(r.completion_tokens || '0', 10);
          const cost = Number(((pt / 1_000_000) * 0.1 + (ct / 1_000_000) * 0.4).toFixed(4));
          const phoneVal = (r.phone || '').replace(/^wa_/, '');

          return {
            id: r.user_id,
            userId: r.user_id,
            phone: phoneVal,
            phoneNumber: phoneVal,
            name: r.name || 'User',
            isVip: !!r.is_vip,
            dailyMessageCount: parseInt(r.daily_message_count || '0', 10),
            totalMessages: parseInt(r.total_messages || '0', 10),
            messageCount: parseInt(r.total_messages || '0', 10),
            tokensUsed: parseInt(r.tokens_used || '0', 10),
            estimatedCostUsd: cost,
            firstActive: r.first_active ? new Date(r.first_active).toISOString() : new Date().toISOString(),
            lastActive: r.last_active ? new Date(r.last_active).toISOString() : new Date().toISOString(),
            lastActiveAt: r.last_active ? new Date(r.last_active).toISOString() : undefined,
          };
        });
      } catch (err: any) {
        logger.warn('Database query failed in getTopUsers, calculating in-memory', {
          error: err.message,
        });
      }
    }

    return this.calculateInMemoryTopUsers(limit);
  }

  public async getUsersList(options: {
    search?: string;
    isVip?: boolean;
    isBanned?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ users: TopUserItem[]; total: number }> {
    const pool = this.db.getPool();
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);
    const search = options.search ? `%${options.search.trim()}%` : null;

    if (pool) {
      try {
        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];
        let pIdx = 1;

        if (search) {
          whereClauses.push(`(u.name ILIKE $${pIdx} OR u.phone_number ILIKE $${pIdx} OR u.bsuid ILIKE $${pIdx} OR wc.wa_id ILIKE $${pIdx})`);
          params.push(search);
          pIdx++;
        }
        if (typeof options.isVip === 'boolean') {
          whereClauses.push(`u.is_vip = $${pIdx}`);
          params.push(options.isVip);
          pIdx++;
        }
        if (typeof options.isBanned === 'boolean') {
          whereClauses.push(`COALESCE(u.is_banned, false) = $${pIdx}`);
          params.push(options.isBanned);
          pIdx++;
        }

        const whereSql = whereClauses.join(' AND ');

        const countQuery = `
          SELECT COUNT(DISTINCT u.id) as total
          FROM users u
          LEFT JOIN whatsapp_contacts wc ON wc.user_id = u.id
          WHERE ${whereSql}
        `;
        const countRes = await pool.query(countQuery, params);
        const total = parseInt(countRes.rows[0]?.total || '0', 10);

        const listQuery = `
          SELECT
            u.id as user_id,
            COALESCE(u.phone_number, wc.wa_id, '') as phone,
            COALESCE(u.name, wc.profile_name, 'User') as name,
            u.is_vip,
            u.is_banned,
            u.banned_at,
            u.ban_reason,
            u.daily_message_count,
            u.created_at,
            COALESCE(c_agg.total_conversations, 0) as total_conversations,
            COALESCE(m_agg.total_messages, 0) as total_messages,
            COALESCE(r_agg.total_reminders, 0) as total_reminders,
            COALESCE(m_agg.tokens_used, 0) as tokens_used,
            COALESCE(m_agg.prompt_tokens, 0) as prompt_tokens,
            COALESCE(m_agg.completion_tokens, 0) as completion_tokens,
            m_agg.first_active,
            m_agg.last_active
          FROM users u
          LEFT JOIN whatsapp_contacts wc ON wc.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COUNT(*) as total_conversations
            FROM conversations
            GROUP BY user_id
          ) c_agg ON c_agg.user_id = u.id
          LEFT JOIN (
            SELECT c.user_id,
              COUNT(m.id) as total_messages,
              COALESCE(SUM(m.tokens_used), 0) as tokens_used,
              COALESCE(SUM(m.prompt_tokens), 0) as prompt_tokens,
              COALESCE(SUM(m.completion_tokens), 0) as completion_tokens,
              MIN(m.created_at) as first_active,
              MAX(m.created_at) as last_active
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            GROUP BY c.user_id
          ) m_agg ON m_agg.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COUNT(*) as total_reminders
            FROM reminders
            GROUP BY user_id
          ) r_agg ON r_agg.user_id::text = u.id::text
          WHERE ${whereSql}
          ORDER BY m_agg.last_active DESC NULLS LAST, u.created_at DESC
          LIMIT $${pIdx} OFFSET $${pIdx + 1}
        `;
        params.push(limit, offset);

        const listRes = await pool.query(listQuery, params);
        const users: TopUserItem[] = listRes.rows.map((r: any) => {
          const pt = parseInt(r.prompt_tokens || '0', 10);
          const ct = parseInt(r.completion_tokens || '0', 10);
          const cost = Number(((pt / 1_000_000) * 0.1 + (ct / 1_000_000) * 0.4).toFixed(4));
          const phoneVal = (r.phone || '').replace(/^wa_/, '');
          return {
            id: r.user_id,
            userId: r.user_id,
            phone: phoneVal,
            phoneNumber: phoneVal,
            name: r.name || 'User',
            isVip: !!r.is_vip,
            isBanned: !!r.is_banned,
            bannedAt: r.banned_at ? new Date(r.banned_at).toISOString() : undefined,
            banReason: r.ban_reason || undefined,
            dailyMessageCount: parseInt(r.daily_message_count || '0', 10),
            totalMessages: parseInt(r.total_messages || '0', 10),
            messageCount: parseInt(r.total_messages || '0', 10),
            conversationCount: parseInt(r.total_conversations || '0', 10),
            reminderCount: parseInt(r.total_reminders || '0', 10),
            tokensUsed: parseInt(r.tokens_used || '0', 10),
            estimatedCostUsd: cost,
            firstActive: r.first_active ? new Date(r.first_active).toISOString() : (r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()),
            lastActive: r.last_active ? new Date(r.last_active).toISOString() : undefined,
            lastActiveAt: r.last_active ? new Date(r.last_active).toISOString() : undefined,
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
          };
        });

        return { users, total };
      } catch (err: any) {
        logger.warn('Database query failed in getUsersList, falling back to top users', { error: err.message });
      }
    }

    const top = await this.getTopUsers(limit);
    return { users: top, total: top.length };
  }

  public async getConversationsList(options: {
    search?: string;
    channel?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<ConversationListItem[]> {
    const pool = this.db.getPool();
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
    const offset = Math.max(options.offset || 0, 0);
    const channel = options.channel && options.channel !== 'all' ? options.channel : null;
    const search = options.search ? `%${options.search.trim()}%` : null;
    const includeArchived = !!options.includeArchived;

    if (pool) {
      try {
        const whereClauses: string[] = [];
        const params: any[] = [];
        let pIdx = 1;

        if (!includeArchived) {
          whereClauses.push(`c.is_archived = false`);
        }

        if (channel) {
          whereClauses.push(`c.channel = $${pIdx}`);
          params.push(channel);
          pIdx++;
        }

        if (options.userId) {
          whereClauses.push(`(c.user_id::text = $${pIdx} OR u.phone_number = $${pIdx} OR wc.wa_id = $${pIdx})`);
          params.push(options.userId);
          pIdx++;
        }

        if (options.startDate) {
          whereClauses.push(`c.created_at >= $${pIdx}::timestamptz`);
          params.push(options.startDate);
          pIdx++;
        }

        if (options.endDate) {
          whereClauses.push(`c.created_at <= $${pIdx}::timestamptz`);
          params.push(options.endDate);
          pIdx++;
        }

        if (search) {
          whereClauses.push(`(u.phone_number ILIKE $${pIdx} OR wc.wa_id ILIKE $${pIdx} OR u.name ILIKE $${pIdx} OR c.title ILIKE $${pIdx})`);
          params.push(search);
          pIdx++;
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const query = `
          SELECT
            c.id,
            c.user_id::text as user_id,
            COALESCE(u.phone_number, wc.wa_id, c.user_id::text) as phone,
            COALESCE(u.name, wc.profile_name, 'User') as user_name,
            c.channel,
            c.title,
            c.is_archived,
            COUNT(m.id) as messages_count,
            COALESCE(SUM(m.tokens_used), 0) as tokens_used,
            (SELECT m2.text FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.created_at DESC LIMIT 1) as last_message,
            (SELECT m2.created_at FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.created_at DESC LIMIT 1) as last_message_at,
            c.created_at,
            c.updated_at
          FROM conversations c
          LEFT JOIN users u ON u.id = c.user_id OR u.phone_number = c.user_id::text
          LEFT JOIN whatsapp_contacts wc ON wc.user_id = c.user_id
          LEFT JOIN messages m ON m.conversation_id = c.id
          ${whereSql}
          GROUP BY c.id, c.user_id, u.phone_number, wc.wa_id, u.name, wc.profile_name, c.channel, c.title, c.is_archived, c.created_at, c.updated_at
          ORDER BY last_message_at DESC NULLS LAST, c.updated_at DESC NULLS LAST, c.created_at DESC
          LIMIT $${pIdx} OFFSET $${pIdx + 1}
        `;
        params.push(limit, offset);

        const res = await pool.query(query, params);
        return res.rows.map((r: any) => {
          const lastMsgAt = r.last_message_at || r.updated_at || r.created_at;
          const phoneVal = (r.phone || '').replace(/^wa_/, '');
          const status = r.is_archived ? 'archived' : 'active';
          return {
            id: r.id,
            userId: r.user_id,
            phone: phoneVal,
            userPhone: phoneVal,
            userName: r.user_name || 'User',
            channel: r.channel,
            title: r.title || 'Untitled Conversation',
            isArchived: !!r.is_archived,
            status,
            messagesCount: parseInt(r.messages_count || '0', 10),
            messageCount: parseInt(r.messages_count || '0', 10),
            tokensUsed: parseInt(r.tokens_used || '0', 10),
            lastMessage: r.last_message || '',
            lastMessageSnippet: r.last_message || '',
            lastMessageAt: lastMsgAt ? new Date(lastMsgAt).toISOString() : new Date().toISOString(),
            updatedAt: lastMsgAt ? new Date(lastMsgAt).toISOString() : (r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString()),
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          };
        });
      } catch (err: any) {
        logger.warn('Database query failed in getConversationsList', { error: err.message });
      }
    }

    // In-memory fallback
    const convs = Array.from(this.chatRepo.getInMemoryConversations().values())
      .filter(c => includeArchived ? true : !c.isArchived)
      .filter(c => !channel || c.channel === channel)
      .filter(c => !options.userId || c.userId === options.userId);

    return convs.slice(offset, offset + limit).map((c) => {
      const msgs = this.chatRepo.getInMemoryMessages().get(c.id) || [];
      const lastMsg = msgs[msgs.length - 1];
      const phoneVal = c.userId.replace(/^wa_/, '');
      const lastMsgAt = lastMsg?.createdAt ? lastMsg.createdAt.toISOString() : (c.updatedAt ? c.updatedAt.toISOString() : (c.createdAt ? c.createdAt.toISOString() : new Date().toISOString()));
      return {
        id: c.id,
        userId: c.userId,
        phone: phoneVal,
        userPhone: phoneVal,
        userName: 'User',
        channel: c.channel,
        title: c.title,
        isArchived: !!c.isArchived,
        status: c.isArchived ? 'archived' : 'active',
        messagesCount: msgs.length,
        messageCount: msgs.length,
        tokensUsed: msgs.reduce((acc, m) => acc + (m.tokensUsed || 0), 0),
        lastMessage: lastMsg?.text || '',
        lastMessageSnippet: lastMsg?.text || '',
        lastMessageAt: lastMsgAt,
        updatedAt: lastMsgAt,
        createdAt: c.createdAt ? c.createdAt.toISOString() : new Date().toISOString(),
      };
    });
  }

  public async archiveConversation(conversationId: string, isArchived: boolean = true): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE conversations SET is_archived = $1, updated_at = NOW() WHERE id::text = $2`,
          [isArchived, conversationId]
        );
        if ((res.rowCount ?? 0) > 0) {
          return true;
        }
      } catch (err: any) {
        logger.error('Failed to archive conversation', { error: err.message, conversationId });
      }
    }

    const conv = this.chatRepo.getInMemoryConversations().get(conversationId);
    if (conv) {
      conv.isArchived = isArchived;
      return true;
    }
    return false;
  }

  public async getConversationTranscript(
    conversationId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ConversationTranscriptResult> {
    const pool = this.db.getPool();
    const limit = Math.min(Math.max(options.limit || 50, 1), 500);
    const offset = Math.max(options.offset || 0, 0);

    if (pool) {
      try {
        const countRes = await pool.query(
          `SELECT COUNT(*)::int as total FROM messages WHERE conversation_id = $1`,
          [conversationId]
        );
        const total = parseInt(countRes.rows[0]?.total || '0', 10);

        const query = `
          SELECT * FROM (
            SELECT
              m.id,
              m.conversation_id as "conversationId",
              m.created_at as timestamp,
              m.sender_role as role,
              m.sender_name as sender,
              m.text,
              m.model_name as model,
              m.latency_ms as "latencyMs",
              m.tokens_used as tokens,
              m.prompt_tokens as "promptTokens",
              m.completion_tokens as "completionTokens",
              m.media_type as "mediaType",
              m.media_url as "mediaUrl",
              m.tools_used as "toolsUsed"
            FROM messages m
            WHERE m.conversation_id = $1
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT $2 OFFSET $3
          ) sub
          ORDER BY sub.timestamp ASC, sub.id ASC
        `;
        const res = await pool.query(query, [conversationId, limit, offset]);

        // Tool calls correlation
        let conversationToolCalls: any[] = [];
        const hasTools = res.rows.some((r: any) => r.toolsUsed || (r.role === 'assistant' && r.model !== 'semantic-cache'));
        if (hasTools) {
          try {
            const tcRes = await pool.query(
              `SELECT
                 tc.id,
                 tc.agent_run_id as "agentRunId",
                 tc.tool_name as "toolName",
                 tc.arguments,
                 tc.result,
                 tc.status,
                 tc.created_at as "createdAt",
                 tc.completed_at as "completedAt",
                 ROUND(EXTRACT(EPOCH FROM (COALESCE(tc.completed_at, NOW()) - tc.created_at)) * 1000) as "durationMs"
               FROM tool_calls tc
               JOIN agent_runs ar ON ar.id = tc.agent_run_id
               WHERE ar.conversation_id = $1
               ORDER BY tc.created_at ASC`,
              [conversationId]
            );
            conversationToolCalls = tcRes.rows;
          } catch (tcErr: any) {
            logger.warn('Failed to fetch tool calls for transcript', { error: tcErr.message });
          }
        }

        const messages: RecentInteractionItem[] = res.rows.map((r: any) => {
          const isUser = r.role === 'user' || r.sender_role === 'user';
          const isSemanticCache = r.model === 'semantic-cache';
          const sender = isUser
            ? (r.sender || 'WhatsApp User')
            : 'Craft';
          const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';
          const source: 'ai' | 'semantic-cache' | 'system' = isSemanticCache
            ? 'semantic-cache'
            : (isUser ? 'system' : 'ai');

          // Match tool calls for assistant message if tools were used
          let matchedToolCalls: ToolCallDetailItem[] = [];
          if (!isUser && !isSemanticCache && conversationToolCalls.length > 0) {
            const msgTime = new Date(r.timestamp).getTime();
            matchedToolCalls = conversationToolCalls.filter((tc: any) => {
              const tcTime = new Date(tc.createdAt).getTime();
              return tcTime >= msgTime - 15000 && tcTime <= msgTime + 1000;
            }).map((tc: any) => {
              let parsedArgs = tc.arguments;
              if (typeof parsedArgs === 'string') {
                try { parsedArgs = JSON.parse(parsedArgs); } catch {}
              }
              let parsedResult = tc.result;
              if (typeof parsedResult === 'string') {
                try { parsedResult = JSON.parse(parsedResult); } catch {}
              }
              return {
                id: tc.id,
                toolName: tc.toolName,
                arguments: parsedArgs || {},
                result: parsedResult || {},
                status: tc.status,
                durationMs: tc.durationMs ? Math.max(0, parseInt(tc.durationMs, 10)) : undefined,
                createdAt: tc.createdAt ? new Date(tc.createdAt).toISOString() : undefined,
              };
            });
          }

          const toolsList = r.toolsUsed
            ? r.toolsUsed.split(',').map((s: string) => s.trim()).filter(Boolean)
            : matchedToolCalls.map((tc) => tc.toolName);

          const metadata: ConversationMessageMetadata = {
            model: isSemanticCache ? null : (r.model || null),
            tokens: isSemanticCache ? 0 : (r.tokens !== null && r.tokens !== undefined ? parseInt(r.tokens, 10) : null),
            promptTokens: r.promptTokens !== null && r.promptTokens !== undefined ? parseInt(r.promptTokens, 10) : null,
            completionTokens: r.completionTokens !== null && r.completionTokens !== undefined ? parseInt(r.completionTokens, 10) : null,
            latencyMs: r.latencyMs !== null && r.latencyMs !== undefined ? parseInt(r.latencyMs, 10) : null,
            tools: toolsList.length > 0 ? toolsList : undefined,
            source,
            toolCalls: matchedToolCalls.length > 0 ? matchedToolCalls : undefined,
          };

          return {
            id: r.id,
            conversationId: r.conversationId,
            timestamp: new Date(r.timestamp).toISOString(),
            createdAt: new Date(r.timestamp).toISOString(),
            role,
            sender,
            text: r.text,
            content: r.text,
            model: metadata.model,
            latencyMs: metadata.latencyMs,
            tokens: metadata.tokens,
            promptTokens: metadata.promptTokens,
            completionTokens: metadata.completionTokens,
            mediaType: r.mediaType,
            mediaUrl: r.mediaUrl,
            toolsUsed: r.toolsUsed,
            source,
            toolCalls: matchedToolCalls.length > 0 ? matchedToolCalls : undefined,
            metadata,
          };
        });

        return Object.assign([...messages], { messages, total }) as ConversationTranscriptResult;
      } catch (err: any) {
        logger.warn('Database query failed in getConversationTranscript', { error: err.message });
      }
    }

    // In-memory fallback
    const msgs = this.chatRepo.getInMemoryMessages().get(conversationId) || [];
    const total = msgs.length;
    const start = Math.max(0, total - offset - limit);
    const end = Math.max(0, total - offset);
    const slice = msgs.slice(start, end);

    const messages = slice.map((m) => {
      const isUser = m.senderRole === 'user';
      const isSemanticCache = m.modelName === 'semantic-cache';
      const sender = isUser ? (m.senderName || 'WhatsApp User') : 'Craft';
      const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';
      const source: 'ai' | 'semantic-cache' | 'system' = isSemanticCache ? 'semantic-cache' : (isUser ? 'system' : 'ai');

      const metadata: ConversationMessageMetadata = {
        model: isSemanticCache ? null : (m.modelName || null),
        tokens: isSemanticCache ? 0 : (m.tokensUsed ?? null),
        promptTokens: m.promptTokens ?? null,
        completionTokens: m.completionTokens ?? null,
        latencyMs: m.latencyMs ?? null,
        tools: m.toolsUsed ? m.toolsUsed.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        source,
      };

      return {
        id: m.id,
        conversationId: m.conversationId,
        timestamp: (m.createdAt || new Date()).toISOString(),
        createdAt: (m.createdAt || new Date()).toISOString(),
        role,
        sender,
        text: m.text,
        content: m.text,
        model: metadata.model,
        latencyMs: metadata.latencyMs,
        tokens: metadata.tokens,
        promptTokens: metadata.promptTokens,
        completionTokens: metadata.completionTokens,
        mediaType: m.mediaType,
        mediaUrl: m.mediaUrl,
        toolsUsed: m.toolsUsed,
        source,
        metadata,
      };
    });

    return Object.assign([...messages], { messages, total }) as ConversationTranscriptResult;
  }

  public async getUserDetails(userIdOrPhone: string): Promise<UserDetailsResponse | null> {
    const pool = this.db.getPool();
    const cleanPhone = normalizePhoneNumber(userIdOrPhone.replace(/^wa_/, ''));

    if (pool) {
      try {
        const userQuery = `
          SELECT id, name, email, phone_number as "phoneNumber", bsuid, is_vip as "isVip", is_banned as "isBanned", banned_at as "bannedAt", ban_reason as "banReason", daily_message_count as "dailyMessageCount", created_at as "createdAt"
          FROM users
          WHERE id::text = $1 OR phone_number = $2 OR phone_number = $3
          LIMIT 1
        `;
        const userRes = await pool.query(userQuery, [userIdOrPhone, cleanPhone, `+${cleanPhone}`]);
        const user = userRes.rows[0] || {
          id: userIdOrPhone,
          name: `User ${cleanPhone.slice(-4)}`,
          phoneNumber: cleanPhone,
          createdAt: new Date().toISOString(),
        };

        const userId = user.id;

        // WhatsApp Contact Details
        let whatsappContact = null;
        try {
          const contactRes = await pool.query(
            `SELECT wa_id, profile_name, verified, bsuid FROM whatsapp_contacts WHERE user_id = $1 LIMIT 1`,
            [userId]
          );
          if (contactRes.rows.length > 0) {
            whatsappContact = {
              waId: contactRes.rows[0].wa_id,
              profileName: contactRes.rows[0].profile_name,
              verified: !!contactRes.rows[0].verified,
              bsuid: contactRes.rows[0].bsuid,
            };
          }
        } catch {
          // Soft-fail if table not yet populated
        }

        // User Preferences
        const preferences: Record<string, string> = {};
        try {
          const prefRes = await pool.query(
            `SELECT preference_key, preference_value FROM user_preferences WHERE user_id = $1`,
            [userId]
          );
          for (const r of prefRes.rows) {
            preferences[r.preference_key] = r.preference_value;
          }
        } catch {
          // Soft-fail
        }

        // Metrics
        const metricsRes = await pool.query(
          `SELECT
             COUNT(DISTINCT c.id) as total_conversations,
             COUNT(m.id) as total_messages,
             COALESCE(SUM(m.tokens_used), 0) as tokens_used,
             COALESCE(SUM(m.prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(m.completion_tokens), 0) as completion_tokens,
             MAX(m.created_at) as last_active
           FROM conversations c
           LEFT JOIN messages m ON m.conversation_id = c.id
           WHERE c.user_id::text = $1::text`,
          [userId]
        );
        const mRow = metricsRes.rows[0] || {};
        const pt = parseInt(mRow.prompt_tokens || '0', 10);
        const ct = parseInt(mRow.completion_tokens || '0', 10);
        const cost = Number(((pt / 1_000_000) * 0.1 + (ct / 1_000_000) * 0.4).toFixed(4));

        // Memories (bounded top 20 for User 360 overview)
        const memRes = await pool.query(
          `SELECT id, fact_key as "factKey", fact_text as "factText", category, created_at as "createdAt"
           FROM memory_items WHERE user_id::text = $1::text ORDER BY created_at DESC LIMIT 20`,
          [userId]
        );

        // Reminders (bounded top 20 for User 360 overview)
        const remRes = await pool.query(
          `SELECT id, title, due_at as "dueAt", recurrence, is_completed as "isCompleted", state, created_at as "createdAt"
           FROM reminders WHERE user_id::text = $1::text ORDER BY created_at DESC LIMIT 20`,
          [userId]
        );

        // User Conversations (bounded top 10)
        const convList = await this.getConversationsList({ userId, limit: 10 });

        const stats = {
          totalConversations: parseInt(mRow.total_conversations || '0', 10),
          totalMessages: parseInt(mRow.total_messages || '0', 10),
          totalReminders: remRes.rows.length,
          activeReminders: remRes.rows.filter((r: any) => !r.isCompleted).length,
          memoryCount: memRes.rows.length,
          tokenCount: parseInt(mRow.tokens_used || '0', 10),
          costUsd: cost,
        };

        const metrics = {
          totalConversations: parseInt(mRow.total_conversations || '0', 10),
          totalMessages: parseInt(mRow.total_messages || '0', 10),
          tokensUsed: parseInt(mRow.tokens_used || '0', 10),
          promptTokens: pt,
          completionTokens: ct,
          estimatedCostUsd: cost,
          dailyMessageCount: user.dailyMessageCount ? parseInt(user.dailyMessageCount, 10) : 0,
          lastActive: mRow.last_active ? new Date(mRow.last_active).toISOString() : undefined,
          memoryCount: memRes.rows.length,
          reminderCount: remRes.rows.length,
          activeRemindersCount: remRes.rows.filter((r: any) => !r.isCompleted).length,
        };

        return {
          user: {
            id: user.id,
            name: user.name,
            phoneNumber: user.phoneNumber,
            email: user.email,
            bsuid: user.bsuid,
            isVip: !!user.isVip,
            isBanned: !!user.isBanned,
            bannedAt: user.bannedAt ? new Date(user.bannedAt).toISOString() : undefined,
            banReason: user.banReason || undefined,
            createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString(),
          },
          whatsappContact,
          preferences,
          stats,
          metrics,
          memories: memRes.rows.map((r: any) => ({
            id: r.id,
            key: r.factKey || r.category || 'fact',
            value: r.factText,
            factText: r.factText,
            category: r.category,
            createdAt: new Date(r.createdAt).toISOString(),
          })),
          reminders: remRes.rows.map((r: any) => ({
            id: r.id,
            title: r.title,
            dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : undefined,
            scheduledTime: r.dueAt ? new Date(r.dueAt).toISOString() : undefined,
            recurrence: r.recurrence || 'none',
            isCompleted: !!r.isCompleted,
            state: r.state || (r.isCompleted ? 'sent' : 'scheduled'),
            status: r.state || (r.isCompleted ? 'sent' : 'scheduled'),
            createdAt: new Date(r.createdAt).toISOString(),
          })),
          recentConversations: convList,
          conversations: convList,
        };
      } catch (err: any) {
        logger.warn('Database query failed in getUserDetails', { error: err.message });
      }
    }

    // In-memory fallback
    const fallbackStats = {
      totalConversations: 1,
      totalMessages: 5,
      totalReminders: 0,
      activeReminders: 0,
      memoryCount: 1,
      tokenCount: 1200,
      costUsd: 0.00036,
    };

    return {
      user: {
        id: userIdOrPhone,
        name: 'User',
        phoneNumber: cleanPhone,
        createdAt: new Date().toISOString(),
      },
      stats: fallbackStats,
      metrics: {
        ...fallbackStats,
        tokensUsed: 1200,
        promptTokens: 400,
        completionTokens: 800,
        estimatedCostUsd: 0.00036,
        dailyMessageCount: 0,
        reminderCount: 0,
        activeRemindersCount: 0,
      },
      memories: [
        {
          id: '1',
          key: 'preference',
          value: 'المستخدم يفضل التحدث بالعامية المصرية',
          factText: 'المستخدم يفضل التحدث بالعامية المصرية',
          category: 'preference',
          createdAt: new Date().toISOString(),
        },
      ],
      reminders: [],
      recentConversations: [],
      conversations: [],
    };
  }

  public async getToolsStats(): Promise<ToolsStatsResponse> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        // Web searches count & recent
        let searchesCount = 0;
        let recentSearches: { query: string; timestamp: string }[] = [];
        try {
          const searchRes = await pool.query(`
            SELECT arguments->>'query' as query, created_at as timestamp
            FROM tool_calls
            WHERE tool_name = 'web_search'
            ORDER BY created_at DESC
            LIMIT 10
          `);
          recentSearches = searchRes.rows.map((r: any) => ({
            query: r.query || 'بحث عام',
            timestamp: new Date(r.timestamp).toISOString(),
          }));
          const totalSearchRes = await pool.query(
            `SELECT COUNT(*) FROM tool_calls WHERE tool_name = 'web_search'`
          );
          searchesCount = parseInt(totalSearchRes.rows[0].count || '0', 10);
        } catch {}

        // Reminders stats
        let totalReminders = 0;
        let recurringReminders = 0;
        try {
          const remRes = await pool.query(`
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN recurrence != 'none' THEN 1 END) as recurring
            FROM reminders
          `);
          totalReminders = parseInt(remRes.rows[0].total || '0', 10);
          recurringReminders = parseInt(remRes.rows[0].recurring || '0', 10);
        } catch {}

        // Audio transcribed
        let totalAudio = 0;
        try {
          const audioRes = await pool.query(`
            SELECT COUNT(*) as total FROM messages WHERE media_type = 'audio' OR text LIKE '%فويس%'
          `);
          totalAudio = parseInt(audioRes.rows[0].total || '0', 10);
        } catch {}

        // Confirmations
        let confirmations = { total: 0, approved: 0, rejected: 0, pending: 0 };
        try {
          const confRes = await pool.query(`
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
              COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
              COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
            FROM confirmation_requests
          `);
          const r = confRes.rows[0];
          confirmations = {
            total: parseInt(r.total || '0', 10),
            approved: parseInt(r.approved || '0', 10),
            rejected: parseInt(r.rejected || '0', 10),
            pending: parseInt(r.pending || '0', 10),
          };
        } catch {}

        return {
          totalWebSearches: searchesCount,
          recentSearches,
          totalRemindersCreated: totalReminders,
          recurringRemindersCount: recurringReminders,
          totalAudioTranscribed: totalAudio,
          confirmations,
        };
      } catch (err: any) {
        logger.error('Database query failed in getToolsStats', { error: err.message });
        if (config.nodeEnv === 'production') {
          throw new Error(`Database error in getToolsStats: ${err.message}`);
        }
      }
    }

    return {
      totalWebSearches: 0,
      recentSearches: [],
      totalRemindersCreated: 0,
      recurringRemindersCount: 0,
      totalAudioTranscribed: 0,
      confirmations: { total: 0, approved: 0, rejected: 0, pending: 0 },
    };
  }

  public async getRecentInteractions(limit = 20): Promise<RecentInteractionItem[]> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const query = `
          SELECT
            m.id,
            m.conversation_id as "conversationId",
            m.created_at as timestamp,
            m.sender_role as role,
            m.sender_name as sender,
            m.text,
            m.model_name as model,
            m.latency_ms as "latencyMs",
            m.tokens_used as tokens,
            m.media_type as "mediaType",
            m.tools_used as "toolsUsed"
          FROM messages m
          ORDER BY m.created_at DESC
          LIMIT $1
        `;
        const res = await pool.query(query, [limit]);
        return res.rows.map((r: any) => ({
          id: r.id,
          conversationId: r.conversationId,
          timestamp: new Date(r.timestamp).toISOString(),
          role: r.role,
          sender: r.sender,
          text: r.text,
          model: r.model,
          latencyMs: r.latencyMs,
          tokens: r.tokens,
          mediaType: r.mediaType,
          toolsUsed: r.toolsUsed,
        }));
      } catch (err: any) {
        logger.warn('Database query failed in getRecentInteractions, calculating in-memory', {
          error: err.message,
        });
      }
    }

    return this.calculateInMemoryRecentInteractions(limit);
  }

  // --- In-memory Calculations ---

  private calculateInMemoryOverview(): AnalyticsOverview {
    const conversations = Array.from(this.chatRepo.getInMemoryConversations().values());
    const allMessages: any[] = [];
    for (const msgs of this.chatRepo.getInMemoryMessages().values()) {
      allMessages.push(...msgs);
    }

    let userMsgs = 0;
    let botMsgs = 0;
    let msgsToday = 0;
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    const latencies: number[] = [];
    const todayStr = new Date().toISOString().slice(0, 10);

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
      : 850;

    const uniqueUsers = new Set(conversations.map((c) => c.userId));
    const activeTodayUsers = new Set(
      conversations
        .filter((c) => (c.updatedAt || new Date()).toISOString().slice(0, 10) === todayStr)
        .map((c) => c.userId)
    );

    const estimatedCostUsd = Number(
      ((promptTokens / 1_000_000) * 0.1 + (completionTokens / 1_000_000) * 0.4).toFixed(5)
    );

    return {
      totalConversations: Math.max(conversations.length, 1),
      activeConversationsToday: Math.max(activeTodayUsers.size, 1),
      totalMessages: Math.max(allMessages.length, 2),
      userMessages: Math.max(userMsgs, 1),
      botMessages: Math.max(botMsgs, 1),
      messagesToday: Math.max(msgsToday, 2),
      totalTokens: Math.max(totalTokens, 120),
      promptTokens: Math.max(promptTokens, 40),
      completionTokens: Math.max(completionTokens, 80),
      estimatedCostUsd: Math.max(estimatedCostUsd, 0.00004),
      modelCosts: {
        groqPrimary: estimatedCostUsd,
        groqFallback: 0,
        groqQwen: 0,
        geminiFlash: estimatedCostUsd,
        geminiFlashLite: 0,
      },
      avgLatencyMs,
      minLatencyMs: 420,
      maxLatencyMs: 1450,
      totalUsers: Math.max(uniqueUsers.size, 1),
      activeUsersToday: Math.max(activeTodayUsers.size, 1),
    };
  }

  private calculateInMemoryDailyTrends(days: number): DailyTrendItem[] {
    const list: DailyTrendItem[] = [];
    const now = new Date();
    const allMessages: any[] = [];
    for (const msgs of this.chatRepo.getInMemoryMessages().values()) {
      allMessages.push(...msgs);
    }
    const conversations = Array.from(this.chatRepo.getInMemoryConversations().values());

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);

      const dayMessages = allMessages.filter(
        (m) => (m.createdAt || new Date()).toISOString().slice(0, 10) === dayStr
      );
      const dayConvs = conversations.filter(
        (c) => (c.updatedAt || c.createdAt || new Date()).toISOString().slice(0, 10) === dayStr
      );
      const dayUsers = new Set(dayConvs.map((c) => c.userId));

      list.push({
        date: dayStr,
        conversations: dayConvs.length,
        userMessages: dayMessages.filter((m) => m.senderRole === 'user').length,
        botMessages: dayMessages.filter((m) => m.senderRole === 'assistant').length,
        tokens: dayMessages.reduce((sum, m) => sum + (m.tokensUsed || 0), 0),
        activeUsers: dayUsers.size,
      });
    }

    return list;
  }

  private calculateInMemoryModelBreakdown(): ModelBreakdownItem[] {
    const allMessages: any[] = [];
    for (const msgs of this.chatRepo.getInMemoryMessages().values()) {
      allMessages.push(...msgs);
    }
    const botMessages = allMessages.filter((m) => m.senderRole === 'assistant');
    if (botMessages.length === 0) {
      return [
        { model: 'openai/gpt-oss-120b', count: 0, tokens: 0, percentage: 0 },
      ];
    }
    const modelCounts = new Map<string, { count: number; tokens: number }>();
    for (const m of botMessages) {
      const model = m.modelName || 'openai/gpt-oss-120b';
      const entry = modelCounts.get(model) || { count: 0, tokens: 0 };
      entry.count++;
      entry.tokens += m.tokensUsed || 0;
      modelCounts.set(model, entry);
    }
    const total = botMessages.length;
    return Array.from(modelCounts.entries()).map(([model, data]) => ({
      model,
      count: data.count,
      tokens: data.tokens,
      percentage: total > 0 ? Math.round((data.count / total) * 100) : 0,
    }));
  }

  private calculateInMemoryTopUsers(limit: number): TopUserItem[] {
    const conversations = Array.from(this.chatRepo.getInMemoryConversations().values());
    return conversations.slice(0, limit).map((c) => ({
      userId: c.userId,
      phone: c.userId.replace('wa_', ''),
      name: 'User ' + c.userId.slice(-4),
      totalMessages: 5,
      tokensUsed: 1500,
      estimatedCostUsd: 0.0005,
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
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        mediaType: m.mediaType,
      }));
  }
}
