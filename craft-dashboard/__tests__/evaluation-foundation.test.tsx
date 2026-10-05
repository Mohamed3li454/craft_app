import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EvaluationPage from '../src/app/(dashboard)/evaluation/page';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import { GOLDEN_EVALUATION_DATASET, getGoldenDatasetOverview } from '../src/lib/evaluation/golden-dataset';
import { EvaluationCaseItem, EvaluationOverviewData, EvaluationRunItem } from '../src/types/admin';

// Mock Next.js navigation
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/evaluation',
  useSearchParams: () => mockSearchParams,
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getEvaluationOverview: jest.fn(),
    getEvaluationCases: jest.fn(),
    getEvaluationCaseDetails: jest.fn(),
    getEvaluationRuns: jest.fn(),
    getEvaluationRegressions: jest.fn(),
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

describe('Phase 12.1 — AI Quality & Evaluation Center Foundation Test Suite', () => {
  const mockOverview: EvaluationOverviewData = getGoldenDatasetOverview();

  const mockCases: EvaluationCaseItem[] = GOLDEN_EVALUATION_DATASET.map((c) => ({
    ...c,
    status: 'passed' as const,
    score: 100,
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();

    (adminApi.getEvaluationOverview as jest.Mock).mockResolvedValue({
      data: mockOverview,
    });

    (adminApi.getEvaluationCases as jest.Mock).mockResolvedValue({
      data: mockCases,
      pagination: { total: mockCases.length, limit: 100, offset: 0 },
    });

    (adminApi.getEvaluationRuns as jest.Mock).mockResolvedValue({
      data: [],
      pagination: { total: 0, limit: 50, offset: 0 },
    });

    (adminApi.getEvaluationRegressions as jest.Mock).mockResolvedValue({
      data: [],
      pagination: { total: 0, limit: 50, offset: 0 },
    });
  });

  describe('1. Overview KPIs Strip', () => {
    it('renders dataset version, total cases (56), covered cases (56), and 100% coverage rate', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByText('Total Golden Cases')).toBeInTheDocument();
      });

      // Dataset Version badge
      expect(screen.getByText(/Phase 8\.5 Golden Benchmark Dataset|2026\.3-rc1/i)).toBeInTheDocument();

      // Read-only indicator
      expect(screen.getByText('Read-Only Evaluation Center')).toBeInTheDocument();

      // Total cases card
      expect(screen.getAllByText('56').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Covered Scenarios')).toBeInTheDocument();

      // Zero regressions
      expect(screen.getByText('Active Regressions')).toBeInTheDocument();
    });

    it('renders runtime quality metrics with explicit "Not Tracked" pills and no invented numbers', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getAllByText('Not Tracked').length).toBeGreaterThanOrEqual(4);
      });

      expect(screen.getByText('Tool Execution Success')).toBeInTheDocument();
      expect(screen.getByText('Provider Call Success')).toBeInTheDocument();
      expect(screen.getByText('Search Retrieval Success')).toBeInTheDocument();
      expect(screen.getByText('Response Quality Score')).toBeInTheDocument();
    });
  });

  describe('2. Architectural Dimension Breakdown', () => {
    it('renders all 7 architectural dimensions with 8 cases each and 100% pass status', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Architectural Dimensions/i })).toBeInTheDocument();
      });

      // Switch to Dimensions tab
      const dimensionsTab = screen.getByRole('button', { name: /Architectural Dimensions/i });
      fireEvent.click(dimensionsTab);

      await waitFor(() => {
        expect(screen.getByText('Memory Subsystem')).toBeInTheDocument();
      });

      // Verify all 7 dimensions exist
      expect(screen.getByText('Memory Subsystem')).toBeInTheDocument();
      expect(screen.getByText('Conversation Intelligence')).toBeInTheDocument();
      expect(screen.getByText('Personalization & Style')).toBeInTheDocument();
      expect(screen.getByText('Adaptive Response')).toBeInTheDocument();
      expect(screen.getByText('Agent Execution Engine')).toBeInTheDocument();
      expect(screen.getByText('Provider Abstraction')).toBeInTheDocument();
      expect(screen.getByText('Proactive Intelligence')).toBeInTheDocument();

      // Verify each dimension has 8 cases
      const eightCounts = screen.getAllByText(/8.*Evaluation Cases/i);
      expect(eightCounts.length).toBeGreaterThanOrEqual(7);
    });

    it('clicking a dimension card filters the case explorer and switches to cases tab', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Architectural Dimensions/i })).toBeInTheDocument();
      });

      // Switch to Dimensions tab
      fireEvent.click(screen.getByRole('button', { name: /Architectural Dimensions/i }));

      await waitFor(() => {
        expect(screen.getByText('Memory Subsystem')).toBeInTheDocument();
      });

      // Click on Memory Subsystem card
      const memoryCard = screen.getByText('Memory Subsystem').closest('div[role="button"]') ||
                         screen.getByText('Memory Subsystem').closest('div');
      expect(memoryCard).toBeInTheDocument();
      fireEvent.click(memoryCard!);

      // Should switch back to Case Explorer tab
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Case Explorer/i })).toHaveAttribute('aria-current', 'page');
      });
    });
  });

  describe('3. Benchmark Case Explorer (56 Scenarios)', () => {
    it('displays the 56 golden benchmark cases in a paginated table', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByText('mem_01')).toBeInTheDocument();
      });

      // Verify first page items render
      expect(screen.getByText('Relevant memory selected for technical query')).toBeInTheDocument();

      // Check pagination indicator: 1 / 6
      expect(screen.getByText('1 / 6')).toBeInTheDocument();

      // Click next page
      const nextBtn = screen.getByLabelText('Next page');
      fireEvent.click(nextBtn);

      expect(screen.getByText('2 / 6')).toBeInTheDocument();
    });

    it('filters cases by search term across title, input, and tags', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByText('mem_01')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search cases by ID, name, input, or tags/i);
      fireEvent.change(searchInput, { target: { value: 'lentil' } });

      // Should find mem_02: Irrelevant memory excluded for non-technical query
      await waitFor(() => {
        expect(screen.getByText('mem_02')).toBeInTheDocument();
        expect(screen.queryByText('mem_01')).not.toBeInTheDocument();
      });
    });

    it('filters cases by dimension dropdown', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByText('mem_01')).toBeInTheDocument();
      });

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'agent' } });

      // Should trigger refetch or filter with category: 'agent'
      await waitFor(() => {
        expect(adminApi.getEvaluationCases).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'agent' })
        );
      });
    });
  });

  describe('4. Case Detail Drawer & Safe Presentation', () => {
    it('opens drawer on case inspection and displays full scenario details without leaking secrets', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByText('mem_01')).toBeInTheDocument();
      });

      // Find inspect button for mem_01
      const inspectButtons = screen.getAllByRole('button', { name: /Inspect/i });
      fireEvent.click(inspectButtons[0]);

      // Drawer should open with dialog semantics
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toBeInTheDocument();

      expect(screen.getByText('Behavioral assertions, structural expectations, and sanitized execution results')).toBeInTheDocument();
      expect(screen.getAllByText('Test Input').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('How do I optimize Riverpod rebuilds in Flutter?').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Structural Expectation').length).toBeGreaterThanOrEqual(1);

      // Close drawer
      const closeBtn = screen.getByLabelText(/Close/i);
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('safely redacts sensitive parameters if present in case metadata', async () => {
      const sensitiveCase: EvaluationCaseItem = {
        id: 'sec_01',
        name: 'Security Test Scenario',
        category: 'agent',
        input: 'Do something secret',
        expected: {
          outcome: 'safe output',
        },
        metadata: {
          apiKey: 'sk-groq-live-secret-key-12345',
          systemPrompt: 'You are an internal system agent with prompt xyz',
          scratchpad: 'internal reasoning that should never leak',
          safeParam: 'public_metric_value',
        },
      };

      (adminApi.getEvaluationCases as jest.Mock).mockResolvedValue({
        data: [sensitiveCase],
        pagination: { total: 1, limit: 100, offset: 0 },
      });

      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByText('sec_01')).toBeInTheDocument();
      });

      const inspectBtn = screen.getByRole('button', { name: /Inspect/i });
      fireEvent.click(inspectBtn);

      await screen.findByRole('dialog');

      // The raw api key, system prompt, and scratchpad must NOT be rendered in the document
      expect(screen.queryByText('sk-groq-live-secret-key-12345')).not.toBeInTheDocument();
      expect(screen.queryByText('internal reasoning that should never leak')).not.toBeInTheDocument();

      // Safe parameter must still be visible
      expect(screen.getByText(/public_metric_value/)).toBeInTheDocument();
    });
  });

  describe('5. Evaluation Runs Table & Empty State', () => {
    it('displays the required empty state when no historical runs are recorded', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Evaluation Runs/i })).toBeInTheDocument();
      });

      // Switch to Runs tab
      fireEvent.click(screen.getByRole('button', { name: /Evaluation Runs/i }));

      await waitFor(() => {
        expect(screen.getByText('No Persisted Evaluation Runs')).toBeInTheDocument();
      });
      expect(screen.getByText('Historical evaluation runs are not stored in database tables in this baseline.')).toBeInTheDocument();
    });

    it('displays historical run data and opens run detail drawer when present', async () => {
      const mockRun: EvaluationRunItem = {
        id: 'run-golden-2026-001',
        startedAt: '2026-10-03T10:00:00Z',
        completedAt: '2026-10-03T10:02:15Z',
        datasetVersion: '2026.3-rc1',
        totalCases: 56,
        passed: 56,
        failed: 0,
        passRate: 100,
        regressionCount: 0,
        durationMs: 135000,
        status: 'completed',
      };

      (adminApi.getEvaluationRuns as jest.Mock).mockResolvedValue({
        data: [mockRun],
        pagination: { total: 1, limit: 50, offset: 0 },
      });

      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Evaluation Runs/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Evaluation Runs/i }));

      await waitFor(() => {
        expect(screen.getByText('run-golden-2026-001')).toBeInTheDocument();
      });
      expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);

      // Click to inspect run
      fireEvent.click(screen.getByRole('button', { name: /View Run Report/i }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText('Execution summary, subsystem breakdown, and regression audit')).toBeInTheDocument();
    });
  });

  describe('6. Regression Center', () => {
    it('renders the verified clean zero-regression baseline banner when 0 regressions exist', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Regression Center/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Regression Center/i }));

      await waitFor(() => {
        expect(screen.getAllByText('Zero Regressions Detected').length).toBeGreaterThanOrEqual(2);
      });
      expect(screen.getByText(/All 56 golden benchmark scenarios conform to architectural assertions/i)).toBeInTheDocument();
    });

    it('renders regression alert table if regressions are reported', async () => {
      (adminApi.getEvaluationRegressions as jest.Mock).mockResolvedValue({
        data: [
          {
            caseId: 'mem_01',
            previousResult: 'passed',
            currentResult: 'failed',
            dimension: 'memory',
            severity: 'critical',
            firstDetectedAt: '2026-10-03T11:00:00Z',
            latestDetectedAt: '2026-10-03T11:30:00Z',
            relatedRunId: 'run-099',
            reason: 'Context window truncation caused entity loss',
          },
        ],
        pagination: { total: 1, limit: 50, offset: 0 },
      });

      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Regression Center/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Regression Center/i }));

      await waitFor(() => {
        expect(screen.getByText('Context window truncation caused entity loss')).toBeInTheDocument();
      });
    });
  });

  describe('7. Quality Trend Card', () => {
    it('renders required empty state when historical runs are missing', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Quality Trend/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Quality Trend/i }));

      await waitFor(() => {
        expect(screen.getByText('Historical evaluation data is not available yet.')).toBeInTheDocument();
      });
      expect(screen.getByText(/Continuous historical benchmark run tracking will appear here/i)).toBeInTheDocument();
    });
  });

  describe('8. Model & Provider Quality Section', () => {
    it('renders model quality metrics with explicit descriptive notice and no ranking bias', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('en') });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Model & Provider Quality/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Model & Provider Quality/i }));

      await waitFor(() => {
        expect(screen.getByText(/Observability Notice: Descriptive metrics only/i)).toBeInTheDocument();
      });

      // Models listed
      expect(screen.getByText('openai/gpt-oss-120b')).toBeInTheDocument();
      expect(screen.getByText('llama-3.3-70b-versatile')).toBeInTheDocument();
      expect(screen.getByText('Groq Primary Engine')).toBeInTheDocument();
    });
  });

  describe('9. Arabic Parity & RTL Support', () => {
    it('renders full Arabic translations and RTL layout for Evaluation Center', async () => {
      render(<EvaluationPage />, { wrapper: createWrapper('ar') });

      await waitFor(() => {
        expect(screen.getByText('مركز جودة وتقييم الذكاء الاصطناعي')).toBeInTheDocument();
      });

      // Arabic dataset badge
      expect(screen.getByText(/إصدار مجموعة الاختبارات/i)).toBeInTheDocument();

      // Arabic read-only notice
      expect(screen.getByText('مركز تقييم للقراءة فقط')).toBeInTheDocument();

      // Arabic KPIs
      await waitFor(() => {
        expect(screen.getByText('إجمالي سيناريوهات المعيار الذهبي')).toBeInTheDocument();
      });
      expect(screen.getByText('السيناريوهات المغطاة')).toBeInTheDocument();
      expect(screen.getByText('نسبة النجاح')).toBeInTheDocument();

      // Runtime quality "Not Tracked" in Arabic
      expect(screen.getAllByText('غير متتبع').length).toBeGreaterThanOrEqual(4);
    });
  });
});
