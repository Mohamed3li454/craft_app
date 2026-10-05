'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { EvaluationOverviewKpis } from '@/components/evaluation/evaluation-overview-kpis';
import { DimensionBreakdown } from '@/components/evaluation/dimension-breakdown';
import { EvaluationCaseExplorer } from '@/components/evaluation/evaluation-case-explorer';
import { EvaluationRunsTable } from '@/components/evaluation/evaluation-runs-table';
import { RegressionCenter } from '@/components/evaluation/regression-center';
import { FailurePatternsTable } from '@/components/evaluation/failure-patterns-table';
import { QualityTrendCard } from '@/components/evaluation/quality-trend-card';
import { ModelQualitySection } from '@/components/evaluation/model-quality-section';
import { ReleaseQualitySection } from '@/components/evaluation/release-quality-section';
import { CaseDetailDrawer } from '@/components/evaluation/case-detail-drawer';
import { RunDetailDrawer } from '@/components/evaluation/run-detail-drawer';
import { RunEvaluationModal } from '@/components/evaluation/run-evaluation-modal';
import { RunComparisonDialog } from '@/components/evaluation/run-comparison-dialog';
import { CaseHistoryDrawer } from '@/components/evaluation/case-history-drawer';
import {
  FlaskConical,
  Layers,
  FileCheck2,
  History,
  AlertOctagon,
  TrendingUp,
  Cpu,
  RefreshCw,
  Lock,
  Play,
  CheckCircle2,
  GitCompare,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  EvaluationCaseItem,
  EvaluationRunItem,
  EvaluationDimension,
} from '@/types/admin';

type TabType = 'cases' | 'dimensions' | 'runs' | 'failures' | 'regressions' | 'release-quality' | 'trend' | 'models';

function EvaluationContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabType) || 'cases';
  const { t, isRtl } = useLanguage();

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [selectedDimensionFilter, setSelectedDimensionFilter] = useState<EvaluationDimension | 'all'>('all');
  const [selectedCase, setSelectedCase] = useState<EvaluationCaseItem | null>(null);
  const [selectedRun, setSelectedRun] = useState<EvaluationRunItem | null>(null);
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [historyCaseId, setHistoryCaseId] = useState<string | null>(null);
  const [runSuccessBanner, setRunSuccessBanner] = useState<string | null>(null);

  // 1. Fetch Overview KPIs
  const {
    data: overviewResponse,
    isLoading: isOverviewLoading,
    error: overviewError,
    refetch: refetchOverview,
    isFetching: isFetchingOverview,
  } = useQuery({
    queryKey: ['evaluation-overview'],
    queryFn: () => adminApi.getEvaluationOverview(),
  });

  // 2. Fetch Golden Dataset Cases
  const {
    data: casesResponse,
    isLoading: isCasesLoading,
    error: casesError,
    refetch: refetchCases,
    isFetching: isFetchingCases,
  } = useQuery({
    queryKey: ['evaluation-cases', selectedDimensionFilter],
    queryFn: () =>
      adminApi.getEvaluationCases({
        category: selectedDimensionFilter === 'all' ? undefined : selectedDimensionFilter,
        limit: 100,
      }),
  });

  // 3. Fetch Historical Runs
  const {
    data: runsResponse,
    isLoading: isRunsLoading,
    error: runsError,
    refetch: refetchRuns,
    isFetching: isFetchingRuns,
  } = useQuery({
    queryKey: ['evaluation-runs'],
    queryFn: () => adminApi.getEvaluationRuns({ limit: 50 }),
  });

  // 4. Fetch Regressions
  const {
    data: regressionsResponse,
    isLoading: isRegressionsLoading,
    error: regressionsError,
    refetch: refetchRegressions,
    isFetching: isFetchingRegressions,
  } = useQuery({
    queryKey: ['evaluation-regressions'],
    queryFn: () => adminApi.getEvaluationRegressions({ limit: 50 }),
  });

  // 5. Fetch Quality Intelligence Overview
  const {
    data: qualityResponse,
    refetch: refetchQuality,
  } = useQuery({
    queryKey: ['evaluation-quality-overview'],
    queryFn: () => adminApi.getEvaluationQualityOverview(),
  });

  // 6. Fetch Failures Overview
  const {
    data: failuresResponse,
    isLoading: isFailuresLoading,
    refetch: refetchFailures,
  } = useQuery({
    queryKey: ['evaluation-failures-overview'],
    queryFn: () => adminApi.getEvaluationFailures({ limit: 50 }),
  });

  const overview = overviewResponse?.data;
  const casesList = casesResponse?.data || [];
  const runsList = runsResponse?.data || [];
  const regressionsList = regressionsResponse?.data || [];
  const qualityData = qualityResponse?.data;
  const failuresData = failuresResponse?.data;

  const isRefreshing =
    isFetchingOverview || isFetchingCases || isFetchingRuns || isFetchingRegressions;

  const handleRefreshAll = () => {
    refetchOverview();
    refetchCases();
    refetchRuns();
    refetchRegressions();
    refetchQuality();
    refetchFailures();
  };

  const handleRunSuccess = (data: any) => {
    handleRefreshAll();
    setActiveTab('runs');
    const run = data?.run;
    if (run) {
      setSelectedRun(run);
      const passed = run.passedCases ?? run.passed ?? 0;
      const total = run.totalCases ?? 0;
      const regs = run.regressionCount ?? 0;
      setRunSuccessBanner(
        `Evaluation run completed: ${passed}/${total} passed (${regs} regressions) in ${run.durationMs}ms`
      );
    }
  };

  const handleDimensionSelect = (dim: EvaluationDimension | 'all') => {
    setSelectedDimensionFilter(dim);
    if (dim !== 'all') {
      setActiveTab('cases');
    }
  };

  const tabs = [
    {
      id: 'cases' as TabType,
      label: t('evaluation.casesTab'),
      icon: FileCheck2,
      badge: overview?.totalCases || 56,
    },
    {
      id: 'dimensions' as TabType,
      label: t('evaluation.dimensionsTab'),
      icon: Layers,
      badge: overview?.dimensionsCount || (overview?.dimensionCoverage ? Object.keys(overview.dimensionCoverage).length : 7),
    },
    {
      id: 'runs' as TabType,
      label: t('evaluation.runsTab'),
      icon: History,
      badge: runsList.length,
    },
    {
      id: 'failures' as TabType,
      label: t('evaluation.failuresTab'),
      icon: ShieldAlert,
      badge: failuresData?.clusters?.length || 0,
      badgeVariant: (failuresData?.clusters?.length || 0) > 0 ? ('danger' as const) : ('neutral' as const),
    },
    {
      id: 'regressions' as TabType,
      label: t('evaluation.regressionsTab'),
      icon: AlertOctagon,
      badge: regressionsList.length,
      badgeVariant: regressionsList.length > 0 ? ('danger' as const) : ('neutral' as const),
    },
    {
      id: 'release-quality' as TabType,
      label: t('evaluation.releaseQualityTab'),
      icon: ShieldCheck,
    },
    {
      id: 'trend' as TabType,
      label: t('evaluation.trendTab'),
      icon: TrendingUp,
    },
    {
      id: 'models' as TabType,
      label: t('evaluation.modelsTab'),
      icon: Cpu,
    },
  ];

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <FlaskConical className="h-6 w-6 text-brand-500" aria-hidden="true" />
              {t('evaluation.title')}
            </h1>
            <Badge variant="neutral" className="font-mono text-xs border-brand-500/30 text-brand-600 dark:text-brand-400 bg-brand-500/10">
              {t('evaluation.datasetVersionLabel')}: {overview?.datasetVersion || 'Phase 8.5'}
            </Badge>
            <Badge variant="neutral" className="font-mono text-xs flex items-center gap-1">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t('evaluation.readOnlyNotice')}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 max-w-3xl">
            {t('evaluation.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {runsList.length >= 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCompareOpen(true)}
              className="flex items-center gap-1.5"
              aria-label={t('evaluation.btnCompareRuns')}
            >
              <GitCompare className="h-4 w-4 text-brand-400" aria-hidden="true" />
              <span>{t('evaluation.btnCompareRuns')}</span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsRunModalOpen(true)}
            className="flex items-center gap-1.5"
            aria-label={t('evaluation.runBenchmarkButton')}
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>{t('evaluation.runBenchmarkButton')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            className="flex items-center gap-1.5"
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} aria-hidden="true" />
            <span>{t('common.refresh')}</span>
          </Button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {runSuccessBanner && (
        <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="font-medium">{runSuccessBanner}</span>
          </div>
          <button
            onClick={() => setRunSuccessBanner(null)}
            className="text-slate-400 hover:text-slate-200 text-xs p-1"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Global Error Banner if any critical query failed */}
      {(overviewError || casesError || runsError || regressionsError) && (
        <ErrorAlert
          title={t('common.errorLoadingData')}
          error={overviewError || casesError || runsError || regressionsError}
          onRetry={handleRefreshAll}
        />
      )}

      {/* Key Health Metrics (Overview KPIs) */}
      <EvaluationOverviewKpis
        data={overview}
        isLoading={isOverviewLoading}
      />

      {/* Navigation Tabs */}
      <div className="border-b border-border">
        <nav className="flex space-x-2 rtl:space-x-reverse overflow-x-auto pb-px" aria-label="Evaluation Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 py-2.5 px-3.5 border-b-2 font-medium text-xs whitespace-nowrap transition-colors focus:outline-none',
                  isActive
                    ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300'
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <Badge
                    variant={tab.badgeVariant || (isActive ? 'info' : 'neutral')}
                    className="ms-1 px-1.5 py-0.2 text-[10px] font-mono"
                  >
                    {tab.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Panels */}
      <div className="space-y-6">
        {activeTab === 'cases' && (
          <EvaluationCaseExplorer
            cases={casesList}
            isLoading={isCasesLoading}
            selectedDimension={selectedDimensionFilter}
            onSelectDimension={(dim) => setSelectedDimensionFilter(dim)}
            onSelectCase={(caseItem) => setSelectedCase(caseItem)}
          />
        )}

        {activeTab === 'dimensions' && (
          <DimensionBreakdown
            overview={overview}
            healthMap={qualityData?.dimensionHealth}
            selectedDimension={selectedDimensionFilter}
            onSelectDimension={handleDimensionSelect}
          />
        )}

        {activeTab === 'runs' && (
          <EvaluationRunsTable
            runs={runsList}
            isLoading={isRunsLoading}
            onSelectRun={(run) => setSelectedRun(run)}
          />
        )}

        {activeTab === 'failures' && (
          <FailurePatternsTable
            clusters={failuresData?.clusters || []}
            taxonomyCounts={failuresData?.taxonomyCounts || {}}
            totalFailures={failuresData?.totalFailures || 0}
            totalEvaluated={failuresData?.totalEvaluatedCases || 56}
            isLoading={isFailuresLoading}
            onSelectCase={(caseId) => setHistoryCaseId(caseId)}
          />
        )}

        {activeTab === 'regressions' && (
          <RegressionCenter
            regressions={regressionsList}
            isLoading={isRegressionsLoading}
            onSelectCaseId={(caseId) => {
              const matched = casesList.find((c) => c.id === caseId);
              if (matched) setSelectedCase(matched);
            }}
          />
        )}

        {activeTab === 'release-quality' && (
          <ReleaseQualitySection onTriggerRun={() => setIsRunModalOpen(true)} />
        )}

        {activeTab === 'trend' && (
          <QualityTrendCard
            runs={runsList}
            hasHistoricalData={runsList.length > 0}
          />
        )}

        {activeTab === 'models' && (
          <ModelQualitySection />
        )}
      </div>

      {/* Case Detail Drawer */}
      <CaseDetailDrawer
        isOpen={Boolean(selectedCase)}
        onClose={() => setSelectedCase(null)}
        caseItem={selectedCase}
      />

      {/* Case History Drawer */}
      <CaseHistoryDrawer
        isOpen={Boolean(historyCaseId)}
        onClose={() => setHistoryCaseId(null)}
        caseId={historyCaseId}
      />

      {/* Run Detail Drawer */}
      <RunDetailDrawer
        isOpen={Boolean(selectedRun)}
        onClose={() => setSelectedRun(null)}
        run={selectedRun}
      />

      {/* Run Evaluation Modal */}
      <RunEvaluationModal
        isOpen={isRunModalOpen}
        onClose={() => setIsRunModalOpen(false)}
        onSuccess={handleRunSuccess}
      />

      {/* Run Comparison Dialog */}
      <RunComparisonDialog
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        availableRuns={runsList}
      />
    </div>
  );
}

function EvaluationSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function EvaluationPage() {
  return (
    <Suspense fallback={<EvaluationSkeleton />}>
      <EvaluationContent />
    </Suspense>
  );
}
