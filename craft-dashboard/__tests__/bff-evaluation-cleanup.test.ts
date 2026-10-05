/**
 * @jest-environment node
 */

import { encodeSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { GET as proxyGetHandler, POST as proxyPostHandler } from '@/app/api/admin-proxy/[...path]/route';
import { NextRequest } from 'next/server';

function createAuthedRequest(path: string, options: { method?: string; body?: any; role?: string } = {}): NextRequest {
  const sessionCookie = encodeSession({
    token: 'test-admin-secret-key-phase12-6',
    role: (options.role as any) || 'admin',
    actorName: 'test-actor',
    expiresAt: Date.now() + 3600000,
  });

  const url = `http://localhost:3001/api/admin-proxy/${path}`;
  const req = new NextRequest(url, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': `corr-eval-cleanup-${Date.now()}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  req.cookies.set(SESSION_COOKIE_NAME, sessionCookie);
  return req;
}

describe('Phase 12.6 Cleanup Gate: BFF Evaluation Synthetic Fallback Removal', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('1. Backend evaluation success -> passes through real backend response', async () => {
    const realBackendPayload = {
      success: true,
      data: {
        runs: [
          {
            id: 'real-run-123',
            datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
            totalCases: 56,
            passedCases: 54,
            failedCases: 2,
            overallScore: 96.4,
            passRate: 96.4,
            status: 'completed',
            mode: 'mock',
          },
        ],
      },
      correlationId: 'corr-real-123',
    };

    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(realBackendPayload), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-real-123',
        },
      })
    );

    const req = createAuthedRequest('evaluation/runs');
    const res = await proxyGetHandler(req, { params: { path: ['evaluation', 'runs'] } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.runs[0].id).toBe('real-run-123');
    expect(json.data.runs[0].overallScore).toBe(96.4);
    expect(json.data.runs[0].passedCases).toBe(54);
    expect(json.data.runs[0].failedCases).toBe(2);
  });

  it('2. Backend evaluation 404 -> passes through real error, NO synthetic fallback', async () => {
    const realErrorPayload = {
      error: {
        code: 'EVAL_RUN_NOT_FOUND',
        message: 'Evaluation run [run_not_exist] does not exist',
      },
      correlationId: 'corr-err-404',
    };

    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(realErrorPayload), {
        status: 404,
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-err-404',
        },
      })
    );

    const req = createAuthedRequest('evaluation/overview');
    const res = await proxyGetHandler(req, { params: { path: ['evaluation', 'overview'] } });

    // Must be real 404, NOT converted into 200 with getGoldenDatasetOverview()
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('EVAL_RUN_NOT_FOUND');
    expect(json.data).toBeUndefined();
  });

  it('3. Backend evaluation 500 -> passes through real error, NO synthetic fallback', async () => {
    const real500Payload = {
      error: {
        code: 'ADMIN_INTERNAL_ERROR',
        message: 'Database query execution failed in evaluation repository',
      },
      correlationId: 'corr-err-500',
    };

    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(real500Payload), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-err-500',
        },
      })
    );

    const req = createAuthedRequest('evaluation/quality');
    const res = await proxyGetHandler(req, { params: { path: ['evaluation', 'quality'] } });

    // Must be real 500, NOT converted into 200 with fake quality dimensions
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe('ADMIN_INTERNAL_ERROR');
    expect(json.data).toBeUndefined();
  });

  it('4. No synthetic evaluation results on POST /evaluation/runs when backend fails', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Connection pool exhausted',
          },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('evaluation/runs', { method: 'POST', body: { mode: 'mock' } });
    const res = await proxyPostHandler(req, { params: { path: ['evaluation', 'runs'] } });

    // Must be real 503, NOT intercepted to return synthetic 201 with mockRun
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(json.data).toBeUndefined();
  });

  it('5. No fake 100% score on quality-gate or snapshot when backend fails', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'GATE_EVALUATION_FAILED',
            message: 'Unable to evaluate quality gate for non-existent run',
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      )
    );

    const req = createAuthedRequest('evaluation/runs/run-999/quality-gate');
    const res = await proxyGetHandler(req, {
      params: { path: ['evaluation', 'runs', 'run-999', 'quality-gate'] },
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('GATE_EVALUATION_FAILED');
    // Ensure no synthetic fake passed checks or 100% scores exist
    expect(json.data).toBeUndefined();
  });
});
