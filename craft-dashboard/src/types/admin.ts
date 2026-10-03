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
export interface SystemHealthSnapshot {
  status: 'healthy' | 'degraded' | 'unhealthy' | string;
  timestamp: string;
  uptimeSeconds: number;
  requests?: {
    total: number;
    success: number;
    error: number;
    cancelled: number;
    errorRate: number;
  };
  ai?: {
    requests: number;
    failures: number;
    fallbacks: number;
    tokensTotal: number;
    providerHealth: Record<string, { status: string; circuitBreaker: string }>;
  };
  agent?: {
    runs: number;
    steps: number;
    partial: number;
    failed: number;
  };
  tools?: {
    calls: number;
    failures: number;
    confirmations: number;
  };
  memory?: {
    retrievalCount: number;
    selectedCount: number;
    blockedCount: number;
  };
  proactive?: {
    candidates: number;
    sent: number;
    blocked: number;
  };
  components?: Record<string, { status: string; latencyMs?: number; details?: any }>;
}

export interface SystemHealthData {
  service: string;
  environment: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  snapshot: SystemHealthSnapshot;
}

export interface HistogramMetric {
  count: number;
  sum?: number;
  min?: number;
  max?: number;
  avg?: number;
  p50: number;
  p90?: number;
  p95: number;
  p99: number;
}

export interface ObservabilityMetrics {
  timestamp?: string;
  uptimeSeconds?: number;
  counters?: Record<string, { value: number; tags?: Record<string, string> } | number>;
  gauges?: Record<string, number>;
  histograms?: Record<string, HistogramMetric>;
  latencies?: Record<string, { p50: number; p95: number; p99: number; count: number }>;
}

// 3. User Types
export interface AdminUserListItem {
  id: string;
  userId?: string;
  phoneNumber?: string;
  phone?: string;
  channel?: string;
  name?: string;
  isVip: boolean;
  isBanned: boolean;
  bannedAt?: string;
  banReason?: string;
  dailyMessageCount?: number;
  createdAt: string;
  lastActiveAt?: string;
  lastActive?: string;
  messageCount: number;
  totalMessages?: number;
  conversationCount: number;
  reminderCount: number;
}

export interface UserDetails360 {
  user: AdminUserListItem;
  whatsappContact?: {
    waId?: string;
    profileName?: string;
    verified?: boolean;
    bsuid?: string;
  } | null;
  preferences?: Record<string, string>;
  stats: {
    totalConversations: number;
    totalMessages: number;
    totalReminders: number;
    activeReminders: number;
    memoryCount: number;
    tokenCount: number;
    costUsd: number;
  };
  metrics?: {
    totalConversations?: number;
    totalMessages?: number;
    tokensUsed?: number;
    promptTokens?: number;
    completionTokens?: number;
    estimatedCostUsd?: number;
    dailyMessageCount?: number;
    lastActive?: string;
    memoryCount?: number;
    reminderCount?: number;
    activeRemindersCount?: number;
  };
  recentConversations: AdminConversationItem[];
  conversations?: AdminConversationItem[];
  reminders: any[];
  memories: any[];
}

// 4. Conversation Types
export interface AdminConversationItem {
  id: string;
  userId: string;
  userPhone?: string;
  phone?: string;
  userName?: string;
  channel: string;
  status: string;
  messageCount: number;
  messagesCount?: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  lastMessageSnippet?: string;
  lastMessage?: string;
}

export interface ToolCallItem {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
  result: any;
  status: string;
  durationMs?: number;
  createdAt?: string;
}

export interface AdminMessageMetadata {
  model?: string | null;
  tokens?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  tools?: string[];
  source?: 'ai' | 'semantic-cache' | 'system';
  toolCalls?: ToolCallItem[];
}

export interface AdminMessageItem {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  sender: string;
  senderRole?: string;
  senderName?: string;
  content: string;
  text?: string;
  mediaType?: string;
  mediaUrl?: string;
  createdAt: string;
  timestamp?: string;
  model?: string | null;
  tokens?: number | null;
  tokensUsed?: string | number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  toolsUsed?: string | null;
  source?: 'ai' | 'semantic-cache' | 'system';
  toolCalls?: ToolCallItem[];
  metadata?: AdminMessageMetadata;
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
  status: 'completed' | 'failed' | 'running' | 'interrupted' | string;
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number;
  durationMs?: number;
  toolCallsCount: number;
  iterationsCount?: number;
  userPrompt?: string;
  errorDetails?: string;
  createdAt: string;
  completedAt?: string;
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
    status: 'success' | 'error' | string;
    errorMessage?: string;
    createdAt?: string;
    completedAt?: string;
  }[];
  reasoningNote?: string; // Strictly redacted note
}

// 9. Tool Calls Types
export interface AdminToolCallItem {
  id: string;
  runId: string;
  agentRunId?: string;
  toolName: string;
  durationMs: number;
  status: 'success' | 'error' | 'failed' | 'running';
  createdAt: string;
  completedAt?: string;
  arguments?: any;
  argumentsSanitized?: any;
  result?: any;
  resultSanitized?: any;
  errorMessage?: string;
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
  provider?: string;
  resultCount?: number;
  sourceCount?: number;
  latencyMs: number;
  status?: string;
  freshness?: string;
  createdAt: string;
  error?: string;
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
  runtimeSettings?: {
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
  adminActor?: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  status?: 'success' | 'failure' | string;
  metadata?: Record<string, any>;
  details?: any;
  ipAddress?: string;
  correlationId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}
