/**
 * @jest-environment node
 */

import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  encodeSession,
  decodeSession,
  toSafeClientUser,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth/session';
import { GET as getSessionHandler } from '@/app/api/auth/session/route';
import { POST as logoutHandler } from '@/app/api/auth/logout/route';
import { GET as proxyGetHandler, POST as proxyPostHandler } from '@/app/api/admin-proxy/[...path]/route';
import { middleware } from '@/middleware';
import { SessionData, AdminRole } from '@/types/admin';

// Helper to create mock NextRequest
function createMockRequest(options: {
  url?: string;
  method?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  body?: any;
}): NextRequest {
  const url = options.url || 'http://localhost:3001/api/admin-proxy/overview';
  const reqInit: RequestInit = {
    method: options.method || 'GET',
    headers: options.headers || {},
  };
  if (options.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(reqInit.method || '')) {
    reqInit.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const req = new NextRequest(url, reqInit as any);
  if (options.cookies) {
    for (const [name, val] of Object.entries(options.cookies)) {
      req.cookies.set(name, val);
    }
  }
  return req;
}

describe('Phase 10.4 — Integration, Polish & Security Tests', () => {
  const originalEnv = process.env;
  const TEST_SECRET = 'craft-super-admin-secret-test-key-2026';
  const MOCK_BACKEND_URL = 'http://127.0.0.1:3000';

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      ADMIN_SECRET_KEY: TEST_SECRET,
      BACKEND_URL: MOCK_BACKEND_URL,
      NODE_ENV: 'test',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Full Authentication Lifecycle Integration
  // =========================================================================
  describe('1. Full Authentication Lifecycle Integration', () => {
    it('creates HMAC-signed session, verifies session, reads safe user, and logs out', async () => {
      const sessionData: SessionData = {
        token: TEST_SECRET,
        role: 'admin',
        actorName: 'admin',
        expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
      };

      // A. Encode session cookie
      const cookieValue = encodeSession(sessionData);
      expect(cookieValue).toContain('.');
      const [payloadB64, hmacSig] = cookieValue.split('.');
      expect(payloadB64).toBeDefined();
      expect(hmacSig).toBeDefined();

      // B. Query GET /api/auth/session with valid cookie
      const sessionReq = createMockRequest({
        url: 'http://localhost:3001/api/auth/session',
        cookies: { [SESSION_COOKIE_NAME]: cookieValue },
      });
      const sessionRes = await getSessionHandler(sessionReq);
      expect(sessionRes.status).toBe(200);
      const sessionJson = await sessionRes.json();

      expect(sessionJson.authenticated).toBe(true);
      expect(sessionJson.user).toEqual({
        role: 'admin',
        actorName: 'admin',
      });
      // Invariant: Secret token is never exposed to client
      expect(sessionJson.user.token).toBeUndefined();
      expect(JSON.stringify(sessionJson)).not.toContain(TEST_SECRET);

      // C. Call POST /api/auth/logout to clear cookie
      const logoutRes = await logoutHandler();
      expect(logoutRes.status).toBe(200);
      const logoutJson = await logoutRes.json();
      expect(logoutJson.success).toBe(true);
      const setCookie = logoutRes.headers.get('set-cookie');
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain('Max-Age=0');
    });

    it('rejects expired session cookies with unauthenticated status', async () => {
      const expiredSession: SessionData = {
        token: TEST_SECRET,
        role: 'admin',
        actorName: 'admin',
        expiresAt: Date.now() - 5000, // Expired 5 seconds ago
      };

      const cookieValue = encodeSession(expiredSession);
      const decoded = decodeSession(cookieValue);
      expect(decoded).toBeNull();

      const sessionReq = createMockRequest({
        url: 'http://localhost:3001/api/auth/session',
        cookies: { [SESSION_COOKIE_NAME]: cookieValue },
      });
      const sessionRes = await getSessionHandler(sessionReq);
      const sessionJson = await sessionRes.json();
      expect(sessionJson.authenticated).toBe(false);
      expect(sessionJson.user).toBeNull();
    });

    it('rejects tampered session payload attempting privilege escalation', async () => {
      // Attacker creates a session as 'viewer'
      const originalSession: SessionData = {
        token: TEST_SECRET,
        role: 'viewer',
        actorName: 'viewer-user',
        expiresAt: Date.now() + 3600000,
      };
      const validCookie = encodeSession(originalSession);
      const [, originalSig] = validCookie.split('.');

      // Attacker tampers payload to elevate role to 'owner' while keeping original signature
      const elevatedPayload: SessionData = {
        token: TEST_SECRET,
        role: 'owner',
        actorName: 'viewer-user',
        expiresAt: originalSession.expiresAt,
      };
      const forgedPayloadB64 = Buffer.from(JSON.stringify(elevatedPayload)).toString('base64url');
      const forgedCookie = `${forgedPayloadB64}.${originalSig}`;

      // Verification must fail cryptographically
      const decoded = decodeSession(forgedCookie);
      expect(decoded).toBeNull();

      const proxyReq = createMockRequest({
        cookies: { [SESSION_COOKIE_NAME]: forgedCookie },
      });
      const proxyRes = await proxyGetHandler(proxyReq, { params: { path: ['overview'] } });
      expect(proxyRes.status).toBe(401);
      const proxyJson = await proxyRes.json();
      expect(proxyJson.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects malformed cookies (no signature, invalid base64, missing fields)', () => {
      expect(decodeSession('')).toBeNull();
      expect(decodeSession('invalid-single-string')).toBeNull();
      expect(decodeSession('part1.part2.part3')).toBeNull();
      expect(decodeSession('not-base64.fake-sig')).toBeNull();
      const emptyJsonB64 = Buffer.from('{}').toString('base64url');
      expect(decodeSession(`${emptyJsonB64}.fake-sig`)).toBeNull();
    });
  });

  // =========================================================================
  // 2. BFF Security Hardening & Proxy Error Handling
  // =========================================================================
  describe('2. BFF Security Hardening & Proxy Error Handling', () => {
    it('rejects unauthenticated requests to /api/admin-proxy/* with 401', async () => {
      const unauthReq = createMockRequest({
        url: 'http://localhost:3001/api/admin-proxy/users',
        cookies: {}, // No session cookie
      });

      const res = await proxyGetHandler(unauthReq, { params: { path: ['users'] } });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.correlationId).toBeDefined();
    });

    it('injects server-verified Authorization, Role, Actor, and Correlation headers to backend', async () => {
      const validSession: SessionData = {
        token: TEST_SECRET,
        role: 'operator',
        actorName: 'operator-alice',
        expiresAt: Date.now() + 3600000,
      };
      const cookieValue = encodeSession(validSession);

      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      // Mock global fetch to inspect headers sent to backend
      global.fetch = jest.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedHeaders = init.headers;
        return new Response(JSON.stringify({ success: true, data: { status: 'healthy' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': 'backend-corr-12345',
          },
        });
      });

      const req = createMockRequest({
        url: 'http://localhost:3001/api/admin-proxy/observability/health?verbose=true',
        headers: { 'x-correlation-id': 'client-corr-9999' },
        cookies: { [SESSION_COOKIE_NAME]: cookieValue },
      });

      const res = await proxyGetHandler(req, { params: { path: ['observability', 'health'] } });
      expect(res.status).toBe(200);

      // Verify URL forwarding
      expect(capturedUrl).toBe(`${MOCK_BACKEND_URL}/api/admin/observability/health?verbose=true`);

      // Verify injected headers
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${TEST_SECRET}`);
      expect(capturedHeaders['X-Admin-Role']).toBe('operator');
      expect(capturedHeaders['X-Admin-Actor']).toBe('operator-alice');
      expect(capturedHeaders['X-Correlation-Id']).toBe('client-corr-9999');

      // Verify correlation ID propagated in client response
      expect(res.headers.get('x-correlation-id')).toBe('backend-corr-12345');
    });

    it('preserves backend 403 Forbidden without swallowing into 500', async () => {
      const validSession: SessionData = {
        token: TEST_SECRET,
        role: 'viewer',
        actorName: 'viewer-bob',
        expiresAt: Date.now() + 3600000,
      };
      const cookieValue = encodeSession(validSession);

      const backendForbiddenPayload = {
        error: {
          code: 'ADMIN_FORBIDDEN',
          message: "Forbidden: role 'viewer' lacks permission for this operation. Required: owner, admin, operator",
        },
        correlationId: 'corr-forbidden-403',
      };

      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify(backendForbiddenPayload), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': 'corr-forbidden-403',
          },
        })
      );

      const req = createMockRequest({
        url: 'http://localhost:3001/api/admin-proxy/users/usr_123/toggle-vip',
        method: 'POST',
        body: {},
        cookies: { [SESSION_COOKIE_NAME]: cookieValue },
      });

      const res = await proxyPostHandler(req, { params: { path: ['users', 'usr_123', 'toggle-vip'] } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ADMIN_FORBIDDEN');
      expect(json.correlationId).toBe('corr-forbidden-403');
    });

    it('preserves backend 429 Too Many Requests rate-limiting response', async () => {
      const validSession: SessionData = {
        token: TEST_SECRET,
        role: 'admin',
        actorName: 'admin',
        expiresAt: Date.now() + 3600000,
      };
      const cookieValue = encodeSession(validSession);

      const backendRateLimitPayload = {
        error: {
          code: 'ADMIN_AUTH_THROTTLED',
          message: 'Too many failed authentication attempts. Please try again later.',
          retryAfterSeconds: 300,
        },
        correlationId: 'corr-throttled-429',
      };

      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify(backendRateLimitPayload), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '300',
            'x-correlation-id': 'corr-throttled-429',
          },
        })
      );

      const req = createMockRequest({
        url: 'http://localhost:3001/api/admin-proxy/overview',
        cookies: { [SESSION_COOKIE_NAME]: cookieValue },
      });

      const res = await proxyGetHandler(req, { params: { path: ['overview'] } });
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error.code).toBe('ADMIN_AUTH_THROTTLED');
    });

    it('returns 502 with PROXY_ERROR when backend control plane is unreachable', async () => {
      const validSession: SessionData = {
        token: TEST_SECRET,
        role: 'admin',
        actorName: 'admin',
        expiresAt: Date.now() + 3600000,
      };
      const cookieValue = encodeSession(validSession);

      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED connect 127.0.0.1:3000'));

      const req = createMockRequest({
        url: 'http://localhost:3001/api/admin-proxy/overview',
        cookies: { [SESSION_COOKIE_NAME]: cookieValue },
      });

      const res = await proxyGetHandler(req, { params: { path: ['overview'] } });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error.code).toBe('PROXY_ERROR');
      expect(json.error.message).toContain('ECONNREFUSED');
    });
  });

  // =========================================================================
  // 3. Zero Secret Disclosure & Invariants Verification
  // =========================================================================
  describe('3. Zero Secret Disclosure & Security Invariants', () => {
    it('ensures toSafeClientUser strips all sensitive session attributes', () => {
      const fullSession: SessionData = {
        token: 'super-sensitive-secret-token-key-do-not-leak',
        role: 'admin',
        actorName: 'master-admin',
        expiresAt: Date.now() + 3600000,
      };

      const safeUser = toSafeClientUser(fullSession);
      expect(safeUser).toEqual({
        role: 'admin',
        actorName: 'master-admin',
      });
      expect((safeUser as any).token).toBeUndefined();
      expect((safeUser as any).expiresAt).toBeUndefined();
      expect(JSON.stringify(safeUser)).not.toContain('super-sensitive-secret-token-key-do-not-leak');
    });

    it('verifies that proxy responses set cache-control: no-store', async () => {
      const validSession: SessionData = {
        token: TEST_SECRET,
        role: 'admin',
        actorName: 'admin',
        expiresAt: Date.now() + 3600000,
      };
      const cookieValue = encodeSession(validSession);

      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { users: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const req = createMockRequest({
        url: 'http://localhost:3001/api/admin-proxy/users',
        cookies: { [SESSION_COOKIE_NAME]: cookieValue },
      });

      const res = await proxyGetHandler(req, { params: { path: ['users'] } });
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('no-cache');
    });
  });

  // =========================================================================
  // 4. Production Route Security & Redirection Audit
  // =========================================================================
  describe('4. Production Route Security & Redirection Audit', () => {
    it('redirects unauthenticated GET /overview to /login', () => {
      const req = createMockRequest({
        url: 'http://localhost:3001/overview',
      });
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3001/login');
    });

    it('redirects unauthenticated GET /users to /login?from=/users', () => {
      const req = createMockRequest({
        url: 'http://localhost:3001/users',
      });
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3001/login?from=%2Fusers');
    });

    it('returns 401 JSON for unauthenticated GET /api/admin-proxy/users', async () => {
      const req = createMockRequest({
        url: 'http://localhost:3001/api/admin-proxy/users',
      });
      const res = middleware(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toContain('Admin session required');
    });

    it('returns unauthenticated user for GET /api/auth/session without session cookie', async () => {
      const req = createMockRequest({
        url: 'http://localhost:3001/api/auth/session',
      });
      const res = await getSessionHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.authenticated).toBe(false);
      expect(json.user).toBeNull();
    });

    it('redirects authenticated user attempting to visit /login back to /overview', () => {
      const validCookie = encodeSession({
        token: TEST_SECRET,
        role: 'admin',
        actorName: 'admin',
        expiresAt: Date.now() + 3600000,
      });

      const req = createMockRequest({
        url: 'http://localhost:3001/login',
        cookies: { [SESSION_COOKIE_NAME]: validCookie },
      });
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3001/overview');
    });
  });
});
