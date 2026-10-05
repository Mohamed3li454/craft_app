import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { adminApi } from '@/lib/api/admin-client';
import { FailurePatternsTable } from '@/components/evaluation/failure-patterns-table';
import { DimensionHealthGrid } from '@/components/evaluation/dimension-health-grid';
import { RunComparisonDialog } from '@/components/evaluation/run-comparison-dialog';
import { CaseHistoryDrawer } from '@/components/evaluation/case-history-drawer';
import { RunDetailDrawer } from '@/components/evaluation/run-detail-drawer';
import EvaluationPage from '@/app/(dashboard)/evaluation/page';
import {
  FailureCluster,
  DimensionHealth,
  RunComparisonResult,
  EvaluationRunItem,
  EvaluationCaseResult,
} from '@/types/admin';

jest.mock('@/lib/api/admin-client', () => ({
  adminApi: {
    getEvaluationOverview: jest.fn(),
    getEvaluationCases: jest.fn(),
    getEvaluationRuns: jest.fn(),
    getEvaluationRegressions: jest.fn(),
    triggerEvaluationRun: jest.fn(),
    getEvaluationRunDetails: jest.fn(),
    getEvaluationRunResults: jest.fn(),
    getEvaluationQualityOverview: jest.fn(),
    getEvaluationFailures: jest.fn(),
    compareEvaluationRuns: jest.fn(),
    getEvaluationCaseHistory: jest.fn(),
  },
}));

const mockRuns: EvaluationRunItem[] = [
  {
    id: 'run-001',
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
    durationMs: 300,
    startedAt: '2026-10-04T05:00:00Z',
    completedAt: '2026-10-04T05:00:01Z',
    createdBy: 'admin',
  },
  {
    id: 'run-002',
    datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
    mode: 'mock',
    status: 'completed',
    totalCases: 56,
    passed: 54,
    failed: 2,
    passRate: 96.4,
    passedCases: 54,
    failedCases: 2,
    overallScore: 95.0,
    regressionCount: 1,
    durationMs: 350,
    startedAt: '2026-10-04T06:00:00Z',
    completedAt: '2026-10-04T06:00:01Z',
    createdBy: 'admin',
  },
];

const mockClusters: FailureCluster[] = [
  {
    pattern: 'agent:required_tool_missing:calculator',
    category: 'required_tool_missing',
    dimension: 'agent',
    affectedCases: ['agent_01', 'agent_02'],
    affectedRuns: ['run-002'],
    occurrences: 2,
    firstSeen: '2026-10-04T06:00:00Z',
    lastSeen: '2026-10-04T06:00:00Z',
    sampleReason: 'Required tool [calculator] was not invoked',
  },
];

const mockHealthMap: Record<string, DimensionHealth> = {
  memory: {
    dimension: 'memory',
    totalCases: 8,
    evaluatedCases: 8,
    passedCases: 8,
    failedCases: 0,
    passRate: 100,
    averageScore: 100,
    regressionsCount: 0,
    topFailurePattern: null,
  },
  agent: {
    dimension: 'agent',
    totalCases: 8,
    evaluatedCases: 8,
    passedCases: 6,
    failedCases: 2,
    passRate: 75.0,
    averageScore: 80.0,
    regressionsCount: 1,
    topFailurePattern: 'agent:required_tool_missing:calculator',
  },
  conversation: {
    dimension: 'conversation',
    totalCases: 8,
    evaluatedCases: 8,
    passedCases: 8,
    failedCases: 0,
    passRate: 100,
    averageScore: 100,
    regressionsCount: 0,
    topFailurePattern: null,
  },
  personalization: {
    dimension: 'personalization',
    totalCases: 8,
    evaluatedCases: 8,
    passedCases: 8,
    failedCases: 0,
    passRate: 100,
    averageScore: 100,
    regressionsCount: 0,
    topFailurePattern: null,
  },
  adaptive_response: {
    dimension: 'adaptive_response',
    totalCases: 8,
    evaluatedCases: 8,
    passedCases: 8,
    failedCases: 0,
    passRate: 100,
    averageScore: 100,
    regressionsCount: 0,
    topFailurePattern: null,
  },
  provider: {
    dimension: 'provider',
    totalCases: 8,
    evaluatedCases: 8,
    passedCases: 8,
    failedCases: 0,
    passRate: 100,
    averageScore: 100,
    regressionsCount: 0,
    topFailurePattern: null,
  },
  proactive: {
    dimension: 'proactive',
    totalCases: 8,
    evaluatedCases: 8,
    passedCases: 8,
    failedCases: 0,
    passRate: 100,
    averageScore: 100,
    regressionsCount: 0,
    topFailurePattern: null,
  },
};

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{ui}</LanguageProvider>
    </QueryClientProvider>
  );
};

describe('Phase 12.3 Quality Intelligence Frontend Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (adminApi.getEvaluationOverview as jest.Mock).mockResolvedValue({
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
        historicalRunsCount: 2,
        activeRegressionsCount: 1,
        runtimeQuality: {
          toolSuccess: '100%',
          providerSuccess: '100%',
          searchSuccess: '100%',
          responseQuality: '100%',
        },
      },
    });
    (adminApi.getEvaluationCases as jest.Mock).mockResolvedValue({ data: [] });
    (adminApi.getEvaluationRuns as jest.Mock).mockResolvedValue({ data: mockRuns });
    (adminApi.getEvaluationRegressions as jest.Mock).mockResolvedValue({ data: [] });
    (adminApi.getEvaluationQualityOverview as jest.Mock).mockResolvedValue({
      data: {
        latestRun: mockRuns[1],
        totalHistoricalRuns: 2,
        activeRegressionsCount: 1,
        dimensionHealth: mockHealthMap,
        providerDiagnostics: [],
        topFailures: mockClusters,
        totalEvaluatedCases: 56,
      },
    });
    (adminApi.getEvaluationFailures as jest.Mock).mockResolvedValue({
      data: {
        clusters: mockClusters,
        taxonomyCounts: { required_tool_missing: 2 },
        totalFailures: 2,
        totalEvaluatedCases: 56,
      },
    });
  });

  // =========================================================================
  // 1. FailurePatternsTable
  // =========================================================================
  describe('1. FailurePatternsTable', () => {
    it('renders failure taxonomy distribution and clustered patterns', () => {
      renderWithProviders(
        <FailurePatternsTable
          clusters={mockClusters}
          taxonomyCounts={{ required_tool_missing: 2 }}
          totalFailures={2}
          totalEvaluated={56}
        />
      );

      expect(screen.getByText(/Deterministic Failure Taxonomy/i)).toBeInTheDocument();
      expect(screen.getByText('agent:required_tool_missing:calculator')).toBeInTheDocument();
      expect(screen.getByText('agent_01')).toBeInTheDocument();
      expect(screen.getByText('agent_02')).toBeInTheDocument();
    });

    it('filters clusters by search query', () => {
      renderWithProviders(
        <FailurePatternsTable
          clusters={mockClusters}
          taxonomyCounts={{ required_tool_missing: 2 }}
          totalFailures={2}
          totalEvaluated={56}
        />
      );

      const searchInput = screen.getByPlaceholderText(/Search pattern, case, or dimension/i);
      fireEvent.change(searchInput, { target: { value: 'non_existent_term' } });

      expect(screen.queryByText('agent:required_tool_missing:calculator')).not.toBeInTheDocument();
      expect(screen.getByText(/Zero failure clusters detected/i)).toBeInTheDocument();
    });

    it('invokes onSelectCase when clicking an affected case chip', () => {
      const handleSelectCase = jest.fn();
      renderWithProviders(
        <FailurePatternsTable
          clusters={mockClusters}
          taxonomyCounts={{ required_tool_missing: 2 }}
          totalFailures={2}
          totalEvaluated={56}
          onSelectCase={handleSelectCase}
        />
      );

      fireEvent.click(screen.getByText('agent_01'));
      expect(handleSelectCase).toHaveBeenCalledWith('agent_01');
    });
  });

  // =========================================================================
  // 2. DimensionHealthGrid
  // =========================================================================
  describe('2. DimensionHealthGrid', () => {
    it('renders all 7 architectural dimensions with descriptive health metrics', () => {
      renderWithProviders(<DimensionHealthGrid healthMap={mockHealthMap as any} />);

      expect(screen.getByText(/Memory Subsystem/i)).toBeInTheDocument();
      expect(screen.getByText(/Agent Execution Engine/i)).toBeInTheDocument();
      expect(screen.getByText(/75%/i)).toBeInTheDocument(); // Agent pass rate
      expect(screen.getByText('1 Regr.')).toBeInTheDocument();
      expect(screen.getByText('agent:required_tool_missing:calculator')).toBeInTheDocument();
    });

    it('triggers onSelectDimension when clicking a dimension card', () => {
      const handleSelectDimension = jest.fn();
      renderWithProviders(
        <DimensionHealthGrid
          healthMap={mockHealthMap as any}
          onSelectDimension={handleSelectDimension}
        />
      );

      fireEvent.click(screen.getByText(/Memory Subsystem/i));
      expect(handleSelectDimension).toHaveBeenCalledWith('memory');
    });
  });

  // =========================================================================
  // 3. RunComparisonDialog
  // =========================================================================
  describe('3. RunComparisonDialog', () => {
    it('renders run comparison dialog with delta metrics and changed cases diff', async () => {
      const mockComparison: RunComparisonResult = {
        runA: mockRuns[0],
        runB: mockRuns[1],
        metrics: {
          passRateDeltaPp: -3.6,
          averageScoreDelta: -5.0,
          failuresDelta: 2,
          regressionsDelta: 1,
          durationDeltaMs: 50,
          tokensDelta: 120,
        },
        dimensionComparison: [
          {
            dimension: 'agent',
            runAPassRate: 100,
            runBPassRate: 75,
            deltaPp: -25.0,
          },
        ],
        changedCases: [
          {
            caseId: 'agent_01',
            dimension: 'agent',
            changeType: 'regression',
            runA: { status: 'passed', score: 100, durationMs: 40 },
            runB: { status: 'failed', score: 0, durationMs: 60, failureReason: 'Missing tool calculator' },
            scoreDelta: -100,
          },
        ],
      };

      (adminApi.compareEvaluationRuns as jest.Mock).mockResolvedValue({
        data: mockComparison,
      });

      renderWithProviders(
        <RunComparisonDialog
          isOpen={true}
          onClose={jest.fn()}
          availableRuns={mockRuns}
          initialRunAId="run-001"
          initialRunBId="run-002"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('-3.6 pp')).toBeInTheDocument();
        expect(screen.getByText('-5%')).toBeInTheDocument();
        expect(screen.getByText('agent_01')).toBeInTheDocument();
        expect(screen.getByText('Missing tool calculator')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 4. CaseHistoryDrawer
  // =========================================================================
  describe('4. CaseHistoryDrawer', () => {
    it('renders scenario execution timeline, assertion report, and runtime correlation', async () => {
      const mockHistoryResult: EvaluationCaseResult = {
        id: 'res-h1',
        runId: 'run-002',
        caseId: 'agent_01',
        dimension: 'agent',
        status: 'passed',
        score: 100,
        expected: {},
        actual: {},
        regression: false,
        durationMs: 45,
        tokens: 120,
        createdAt: '2026-10-04T06:00:00Z',
        assertionReport: {
          caseId: 'agent_01',
          dimension: 'agent',
          passedCount: 2,
          totalCount: 2,
          assertions: [
            {
              type: 'required_tool',
              expected: 'calculator',
              observed: 'calculator',
              status: 'passed',
            },
            {
              type: 'final_status',
              expected: 'success',
              observed: 'success',
              status: 'passed',
            },
          ],
        },
        runtimeCorrelation: {
          agentRunId: 'ar_test_123',
          toolCallId: 'tc_test_456',
          hasCorrelation: true,
        },
      };

      (adminApi.getEvaluationCaseHistory as jest.Mock).mockResolvedValue({
        data: {
          case: {
            id: 'agent_01',
            name: 'Agent Calculator Verification',
            category: 'agent',
            input: 'Calculate 25 * 4',
            expected: {},
          },
          history: [mockHistoryResult],
        },
      });

      renderWithProviders(
        <CaseHistoryDrawer isOpen={true} onClose={jest.fn()} caseId="agent_01" />
      );

      await waitFor(() => {
        expect(screen.getByText('Agent Calculator Verification')).toBeInTheDocument();
        expect(screen.getByText('2 / 2 Passed')).toBeInTheDocument();
        expect(screen.getByText('required tool')).toBeInTheDocument();
        expect(screen.getByText('Inspect Agent Run')).toBeInTheDocument();
        expect(screen.getByText('Inspect Tool Telemetry')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 5. RunDetailDrawer Assertion-Level Diagnostics
  // =========================================================================
  describe('5. RunDetailDrawer Assertion Diagnostics', () => {
    it('renders assertion report badge and expands individual assertions table', async () => {
      const mockResult: EvaluationCaseResult = {
        id: 'res-d1',
        runId: 'run-001',
        caseId: 'agent_01',
        dimension: 'agent',
        status: 'passed',
        score: 100,
        expected: {},
        actual: {},
        regression: false,
        durationMs: 30,
        tokens: 80,
        createdAt: '2026-10-04T05:00:00Z',
        assertionReport: {
          caseId: 'agent_01',
          dimension: 'agent',
          passedCount: 3,
          totalCount: 3,
          assertions: [
            {
              type: 'strategy',
              expected: 'tool_call',
              observed: 'tool_call',
              status: 'passed',
            },
          ],
        },
        runtimeCorrelation: {
          hasCorrelation: false,
        },
      };

      (adminApi.getEvaluationRunResults as jest.Mock).mockResolvedValue({
        data: [mockResult],
      });

      renderWithProviders(
        <RunDetailDrawer isOpen={true} onClose={jest.fn()} run={mockRuns[0]} />
      );

      await waitFor(() => {
        expect(screen.getByText('3 / 3 assertions')).toBeInTheDocument();
      });

      // Click toggle button to open assertions table
      const toggleBtn = screen.getByLabelText('Toggle assertion details');
      fireEvent.click(toggleBtn);

      expect(screen.getByText('strategy')).toBeInTheDocument();
      expect(screen.getByText(/No runtime correlation available/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 6. EvaluationPage Tabbed Integration
  // =========================================================================
  describe('6. EvaluationPage Tabbed Navigation', () => {
    it('renders Failure Patterns tab and Compare Runs trigger', async () => {
      renderWithProviders(<EvaluationPage />);

      await waitFor(() => {
        expect(screen.getByText(/Failure Patterns & Taxonomy/i)).toBeInTheDocument();
        expect(screen.getByText(/Compare Runs/i)).toBeInTheDocument();
      });

      // Switch to Failures tab
      fireEvent.click(screen.getByText(/Failure Patterns & Taxonomy/i));

      await waitFor(() => {
        expect(screen.getByText(/Deterministic Failure Taxonomy/i)).toBeInTheDocument();
      });
    });
  });
});
