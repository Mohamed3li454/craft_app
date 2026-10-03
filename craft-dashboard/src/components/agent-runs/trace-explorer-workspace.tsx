'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { ReasoningBanner } from '@/components/ui/reasoning-banner';
import {
  X,
  RefreshCw,
  Copy,
  Check,
  Cpu,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Wrench,
  CheckCircle,
  XCircle,
  Layers,
  Sparkles,
  User,
} from 'lucide-react';
import {
  cn,
  truncate,
  formatLatency,
  formatDate,
  safeJsonStringify,
  sanitizeSafeMetadata,
  sanitizeSafeErrorDetails,
} from '@/lib/utils';
import { AdminAgentRunDetails } from '@/types/admin';

export interface TraceExplorerWorkspaceProps {
  runId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function TraceExplorerWorkspace({ runId, isOpen, onClose }: TraceExplorerWorkspaceProps) {
  const { t, formatNumber, formatRelativeTime } = useLanguage();
  const [copiedId, setCopiedId] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [showRawMetadata, setShowRawMetadata] = useState(false);

  // Trace Details Query
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-agent-run-details', runId],
    queryFn: () => adminApi.getAgentRunDetails(runId!),
    enabled: Boolean(runId && isOpen),
    staleTime: 30000,
    // Only poll if actively running
    refetchInterval: (query) => {
      const run = query.state.data?.data;
      return run?.status === 'running' ? 3000 : false;
    },
  });

  const run: AdminAgentRunDetails | undefined = data?.data;

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopyId = (textToCopy: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const toggleToolExpanded = (toolId: string) => {
    setExpandedTools((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  if (!isOpen || !runId) return null;

  const toolCalls = run?.toolCalls || [];
  const durationMs = run?.durationMs ?? run?.latencyMs;
  const isFailed = run?.status === 'failed' || Boolean(run?.errorDetails);

  // Safe allowlisted metadata for debugging
  const safeDebugMetadata = run
    ? sanitizeSafeMetadata({
        id: run.id,
        conversationId: run.conversationId,
        userId: run.userId,
        status: run.status,
        model: run.model,
        provider: run.provider,
        iterationsCount: run.iterationsCount,
        durationMs: run.durationMs,
        latencyMs: run.latencyMs,
        toolCallsCount: run.toolCallsCount,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        hasRedactedReasoning: true,
      })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-explorer-title"
        className="w-full h-full max-w-3xl 2xl:max-w-4xl bg-surface border-s border-border flex flex-col shadow-2xl animate-in slide-in-from-right rtl:slide-in-from-left duration-200 overflow-hidden font-mono"
      >
        {/* ========================================================= */}
        {/* 1. Header & Identity Control Bar                          */}
        {/* ========================================================= */}
        <div className="p-4 sm:p-5 border-b border-border bg-surface-elevated/70 shrink-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold shrink-0">
                <Cpu className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    {t('agentRuns.drawerTitle')}
                  </span>
                  <StatusBadge status={run?.status || 'running'} size="xs" showDot={true} />
                  {durationMs !== undefined && durationMs !== null && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-surface border border-border text-cyan-400 font-semibold">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatLatency(durationMs)}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <span id="trace-explorer-title" className="text-sm font-bold text-foreground font-mono truncate max-w-[240px] sm:max-w-md" dir="ltr">
                    {runId}
                  </span>
                  <button
                    onClick={() => handleCopyId(runId)}
                    className="p-1 rounded text-slate-400 hover:text-foreground hover:bg-surface transition-colors"
                    title={t('agentRuns.copyRunId')}
                    aria-label={t('agentRuns.copyRunId')}
                  >
                    {copiedId ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
                title={t('common.refresh')}
                className="h-8 px-2.5 text-xs font-mono"
                aria-label={t('common.refresh')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              </Button>

              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="p-1.5 rounded-md text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Reasoning Redaction Policy Notice */}
          <ReasoningBanner compact={true} />
        </div>

        {/* ========================================================= */}
        {/* 2. Body Content                                           */}
        {/* ========================================================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 text-xs bg-background/50 font-mono">
          {isLoading ? (
            <div className="space-y-4 py-8">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-surface-elevated/40 border border-border animate-pulse" />
                ))}
              </div>
              <div className="h-32 rounded-lg bg-surface-elevated/30 border border-border animate-pulse" />
              <div className="h-48 rounded-lg bg-surface-elevated/20 border border-border animate-pulse" />
              <div className="text-center text-xs text-slate-400 font-mono py-4">
                {t('agentRuns.loadingTrace')}
              </div>
            </div>
          ) : error ? (
            <ErrorAlert
              error={error}
              title={t('agentRuns.failedDetails')}
              onRetry={() => refetch()}
            />
          ) : !run ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <Cpu className="h-8 w-8 mx-auto text-slate-500" />
              <p>{t('agentRuns.notFound')}</p>
            </div>
          ) : (
            <>
              {/* SECTION 1: EXECUTION SUMMARY & CONTEXT LINKS */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                      {t('agentRuns.colStatus')}
                    </span>
                    <div className="pt-0.5">
                      <StatusBadge status={run.status} size="xs" showDot={true} />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                      {t('agentRuns.latency')}
                    </span>
                    <span className="text-sm font-bold text-cyan-400 block truncate" dir="ltr">
                      {formatLatency(durationMs)}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                      {t('agentRuns.colIterations')}
                    </span>
                    <span className="text-sm font-bold text-foreground block truncate">
                      {t('agentRuns.iterationsBadge', { count: String(run.iterationsCount || 1) })}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                      {t('agentRuns.toolsExecuted')}
                    </span>
                    <span className="text-sm font-bold text-purple-400 block truncate">
                      {formatNumber(toolCalls.length || run.toolCallsCount || 0)}
                    </span>
                  </div>
                </div>

                {/* Secondary Metadata & Navigation Anchors */}
                <div className="p-3.5 rounded-lg bg-surface border border-border space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] pb-2 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">{t('agentRuns.colStarted')}:</span>
                      <span className="text-foreground font-semibold">{formatDate(run.createdAt)}</span>
                      <span className="text-slate-500">({formatRelativeTime(run.createdAt)})</span>
                    </div>

                    {run.completedAt && (
                      <div className="flex items-center gap-2 text-slate-400">
                        <span>Completed:</span>
                        <span className="text-foreground">{formatDate(run.completedAt)}</span>
                      </div>
                    )}
                  </div>

                  {/* Linking to Conversation & User 360 */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pt-0.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      {run.conversationId && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500 text-[10px] uppercase">Conv:</span>
                          <span className="text-foreground font-mono text-[11px]" dir="ltr">
                            {truncate(run.conversationId, 12)}
                          </span>
                          <Link
                            href={`/conversations?id=${run.conversationId}`}
                            className="inline-flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400 hover:text-brand-500 font-medium ms-1"
                            title={t('agentRuns.openConversation')}
                          >
                            <span>{t('agentRuns.openConversation')}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      )}

                      {run.userId && (
                        <div className="flex items-center gap-1.5 border-s border-border ps-3">
                          <User className="h-3 w-3 text-slate-400" />
                          <span className="text-slate-500 text-[10px] uppercase">User:</span>
                          <span className="text-foreground font-mono text-[11px]" dir="ltr">
                            {truncate(run.userId, 12)}
                          </span>
                          <Link
                            href={`/users?userId=${run.userId}`}
                            className="inline-flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400 hover:text-brand-500 font-medium ms-1"
                            title={t('agentRuns.viewUser360')}
                          >
                            <span>{t('agentRuns.viewUser360')}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      )}
                    </div>

                    {run.model && (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-slate-500">{t('agentRuns.colModel')}:</span>
                        <span className="px-2 py-0.5 rounded bg-surface-elevated border border-border text-brand-300 font-semibold" dir="ltr">
                          {run.model}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* User Input Prompt */}
                {(run.userPrompt || run.promptSnippet) && (
                  <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1.5">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">
                      {t('agentRuns.userPromptInput')}
                    </span>
                    <div className="p-2.5 rounded bg-surface-elevated/40 border border-border/50 text-foreground font-sans text-xs leading-relaxed whitespace-pre-wrap selection:bg-brand-500/20">
                      {run.userPrompt || run.promptSnippet}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 2: EXECUTION TIMELINE */}
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1 border-b border-border/60">
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-brand-400" />
                    {t('agentRuns.executionTimeline')}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {toolCalls.length + 2} events
                  </span>
                </div>

                <div className="relative ps-6 sm:ps-8 space-y-4 before:absolute before:start-2.5 sm:before:start-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                  {/* Step 1: Preflight / Request Ingestion */}
                  <div className="relative">
                    <div className="absolute -start-6 sm:-start-8 top-1 h-5 w-5 sm:h-7 sm:w-7 rounded-full bg-brand-500/20 border-2 border-brand-500 flex items-center justify-center text-brand-400 shrink-0">
                      <Sparkles className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    </div>
                    <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="font-semibold text-foreground">
                          {t('agentRuns.preflightStep')}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {formatDate(run.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Request parsed and contextualized into execution plan.
                      </p>
                    </div>
                  </div>

                  {/* Step 2..N: Tool Invocations */}
                  {toolCalls.map((tc, idx) => {
                    const isToolErr = tc.status === 'error';
                    return (
                      <div key={tc.id || idx} className="relative">
                        <div
                          className={cn(
                            'absolute -start-6 sm:-start-8 top-1 h-5 w-5 sm:h-7 sm:w-7 rounded-full border-2 flex items-center justify-center shrink-0',
                            isToolErr
                              ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                              : 'bg-purple-500/20 border-purple-500 text-purple-400'
                          )}
                        >
                          <Wrench className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                        </div>

                        <div className="p-3 rounded-lg bg-surface border border-border space-y-2 hover:border-purple-800/60 transition-colors">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground font-mono" dir="ltr">
                                {tc.toolName}
                              </span>
                              <span className="text-[10px] text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800" dir="ltr">
                                {tc.durationMs}ms
                              </span>
                            </div>
                            <StatusBadge status={tc.status} size="xs" showDot={true} />
                          </div>

                          {tc.errorMessage && (
                            <div className="p-2 rounded bg-rose-950/40 border border-rose-800 text-rose-300 text-[11px] whitespace-pre-wrap font-mono">
                              {sanitizeSafeErrorDetails(tc.errorMessage)}
                            </div>
                          )}

                          <button
                            onClick={() => toggleToolExpanded(tc.id || String(idx))}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-foreground transition-colors font-mono"
                          >
                            {expandedTools[tc.id || String(idx)] ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            <span>{t('agentRuns.toggleDetails')}</span>
                          </button>

                          {expandedTools[tc.id || String(idx)] && (
                            <div className="space-y-2 pt-2 border-t border-border/40 text-[11px]">
                              <div>
                                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                                  {t('agentRuns.arguments')}
                                </span>
                                <pre className="p-2 rounded bg-surface-elevated border border-border/40 text-slate-300 overflow-x-auto text-[11px]" dir="ltr">
                                  {safeJsonStringify(sanitizeSafeMetadata(tc.args || tc.arguments))}
                                </pre>
                              </div>
                              <div>
                                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                                  {t('agentRuns.result')}
                                </span>
                                <pre className="p-2 rounded bg-surface-elevated border border-border/40 text-slate-300 overflow-x-auto text-[11px]" dir="ltr">
                                  {safeJsonStringify(sanitizeSafeMetadata(tc.result))}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Step Final: Execution Outcome */}
                  <div className="relative">
                    <div
                      className={cn(
                        'absolute -start-6 sm:-start-8 top-1 h-5 w-5 sm:h-7 sm:w-7 rounded-full border-2 flex items-center justify-center shrink-0',
                        isFailed
                          ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                          : 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      )}
                    >
                      {isFailed ? <XCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> : <CheckCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3" />}
                    </div>
                    <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="font-semibold text-foreground">
                          {t('agentRuns.executionOutcome')}
                        </span>
                        <StatusBadge status={run.status} size="xs" showDot={true} />
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {isFailed
                          ? 'Execution halted with failure state.'
                          : 'Agent completed operational loop successfully.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 3: ERROR & DIAGNOSTICS (IF FAILED) */}
              {isFailed && (
                <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-200 space-y-2">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{t('agentRuns.errorSectionTitle')}</span>
                  </div>
                  <p className="text-xs leading-relaxed font-mono bg-rose-950/60 p-3 rounded border border-rose-900/60 text-rose-100 whitespace-pre-wrap">
                    {sanitizeSafeErrorDetails(run.errorDetails) || t('agentRuns.noErrorDetails')}
                  </p>
                  <p className="text-[11px] text-rose-400/80">
                    Verify tool availability, upstream rate limits, or network timeouts for this run.
                  </p>
                </div>
              )}

              {/* SECTION 4: SAFE EXECUTION METADATA (COLLAPSIBLE ALLOWLIST) */}
              <div className="pt-2 border-t border-border/40">
                <button
                  onClick={() => setShowRawMetadata(!showRawMetadata)}
                  className="flex items-center justify-between w-full py-2 text-xs text-slate-400 hover:text-foreground font-mono"
                >
                  <span className="flex items-center gap-1.5">
                    <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showRawMetadata && 'rotate-90')} />
                    <span>{t('agentRuns.rawSafeMetadata')}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase">Allowlisted</span>
                </button>

                {showRawMetadata && (
                  <pre
                    className="p-3 rounded-lg bg-surface-elevated/50 border border-border text-[11px] text-slate-300 overflow-x-auto mt-2 leading-relaxed"
                    dir="ltr"
                  >
                    {safeJsonStringify(safeDebugMetadata)}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
