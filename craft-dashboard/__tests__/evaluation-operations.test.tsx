import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { adminApi } from '@/lib/api/admin-client';
import { EvaluationOverviewKpis } from '@/components/evaluation/evaluation-overview-kpis';
import { QualityGateModal } from '@/components/evaluation/quality-gate-modal';
import { RunEvaluationModal } from '@/components/evaluation/run-evaluation-modal';
import { EvaluationRunsTable } from '@/components/evaluation/evaluation-runs-table';
import {
  EvaluationOverviewData,
  EvaluationRunItem,
  QualityGateEvaluationResult,
  QualityReleaseSnapshot,
} from '@/types/admin';

jest.mock('@/lib/api/admin-client', () => ({
  adminApi: {
    getEvaluationOverview: jest.fn(),
    getEvaluationCases: jest.fn(),
    getEvaluationRuns: jest.fn(),
    getEvaluationRegressions: jest.fn(),
    triggerEvaluationRun: jest.fn(),
    cancelEvaluationRun: jest.fn(),
    getEvaluationRunProgress: jest.fn(),
    getEvaluationQualityGate: jest.fn(),
    getEvaluationQualitySnapshot: jest.fn(),
    getEvaluationDatasetMetadata: jest.fn(),
  },
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{ui}</LanguageProvider>
    </QueryClientProvider>
  );
}

const mockRuns: EvaluationRunItem[] = [
  {
    id: 'run-active-1',
    datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
    mode: 'mock',
    status: 'running',
    totalCases: 56,
    passed: 20,
    failed: 2,
    passRate: 90.9,
    passedCases: 20,
    failedCases: 2,
    overallScore: 90.9,
    regressionCount: 0,
    durationMs: 1200,
    startedAt: '2026-10-04T07:00:00Z',
    completedAt: null,
    createdBy: 'admin',
  },
  {
    id: 'run-done-1',
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
    durationMs: 450,
    startedAt: '2026-10-04T06:00:00Z',
    completedAt: '2026-10-04T06:00:01Z',
    createdBy: 'admin',
  },
  {
    id: 'run-fail-1',
    datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
    mode: 'replay',
    status: 'failed',
    totalCases: 56,
    passed: 40,
    failed: 16,
    passRate: 71.4,
    passedCases: 40,
    failedCases: 16,
    overallScore: 71.4,
    regressionCount: 3,
    durationMs: 900,
    startedAt: '2026-10-04T05:00:00Z',
    completedAt: '2026-10-04T05:00:02Z',
    createdBy: 'admin',
  },
];

describe('Phase 12.4: Evaluation Operations & Continuous Quality Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Operational Signals Strip in EvaluationOverviewKPIs', () => {
    it('renders operational signals when data is present', () => {
      const mockOverview: EvaluationOverviewData = {
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
        lastEvaluationRun: 'run-done-1',
        historicalRunsCount: 3,
        activeRegressionsCount: 0,
        overallScore: 98.2,
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        operationalSignals: {
          lastEvaluation: {
            id: 'run-done-1',
            status: 'completed',
            overallScore: 100,
            mode: 'mock',
            datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
            createdAt: '2026-10-04T06:00:00Z',
          },
          lastSuccessfulEvaluation: {
            id: 'run-done-1',
            overallScore: 100,
            passedCases: 56,
            totalCases: 56,
            completedAt: '2026-10-04T06:00:01Z',
          },
          lastFailedEvaluation: {
            id: 'run-fail-1',
            overallScore: 71.4,
            failedCases: 16,
            totalCases: 56,
            createdAt: '2026-10-04T05:00:00Z',
          },
          lastRegression: {
            id: 'reg-01',
            caseId: 'conv_04',
            runId: 'run-fail-1',
            dimension: 'conversation',
            failureReason: 'Conversation depth assertion violation',
            createdAt: '2026-10-04T05:00:00Z',
          },
        },
      };

      renderWithProviders(<EvaluationOverviewKpis data={mockOverview} />);

      expect(screen.getByText('Operational Signals')).toBeInTheDocument();
      expect(screen.getByText('Last Evaluation')).toBeInTheDocument();
      expect(screen.getByText('Last Successful Evaluation')).toBeInTheDocument();
      expect(screen.getByText('Last Failed Evaluation')).toBeInTheDocument();
      expect(screen.getByText('Last Regression')).toBeInTheDocument();

      // Values
      expect(screen.getByText('16 failed')).toBeInTheDocument();
      expect(screen.getByText('conv_04')).toBeInTheDocument();
    });

    it('renders "Not available" fallback when operational signals are empty', () => {
      const mockOverview: EvaluationOverviewData = {
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
        lastEvaluationRun: null,
        historicalRunsCount: 0,
        activeRegressionsCount: 0,
        overallScore: 100,
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        operationalSignals: {
          lastEvaluation: null,
          lastSuccessfulEvaluation: null,
          lastFailedEvaluation: null,
          lastRegression: null,
        },
      };

      renderWithProviders(<EvaluationOverviewKpis data={mockOverview} />);

      const notAvailableBadges = screen.getAllByText('Not available');
      expect(notAvailableBadges.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('2. QualityGateModal Criteria & Sanitized Snapshot', () => {
    it('renders passed quality gate with checklist and handles copy snapshot', async () => {
      const mockGate: QualityGateEvaluationResult = {
        runId: 'run-done-1',
        status: 'passed',
        policyConfigured: true,
        policy: { minimumPassRate: 95, maximumRegressions: 0 },
        checks: [
          {
            criterion: 'minimum_pass_rate',
            label: 'Minimum Pass Rate',
            threshold: '>= 95%',
            actual: '100%',
            passed: true,
            message: 'Pass rate conforms to policy threshold',
          },
          {
            criterion: 'maximum_regressions',
            label: 'Maximum Allowed Regressions',
            threshold: '<= 0',
            actual: '0',
            passed: true,
            message: 'Zero regressions detected',
          },
        ],
        failureReasons: [],
        evaluatedAt: '2026-10-04T07:15:00Z',
      };

      const mockSnapshot: QualityReleaseSnapshot = {
        runId: 'run-done-1',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 56,
        passedCases: 56,
        failedCases: 0,
        passRate: 100,
        overallScore: 100,
        regressionCount: 0,
        durationMs: 450,
        completedAt: '2026-10-04T06:00:01Z',
        createdBy: 'admin',
        dimensionScores: {
          memory: { total: 8, passed: 8, passRate: 100, avgScore: 100 },
          conversation: { total: 8, passed: 8, passRate: 100, avgScore: 100 },
          personalization: { total: 8, passed: 8, passRate: 100, avgScore: 100 },
          adaptive_response: { total: 8, passed: 8, passRate: 100, avgScore: 100 },
          agent: { total: 8, passed: 8, passRate: 100, avgScore: 100 },
          provider: { total: 8, passed: 8, passRate: 100, avgScore: 100 },
          proactive: { total: 8, passed: 8, passRate: 100, avgScore: 100 },
        },
        qualityGate: mockGate,
        snapshotGeneratedAt: '2026-10-04T07:15:00Z',
      };

      (adminApi.getEvaluationQualityGate as jest.Mock).mockResolvedValue({
        success: true,
        data: mockGate,
      });
      (adminApi.getEvaluationQualitySnapshot as jest.Mock).mockResolvedValue({
        success: true,
        data: mockSnapshot,
      });

      // Mock clipboard
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockImplementation(() => Promise.resolve()),
        },
      });

      renderWithProviders(
        <QualityGateModal isOpen={true} onClose={jest.fn()} run={mockRuns[1]} />
      );

      await waitFor(() => {
        expect(screen.getByText('Quality Gate & Release Decision')).toBeInTheDocument();
        expect(screen.getByText('Minimum Pass Rate')).toBeInTheDocument();
        expect(screen.getByText('Maximum Allowed Regressions')).toBeInTheDocument();
      });

      // Copy Snapshot button test
      const copyBtn = screen.getByText('Copy Snapshot JSON');
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          expect.stringContaining('"runId": "run-done-1"')
        );
      });
    });

    it('renders failed quality gate with failure violations', async () => {
      const mockFailedGate: QualityGateEvaluationResult = {
        runId: 'run-fail-1',
        status: 'failed',
        policyConfigured: true,
        policy: { minimumPassRate: 95, maximumRegressions: 0 },
        checks: [
          {
            criterion: 'minimum_pass_rate',
            label: 'Minimum Pass Rate',
            threshold: '>= 95%',
            actual: '71.4%',
            passed: false,
            message: 'Pass rate 71.4% violates required threshold of 95%',
          },
          {
            criterion: 'maximum_regressions',
            label: 'Maximum Allowed Regressions',
            threshold: '<= 0',
            actual: '3',
            passed: false,
            message: 'Active regressions count 3 exceeds ceiling of 0',
          },
        ],
        failureReasons: [
          'Pass rate 71.4% violates required threshold of 95%',
          'Active regressions count 3 exceeds ceiling of 0',
        ],
        evaluatedAt: '2026-10-04T07:15:00Z',
      };

      (adminApi.getEvaluationQualityGate as jest.Mock).mockResolvedValue({
        success: true,
        data: mockFailedGate,
      });
      (adminApi.getEvaluationQualitySnapshot as jest.Mock).mockResolvedValue({
        success: true,
        data: null,
      });

      renderWithProviders(
        <QualityGateModal isOpen={true} onClose={jest.fn()} run={mockRuns[2]} />
      );

      await waitFor(() => {
        expect(screen.getByText('Failure Violations:')).toBeInTheDocument();
        expect(
          screen.getByText('Pass rate 71.4% violates required threshold of 95%')
        ).toBeInTheDocument();
        expect(
          screen.getByText('Active regressions count 3 exceeds ceiling of 0')
        ).toBeInTheDocument();
      });
    });
  });

  describe('3. RunEvaluationModal Scope Selection & Concurrency Ceiling', () => {
    it('supports selecting scope and setting concurrency before triggering', async () => {
      (adminApi.triggerEvaluationRun as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          runId: 'run-custom-001',
          status: 'completed',
          totalCases: 2,
          passedCases: 2,
          failedCases: 0,
          passRate: 100,
          overallScore: 100,
          regressionCount: 0,
          durationMs: 120,
          deduplicated: false,
        },
      });

      const handleSuccess = jest.fn();
      const handleClose = jest.fn();

      renderWithProviders(
        <RunEvaluationModal
          isOpen={true}
          onClose={handleClose}
          onSuccess={handleSuccess}
          role="admin"
        />
      );

      expect(screen.getByText('Case Selection Scope')).toBeInTheDocument();

      // Click Selected Cases
      const customScopeBtn = screen.getByText('Selected Cases');
      fireEvent.click(customScopeBtn);

      // Enter case IDs
      const input = screen.getByPlaceholderText(
        'e.g. mem_01, mem_02, conv_01 (subset of Golden Dataset)'
      );
      fireEvent.change(input, { target: { value: 'mem_01, mem_02' } });

      // Change concurrency to 4
      const workerBtn = screen.getByText('4');
      fireEvent.click(workerBtn);

      // Submit
      const submitBtn = screen.getByText('Start Evaluation Run');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(adminApi.triggerEvaluationRun).toHaveBeenCalledWith({
          mode: 'mock',
          category: undefined,
          caseIds: ['mem_01', 'mem_02'],
          concurrency: 4,
        });
        expect(handleSuccess).toHaveBeenCalled();
        expect(handleClose).toHaveBeenCalled();
      });
    });

    it('blocks execution when role is viewer', () => {
      renderWithProviders(
        <RunEvaluationModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
          role="viewer"
        />
      );

      expect(
        screen.getByText(/lacks execution permission/)
      ).toBeInTheDocument();

      const submitBtn = screen.getByRole('button', { name: /Start Evaluation Run/i });
      expect(submitBtn).toBeDisabled();
    });
  });

  describe('4. EvaluationRunsTable Actions & Real-Time Progress', () => {
    it('shows progress for running runs and allows cancelling active run', async () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);

      (adminApi.cancelEvaluationRun as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          runId: 'run-active-1',
          status: 'cancelled',
          cancelledAt: '2026-10-04T07:05:00Z',
          message: 'Evaluation run cancelled by admin',
        },
      });

      renderWithProviders(
        <EvaluationRunsTable runs={mockRuns} isLoading={false} />
      );

      // Check progress fraction for running run
      expect(screen.getByText('22/56')).toBeInTheDocument();

      // Cancel button should be present for running run
      const cancelBtn = screen.getByTitle('Cancel Run');
      expect(cancelBtn).toBeInTheDocument();

      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(adminApi.cancelEvaluationRun).toHaveBeenCalledWith('run-active-1');
      });
    });

    it('filters runs by status', () => {
      renderWithProviders(
        <EvaluationRunsTable runs={mockRuns} isLoading={false} />
      );

      const statusSelect = screen.getByDisplayValue('All Statuses');
      fireEvent.change(statusSelect, { target: { value: 'completed' } });

      expect(screen.getByText('1 / 3')).toBeInTheDocument();
      expect(screen.queryByText(/run-active/)).not.toBeInTheDocument();
      expect(screen.getByText(/run-done/)).toBeInTheDocument();
    });

    it('filters runs by mode', () => {
      renderWithProviders(
        <EvaluationRunsTable runs={mockRuns} isLoading={false} />
      );

      const modeSelect = screen.getByDisplayValue('All Modes');
      fireEvent.change(modeSelect, { target: { value: 'replay' } });

      expect(screen.getByText('1 / 3')).toBeInTheDocument();
      expect(screen.getByText(/run-fail/)).toBeInTheDocument();
    });
  });
});
