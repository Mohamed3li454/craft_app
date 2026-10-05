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

// 14. AI Quality & Evaluation Types (Phase 12.1)
export type EvaluationDimension =
  | 'memory'
  | 'conversation'
  | 'personalization'
  | 'adaptive_response'
  | 'agent'
  | 'provider'
  | 'proactive';

export interface EvaluationExpected {
  strategy?: string;
  toolCalls?: string[];
  forbiddenTools?: string[];
  memoryUsage?: 'none' | 'allowed' | 'required';
  clarification?: boolean;
  outcome?: string;
  status?: string;
  fallbackUsed?: boolean;
  maxSteps?: number;
  blockedReason?: string;
  expectedDepth?: string;
}

export interface EvaluationCaseItem {
  id: string;
  name: string;
  category: EvaluationDimension;
  dimension?: EvaluationDimension;
  input: string;
  context?: Record<string, unknown>;
  expected: EvaluationExpected;
  actual?: Record<string, unknown>;
  tags?: string[];
  status?: 'passed' | 'failed' | 'untested' | 'pending';
  score?: number;
  failureReason?: string;
  runId?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
}

export interface EvaluationOverviewData {
  datasetVersion: string;
  totalCases: number;
  coveredCases: number;
  uncoveredCases: number;
  coverageRate: number;
  dimensionsCount: number;
  dimensionCoverage: Record<EvaluationDimension, number>;
  lastEvaluationRun: string | EvaluationRunItem | null;
  historicalRunsCount: number;
  activeRegressionsCount: number;
  overallScore?: number | null;
  passRate?: number | null;
  failureRate?: number | null;
  operationalSignals?: OperationalSignals | null;
  runtimeQuality?: {
    toolSuccess: string;
    providerSuccess: string;
    searchSuccess: string;
    responseQuality: string;
  };
  healthStatus?: QualityHealthStatus;
  statusReason?: string;
  measurementConfidence?: MeasurementConfidenceResult;
  trendsSummary?: any;
}

export interface EvaluationRunItem {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  datasetVersion: string;
  mode?: 'mock' | 'replay' | 'live';
  totalCases: number;
  passed: number;
  failed: number;
  passRate: number;
  passedCases?: number;
  failedCases?: number;
  skippedCases?: number;
  overallScore?: number;
  regressionCount: number;
  durationMs: number;
  status: 'completed' | 'running' | 'failed' | 'queued' | 'cancelled' | 'partial';
  createdBy?: string;
  createdAt?: string;
  metadata?: {
    release?: ReleaseMetadata;
    provenance?: DatasetProvenance;
    [key: string]: any;
  };
  dimensionBreakdown?: Record<
    EvaluationDimension,
    { total: number; passed: number; failed: number; passRate: number }
  >;
  modelBreakdown?: Record<string, { total: number; passed: number; avgScore: number }>;
}

export interface EvaluationCaseResult {
  id: string;
  runId: string;
  caseId: string;
  dimension: EvaluationDimension;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  score: number;
  expected: Record<string, any>;
  actual: Record<string, any>;
  failureReason?: string | null;
  regression: boolean;
  previousStatus?: string | null;
  previousScore?: number | null;
  model?: string | null;
  provider?: string | null;
  durationMs: number;
  tokens: number;
  createdAt: string;
  assertionReport?: CaseAssertionReport | null;
  failureCategory?: FailureCategory | null;
  runtimeCorrelation?: {
    agentRunId?: string | null;
    toolCallId?: string | null;
    correlationId?: string | null;
    hasCorrelation: boolean;
  };
}

export interface TriggerEvaluationRunPayload {
  mode?: 'mock' | 'replay' | 'live';
  category?: EvaluationDimension;
  caseIds?: string[];
  concurrency?: number;
  maxTokens?: number;
  timeoutMs?: number;
  releaseMetadata?: ReleaseMetadata;
}

export interface EvaluationRegressionItem {
  caseId: string;
  previousResult?: 'passed' | 'failed' | string;
  currentResult?: 'failed' | string;
  previousStatus?: string | null;
  status?: string;
  dimension: EvaluationDimension;
  severity?: 'critical' | 'high' | 'medium' | 'low' | string;
  firstDetectedAt?: string;
  latestDetectedAt?: string;
  relatedRunId?: string;
  runId?: string;
  reason?: string | null;
  failureReason?: string | null;
  runDate?: string;
  mode?: string;
}

// ==========================================
// Quality Intelligence (Phase 12.3)
// ==========================================

export type FailureCategory =
  | 'forbidden_tool_used'
  | 'required_tool_missing'
  | 'memory_mismatch'
  | 'conversation_mismatch'
  | 'personalization_mismatch'
  | 'adaptive_response_mismatch'
  | 'provider_error'
  | 'execution_error'
  | 'timeout'
  | 'budget_exceeded'
  | 'security_violation'
  | 'assertion_failure'
  | 'unknown';

export interface AssertionDiagnostic {
  type: string;
  expected: string;
  observed: string;
  status: 'passed' | 'failed';
  failureReason?: string;
}

export interface CaseAssertionReport {
  caseId: string;
  dimension: string;
  passedCount: number;
  totalCount: number;
  assertions: AssertionDiagnostic[];
}

export interface FailureCluster {
  pattern: string;
  category: FailureCategory;
  dimension: string;
  affectedCases: string[];
  affectedRuns: string[];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  sampleReason: string;
}

export interface DimensionHealth {
  dimension: EvaluationDimension;
  totalCases: number;
  evaluatedCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageScore: number;
  regressionsCount: number;
  topFailurePattern: string | null;
}

export interface CaseComparisonDiff {
  caseId: string;
  dimension: string;
  changeType: 'regression' | 'recovered' | 'score_changed' | 'new_failure' | 'resolved_failure';
  runA: {
    status: string;
    score: number;
    durationMs: number;
    failureReason?: string | null;
  };
  runB: {
    status: string;
    score: number;
    durationMs: number;
    failureReason?: string | null;
  };
  scoreDelta: number;
}

export interface RunComparisonResult {
  runA: EvaluationRunItem;
  runB: EvaluationRunItem;
  releaseA?: ReleaseMetadata;
  releaseB?: ReleaseMetadata;
  comparisonType?: 'regression' | 'informational';
  warning?: string | null;
  metrics: {
    passRateDeltaPp: number;
    averageScoreDelta: number;
    failuresDelta: number;
    regressionsDelta: number;
    durationDeltaMs: number;
    tokensDelta: number;
  };
  dimensionComparison: {
    dimension: string;
    runAPassRate: number;
    runBPassRate: number;
    deltaPp: number;
  }[];
  changedCases: CaseComparisonDiff[];
}

export interface ProviderDiagnosticItem {
  provider: string;
  model: string;
  evaluatedCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageScore: number;
  averageDurationMs: number;
  totalTokens: number;
}

export interface QualityOverviewData {
  latestRun: EvaluationRunItem | null;
  totalHistoricalRuns: number;
  activeRegressionsCount: number;
  dimensionHealth: Record<EvaluationDimension, DimensionHealth>;
  providerDiagnostics: ProviderDiagnosticItem[];
  topFailures: FailureCluster[];
  totalEvaluatedCases: number;
}

export interface FailuresOverviewData {
  clusters: FailureCluster[];
  taxonomyCounts: Record<string, number>;
  totalFailures: number;
  totalEvaluatedCases: number;
}

export interface CaseHistoryData {
  case: EvaluationCaseItem;
  history: EvaluationCaseResult[];
}

// ==========================================
// Operational Evaluation & Quality Gate (Phase 12.4)
// ==========================================

export interface OperationalSignals {
  lastEvaluation: {
    id: string;
    status: 'completed' | 'running' | 'failed' | 'queued' | 'cancelled';
    mode: 'mock' | 'replay' | 'live';
    datasetVersion: string;
    overallScore: number;
    createdAt: string;
    completedAt?: string | null;
  } | null;
  lastSuccessfulEvaluation: {
    id: string;
    overallScore: number;
    passedCases: number;
    totalCases: number;
    completedAt: string;
  } | null;
  lastFailedEvaluation: {
    id: string;
    overallScore: number;
    failedCases: number;
    totalCases: number;
    createdAt: string;
    completedAt?: string | null;
  } | null;
  lastRegression: {
    id: string;
    runId: string;
    caseId: string;
    dimension: string;
    previousStatus?: string | null;
    failureReason?: string | null;
    createdAt: string;
  } | null;
}

export interface QualityGatePolicy {
  minimumPassRate?: number;
  minimumScore?: number;
  maximumRegressions?: number;
  maximumFailures?: number;
}

export interface QualityGateCheckItem {
  criterion: 'minimum_pass_rate' | 'minimum_score' | 'maximum_regressions' | 'maximum_failures';
  label: string;
  threshold: number | string;
  actual: number | string;
  passed: boolean;
  message: string;
}

export interface QualityGateEvaluationResult {
  runId: string;
  status: 'passed' | 'failed' | 'not_configured';
  policyConfigured: boolean;
  policy: QualityGatePolicy;
  checks: QualityGateCheckItem[];
  failureReasons: string[];
  evaluatedAt: string;
}

export interface QualityReleaseSnapshot {
  runId: string;
  datasetVersion: string;
  mode: string;
  status: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  overallScore: number;
  regressionCount: number;
  durationMs: number;
  completedAt: string | null;
  createdBy: string;
  dimensionScores: Record<EvaluationDimension, { total: number; passed: number; passRate: number; avgScore: number }>;
  qualityGate: QualityGateEvaluationResult;
  releaseMetadata?: ReleaseMetadata;
  qualityDecision?: QualityDecision;
  datasetProvenance?: DatasetProvenance;
  snapshotGeneratedAt: string;
}

export interface RunProgressInfo {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalCases: number;
  processedCases: number;
  passedCases: number;
  failedCases: number;
  progressPercent: number;
  durationMs: number;
  isCompleted: boolean;
  isCancelled: boolean;
}

export interface EvaluationDatasetMetadata {
  datasetVersion: string;
  totalCases: number;
  dimensions: string[];
  dimensionCounts: Record<string, number>;
  isReadOnly: boolean;
  sourceControlled: boolean;
  sourcePath: string;
  description: string;
}

// ==========================================
// Continuous Evaluation & Release Quality (Phase 12.5)
// ==========================================

export type QualityDecision = 'approved' | 'rejected' | 'not_configured';

export interface ReleaseMetadata {
  commitSha: string | null;
  deploymentId: string | null;
  deploymentVersion: string | null;
  environment: string | null;
  branch?: string | null;
  buildId?: string | null;
}

export interface DatasetProvenance {
  datasetVersion: string;
  caseCount: number;
  dimensionsCount: number;
  source: 'source-controlled' | 'Not Tracked';
}

export interface ReleaseQualitySignal {
  runId: string;
  datasetVersion: string;
  datasetProvenance: DatasetProvenance;
  releaseMetadata: ReleaseMetadata;
  qualityGate: QualityGateEvaluationResult;
  qualityDecision: QualityDecision;
  metrics: {
    status: string;
    mode: string;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    passRate: number;
    overallScore: number;
    regressionCount: number;
    durationMs: number;
    startedAt: string;
    completedAt: string | null;
  };
  generatedAt: string;
}

// ==========================================
// Evaluation Intelligence 2.0 (Phase 12.6)
// ==========================================

export type QualityHealthStatus = 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'CRITICAL' | 'INSUFFICIENT_DATA';
export type MeasurementConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
export type TrendDirection = 'improving' | 'stable' | 'degrading' | 'insufficient_history';
export type DegradationSeverity = 'info' | 'warning' | 'critical';
export type DegradationCategory = 'quality' | 'reliability' | 'performance' | 'regression_acceleration';

export interface MetricDelta {
  current: number;
  previous: number | 'INSUFFICIENT_HISTORY';
  delta: number | 'INSUFFICIENT_HISTORY';
  direction: TrendDirection;
}

export interface MovingAverageMetrics {
  score: number | 'INSUFFICIENT_HISTORY';
  passRate: number | 'INSUFFICIENT_HISTORY';
  regressions: number | 'INSUFFICIENT_HISTORY';
  latencyMs: number | 'INSUFFICIENT_HISTORY';
  tokens: number | 'INSUFFICIENT_HISTORY';
  sampleSize: number;
  status: 'available' | 'INSUFFICIENT_HISTORY';
}

export interface RunTrendSummary {
  runId: string;
  createdAt: string;
  datasetVersion: string;
  mode: string;
  overallScore: number;
  passRate: number;
  failureRate: number;
  regressionCount: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  durationMs: number;
  averageLatencyMs: number;
  averageTokens: number;
  totalTokens: number;
  failuresByDimension: Record<string, number>;
}

export interface QualityTrendIntelligence {
  status: 'available' | 'INSUFFICIENT_HISTORY';
  historicalRunsCount: number;
  currentRun: RunTrendSummary | null;
  previousRun: RunTrendSummary | null;
  scoreTrend: MetricDelta;
  passRateTrend: MetricDelta;
  regressionTrend: MetricDelta;
  latencyTrend: MetricDelta;
  tokenTrend: MetricDelta;
  threeRunMovingAverage: MovingAverageMetrics;
  sevenRunMovingAverage: MovingAverageMetrics;
  runOverRunSeries: RunTrendSummary[];
}

export interface DegradationSignal {
  id: string;
  category: DegradationCategory;
  severity: DegradationSeverity;
  dimension?: string;
  metric: string;
  title: string;
  message: string;
  previousValue: number | string;
  currentValue: number | string;
  thresholdBreached: string;
  timestamp: string;
}

export interface DegradationDetectionResult {
  healthStatus: QualityHealthStatus;
  statusReason: string;
  signalsCount: number;
  criticalSignalsCount: number;
  warningSignalsCount: number;
  signals: DegradationSignal[];
  regressionAcceleration: {
    detected: boolean;
    streakLength: number;
    consecutiveRegressions: number[];
  };
}

export interface RankedCaseItem {
  caseId: string;
  dimension: string;
  title: string;
  description: string;
  score: number;
  status: string;
  regression: boolean;
  failureCategory?: string;
  failureReason?: string | null;
  fingerprint?: string;
  durationMs: number;
  tokens: number;
  provider?: string | null;
  model?: string | null;
}

export interface FlakyCaseItem {
  caseId: string;
  dimension: string;
  title: string;
  isFlaky: boolean;
  flipCount: number;
  totalObservations: number;
  passCount: number;
  failCount: number;
  flakinessRatePct: number;
  lastStatus: string;
  failureFingerprints: string[];
  history: {
    runId: string;
    status: string;
    score: number;
    createdAt: string;
  }[];
}

export interface DimensionPerformanceItem {
  dimension: string;
  sampleSize: number;
  averageLatencyMs: number;
  p90LatencyMs: number | 'INSUFFICIENT_DATA';
  totalTokens: number;
  averageTokens: number;
}

export interface CasePerformanceItem {
  caseId: string;
  dimension: string;
  title: string;
  durationMs: number;
  tokens: number;
  status: string;
}

export interface PerformanceIntelligenceResult {
  status: 'available' | 'INSUFFICIENT_DATA';
  sampleSize: number;
  latency: {
    averageMs: number;
    p50Ms: number | 'INSUFFICIENT_DATA';
    p90Ms: number | 'INSUFFICIENT_DATA';
    p95Ms: number | 'INSUFFICIENT_DATA';
    p99Ms: number | 'INSUFFICIENT_DATA';
    minMs: number;
    maxMs: number;
  };
  tokens: {
    totalTokens: number;
    averageTokensPerCase: number;
    minTokens: number;
    maxTokens: number;
  };
  byDimension: DimensionPerformanceItem[];
  slowestCases: CasePerformanceItem[];
  topTokenCases: CasePerformanceItem[];
}

export interface ContributingFactor {
  id: string;
  factorType: string;
  label: string;
  provider?: string;
  model?: string;
  tool?: string;
  dimension?: string;
  observed: string;
  correlationExplanation: string;
  affectedCasesCount: number;
  affectedCaseIds: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
}

export interface RootCauseAnalysisResult {
  status: 'available' | 'ROOT_CAUSE_DATA_UNAVAILABLE';
  analyzedFailuresCount: number;
  factors: ContributingFactor[];
  summary: string;
}

export interface MeasurementConfidenceResult {
  level: MeasurementConfidenceLevel;
  overallConfidenceScore: number;
  historicalDepth: {
    completedRunsCount: number;
    sufficientForTrends: boolean;
    sufficientForPercentiles: boolean;
  };
  coverageCompleteness: {
    evaluatedCases: number;
    goldenDatasetTotal: number;
    coveragePct: number;
  };
  telemetryCompleteness: {
    hasLatencyTelemetry: boolean;
    hasTokenTelemetry: boolean;
    hasModelMetadata: boolean;
    hasReleaseProvenance: boolean;
  };
  factors: {
    factor: string;
    status: 'passed' | 'warning' | 'failed';
    weight: number;
    score: number;
    message: string;
  }[];
}

export interface EnrichedDimensionHealthItem extends DimensionHealth {
  previousScore: number | 'INSUFFICIENT_HISTORY';
  scoreDelta: number | 'INSUFFICIENT_HISTORY';
  trend: TrendDirection;
  healthStatus: 'HEALTHY' | 'WATCH' | 'DEGRADED';
}

export interface FailureTaxonomyAnalytics {
  category: FailureCategory;
  count: number;
  percentage: number;
  affectedDimensions: string[];
  affectedCases: string[];
  consecutiveOccurrences: number;
}

export interface EvaluationIntelligenceOverview {
  healthStatus: QualityHealthStatus;
  statusReason: string;
  currentRun: RunTrendSummary | null;
  measurementConfidence: MeasurementConfidenceResult;
  trends: QualityTrendIntelligence;
  degradation: DegradationDetectionResult;
  dimensions: Record<string, EnrichedDimensionHealthItem>;
  failures: {
    totalFailures: number;
    taxonomyAnalytics: FailureTaxonomyAnalytics[];
    clusters: FailureCluster[];
  };
  bestCases: RankedCaseItem[];
  worstCases: RankedCaseItem[];
  flakyCases: FlakyCaseItem[];
  performance: PerformanceIntelligenceResult;
  rootCauses: RootCauseAnalysisResult;
  providers: {
    status: 'available' | 'INSUFFICIENT_PROVIDER_DATA';
    diagnostics: any[];
  };
  lastUpdated: string;
}

export type ComparisonCaseCategory =
  | 'NEW FAILURE'
  | 'RESOLVED'
  | 'REGRESSED'
  | 'IMPROVED'
  | 'CHANGED'
  | 'UNCHANGED';

export interface EnhancedCaseComparisonItem {
  caseId: string;
  dimension: string;
  title: string;
  category: ComparisonCaseCategory;
  runA: {
    status: string;
    score: number;
    durationMs: number;
    failureReason?: string | null;
  };
  runB: {
    status: string;
    score: number;
    durationMs: number;
    failureReason?: string | null;
  };
  scoreDelta: number;
  durationDeltaMs: number;
}

export interface ReleaseComparisonResult {
  runA: EvaluationRunItem;
  runB: EvaluationRunItem;
  releaseA: ReleaseMetadata;
  releaseB: ReleaseMetadata;
  isSameDataset: boolean;
  metrics: {
    scoreDelta: number;
    passRateDeltaPp: number;
    failuresDelta: number;
    regressionsDelta: number;
    durationDeltaMs: number;
    tokensDelta: number;
  };
  summaryCounts: {
    total: number;
    changed: number;
    newFailures: number;
    resolved: number;
    regressed: number;
    improved: number;
    unchanged: number;
  };
  dimensionDeltas: {
    dimension: string;
    scoreA: number;
    scoreB: number;
    scoreDelta: number;
    passRateA: number;
    passRateB: number;
    passRateDeltaPp: number;
  }[];
  cases: EnhancedCaseComparisonItem[];
}




