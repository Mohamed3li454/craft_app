import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import EvaluationPage from '@/app/(dashboard)/evaluation/page';
import { RunEvaluationModal } from '@/components/evaluation/run-evaluation-modal';
import { RunDetailDrawer } from '@/components/evaluation/run-detail-drawer';
import { QualityTrendCard } from '@/components/evaluation/quality-trend-card';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { adminApi } from '@/lib/api/admin-client';
import { EvaluationRunItem, EvaluationCaseResult, EvaluationRegressionItem } from '@/types/admin';

jest.mock('@/lib/api/admin-client', () => ({
  adminApi: {
    getEvaluationOverview: jest.fn(),
    getEvaluationCases: jest.fn(),
    getEvaluationRuns: jest.fn(),
    getEvaluationRegressions: jest.fn(),
    triggerEvaluationRun: jest.fn(),
    getEvaluationRunDetails: jest.fn(),
    getEvaluationRunResults: jest.fn(),
  },
}));

const mockRuns: EvaluationRunItem[] = [
  {
    id: 'run-alpha-12345',
    datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
    mode: 'mock',
    status: 'completed',
    totalCases: 56,
    passed: 56,
    failed: 0,
    passRate: 100,
    passedCases: 56,
    failedCases: 0,
    overallScore: 100,
    regressionCount: 0,
    durationMs: 320,
    startedAt: '2026-10-03T10:00:00Z',
    completedAt: '2026-10-03T10:00:01Z',
    createdBy: 'admin_test',
  },
  {
    id: 'run-beta-67890',
    datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
    mode: 'mock',
    status: 'completed',
    totalCases: 56,
    passed: 55,
    failed: 1,
    passRate: 98.2,
    passedCases: 55,
    failedCases: 1,
    overallScore: 98.2,
    regressionCount: 1,
    durationMs: 410,
    startedAt: '2026-10-03T11:00:00Z',
    completedAt: '2026-10-03T11:00:01Z',
    createdBy: 'ci_pipeline',
  },
];

const mockCaseResults: EvaluationCaseResult[] = [
  {
    id: 'res-1',
    runId: 'run-beta-67890',
    caseId: 'mem_01',
    dimension: 'memory',
    status: 'passed',
    score: 100,
    expected: { memoryUsage: 'required' },
    actual: { memorySelectedCount: 1 },
    regression: false,
    durationMs: 12,
    tokens: 0,
    createdAt: '2026-10-03T11:00:00Z',
  },
  {
    id: 'res-2',
    runId: 'run-beta-67890',
    caseId: 'agent_01',
    dimension: 'agent',
    status: 'failed',
    score: 0,
    expected: { strategy: 'direct_execution' },
    actual: { strategy: 'fallback' },
    failureReason: 'Expected direct_execution but got fallback',
    regression: true,
    previousStatus: 'passed',
    previousScore: 100,
    durationMs: 24,
    tokens: 0,
    createdAt: '2026-10-03T11:00:00Z',
  },
];

const mockRegressions: EvaluationRegressionItem[] = [
  {
    caseId: 'agent_01',
    dimension: 'agent',
    status: 'failed',
    previousStatus: 'passed',
    previousResult: 'passed',
    currentResult: 'failed',
    severity: 'critical',
    firstDetectedAt: '2026-10-03T11:00:01Z',
    latestDetectedAt: '2026-10-03T11:00:01Z',
    relatedRunId: 'run-beta-67890',
    reason: 'Expected direct_execution but got fallback',
  },
];

function createTestWrapper(initialLanguage: 'en' | 'ar' = 'en') {
  localStorage.setItem('craft_dashboard_lang', initialLanguage);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </QueryClientProvider>
    );
  };
}

describe('Phase 12.2 — Evaluation Runner & Persistent History Test Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (adminApi.getEvaluationOverview as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        totalCases: 56,
        coveredCases: 56,
        uncoveredCases: 0,
        coverageRate: 100,
        dimensionsCount: 7,
        dimensionCoverage: {
          memory: 8,
          conversation: 8,
          personalization: 8,
          adaptive_response: 8,
          agent: 8,
          provider: 8,
          proactive: 8,
        },
        lastEvaluationRun: mockRuns[0],
        historicalRunsCount: 2,
        activeRegressionsCount: 1,
      },
    });

    (adminApi.getEvaluationCases as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'mem_01',
          name: 'Relevant memory selected for technical query',
          category: 'memory',
          input: 'How do I optimize Riverpod rebuilds in Flutter?',
          expected: { memoryUsage: 'required', expectedDepth: 'deep' },
          tags: ['memory', 'relevance', 'selection'],
        },
      ],
      pagination: { total: 56, limit: 100, offset: 0, hasMore: false },
    });

    (adminApi.getEvaluationRuns as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRuns,
      pagination: { total: 2, limit: 50, offset: 0, hasMore: false },
    });

    (adminApi.getEvaluationRegressions as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRegressions,
      pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
    });

    (adminApi.getEvaluationRunResults as jest.Mock).mockResolvedValue({
      success: true,
      data: mockCaseResults,
      pagination: { total: 2, limit: 100, offset: 0, hasMore: false },
    });

    (adminApi.triggerEvaluationRun as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        run: {
          id: 'run-gamma-99999',
          datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
          mode: 'mock',
          status: 'completed',
          totalCases: 56,
          passed: 56,
          failed: 0,
          passRate: 100,
          passedCases: 56,
          failedCases: 0,
          overallScore: 100,
          regressionCount: 0,
          durationMs: 340,
          startedAt: '2026-10-03T12:00:00Z',
          completedAt: '2026-10-03T12:00:01Z',
          createdBy: 'admin',
        },
        regressionSummary: { totalRegressions: 0, regressedCaseIds: [] },
      },
    });
  });

  describe('1. Run Evaluation Trigger & Modal UI', () => {
    it('renders "Run Evaluation" button and opens trigger modal on click', async () => {
      const Wrapper = createTestWrapper('en');
      render(<EvaluationPage />, { wrapper: Wrapper });

      const runButton = await screen.findByRole('button', { name: /Run Evaluation/i });
      expect(runButton).toBeInTheDocument();

      fireEvent.click(runButton);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/Execute golden benchmark cases/i)).toBeInTheDocument();
      expect(screen.getByText(/Mock Mode/i)).toBeInTheDocument();
      expect(screen.getByText(/Replay Mode/i)).toBeInTheDocument();
      expect(screen.getByText(/Live Mode/i)).toBeInTheDocument();
      expect(screen.getByText(/Production Safety Guarantee/i)).toBeInTheDocument();
    });

    it('submits evaluation run with selected mode and updates UI with success banner', async () => {
      const Wrapper = createTestWrapper('en');
      render(<EvaluationPage />, { wrapper: Wrapper });

      const runButton = await screen.findByRole('button', { name: /Run Evaluation/i });
      fireEvent.click(runButton);

      const submitButton = screen.getByRole('button', { name: /Start Evaluation Run/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(adminApi.triggerEvaluationRun).toHaveBeenCalledWith({
          mode: 'mock',
          category: undefined,
        });
      });

      // Verifies notification banner appears
      expect(await screen.findByText(/Evaluation run completed: 56\/56 passed/i)).toBeInTheDocument();
    });
  });

  describe('2. Run Detail Drawer & Case Results Diagnostics', () => {
    it('renders run details and individual case results with regression indicators', async () => {
      const Wrapper = createTestWrapper('en');
      render(
        <RunDetailDrawer
          isOpen={true}
          onClose={jest.fn()}
          run={mockRuns[1]}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText('run-beta-67890')).toBeInTheDocument();
      expect(screen.getByText('98.2%')).toBeInTheDocument();

      await waitFor(() => {
        expect(adminApi.getEvaluationRunResults).toHaveBeenCalledWith('run-beta-67890', { limit: 100 });
      });

      // Check cases list
      expect(await screen.findByText('mem_01')).toBeInTheDocument();
      expect(await screen.findByText('agent_01')).toBeInTheDocument();
      expect(screen.getByText('REGRESSION')).toBeInTheDocument();
      expect(screen.getByText(/Expected direct_execution but got fallback/i)).toBeInTheDocument();
    });

    it('filters case results by status in the drawer', async () => {
      const Wrapper = createTestWrapper('en');
      render(
        <RunDetailDrawer
          isOpen={true}
          onClose={jest.fn()}
          run={mockRuns[1]}
        />,
        { wrapper: Wrapper }
      );

      await screen.findByText('mem_01');

      // Click Failed filter
      const failedFilterBtn = screen.getByRole('button', { name: /^failed$/i });
      fireEvent.click(failedFilterBtn);

      expect(screen.queryByText('mem_01')).not.toBeInTheDocument();
      expect(screen.getByText('agent_01')).toBeInTheDocument();
    });
  });

  describe('3. Longitudinal Quality Trend Card', () => {
    it('renders historical quality score bars and longitudinal stats', () => {
      const Wrapper = createTestWrapper('en');
      render(<QualityTrendCard runs={mockRuns} hasHistoricalData={true} />, { wrapper: Wrapper });

      expect(screen.getByText(/Quality Trend & Pass Rate Over Time/i)).toBeInTheDocument();
      expect(screen.getByText('Average Score:')).toBeInTheDocument();
      expect(screen.getByText('99.1%')).toBeInTheDocument(); // avg of 100 and 98.2
      expect(screen.getByText('Total Regressions:')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2 Historical Executions')).toBeInTheDocument();
    });
  });

  describe('4. Regression Center Real Persistence Integration', () => {
    it('displays active regressions with previous vs current status and severity', async () => {
      const Wrapper = createTestWrapper('en');
      render(<EvaluationPage />, { wrapper: Wrapper });

      // Navigate to Regressions tab
      const regressionsTab = await screen.findByRole('button', { name: /Regression Center/i });
      fireEvent.click(regressionsTab);

      expect(await screen.findByText('agent_01')).toBeInTheDocument();
      expect(screen.getByText('run-beta-67890')).toBeInTheDocument();
      expect(screen.getByText(/critical/i)).toBeInTheDocument();
      expect(screen.getByText(/Expected direct_execution but got fallback/i)).toBeInTheDocument();
    });
  });

  describe('5. Arabic Language & RTL Parity', () => {
    it('renders Arabic translations for Run Evaluation button, modal, and headers', async () => {
      const Wrapper = createTestWrapper('ar');
      render(<EvaluationPage />, { wrapper: Wrapper });

      const runButton = await screen.findByRole('button', { name: /تشغيل التقييم/i });
      expect(runButton).toBeInTheDocument();

      fireEvent.click(runButton);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /إلغاء/i })).toBeInTheDocument();
    });
  });
});
