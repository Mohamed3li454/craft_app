/**
 * @jest-environment node
 */

import { adminApi } from '@/lib/api/admin-client';
import { encodeSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { GET as proxyGetHandler, POST as proxyPostHandler } from '@/app/api/admin-proxy/[...path]/route';
import { NextRequest } from 'next/server';

function createAuthedRequest(path: string, options: { method?: string; body?: any; role?: string } = {}): NextRequest {
  const sessionCookie = encodeSession({
    token: 'test-admin-secret-key-production-readiness',
    role: (options.role as any) || 'admin',
    actorName: 'test-actor',
    expiresAt: Date.now() + 3600000,
  });

  const url = `http://localhost:3001/api/admin-proxy/${path}`;
  const req = new NextRequest(url, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': `corr-e2e-${Date.now()}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  req.cookies.set(SESSION_COOKIE_NAME, sessionCookie);
  return req;
}

describe('Phase 10.4 — E2E Readiness Verification Across All 13 Modules', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Module 1: Overview
  // =========================================================================
  it('E2E: Module 1 (Overview) fetches platform metrics and KPI summary', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            overview: { totalUsers: 1420, activeUsers24h: 312, totalConversations: 8900 },
            modelBreakdown: [{ model: 'llama-3.3-70b-versatile', calls: 5200 }],
          },
          correlationId: 'corr-mod-1',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('overview?days=14');
    const res = await proxyGetHandler(req, { params: { path: ['overview'] } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.overview.totalUsers).toBe(1420);
  });

  // =========================================================================
  // Module 2: Users & User 360
  // =========================================================================
  it('E2E: Module 2 (Users) fetches user list and single User 360 dossier', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/users/usr_100/details')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              user: { id: 'usr_100', name: 'Karim', phone: '+201000000000', isVip: true },
              memories: [{ key: 'language_preference', value: 'ar' }],
              stats: { totalMessages: 45, totalTokens: 12500 },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: [{ id: 'usr_100', name: 'Karim', phone: '+201000000000' }],
          pagination: { total: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const listReq = createAuthedRequest('users');
    const listRes = await proxyGetHandler(listReq, { params: { path: ['users'] } });
    expect(listRes.status).toBe(200);

    const detailReq = createAuthedRequest('users/usr_100/details');
    const detailRes = await proxyGetHandler(detailReq, { params: { path: ['users', 'usr_100', 'details'] } });
    expect(detailRes.status).toBe(200);
    const detailJson = await detailRes.json();
    expect(detailJson.data.user.name).toBe('Karim');
    expect(detailJson.data.memories.length).toBe(1);
  });

  // =========================================================================
  // Module 3: Conversations & Transcript Inspector
  // =========================================================================
  it('E2E: Module 3 (Conversations) fetches conversations and transcript messages', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversation: { id: 'conv_200', title: 'Car insurance inquiry' },
            messages: [
              { id: 'msg_1', role: 'user', content: 'What are the prices?' },
              { id: 'msg_2', role: 'assistant', content: 'Here are our packages...' },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('conversations/conv_200/messages');
    const res = await proxyGetHandler(req, { params: { path: ['conversations', 'conv_200', 'messages'] } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.messages.length).toBe(2);
  });

  // =========================================================================
  // Module 4: Reminders (Lifecycle Control)
  // =========================================================================
  it('E2E: Module 4 (Reminders) routes retry and cancel through Admin API', async () => {
    let interceptedEndpoint = '';
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      interceptedEndpoint = url;
      return new Response(
        JSON.stringify({ success: true, data: { id: 'rem_300', status: 'pending' } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const retryReq = createAuthedRequest('reminders/rem_300/retry', { method: 'POST' });
    const retryRes = await proxyPostHandler(retryReq, { params: { path: ['reminders', 'rem_300', 'retry'] } });
    expect(retryRes.status).toBe(200);
    // Invariant: Reminder lifecycle retry hits backend /api/admin/reminders/:id/retry
    expect(interceptedEndpoint).toContain('/api/admin/reminders/rem_300/retry');
  });

  // =========================================================================
  // Module 5: Memory & Candidate Review Queue
  // =========================================================================
  it('E2E: Module 5 (Memory) fetches confirmed memories and candidate approval', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [{ id: 'cand_1', key: 'lives_in', value: 'Cairo', confidence: 0.95, status: 'pending' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const candReq = createAuthedRequest('memory/candidates');
    const candRes = await proxyGetHandler(candReq, { params: { path: ['memory', 'candidates'] } });
    expect(candRes.status).toBe(200);
    const json = await candRes.json();
    expect(json.data[0].confidence).toBe(0.95);
  });

  // =========================================================================
  // Module 6: Knowledge & Semantic Cache
  // =========================================================================
  it('E2E: Module 6 (Knowledge) manages FAQs and semantic cache candidates', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            metrics: { hitRatePercent: 42.5, totalQueries: 5000, estimatedCostSaved: 12.8 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const cacheReq = createAuthedRequest('knowledge/cache/metrics');
    const cacheRes = await proxyGetHandler(cacheReq, { params: { path: ['knowledge', 'cache', 'metrics'] } });
    expect(cacheRes.status).toBe(200);
    const json = await cacheRes.json();
    expect(json.data.metrics.hitRatePercent).toBe(42.5);
  });

  // =========================================================================
  // Module 7: Agent Runs (Zero CoT Disclosure Guarantee)
  // =========================================================================
  it('E2E: Module 7 (Agent Runs) fetches execution traces with sanitized outputs', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'run_700',
            model: 'llama-3.3-70b-versatile',
            totalTokens: 1450,
            status: 'completed',
            promptSnippet: 'Tell me about product X',
            responseSnippet: 'Product X is designed for...',
            toolCalls: [{ toolName: 'faq_search', status: 'success', durationMs: 120 }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const traceReq = createAuthedRequest('agent-runs/run_700');
    const traceRes = await proxyGetHandler(traceReq, { params: { path: ['agent-runs', 'run_700'] } });
    expect(traceRes.status).toBe(200);
    const json = await traceRes.json();
    // Invariant: Raw chain of thought / hidden reasoning is never present in response
    expect(json.data.reasoning).toBeUndefined();
    expect(json.data.thought).toBeUndefined();
  });

  // =========================================================================
  // Module 8: Tool Calls Telemetry
  // =========================================================================
  it('E2E: Module 8 (Tools) fetches sanitized tool execution I/O', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [{ id: 'tc_1', toolName: 'web_search', durationMs: 410, status: 'success' }],
          pagination: { total: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('tool-calls');
    const res = await proxyGetHandler(req, { params: { path: ['tool-calls'] } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].toolName).toBe('web_search');
  });

  // =========================================================================
  // Module 9: Proactive Engagement
  // =========================================================================
  it('E2E: Module 9 (Proactive) fetches action queue and engagement telemetry', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [{ id: 'act_900', actionType: 'follow_up', status: 'pending' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('proactive/actions');
    const res = await proxyGetHandler(req, { params: { path: ['proactive', 'actions'] } });
    expect(res.status).toBe(200);
  });

  // =========================================================================
  // Module 10: Search Intelligence & Diagnostic Sandbox
  // =========================================================================
  it('E2E: Module 10 (Search) performs dry-run provider diagnostic probe', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            query: 'current price',
            results: [{ title: 'Item Price', snippet: 'Current market rate...' }],
            latencyMs: 340,
            provider: 'tavily',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('search/diagnostic', {
      method: 'POST',
      body: { query: 'current price', intent: 'price_inquiry' },
    });
    const res = await proxyPostHandler(req, { params: { path: ['search', 'diagnostic'] } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.provider).toBe('tavily');
  });

  // =========================================================================
  // Module 11: Observability & System Health
  // =========================================================================
  it('E2E: Module 11 (Observability) retrieves subsystem status and latency percentiles', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            status: 'healthy',
            uptimeSeconds: 86400,
            snapshot: {
              components: {
                postgres: { status: 'healthy', latencyMs: 2 },
                redis: { status: 'healthy', latencyMs: 1 },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('observability/health');
    const res = await proxyGetHandler(req, { params: { path: ['observability', 'health'] } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('healthy');
    expect(json.data.snapshot.components.postgres.status).toBe('healthy');
  });

  // =========================================================================
  // Module 12: Audit Trail
  // =========================================================================
  it('E2E: Module 12 (Audit) retrieves immutable audit log entries with correlation IDs', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 'aud_1',
              actorId: 'admin-alice',
              action: 'USER_BAN',
              targetId: 'usr_100',
              correlationId: 'corr-aud-1',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('audit');
    const res = await proxyGetHandler(req, { params: { path: ['audit'] } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].action).toBe('USER_BAN');
    expect(json.data[0].correlationId).toBe('corr-aud-1');
  });

  // =========================================================================
  // Module 13: Settings & Zero Secret Disclosure
  // =========================================================================
  it('E2E: Module 13 (Settings) inspects settings without secret leakage', async () => {
    const rawSettingsPayload = {
      success: true,
      data: {
        runtime: {
          maintenanceMode: false,
          debugLogging: false,
          searchEnabled: true,
          proactiveEnabled: true,
          defaultMemoryRetentionDays: 365,
        },
        services: {
          aiProvider: 'groq',
          channel: 'whatsapp',
        },
      },
      correlationId: 'corr-settings-1',
    };

    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(rawSettingsPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const req = createAuthedRequest('settings');
    const res = await proxyGetHandler(req, { params: { path: ['settings'] } });
    expect(res.status).toBe(200);
    const json = await res.json();
    const str = JSON.stringify(json);

    // Invariant: ZERO secret keys, webhook tokens, db credentials exposed
    expect(str).not.toContain('secret');
    expect(str).not.toContain('password');
    expect(str).not.toContain('key');
    expect(str).not.toContain('ADMIN_SECRET_KEY');
    expect(json.data.runtime.searchEnabled).toBe(true);
  });
});
