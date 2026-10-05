'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { EvaluationRunItem } from '@/types/admin';
import { useLanguage } from '@/lib/i18n/language-context';
import { Badge } from '@/components/ui/badge';
import {
  X,
  GitCompare,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RunComparisonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  availableRuns: EvaluationRunItem[];
  initialRunAId?: string;
  initialRunBId?: string;
}

export function RunComparisonDialog({
  isOpen,
  onClose,
  availableRuns,
  initialRunAId,
  initialRunBId,
}: RunComparisonDialogProps) {
  const { t, isRtl } = useLanguage();

  const [runAId, setRunAId] = useState<string>(
    initialRunAId || (availableRuns[1]?.id ?? availableRuns[0]?.id ?? '')
  );
  const [runBId, setRunBId] = useState<string>(
    initialRunBId || (availableRuns[0]?.id ?? '')
  );
  const [changedCasesOnly, setChangedCasesOnly] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  useEffect(() => {
    if (initialRunAId) setRunAId(initialRunAId);
    if (initialRunBId) setRunBId(initialRunBId);
  }, [initialRunAId, initialRunBId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const { data: comparisonResponse, isLoading, isError } = useQuery({
    queryKey: ['evaluation-run-comparison', runAId, runBId, changedCasesOnly, categoryFilter],
    queryFn: () =>
      adminApi.compareEvaluationRuns(runAId, runBId, {
        changedCasesOnly,
        filterCategory: categoryFilter !== 'ALL' ? categoryFilter : undefined,
      }),
    enabled: Boolean(isOpen && runAId && runBId && runAId !== runBId),
  });

  if (!isOpen) return null;

  const comparison: any = comparisonResponse?.data;

  const formatDeltaPp = (val?: number) => {
    if (val === undefined || val === null) return '0.0 pp';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(1)} pp`;
  };

  const formatDelta = (val?: number, unit = '') => {
    if (val === undefined || val === null) return `0${unit}`;
    const sign = val > 0 ? '+' : '';
    return `${sign}${val}${unit}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-dialog-title"
      className="fixed inset-0 z-50 overflow-y-auto"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-4xl bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="p-5 border-b border-border bg-surface-elevated/50 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20">
                <GitCompare className="w-5 h-5" />
              </div>
              <div>
                <h2 id="compare-dialog-title" className="text-base font-bold text-foreground">
                  {t('evaluation.compareRunsTitle')}
                </h2>
                <p className="text-xs text-slate-400">
                  {t('evaluation.compareRunsSubtitle')}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Selectors Bar */}
          <div className="p-4 border-b border-border bg-surface/40 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-mono text-slate-400 uppercase block mb-1.5">
                {t('evaluation.selectBaseRun')}
              </label>
              <select
                value={runAId}
                onChange={(e) => setRunAId(e.target.value)}
                className="w-full text-xs font-mono bg-surface-elevated border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {availableRuns.map((r) => (
                  <option key={r.id} value={r.id} disabled={r.id === runBId}>
                    {r.id} ({r.mode || 'mock'}) — Score: {r.overallScore}% ({new Date(r.startedAt).toLocaleTimeString()})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-mono text-slate-400 uppercase block mb-1.5">
                {t('evaluation.selectTargetRun')}
              </label>
              <select
                value={runBId}
                onChange={(e) => setRunBId(e.target.value)}
                className="w-full text-xs font-mono bg-surface-elevated border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {availableRuns.map((r) => (
                  <option key={r.id} value={r.id} disabled={r.id === runAId}>
                    {r.id} ({r.mode || 'mock'}) — Score: {r.overallScore}% ({new Date(r.startedAt).toLocaleTimeString()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Content Area */}
          <div className="p-5 overflow-y-auto space-y-6">
            {runAId === runBId ? (
              <div className="p-8 text-center text-xs text-slate-400 border border-border rounded-xl">
                Please select two different evaluation runs to compare deltas.
              </div>
            ) : isLoading ? (
              <div className="h-64 rounded-xl bg-surface/30 animate-pulse border border-border" />
            ) : isError || !comparison ? (
              <div className="p-8 text-center text-xs text-rose-400 border border-rose-500/20 rounded-xl bg-rose-500/5">
                Failed to load evaluation run comparison. Ensure both runs exist and are completed.
              </div>
            ) : (
              <>
                {/* Dataset Version Warning Banner */}
                {comparison.warning && (
                  <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                    <div>
                      <p className="font-semibold">{comparison.warning}</p>
                      <p className="text-[11px] text-amber-300/80">
                        Comparing &quot;{comparison.runA.datasetVersion}&quot; vs &quot;{comparison.runB.datasetVersion}&quot;. Regression delta semantics require identical dataset versions.
                      </p>
                    </div>
                  </div>
                )}

                {/* Release Identity Provenance Bar */}
                {(comparison.releaseA || comparison.releaseB) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl border border-border bg-surface-elevated/20 text-xs font-mono">
                    <div className="flex flex-col gap-1 border-r border-border/50 pr-2">
                      <span className="text-[10px] text-slate-400 uppercase font-bold">Base Release (Run A)</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-semibold">{comparison.releaseA?.commitSha ? comparison.releaseA.commitSha.slice(0, 7) : 'Not Tracked'}</span>
                        {comparison.releaseA?.environment && (
                          <Badge variant="neutral" className="text-[10px] py-0 px-1.5 border-slate-700 bg-slate-800/60 text-slate-300">
                            {comparison.releaseA.environment}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 pl-2">
                      <span className="text-[10px] text-slate-400 uppercase font-bold">Target Release (Run B)</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-semibold">{comparison.releaseB?.commitSha ? comparison.releaseB.commitSha.slice(0, 7) : 'Not Tracked'}</span>
                        {comparison.releaseB?.environment && (
                          <Badge variant="neutral" className="text-[10px] py-0 px-1.5 border-slate-700 bg-slate-800/60 text-slate-300">
                            {comparison.releaseB.environment}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 1. Overall Metrics Delta Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-3 rounded-xl border border-border bg-surface-elevated/40">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                      {t('evaluation.passRateDelta')}
                    </span>
                    <span
                      className={cn(
                        'text-base font-bold font-mono',
                        comparison.metrics.passRateDeltaPp > 0
                          ? 'text-emerald-400'
                          : comparison.metrics.passRateDeltaPp < 0
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      )}
                    >
                      {formatDeltaPp(comparison.metrics.passRateDeltaPp)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl border border-border bg-surface-elevated/40">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                      {t('evaluation.scoreDelta')}
                    </span>
                    <span
                      className={cn(
                        'text-base font-bold font-mono',
                        comparison.metrics.averageScoreDelta > 0
                          ? 'text-emerald-400'
                          : comparison.metrics.averageScoreDelta < 0
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      )}
                    >
                      {formatDelta(comparison.metrics.averageScoreDelta, '%')}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl border border-border bg-surface-elevated/40">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                      {t('evaluation.failuresDelta')}
                    </span>
                    <span
                      className={cn(
                        'text-base font-bold font-mono',
                        comparison.metrics.failuresDelta < 0
                          ? 'text-emerald-400'
                          : comparison.metrics.failuresDelta > 0
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      )}
                    >
                      {formatDelta(comparison.metrics.failuresDelta)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl border border-border bg-surface-elevated/40">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                      {t('evaluation.regressionsDelta')}
                    </span>
                    <span
                      className={cn(
                        'text-base font-bold font-mono',
                        comparison.metrics.regressionsDelta < 0
                          ? 'text-emerald-400'
                          : comparison.metrics.regressionsDelta > 0
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      )}
                    >
                      {formatDelta(comparison.metrics.regressionsDelta)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl border border-border bg-surface-elevated/40">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                      {t('evaluation.durationDelta')}
                    </span>
                    <span className="text-base font-bold font-mono text-slate-300">
                      {formatDelta(comparison.metrics.durationDeltaMs, 'ms')}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl border border-border bg-surface-elevated/40">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                      {t('evaluation.tokensDelta')}
                    </span>
                    <span className="text-base font-bold font-mono text-slate-300">
                      {formatDelta(comparison.metrics.tokensDelta)}
                    </span>
                  </div>
                </div>

                {/* 2. Dimension Comparison Table */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Architectural Dimension Comparison
                  </h3>
                  <div className="rounded-xl border border-border overflow-hidden bg-surface-elevated/20">
                    <table className="w-full text-xs text-left rtl:text-right">
                      <thead className="bg-surface-elevated border-b border-border text-slate-400 uppercase font-mono text-[10px]">
                        <tr>
                          <th className="px-4 py-2.5">Dimension</th>
                          <th className="px-3 py-2.5">Run A Pass Rate</th>
                          <th className="px-3 py-2.5">Run B Pass Rate</th>
                          <th className="px-3 py-2.5">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {comparison.dimensionComparison.map((dim: any) => (
                          <tr key={dim.dimension} className="hover:bg-surface-elevated/40">
                            <td className="px-4 py-2 font-mono font-bold text-foreground uppercase text-[11px]">
                              {dim.dimension}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-300">
                              {dim.runAPassRate}%
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-300">
                              {dim.runBPassRate}%
                            </td>
                            <td className="px-3 py-2 font-mono font-bold">
                              <span
                                className={cn(
                                  dim.deltaPp > 0
                                    ? 'text-emerald-400'
                                    : dim.deltaPp < 0
                                    ? 'text-rose-400'
                                    : 'text-slate-400'
                                )}
                              >
                                {formatDeltaPp(dim.deltaPp)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 3. Changed Cases Diff (Phase 12.6 Filterable) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                      {t('evaluation.changedCasesTitle')} ({comparison.cases?.length ?? comparison.changedCases?.length ?? 0})
                    </h3>

                    <label className="flex items-center gap-2 text-xs font-mono text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={changedCasesOnly}
                        onChange={(e) => setChangedCasesOnly(e.target.checked)}
                        className="rounded border-border text-brand-500 focus:ring-brand-500 bg-surface-elevated"
                      />
                      <span>Changed Cases Only (Hide Unchanged)</span>
                    </label>
                  </div>

                  {/* Category Filter Pills */}
                  {comparison.summaryCounts && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {[
                        { id: 'ALL', label: 'All', count: comparison.summaryCounts.total },
                        { id: 'REGRESSED', label: 'Regressed', count: comparison.summaryCounts.regressed, color: 'text-rose-400' },
                        { id: 'NEW FAILURE', label: 'New Failure', count: comparison.summaryCounts.newFailures, color: 'text-rose-400' },
                        { id: 'RESOLVED', label: 'Resolved', count: comparison.summaryCounts.resolved, color: 'text-emerald-400' },
                        { id: 'IMPROVED', label: 'Improved', count: comparison.summaryCounts.improved, color: 'text-emerald-400' },
                        { id: 'UNCHANGED', label: 'Unchanged', count: comparison.summaryCounts.unchanged, color: 'text-slate-400' },
                      ].map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setCategoryFilter(cat.id)}
                          className={cn(
                            'px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors flex items-center gap-1.5',
                            categoryFilter === cat.id
                              ? 'bg-brand-500/15 border-brand-500/40 text-foreground font-bold'
                              : 'bg-surface border-border text-slate-400 hover:text-foreground'
                          )}
                        >
                          <span className={cat.color}>{cat.label}</span>
                          <span className="text-[10px] px-1 py-0.2 rounded bg-surface-elevated border border-border text-slate-400">
                            {cat.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {((comparison.cases?.length ?? comparison.changedCases?.length ?? 0) === 0) ? (
                    <div className="p-8 text-center rounded-xl border border-border bg-surface-elevated/20 text-xs text-slate-400 space-y-1">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                      <p className="font-medium text-foreground">
                        {t('evaluation.noChangedCases')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(comparison.cases || comparison.changedCases).map((diff: any) => {
                        const changeCat = diff.category || diff.changeType?.toUpperCase();
                        const isReg = changeCat === 'REGRESSED' || changeCat === 'NEW FAILURE';
                        const isRes = changeCat === 'RESOLVED' || changeCat === 'IMPROVED';

                        return (
                          <div
                            key={diff.caseId}
                            className={cn(
                              'p-3 rounded-xl border text-xs space-y-2',
                              isReg
                                ? 'border-rose-500/40 bg-rose-500/5'
                                : isRes
                                ? 'border-emerald-500/40 bg-emerald-500/5'
                                : 'border-border bg-surface-elevated/40'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-foreground">
                                  {diff.caseId}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-surface border border-border text-slate-400 uppercase text-[10px] font-mono">
                                  {diff.dimension}
                                </span>
                                <Badge
                                  variant={isReg ? 'danger' : isRes ? 'success' : 'neutral'}
                                  className="text-[10px] font-mono"
                                >
                                  {changeCat}
                                </Badge>
                                {diff.title && (
                                  <span className="text-slate-400 text-[11px] truncate max-w-xs">
                                    {diff.title}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-[11px] text-slate-400">
                                Score Delta: {formatDelta(diff.scoreDelta)}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono bg-surface/60 p-2 rounded-lg border border-border/50">
                              <div>
                                <span className="text-slate-400 block text-[10px]">Run A (Base):</span>
                                <span className="text-foreground font-semibold">
                                  {diff.runA.status.toUpperCase()} (Score: {diff.runA.score}%)
                                </span>
                                {diff.runA.failureReason && (
                                  <p className="text-rose-400 line-clamp-1 mt-0.5">
                                    {diff.runA.failureReason}
                                  </p>
                                )}
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[10px]">Run B (Target):</span>
                                <span className="text-foreground font-semibold">
                                  {diff.runB.status.toUpperCase()} (Score: {diff.runB.score}%)
                                </span>
                                {diff.runB.failureReason && (
                                  <p className="text-rose-400 line-clamp-1 mt-0.5">
                                    {diff.runB.failureReason}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
