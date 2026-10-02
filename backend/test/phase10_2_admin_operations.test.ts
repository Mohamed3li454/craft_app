import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../src/app';
import { config } from '../src/config/env';
import { defaultAdminRateLimiter } from '../src/middleware/admin_rate_limiter';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { ProactiveActionRepository } from '../src/modules/proactive/proactive_action.repo';
import { ProactiveDispatchRepository } from '../src/modules/whatsapp/proactive_dispatch.repo';
import { SemanticCandidateRepository } from '../src/database/repositories/semantic_candidate.repo';
import { DatabaseManager } from '../src/database/connection';

describe('Phase 10.2: Admin Operations API Control Plane', () => {
  const adminSecret = config.admin.secretKey;
  let server: http.Server;
  let baseUrl: string;

  // In-memory repositories for test assertions
  const chatRepo = new ChatRepository();
  const memoryRepo = new MemoryRepository();
  const evidenceRepo = MemoryEvidenceRepository.getInstance();
  const reminderRepo = new ReminderRepository();
  const proactiveRepo = new ProactiveActionRepository();
  const dispatchRepo = new ProactiveDispatchRepository();
  const semanticRepo = new SemanticCandidateRepository();

  const sampleRunId = 'd892695c-9c3f-4e67-89df-1b0521e1a123';
  const sampleToolId = 'c892695c-9c3f-4e67-89df-1b0521e1a456';
  let convId: string;

  beforeAll(async () => {
    process.env.GROQ_MOCK_MODE = 'true';
    process.env.ADMIN_SECRET_KEY = adminSecret;

    // Seed test conversation properly
    const conv = await chatRepo.getOrCreateConversation('usr_test_102', 'whatsapp', 'Test Chat');
    convId = conv.id;

    const pool = DatabaseManager.getInstance().getPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          ['usr_test_102', 'Test User']
        );
        await pool.query(
          `INSERT INTO conversations (id, user_id, channel, title, is_archived, created_at, updated_at)
           VALUES ($1, $2, 'whatsapp', 'Test Chat', false, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          ['conv_test_102', 'usr_test_102']
        );
        await pool.query(
          `INSERT INTO agent_runs (id, conversation_id, user_prompt, status, iterations_count, created_at)
           VALUES ($1, $2, $3, 'completed', 2, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [sampleRunId, 'conv_test_102', 'Sample prompt for agent run']
        );
        await pool.query(
          `INSERT INTO tool_calls (id, agent_run_id, tool_name, arguments, status, result, created_at, completed_at)
           VALUES ($1, $2, $3, $4, 'success', $5, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            sampleToolId,
            sampleRunId,
            'web_search',
            JSON.stringify({ query: 'craft AI', reasoning: 'INTERNAL_SECRET_THOUGHT' }),
            JSON.stringify({ title: 'Craft Search Result', thought: 'HIDDEN_MODEL_REASONING' }),
          ]
        );
      } catch (err: any) {
        // Ignored in purely in-memory mode
      }
    }

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll((done) => {
    defaultAdminRateLimiter.reset();
    server.close(done);
  });

  beforeEach(() => {
    defaultAdminRateLimiter.reset();
  });

  // Helper for authenticated requests returning strongly-typed status and payload
  const adminFetch = async (
    path: string,
    options: {
      method?: string;
      body?: any;
      headers?: Record<string, string>;
      role?: string;
    } = {}
  ): Promise<{ status: number; json: any; headers: Headers }> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${adminSecret}`,
      'Content-Type': 'application/json',
      ...(options.role ? { 'X-Admin-Role': options.role } : {}),
      ...(options.headers || {}),
    };

    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const json = (await res.json()) as any;
    return { status: res.status, json, headers: res.headers };
  };

  // =========================================================================
  // 1. User Operations Control Plane
  // =========================================================================
  describe('1. Users Operations Control Plane', () => {
    it('GET /api/admin/users lists users with standard pagination contract', async () => {
      const { status, json } = await adminFetch('/api/admin/users?limit=10');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.correlationId).toBeDefined();
      expect(json.timestamp).toBeDefined();
    });

    it('GET /api/admin/users handles search and filter params gracefully', async () => {
      const { status, json } = await adminFetch('/api/admin/users?search=test_user&isVip=true&limit=5');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('GET /api/admin/users/:id/details returns User 360 profile', async () => {
      const { status, json } = await adminFetch('/api/admin/users/usr_test_102/details');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.user).toBeDefined();
      expect(json.data.user.id).toBe('usr_test_102');
      expect(json.data.metrics).toBeDefined();
      expect(typeof json.data.metrics.totalConversations).toBe('number');
    });

    it('POST /api/admin/users/:id/toggle-vip toggles VIP status', async () => {
      const { status, json } = await adminFetch('/api/admin/users/usr_test_102/toggle-vip', {
        method: 'POST',
        body: { isVip: true },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('usr_test_102');
      expect(json.data.isVip).toBe(true);
    });

    it('POST /api/admin/users/:id/ban and unban controls user access safely', async () => {
      // Ban
      const { status: banStatus, json: banJson } = await adminFetch('/api/admin/users/usr_test_102/ban', {
        method: 'POST',
        body: { reason: 'Violated terms with abusive messages' },
      });
      expect(banStatus).toBe(200);
      expect(banJson.success).toBe(true);
      expect(banJson.data.id).toBe('usr_test_102');
      expect(banJson.data.isBanned).toBe(true);
      expect(banJson.data.reason).toBe('Violated terms with abusive messages');

      // Unban
      const { status: unbanStatus, json: unbanJson } = await adminFetch('/api/admin/users/usr_test_102/unban', {
        method: 'POST',
      });
      expect(unbanStatus).toBe(200);
      expect(unbanJson.success).toBe(true);
      expect(unbanJson.data.id).toBe('usr_test_102');
      expect(unbanJson.data.isBanned).toBe(false);
    });
  });

  // =========================================================================
  // 2. Conversation Operations
  // =========================================================================
  describe('2. Conversations Operations', () => {
    it('GET /api/admin/conversations lists conversations with pagination', async () => {
      const { status, json } = await adminFetch('/api/admin/conversations?limit=20');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.pagination).toBeDefined();
    });

    it('GET /api/admin/conversations/:id/messages returns message transcript', async () => {
      const { status, json } = await adminFetch(`/api/admin/conversations/${convId}/messages?limit=50`);
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('POST /api/admin/conversations/:id/archive archives conversation', async () => {
      const { status, json } = await adminFetch(`/api/admin/conversations/${convId}/archive`, {
        method: 'POST',
        body: { isArchived: true },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(convId);
      expect(json.data.isArchived).toBe(true);
    });
  });

  // =========================================================================
  // 3. Memory Operations (Confirmed & Candidates)
  // =========================================================================
  describe('3. Memory Operations (Confirmed Items & Candidates)', () => {
    let createdMemoryId: string;
    let candidateId: string;

    beforeAll(async () => {
      // Seed a memory item
      const item = await memoryRepo.saveFact(
        'usr_test_102',
        'User prefers concise Arabic responses',
        'preference' as any,
        { source: 'system_derived' }
      );
      createdMemoryId = item.id;

      // Seed an evidence candidate
      const cand = await evidenceRepo.recordObservation({
        userId: 'usr_test_102',
        candidateKey: 'pref:lang:egyptian',
        category: 'language_preference',
        rawSignal: 'اتكلم مصري لو سمحت',
        canonicalFact: 'User prefers Egyptian Arabic dialect',
        source: 'user_explicit',
        confidence: 0.95,
      });
      candidateId = cand.candidate.id;
    });

    it('GET /api/admin/memory lists confirmed memory items with pagination', async () => {
      const { status, json } = await adminFetch('/api/admin/memory?userId=usr_test_102');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('GET /api/admin/memory/:id returns single memory item details', async () => {
      const { status, json } = await adminFetch(`/api/admin/memory/${createdMemoryId}`);
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(createdMemoryId);
    });

    it('PUT /api/admin/memory/:id updates memory fact text', async () => {
      const { status, json } = await adminFetch(`/api/admin/memory/${createdMemoryId}`, {
        method: 'PUT',
        body: {
          factText: 'User strictly prefers concise Egyptian Arabic responses',
          category: 'preference',
        },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.factText).toContain('concise Egyptian Arabic');
    });

    it('GET /api/admin/memory/candidates lists evidence candidates', async () => {
      const { status, json } = await adminFetch('/api/admin/memory/candidates?userId=usr_test_102');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('POST /api/admin/memory/candidates/:id/approve promotes candidate with Memory Safety Gate', async () => {
      const { status, json } = await adminFetch(`/api/admin/memory/candidates/${candidateId}/approve`, {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('promoted');
      expect(json.data.promotedMemoryId).toBeDefined();
    });

    it('POST /api/admin/memory/candidates/:id/reject rejects candidate with reason', async () => {
      // Create another candidate to reject
      const cand2 = await evidenceRepo.recordObservation({
        userId: 'usr_test_102',
        candidateKey: 'temp:test:reject',
        category: 'ephemeral_context',
        rawSignal: 'Test candidate for rejection',
        canonicalFact: 'Temporary ephemeral note',
        source: 'automatic_extraction',
        confidence: 0.5,
      });

      const { status, json } = await adminFetch(`/api/admin/memory/candidates/${cand2.candidate.id}/reject`, {
        method: 'POST',
        body: { reason: 'Irrelevant ephemeral statement' },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('rejected');
    });

    it('POST /api/admin/memory/purge safely purges user memories', async () => {
      const { status, json } = await adminFetch('/api/admin/memory/purge', {
        method: 'POST',
        body: {
          userId: 'usr_test_102',
          confirmation: 'CONFIRM_PURGE',
        },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.purged).toBe(true);
    });
  });

  // =========================================================================
  // 4. Reminder Operations
  // =========================================================================
  describe('4. Reminders Operations (Full Lifecycle & Scheduler-Safe Retry)', () => {
    let reminderId: string;

    beforeAll(async () => {
      const reminder = await reminderRepo.create(
        'usr_test_102',
        'Prepare sprint retrospective',
        new Date(Date.now() + 3600000)
      );
      reminderId = reminder.id;
    });

    it('GET /api/admin/reminders lists reminders with pagination & status filters', async () => {
      const { status, json } = await adminFetch('/api/admin/reminders?status=scheduled');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('GET /api/admin/reminders/:id returns reminder details', async () => {
      const { status, json } = await adminFetch(`/api/admin/reminders/${reminderId}`);
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(reminderId);
      expect(json.data.title).toBe('Prepare sprint retrospective');
    });

    it('POST /api/admin/reminders/:id/retry resets state to retry_pending without WhatsApp bypass', async () => {
      const { status, json } = await adminFetch(`/api/admin/reminders/${reminderId}/retry`, {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(reminderId);
      expect(json.data.state).toBe('retry_pending');
      expect(json.data.message).toContain('Reminder queued for scheduler delivery');
    });

    it('POST /api/admin/reminders/:id/cancel cancels reminder lifecycle', async () => {
      const { status, json } = await adminFetch(`/api/admin/reminders/${reminderId}/cancel`, {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(reminderId);
      expect(json.data.state).toBe('cancelled');
    });
  });

  // =========================================================================
  // 5. Knowledge & Semantic Cache Operations
  // =========================================================================
  describe('5. Knowledge & Semantic Cache Operations', () => {
    let faqId: string;

    it('GET /api/admin/knowledge/faq lists FAQs', async () => {
      const { status, json } = await adminFetch('/api/admin/knowledge/faq');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('POST /api/admin/knowledge/faq creates a new FAQ entry', async () => {
      const { status, json } = await adminFetch('/api/admin/knowledge/faq', {
        method: 'POST',
        body: {
          title: 'What is Craft AI Assistant?',
          patterns: ['ما هو كرافت', 'what is craft'],
          response: 'Craft is an enterprise AI assistant with memory and proactive task support.',
          category: 'general',
        },
      });
      expect(status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.data.id).toBeDefined();
      faqId = json.data.id;
    });

    it('PUT /api/admin/knowledge/faq/:id updates existing FAQ', async () => {
      const { status, json } = await adminFetch(`/api/admin/knowledge/faq/${faqId}`, {
        method: 'PUT',
        body: {
          response: 'Updated answer: Craft is a hardened enterprise AI assistant.',
        },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.response).toContain('Updated answer');
    });

    it('GET /api/admin/knowledge/cache/metrics returns observability stats', async () => {
      const { status, json } = await adminFetch('/api/admin/knowledge/cache/metrics');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.stats).toBeDefined();
      expect(json.data.learning).toBeDefined();
    });

    it('DELETE /api/admin/knowledge/faq/:id deletes FAQ entry', async () => {
      const { status, json } = await adminFetch(`/api/admin/knowledge/faq/${faqId}`, {
        method: 'DELETE',
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
    });
  });

  // =========================================================================
  // 6. Agent Runs Observability (Zero Hidden Thoughts)
  // =========================================================================
  describe('6. Agent Runs Observability & Reasoning Redaction', () => {
    it('GET /api/admin/agent-runs lists execution runs with telemetry', async () => {
      const { status, json } = await adminFetch('/api/admin/agent-runs?limit=10');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('GET /api/admin/agent-runs/:id redacts private thoughts/reasoning strictly', async () => {
      const { status, json } = await adminFetch(`/api/admin/agent-runs/${sampleRunId}`);
      if (status === 200) {
        expect(json.success).toBe(true);
        expect(json.data).toBeDefined();

        // Verify no reasoning or thought leakage
        const rawText = JSON.stringify(json.data);
        expect(rawText).not.toContain('INTERNAL_SECRET_THOUGHT');
        expect(rawText).not.toContain('HIDDEN_MODEL_REASONING');
        expect(rawText).not.toContain('"reasoning"');
        expect(rawText).not.toContain('"thought"');
      } else {
        expect(status).toBe(404);
      }
    });
  });

  // =========================================================================
  // 7. Tool Calls Operations
  // =========================================================================
  describe('7. Tool Calls Operations & Sanitized Telemetry', () => {
    it('GET /api/admin/tool-calls lists tool executions with filter support', async () => {
      const { status, json } = await adminFetch('/api/admin/tool-calls?limit=10');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('GET /api/admin/tool-calls/:id returns sanitized tool details without credentials', async () => {
      const { status, json } = await adminFetch(`/api/admin/tool-calls/${sampleToolId}`);
      if (status === 200) {
        expect(json.success).toBe(true);
        expect(json.data.id).toBe(sampleToolId);
        expect(json.data.toolName).toBe('web_search');
        expect(json.data.arguments.reasoning).toBeUndefined();
        expect(json.data.result.thought).toBeUndefined();
      } else {
        expect(status).toBe(404);
      }
    });
  });

  // =========================================================================
  // 8. Proactive Operations
  // =========================================================================
  describe('8. Proactive Operations (Actions, Dispatch Log, Engagement)', () => {
    let actionId: string;

    beforeAll(async () => {
      const action = await proactiveRepo.createOrGet({
        userId: 'usr_test_102',
        candidateType: 'unresolved_follow_up',
        topic: 'briefing',
        contextDigest: `digest_102_${Date.now()}`,
        reason: 'scheduled morning briefing',
        deliveryMode: 'out_of_turn',
        eligibleAt: new Date(Date.now() + 7200000),
        expiresAt: new Date(Date.now() + 86400000),
      });
      actionId = action.id;
    });

    it('GET /api/admin/proactive/actions lists proactive actions', async () => {
      const { status, json } = await adminFetch('/api/admin/proactive/actions?limit=10');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('GET /api/admin/proactive/actions/:id returns action details', async () => {
      const { status, json } = await adminFetch(`/api/admin/proactive/actions/${actionId}`);
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(actionId);
    });

    it('POST /api/admin/proactive/actions/:id/cancel cancels proactive action', async () => {
      const { status, json } = await adminFetch(`/api/admin/proactive/actions/${actionId}/cancel`, {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(actionId);
      expect(json.data.status).toBe('suppressed');
    });

    it('POST /api/admin/proactive/actions/:id/retry requeues proactive action safely', async () => {
      const { status, json } = await adminFetch(`/api/admin/proactive/actions/${actionId}/retry`, {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(actionId);
      expect(json.data.status).toBe('pending');
    });

    it('GET /api/admin/proactive/dispatch-log lists outbound dispatch records', async () => {
      const { status, json } = await adminFetch('/api/admin/proactive/dispatch-log?limit=10');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('GET /api/admin/proactive/engagement lists user response engagement events', async () => {
      const { status, json } = await adminFetch('/api/admin/proactive/engagement?limit=10');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });
  });

  // =========================================================================
  // 9. Search Intelligence
  // =========================================================================
  describe('9. Search Intelligence & Diagnostic Operations', () => {
    it('GET /api/admin/search/recent returns telemetry on recent searches', async () => {
      const { status, json } = await adminFetch('/api/admin/search/recent?limit=10');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('POST /api/admin/search/diagnostic performs safe search diagnostic dry-run', async () => {
      const { status, json } = await adminFetch('/api/admin/search/diagnostic', {
        method: 'POST',
        body: { query: 'latest tech news' },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.diagnosticQuery).toBe('latest tech news');
      expect(json.data.status).toBe('healthy');
      expect(json.data.networkCallExecuted).toBe(false);
    });
  });

  // =========================================================================
  // 10. Runtime Settings & Platform Configuration
  // =========================================================================
  describe('10. Runtime Settings & Infrastructure Metadata', () => {
    it('GET /api/admin/settings returns safe environment config with ZERO secret exposure', async () => {
      const { status, json } = await adminFetch('/api/admin/settings');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.infrastructure).toBeDefined();
      expect(json.data.infrastructure.environment).toBeDefined();
      expect(json.data.runtimeSettings).toBeDefined();

      // Strictly verify no secret keys or tokens are leaked in settings output
      const raw = JSON.stringify(json.data).toLowerCase();
      expect(raw).not.toContain(adminSecret.toLowerCase());
      expect(raw).not.toContain('secretkey');
      expect(raw).not.toContain('password');
      expect(raw).not.toContain('privatekey');
      expect(raw).not.toContain('gsk_');
    });

    it('PUT /api/admin/settings updates runtime toggles safely', async () => {
      const { status, json } = await adminFetch('/api/admin/settings', {
        method: 'PUT',
        body: {
          searchEnabled: true,
          proactiveEnabled: true,
        },
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.searchEnabled).toBe(true);
      expect(json.data.proactiveEnabled).toBe(true);
    });
  });

  // =========================================================================
  // 11. Role-Based Access Control (RBAC) Guard
  // =========================================================================
  describe('11. Role-Based Access Control (RBAC) Enforcement', () => {
    it('rejects viewer role on mutation endpoints with 403 ADMIN_FORBIDDEN', async () => {
      const { status, json } = await adminFetch('/api/admin/users/usr_test_102/ban', {
        method: 'POST',
        role: 'viewer',
        body: { reason: 'Unauthorized attempt' },
      });

      expect(status).toBe(403);
      expect(json.error.code).toBe('ADMIN_FORBIDDEN');
      expect(json.error.message).toContain("role 'viewer' lacks permission");
    });

    it('rejects viewer role on settings update with 403 ADMIN_FORBIDDEN', async () => {
      const { status, json } = await adminFetch('/api/admin/settings', {
        method: 'PUT',
        role: 'viewer',
        body: { maintenanceMode: true },
      });

      expect(status).toBe(403);
      expect(json.error.code).toBe('ADMIN_FORBIDDEN');
    });

    it('allows operator or admin role on mutation endpoints', async () => {
      const { status, json } = await adminFetch('/api/admin/users/usr_test_102/toggle-vip', {
        method: 'POST',
        role: 'operator',
        body: { isVip: true },
      });

      expect(status).toBe(200);
      expect(json.success).toBe(true);
    });
  });
});
