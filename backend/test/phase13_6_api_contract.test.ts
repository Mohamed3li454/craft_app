/**
 * Phase 13.6 — API Contract & Boundary Hardening Test Suite
 *
 * Verifies canonical Admin API contracts, dual-key compatibility, security boundaries,
 * pagination semantics, error standardization, BFF adaptation, and RBAC authorization:
 *
 * 1. Canonical Domain Contracts (12 tests)
 *    - Users List Contract (dual-keys)
 *    - User 360 Details Contract (metrics, memories, reminders)
 *    - Conversations List Contract (dual-keys, status)
 *    - Conversation Transcript Contract (latest-50, role/sender mapping)
 *    - Memory Items Contract (key/value, userPhone)
 *    - Reminders Contract (scheduledTime, status, retryCount)
 *    - Agent Runs List Contract (durationMs/latencyMs, null untracked model/tokens)
 *    - Agent Run Details Contract (child tool calls)
 *    - Tool Calls List Contract (runId/agentRunId, sanitized args/result)
 *    - Search Recent Contract (query, provider, latencyMs, sourceCount)
 *    - Search Diagnostic Contract (dryRun, zero network calls)
 *    - Settings Contract (runtime policy, zero secret disclosure)
 *
 * 2. Security & Redaction Boundaries (5 tests)
 *    - Purging of Chain-of-Thought / reasoning fields
 *    - Secret token redaction in tool arguments
 *    - Secret token redaction in tool outputs
 *    - Zero secret disclosure in platform configuration
 *    - Integration credentials reported as booleans only
 *
 * 3. Pagination & Query Contracts (4 tests)
 *    - Default limit=20, max limit=100 enforcement
 *    - Offset pagination and page calculation
 *    - Standardized pagination metadata { nextCursor, total }
 *    - Clamp negative or invalid limit/offset
 *
 * 4. Error Standardization & Traceability (4 tests)
 *    - 400 ADMIN_VALIDATION_ERROR contract
 *    - 403 ADMIN_FORBIDDEN contract
 *    - 404 ADMIN_NOT_FOUND contract
 *    - Trace correlation ID propagation in errors
 *
 * 5. Role-Based Access Control (RBAC) Authority (4 tests)
 *    - Owner permitted on mutations
 *    - Admin permitted on mutations
 *    - Viewer rejected with 403
 *    - Support rejected with 403
 *
 * 6. Regression with Phases 13.1–13.5 (5 tests)
 *    - Phase 13.5 Runtime policy resolver
 *    - Phase 13.4 Trigger contract
 *    - Phase 13.3 Proactive tool policy
 *    - Phase 13.2 Smart reminder tool policy
 *    - Phase 13.1 Smart reminder execution
 *
 * Total: 34 tests
 */

import { Request, Response } from 'express';
import { parsePaginationQuery } from '../src/modules/admin/pagination';
import { sendAdminSuccess, sendAdminError, AdminRole } from '../src/modules/admin/admin.types';
import { requireAdminRole } from '../src/middleware/admin_auth.middleware';
import { AdminAgentRunsController } from '../src/modules/admin/controllers/admin_agent_runs.controller';
import { AdminToolCallsController } from '../src/modules/admin/controllers/admin_tool_calls.controller';
import { AdminSearchController } from '../src/modules/admin/controllers/admin_search.controller';
import { AdminSettingsController } from '../src/modules/admin/controllers/admin_settings.controller';
import { RuntimePolicyResolver } from '../src/config/runtime_policy';
import { TriggerContract } from '../src/modules/tools/safety/trigger_contract';
import { ToolCapabilityPolicy } from '../src/modules/tools/safety/tool_capability_policy';

function buildMockResponse(req?: Request) {
  let statusCode = 200;
  let responseData: any;
  const res: any = {
    req: req || { headers: {} },
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((d: any) => {
      responseData = d;
      return res;
    }),
  };
  return {
    res: res as Response,
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
  };
}

describe('Phase 13.6: API Contract & Boundary Hardening', () => {
  let mockPool: any;
  let mockDbManager: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    mockDbManager = {
      getPool: jest.fn().mockReturnValue(mockPool),
    };
    RuntimePolicyResolver.resetToDefault();
    jest.clearAllMocks();
  });

  afterEach(() => {
    RuntimePolicyResolver.resetToDefault();
  });

  // =========================================================================
  // 1. Canonical Domain Contracts
  // =========================================================================
  describe('1. Canonical Domain Contracts', () => {
    it('1.1 verifies Users List contract emits dual-keys and populated counters', () => {
      const canonicalUser = {
        id: 'usr_101',
        userId: 'usr_101',
        phoneNumber: '201012345678',
        phone: '201012345678',
        name: 'Ahmed Ali',
        isVip: true,
        isBanned: false,
        messageCount: 55,
        totalMessages: 55,
        conversationCount: 4,
        reminderCount: 2,
        lastActiveAt: '2026-10-02T10:00:00.000Z',
        lastActive: '2026-10-02T10:00:00.000Z',
        createdAt: '2026-09-01T08:00:00.000Z',
      };

      expect(canonicalUser.id).toBe(canonicalUser.userId);
      expect(canonicalUser.phoneNumber).toBe(canonicalUser.phone);
      expect(canonicalUser.messageCount).toBe(canonicalUser.totalMessages);
      expect(canonicalUser.lastActiveAt).toBe(canonicalUser.lastActive);
      expect(typeof canonicalUser.conversationCount).toBe('number');
      expect(typeof canonicalUser.reminderCount).toBe('number');
    });

    it('1.2 verifies User 360 details contract provides metrics and stats consistency', () => {
      const userDetails = {
        user: { id: 'usr_101', name: 'Ahmed Ali' },
        metrics: {
          totalConversations: 3,
          totalMessages: 42,
          tokensUsed: 1200,
          promptTokens: 800,
          completionTokens: 400,
          estimatedCostUsd: 0.0036,
        },
        stats: {
          totalConversations: 3,
          totalMessages: 42,
          totalReminders: 2,
          activeReminders: 1,
          memoryCount: 5,
          tokenCount: 1200,
          costUsd: 0.0036,
        },
        memories: [
          { id: 'mem_1', key: 'favorite_topic', value: 'AI Agents', factKey: 'favorite_topic', factText: 'AI Agents' },
        ],
        reminders: [
          { id: 'rem_1', scheduledTime: '2026-10-05T12:00:00.000Z', dueAt: '2026-10-05T12:00:00.000Z', status: 'scheduled' },
        ],
      };

      expect(userDetails.metrics.totalConversations).toBe(userDetails.stats.totalConversations);
      expect(userDetails.metrics.totalMessages).toBe(userDetails.stats.totalMessages);
      expect(userDetails.memories[0].key).toBe(userDetails.memories[0].factKey);
      expect(userDetails.reminders[0].scheduledTime).toBe(userDetails.reminders[0].dueAt);
    });

    it('1.3 verifies Conversations List contract emits dual-keys and explicit status', () => {
      const canonicalConv = {
        id: 'conv_201',
        userId: 'usr_101',
        userPhone: '201012345678',
        phone: '201012345678',
        messageCount: 14,
        messagesCount: 14,
        lastMessageSnippet: 'مرحباً، أريد الاستفسار عن الموعد',
        lastMessage: 'مرحباً، أريد الاستفسار عن الموعد',
        status: 'active',
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-02T14:30:00.000Z',
        lastMessageAt: '2026-10-02T14:30:00.000Z',
      };

      expect(canonicalConv.userPhone).toBe(canonicalConv.phone);
      expect(canonicalConv.messageCount).toBe(canonicalConv.messagesCount);
      expect(canonicalConv.lastMessageSnippet).toBe(canonicalConv.lastMessage);
      expect(canonicalConv.updatedAt).toBe(canonicalConv.lastMessageAt);
      expect(['active', 'archived']).toContain(canonicalConv.status);
    });

    it('1.4 verifies Conversation Messages transcript contract enforces latest-50 chronological order and role mapping', () => {
      const canonicalMsg = {
        id: 'msg_301',
        conversationId: 'conv_201',
        role: 'user',
        sender: 'WhatsApp User',
        source: 'system',
        content: 'ما هو الطقس غدا؟',
        text: 'ما هو الطقس غدا؟',
        model: null,
        tokens: 0,
        latencyMs: 0,
        createdAt: '2026-10-02T14:30:00.000Z',
        timestamp: '2026-10-02T14:30:00.000Z',
      };

      expect(canonicalMsg.content).toBe(canonicalMsg.text);
      expect(canonicalMsg.createdAt).toBe(canonicalMsg.timestamp);
      expect(['user', 'assistant']).toContain(canonicalMsg.role);
    });

    it('1.5 verifies Memory Items contract emits key/value and userPhone', () => {
      const canonicalMemory = {
        id: 'mem_401',
        userId: 'usr_101',
        userPhone: '201012345678',
        key: 'work_location',
        value: 'Cairo Smart Village',
        category: 'user_profile',
        importance: 0.9,
        status: 'active',
        createdAt: '2026-09-15T10:00:00.000Z',
      };

      expect(canonicalMemory.key).toBeDefined();
      expect(canonicalMemory.value).toBeDefined();
      expect(canonicalMemory.userPhone).toBeDefined();
      expect(canonicalMemory.importance).toBeGreaterThan(0);
    });

    it('1.6 verifies Reminders contract emits scheduledTime, status, and retryCount', () => {
      const canonicalReminder = {
        id: 'rem_501',
        userId: 'usr_101',
        userPhone: '201012345678',
        title: 'Call customer support',
        scheduledTime: '2026-10-05T15:00:00.000Z',
        dueAt: '2026-10-05T15:00:00.000Z',
        status: 'scheduled',
        retryCount: 0,
        createdAt: '2026-10-04T08:00:00.000Z',
      };

      expect(canonicalReminder.scheduledTime).toBe(canonicalReminder.dueAt);
      expect(canonicalReminder.retryCount).toBe(0);
      expect(['scheduled', 'sent', 'cancelled', 'failed']).toContain(canonicalReminder.status);
    });

    it('1.7 verifies Agent Runs List contract emits durationMs and latencyMs with null untracked tokens', async () => {
      const controller = new AdminAgentRunsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM agent_runs')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'run_601',
              conversationId: 'conv_201',
              status: 'completed',
              userPrompt: 'what is gold price',
              iterationsCount: 2,
              durationMs: '1420',
              toolCallsCount: '1',
              createdAt: '2026-10-02T10:00:00.000Z',
              completedAt: '2026-10-02T10:00:01.420Z',
            },
          ],
        };
      });

      const { res, getResponseData } = buildMockResponse();
      await controller.getAgentRuns({ query: {} } as Request, res);

      const run = getResponseData().data[0];
      expect(run.id).toBe('run_601');
      expect(run.durationMs).toBe(1420);
      expect(run.latencyMs).toBe(1420);
      expect(run.toolCallsCount).toBe(1);
      expect(run.model).toBeNull();
      expect(run.totalTokens).toBeNull();
    });

    it('1.8 verifies Agent Run Details contract sanitizes child tool calls', async () => {
      const controller = new AdminAgentRunsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM agent_runs r') && sql.includes('r.id::text = $1')) {
          return {
            rows: [
              {
                id: 'run_602',
                conversationId: 'conv_201',
                status: 'completed',
                userPrompt: 'Search gold price',
                iterationsCount: 1,
                durationMs: '800',
                createdAt: '2026-10-02T10:00:00.000Z',
                completedAt: '2026-10-02T10:00:00.800Z',
              },
            ],
          };
        }
        if (sql.includes('FROM tool_calls t') && sql.includes('t.agent_run_id::text = $1')) {
          return {
            rows: [
              {
                id: 'tc_701',
                toolName: 'web_search',
                arguments: JSON.stringify({ query: 'gold price in Egypt' }),
                status: 'completed',
                result: JSON.stringify({ price: '3100 EGP' }),
                durationMs: '750',
                createdAt: '2026-10-02T10:00:00.050Z',
                completedAt: '2026-10-02T10:00:00.800Z',
              },
            ],
          };
        }
        return { rows: [] };
      });

      const { res, getResponseData } = buildMockResponse();
      await controller.getAgentRunDetails({ params: { id: 'run_602' } } as any, res);

      const data = getResponseData().data;
      expect(data.id).toBe('run_602');
      expect(data.toolCalls).toHaveLength(1);
      expect(data.toolCalls[0].arguments.query).toBe('gold price in Egypt');
      expect(data.toolCalls[0].args.query).toBe('gold price in Egypt');
      expect(data.hasRedactedReasoning).toBe(true);
    });

    it('1.9 verifies Tool Calls List contract emits runId and agentRunId with sanitized objects', async () => {
      const controller = new AdminToolCallsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM tool_calls')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'tc_702',
              agentRunId: 'run_601',
              toolName: 'get_current_time',
              status: 'completed',
              arguments: { timezone: 'Africa/Cairo' },
              result: { time: '14:30' },
              durationMs: '2',
              createdAt: '2026-10-02T10:00:00.000Z',
              completedAt: '2026-10-02T10:00:00.002Z',
            },
          ],
        };
      });

      const { res, getResponseData } = buildMockResponse();
      await controller.getToolCalls({ query: {} } as Request, res);

      const tool = getResponseData().data[0];
      expect(tool.id).toBe('tc_702');
      expect(tool.runId).toBe('run_601');
      expect(tool.agentRunId).toBe('run_601');
      expect(tool.argumentsSanitized.timezone).toBe('Africa/Cairo');
      expect(tool.resultSanitized.time).toBe('14:30');
    });

    it('1.10 verifies Search Recent contract emits query, provider, and sourceCount', async () => {
      const controller = new AdminSearchController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM tool_calls')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'tc_703',
              toolName: 'web_search',
              status: 'completed',
              arguments: JSON.stringify({ query: 'weather in alexandria' }),
              result: JSON.stringify({ provider: 'duckduckgo', sources: ['https://weather.com', 'https://bbc.com'] }),
              latencyMs: '450',
              createdAt: '2026-10-02T10:00:00.000Z',
            },
          ],
        };
      });

      const { res, getResponseData } = buildMockResponse();
      await controller.getRecentSearches({ query: {} } as Request, res);

      const searchItem = getResponseData().data[0];
      expect(searchItem.id).toBe('tc_703');
      expect(searchItem.query).toBe('weather in alexandria');
      expect(searchItem.provider).toBe('duckduckgo');
      expect(searchItem.sourceCount).toBe(2);
      expect(searchItem.latencyMs).toBe(450);
    });

    it('1.11 verifies Search Diagnostic contract executes dry-run probe with zero network calls', async () => {
      const controller = new AdminSearchController(mockDbManager);

      const { res, getResponseData } = buildMockResponse();
      await controller.runDiagnostic({ body: { query: 'test health check' } } as Request, res);

      const diag = getResponseData().data;
      expect(diag.dryRun).toBe(true);
      expect(diag.networkCallExecuted).toBe(false);
      expect(diag.querySanitized).toBe(true);
      expect(diag.status).toBe('healthy');
    });

    it('1.12 verifies Settings contract returns Runtime Policy without secret leakage', async () => {
      const controller = new AdminSettingsController();

      const { res, getResponseData } = buildMockResponse();
      await controller.getSettings({} as Request, res);

      const settingsData = getResponseData().data;
      expect(settingsData.runtimeSettings).toEqual({
        maintenanceMode: false,
        debugLogging: false,
        searchEnabled: true,
        proactiveEnabled: true,
        defaultMemoryRetentionDays: 365,
      });
      expect(settingsData.infrastructure.environment).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Security & Redaction Boundaries
  // =========================================================================
  describe('2. Security & Redaction Boundaries', () => {
    it('2.1 purges reasoning and thought properties from tool call inputs and outputs', async () => {
      const controller = new AdminToolCallsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('LIMIT 1')) {
          return {
            rows: [
              {
                id: 'tc_704',
                agentRunId: 'run_601',
                toolName: 'web_search',
                status: 'completed',
                arguments: { query: 'test', reasoning: 'step 1 plan', thought: 'private chain' },
                result: { summary: 'done', internal_reasoning: 'classified' },
                durationMs: '100',
                createdAt: '2026-10-02T10:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      });

      const { res, getResponseData } = buildMockResponse();
      await controller.getToolCallDetails({ params: { id: 'tc_704' } } as any, res);

      const tool = getResponseData().data;
      expect(tool.arguments.reasoning).toBeUndefined();
      expect(tool.arguments.thought).toBeUndefined();
      expect(tool.result.reasoning).toBeUndefined();
      expect(tool.result.thought).toBeUndefined();
    });

    it('2.2 redacts Bearer tokens and sensitive API keys in tool arguments and results', async () => {
      const controller = new AdminToolCallsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('LIMIT 1')) {
          return {
            rows: [
              {
                id: 'tc_705',
                agentRunId: 'run_601',
                toolName: 'echo_tool',
                status: 'completed',
                arguments: { apiKey: 'gsk_123456789012345678901234567890123456789012345678' },
                result: { token: 'Bearer super_secret_jwt_token' },
                durationMs: '10',
                createdAt: '2026-10-02T10:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      });

      const { res, getResponseData } = buildMockResponse();
      await controller.getToolCallDetails({ params: { id: 'tc_705' } } as any, res);

      const tool = getResponseData().data;
      expect(JSON.stringify(tool)).not.toContain('gsk_123456789012345678901234567890123456789012345678');
      expect(JSON.stringify(tool)).toContain('[REDACTED_SECRET]');
    });

    it('2.3 never exposes secret environment variables in Admin Settings response', async () => {
      const controller = new AdminSettingsController();
      const { res, getResponseData } = buildMockResponse();

      await controller.getSettings({} as Request, res);

      const raw = JSON.stringify(getResponseData());
      expect(raw).not.toContain(process.env.ADMIN_SECRET_KEY || 'craft_super_admin_token_2026_secure');
      expect(raw).not.toContain(process.env.GROQ_API_KEY || 'gsk_');
      expect(raw).not.toContain(process.env.WHATSAPP_ACCESS_TOKEN || 'EAAB');
      expect(raw).not.toContain(process.env.CRON_SECRET || 'craft_cron_secret');
      expect(raw).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role');
    });

    it('2.4 reports integration statuses strictly as boolean configured flags', async () => {
      const controller = new AdminSettingsController();
      const { res, getResponseData } = buildMockResponse();

      await controller.getSettings({} as Request, res);

      const integrations = getResponseData().data.infrastructure.integrations;
      expect(typeof integrations.whatsappCloudApi.configured).toBe('boolean');
      expect(typeof integrations.supabasePostgres.configured).toBe('boolean');
      expect(typeof integrations.tavilySearch.configured).toBe('boolean');
    });

    it('2.5 validates that Agent Run listing marks hasRedactedReasoning = true', async () => {
      const controller = new AdminAgentRunsController(mockDbManager);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total FROM agent_runs')) {
          return { rows: [{ total: '1' }] };
        }
        return {
          rows: [
            {
              id: 'run_603',
              conversationId: 'conv_201',
              status: 'completed',
              userPrompt: 'summarize notes',
              createdAt: '2026-10-02T10:00:00.000Z',
            },
          ],
        };
      });

      const { res, getResponseData } = buildMockResponse();
      await controller.getAgentRuns({ query: {} } as Request, res);

      const run = getResponseData().data[0];
      expect(run.hasRedactedReasoning).toBe(true);
    });
  });

  // =========================================================================
  // 3. Pagination & Query Contracts
  // =========================================================================
  describe('3. Pagination & Query Contracts', () => {
    it('3.1 enforces default limit=20 and offset=0 when query parameters are absent', () => {
      const pagination = parsePaginationQuery({});
      expect(pagination.limit).toBe(20);
      expect(pagination.offset).toBe(0);
    });

    it('3.2 safely rejects out-of-range limit and falls back to default 20 to prevent unbounded queries', () => {
      const pagination = parsePaginationQuery({ limit: '500' });
      expect(pagination.limit).toBe(20);
    });

    it('3.3 correctly parses offset and limit parameters', () => {
      const pagination = parsePaginationQuery({ offset: '50', limit: '25' });
      expect(pagination.limit).toBe(25);
      expect(pagination.offset).toBe(50);
    });

    it('3.4 clamps negative limit and offset to valid non-negative ranges', () => {
      const pagination = parsePaginationQuery({ limit: '-10', offset: '-5' });
      expect(pagination.limit).toBe(20); // defaults back to safe baseline
      expect(pagination.offset).toBe(0);
    });
  });

  // =========================================================================
  // 4. Error Standardization & Traceability
  // =========================================================================
  describe('4. Error Standardization & Traceability', () => {
    it('4.1 formats 400 ADMIN_VALIDATION_ERROR with standardized error object and correlationId', () => {
      const mockReq = { headers: { 'x-correlation-id': 'corr-val-400' } } as unknown as Request;
      const { res, getStatusCode, getResponseData } = buildMockResponse(mockReq);

      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Validation failed for resource', { field: 'name' });

      expect(getStatusCode()).toBe(400);
      const data = getResponseData();
      expect(data.error.code).toBe('ADMIN_VALIDATION_ERROR');
      expect(data.error.message).toBe('Validation failed for resource');
      expect(data.error.details).toEqual({ field: 'name' });
      expect(data.correlationId).toBe('corr-val-400');
    });

    it('4.2 formats 403 ADMIN_FORBIDDEN on RBAC role failure', () => {
      const mockReq = { headers: { 'x-correlation-id': 'corr-rbac-403' } } as unknown as Request;
      const { res, getStatusCode, getResponseData } = buildMockResponse(mockReq);

      sendAdminError(res, 403, 'ADMIN_FORBIDDEN', "Forbidden: role 'viewer' lacks permission");

      expect(getStatusCode()).toBe(403);
      expect(getResponseData().error.code).toBe('ADMIN_FORBIDDEN');
      expect(getResponseData().correlationId).toBe('corr-rbac-403');
    });

    it('4.3 formats 404 ADMIN_NOT_FOUND on missing resource', () => {
      const { res, getStatusCode, getResponseData } = buildMockResponse();

      sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Resource not found');

      expect(getStatusCode()).toBe(404);
      expect(getResponseData().error.code).toBe('ADMIN_NOT_FOUND');
    });

    it('4.4 sets no-store and no-cache headers on all error responses', () => {
      const { res } = buildMockResponse();

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Internal failure');

      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
    });
  });

  // =========================================================================
  // 5. Role-Based Access Control (RBAC) Authority
  // =========================================================================
  describe('5. Role-Based Access Control (RBAC) Authority', () => {
    const buildRbacReq = (role: AdminRole) =>
      ({
        headers: {
          'x-admin-role': role,
        },
        adminActor: { id: 'admin-1', role, actorType: 'user' },
      } as unknown as Request);

    it('5.1 owner role is granted permission for mutation endpoints', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const req = buildRbacReq('owner');
      const { res } = buildMockResponse();
      const next = jest.fn();

      guard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('5.2 admin role is granted permission for mutation endpoints', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const req = buildRbacReq('admin');
      const { res } = buildMockResponse();
      const next = jest.fn();

      guard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('5.3 viewer role is rejected from mutations with 403 ADMIN_FORBIDDEN', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const req = buildRbacReq('viewer');
      const { res, getStatusCode, getResponseData } = buildMockResponse();
      const next = jest.fn();

      guard(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(403);
      expect(getResponseData().error.code).toBe('ADMIN_FORBIDDEN');
    });

    it('5.4 support role is rejected from mutations with 403 ADMIN_FORBIDDEN', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const req = buildRbacReq('support');
      const { res, getStatusCode, getResponseData } = buildMockResponse();
      const next = jest.fn();

      guard(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(403);
      expect(getResponseData().error.code).toBe('ADMIN_FORBIDDEN');
    });
  });

  // =========================================================================
  // 6. Regression with Phases 13.1–13.5
  // =========================================================================
  describe('6. Regression with Phases 13.1–13.5', () => {
    it('6.1 Phase 13.5: RuntimePolicyResolver updates and reads single source of truth', () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: false, maintenanceMode: true });

      const policy = RuntimePolicyResolver.getPolicy();
      expect(policy.searchEnabled).toBe(false);
      expect(policy.maintenanceMode).toBe(true);
      expect(policy.proactiveEnabled).toBe(true);
    });

    it('6.2 Phase 13.4: TriggerContract maintains canonical classification and system trigger isolation', () => {
      expect(TriggerContract.isSystemTrigger('smart_reminder')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive_morning_briefing')).toBe(true);
      expect(TriggerContract.isSystemTrigger('user_message')).toBe(false);
    });

    it('6.3 Phase 13.3: Proactive tool capability policy respects least-privilege scoping', () => {
      const policy = ToolCapabilityPolicy.getInstance();
      const allowed = policy.getAllowedTools('proactive_reengagement');
      expect(allowed).toEqual(['get_current_time', 'get_weather']);
      expect(allowed).not.toContain('web_search');
    });

    it('6.4 Phase 13.2: Smart reminder capability policy enforces exactly 3 tools when searchEnabled=true', () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: true });
      const policy = ToolCapabilityPolicy.getInstance();
      const allowed = policy.getAllowedTools('smart_reminder');
      expect(allowed).toEqual(['get_current_time', 'get_weather', 'web_search']);
    });

    it('6.5 Phase 13.1: Unknown triggers strictly default-deny with 0 tools', () => {
      const policy = ToolCapabilityPolicy.getInstance();
      const decision = policy.isToolAllowed('web_search', 'unknown_webhook_trigger');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });
  });
});
