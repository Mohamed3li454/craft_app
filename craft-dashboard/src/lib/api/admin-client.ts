import {
  AdminOverviewData,
  SystemHealthData,
  ObservabilityMetrics,
  AdminUserListItem,
  UserDetails360,
  AdminConversationItem,
  AdminMessageItem,
  AdminMemoryItem,
  AdminMemoryCandidate,
  AdminReminderItem,
  AdminFaqItem,
  AdminCacheCandidate,
  AdminCacheMetrics,
  AdminAgentRunItem,
  AdminAgentRunDetails,
  AdminToolCallItem,
  AdminProactiveAction,
  AdminProactiveEngagement,
  AdminSearchItem,
  SearchDiagnosticResult,
  AdminSafeSettings,
  AdminAuditItem,
  AdminSuccessResponse,
} from '@/types/admin';

class AdminApiClient {
  private baseUrl = '/api/admin-proxy';

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<AdminSuccessResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin',
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      const err = new Error(data?.error?.message || `Request failed with status ${res.status}`);
      (err as any).code = data?.error?.code || 'UNKNOWN_ERROR';
      (err as any).correlationId = data?.correlationId;
      (err as any).status = res.status;
      throw err;
    }

    return data as AdminSuccessResponse<T>;
  }

  // 1. Overview
  async getOverview(days = 14) {
    return this.request<AdminOverviewData>(`/overview?days=${days}`);
  }

  // 2. Observability
  async getHealth() {
    return this.request<SystemHealthData>('/observability/health');
  }

  async getMetrics() {
    return this.request<ObservabilityMetrics>('/observability/metrics');
  }

  // 3. Users
  async getUsers(params: { search?: string; isVip?: boolean; isBanned?: boolean; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.isVip !== undefined) qs.set('isVip', String(params.isVip));
    if (params.isBanned !== undefined) qs.set('isBanned', String(params.isBanned));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return this.request<AdminUserListItem[]>(`/users?${qs.toString()}`);
  }

  async getUserDetails(id: string) {
    return this.request<UserDetails360>(`/users/${encodeURIComponent(id)}/details`);
  }

  async toggleUserVip(id: string, isVip: boolean) {
    return this.request<{ userId: string; isVip: boolean }>(`/users/${encodeURIComponent(id)}/toggle-vip`, {
      method: 'POST',
      body: JSON.stringify({ isVip }),
    });
  }

  async banUser(id: string, reason?: string) {
    return this.request<{ userId: string; isBanned: boolean }>(`/users/${encodeURIComponent(id)}/ban`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async unbanUser(id: string) {
    return this.request<{ userId: string; isBanned: boolean }>(`/users/${encodeURIComponent(id)}/unban`, {
      method: 'POST',
    });
  }

  // 4. Conversations
  async getConversations(params: { userId?: string; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.userId) qs.set('userId', params.userId);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return this.request<AdminConversationItem[]>(`/conversations?${qs.toString()}`);
  }

  async getConversationMessages(id: string, params: { limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<AdminMessageItem[]>(`/conversations/${encodeURIComponent(id)}/messages${query}`);
  }

  async archiveConversation(id: string) {
    return this.request<{ id: string; status: string }>(`/conversations/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    });
  }

  // 5. Memory
  async getMemoryItems(params: { userId?: string; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.userId) qs.set('userId', params.userId);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return this.request<AdminMemoryItem[]>(`/memory?${qs.toString()}`);
  }

  async getMemoryDetails(id: string) {
    return this.request<AdminMemoryItem>(`/memory/${encodeURIComponent(id)}`);
  }

  async getMemoryCandidates(params: { status?: string; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return this.request<AdminMemoryCandidate[]>(`/memory/candidates?${qs.toString()}`);
  }

  async approveMemoryCandidate(id: string) {
    return this.request<{ candidateId: string; status: string }>(`/memory/candidates/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  async rejectMemoryCandidate(id: string, reason?: string) {
    return this.request<{ candidateId: string; status: string }>(`/memory/candidates/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async purgeUserMemories(userId: string) {
    return this.request<{ userId: string; purgedCount: number }>(`/memory/purge`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  // 6. Reminders
  async getReminders(params: { status?: string; search?: string; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return this.request<AdminReminderItem[]>(`/reminders?${qs.toString()}`);
  }

  async getReminderDetails(id: string) {
    return this.request<AdminReminderItem>(`/reminders/${encodeURIComponent(id)}`);
  }

  async cancelReminder(id: string, reason?: string) {
    return this.request<{ id: string; status: string }>(`/reminders/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async retryReminder(id: string) {
    return this.request<{ id: string; status: string; scheduledTime: string }>(`/reminders/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
  }

  // 7. Knowledge & Semantic Cache
  async getFaqs() {
    return this.request<AdminFaqItem[]>('/knowledge/faq');
  }

  async createFaq(data: { question: string; answer: string; category?: string; keywords?: string[] }) {
    return this.request<AdminFaqItem>('/knowledge/faq', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFaq(id: string, data: Partial<AdminFaqItem>) {
    return this.request<AdminFaqItem>(`/knowledge/faq/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteFaq(id: string) {
    return this.request<{ success: boolean; id: string }>(`/knowledge/faq/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async getCacheCandidates() {
    return this.request<AdminCacheCandidate[]>('/knowledge/cache/candidates');
  }

  async getCacheMetrics() {
    return this.request<AdminCacheMetrics>('/knowledge/cache/metrics');
  }

  async validateCacheCandidate(id: string) {
    return this.request<{ id: string; status: string }>(`/knowledge/cache/candidates/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
    });
  }

  async rejectCacheCandidate(id: string) {
    return this.request<{ id: string; status: string }>(`/knowledge/cache/candidates/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
    });
  }

  async promoteCacheCandidate(id: string) {
    return this.request<{ id: string; status: string }>(`/knowledge/cache/candidates/${encodeURIComponent(id)}/promote`, {
      method: 'POST',
    });
  }

  // 8. Agent Runs (Zero Reasoning Leakage)
  async getAgentRuns(params: { limit?: number; offset?: number; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.status) qs.set('status', params.status);
    return this.request<AdminAgentRunItem[]>(`/agent-runs?${qs.toString()}`);
  }

  async getAgentRunDetails(id: string) {
    return this.request<AdminAgentRunDetails>(`/agent-runs/${encodeURIComponent(id)}`);
  }

  // 9. Tool Calls
  async getToolCalls(params: { limit?: number; offset?: number; toolName?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.toolName) qs.set('toolName', params.toolName);
    return this.request<AdminToolCallItem[]>(`/tool-calls?${qs.toString()}`);
  }

  // 10. Proactive Intelligence
  async getProactiveActions(params: { limit?: number; offset?: number; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.status) qs.set('status', params.status);
    return this.request<AdminProactiveAction[]>(`/proactive/actions?${qs.toString()}`);
  }

  async cancelProactiveAction(id: string) {
    return this.request<{ id: string; status: string }>(`/proactive/actions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
  }

  async retryProactiveAction(id: string) {
    return this.request<{ id: string; status: string }>(`/proactive/actions/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
  }

  async getProactiveDispatchLog() {
    return this.request<any[]>('/proactive/dispatch-log');
  }

  async getProactiveEngagement() {
    return this.request<AdminProactiveEngagement>('/proactive/engagement');
  }

  // 11. Search Intelligence
  async getRecentSearches() {
    return this.request<AdminSearchItem[]>('/search/recent');
  }

  async runSearchDiagnostic(query: string, intent?: string) {
    return this.request<SearchDiagnosticResult>('/search/diagnostic', {
      method: 'POST',
      body: JSON.stringify({ query, intent }),
    });
  }

  // 12. Settings
  async getSettings() {
    return this.request<AdminSafeSettings>('/settings');
  }

  async updateSettings(settings: Partial<AdminSafeSettings['runtime']>) {
    return this.request<AdminSafeSettings['runtime']>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // 13. Audit Logs
  async getAuditLogs(params: { limit?: number; offset?: number; actorId?: string; action?: string; resourceType?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.actorId) qs.set('actorId', params.actorId);
    if (params.action) qs.set('action', params.action);
    if (params.resourceType) qs.set('resourceType', params.resourceType);
    return this.request<AdminAuditItem[]>(`/audit?${qs.toString()}`);
  }
}

export const adminApi = new AdminApiClient();
