import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ObservabilityPage from '../src/app/(dashboard)/observability/page';
import { ErrorDetailDrawer, OperationalErrorRecord } from '../src/components/observability/error-detail-drawer';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import {
  SystemHealthData,
  ObservabilityMetrics,
  AdminCacheMetrics,
  AdminAgentRunItem,
  AdminToolCallItem,
} from '../src/types/admin';

// Mock router
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/observability',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getHealth: jest.fn(),
    getMetrics: jest.fn(),
    getCacheMetrics: jest.fn(),
    getAgentRuns: jest.fn(),
    getToolCalls: jest.fn(),
  },
}));

function createWrapper(initialLang: 'en' | 'ar' = 'en') {
  localStorage.setItem('craft_dashboard_lang', initialLang);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  };
}

describe('Phase 11.7 — System Observability Test Suite', () => {
  const mockHealthData: SystemHealthData = {
    service: 'craft-agent-backend',
    environment: 'production',
    status: 'healthy',
    uptimeSeconds: 7200,
    snapshot: {
      status: 'healthy',
      timestamp: '2026-10-03T10:00:00Z',
      uptimeSeconds: 7200,
      requests: {
        total: 1250,
        success: 1225,
        error: 25,
        cancelled: 0,
        errorRate: 2.0,
      },
      ai: {
        requests: 780,
        failures: 6,
        fallbacks: 2,
        tokensTotal: 256000,
        providerHealth: {
          groq: {
            status: 'healthy',
            circuitBreaker: 'closed',
          },
        },
      },
      agent: {
        runs: 54,
        steps: 162,
        partial: 0,
        failed: 1,
      },
      tools: {
        calls: 88,
        failures: 3,
        confirmations: 12,
      },
      memory: {
        retrievalCount: 310,
        selectedCount: 155,
        blockedCount: 2,
      },
      proactive: {
        candidates: 32,
        sent: 18,
        blocked: 1,
      },
    },
  };

  const mockMetricsData: ObservabilityMetrics = {
    timestamp: '2026-10-03T10:00:00Z',
    uptimeSeconds: 7200,
    counters: {
      'craft.requests.total': { value: 1250 },
      'craft.ai.requests': { value: 780 },
    },
    histograms: {
      'craft.ai.latency': {
        count: 780,
        sum: 273000,
        min: 110,
        max: 1650,
        avg: 350,
        p50: 320,
        p90: 590,
        p95: 740,
        p99: 1100,
      },
      'craft.agent.run.duration': {
        count: 54,
        sum: 64800,
        min: 350,
        max: 2900,
        avg: 1200,
        p50: 1050,
        p90: 1800,
        p95: 2300,
        p99: 2850,
      },
    },
    gauges: {
      'craft.memory.cache.size': 236,
    },
  };

  const mockCacheMetrics: AdminCacheMetrics = {
    totalEntries: 236,
    hitCount: 540,
    missCount: 160,
    hitRatePercent: 77.1,
    estimatedSavingsUsd: 48.5,
  };

  const mockFailedRuns: AdminAgentRunItem[] = [
    {
      id: 'run-err-001',
      conversationId: 'conv-corr-101',
      status: 'failed',
      model: 'llama-3.3-70b-versatile',
      provider: 'groq',
      durationMs: 1400,
      toolCallsCount: 2,
      errorDetails: 'Upstream gateway timeout on Groq inference endpoint',
      createdAt: '2026-10-03T09:45:00Z',
      completedAt: '2026-10-03T09:45:01Z',
      hasRedactedReasoning: false,
    },
  ];

  const mockFailedTools: AdminToolCallItem[] = [
    {
      id: 'tc-err-002',
      runId: 'run-err-001',
      agentRunId: 'run-err-001',
      toolName: 'web_search',
      durationMs: 850,
      status: 'error',
      errorMessage: 'Provider rate limit exceeded 429',
      createdAt: '2026-10-03T09:44:50Z',
      completedAt: '2026-10-03T09:44:51Z',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    mockPush.mockClear();
    jest.clearAllMocks();

    (adminApi.getHealth as jest.Mock).mockResolvedValue({ data: mockHealthData });
    (adminApi.getMetrics as jest.Mock).mockResolvedValue({ data: mockMetricsData });
    (adminApi.getCacheMetrics as jest.Mock).mockResolvedValue({ data: mockCacheMetrics });
    (adminApi.getAgentRuns as jest.Mock).mockResolvedValue({ data: mockFailedRuns });
    (adminApi.getToolCalls as jest.Mock).mockResolvedValue({ data: mockFailedTools });
  });

  describe('1. Observability Page & Subsystem Health Grid', () => {
    it('renders header, operational KPI strip with verified server metrics, and unknown DB health', async () => {
      const Wrapper = createWrapper('en');
      render(<ObservabilityPage />, { wrapper: Wrapper });

      expect(await screen.findByText('SYSTEM OBSERVABILITY & HEALTH')).toBeInTheDocument();
      expect((await screen.findAllByText('1,250')).length).toBeGreaterThanOrEqual(2); // In KPI strip and Subsystem card

      // Verified KPI strip
      expect(screen.getByText('System Status')).toBeInTheDocument();
      expect(screen.getByText('API Request Health')).toBeInTheDocument();
      expect(screen.getByText('(2%)')).toBeInTheDocument(); // Error rate

      // AI Provider Groq
      expect(screen.getByText('AI Provider (Groq)')).toBeInTheDocument();
      expect(screen.getAllByText('Healthy').length).toBeGreaterThanOrEqual(1);

      // Search Retrieval
      expect(screen.getByText('Search Retrieval')).toBeInTheDocument();
      expect(screen.getAllByText('88').length).toBeGreaterThanOrEqual(1);

      // Semantic Cache
      expect(screen.getByText('Semantic Cache')).toBeInTheDocument();
      expect(screen.getAllByText('77.1%').length).toBeGreaterThanOrEqual(1);

      // Database Health (Section 5: strictly Unknown because DB pool is not in snapshot)
      expect(screen.getByText('Database Health')).toBeInTheDocument();
      expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(1);
    });

    it('renders individual subsystem health cards with accurate invariants', async () => {
      const Wrapper = createWrapper('en');
      render(<ObservabilityPage />, { wrapper: Wrapper });

      // Subsystem cards
      expect(await screen.findByText('API Gateway & Ingestion')).toBeInTheDocument();
      expect(await screen.findByText('256.0k')).toBeInTheDocument(); // Wait for health query

      expect(screen.getByText('PostgreSQL Database')).toBeInTheDocument();
      expect(screen.getByText('Groq AI Inference')).toBeInTheDocument();
      expect(screen.getByText('Web Search Subsystem')).toBeInTheDocument();
      expect(screen.getByText('Semantic Vector Cache')).toBeInTheDocument();

      // Database card verifies explicit unavailable note
      expect(
        screen.getByText(
          'Database connection pool metrics are managed internally by pg.Pool and are not emitted through the current health snapshot endpoint.'
        )
      ).toBeInTheDocument();

      // AI provider verifies Groq circuit breaker closed
      expect(screen.getByText('Closed (Normal)')).toBeInTheDocument();
    });
  });

  describe('2. Correlation Explorer & Navigation', () => {
    it('allows entering Correlation/Run ID and navigates to target control plane pages', async () => {
      const Wrapper = createWrapper('en');
      render(<ObservabilityPage />, { wrapper: Wrapper });

      await screen.findByText('SYSTEM OBSERVABILITY & HEALTH');

      const correlationInput = screen.getByPlaceholderText(
        'Enter Correlation ID, Run ID, or Tool Call ID...'
      );
      fireEvent.change(correlationInput, { target: { value: 'run-test-123' } });

      // Click Open Agent Run
      const openRunBtn = screen.getByRole('button', { name: /Open Agent Run/i });
      fireEvent.click(openRunBtn);

      expect(mockPush).toHaveBeenCalledWith('/agent-runs?runId=run-test-123');

      // Click Open Tool Telemetry
      const openToolBtn = screen.getByRole('button', { name: /Open Tool Telemetry/i });
      fireEvent.click(openToolBtn);

      expect(mockPush).toHaveBeenCalledWith('/tools?toolCallId=run-test-123');
    });
  });

  describe('3. Recent Operational Errors & Diagnostic Drawer', () => {
    it('aggregates real failed runs and tool calls, opening error diagnostic drawer', async () => {
      const Wrapper = createWrapper('en');
      render(<ObservabilityPage />, { wrapper: Wrapper });

      // Wait for table to load
      expect(await screen.findByText('Recent Operational Errors & Root-Cause Intelligence')).toBeInTheDocument();
      expect(await screen.findByText('AGENT_EXECUTION_FAILURE')).toBeInTheDocument();
      expect(screen.getByText('WEB_SEARCH_ERROR')).toBeInTheDocument();

      // Click Inspect Error for the first error
      const inspectBtns = screen.getAllByRole('button', { name: /Inspect Error/i });
      fireEvent.click(inspectBtns[0]);

      // Error Detail Drawer opens
      expect(await screen.findByText('OPERATIONAL ERROR DIAGNOSTIC')).toBeInTheDocument();
      expect(screen.getAllByText('Upstream gateway timeout on Groq inference endpoint').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Execution Details')).toBeInTheDocument();
    });

    it('sanitizes secret tokens in error messages and metadata inside ErrorDetailDrawer', () => {
      const unsafeError: OperationalErrorRecord = {
        id: 'err-unsafe-99',
        timestamp: '2026-10-03T10:00:00Z',
        service: 'agent',
        severity: 'high',
        errorType: 'AUTH_FAILURE',
        errorMessage: 'Authorization error with Bearer secret_bearer_token_xyz and api_key gsk_secret_1234567890abcdef',
        correlationId: 'corr-unsafe-99',
        metadata: {
          authorization: 'Bearer secret_auth_header',
          secret_key: 'confidential_key',
          safe_metric: 'allowed_value',
        },
      };

      const Wrapper = createWrapper('en');
      render(
        <ErrorDetailDrawer
          errorItem={unsafeError}
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Verify tokens and secrets are redacted
      expect(screen.queryByText(/secret_bearer_token_xyz/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/gsk_secret_1234567890abcdef/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/secret_auth_header/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/confidential_key/i)).not.toBeInTheDocument();

      // Safe field is visible
      expect(screen.getByText(/"safe_metric": "allowed_value"/)).toBeInTheDocument();
    });
  });

  describe('4. Latency Histograms', () => {
    it('renders percentile metrics p50, p90, p95, p99 from histograms', async () => {
      const Wrapper = createWrapper('en');
      render(<ObservabilityPage />, { wrapper: Wrapper });

      expect(await screen.findByText('Infrastructure Latency Histograms')).toBeInTheDocument();
      expect(await screen.findByText('craft.ai.latency')).toBeInTheDocument();
      expect(screen.getByText('320ms')).toBeInTheDocument(); // p50
      expect(screen.getByText('740ms')).toBeInTheDocument(); // p95
      expect(screen.getByText('1100ms')).toBeInTheDocument(); // p99
    });
  });

  describe('5. Arabic Localization & RTL Isolation', () => {
    it('renders Observability in Arabic with RTL text and technical metrics preserved in LTR', async () => {
      const Wrapper = createWrapper('ar');
      render(<ObservabilityPage />, { wrapper: Wrapper });

      expect(await screen.findByText('مراقبة النظام وحالته الصحية')).toBeInTheDocument();
      expect(screen.getByText('حالة النظام')).toBeInTheDocument();
      expect(screen.getByText('صحة طلبات API')).toBeInTheDocument();
      expect(screen.getByText('مزود الذكاء الاصطناعي (Groq)')).toBeInTheDocument();
      expect(screen.getByText('استرجاع البحث')).toBeInTheDocument();
      expect(screen.getByText('الذاكرة الوسيطة الدلالية')).toBeInTheDocument();
    });
  });
});
