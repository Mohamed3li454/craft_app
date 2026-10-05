'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/lib/i18n/language-context';
import { EvaluationRunItem, EvaluationCaseResult } from '@/types/admin';
import {
  X,
  Layers,
  ShieldCheck,
  Activity,
  Calendar,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Cpu,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { QualityGateModal } from './quality-gate-modal';

interface RunDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  run?: EvaluationRunItem | null;
}

export function RunDetailDrawer({ isOpen, onClose, run }: RunDetailDrawerProps) {
  const { t, isRtl } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed' | 'regressions'>('all');
  const [expandedCases, setExpandedCases] = useState<Record<string, boolean>>({});
  const [showGateModal, setShowGateModal] = useState(false);

  const toggleCaseExpanded = (id: string) => {
    setExpandedCases((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch individual case results for this run
  const {
    data: resultsResponse,
    isLoading: isResultsLoading,
  } = useQuery({
    queryKey: ['evaluation-run-results', run?.id],
    queryFn: () => (run ? adminApi.getEvaluationRunResults(run.id, { limit: 100 }) : null),
    enabled: Boolean(isOpen && run?.id),
  });

  if (!isOpen || !run) return null;

  const rawResults: EvaluationCaseResult[] = resultsResponse?.data || [];

  const filteredResults = rawResults.filter((item) => {
    if (statusFilter === 'passed' && item.status !== 'passed') return false;
    if (statusFilter === 'failed' && item.status !== 'failed') return false;
    if (statusFilter === 'regressions' && !item.regression) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        item.caseId.toLowerCase().includes(q) ||
        item.dimension.toLowerCase().includes(q) ||
        (item.failureReason && item.failureReason.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const passedCount = run.passedCases ?? run.passed ?? 0;
  const failedCount = run.failedCases ?? run.failed ?? 0;
  const passRate = run.passRate ?? run.overallScore ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-detail-title"
      className="fixed inset-0 z-50 overflow-hidden"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 end-0 max-w-full flex ps-10">
        <div className="w-screen max-w-2xl bg-surface border-s border-border shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-border flex items-start justify-between bg-surface-elevated/50">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 font-bold border border-brand-500/20">
                  {run.id}
                </span>
                <StatusBadge status={run.status} />
                <Badge variant="neutral" className="text-[10px] uppercase font-mono">
                  {run.mode || 'mock'}
                </Badge>
              </div>
              <h2 id="run-detail-title" className="text-base font-bold text-foreground">
                {t('evaluation.runDetailTitle')}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowGateModal(true)}
                className="h-8 text-xs flex items-center gap-1.5 font-mono"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t('evaluation.btnQualityGate')}</span>
              </Button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Run Stats Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-surface-elevated border border-border">
                <span className="text-[11px] text-slate-400 block uppercase">Total Cases</span>
                <span className="text-lg font-bold font-mono text-foreground mt-1 block">
                  {run.totalCases}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-surface-elevated border border-border">
                <span className="text-[11px] text-slate-400 block uppercase">Passed</span>
                <span className="text-lg font-bold font-mono text-emerald-400 mt-1 block">
                  {passedCount}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-surface-elevated border border-border">
                <span className="text-[11px] text-slate-400 block uppercase">Failed</span>
                <span className="text-lg font-bold font-mono text-rose-400 mt-1 block">
                  {failedCount}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-surface-elevated border border-border">
                <span className="text-[11px] text-slate-400 block uppercase">Pass Rate</span>
                <span className="text-lg font-bold font-mono text-emerald-400 mt-1 block">
                  {passRate}%
                </span>
              </div>
            </div>

            {/* Run Execution Metadata */}
            <div className="space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-brand-400" />
                <span>Run Execution Metadata</span>
              </span>
              <div className="p-4 rounded-xl bg-surface-elevated border border-border space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Dataset Version:</span>
                  </span>
                  <span className="font-mono text-foreground font-medium">{run.datasetVersion}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-brand-400" />
                    <span>Execution Mode:</span>
                  </span>
                  <span className="font-mono text-foreground uppercase">{run.mode || 'mock'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Started At:</span>
                  </span>
                  <span className="font-mono text-slate-300">{run.startedAt}</span>
                </div>
                {run.completedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>Completed At:</span>
                    </span>
                    <span className="font-mono text-slate-300">{run.completedAt}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Regressions Count:</span>
                  </span>
                  <span className={cn('font-mono font-medium', run.regressionCount > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400')}>
                    {run.regressionCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Case Results Explorer */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-brand-400" />
                  <span>Case Results ({filteredResults.length})</span>
                </span>
                <div className="flex items-center gap-2">
                  <div className="relative w-44">
                    <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search cases..."
                      className="w-full ps-8 pe-2 py-1 text-xs bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div className="flex rounded-md border border-border bg-surface-elevated p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setStatusFilter('all')}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs',
                        statusFilter === 'all' ? 'bg-surface text-foreground font-medium shadow-sm' : 'text-slate-400'
                      )}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('failed')}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs',
                        statusFilter === 'failed' ? 'bg-rose-500/20 text-rose-400 font-medium' : 'text-slate-400'
                      )}
                    >
                      Failed
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('regressions')}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs',
                        statusFilter === 'regressions' ? 'bg-amber-500/20 text-amber-400 font-medium' : 'text-slate-400'
                      )}
                    >
                      Regressions
                    </button>
                  </div>
                </div>
              </div>

              {isResultsLoading ? (
                <div className="h-32 rounded-lg bg-surface/30 animate-pulse border border-border" />
              ) : filteredResults.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 border border-border rounded-lg bg-surface-elevated/30">
                  No evaluation case results matching criteria.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredResults.map((item) => {
                    const isExpanded = Boolean(expandedCases[item.id]);
                    const report = item.assertionReport;
                    const correlation = item.runtimeCorrelation;

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'p-3.5 rounded-xl border text-xs space-y-2.5 transition-colors',
                          item.status === 'passed'
                            ? 'border-border bg-surface-elevated/40'
                            : 'border-rose-500/30 bg-rose-500/5'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {item.status === 'passed' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                            )}
                            <span className="font-mono font-bold text-foreground">{item.caseId}</span>
                            <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-slate-400 text-[10px] uppercase font-mono">
                              {item.dimension}
                            </span>
                            {item.failureCategory && (
                              <Badge variant="danger" className="text-[10px] font-mono uppercase">
                                {item.failureCategory.replace(/_/g, ' ')}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {item.regression && (
                              <Badge variant="danger" className="text-[10px] font-mono px-1.5 py-0">
                                REGRESSION
                              </Badge>
                            )}
                            {report && (
                              <span
                                className={cn(
                                  'font-mono text-[10px] px-2 py-0.5 rounded border',
                                  report.passedCount === report.totalCount
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                )}
                              >
                                {report.passedCount} / {report.totalCount} assertions
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-slate-400">
                              {item.durationMs}ms
                            </span>
                            {report && report.assertions && report.assertions.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleCaseExpanded(item.id)}
                                className="p-1 rounded text-slate-400 hover:text-foreground hover:bg-surface transition-colors"
                                aria-label="Toggle assertion details"
                              >
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {item.failureReason && (
                          <div className="text-[11px] text-rose-400 bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20 font-mono flex items-start gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{item.failureReason}</span>
                          </div>
                        )}

                        {/* Expandable Assertions Table */}
                        {isExpanded && report && report.assertions && report.assertions.length > 0 && (
                          <div className="pt-1.5 space-y-1.5">
                            <div className="rounded-lg border border-border/70 overflow-hidden bg-surface/60">
                              <table className="w-full text-[11px] text-left rtl:text-right">
                                <thead className="bg-surface-elevated/70 border-b border-border/70 text-slate-400 font-mono text-[10px] uppercase">
                                  <tr>
                                    <th className="px-2.5 py-1.5">{t('evaluation.colAssertionType')}</th>
                                    <th className="px-2.5 py-1.5">{t('evaluation.colExpectedValue')}</th>
                                    <th className="px-2.5 py-1.5">{t('evaluation.colObservedValue')}</th>
                                    <th className="px-2 py-1.5 text-center">{t('evaluation.colAssertionStatus')}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40 font-mono">
                                  {report.assertions.map((assert, aIdx) => (
                                    <tr key={aIdx} className="hover:bg-surface-elevated/30">
                                      <td className="px-2.5 py-1 text-slate-300 font-medium">
                                        {assert.type.replace(/_/g, ' ')}
                                      </td>
                                      <td className="px-2.5 py-1 text-slate-400">
                                        {assert.expected}
                                      </td>
                                      <td className="px-2.5 py-1 text-slate-200">
                                        {assert.observed}
                                      </td>
                                      <td className="px-2 py-1 text-center">
                                        {assert.status === 'passed' ? (
                                          <span className="text-emerald-400 font-bold">✓</span>
                                        ) : (
                                          <span className="text-rose-400 font-bold">✗</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Runtime Correlation Links */}
                        <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] font-mono text-slate-400">
                          <span>{t('evaluation.runtimeCorrelationTitle')}:</span>
                          {correlation?.hasCorrelation ? (
                            <div className="flex items-center gap-2">
                              {correlation.agentRunId && (
                                <Link
                                  href={`/agent-runs?search=${encodeURIComponent(correlation.agentRunId)}`}
                                  className="text-brand-400 hover:underline flex items-center gap-1"
                                >
                                  <Cpu className="w-3 h-3" />
                                  <span>{t('evaluation.viewAgentRun')}</span>
                                </Link>
                              )}
                              {correlation.toolCallId && (
                                <Link
                                  href={`/tools?search=${encodeURIComponent(correlation.toolCallId)}`}
                                  className="text-brand-400 hover:underline flex items-center gap-1"
                                >
                                  <Layers className="w-3 h-3" />
                                  <span>{t('evaluation.viewToolCall')}</span>
                                </Link>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">
                              {t('evaluation.noCorrelationAvailable')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <QualityGateModal
        isOpen={showGateModal}
        onClose={() => setShowGateModal(false)}
        run={run}
      />
    </div>
  );
}
