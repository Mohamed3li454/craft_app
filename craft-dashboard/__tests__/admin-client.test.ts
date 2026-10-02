import { adminApi } from '../src/lib/api/admin-client';

describe('AdminApiClient Security & API Contracts', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('calls /api/admin-proxy/overview with credentials: same-origin and no client secret', async () => {
    const mockSuccessResponse = {
      success: true,
      data: {
        overview: { totalUsers: 100, activeUsers24h: 25 },
        dailyTrends: [],
        modelBreakdown: [],
      },
      correlationId: 'corr-test-123',
      timestamp: new Date().toISOString(),
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockSuccessResponse,
    });

    const res = await adminApi.getOverview(7);
    expect(res.success).toBe(true);
    expect(res.data.overview.totalUsers).toBe(100);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];

    // Assert URL uses BFF admin-proxy
    expect(url).toContain('/api/admin-proxy/overview?days=7');
    // Assert cookie is passed via same-origin credentials
    expect(options.credentials).toBe('same-origin');
    // Assert NO Bearer token is exposed in client fetch headers
    const authHeader = options.headers ? options.headers.get?.('Authorization') : null;
    expect(authHeader).toBeNull();
  });

  test('surfaces backend error code and correlation ID upon failure', async () => {
    const mockErrorResponse = {
      error: {
        code: 'ADMIN_FORBIDDEN',
        message: 'Insufficient administrative privileges',
      },
      correlationId: 'corr-err-456',
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => mockErrorResponse,
    });

    await expect(adminApi.banUser('user-999', 'Spam')).rejects.toMatchObject({
      message: 'Insufficient administrative privileges',
      code: 'ADMIN_FORBIDDEN',
      correlationId: 'corr-err-456',
      status: 403,
    });
  });
});
