import React from 'react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { useLanguage } from '@/lib/i18n/language-context';
import { EvaluationRegressionItem } from '@/types/admin';
import { ShieldCheck, AlertCircle } from 'lucide-react';

interface RegressionCenterProps {
  regressions?: EvaluationRegressionItem[];
  onSelectCaseId?: (caseId: string) => void;
  isLoading?: boolean;
}

export function RegressionCenter({
  regressions = [],
  onSelectCaseId,
  isLoading,
}: RegressionCenterProps) {
  const { t } = useLanguage();

  return (
    <Card className="p-5 flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span>{t('evaluation.regressionsTab')}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-mono border ${
                regressions.length === 0
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              {regressions.length}
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Architectural regression detection across successive golden dataset runs
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 rounded-lg bg-surface/30 animate-pulse border border-border" />
      ) : regressions.length === 0 ? (
        <div className="p-8 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center flex flex-col items-center justify-center space-y-2">
          <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-400">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-semibold text-foreground">
            {t('evaluation.regressionsEmptyTitle')}
          </h4>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            {t('evaluation.regressionsEmptyDesc')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-elevated text-slate-400 font-medium border-b border-border">
              <tr>
                <th className="py-3 px-3">{t('evaluation.colCaseId')}</th>
                <th className="py-3 px-3">{t('evaluation.colDimension')}</th>
                <th className="py-3 px-3">Previous Result</th>
                <th className="py-3 px-3">Current Result</th>
                <th className="py-3 px-3">{t('evaluation.colSeverity')}</th>
                <th className="py-3 px-3">{t('evaluation.colFirstDetected')}</th>
                <th className="py-3 px-3">{t('evaluation.colLatestDetected')}</th>
                <th className="py-3 px-3">Related Run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {regressions.map((reg) => {
                const prev = reg.previousResult || reg.previousStatus || 'passed';
                const current = reg.currentResult || reg.status || 'failed';
                const reason = reg.reason || reg.failureReason;
                const latestDate = reg.latestDetectedAt || reg.runDate || 'Recent';
                const firstDate = reg.firstDetectedAt || reg.runDate || 'Recent';
                const runId = reg.relatedRunId || (reg as any).runId || '—';
                const severity = reg.severity || (reg.dimension === 'agent' || reg.dimension === 'provider' ? 'critical' : 'high');

                return (
                  <tr
                    key={reg.caseId}
                    onClick={() => onSelectCaseId?.(reg.caseId)}
                    className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-3">
                      <span className="font-mono font-medium text-brand-400">{reg.caseId}</span>
                      {reason && (
                        <p className="text-[11px] text-slate-400 font-sans mt-0.5 max-w-xs truncate">
                          {reason}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-300">
                      {reg.dimension}
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadge status={prev} />
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadge status={current} />
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                          severity === 'critical'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : severity === 'high'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {severity}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400">{firstDate}</td>
                    <td className="py-3 px-3 text-slate-400">{latestDate}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                      {runId}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
