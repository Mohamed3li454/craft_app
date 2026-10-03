'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/error-alert';
import { EmptyState } from '@/components/ui/empty-state';
import { ReasoningBanner } from '@/components/ui/reasoning-banner';
import { TraceExplorerWorkspace } from '@/components/agent-runs/trace-explorer-workspace';
import {
  Search,
  RefreshCw,
  X,
  RotateCcw,
  Eye,
  Cpu,
  ExternalLink,
} from 'lucide-react';
import { truncate, formatLatency } from '@/lib/utils';

function AgentRunsContent() {
  const searchParams = useSearchParams();
  const initialRunId = searchParams.get('runId') || null;
  const initialSearch = searchParams.get('search') || '';

  const { t, formatNumber, formatRelativeTime } = useLanguage();

  // Search & Filter State
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState('all');
  const [toolFilter, setToolFilter] = useState<'all' | 'with_tools' | 'no_tools'>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Selected Run for Trace Explorer Drawer
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);

  const queryParams = {
    status: statusFilter === 'all' ? undefined : statusFilter,
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-agent-runs', queryParams],
    queryFn: () => adminApi.getAgentRuns(queryParams),
  });

  const rawRuns = useMemo(() => data?.data || [], [data?.data]);

  // Client-side search and tool filter across loaded records
  const runs = useMemo(() => {
    let result = rawRuns;

    // Filter by tool invocation status
    if (toolFilter === 'with_tools') {
      result = result.filter((r) => (r.toolCallsCount ?? 0) > 0);
    } else if (toolFilter === 'no_tools') {
      result = result.filter((r) => (r.toolCallsCount ?? 0) === 0);
    }

    // Filter by search query (runId, conversationId, userPrompt, model)
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((r) => {
        const idMatch = (r.id || '').toLowerCase().includes(q);
        const convMatch = (r.conversationId || '').toLowerCase().includes(q);
        const promptMatch = (r.userPrompt || '').toLowerCase().includes(q);
        const modelMatch = (r.model || '').toLowerCase().includes(q);
        return idMatch || convMatch || promptMatch || modelMatch;
      });
    }

    return result;
  }, [rawRuns, toolFilter, search]);

  const total = data?.pagination?.total;

  const isFiltered = Boolean(search.trim() || statusFilter !== 'all' || toolFilter !== 'all');

  const activeFiltersCount =
    (search.trim() ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (toolFilter !== 'all' ? 1 : 0);

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setToolFilter('all');
    setPage(1);
  };

  // Operational KPI metrics computed from loaded records
  const { completedCount, failedCount, runningCount, totalToolsCount, avgLatencyMs } = useMemo(() => {
    let comp = 0;
    let fail = 0;
    let run = 0;
    let tools = 0;
    let totalDur = 0;
    let durCount = 0;

    rawRuns.forEach((r) => {
      const st = (r.status || '').toLowerCase();
      if (st === 'completed') comp++;
      else if (st === 'failed') fail++;
      else if (st === 'running') run++;

      tools += r.toolCallsCount || 0;

      const dur = r.durationMs ?? r.latencyMs;
      if (dur !== undefined && dur !== null && dur > 0) {
        totalDur += dur;
        durCount++;
      }
    });

    const avg = durCount > 0 ? totalDur / durCount : 0;
    return {
      completedCount: comp,
      failedCount: fail,
      runningCount: run,
      totalToolsCount: tools,
      avgLatencyMs: avg,
    };
  }, [rawRuns]);

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-brand-500/10 border border-brand-500/25 text-brand-600 dark:text-brand-400">
              <Cpu className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {t('agentRuns.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('agentRuns.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Status selector */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-8 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">{t('agentRuns.filterAll')}</option>
            <option value="completed">{t('agentRuns.filterCompleted')}</option>
            <option value="failed">{t('agentRuns.filterFailed')}</option>
            <option value="running">{t('agentRuns.filterRunning')}</option>
            <option value="interrupted">{t('agentRuns.filterInterrupted')}</option>
          </select>

          {/* Tool filter */}
          <select
            value={toolFilter}
            onChange={(e) => {
              setToolFilter(e.target.value as any);
              setPage(1);
            }}
            className="h-8 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">{t('agentRuns.filterAllTools')}</option>
            <option value="with_tools">{t('agentRuns.filterWithTools')}</option>
            <option value="no_tools">{t('agentRuns.filterNoTools')}</option>
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-8 text-xs font-mono"
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 me-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* 2. Reasoning Safety Callout Banner */}
      <ReasoningBanner />

      {/* 3. Operational KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('agentRuns.totalRuns')}
          </span>
          <span className="text-xl font-bold text-foreground">
            {formatNumber(total ?? rawRuns.length)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('agentRuns.successfulRuns')}
          </span>
          <span className="text-xl font-bold text-emerald-500 dark:text-emerald-400">
            {formatNumber(completedCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('agentRuns.failedRuns')}
          </span>
          <span className="text-xl font-bold text-rose-500">
            {formatNumber(failedCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('agentRuns.runningRuns')}
          </span>
          <span className="text-xl font-bold text-brand-500 dark:text-brand-400">
            {formatNumber(runningCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('agentRuns.totalTools')}
          </span>
          <span className="text-xl font-bold text-purple-400">
            {formatNumber(totalToolsCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('agentRuns.avgLatency')}
          </span>
          <span className="text-xl font-bold text-cyan-400" dir="ltr">
            {formatLatency(avgLatencyMs)}
          </span>
        </div>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title={t('agentRuns.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}

      {/* 4. Search Bar & Active Filters */}
      <Card className="p-4 transition-colors shadow-xs">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Input
              placeholder={t('agentRuns.searchPlaceholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              icon={<Search className="h-4 w-4" />}
              className="pe-8"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
                className="absolute end-2.5 top-2.5 p-0.5 text-slate-400 hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Active Filters Pill Strip */}
          {isFiltered && (
            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[11px] font-mono text-slate-500 dark:text-slate-400 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span>{t('agentRuns.activeFilters', { count: String(activeFiltersCount) })}:</span>

                {search.trim() && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground">
                    <span>&quot;{truncate(search.trim(), 16)}&quot;</span>
                    <button onClick={() => setSearch('')} aria-label="Remove search filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}

                {statusFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                    <span>{statusFilter}</span>
                    <button onClick={() => setStatusFilter('all')} aria-label="Remove status filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}

                {toolFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                    <span>{toolFilter}</span>
                    <button onClick={() => setToolFilter('all')} aria-label="Remove tool filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="h-7 text-xs font-mono border-dashed text-slate-500 dark:text-slate-400 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3 me-1.5" />
                {t('agentRuns.clearFilters')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* 5. Runs DataTable */}
      {runs.length === 0 && !isLoading && isFiltered ? (
        <Card className="p-8">
          <EmptyState
            title={t('agentRuns.noFilteredRuns')}
            description=""
            action={{
              label: t('agentRuns.clearFilters'),
              onClick: handleClearFilters,
              icon: RotateCcw,
            }}
            className="border-none bg-transparent"
          />
        </Card>
      ) : (
        <DataTable
          columns={[
            {
              header: t('agentRuns.colRunId'),
              accessorKey: 'id',
              className: 'min-w-[170px]',
              cell: (r) => (
                <div className="font-mono">
                  <span className="font-bold text-foreground block truncate" dir="ltr">
                    {truncate(r.id, 14)}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {formatRelativeTime(r.createdAt)}
                  </span>
                </div>
              ),
            },
            {
              header: t('navigation.conversations'),
              accessorKey: 'conversationId',
              className: 'min-w-[150px]',
              cell: (r) => (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="font-mono text-slate-400 text-xs truncate max-w-[110px]" dir="ltr">
                    {truncate(r.conversationId, 12)}
                  </span>
                  <Link
                    href={`/conversations?id=${r.conversationId}`}
                    className="p-1 rounded text-slate-400 hover:text-brand-400 hover:bg-surface-elevated transition-colors"
                    title={t('agentRuns.openConversation')}
                    aria-label={t('agentRuns.openConversation')}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              ),
            },
            {
              header: t('agentRuns.colStatus'),
              accessorKey: 'status',
              className: 'w-24',
              cell: (r) => <StatusBadge status={r.status} size="xs" showDot={true} />,
            },
            {
              header: t('agentRuns.colIterations'),
              accessorKey: 'iterationsCount',
              className: 'w-24 text-center',
              cell: (r) => (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-surface-elevated border border-border text-foreground">
                  {t('agentRuns.iterationsBadge', { count: String(r.iterationsCount || 1) })}
                </span>
              ),
            },
            {
              header: t('agentRuns.colDuration'),
              accessorKey: 'durationMs',
              className: 'w-24',
              cell: (r) => (
                <span className="text-cyan-400 font-semibold" dir="ltr">
                  {formatLatency(r.durationMs ?? r.latencyMs)}
                </span>
              ),
            },
            {
              header: t('agentRuns.colToolCalls'),
              accessorKey: 'toolCallsCount',
              className: 'w-28 text-center',
              cell: (r) => {
                const count = r.toolCallsCount ?? 0;
                return (
                  <Badge variant={count > 0 ? 'purple' : 'neutral'}>
                    {t('agentRuns.toolsCount', { count: String(count) })}
                  </Badge>
                );
              },
            },
            {
              header: t('agentRuns.colModel'),
              accessorKey: 'model',
              className: 'min-w-[130px]',
              cell: (r) => (
                <span className="text-brand-300 font-medium truncate block" dir="ltr">
                  {r.model || '—'}
                </span>
              ),
            },
            {
              header: t('common.actions'),
              className: 'w-28 text-end',
              cell: (r) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedRunId(r.id)}
                  className="h-7 text-xs font-mono"
                  title={t('agentRuns.viewTrace')}
                >
                  <Eye className="h-3 w-3 me-1" />
                  <span>{t('agentRuns.viewTrace')}</span>
                </Button>
              ),
            },
          ]}
          data={runs}
          isLoading={isLoading}
          emptyMessage={t('agentRuns.noRuns')}
          onRowClick={(r) => setSelectedRunId(r.id)}
          pagination={{
            currentPage: page,
            hasMore: total !== undefined ? page * limit < total : runs.length === limit,
            onNext: () => setPage((p) => p + 1),
            onPrev: () => setPage((p) => Math.max(1, p - 1)),
            total,
          }}
        />
      )}

      {/* 6. Dedicated Trace Explorer Workspace */}
      <TraceExplorerWorkspace
        runId={selectedRunId}
        isOpen={Boolean(selectedRunId)}
        onClose={() => setSelectedRunId(null)}
      />
    </div>
  );
}

export default function AgentRunsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-mono text-slate-400">Loading Agent Runs...</div>}>
      <AgentRunsContent />
    </Suspense>
  );
}
