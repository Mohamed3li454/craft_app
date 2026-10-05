'use client';

import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Badge } from '@/components/ui/badge';
import {
  X,
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CaseHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  caseId?: string | null;
}

export function CaseHistoryDrawer({
  isOpen,
  onClose,
  caseId,
}: CaseHistoryDrawerProps) {
  const { t, isRtl } = useLanguage();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const { data: historyResponse, isLoading } = useQuery({
    queryKey: ['evaluation-case-history', caseId],
    queryFn: () => (caseId ? adminApi.getEvaluationCaseHistory(caseId, 20) : null),
    enabled: Boolean(isOpen && caseId),
  });

  if (!isOpen || !caseId) return null;

  const caseData = historyResponse?.data?.case;
  const historyList = historyResponse?.data?.history || [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-history-title"
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
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20">
                <History className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface border border-border text-foreground font-bold">
                    {caseId}
                  </span>
                  {caseData?.category && (
                    <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-slate-400 text-[10px] uppercase font-mono">
                      {caseData.category}
                    </span>
                  )}
                </div>
                <h2 id="case-history-title" className="text-base font-bold text-foreground">
                  {caseData?.name || t('evaluation.caseHistoryTitle')}
                </h2>
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

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Input Context Box */}
            {caseData?.input && (
              <div className="p-3.5 rounded-xl border border-border bg-surface-elevated/30 space-y-1">
                <span className="text-[10px] font-mono uppercase text-slate-400 block">
                  {t('evaluation.colInput')}
                </span>
                <p className="text-xs text-foreground font-mono leading-relaxed">
                  {caseData.input}
                </p>
              </div>
            )}

            {/* Execution Timeline */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  {t('evaluation.caseHistorySubtitle')} ({historyList.length})
                </span>
              </div>

              {isLoading ? (
                <div className="h-40 rounded-xl bg-surface/30 animate-pulse border border-border" />
              ) : historyList.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 border border-border rounded-xl bg-surface-elevated/20">
                  {t('evaluation.noCaseHistory')}
                </div>
              ) : (
                <div className="space-y-4">
                  {historyList.map((item, index) => {
                    const report = item.assertionReport;
                    const correlation = item.runtimeCorrelation;

                    return (
                      <div
                        key={item.id || index}
                        className={cn(
                          'p-4 rounded-xl border text-xs space-y-3 transition-colors',
                          item.status === 'passed'
                            ? 'border-border bg-surface-elevated/40'
                            : 'border-rose-500/30 bg-rose-500/5'
                        )}
                      >
                        {/* Run Meta Header */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {item.status === 'passed' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            )}
                            <span className="font-mono font-bold text-foreground">
                              {item.runId}
                            </span>
                            {item.failureCategory && (
                              <Badge variant="danger" className="text-[10px] font-mono uppercase">
                                {item.failureCategory.replace(/_/g, ' ')}
                              </Badge>
                            )}
                            {item.regression && (
                              <Badge variant="danger" className="text-[10px] font-mono">
                                REGRESSION
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
                            <span>Score: {item.score}%</span>
                            <span>•</span>
                            <span>{item.durationMs}ms</span>
                            <span>•</span>
                            <span>
                              {new Date(item.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>

                        {/* Failure Reason */}
                        {item.failureReason && (
                          <div className="text-[11px] text-rose-400 bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20 font-mono flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{item.failureReason}</span>
                          </div>
                        )}

                        {/* Assertion Diagnostics Breakdown */}
                        {report && report.assertions && report.assertions.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-slate-400 uppercase font-semibold">
                                {t('evaluation.assertionDiagnosticsTitle')}
                              </span>
                              <span
                                className={cn(
                                  'font-bold',
                                  report.passedCount === report.totalCount
                                    ? 'text-emerald-400'
                                    : 'text-amber-400'
                                )}
                              >
                                {report.passedCount} / {report.totalCount} Passed
                              </span>
                            </div>

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

                        {/* Runtime Correlation Navigation */}
                        <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-400">
                            {t('evaluation.runtimeCorrelationTitle')}:
                          </span>
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
    </div>
  );
}
