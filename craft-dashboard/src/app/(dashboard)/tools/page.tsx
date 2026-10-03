'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/error-alert';
import { EmptyState } from '@/components/ui/empty-state';
import { ToolDetailDrawer } from '@/components/tools/tool-detail-drawer';
import {
  Wrench,
  Search,
  RefreshCw,
  X,
  RotateCcw,
  Eye,
  Clock,
  Zap,
  BarChart3,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { truncate, formatLatency } from '@/lib/utils';
import { AdminToolCallItem } from '@/types/admin';

function ToolsContent() {
  const searchParams = useSearchParams();
  const initialToolCallId = searchParams.get('toolCallId') || null;
  const initialSearch = searchParams.get('search') || '';

  const { t, formatNumber, formatRelativeTime } = useLanguage();

  // Filters state
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedToolFilter, setSelectedToolFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Selected tool call for inspector drawer
  const [selectedToolCall, setSelectedToolCall] = useState<AdminToolCallItem | null>(null);

  const queryParams = {
    limit,
    offset: (page - 1) * limit,
    status: statusFilter === 'all' ? undefined : statusFilter,
    toolName: selectedToolFilter === 'all' ? undefined : selectedToolFilter,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-tool-calls', queryParams],
    queryFn: () => adminApi.getToolCalls(queryParams),
  });

  const rawToolCalls = useMemo(() => data?.data || [], [data?.data]);

  // Client-side search across loaded records (toolName, runId, id)
  const toolCalls = useMemo(() => {
    let result = rawToolCalls;
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((tc) => {
        const nameMatch = (tc.toolName || '').toLowerCase().includes(q);
        const runMatch = (tc.runId || tc.agentRunId || '').toLowerCase().includes(q);
        const idMatch = (tc.id || '').toLowerCase().includes(q);
        return nameMatch || runMatch || idMatch;
      });
    }
    return result;
  }, [rawToolCalls, search]);

  const total = data?.pagination?.total;

  // Auto-open drawer if toolCallId passed via URL query
  React.useEffect(() => {
    if (initialToolCallId && rawToolCalls.length > 0 && !selectedToolCall) {
      const match = rawToolCalls.find((tc) => tc.id === initialToolCallId);
      if (match) {
        setSelectedToolCall(match);
      }
    }
  }, [initialToolCallId, rawToolCalls, selectedToolCall]);

  // Extract unique tool names for the dropdown filter
  const uniqueToolNames = useMemo(() => {
    const set = new Set<string>();
    rawToolCalls.forEach((tc) => {
      if (tc.toolName) set.add(tc.toolName);
    });
    return Array.from(set).sort();
  }, [rawToolCalls]);

  // Operational KPI metrics computed from loaded records
  const {
    completedCount,
    failedCount,
    runningCount,
    successRate,
    avgDurationMs,
    minDurationMs,
    maxDurationMs,
  } = useMemo(() => {
    let comp = 0;
    let fail = 0;
    let run = 0;
    let totalDur = 0;
    let validDurCount = 0;
    let minD = Infinity;
    let maxD = 0;

    rawToolCalls.forEach((tc) => {
      const st = (tc.status || '').toLowerCase();
      if (st === 'success') comp++;
      else if (st === 'error' || st === 'failed' || Boolean(tc.errorMessage)) fail++;
      else if (st === 'running') run++;

      const dur = tc.durationMs;
      if (dur !== undefined && dur !== null && !isNaN(dur) && dur > 0) {
        totalDur += dur;
        validDurCount++;
        if (dur < minD) minD = dur;
        if (dur > maxD) maxD = dur;
      }
    });

    const totalCalculated = comp + fail;
    const rate = totalCalculated > 0 ? ((comp / totalCalculated) * 100).toFixed(1) + '%' : 'N/A';
    const avg = validDurCount > 0 ? totalDur / validDurCount : 0;

    return {
      completedCount: comp,
      failedCount: fail,
      runningCount: run,
      successRate: rate,
      avgDurationMs: avg,
      minDurationMs: minD === Infinity ? 0 : minD,
      maxDurationMs: maxD,
    };
  }, [rawToolCalls]);

  // Dynamic aggregation per tool
  const toolPerformanceData = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        calls: number;
        success: number;
        failed: number;
        totalDur: number;
        validDurCount: number;
        minDur: number;
        maxDur: number;
      }
    >();

    rawToolCalls.forEach((tc) => {
      const name = tc.toolName || 'unknown';
      if (!map.has(name)) {
        map.set(name, {
          name,
          calls: 0,
          success: 0,
          failed: 0,
          totalDur: 0,
          validDurCount: 0,
          minDur: Infinity,
          maxDur: 0,
        });
      }
      const entry = map.get(name)!;
      entry.calls++;
      const st = (tc.status || '').toLowerCase();
      if (st === 'success') entry.success++;
      else if (st === 'error' || st === 'failed' || Boolean(tc.errorMessage)) entry.failed++;

      const dur = tc.durationMs;
      if (dur !== undefined && dur !== null && !isNaN(dur) && dur > 0) {
        entry.totalDur += dur;
        entry.validDurCount++;
        if (dur < entry.minDur) entry.minDur = dur;
        if (dur > entry.maxDur) entry.maxDur = dur;
      }
    });

    return Array.from(map.values()).map((e) => {
      const successPct = e.calls > 0 ? ((e.success / e.calls) * 100).toFixed(1) + '%' : 'N/A';
      const avg = e.validDurCount > 0 ? Math.round(e.totalDur / e.validDurCount) : 0;
      return {
        ...e,
        successRate: successPct,
        avgDurationMs: avg,
        minDurationMs: e.minDur === Infinity ? 0 : e.minDur,
      };
    });
  }, [rawToolCalls]);

  // Fastest and slowest tool determination
  const { fastestTool, slowestTool } = useMemo(() => {
    const valid = toolPerformanceData.filter((t) => t.avgDurationMs > 0);
    if (valid.length === 0) return { fastestTool: null, slowestTool: null };
    valid.sort((a, b) => a.avgDurationMs - b.avgDurationMs);
    return {
      fastestTool: valid[0],
      slowestTool: valid[valid.length - 1],
    };
  }, [toolPerformanceData]);

  // Top failing tools
  const topFailingTools = useMemo(() => {
    return toolPerformanceData
      .filter((t) => t.failed > 0)
      .sort((a, b) => b.failed - a.failed)
      .slice(0, 3);
  }, [toolPerformanceData]);

  const isFiltered = Boolean(search.trim() || statusFilter !== 'all' || selectedToolFilter !== 'all');

  const activeFiltersCount =
    (search.trim() ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (selectedToolFilter !== 'all' ? 1 : 0);

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setSelectedToolFilter('all');
    setPage(1);
  };

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/25 text-purple-400">
              <Wrench className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
              {t('tools.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('tools.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
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

      {/* 2. Tool Telemetry KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('tools.kpiTotalCalls')}
          </span>
          <span className="text-xl font-bold text-foreground">
            {formatNumber(total ?? rawToolCalls.length)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('tools.kpiSuccessCalls')}
          </span>
          <span className="text-xl font-bold text-emerald-500 dark:text-emerald-400">
            {formatNumber(completedCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('tools.kpiFailedCalls')}
          </span>
          <span className="text-xl font-bold text-rose-500">
            {formatNumber(failedCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('tools.kpiSuccessRate')}
          </span>
          <span className="text-xl font-bold text-cyan-400">
            {successRate}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('tools.kpiAvgDuration')}
          </span>
          <span className="text-xl font-bold text-purple-400" dir="ltr">
            {formatLatency(avgDurationMs)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('tools.kpiActiveCalls')}
          </span>
          <span className="text-xl font-bold text-brand-500 dark:text-brand-400">
            {formatNumber(runningCount)}
          </span>
        </div>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title={t('tools.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}

      {/* 3. Operational Analysis: Performance Overview & Latency Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tool Performance Overview Table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-purple-400" />
              <span>{t('tools.perfOverviewTitle')}</span>
            </CardTitle>
            <p className="text-[11px] text-slate-500">
              {t('tools.perfOverviewSubtitle')}
            </p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {toolPerformanceData.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                {t('tools.noTools')}
              </div>
            ) : (
              <table className="w-full text-start text-[11px]">
                <thead className="bg-surface-elevated/40 border-b border-border text-slate-400">
                  <tr>
                    <th className="p-2.5 text-start font-semibold">{t('tools.colToolName')}</th>
                    <th className="p-2.5 text-end font-semibold">{t('tools.colInvocations')}</th>
                    <th className="p-2.5 text-end font-semibold text-emerald-400">{t('tools.colSuccessCount')}</th>
                    <th className="p-2.5 text-end font-semibold text-rose-400">{t('tools.colFailCount')}</th>
                    <th className="p-2.5 text-end font-semibold">{t('tools.colSuccessRate')}</th>
                    <th className="p-2.5 text-end font-semibold">{t('tools.colAvgDuration')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono">
                  {toolPerformanceData.map((tp) => (
                    <tr key={tp.name} className="hover:bg-surface-elevated/30 transition-colors">
                      <td className="p-2.5 font-bold text-foreground flex items-center gap-1.5" dir="ltr">
                        <Wrench className="h-3 w-3 text-purple-400" />
                        <span>{tp.name}</span>
                      </td>
                      <td className="p-2.5 text-end text-foreground">{tp.calls}</td>
                      <td className="p-2.5 text-end text-emerald-400 font-semibold">{tp.success}</td>
                      <td className="p-2.5 text-end text-rose-400 font-semibold">{tp.failed}</td>
                      <td className="p-2.5 text-end text-cyan-400">{tp.successRate}</td>
                      <td className="p-2.5 text-end text-slate-300" dir="ltr">{tp.avgDurationMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Latency Intelligence & Failure Analysis */}
        <div className="space-y-4">
          {/* Latency Card */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider pb-2 border-b border-border/50">
              <Clock className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t('tools.latencyIntelligenceTitle')}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2.5 rounded bg-surface-elevated/40 border border-border/40">
                <span className="text-slate-500 text-[10px] block uppercase">{t('tools.minDuration')}</span>
                <span className="font-bold text-cyan-400 text-sm" dir="ltr">{minDurationMs}ms</span>
              </div>
              <div className="p-2.5 rounded bg-surface-elevated/40 border border-border/40">
                <span className="text-slate-500 text-[10px] block uppercase">{t('tools.maxDuration')}</span>
                <span className="font-bold text-purple-400 text-sm" dir="ltr">{maxDurationMs}ms</span>
              </div>
            </div>

            {fastestTool && (
              <div className="p-2 rounded bg-emerald-950/20 border border-emerald-900/40 text-[11px] flex items-center justify-between">
                <span className="text-emerald-400 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  <span>{t('tools.fastestTool')}:</span>
                </span>
                <span className="font-bold text-foreground font-mono" dir="ltr">
                  {fastestTool.name} ({fastestTool.avgDurationMs}ms)
                </span>
              </div>
            )}

            {slowestTool && slowestTool.name !== fastestTool?.name && (
              <div className="p-2 rounded bg-amber-950/20 border border-amber-900/40 text-[11px] flex items-center justify-between">
                <span className="text-amber-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{t('tools.slowestTool')}:</span>
                </span>
                <span className="font-bold text-foreground font-mono" dir="ltr">
                  {slowestTool.name} ({slowestTool.avgDurationMs}ms)
                </span>
              </div>
            )}
          </Card>

          {/* Failure Analysis Card */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-rose-400 uppercase tracking-wider pb-2 border-b border-border/50">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>{t('tools.failureAnalysisTitle')}</span>
            </div>

            {topFailingTools.length === 0 ? (
              <p className="text-[11px] text-slate-500 py-1">
                {t('tools.noFailures')}
              </p>
            ) : (
              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-500 uppercase block">
                  {t('tools.topFailingTools')}
                </span>
                {topFailingTools.map((tFail) => (
                  <div key={tFail.name} className="flex items-center justify-between p-2 rounded bg-rose-950/20 border border-rose-900/40 text-[11px]">
                    <span className="font-bold text-foreground font-mono" dir="ltr">{tFail.name}</span>
                    <span className="text-rose-400 font-semibold">{tFail.failed} failed</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* 4. Filter Bar */}
      <Card className="p-4 transition-colors shadow-xs">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1 relative">
              <Input
                placeholder={t('tools.filterPlaceholder')}
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

            {/* Status selector */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('tools.filterAllStatuses')}</option>
                <option value="success">{t('tools.filterStatusSuccess')}</option>
                <option value="error">{t('tools.filterStatusError')}</option>
                <option value="running">{t('tools.filterStatusRunning')}</option>
              </select>
            </div>

            {/* Tool name selector */}
            <div>
              <select
                value={selectedToolFilter}
                onChange={(e) => {
                  setSelectedToolFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('tools.filterAllTools')}</option>
                {uniqueToolNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Filters Pill Strip */}
          {isFiltered && (
            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[11px] font-mono text-slate-500 dark:text-slate-400 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span>{t('tools.activeFilters', { count: String(activeFiltersCount) })}:</span>

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

                {selectedToolFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground">
                    <span>{selectedToolFilter}</span>
                    <button onClick={() => setSelectedToolFilter('all')} aria-label="Remove tool filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}

                <span className="text-[10px] text-slate-400 ms-1">
                  ({t('tools.filteringLoadedResults')})
                </span>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="h-7 text-xs font-mono border-dashed text-slate-500 dark:text-slate-400 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3 me-1.5" />
                {t('tools.clearFilters')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* 5. Tool Calls DataTable */}
      {toolCalls.length === 0 && !isLoading && isFiltered ? (
        <Card className="p-8">
          <EmptyState
            title={t('tools.noTools')}
            description=""
            action={{
              label: t('tools.clearFilters'),
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
              header: t('tools.colToolName'),
              accessorKey: 'toolName',
              className: 'min-w-[160px]',
              cell: (tc) => (
                <div className="flex items-center gap-2 font-mono">
                  <Wrench className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                  <span className="font-bold text-foreground" dir="ltr">{tc.toolName}</span>
                </div>
              ),
            },
            {
              header: t('tools.colStatus'),
              accessorKey: 'status',
              className: 'w-24',
              cell: (tc) => <StatusBadge status={tc.status} size="xs" showDot={true} />,
            },
            {
              header: t('tools.colDuration'),
              accessorKey: 'durationMs',
              className: 'w-24',
              cell: (tc) => (
                <span className="text-cyan-400 font-semibold" dir="ltr">
                  {formatLatency(tc.durationMs)}
                </span>
              ),
            },
            {
              header: t('tools.runId'),
              accessorKey: 'runId',
              className: 'min-w-[150px]',
              cell: (tc) => {
                const rId = tc.runId || tc.agentRunId;
                if (!rId) return <span className="text-slate-500">—</span>;
                return (
                  <div className="flex items-center gap-1.5 font-mono" onClick={(e) => e.stopPropagation()}>
                    <span className="text-slate-400 text-xs truncate max-w-[110px]" dir="ltr">
                      {truncate(rId, 12)}
                    </span>
                    <Link
                      href={`/agent-runs?runId=${encodeURIComponent(rId)}`}
                      className="p-1 rounded text-slate-400 hover:text-brand-400 hover:bg-surface-elevated transition-colors"
                      title={t('tools.openAgentRun')}
                      aria-label={t('tools.openAgentRun')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                );
              },
            },
            {
              header: t('tools.executedAt'),
              accessorKey: 'createdAt',
              className: 'w-32',
              cell: (tc) => (
                <span className="text-slate-400 text-xs">
                  {formatRelativeTime(tc.createdAt)}
                </span>
              ),
            },
            {
              header: t('common.actions'),
              className: 'w-28 text-end',
              cell: (tc) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedToolCall(tc)}
                  className="h-7 text-xs font-mono"
                  title={t('tools.btnViewPayload')}
                >
                  <Eye className="h-3 w-3 me-1" />
                  <span>{t('tools.btnViewPayload')}</span>
                </Button>
              ),
            },
          ]}
          data={toolCalls}
          isLoading={isLoading}
          emptyMessage={t('tools.noTools')}
          onRowClick={(tc) => setSelectedToolCall(tc)}
          pagination={{
            currentPage: page,
            hasMore: total !== undefined ? page * limit < total : toolCalls.length === limit,
            onNext: () => setPage((p) => p + 1),
            onPrev: () => setPage((p) => Math.max(1, p - 1)),
            total,
          }}
        />
      )}

      {/* 6. Tool Call Inspection Drawer */}
      <ToolDetailDrawer
        toolCall={selectedToolCall}
        isOpen={Boolean(selectedToolCall)}
        onClose={() => setSelectedToolCall(null)}
      />
    </div>
  );
}

export default function ToolsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-mono text-slate-400">Loading Tool Telemetry...</div>}>
      <ToolsContent />
    </Suspense>
  );
}
