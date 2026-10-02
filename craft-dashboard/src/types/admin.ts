export type AdminRole = 'owner' | 'admin' | 'operator' | 'support' | 'viewer';

export interface AdminActor {
  id: string;
  role: AdminRole;
  actorType: 'bearer_token' | 'user' | 'api_key';
  name?: string;
}

export interface AdminSuccessResponse<T> {
  success: true;
  data: T;
  pagination?: {
    nextCursor: string | null;
    total?: number;
  };
  correlationId: string;
  timestamp: string;
}

export interface AdminErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  correlationId: string;
}

export interface SessionData {
  token: string;
  role: AdminRole;
  actorName: string;
  expiresAt: number;
}

export interface SafeClientUser {
  role: AdminRole;
  actorName: string;
}

// 1. Overview Types
export interface OverviewStats {
  totalUsers: number;
  activeUsers24h: number;
  activeUsers7d: number;
  totalConversations: number;
  totalMessages: number;
  totalReminders: number;
  pendingReminders: number;
  deliveredReminders: number;
  totalTokens: number;
  totalCostUsd: number;
  cacheHitRatePercent: number;
}

export interface DailyTrend {
  date: string;
  messageCount: number;
  activeUsers: number;
  tokenCount: number;
  costUsd: number;
}

export interface ModelBreakdownItem {
  model: string;
  calls: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface AdminOverviewData {
  overview: OverviewStats;
  dailyTrends: DailyTrend[];
  hourlyDistribution: { hour: number; count: number }[];
  modelBreakdown: ModelBreakdownItem[];
  mediaBreakdown: { mediaType: string; count: number }[];
  topUsers: { userId: string; phone?: string; messageCount: number; lastActive: string }[];
  recentInteractions: any[];
}

// 2. Observability Types
export interface SystemHealthData {
  service: string;
  environment: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  snapshot: {
    status: string;
    uptimeSeconds: number;
    timestamp: string;
    components: Record<string, { status: string; latencyMs?: number; details?: any }>;
  };
}

export interface ObservabilityMetrics {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  latencies: Record<string, { p50: number; p95: number; p99: number; count: number }>;
}

// 3. User Types
export interface AdminUserListItem {
  id: string;
  phoneNumber?: string;
  name?: string;
  isVip: boolean;
  isBanned: boolean;
  createdAt: string;
  lastActiveAt?: string;
  messageCount: number;
  conversationCount: number;
  reminderCount: number;
}

export interface UserDetails360 {
  user: AdminUserListItem;
  stats: {
    totalConversations: number;
    totalMessages: number;
    totalReminders: number;
    activeReminders: number;
    memoryCount: number;
    tokenCount: number;
    costUsd: number;
  };
  recentConversations: any[];
  reminders: any[];
  memories: any[];
}

// 4. Conversation Types
export interface AdminConversationItem {
  id: string;
  userId: string;
  userPhone?: string;
  channel: string;
  status: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessageSnippet?: string;
}

export interface AdminMessageItem {
  id: string;
  conversationId: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  mediaType?: string;
  mediaUrl?: string;
  createdAt: string;
  tokens?: number;
  model?: string;
}

// 5. Memory Types
export interface AdminMemoryItem {
  id: string;
  userId: string;
  userPhone?: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMemoryCandidate {
  id: string;
  userId: string;
  userPhone?: string;
  category: string;
  key: string;
  extractedValue: string;
  confidence: number;
  evidenceSnippet: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

// 6. Reminder Types
export interface AdminReminderItem {
  id: string;
  userId: string;
  userPhone?: string;
  title: string;
  scheduledTime: string;
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'cancelled';
  recurrence?: string;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// 7. Knowledge & Semantic Cache Types
export interface AdminFaqItem {
  id: string;
  question: string;
  answer: string;
  category?: string;
  keywords?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCacheCandidate {
  id: string;
  prompt: string;
  canonicalAnswer: string;
  similarityScore: number;
  hitCount: number;
  status: 'pending' | 'validated' | 'rejected' | 'promoted';
  createdAt: string;
}

export interface AdminCacheMetrics {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRatePercent: number;
  estimatedSavingsUsd: number;
}

// 8. Agent Runs Types (Zero Reasoning Leakage)
export interface AdminAgentRunItem {
  id: string;
  conversationId: string;
  userId?: string;
  status: 'completed' | 'failed' | 'running' | 'interrupted';
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number;
  durationMs?: number;
  toolCallsCount: number;
  createdAt: string;
  hasRedactedReasoning: boolean;
}

export interface AdminAgentRunDetails extends AdminAgentRunItem {
  promptSnippet: string;
  responseSnippet: string;
  toolCalls: {
    id: string;
    toolName: string;
    args?: any;
    arguments?: any;
    result: any;
    durationMs: number;
    status: 'success' | 'error';
  }[];
  reasoningNote?: string; // Strictly redacted note
}

// 9. Tool Calls Types
export interface AdminToolCallItem {
  id: string;
  runId: string;
  toolName: string;
  durationMs: number;
  status: 'success' | 'error';
  createdAt: string;
  argumentsSanitized: any;
  resultSanitized: any;
}

// 10. Proactive Types
export interface AdminProactiveAction {
  id: string;
  userId: string;
  userPhone?: string;
  actionType: string;
  scheduledAt: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  payload: any;
  createdAt: string;
}

export interface AdminProactiveEngagement {
  totalDispatches: number;
  deliveredCount: number;
  repliedCount: number;
  responseRatePercent: number;
  optOutCount: number;
}

// 11. Search Intelligence Types
export interface AdminSearchItem {
  id: string;
  query: string;
  intent?: string;
  resultCount: number;
  latencyMs: number;
  createdAt: string;
}

export interface SearchDiagnosticResult {
  query: string;
  provider: string;
  status: 'success' | 'failure';
  totalResults: number;
  latencyMs: number;
  sampleResults: { title: string; url: string; snippet: string }[];
}

// 12. Settings Types (Safe, 0 secrets)
export interface AdminSafeSettings {
  runtime: {
    maintenanceMode: boolean;
    debugLogging: boolean;
    searchEnabled: boolean;
    proactiveEnabled: boolean;
    defaultMemoryRetentionDays: number;
  };
  infrastructure: {
    environment: string;
    serverlessPlatform: string;
    deploymentVersion: string;
    uptimeSeconds: number;
    aiProvider: {
      primary: string;
      engine: string;
      status: string;
      models: Record<string, string>;
    };
    integrations: Record<string, { configured: boolean; details?: any }>;
  };
}

// 13. Audit Types
export interface AdminAuditItem {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  correlationId: string;
  createdAt: string;
}
