'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useLanguage } from '@/lib/i18n/language-context';
import { EvaluationRunItem } from '@/types/admin';
import { TrendingUp, Activity, CheckCircle2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QualityTrendCardProps {
  runs?: EvaluationRunItem[];
  hasHistoricalData?: boolean;
}

export function QualityTrendCard({ runs = [], hasHistoricalData }: QualityTrendCardProps) {
  const { t } = useLanguage();

  const isDataPresent = Boolean(hasHistoricalData || (runs && runs.length > 0));

  // Sort chronological for trend (oldest to newest)
  const chronologicalRuns = [...runs].reverse().slice(-12);

  const avgPassRate =
    runs.length > 0
      ? Math.round(
          (runs.reduce((acc, r) => acc + (r.overallScore ?? r.passRate ?? 0), 0) /
            runs.length) *
            10
        ) / 10
      : 100;

  const totalRegressions = runs.reduce((acc, r) => acc + (r.regressionCount || 0), 0);

  return (
    <Card className="p-5 flex flex-col space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span>Quality Trend & Pass Rate Over Time</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Longitudinal tracking of benchmark quality score, pass rate, and stability
          </p>
        </div>

        {isDataPresent && (
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Average Score:</span>
              <span className="font-mono font-bold text-emerald-400">{avgPassRate}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Total Regressions:</span>
              <span className={cn('font-mono font-bold', totalRegressions > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                {totalRegressions}
              </span>
            </div>
          </div>
        )}
      </div>

      {!isDataPresent ? (
        <EmptyState
          title={t('evaluation.historicalEmptyTitle')}
          description={t('evaluation.historicalEmptyDesc')}
          icon={TrendingUp}
        />
      ) : (
        <div className="space-y-4">
          {/* Trend Bar Visualizer */}
          <div className="p-4 rounded-xl bg-surface-elevated border border-border">
            <div className="h-44 flex items-end justify-between gap-2 pt-6 pb-2 px-2">
              {chronologicalRuns.map((r, i) => {
                const score = r.overallScore ?? r.passRate ?? 100;
                const heightPct = Math.max(10, Math.min(100, score));
                const isPerfect = score >= 100;
                const hasReg = (r.regressionCount || 0) > 0;

                return (
                  <div key={r.id || i} className="flex-1 flex flex-col items-center gap-1.5 group relative">
                    {/* Tooltip on Hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-12 z-20 pointer-events-none bg-slate-900 border border-slate-700 text-slate-200 text-[10px] py-1 px-2 rounded font-mono whitespace-nowrap shadow-xl">
                      Run: {r.id.slice(0, 8)}... | {score}% ({r.totalCases} cases)
                    </div>

                    <span className="text-[10px] font-mono text-slate-400 group-hover:text-foreground">
                      {score}%
                    </span>

                    <div className="w-full max-w-[36px] bg-surface rounded-t-md overflow-hidden flex flex-col justify-end h-28 border border-border/40">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={cn(
                          'w-full transition-all rounded-t-sm',
                          hasReg
                            ? 'bg-gradient-to-t from-rose-500/80 to-rose-400'
                            : isPerfect
                            ? 'bg-gradient-to-t from-emerald-500/80 to-emerald-400'
                            : 'bg-gradient-to-t from-brand-500/80 to-brand-400'
                        )}
                      />
                    </div>

                    <span className="text-[9px] font-mono text-slate-500 truncate max-w-[40px]">
                      {r.mode ? r.mode[0].toUpperCase() : 'M'}#{i + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Longitudinal Baseline Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-border bg-surface-elevated/40 flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="text-slate-400 block text-[11px]">Baseline Status</span>
                <span className="font-semibold text-foreground">Phase 8.5 Golden Verified</span>
              </div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-surface-elevated/40 flex items-center gap-2.5">
              <Activity className="w-4 h-4 text-brand-400 shrink-0" />
              <div>
                <span className="text-slate-400 block text-[11px]">Tracked Runs</span>
                <span className="font-semibold text-foreground">{runs.length} Historical Executions</span>
              </div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-surface-elevated/40 flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <div>
                <span className="text-slate-400 block text-[11px]">Determinism Target</span>
                <span className="font-semibold text-foreground">100% Structural Parity</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
