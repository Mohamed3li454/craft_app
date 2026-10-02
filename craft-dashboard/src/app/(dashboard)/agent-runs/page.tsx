'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { ReasoningBanner } from '@/components/ui/reasoning-banner';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Eye, Wrench } from 'lucide-react';
import { truncate, safeJsonStringify } from '@/lib/utils';

export default function AgentRunsPage() {
  const { t, formatTokens, formatRelativeTime } = useLanguage();
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const queryParams = {
    status: statusFilter === 'all' ? undefined : statusFilter,
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-agent-runs', queryParams],
    queryFn: () => adminApi.getAgentRuns(queryParams),
  });

  const runs = data?.data || [];
  const total = data?.pagination?.total;

  // Run Details Query
  const runDetailsQuery = useQuery({
    queryKey: ['admin-agent-run-details', selectedRunId],
    queryFn: () => adminApi.getAgentRunDetails(selectedRunId!),
    enabled: Boolean(selectedRunId),
  });

  const runDetails = runDetailsQuery.data?.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('agentRuns.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('agentRuns.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-8 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-slate-200 focus:outline-none"
          >
            <option value="all">{t('agentRuns.filterAll')}</option>
            <option value="completed">{t('agentRuns.filterCompleted')}</option>
            <option value="failed">{t('agentRuns.filterFailed')}</option>
            <option value="running">{t('agentRuns.filterRunning')}</option>
            <option value="interrupted">{t('agentRuns.filterInterrupted')}</option>
          </select>
        </div>
      </div>

      {/* Safety Redaction Policy Callout */}
      <ReasoningBanner />

      {error && (
        <ErrorAlert
          error={error}
          title={t('agentRuns.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}

      {/* Runs Table */}
      <DataTable
        columns={[
          {
            header: t('agentRuns.colRunId'),
            accessorKey: 'id',
            cell: (r) => <span className="font-semibold text-slate-200">{truncate(r.id, 14)}</span>,
          },
          {
            header: t('agentRuns.colModel'),
            accessorKey: 'model',
            cell: (r) => <span className="text-brand-300 font-semibold">{r.model}</span>,
          },
          {
            header: t('agentRuns.colStatus'),
            accessorKey: 'status',
            cell: (r) => <StatusPill status={r.status} />,
          },
          {
            header: t('agentRuns.colTokens'),
            accessorKey: 'totalTokens',
            cell: (r) => (
              <div>
                <span className="font-bold text-slate-100">{formatTokens(r.totalTokens)}</span>
                <span className="text-[10px] text-slate-400 block">
                  {r.promptTokens || 0} in / {r.completionTokens || 0} out
                </span>
              </div>
            ),
          },
          {
            header: t('agentRuns.latency'),
            accessorKey: 'latencyMs',
            cell: (r) => <span className="text-slate-200">{r.latencyMs || 0}ms</span>,
          },
          {
            header: t('agentRuns.colToolCalls'),
            accessorKey: 'toolCallsCount',
            cell: (r) => (
              <Badge variant={r.toolCallsCount > 0 ? 'purple' : 'neutral'}>
                {t('agentRuns.toolsCount', { count: r.toolCallsCount })}
              </Badge>
            ),
          },
          {
            header: t('common.timestamp'),
            accessorKey: 'createdAt',
            cell: (r) => formatRelativeTime(r.createdAt),
          },
          {
            header: t('common.actions'),
            cell: (r) => (
              <Button variant="outline" size="sm" onClick={() => setSelectedRunId(r.id)}>
                <Eye className="h-3.5 w-3.5 me-1" />
                {t('agentRuns.btnInspect')}
              </Button>
            ),
          },
        ]}
        data={runs}
        isLoading={isLoading}
        emptyMessage={t('agentRuns.noRuns')}
        pagination={{
          currentPage: page,
          hasMore: total !== undefined ? page * limit < total : runs.length === limit,
          onNext: () => setPage((p) => p + 1),
          onPrev: () => setPage((p) => Math.max(1, p - 1)),
          total,
        }}
      />

      {/* Trace Drawer */}
      <Drawer
        isOpen={Boolean(selectedRunId)}
        onClose={() => setSelectedRunId(null)}
        title={t('agentRuns.traceDetailsTitle', { id: selectedRunId || '' })}
        subtitle={t('agentRuns.traceSubtitle')}
        width="2xl"
      >
        {runDetailsQuery.isLoading ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">{t('agentRuns.loadingTrace')}</div>
        ) : runDetailsQuery.error ? (
          <div className="p-4">
            <ErrorAlert
              error={runDetailsQuery.error}
              title={t('agentRuns.failedDetails')}
              onRetry={() => runDetailsQuery.refetch()}
            />
          </div>
        ) : !runDetails ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">{t('agentRuns.notFound')}</div>
        ) : (
          <div className="space-y-6 font-mono text-xs">
            {/* Top Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded bg-surface-elevated/40 border border-border">
                <span className="text-[10px] text-slate-400 uppercase block">{t('agentRuns.modelArch')}</span>
                <span className="text-xs font-bold text-brand-300 mt-1 block">{runDetails.model}</span>
              </div>
              <div className="p-3 rounded bg-surface-elevated/40 border border-border">
                <span className="text-[10px] text-slate-400 uppercase block">{t('agentRuns.totalTokens')}</span>
                <span className="text-xs font-bold text-slate-100 mt-1 block">{formatTokens(runDetails.totalTokens)}</span>
              </div>
              <div className="p-3 rounded bg-surface-elevated/40 border border-border">
                <span className="text-[10px] text-slate-400 uppercase block">{t('agentRuns.latency')}</span>
                <span className="text-xs font-bold text-cyan-300 mt-1 block">{runDetails.latencyMs}ms</span>
              </div>
            </div>

            {/* MANDATORY Chain of thought redaction banner */}
            <ReasoningBanner />

            {/* Prompt & Response Snippets */}
            <div className="space-y-3">
              <div>
                <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">
                  {t('agentRuns.userPromptInput')}
                </span>
                <div className="p-3 rounded-md bg-surface-elevated/30 border border-border/80 text-slate-200 font-sans leading-relaxed whitespace-pre-wrap">
                  {runDetails.promptSnippet || '—'}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">
                  {t('agentRuns.finalAssistantResponse')}
                </span>
                <div className="p-3 rounded-md bg-surface-elevated/30 border border-border/80 text-slate-200 font-sans leading-relaxed whitespace-pre-wrap">
                  {runDetails.responseSnippet || '—'}
                </div>
              </div>
            </div>

            {/* Tool Calls Execution Chain */}
            <div className="space-y-3">
              <span className="text-[11px] text-slate-400 uppercase font-semibold block">
                {t('agentRuns.executedToolCalls', { count: runDetails.toolCalls?.length || 0 })}
              </span>

              {(!runDetails.toolCalls || runDetails.toolCalls.length === 0) ? (
                <div className="p-4 rounded bg-surface-elevated/20 border border-border/40 text-slate-400 text-center">
                  {t('agentRuns.directCompletion')}
                </div>
              ) : (
                <div className="space-y-3">
                  {runDetails.toolCalls.map((tc, idx) => (
                    <div key={tc.id || idx} className="rounded-lg border border-border bg-surface-elevated/40 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-surface-elevated/60">
                        <div className="flex items-center gap-2">
                          <Wrench className="h-3.5 w-3.5 text-brand-400" />
                          <span className="font-semibold text-slate-100">{tc.toolName}</span>
                          <span className="text-[10px] text-slate-400">{tc.durationMs}ms</span>
                        </div>
                        <StatusPill status={tc.status} className="text-[10px] py-0" />
                      </div>
                      <div className="p-3 space-y-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 block mb-0.5">{t('agentRuns.arguments')}</span>
                          <pre className="p-2 rounded bg-surface border border-border/40 text-slate-300 overflow-x-auto">
                            {safeJsonStringify(tc.args)}
                          </pre>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">{t('agentRuns.result')}</span>
                          <pre className="p-2 rounded bg-surface border border-border/40 text-slate-300 overflow-x-auto">
                            {safeJsonStringify(tc.result)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
