import http from 'http';
import { AddressInfo } from 'net';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { config } from '../src/config/env';
import { validateAdminToken, createAdminAuthMiddleware } from '../src/middleware/admin_auth.middleware';
import { AdminRateLimiter, defaultAdminRateLimiter } from '../src/middleware/admin_rate_limiter';
import { AdminAuditRepository } from '../src/database/repositories/admin_audit.repo';
import { AdminAuditService } from '../src/modules/admin/audit/admin_audit.service';
import {
  parsePaginationQuery,
  encodeCursor,
  decodeCursor,
} from '../src/modules/admin/pagination';
import {
  sendAdminError,
  sendAdminSuccess,
  getCorrelationId,
} from '../src/modules/admin/admin.types';

describe('Phase 10.1: Admin Security & API Foundation', () => {
  const adminSecret = config.admin.secretKey;
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    process.env.GROQ_MOCK_MODE = 'true';
    process.env.ADMIN_SECRET_KEY = adminSecret;
    const app = createApp();
    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    defaultAdminRateLimiter.reset();
    server.close(done);
  });

  beforeEach(() => {
    defaultAdminRateLimiter.reset();
  });

  // =========================================================================
  // 1. Authentication Hardening & Token Validation
  // =========================================================================
  describe('1. Admin Authentication Hardening', () => {
    it('validates correct token with constant-time equality', () => {
      expect(validateAdminToken(adminSecret)).toBe(true);
      expect(validateAdminToken(`  ${adminSecret}  `)).toBe(true);
    });

    it('rejects missing, null, undefined, or empty token', () => {
      expect(validateAdminToken(undefined)).toBe(false);
      expect(validateAdminToken('')).toBe(false);
      expect(validateAdminToken('   ')).toBe(false);
      expect(validateAdminToken(null as any)).toBe(false);
    });

    it('rejects incorrect token of same length', () => {
      const fakeToken = 'x'.repeat(adminSecret.length);
      expect(validateAdminToken(fakeToken)).toBe(false);
    });

    it('rejects incorrect token of different length without throwing', () => {
      expect(validateAdminToken('short')).toBe(false);
      expect(validateAdminToken(adminSecret + '_extra_chars')).toBe(false);
    });

    it('fails closed in production if ADMIN_SECRET_KEY is empty', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalKey = process.env.ADMIN_SECRET_KEY;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ADMIN_SECRET_KEY;

        expect(validateAdminToken(adminSecret)).toBe(false);
        expect(validateAdminToken('any_secret')).toBe(false);
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalKey) process.env.ADMIN_SECRET_KEY = originalKey;
      }
    });

    it('strictly rejects ?token=... query parameter even with valid secret', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview?token=${adminSecret}`);
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe('ADMIN_UNAUTHORIZED');
      expect(json.error.message).toContain('Query token authentication is forbidden');
    });

    it('rejects request without any authorization header', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`);
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe('ADMIN_UNAUTHORIZED');
      expect(json.correlationId).toBeDefined();
    });

    it('rejects invalid Bearer token', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: 'Bearer totally_wrong_secret' },
      });
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('accepts valid Authorization: Bearer <TOKEN>', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${adminSecret}` },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
    });

    it('accepts valid x-admin-token header as alternate header', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { 'x-admin-token': adminSecret },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
    });
  });

  // =========================================================================
  // 2. Standardized Error and Success Response Contracts
  // =========================================================================
  describe('2. Standardized Response Contract & Observability', () => {
    it('formats error contract: { error: { code, message }, correlationId }', () => {
      const mockReq: any = { correlationId: 'corr_test_123', headers: {} };
      const headers: Record<string, string> = {};
      let statusCode = 0;
      let body: any = null;

      const mockRes: any = {
        req: mockReq,
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        status: (code: number) => {
          statusCode = code;
          return {
            json: (payload: any) => {
              body = payload;
            },
          };
        },
      };

      sendAdminError(mockRes, 403, 'ADMIN_FORBIDDEN', 'Access forbidden', { reason: 'insufficient_role' });

      expect(statusCode).toBe(403);
      expect(headers['Cache-Control']).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
      expect(body).toEqual({
        error: {
          code: 'ADMIN_FORBIDDEN',
          message: 'Access forbidden',
          details: { reason: 'insufficient_role' },
        },
        correlationId: 'corr_test_123',
      });
    });

    it('formats success contract: { success: true, data, pagination?, correlationId, timestamp }', () => {
      const mockReq: any = { correlationId: 'corr_test_456', headers: {} };
      const headers: Record<string, string> = {};
      let statusCode = 0;
      let body: any = null;

      const mockRes: any = {
        req: mockReq,
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        status: (code: number) => {
          statusCode = code;
          return {
            json: (payload: any) => {
              body = payload;
            },
          };
        },
      };

      sendAdminSuccess(mockRes, { status: 'healthy' }, { nextCursor: 'cur_abc', total: 50 });

      expect(statusCode).toBe(200);
      expect(headers['Cache-Control']).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ status: 'healthy' });
      expect(body.pagination).toEqual({ nextCursor: 'cur_abc', total: 50 });
      expect(body.correlationId).toBe('corr_test_456');
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
    });

    it('preserves client X-Correlation-ID in response header and body', async () => {
      const testCorrId = 'client_corr_uuid_777';
      const res = await fetch(`${baseUrl}/api/admin/observability/health`, {
        headers: {
          Authorization: `Bearer ${adminSecret}`,
          'X-Correlation-ID': testCorrId,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('x-correlation-id')).toBe(testCorrId);
      const json = (await res.json()) as any;
      expect(json.correlationId).toBe(testCorrId);
    });
  });

  // =========================================================================
  // 3. Admin Rate Limiter & Brute-Force Auth Protection
  // =========================================================================
  describe('3. Admin Rate Limiting & Brute-Force Auth Protection', () => {
    it('sets RateLimit-* headers on allowed requests', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${adminSecret}` },
      });
      expect(res.headers.get('ratelimit-limit')).toBeDefined();
      expect(res.headers.get('ratelimit-remaining')).toBeDefined();
      expect(res.headers.get('ratelimit-reset')).toBeDefined();
    });

    it('masks IP addresses cleanly for privacy in logs', () => {
      const limiter = new AdminRateLimiter();
      expect(limiter.maskIp('192.168.1.50')).toBe('192.168.*.*');
      expect(limiter.maskIp('10.0.0.1')).toBe('10.0.*.*');
      expect(limiter.maskIp('2001:db8::1')).toBe('2001:db8...');
    });

    it('throttles excessive requests exceeding rate limit with 429', () => {
      const strictLimiter = new AdminRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        keyPrefix: 'test_strict',
      });

      const req: any = {
        headers: {},
        socket: { remoteAddress: '10.99.0.1' },
      };
      const resHeaders: Record<string, any> = {};
      let statusCode = 200;
      let body: any = null;

      const res: any = {
        setHeader: (k: string, v: any) => {
          resHeaders[k] = v;
        },
        status: (code: number) => {
          statusCode = code;
          return {
            json: (data: any) => {
              body = data;
            },
          };
        },
      };

      const next = jest.fn();

      // Requests 1, 2, 3 allowed
      strictLimiter.middleware(req, res, next);
      strictLimiter.middleware(req, res, next);
      strictLimiter.middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(3);

      // Request 4 blocked with 429
      strictLimiter.middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(statusCode).toBe(429);
      expect(body.error.code).toBe('ADMIN_RATE_LIMITED');
      expect(resHeaders['Retry-After']).toBeDefined();
    });

    it('blocks client IP after 10 consecutive failed authentication attempts', () => {
      const testIp = '10.88.99.1';
      defaultAdminRateLimiter.reset();

      // Simulate 9 failures
      for (let i = 0; i < 9; i++) {
        const check = defaultAdminRateLimiter.recordAuthFailure(testIp, 10);
        expect(check.isBlocked).toBe(false);
      }

      // 10th failure locks out the IP
      const tenth = defaultAdminRateLimiter.recordAuthFailure(testIp, 10);
      expect(tenth.isBlocked).toBe(true);

      const status = defaultAdminRateLimiter.isAuthBlocked(testIp, 10);
      expect(status.isBlocked).toBe(true);
      expect(status.retryAfterSeconds).toBeGreaterThan(0);

      // Successful auth resets the lock
      defaultAdminRateLimiter.resetAuthFailure(testIp);
      expect(defaultAdminRateLimiter.isAuthBlocked(testIp, 10).isBlocked).toBe(false);
    });
  });

  // =========================================================================
  // 4. Admin Audit Trail & Secret Redaction
  // =========================================================================
  describe('4. Admin Audit Trail & Credential Sanitization', () => {
    let auditRepo: AdminAuditRepository;
    let auditService: AdminAuditService;

    beforeEach(() => {
      auditRepo = new AdminAuditRepository();
      auditRepo.clearInMemoryLogs();
      auditService = new AdminAuditService(auditRepo);
    });

    it('sanitizes forbidden secret keys recursively from metadata', () => {
      const rawMetadata = {
        token: 'super_secret_token_123',
        authorization: 'Bearer secret_jwt_token',
        password: 'admin_password_999',
        secret: 'top_secret',
        api_key: 'sk-1234567890',
        nested: {
          admin_secret_key: 'should_be_hidden',
          safe_field: 'public_value',
        },
        userPhone: '+201001234567',
      };

      const sanitized = auditRepo.sanitizeMetadata(rawMetadata);

      expect(sanitized.token).toBe('[REDACTED_SECRET]');
      expect(sanitized.authorization).toBe('[REDACTED_SECRET]');
      expect(sanitized.password).toBe('[REDACTED_SECRET]');
      expect(sanitized.secret).toBe('[REDACTED_SECRET]');
      expect(sanitized.api_key).toBe('[REDACTED_SECRET]');
      expect(sanitized.nested.admin_secret_key).toBe('[REDACTED_SECRET]');
      expect(sanitized.nested.safe_field).toBe('public_value');
      expect(sanitized.userPhone).toBe('+201001234567');
    });

    it('redacts embedded secrets in string values and error messages', () => {
      const raw = {
        details: 'Failed connecting to database with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token',
      };
      const sanitized = auditRepo.sanitizeMetadata(raw);
      expect(sanitized.details).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('records successful mutation events and lists them', async () => {
      const record = await auditService.recordMutation({
        adminActor: 'security_officer',
        action: 'TOGGLE_USER_VIP',
        resourceType: 'user',
        resourceId: 'usr_abc_123',
        status: 'success',
        metadata: { newVip: true, token: 'leaked_token_attempt' },
        correlationId: 'audit_corr_1',
      });

      expect(record.id).toBeDefined();
      expect(record.adminActor).toBe('security_officer');
      expect(record.action).toBe('TOGGLE_USER_VIP');
      expect(record.status).toBe('success');
      expect(record.metadata?.newVip).toBe(true);
      expect(record.metadata?.token).toBe('[REDACTED_SECRET]');

      const listResult = await auditService.listAuditLogs({ action: 'TOGGLE_USER_VIP' });
      expect(listResult.items.length).toBeGreaterThanOrEqual(1);
      expect(listResult.items[0].resourceId).toBe('usr_abc_123');
    });

    it('records failed mutation events with sanitized error messages', async () => {
      const record = await auditService.recordMutation({
        adminActor: 'admin_test',
        action: 'UPDATE_FAQ',
        resourceType: 'faq',
        resourceId: 'faq_999',
        status: 'failure',
        errorMessage: 'Database connection failed with api_key=sk-test-live-1234567890',
        correlationId: 'audit_corr_fail',
      });

      expect(record.status).toBe('failure');
      expect(record.errorMessage).toBeDefined();
      expect(record.errorMessage).not.toContain('sk-test-live-1234567890');
    });
  });

  // =========================================================================
  // 5. Pagination Utilities & Bounds
  // =========================================================================
  describe('5. Pagination Utilities & Edge Cases', () => {
    it('uses default limit of 20 when limit is omitted', () => {
      const res = parsePaginationQuery({});
      expect(res.limit).toBe(20);
    });

    it('clamps or falls back to default on invalid or out-of-range limits', () => {
      expect(parsePaginationQuery({ limit: '0' }).limit).toBe(20);
      expect(parsePaginationQuery({ limit: '101' }).limit).toBe(20);
      expect(parsePaginationQuery({ limit: 'not_a_number' }).limit).toBe(20);
    });

    it('parses valid limit within [1, 100]', () => {
      expect(parsePaginationQuery({ limit: '1' }).limit).toBe(1);
      expect(parsePaginationQuery({ limit: '50' }).limit).toBe(50);
      expect(parsePaginationQuery({ limit: '100' }).limit).toBe(100);
    });

    it('encodes and decodes base64 pagination cursor accurately', () => {
      const payload = { id: 'item_123', createdAt: '2026-10-01T08:00:00.000Z' };
      const cursor = encodeCursor(payload);
      expect(typeof cursor).toBe('string');

      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(payload);
    });

    it('decodes ISO date string cursor as createdAt fallback', () => {
      const isoDate = '2026-10-01T08:30:00.000Z';
      const decoded = decodeCursor(isoDate);
      expect(decoded).toEqual({ createdAt: isoDate });
    });

    it('returns null gracefully for invalid or unparseable cursor without throwing', () => {
      expect(decodeCursor('not_valid_json_or_date')).toBeNull();
      expect(decodeCursor('')).toBeNull();
    });
  });

  // =========================================================================
  // 6. Modular Admin API Endpoints E2E
  // =========================================================================
  describe('6. Modular Admin API Endpoints via HTTP', () => {
    const authHeaders = {
      Authorization: `Bearer ${adminSecret}`,
      'Content-Type': 'application/json',
    };

    it('GET /api/admin/overview returns aggregated platform metrics', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.overview).toHaveProperty('totalConversations');
      expect(body.data.overview).toHaveProperty('totalMessages');
      expect(body.data.overview).toHaveProperty('totalUsers');
      expect(body.data.overview).toHaveProperty('totalTokens');
      expect(body.data.overview).toHaveProperty('estimatedCostUsd');
    });

    it('GET /api/admin/analytics backward-compatible alias returns overview metrics', async () => {
      const res = await fetch(`${baseUrl}/api/admin/analytics`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.overview).toHaveProperty('totalConversations');
    });

    it('GET /api/admin/observability/health returns live health snapshot', async () => {
      const res = await fetch(`${baseUrl}/api/admin/observability/health`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('status');
      expect(body.data).toHaveProperty('uptimeSeconds');
      expect(body.data).toHaveProperty('snapshot');
    });

    it('GET /api/admin/observability/metrics returns operational metrics snapshot', async () => {
      const res = await fetch(`${baseUrl}/api/admin/observability/metrics`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('counters');
      expect(body.data).toHaveProperty('gauges');
    });

    it('GET /api/admin/users lists top users with pagination contract', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users?limit=5`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
    });

    it('GET /api/admin/conversations lists conversations', async () => {
      const res = await fetch(`${baseUrl}/api/admin/conversations?limit=5`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('GET /api/admin/tools-stats returns tool intelligence execution statistics', async () => {
      const res = await fetch(`${baseUrl}/api/admin/tools-stats`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('totalWebSearches');
      expect(body.data).toHaveProperty('totalRemindersCreated');
      expect(body.data).toHaveProperty('confirmations');
    });

    it('GET /api/admin/faq lists FAQ entries', async () => {
      const res = await fetch(`${baseUrl}/api/admin/faq`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST /api/admin/faq rejects invalid FAQ payload with 400 ADMIN_VALIDATION_ERROR', async () => {
      const res = await fetch(`${baseUrl}/api/admin/faq`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          title: '', // Missing title
          patterns: [], // Empty patterns
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('ADMIN_VALIDATION_ERROR');
      expect(body.error.details.issues).toBeDefined();
    });

    it('POST /api/admin/faq creates valid FAQ item and records audit log', async () => {
      const res = await fetch(`${baseUrl}/api/admin/faq`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'x-admin-actor': 'qa_tester',
        },
        body: JSON.stringify({
          title: 'ما هي ساعات العمل الرسمية؟',
          category: 'support',
          patterns: ['مواعيد العمل', 'ساعات العمل', 'بتفتحوا امتى'],
          response: 'نعمل يومياً من التاسعة صباحاً وحتى العاشرة مساءً.',
          matchType: 'contains',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBeDefined();
      expect(body.data.title).toBe('ما هي ساعات العمل الرسمية؟');

      // Verify audit log recorded for create action
      const auditRes = await fetch(`${baseUrl}/api/admin/audit?action=CREATE_FAQ`, {
        headers: authHeaders,
      });
      const auditBody = (await auditRes.json()) as any;
      expect(auditRes.status).toBe(200);
      expect(auditBody.data.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/admin/audit retrieves audit logs with pagination', async () => {
      const res = await fetch(`${baseUrl}/api/admin/audit?limit=10`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('GET /api/admin/cache/candidates connects to cache candidate review subsystem', async () => {
      const res = await fetch(`${baseUrl}/api/admin/cache/candidates`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.items)).toBe(true);
    });
  });
});
