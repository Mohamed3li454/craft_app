import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { adminApi } from '@/lib/api/admin-client';
import { ReleaseQualitySection } from '@/components/evaluation/release-quality-section';
import { ReleaseQualityDrawer } from '@/components/evaluation/release-quality-drawer';
import { RunComparisonDialog } from '@/components/evaluation/run-comparison-dialog';
import { ReleaseQualitySignal, RunComparisonResult } from '@/types/admin';

jest.mock('@/lib/api/admin-client', () => ({
  adminApi: {
    getEvaluationReleaseQualityHistory: jest.fn(),
    getEvaluationRunReleaseQuality: jest.fn(),
    compareEvaluationRuns: jest.fn(),
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

const mockApprovedSignal: ReleaseQualitySignal = {
  runId: 'run-approved-1',
  datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
  datasetProvenance: {
    datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
    caseCount: 56,
    dimensionsCount: 7,
    source: 'source-controlled',
  },
  releaseMetadata: {
    commitSha: '6f8a92bcde123',
    deploymentId: 'dpl_prod_123',
    deploymentVersion: '2.1.0',
    environment: 'production',
    branch: 'main',
    buildId: 'b-990',
  },
  qualityGate: {
    runId: 'run-approved-1',
    status: 'passed',
    policyConfigured: true,
    policy: { minimumPassRate: 95, minimumScore: 90 },
    checks: [
      {
        criterion: 'minimum_pass_rate',
        label: 'Minimum Pass Rate',
        threshold: '95%',
        actual: '100%',
        passed: true,
        message: 'Pass rate meets threshold.',
      },
    ],
    failureReasons: [],
    evaluatedAt: '2026-10-04T05:00:00Z',
  },
  qualityDecision: 'approved',
  metrics: {
    status: 'completed',
    mode: 'mock',
    totalCases: 56,
    passedCases: 56,
    failedCases: 0,
    passRate: 100,
    overallScore: 100,
    regressionCount: 0,
    durationMs: 4500,
    startedAt: '2026-10-04T05:00:00Z',
    completedAt: '2026-10-04T05:00:04Z',
  },
  generatedAt: '2026-10-04T05:00:05Z',
};

const mockRejectedSignal: ReleaseQualitySignal = {
  runId: 'run-rejected-2',
  datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
  datasetProvenance: {
    datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
    caseCount: 56,
    dimensionsCount: 7,
    source: 'source-controlled',
  },
  releaseMetadata: {
    commitSha: 'badc0de9999',
    deploymentId: 'dpl_staging_456',
    deploymentVersion: '2.2.0-rc1',
    environment: 'staging',
  },
  qualityGate: {
    runId: 'run-rejected-2',
    status: 'failed',
    policyConfigured: true,
    policy: { minimumPassRate: 95 },
    checks: [
      {
        criterion: 'minimum_pass_rate',
        label: 'Minimum Pass Rate',
        threshold: '95%',
        actual: '80%',
        passed: false,
        message: 'Pass rate below threshold.',
      },
    ],
    failureReasons: ['Pass rate 80% is below minimum threshold 95%.'],
    evaluatedAt: '2026-10-04T05:30:00Z',
  },
  qualityDecision: 'rejected',
  metrics: {
    status: 'completed',
    mode: 'mock',
    totalCases: 56,
    passedCases: 45,
    failedCases: 11,
    passRate: 80,
    overallScore: 80,
    regressionCount: 2,
    durationMs: 5000,
    startedAt: '2026-10-04T05:30:00Z',
    completedAt: '2026-10-04T05:30:05Z',
  },
  generatedAt: '2026-10-04T05:30:06Z',
};

describe('Phase 12.5 — Release Quality UI Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. ReleaseQualitySection', () => {
    it('renders active release signal banner with approved state and metrics', async () => {
      (adminApi.getEvaluationReleaseQualityHistory as jest.Mock).mockResolvedValue({
        success: true,
        data: [mockApprovedSignal],
      });

      renderWithProviders(<ReleaseQualitySection />);

      await waitFor(() => {
        expect(screen.getByText(/Release Quality Gate Approved/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/Commit 6f8a92b/i)).toBeInTheDocument();
      expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
      expect(screen.getByText('Source Controlled')).toBeInTheDocument();
    });

    it('renders rejected active release signal banner when gate fails', async () => {
      (adminApi.getEvaluationReleaseQualityHistory as jest.Mock).mockResolvedValue({
        success: true,
        data: [mockRejectedSignal],
      });

      renderWithProviders(<ReleaseQualitySection />);

      await waitFor(() => {
        expect(screen.getByText(/Quality Gate Breached/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/Commit badc0de/i)).toBeInTheDocument();
    });

    it('opens ReleaseQualityDrawer on clicking inspect icon in table', async () => {
      (adminApi.getEvaluationReleaseQualityHistory as jest.Mock).mockResolvedValue({
        success: true,
        data: [mockApprovedSignal],
      });

      renderWithProviders(<ReleaseQualitySection />);

      await waitFor(() => {
        expect(screen.getAllByText(/Inspect/i).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByText(/Inspect/i)[0]);

      expect(screen.getByText(/Release Quality Signal Details/i)).toBeInTheDocument();
      expect(screen.getAllByText(/6f8a92bcde123/i).length).toBeGreaterThan(0);
    });
  });

  describe('2. ReleaseQualityDrawer', () => {
    it('renders full provenance identity, checklist items, and JSON export', () => {
      const onClose = jest.fn();
      renderWithProviders(
        <ReleaseQualityDrawer signal={mockApprovedSignal} isOpen={true} onClose={onClose} />
      );

      expect(screen.getByText('Release Quality Signal Details')).toBeInTheDocument();
      expect(screen.getAllByText(/6f8a92bcde123/i).length).toBeGreaterThan(0);
      expect(screen.getByText('dpl_prod_123')).toBeInTheDocument();
      expect(screen.getByText('2.1.0')).toBeInTheDocument();
      expect(screen.getByText('Minimum Pass Rate')).toBeInTheDocument();
      expect(screen.getByText('Copy CI JSON')).toBeInTheDocument();

      const closeButtons = screen.getAllByRole('button', { name: /close/i });
      fireEvent.click(closeButtons[0]);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('3. RunComparisonDialog Dataset Version Safety & Provenance', () => {
    it('renders warning banner when dataset versions differ and shows release metadata', async () => {
      const mockComparison: RunComparisonResult = {
        runA: {
          id: 'run-v1',
          datasetVersion: 'Benchmark-v1.0',
          mode: 'mock',
          status: 'completed',
          totalCases: 10,
          passed: 10,
          failed: 0,
          passRate: 100,
          regressionCount: 0,
          durationMs: 1000,
          startedAt: '2026-10-04T01:00:00Z',
        },
        runB: {
          id: 'run-v2',
          datasetVersion: 'Benchmark-v2.0-Expanded',
          mode: 'mock',
          status: 'completed',
          totalCases: 20,
          passed: 18,
          failed: 2,
          passRate: 90,
          regressionCount: 0,
          durationMs: 2000,
          startedAt: '2026-10-04T02:00:00Z',
        },
        releaseA: {
          commitSha: 'aaaa1111',
          deploymentId: 'dpl-1',
          deploymentVersion: '1.0',
          environment: 'production',
        },
        releaseB: {
          commitSha: 'bbbb2222',
          deploymentId: 'dpl-2',
          deploymentVersion: '2.0',
          environment: 'staging',
        },
        comparisonType: 'informational',
        warning: 'Dataset versions differ; regression semantics are disabled.',
        metrics: {
          passRateDeltaPp: -10,
          averageScoreDelta: -10,
          failuresDelta: 2,
          regressionsDelta: 0,
          durationDeltaMs: 1000,
          tokensDelta: 500,
        },
        dimensionComparison: [],
        changedCases: [],
      };

      (adminApi.compareEvaluationRuns as jest.Mock).mockResolvedValue({
        success: true,
        data: mockComparison,
      });

      renderWithProviders(
        <RunComparisonDialog
          isOpen={true}
          onClose={jest.fn()}
          availableRuns={[mockComparison.runA, mockComparison.runB]}
          initialRunAId="run-v1"
          initialRunBId="run-v2"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Dataset versions differ; regression semantics are disabled./i)).toBeInTheDocument();
      });

      expect(screen.getByText('aaaa111')).toBeInTheDocument();
      expect(screen.getByText('bbbb222')).toBeInTheDocument();
    });
  });
});
