'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { ReleaseQualitySignal } from '@/types/admin';
import { useLanguage } from '@/lib/i18n/language-context';
import { Badge } from '@/components/ui/badge';
import {
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  GitCommit,
  Filter,
  RefreshCw,
  Eye,
  Database,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReleaseQualityDrawer } from './release-quality-drawer';

interface ReleaseQualitySectionProps {
  onTriggerRun?: () => void;
}

export function ReleaseQualitySection({ onTriggerRun }: ReleaseQualitySectionProps) {
  const { t, isRtl } = useLanguage();
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all');
  const [decisionFilter, setDecisionFilter] = useState<string>('all');
  const [selectedSignal, setSelectedSignal] = useState<ReleaseQualitySignal | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const { data: signalsResponse, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['evaluation-release-quality', environmentFilter, decisionFilter],
    queryFn: () =>
      adminApi.getEvaluationReleaseQualityHistory({
        environment: environmentFilter !== 'all' ? environmentFilter : undefined,
        decision: decisionFilter !== 'all' ? decisionFilter : undefined,
        limit: 50,
      }),
  });

  const signals: ReleaseQualitySignal[] = signalsResponse?.data || [];
  const latestSignal = signals[0] || null;

  const handleInspect = (signal: ReleaseQualitySignal) => {
    setSelectedSignal(signal);
    setIsDrawerOpen(true);
  };

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'approved':
        return (
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 gap-1.5 py-0.5 px-2 text-[11px] font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            {t('evaluation.releaseQuality.approved')}
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30 gap-1.5 py-0.5 px-2 text-[11px] font-semibold">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            {t('evaluation.releaseQuality.rejected')}
          </Badge>
        );
      default:
        return (
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 gap-1.5 py-0.5 px-2 text-[11px] font-semibold">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            {t('evaluation.releaseQuality.notConfigured')}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 1. Active Release Quality Signal Banner */}
      {latestSignal ? (
        <div
          className={cn(
            'p-5 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4',
            latestSignal.qualityDecision === 'approved'
              ? 'bg-emerald-950/20 border-emerald-500/30'
              : latestSignal.qualityDecision === 'rejected'
              ? 'bg-rose-950/20 border-rose-500/30'
              : 'bg-amber-950/20 border-amber-500/30'
          )}
        >
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'p-3 rounded-xl border shrink-0',
                latestSignal.qualityDecision === 'approved'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : latestSignal.qualityDecision === 'rejected'
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              )}
            >
              {latestSignal.qualityDecision === 'approved' ? (
                <ShieldCheck className="w-6 h-6" />
              ) : latestSignal.qualityDecision === 'rejected' ? (
                <ShieldAlert className="w-6 h-6" />
              ) : (
                <AlertCircle className="w-6 h-6" />
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-mono tracking-wider font-semibold text-slate-400">
                  {t('evaluation.releaseQuality.activeSignal')}
                </span>
                {getDecisionBadge(latestSignal.qualityDecision)}
              </div>
              <h3 className="text-base font-bold text-foreground">
                {latestSignal.qualityDecision === 'approved'
                  ? t('evaluation.releaseQuality.approvedHeadline')
                  : latestSignal.qualityDecision === 'rejected'
                  ? t('evaluation.releaseQuality.rejectedHeadline')
                  : t('evaluation.releaseQuality.notConfiguredHeadline')}
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                {latestSignal.releaseMetadata.commitSha
                  ? `Commit ${latestSignal.releaseMetadata.commitSha.slice(0, 7)}`
                  : 'Provenance: Not Tracked'}{' '}
                • {latestSignal.releaseMetadata.environment || 'Local/Test'} •{' '}
                {new Date(latestSignal.generatedAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="grid grid-cols-3 gap-3 text-center border-l border-border/50 pl-4 font-mono text-xs">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Pass Rate</span>
                <span className="font-bold text-foreground">{latestSignal.metrics.passRate}%</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Score</span>
                <span className="font-bold text-foreground">{latestSignal.metrics.overallScore}%</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Regressions</span>
                <span className={cn('font-bold', latestSignal.metrics.regressionCount > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                  {latestSignal.metrics.regressionCount}
                </span>
              </div>
            </div>

            <button
              onClick={() => handleInspect(latestSignal)}
              className="px-3.5 py-2 rounded-xl bg-surface-elevated hover:bg-surface border border-border text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors"
            >
              <Eye className="w-3.5 h-3.5 text-brand-400" />
              {t('evaluation.releaseQuality.inspect')}
            </button>
          </div>
        </div>
      ) : null}

      {/* 2. Dataset Provenance Metadata Card */}
      <div className="p-4 rounded-xl border border-border bg-surface/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-brand-400 shrink-0" />
          <div>
            <span className="font-semibold text-foreground">
              {t('evaluation.releaseQuality.datasetBaseline')}: Phase 8.5 Golden Benchmark Dataset
            </span>
            <span className="text-slate-400 block text-[11px]">
              56 immutable test scenarios • 7 architecture dimensions • Source-controlled
            </span>
          </div>
        </div>
        <Badge variant="neutral" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[11px] font-mono self-start sm:self-auto">
          Source Controlled
        </Badge>
      </div>

      {/* 3. Filter Controls & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-elevated/40 p-3 rounded-xl border border-border">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
            <Filter className="w-3.5 h-3.5" />
            <span>{t('common.filter')}:</span>
          </div>

          <select
            value={environmentFilter}
            onChange={(e) => setEnvironmentFilter(e.target.value)}
            className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
          >
            <option value="all">{t('evaluation.releaseQuality.allEnvironments')}</option>
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
            <option value="ci-pipeline">ci-pipeline</option>
          </select>

          <select
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value)}
            className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
          >
            <option value="all">{t('evaluation.releaseQuality.allDecisions')}</option>
            <option value="approved">{t('evaluation.releaseQuality.approved')}</option>
            <option value="rejected">{t('evaluation.releaseQuality.rejected')}</option>
            <option value="not_configured">{t('evaluation.releaseQuality.notConfigured')}</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg border border-border bg-surface text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
            title={t('common.refresh')}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* 4. Release Signals History Table */}
      <div className="border border-border rounded-xl overflow-hidden bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-surface-elevated/70 border-b border-border text-slate-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">{t('evaluation.releaseQuality.decision')}</th>
                <th className="py-3 px-4">{t('evaluation.releaseQuality.runAndDate')}</th>
                <th className="py-3 px-4">{t('evaluation.releaseQuality.commitSha')}</th>
                <th className="py-3 px-4">{t('evaluation.releaseQuality.environment')}</th>
                <th className="py-3 px-4">{t('evaluation.releaseQuality.passRate')}</th>
                <th className="py-3 px-4">{t('evaluation.releaseQuality.score')}</th>
                <th className="py-3 px-4">{t('evaluation.releaseQuality.regressions')}</th>
                <th className="py-3 px-4 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-brand-400" />
                      <span>{t('common.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : signals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                    <p className="mb-3">{t('evaluation.releaseQuality.noSignals')}</p>
                    {onTriggerRun && (
                      <button
                        onClick={onTriggerRun}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>{t('evaluation.runBenchmarkButton')}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                signals.map((sig) => (
                  <tr key={sig.runId} className="hover:bg-surface-elevated/40 transition-colors">
                    <td className="py-3 px-4">
                      {getDecisionBadge(sig.qualityDecision)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-foreground block">{sig.runId.slice(0, 8)}...</span>
                      <span className="text-[10px] text-slate-500">{new Date(sig.generatedAt).toLocaleString()}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <GitCommit className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-slate-300">
                          {sig.releaseMetadata.commitSha ? sig.releaseMetadata.commitSha.slice(0, 7) : 'Not Tracked'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="neutral" className="text-[10px] font-mono py-0 px-1.5">
                        {sig.releaseMetadata.environment || 'Not Tracked'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-bold text-foreground">
                      {sig.metrics.passRate}%
                    </td>
                    <td className="py-3 px-4 font-bold text-foreground">
                      {sig.metrics.overallScore}%
                    </td>
                    <td className="py-3 px-4">
                      <span className={cn('font-bold', sig.metrics.regressionCount > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                        {sig.metrics.regressionCount}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleInspect(sig)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
                        title={t('evaluation.releaseQuality.inspect')}
                      >
                        <Eye className="w-4 h-4 text-brand-400" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Signal Details Drawer */}
      <ReleaseQualityDrawer
        signal={selectedSignal}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedSignal(null);
        }}
      />
    </div>
  );
}
