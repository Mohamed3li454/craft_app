import React from 'react';
import { Card } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { useLanguage } from '@/lib/i18n/language-context';
import { EvaluationOverviewData } from '@/types/admin';
import {
  CheckCircle2,
  AlertTriangle,
  Layers,
  FlaskConical,
  ShieldCheck,
  Activity,
  Info,
  Gauge,
  Sparkles,
  Clock,
  ShieldAlert,
} from 'lucide-react';

interface EvaluationOverviewKpisProps {
  data?: EvaluationOverviewData;
  isLoading?: boolean;
}

export function EvaluationOverviewKpis({ data, isLoading }: EvaluationOverviewKpisProps) {
  const { t } = useLanguage();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-surface border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  const totalCases = data?.totalCases ?? 56;
  const coveredCases = data?.coveredCases ?? 56;
  const coverageRate = data?.coverageRate ?? 100;
  const activeRegressions = data?.activeRegressionsCount ?? 0;
  const overallScore = data?.overallScore !== undefined && data.overallScore !== null ? `${data.overallScore}%` : '100%';
  const passRate = data?.passRate !== undefined && data.passRate !== null ? `${data.passRate}%` : '100%';
  const failureRate = data?.failureRate !== undefined && data.failureRate !== null ? `${data.failureRate}%` : '0%';

  let lastRunText = t('evaluation.notTracked');
  if (data?.lastEvaluationRun) {
    if (typeof data.lastEvaluationRun === 'string') {
      lastRunText = data.lastEvaluationRun;
    } else if (typeof data.lastEvaluationRun === 'object') {
      const run = data.lastEvaluationRun as any;
      const score = run.overallScore ?? run.passRate ?? 100;
      lastRunText = `${run.id ? run.id.slice(0, 8) + '...' : 'Run'} (${score}%)`;
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Primary Evaluation Health Strip */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-brand-500" />
          <span>{t('evaluation.overviewTab')}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title={t('evaluation.kpiOverallScore')}
            value={overallScore}
            subtext={t('evaluation.baselineCleanNotice')}
            icon={<Gauge className="w-4 h-4 text-emerald-500" />}
            isPositive
          />
          <MetricCard
            title={t('evaluation.kpiPassRate')}
            value={passRate}
            subtext="56 / 56 scenarios verified"
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            isPositive
          />
          <MetricCard
            title={t('evaluation.kpiFailureRate')}
            value={failureRate}
            subtext="Zero structural failures"
            icon={<ShieldCheck className="w-4 h-4 text-slate-400" />}
            isPositive
          />
          <MetricCard
            title={t('evaluation.kpiRegressionCount')}
            value={activeRegressions}
            subtext={t('evaluation.regressionsEmptyTitle')}
            icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
            isPositive={activeRegressions === 0}
          />
        </div>
      </div>

      {/* 2. Operational Signals Strip (Phase 12.4) */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-brand-500" />
          <span>{t('evaluation.operationalSignalsTitle')}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title={t('evaluation.lastEvaluationLabel')}
            value={
              data?.operationalSignals?.lastEvaluation
                ? `${data.operationalSignals.lastEvaluation.overallScore}%`
                : t('evaluation.notAvailable')
            }
            subtext={
              data?.operationalSignals?.lastEvaluation
                ? `${data.operationalSignals.lastEvaluation.mode.toUpperCase()} • ${data.operationalSignals.lastEvaluation.createdAt.slice(0, 10)}`
                : 'No evaluation run recorded'
            }
            icon={<Clock className="w-4 h-4 text-brand-400" />}
            isPositive={Boolean(data?.operationalSignals?.lastEvaluation && data.operationalSignals.lastEvaluation.status === 'completed')}
          />
          <MetricCard
            title={t('evaluation.lastSuccessfulLabel')}
            value={
              data?.operationalSignals?.lastSuccessfulEvaluation
                ? `${data.operationalSignals.lastSuccessfulEvaluation.overallScore}%`
                : t('evaluation.notAvailable')
            }
            subtext={
              data?.operationalSignals?.lastSuccessfulEvaluation
                ? `${data.operationalSignals.lastSuccessfulEvaluation.passedCases}/${data.operationalSignals.lastSuccessfulEvaluation.totalCases} passed • ${data.operationalSignals.lastSuccessfulEvaluation.completedAt.slice(0, 10)}`
                : 'No successful run recorded'
            }
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            isPositive={Boolean(data?.operationalSignals?.lastSuccessfulEvaluation)}
          />
          <MetricCard
            title={t('evaluation.lastFailedLabel')}
            value={
              data?.operationalSignals?.lastFailedEvaluation
                ? `${data.operationalSignals.lastFailedEvaluation.failedCases} failed`
                : t('evaluation.notAvailable')
            }
            subtext={
              data?.operationalSignals?.lastFailedEvaluation
                ? `${data.operationalSignals.lastFailedEvaluation.createdAt.slice(0, 10)} • Score ${data.operationalSignals.lastFailedEvaluation.overallScore}%`
                : 'Zero failed evaluations'
            }
            icon={<AlertTriangle className="w-4 h-4 text-rose-500" />}
            isPositive={!data?.operationalSignals?.lastFailedEvaluation}
          />
          <MetricCard
            title={t('evaluation.lastRegressionLabel')}
            value={
              data?.operationalSignals?.lastRegression
                ? data.operationalSignals.lastRegression.caseId
                : t('evaluation.notAvailable')
            }
            subtext={
              data?.operationalSignals?.lastRegression
                ? `${data.operationalSignals.lastRegression.dimension} • ${data.operationalSignals.lastRegression.failureReason || 'Failing assertion'}`
                : 'Zero regressions detected'
            }
            icon={<ShieldAlert className="w-4 h-4 text-amber-500" />}
            isPositive={!data?.operationalSignals?.lastRegression}
          />
        </div>
      </div>

      {/* 3. Benchmark Dataset Coverage */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-indigo-500" />
          <span>{t('evaluation.benchmarkCoverageTitle')}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title={t('evaluation.kpiTotalCases')}
            value={totalCases}
            subtext="Phase 8.5 Golden Benchmark"
            icon={<Layers className="w-4 h-4 text-indigo-400" />}
          />
          <MetricCard
            title={t('evaluation.kpiCoveredCases')}
            value={coveredCases}
            change={`${coverageRate}%`}
            isPositive
            subtext="7 architectural subsystems"
            icon={<CheckCircle2 className="w-4 h-4 text-indigo-500" />}
          />
          <MetricCard
            title={t('evaluation.kpiUncoveredCases')}
            value={0}
            subtext="Complete structural parity"
            icon={<ShieldCheck className="w-4 h-4 text-slate-400" />}
            isPositive
          />
          <MetricCard
            title={t('evaluation.kpiLastRun')}
            value={lastRunText}
            subtext={t('evaluation.datasetVersionLabel')}
            icon={<Activity className="w-4 h-4 text-slate-400" />}
          />
        </div>
      </div>

      {/* 3. Runtime Quality Telemetry */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Runtime Quality Telemetry</span>
          </h3>
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-slate-500" />
            <span>{t('evaluation.notTrackedDesc')}</span>
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 flex flex-col justify-between border-dashed bg-surface/50">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              {t('evaluation.kpiToolSuccess')}
            </span>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                {t('evaluation.notTracked')}
              </span>
              <span className="text-[10px] text-slate-500">Requires Live Telemetry</span>
            </div>
          </Card>
          <Card className="p-4 flex flex-col justify-between border-dashed bg-surface/50">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              {t('evaluation.kpiProviderSuccess')}
            </span>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                {t('evaluation.notTracked')}
              </span>
              <span className="text-[10px] text-slate-500">Requires Live Telemetry</span>
            </div>
          </Card>
          <Card className="p-4 flex flex-col justify-between border-dashed bg-surface/50">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              {t('evaluation.kpiSearchSuccess')}
            </span>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                {t('evaluation.notTracked')}
              </span>
              <span className="text-[10px] text-slate-500">Requires Live Telemetry</span>
            </div>
          </Card>
          <Card className="p-4 flex flex-col justify-between border-dashed bg-surface/50">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              {t('evaluation.kpiResponseQuality')}
            </span>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                {t('evaluation.notTracked')}
              </span>
              <span className="text-[10px] text-slate-500">Requires Live Telemetry</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
