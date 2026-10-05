import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/language-context';
import { EvaluationRunItem } from '@/types/admin';
import { adminApi } from '@/lib/api/admin-client';
import { QualityGateModal } from './quality-gate-modal';
import {
  History,
  Search,
  Eye,
  Ban,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EvaluationRunsTableProps {
  runs?: EvaluationRunItem[];
  onSelectRun?: (run: EvaluationRunItem) => void;
  onRunCancelled?: (runId: string) => void;
  isLoading?: boolean;
}

export function EvaluationRunsTable({
  runs = [],
  onSelectRun,
  onRunCancelled,
  isLoading,
}: EvaluationRunsTableProps) {
  const { t } = useLanguage();
  const [searchRunId, setSearchRunId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'running' | 'failed' | 'cancelled'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'mock' | 'replay' | 'live'>('all');
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [selectedQualityGateRun, setSelectedQualityGateRun] = useState<EvaluationRunItem | null>(null);

  const filteredRuns = runs.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (modeFilter !== 'all' && (r.mode || 'mock') !== modeFilter) return false;
    if (searchRunId.trim() && !r.id.toLowerCase().includes(searchRunId.toLowerCase().trim())) return false;
    return true;
  });

  const handleCancel = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to cancel this evaluation run?')) return;
    try {
      setCancellingRunId(runId);
      await adminApi.cancelEvaluationRun(runId);
      onRunCancelled?.(runId);
    } catch (err: any) {
      alert(err.message || 'Failed to cancel run');
    } finally {
      setCancellingRunId(null);
    }
  };

  return (
    <>
      <Card className="p-5 flex flex-col space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <span>{t('evaluation.runsTab')}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-slate-400 font-mono">
                {filteredRuns.length} / {runs.length}
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('evaluation.runDetailSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative w-48 sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchRunId}
                onChange={(e) => setSearchRunId(e.target.value)}
                placeholder="Search run ID..."
                className="w-full pl-8 pr-3 py-1 text-xs bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="text-xs px-2.5 py-1 bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="running">Running</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            {/* Mode filter */}
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as any)}
              className="text-xs px-2.5 py-1 bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">All Modes</option>
              <option value="mock">Mock</option>
              <option value="replay">Replay</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="h-48 rounded-lg bg-surface/30 animate-pulse border border-border" />
        ) : filteredRuns.length === 0 ? (
          <EmptyState
            title={t('evaluation.runsEmptyTitle')}
            description={t('evaluation.runsEmptyDesc')}
            icon={History}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-elevated text-slate-400 font-medium border-b border-border">
                <tr>
                  <th className="py-3 px-3">{t('evaluation.colRunId')}</th>
                  <th className="py-3 px-3">Mode</th>
                  <th className="py-3 px-3">{t('evaluation.colStarted')}</th>
                  <th className="py-3 px-3">Dataset Version</th>
                  <th className="py-3 px-3 text-center">Cases</th>
                  <th className="py-3 px-3 text-center">Passed</th>
                  <th className="py-3 px-3 text-center">Failed</th>
                  <th className="py-3 px-3 text-center">Pass Rate</th>
                  <th className="py-3 px-3 text-center">Regressions</th>
                  <th className="py-3 px-3 text-center">{t('evaluation.colDuration')}</th>
                  <th className="py-3 px-3 text-center">{t('evaluation.colStatus')}</th>
                  <th className="py-3 px-3 text-center">{t('evaluation.btnQualityGate')}</th>
                  <th className="py-3 px-3 text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRuns.map((r) => {
                  const passed = r.passedCases ?? r.passed ?? 0;
                  const failed = r.failedCases ?? r.failed ?? 0;
                  const passRate = r.overallScore ?? r.passRate ?? 0;
                  const isRunning = r.status === 'running';

                  return (
                    <tr
                      key={r.id}
                      onClick={() => onSelectRun?.(r)}
                      className="hover:bg-surface-elevated/50 transition-colors cursor-pointer group"
                    >
                      <td className="py-3 px-3 font-mono font-medium text-brand-400">
                        {r.id}
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-surface-elevated border border-border text-slate-300">
                          {r.mode || 'mock'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                        {r.startedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-300 max-w-[140px] truncate">
                        {r.datasetVersion}
                      </td>
                      <td className="py-3 px-3 text-center font-mono">
                        {isRunning ? (
                          <span className="inline-flex items-center gap-1 text-brand-400">
                            <Activity className="w-3 h-3 animate-spin" />
                            <span>{passed + failed}/{r.totalCases}</span>
                          </span>
                        ) : (
                          r.totalCases
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-emerald-400">{passed}</td>
                      <td className="py-3 px-3 text-center font-mono text-rose-400">{failed}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-emerald-400">
                        {passRate}%
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-slate-300">
                        <span className={r.regressionCount > 0 ? 'text-rose-400 font-bold' : ''}>
                          {r.regressionCount}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-slate-400">
                        {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-3 px-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedQualityGateRun(r);
                          }}
                          className="h-6 px-2 text-[10px] flex items-center gap-1 font-mono uppercase text-slate-300 hover:text-brand-300"
                        >
                          <ShieldCheck className="w-3 h-3 text-indigo-400" />
                          <span>{t('evaluation.btnQualityGate')}</span>
                        </Button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isRunning && (
                            <button
                              onClick={(e) => handleCancel(e, r.id)}
                              disabled={cancellingRunId === r.id}
                              className="p-1 rounded hover:bg-rose-500/20 text-rose-400 transition-colors"
                              title={t('evaluation.btnCancelRun')}
                            >
                              <Ban className={cn('w-4 h-4', cancellingRunId === r.id && 'animate-spin')} />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectRun?.(r);
                            }}
                            className="p-1 rounded hover:bg-slate-700/50 text-slate-400 group-hover:text-brand-400 transition-colors"
                            title={t('evaluation.openRunDetail')}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Quality Gate & Release Snapshot Modal */}
      <QualityGateModal
        isOpen={Boolean(selectedQualityGateRun)}
        onClose={() => setSelectedQualityGateRun(null)}
        run={selectedQualityGateRun}
      />
    </>
  );
}

