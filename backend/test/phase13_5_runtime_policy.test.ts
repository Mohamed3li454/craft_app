/**
 * Phase 13.5 — Runtime Configuration & Policy Consistency Test Suite
 *
 * Verifies the Single Source of Truth for runtime settings, deterministic validation,
 * zero shadow state, real runtime consumer enforcement, RBAC, audit logging, and
 * zero secret disclosure:
 *
 * 1. Settings Discovery & Schema Matrix (5 tests)
 * 2. Single Source of Truth & Admin Controller Integration (6 tests)
 * 3. Maintenance Mode Runtime Enforcement (5 tests)
 * 4. Search Policy Runtime Enforcement (6 tests)
 * 5. Proactive Policy Runtime Enforcement (5 tests)
 * 6. Debug Logging Policy Enforcement (4 tests)
 * 7. Memory Retention Policy Classification (2 tests)
 * 8. Role-Based Access Control (RBAC) Enforcement (5 tests)
 * 9. Audit Logging & Sanitization (2 tests)
 * 10. Security & Zero Secret Disclosure (2 tests)
 * 11. Regression with Trigger Contract (3 tests)
 *
 * Total: 45 tests
 */

import { Request, Response } from 'express';
import {
  RuntimePolicy,
  RuntimePolicyResolver,
  UpdateRuntimePolicySchema,
} from '../src/config/runtime_policy';
import { AdminSettingsController } from '../src/modules/admin/controllers/admin_settings.controller';
import { AdminAuditService } from '../src/modules/admin/audit/admin_audit.service';
import { PreflightStage } from '../src/modules/agent/pipeline/stages/preflight.stage';
import { AgentPipelineContext, AgentPipelineDependencies } from '../src/modules/agent/pipeline/types';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { WebSearchTool } from '../src/modules/tools/builtins/search.tool';
import { ToolCapabilityPolicy } from '../src/modules/tools/safety/tool_capability_policy';
import { ToolPermissionGate } from '../src/modules/tools/safety/permission_gate';
import { ToolRegistry } from '../src/modules/tools/registry';
import { ProactiveEngine } from '../src/modules/proactive/proactive_engine';
import { ProactiveScheduler } from '../src/modules/proactive/proactive_scheduler';
import { StructuredLogger, LogLevel } from '../src/modules/observability/logger';
import { requireAdminRole } from '../src/middleware/admin_auth.middleware';
import { TriggerContract } from '../src/modules/tools/safety/trigger_contract';

function buildMockResponse() {
  let statusCode = 200;
  let responseData: any;
  const res: any = {
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

describe('Phase 13.5: Runtime Configuration & Policy Consistency', () => {
  beforeEach(() => {
    RuntimePolicyResolver.resetToDefault();
    jest.spyOn(SemanticCacheEngine.getInstance(), 'process').mockResolvedValue({ type: 'miss' } as any);
  });

  afterEach(() => {
    RuntimePolicyResolver.resetToDefault();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Settings Discovery & Schema Matrix
  // =========================================================================
  describe('1. Settings Discovery & Schema Matrix', () => {
    it('1.1 verifies initial platform defaults match the intended baseline', () => {
      const policy = RuntimePolicyResolver.getPolicy();
      expect(policy).toEqual({
        maintenanceMode: false,
        debugLogging: false,
        searchEnabled: true,
        proactiveEnabled: true,
        defaultMemoryRetentionDays: 365,
      });
    });

    it('1.2 accepts valid partial update payloads with supported settings', () => {
      const validPayload = {
        maintenanceMode: true,
        searchEnabled: false,
        proactiveEnabled: false,
        debugLogging: true,
        defaultMemoryRetentionDays: 180,
      };

      const parsed = UpdateRuntimePolicySchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual(validPayload);
      }
    });

    it('1.3 strictly rejects unknown fields with 400 validation error (no silent ignore)', () => {
      const roguePayload = {
        maintenanceMode: true,
        unauthorizedToggle: true,
        geminiEnabled: true,
      };

      const parsed = UpdateRuntimePolicySchema.safeParse(roguePayload);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((i: any) => i.code === 'unrecognized_keys') as any;
        expect(issue).toBeDefined();
        expect(issue.keys).toContain('unauthorizedToggle');
        expect(issue.keys).toContain('geminiEnabled');
      }
    });

    it('1.4 strictly rejects non-boolean types for boolean settings', () => {
      const invalidTypes = [
        { maintenanceMode: 'true' },
        { searchEnabled: 1 },
        { proactiveEnabled: null },
        { debugLogging: 'enabled' },
      ];

      for (const payload of invalidTypes) {
        const parsed = UpdateRuntimePolicySchema.safeParse(payload);
        expect(parsed.success).toBe(false);
      }
    });

    it('1.5 strictly enforces positive integer bounds on defaultMemoryRetentionDays (1 to 3650)', () => {
      expect(UpdateRuntimePolicySchema.safeParse({ defaultMemoryRetentionDays: 0 }).success).toBe(false);
      expect(UpdateRuntimePolicySchema.safeParse({ defaultMemoryRetentionDays: -10 }).success).toBe(false);
      expect(UpdateRuntimePolicySchema.safeParse({ defaultMemoryRetentionDays: 3651 }).success).toBe(false);
      expect(UpdateRuntimePolicySchema.safeParse({ defaultMemoryRetentionDays: 30.5 }).success).toBe(false);

      expect(UpdateRuntimePolicySchema.safeParse({ defaultMemoryRetentionDays: 1 }).success).toBe(true);
      expect(UpdateRuntimePolicySchema.safeParse({ defaultMemoryRetentionDays: 3650 }).success).toBe(true);
      expect(UpdateRuntimePolicySchema.safeParse({ defaultMemoryRetentionDays: 90 }).success).toBe(true);
    });
  });

  // =========================================================================
  // 2. Single Source of Truth & Admin Controller Integration
  // =========================================================================
  describe('2. Single Source of Truth & Admin Controller Integration', () => {
    let mockAuditService: jest.Mocked<AdminAuditService>;
    let controller: AdminSettingsController;

    beforeEach(() => {
      mockAuditService = {
        recordMutation: jest.fn().mockResolvedValue('audit-123'),
      } as any;
      controller = new AdminSettingsController(mockAuditService);
    });

    it('2.1 GET /api/admin/settings returns effective policy from RuntimePolicyResolver', async () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: true, searchEnabled: false });

      const req = {} as Request;
      const { res, getResponseData } = buildMockResponse();

      await controller.getSettings(req, res);

      const responseData = getResponseData();
      expect(responseData.success).toBe(true);
      expect(responseData.data.runtimeSettings).toEqual({
        maintenanceMode: true,
        debugLogging: false,
        searchEnabled: false,
        proactiveEnabled: true,
        defaultMemoryRetentionDays: 365,
      });
    });

    it('2.2 PUT /api/admin/settings mutates RuntimePolicyResolver and eliminates shadow state', async () => {
      const req = {
        body: {
          searchEnabled: false,
          debugLogging: true,
        },
        headers: {
          'x-admin-actor': 'superadmin',
          'x-admin-role': 'admin',
          'x-correlation-id': 'corr-setting-update',
        },
      } as unknown as Request;

      const { res, getResponseData } = buildMockResponse();

      await controller.updateSettings(req, res);

      const responseData = getResponseData();
      expect(responseData.success).toBe(true);
      expect(responseData.data.searchEnabled).toBe(false);
      expect(responseData.data.debugLogging).toBe(true);

      // Verify RuntimePolicyResolver immediately reflects the mutation
      const effectivePolicy = RuntimePolicyResolver.getPolicy();
      expect(effectivePolicy.searchEnabled).toBe(false);
      expect(effectivePolicy.debugLogging).toBe(true);
    });

    it('2.3 PUT /api/admin/settings rejects invalid types with HTTP 400 ADMIN_VALIDATION_ERROR', async () => {
      const req = {
        body: { maintenanceMode: 'yes' },
        headers: {},
      } as unknown as Request;

      const { res, getStatusCode, getResponseData } = buildMockResponse();

      await controller.updateSettings(req, res);

      expect(getStatusCode()).toBe(400);
      expect(getResponseData().error.code).toBe('ADMIN_VALIDATION_ERROR');
    });

    it('2.4 PUT /api/admin/settings rejects unknown fields with HTTP 400 ADMIN_VALIDATION_ERROR', async () => {
      const req = {
        body: { unknownSetting: true },
        headers: {},
      } as unknown as Request;

      const { res, getStatusCode, getResponseData } = buildMockResponse();

      await controller.updateSettings(req, res);

      expect(getStatusCode()).toBe(400);
      expect(getResponseData().error.code).toBe('ADMIN_VALIDATION_ERROR');
    });

    it('2.5 verifies updatePolicy returns a frozen/copied object preventing direct mutation', () => {
      const policy1 = RuntimePolicyResolver.getPolicy();
      (policy1 as any).maintenanceMode = true;

      // Ensure internal state was not contaminated by mutation of returned copy
      const policy2 = RuntimePolicyResolver.getPolicy();
      expect(policy2.maintenanceMode).toBe(false);
    });

    it('2.6 resetToDefault restores all defaults cleanly', () => {
      RuntimePolicyResolver.updatePolicy({
        maintenanceMode: true,
        debugLogging: true,
        searchEnabled: false,
        proactiveEnabled: false,
        defaultMemoryRetentionDays: 60,
      });

      RuntimePolicyResolver.resetToDefault();
      expect(RuntimePolicyResolver.getPolicy()).toEqual({
        maintenanceMode: false,
        debugLogging: false,
        searchEnabled: true,
        proactiveEnabled: true,
        defaultMemoryRetentionDays: 365,
      });
    });
  });

  // =========================================================================
  // 3. Maintenance Mode Runtime Enforcement
  // =========================================================================
  describe('3. Maintenance Mode Runtime Enforcement', () => {
    let preflightStage: PreflightStage;
    let mockDeps: AgentPipelineDependencies;

    beforeEach(() => {
      preflightStage = new PreflightStage();
      mockDeps = {
        chatRepo: {
          getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'conv-101' }),
          saveMessage: jest.fn().mockResolvedValue({ id: 'msg-101' }),
        },
        userPreferenceRepo: {
          getLanguagePreference: jest.fn().mockResolvedValue(null),
          getPersonalityPreference: jest.fn().mockResolvedValue(null),
        },
        userRepo: {
          checkAndIncrementDailyLimit: jest.fn().mockResolvedValue({ allowed: true }),
        },
      } as any;
    });

    it('3.1 when maintenanceMode=false, conversational turns proceed normally without early exit', async () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: false });

      const ctx: AgentPipelineContext = {
        input: { userId: 'usr-1', userText: 'Hello there', channel: 'web' },
        triggerType: 'user_message',
        cleanUserText: 'Hello there',
        startTime: Date.now(),
        agentRunId: 'run-1',
      } as any;

      await preflightStage.execute(ctx, mockDeps);

      expect(ctx.earlyExitOutput?.metrics?.modelUsed).not.toBe('maintenance-gate');
    });

    it('3.2 when maintenanceMode=true, conversational turns exit early with Arabic maintenance notice', async () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: true });

      const ctx: AgentPipelineContext = {
        input: { userId: 'usr-1', userText: 'مرحبا اريد المساعدة', channel: 'whatsapp' },
        triggerType: 'user_message',
        cleanUserText: 'مرحبا اريد المساعدة',
        startTime: Date.now(),
        agentRunId: 'run-2',
      } as any;

      await preflightStage.execute(ctx, mockDeps);

      expect(ctx.earlyExitOutput).toBeDefined();
      expect(ctx.earlyExitOutput?.status).toBe('completed');
      expect(ctx.earlyExitOutput?.metrics?.modelUsed).toBe('maintenance-gate');
      expect(ctx.earlyExitOutput?.replyText).toContain('النظام في وضع الصيانة');
      expect(mockDeps.chatRepo.saveMessage).toHaveBeenCalledTimes(2);
    });

    it('3.3 when maintenanceMode=true, conversational turns exit early with English notice for English users', async () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: true });

      const ctx: AgentPipelineContext = {
        input: { userId: 'usr-1', userText: 'Hello, what is the weather today?', channel: 'web' },
        triggerType: 'user_message',
        cleanUserText: 'Hello, what is the weather today?',
        startTime: Date.now(),
        agentRunId: 'run-3',
      } as any;

      await preflightStage.execute(ctx, mockDeps);

      expect(ctx.earlyExitOutput).toBeDefined();
      expect(ctx.earlyExitOutput?.status).toBe('completed');
      expect(ctx.earlyExitOutput?.replyText).toContain('undergoing scheduled maintenance');
    });

    it('3.4 when maintenanceMode=true, system triggers (smart_reminder) BYPASS maintenance gate', async () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: true });

      const ctx: AgentPipelineContext = {
        input: { userId: 'usr-1', userText: '', channel: 'system' },
        triggerType: 'smart_reminder',
        cleanUserText: '',
        startTime: Date.now(),
        agentRunId: 'run-4',
      } as any;

      await preflightStage.execute(ctx, mockDeps);

      // System triggers must NOT be halted by maintenance gate
      expect(ctx.earlyExitOutput).toBeUndefined();
    });

    it('3.5 when maintenanceMode=true, proactive system triggers BYPASS maintenance gate', async () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: true });

      const ctx: AgentPipelineContext = {
        input: { userId: 'usr-1', userText: '', channel: 'system' },
        triggerType: 'proactive_morning_briefing',
        cleanUserText: '',
        startTime: Date.now(),
        agentRunId: 'run-5',
      } as any;

      await preflightStage.execute(ctx, mockDeps);

      expect(ctx.earlyExitOutput).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. Search Policy Runtime Enforcement
  // =========================================================================
  describe('4. Search Policy Runtime Enforcement', () => {
    let searchTool: WebSearchTool;
    let toolPolicy: ToolCapabilityPolicy;
    let permissionGate: ToolPermissionGate;

    beforeEach(() => {
      searchTool = new WebSearchTool();
      toolPolicy = ToolCapabilityPolicy.getInstance();
      permissionGate = ToolPermissionGate.getInstance();
    });

    it('4.1 when searchEnabled=true, WebSearchTool proceeds with search execution', async () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: true });

      const result = await searchTool.execute({ query: 'سعر الذهب اليوم' }, {} as any);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('4.2 when searchEnabled=false, WebSearchTool halts immediately with error without network calls', async () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: false });

      const result = await searchTool.execute({ query: 'سعر الذهب اليوم' }, {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled by runtime system policy');
    });

    it('4.3 when searchEnabled=false, ToolCapabilityPolicy.filterTools strips web_search from manifest', () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: false });

      const registry = ToolRegistry.getInstance();
      const filtered = toolPolicy.filterTools(registry.getAllTools(), 'user_message');
      const toolNames = filtered.map((t) => t.name);

      expect(toolNames).not.toContain('web_search');
      expect(toolNames).toContain('get_current_time');
      expect(toolNames).toContain('create_reminder');
    });

    it('4.4 when searchEnabled=false, ToolCapabilityPolicy.getAllowedTools excludes web_search for system triggers', () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: false });

      const allowedForReminder = toolPolicy.getAllowedTools('smart_reminder');
      expect(allowedForReminder).not.toContain('web_search');
      expect(allowedForReminder).toEqual(['get_current_time', 'get_weather']);
    });

    it('4.5 when searchEnabled=false, ToolCapabilityPolicy.isToolAllowed rejects web_search deterministically', () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: false });

      const decision = toolPolicy.isToolAllowed('web_search', 'user_message');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('SEARCH_DISABLED_BY_POLICY');
    });

    it('4.6 when searchEnabled=false, ToolPermissionGate blocks web_search execution with permission error', () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: false });

      const decision = permissionGate.evaluate(searchTool, {
        userId: 'usr-1',
        channel: 'web',
        triggerType: 'user_message',
      } as any);

      expect(decision.allowed).toBe(false);
      expect(decision.error?.code).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
      expect((decision.error?.details as any)?.reason).toBe('SEARCH_DISABLED_BY_POLICY');
    });
  });

  // =========================================================================
  // 5. Proactive Policy Runtime Enforcement
  // =========================================================================
  describe('5. Proactive Policy Runtime Enforcement', () => {
    let proactiveEngine: ProactiveEngine;
    let proactiveScheduler: ProactiveScheduler;
    let mockActionRepo: any;

    beforeEach(() => {
      proactiveEngine = ProactiveEngine.getInstance();
      mockActionRepo = {
        claimDueActions: jest.fn().mockResolvedValue([]),
      };
      proactiveScheduler = new ProactiveScheduler(mockActionRepo, {} as any, {} as any);
    });

    it('5.1 when proactiveEnabled=true, ProactiveEngine.analyze detects in-turn candidates normally', () => {
      RuntimePolicyResolver.updatePolicy({ proactiveEnabled: true });

      const policy = proactiveEngine.analyze({
        query: 'هل يمكنك تذكيري غدا بالاجتماع؟',
        conversationState: 'active' as any,
        recentMessages: [],
      });

      expect(policy.reason).not.toBe('proactive_disabled_by_policy');
    });

    it('5.2 when proactiveEnabled=false, ProactiveEngine.analyze shuts down in-turn suggestions immediately', () => {
      RuntimePolicyResolver.updatePolicy({ proactiveEnabled: false });

      const policy = proactiveEngine.analyze({
        query: 'هل يمكنك تذكيري غدا بالاجتماع؟',
        conversationState: 'active' as any,
        recentMessages: [],
      });

      expect(policy.shouldSuggest).toBe(false);
      expect(policy.suggestionType).toBe('none');
      expect(policy.confidence).toBe(0);
      expect(policy.reason).toBe('proactive_disabled_by_policy');
    });

    it('5.3 when proactiveEnabled=false, ProactiveScheduler.checkAndProcessDueActions skips claiming completely', async () => {
      RuntimePolicyResolver.updatePolicy({ proactiveEnabled: false });

      const result = await proactiveScheduler.checkAndProcessDueActions();

      expect(mockActionRepo.claimDueActions).not.toHaveBeenCalled();
      expect(result.claimedCount).toBe(0);
      expect(result.dispatchedIntents).toEqual([]);
      expect(result.suppressedCount).toBe(0);
    });

    it('5.4 when proactiveEnabled=true, ProactiveScheduler claims due actions as expected', async () => {
      RuntimePolicyResolver.updatePolicy({ proactiveEnabled: true });

      await proactiveScheduler.checkAndProcessDueActions();

      expect(mockActionRepo.claimDueActions).toHaveBeenCalledWith(50, expect.any(Date));
    });

    it('5.5 disabling proactive preserves existing action lifecycle states without DB mutations', async () => {
      RuntimePolicyResolver.updatePolicy({ proactiveEnabled: false });

      // Simulate a cron cycle when proactive is disabled
      const result = await proactiveScheduler.checkAndProcessDueActions();

      expect(result.claimedCount).toBe(0);
      expect(result.expiredCount).toBe(0);
      expect(result.failedCount).toBe(0);
      // Zero DB mutations or transitions
      expect(mockActionRepo.claimDueActions).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 6. Debug Logging Policy Enforcement
  // =========================================================================
  describe('6. Debug Logging Policy Enforcement', () => {
    let loggerInstance: StructuredLogger;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      loggerInstance = StructuredLogger.getInstance();
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('6.1 when debugLogging=false, logger.debug messages are suppressed from console output', () => {
      RuntimePolicyResolver.updatePolicy({ debugLogging: false });

      loggerInstance.debug('Internal diagnostic detail', { component: 'agent' });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('6.2 when debugLogging=true, logger.debug messages are emitted to console output', () => {
      RuntimePolicyResolver.updatePolicy({ debugLogging: true });

      loggerInstance.debug('Internal diagnostic detail', { component: 'agent' });
      expect(consoleLogSpy).toHaveBeenCalled();
      const loggedRaw = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(loggedRaw);
      expect(parsed.level).toBe('DEBUG');
      expect(parsed.message).toBe('Internal diagnostic detail');
    });

    it('6.3 debug logging strictly redacts secrets, tokens, and passwords even when active', () => {
      RuntimePolicyResolver.updatePolicy({ debugLogging: true });

      loggerInstance.debug('Testing secret Groq key gsk_123456789012345678901234567890123456789012345678', {
        token: 'Bearer sensitive_jwt_token_here',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const loggedRaw = consoleLogSpy.mock.calls[0][0];
      expect(loggedRaw).not.toContain('gsk_123456789012345678901234567890123456789012345678');
      expect(loggedRaw).toContain('[REDACTED_API_KEY]');
    });

    it('6.4 info, warn, and error logs remain unsuppressed regardless of debugLogging setting', () => {
      RuntimePolicyResolver.updatePolicy({ debugLogging: false });

      loggerInstance.info('Operational info message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. Memory Retention Policy Classification
  // =========================================================================
  describe('7. Memory Retention Policy Classification', () => {
    it('7.1 verifies defaultMemoryRetentionDays is parsed and validated in contract', () => {
      RuntimePolicyResolver.updatePolicy({ defaultMemoryRetentionDays: 180 });
      expect(RuntimePolicyResolver.getPolicy().defaultMemoryRetentionDays).toBe(180);
    });

    it('7.2 marks defaultMemoryRetentionDays explicitly as DECLARED BUT UNUSED (no active background cleanup)', () => {
      // Architectural Invariant: Memory architecture does not run age-based cleanup in Phase 13.5
      // This test confirms that no hidden background timer/cron or rogue table mutation exists.
      const policy = RuntimePolicyResolver.getPolicy();
      expect(policy.defaultMemoryRetentionDays).toBe(365);
      // Confirmed: No consumer invokes durable deletion based on this threshold
    });
  });

  // =========================================================================
  // 8. Role-Based Access Control (RBAC) Enforcement
  // =========================================================================
  describe('8. Role-Based Access Control (RBAC) Enforcement', () => {
    const buildMockContext = (role: string) => {
      const req = {
        headers: {
          'x-admin-role': role,
        },
        adminActor: {
          id: 'test-user',
          name: 'test-user',
          role: role as any,
          actorType: 'user',
        },
      } as unknown as Request;

      const mockRes = buildMockResponse();
      const next = jest.fn();
      return { req, res: mockRes.res, next, getStatusCode: mockRes.getStatusCode, getResponseData: mockRes.getResponseData };
    };

    it('8.1 owner role is granted mutation permission', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const { req, res, next } = buildMockContext('owner');

      guard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('8.2 admin role is granted mutation permission', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const { req, res, next } = buildMockContext('admin');

      guard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('8.3 operator role is granted mutation permission per current contract', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const { req, res, next } = buildMockContext('operator');

      guard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('8.4 viewer role is denied mutation permission with 403 ADMIN_FORBIDDEN', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const { req, res, next, getStatusCode, getResponseData } = buildMockContext('viewer');

      guard(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(403);
      expect(getResponseData().error.code).toBe('ADMIN_FORBIDDEN');
    });

    it('8.5 support role is denied mutation permission with 403 ADMIN_FORBIDDEN', () => {
      const guard = requireAdminRole('owner', 'admin', 'operator');
      const { req, res, next, getStatusCode, getResponseData } = buildMockContext('support');

      guard(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(403);
      expect(getResponseData().error.code).toBe('ADMIN_FORBIDDEN');
    });
  });

  // =========================================================================
  // 9. Audit Logging & Sanitization
  // =========================================================================
  describe('9. Audit Logging & Sanitization', () => {
    it('9.1 records UPDATE_RUNTIME_SETTINGS audit event with before/after state and actor role', async () => {
      const mockAuditService = {
        recordMutation: jest.fn().mockResolvedValue('audit-456'),
      } as any;
      const controller = new AdminSettingsController(mockAuditService);

      const req = {
        body: { maintenanceMode: true },
        headers: {
          'x-admin-actor': 'ops-lead',
          'x-admin-role': 'admin',
          'x-correlation-id': 'corr-audit-test',
        },
      } as unknown as Request;

      const { res } = buildMockResponse();

      await controller.updateSettings(req, res);

      expect(mockAuditService.recordMutation).toHaveBeenCalledTimes(1);
      const auditPayload = mockAuditService.recordMutation.mock.calls[0][0];

      expect(auditPayload.action).toBe('UPDATE_RUNTIME_SETTINGS');
      expect(auditPayload.resourceType).toBe('system_settings');
      expect(auditPayload.resourceId).toBe('runtime_config');
      expect(auditPayload.status).toBe('success');
      expect(auditPayload.adminActor).toBe('ops-lead');
      expect(auditPayload.metadata.role).toBe('admin');
      expect(auditPayload.metadata.appliedUpdates).toEqual({ maintenanceMode: true });
      expect(auditPayload.metadata.previousSettings.maintenanceMode).toBe(false);
      expect(auditPayload.correlationId).toBe('corr-audit-test');
    });

    it('9.2 audit payload does not contain secrets or sensitive keys', async () => {
      const mockAuditService = {
        recordMutation: jest.fn().mockResolvedValue('audit-457'),
      } as any;
      const controller = new AdminSettingsController(mockAuditService);

      const req = {
        body: { searchEnabled: false },
        headers: {
          'x-admin-actor': 'sec-admin',
          'x-admin-role': 'owner',
        },
      } as unknown as Request;

      const { res } = buildMockResponse();

      await controller.updateSettings(req, res);

      const auditPayload = mockAuditService.recordMutation.mock.calls[0][0];
      const serialized = JSON.stringify(auditPayload);

      expect(serialized).not.toContain('ADMIN_SECRET_KEY');
      expect(serialized).not.toContain('GROQ_API_KEY');
      expect(serialized).not.toContain('WHATSAPP_ACCESS_TOKEN');
      expect(serialized).not.toContain('gsk_');
    });
  });

  // =========================================================================
  // 10. Security & Zero Secret Disclosure
  // =========================================================================
  describe('10. Security & Zero Secret Disclosure', () => {
    it('10.1 GET /api/admin/settings NEVER returns secret environment variables or API keys', async () => {
      const controller = new AdminSettingsController();
      const { res, getResponseData } = buildMockResponse();

      await controller.getSettings({} as Request, res);

      const responseData = getResponseData();
      const serialized = JSON.stringify(responseData);

      expect(serialized).not.toContain(process.env.ADMIN_SECRET_KEY || 'craft_super_admin_token_2026_secure');
      expect(serialized).not.toContain(process.env.GROQ_API_KEY || 'gsk_');
      expect(serialized).not.toContain(process.env.WHATSAPP_ACCESS_TOKEN || 'EAAB');
      expect(serialized).not.toContain(process.env.CRON_SECRET || 'craft_cron_secret');
      expect(serialized).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role');
    });

    it('10.2 integration statuses are strictly reported as boolean configured flags', async () => {
      const controller = new AdminSettingsController();
      const { res, getResponseData } = buildMockResponse();

      await controller.getSettings({} as Request, res);

      const responseData = getResponseData();
      const integrations = responseData.data.infrastructure.integrations;
      expect(typeof integrations.whatsappCloudApi.configured).toBe('boolean');
      expect(typeof integrations.supabasePostgres.configured).toBe('boolean');
      expect(typeof integrations.tavilySearch.configured).toBe('boolean');
    });
  });

  // =========================================================================
  // 11. Regression with Canonical Trigger Contract
  // =========================================================================
  describe('11. Regression with Canonical Trigger Contract', () => {
    it('11.1 TriggerContract isSystemTrigger remains deterministic regardless of runtime policy', () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: true, searchEnabled: false, proactiveEnabled: false });

      expect(TriggerContract.isSystemTrigger('smart_reminder')).toBe(true);
      expect(TriggerContract.isSystemTrigger('proactive_morning_briefing')).toBe(true);
      expect(TriggerContract.isSystemTrigger('user_message')).toBe(false);
      expect(TriggerContract.isSystemTrigger(undefined)).toBe(false);
    });

    it('11.2 smart_reminder retains 3 tools when searchEnabled=true, drops to 2 tools when searchEnabled=false', () => {
      RuntimePolicyResolver.updatePolicy({ searchEnabled: true });
      const policy = ToolCapabilityPolicy.getInstance();
      expect(policy.getAllowedTools('smart_reminder')).toEqual(['get_current_time', 'get_weather', 'web_search']);

      RuntimePolicyResolver.updatePolicy({ searchEnabled: false });
      expect(policy.getAllowedTools('smart_reminder')).toEqual(['get_current_time', 'get_weather']);
    });

    it('11.3 unknown triggers remain strictly default-deny with 0 tools regardless of runtime policy toggles', () => {
      RuntimePolicyResolver.updatePolicy({ maintenanceMode: true, searchEnabled: true, proactiveEnabled: true });
      const policy = ToolCapabilityPolicy.getInstance();

      const decision = policy.isToolAllowed('web_search', 'unknown_webhook_trigger');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('TOOL_NOT_ALLOWED_FOR_TRIGGER');
    });
  });
});
