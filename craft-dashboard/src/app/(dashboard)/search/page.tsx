'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/error-alert';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchDetailDrawer } from '@/components/search/search-detail-drawer';
import {
  Search,
  RefreshCw,
  X,
  RotateCcw,
  Eye,
  Globe,
  ExternalLink,
  Play,
  Layers,
  HelpCircle,
  Radio,
} from 'lucide-react';
import { truncate, formatLatency, sanitizeSafeString } from '@/lib/utils';
import { AdminSearchItem, SearchDiagnosticResult } from '@/types/admin';

function SearchContent() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const { t, formatNumber, formatRelativeTime } = useLanguage();

  // Filters state
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');

  // Selected search item for detail drawer
  const [selectedSearch, setSelectedSearch] = useState<AdminSearchItem | null>(null);

  // Diagnostic Sandbox State
  const [testQuery, setTestQuery] = useState('');
  const [testIntent, setTestIntent] = useState('factual_lookup');
  const [diagnosticResult, setDiagnosticResult] = useState<SearchDiagnosticResult | null>(null);

  // Recent Searches Query
  const recentSearchesQuery = useQuery({
    queryKey: ['admin-search-recent'],
    queryFn: () => adminApi.getRecentSearches(),
  });

  const rawSearches = useMemo(() => recentSearchesQuery.data?.data || [], [recentSearchesQuery.data?.data]);

  // Client-side filtering across loaded records
  const filteredSearches = useMemo(() => {
    let result = rawSearches;

    if (statusFilter !== 'all') {
      result = result.filter((s) => (s.status || 'success').toLowerCase() === statusFilter);
    }

    if (providerFilter !== 'all') {
      result = result.filter((s) => (s.provider || 'direct').toLowerCase() === providerFilter.toLowerCase());
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((s) => {
        const queryMatch = (s.query || '').toLowerCase().includes(q);
        const provMatch = (s.provider || '').toLowerCase().includes(q);
        const idMatch = (s.id || '').toLowerCase().includes(q);
        return queryMatch || provMatch || idMatch;
      });
    }

    return result;
  }, [rawSearches, search, statusFilter, providerFilter]);

  // Unique providers list
  const uniqueProviders = useMemo(() => {
    const set = new Set<string>();
    rawSearches.forEach((s) => {
      if (s.provider) set.add(s.provider);
    });
    return Array.from(set).sort();
  }, [rawSearches]);

  // Operational KPI metrics computed from loaded records
  const {
    completedCount,
    failedCount,
    avgLatencyMs,
    avgSourcesPerQuery,
  } = useMemo(() => {
    let comp = 0;
    let fail = 0;
    let totalLat = 0;
    let latCount = 0;
    let totalSources = 0;

    rawSearches.forEach((s) => {
      const st = (s.status || '').toLowerCase();
      if (st === 'success') comp++;
      else if (st === 'error' || st === 'failed' || Boolean(s.error)) fail++;

      const lat = s.latencyMs;
      if (lat !== undefined && lat !== null && !isNaN(lat) && lat > 0) {
        totalLat += lat;
        latCount++;
      }

      const sources = s.sourceCount ?? s.resultCount ?? 0;
      totalSources += sources;
    });

    const avgLat = latCount > 0 ? totalLat / latCount : 0;
    const avgSrc = rawSearches.length > 0 ? (totalSources / rawSearches.length).toFixed(1) : '0';

    return {
      completedCount: comp,
      failedCount: fail,
      avgLatencyMs: avgLat,
      avgSourcesPerQuery: avgSrc,
    };
  }, [rawSearches]);

  // Provider breakdown computed dynamically from data
  const providerBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        provider: string;
        calls: number;
        success: number;
        failed: number;
        totalLat: number;
        latCount: number;
      }
    >();

    rawSearches.forEach((s) => {
      const p = s.provider || 'direct';
      if (!map.has(p)) {
        map.set(p, {
          provider: p,
          calls: 0,
          success: 0,
          failed: 0,
          totalLat: 0,
          latCount: 0,
        });
      }
      const entry = map.get(p)!;
      entry.calls++;
      const st = (s.status || '').toLowerCase();
      if (st === 'success') entry.success++;
      else if (st === 'error' || st === 'failed' || Boolean(s.error)) entry.failed++;

      if (s.latencyMs && s.latencyMs > 0) {
        entry.totalLat += s.latencyMs;
        entry.latCount++;
      }
    });

    return Array.from(map.values()).map((e) => ({
      ...e,
      successRate: e.calls > 0 ? ((e.success / e.calls) * 100).toFixed(1) + '%' : 'N/A',
      avgLatencyMs: e.latCount > 0 ? Math.round(e.totalLat / e.latCount) : 0,
    }));
  }, [rawSearches]);

  // Diagnostic Probe Mutation
  const diagnosticMutation = useMutation({
    mutationFn: () => adminApi.runSearchDiagnostic(testQuery.trim(), testIntent),
    onSuccess: (res) => {
      setDiagnosticResult(res.data);
    },
  });

  const handleRunDiagnostic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim()) return;
    diagnosticMutation.mutate();
  };

  const isFiltered = Boolean(search.trim() || statusFilter !== 'all' || providerFilter !== 'all');

  const activeFiltersCount =
    (search.trim() ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (providerFilter !== 'all' ? 1 : 0);

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setProviderFilter('all');
  };

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-400">
              <Globe className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
              {t('search.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('search.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => recentSearchesQuery.refetch()}
            disabled={recentSearchesQuery.isLoading}
            className="h-8 text-xs font-mono"
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 me-1.5 ${recentSearchesQuery.isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* 2. Search Operations KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('search.kpiOperations')}
          </span>
          <span className="text-xl font-bold text-foreground">
            {formatNumber(recentSearchesQuery.data?.pagination?.total ?? rawSearches.length)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('search.kpiSuccesses')}
          </span>
          <span className="text-xl font-bold text-emerald-500 dark:text-emerald-400">
            {formatNumber(completedCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('search.kpiFailures')}
          </span>
          <span className="text-xl font-bold text-rose-500">
            {formatNumber(failedCount)}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('search.kpiAvgLatency')}
          </span>
          <span className="text-xl font-bold text-cyan-400" dir="ltr">
            {formatLatency(avgLatencyMs)}
          </span>
        </div>

        {/* Query Refinements (Tracked/Untracked Metric) */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('search.kpiRefinements')}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-slate-400">
              {t('search.notAvailable')}
            </span>
            <span className="text-[10px] text-slate-500 block truncate">
              {t('search.notAvailableNote')}
            </span>
          </div>
        </div>

        {/* Cache Performance (Tracked/Untracked Metric) */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('search.kpiCacheHits')}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-slate-400">
              {t('search.notAvailable')}
            </span>
            <span className="text-[10px] text-slate-500 block truncate">
              {t('search.notAvailableNote')}
            </span>
          </div>
        </div>
      </div>

      {recentSearchesQuery.error && (
        <ErrorAlert
          error={recentSearchesQuery.error}
          title={t('search.failedToLoad')}
          onRetry={() => recentSearchesQuery.refetch()}
        />
      )}

      {/* 3. Operational Signals: Intent Status & Provider Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Provider Breakdown Table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-400" />
              <span>{t('search.providerBreakdownTitle')}</span>
            </CardTitle>
            <p className="text-[11px] text-slate-500">
              {t('search.providerBreakdownSubtitle')}
            </p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {providerBreakdown.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                {t('search.noSearches')}
              </div>
            ) : (
              <table className="w-full text-start text-[11px]">
                <thead className="bg-surface-elevated/40 border-b border-border text-slate-400">
                  <tr>
                    <th className="p-2.5 text-start font-semibold">{t('search.colProvider')}</th>
                    <th className="p-2.5 text-end font-semibold">{t('tools.colInvocations')}</th>
                    <th className="p-2.5 text-end font-semibold text-emerald-400">{t('tools.colSuccessCount')}</th>
                    <th className="p-2.5 text-end font-semibold text-rose-400">{t('tools.colFailCount')}</th>
                    <th className="p-2.5 text-end font-semibold">{t('tools.colSuccessRate')}</th>
                    <th className="p-2.5 text-end font-semibold">{t('search.colDuration')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono">
                  {providerBreakdown.map((pb) => (
                    <tr key={pb.provider} className="hover:bg-surface-elevated/30 transition-colors">
                      <td className="p-2.5 font-bold text-brand-300 uppercase">
                        {pb.provider}
                      </td>
                      <td className="p-2.5 text-end text-foreground">{pb.calls}</td>
                      <td className="p-2.5 text-end text-emerald-400 font-semibold">{pb.success}</td>
                      <td className="p-2.5 text-end text-rose-400 font-semibold">{pb.failed}</td>
                      <td className="p-2.5 text-end text-cyan-400">{pb.successRate}</td>
                      <td className="p-2.5 text-end text-slate-300" dir="ltr">{pb.avgLatencyMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Quality Signals & Intent Telemetry Status */}
        <div className="space-y-4">
          {/* Quality Signals Card */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-cyan-400" />
                <span>{t('search.qualitySignalsTitle')}</span>
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-amber-950/40 border border-amber-800 text-amber-300 font-semibold">
                {t('search.qualityTelemetryLimited')}
              </span>
            </div>

            <div className="p-2.5 rounded bg-surface-elevated/40 border border-border/40 flex items-center justify-between">
              <span className="text-slate-400 text-[11px]">{t('search.avgSourceCount')}</span>
              <span className="text-base font-bold text-cyan-400 font-mono">{avgSourcesPerQuery}</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t('search.qualitySignalsDesc')}
            </p>
          </Card>

          {/* Search Intent Status Notice (Section 13 Invariant) */}
          <Card className="p-4 space-y-2 border-dashed border-border/70 bg-surface/50">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <HelpCircle className="h-4 w-4 text-purple-400 shrink-0" />
              <span>{t('search.intentTelemetryUnavailable')}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t('search.intentUnavailableDesc')}
            </p>
          </Card>
        </div>
      </div>

      {/* 4. Filter Bar */}
      <Card className="p-4 transition-colors shadow-xs">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1 relative">
              <Input
                placeholder={t('search.filterPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                icon={<Search className="h-4 w-4" />}
                className="pe-8"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute end-2.5 top-2.5 p-0.5 text-slate-400 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Provider selector */}
            <div>
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All Providers</option>
                {uniqueProviders.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Status selector */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('tools.filterAllStatuses')}</option>
                <option value="success">{t('tools.filterStatusSuccess')}</option>
                <option value="error">{t('tools.filterStatusError')}</option>
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

                {providerFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                    <span>{providerFilter}</span>
                    <button onClick={() => setProviderFilter('all')} aria-label="Remove provider filter">
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

                <span className="text-[10px] text-slate-400 ms-1">
                  ({t('search.filteringLoadedResults')})
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

      {/* 5. Search Operations Explorer Table */}
      {filteredSearches.length === 0 && !recentSearchesQuery.isLoading && isFiltered ? (
        <Card className="p-8">
          <EmptyState
            title={t('search.noSearches')}
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
              header: t('search.colQuery'),
              accessorKey: 'query',
              className: 'min-w-[220px]',
              cell: (s) => (
                <div className="font-mono">
                  <span className="font-semibold text-foreground block truncate max-w-xs sm:max-w-md" dir="ltr">
                    {sanitizeSafeString(s.query)}
                  </span>
                </div>
              ),
            },
            {
              header: t('search.colProvider'),
              accessorKey: 'provider',
              className: 'w-28',
              cell: (s) => (
                <Badge variant="purple" className="uppercase font-mono text-[10px]">
                  {s.provider || 'direct'}
                </Badge>
              ),
            },
            {
              header: t('search.colSources'),
              accessorKey: 'sourceCount',
              className: 'w-24 text-center',
              cell: (s) => (
                <span className="text-foreground font-semibold">
                  {s.sourceCount ?? s.resultCount ?? 0}
                </span>
              ),
            },
            {
              header: t('search.colStatus'),
              accessorKey: 'status',
              className: 'w-24',
              cell: (s) => <StatusBadge status={s.status || 'success'} size="xs" showDot={true} />,
            },
            {
              header: t('search.colDuration'),
              accessorKey: 'latencyMs',
              className: 'w-24',
              cell: (s) => (
                <span className="text-cyan-400 font-semibold" dir="ltr">
                  {formatLatency(s.latencyMs)}
                </span>
              ),
            },
            {
              header: t('search.colTimestamp'),
              accessorKey: 'createdAt',
              className: 'w-32',
              cell: (s) => (
                <span className="text-slate-400 text-xs">
                  {formatRelativeTime(s.freshness || s.createdAt)}
                </span>
              ),
            },
            {
              header: t('common.actions'),
              className: 'w-28 text-end',
              cell: (s) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedSearch(s)}
                  className="h-7 text-xs font-mono"
                  title="Inspect Search Details"
                >
                  <Eye className="h-3 w-3 me-1" />
                  <span>Inspect</span>
                </Button>
              ),
            },
          ]}
          data={filteredSearches}
          isLoading={recentSearchesQuery.isLoading}
          emptyMessage={t('search.noSearches')}
          onRowClick={(s) => setSelectedSearch(s)}
        />
      )}

      {/* 6. Interactive Search Diagnostic Sandbox (Safe dry-run probe) */}
      <Card className="mt-8 border border-border/80">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Globe className="h-4 w-4 text-cyan-400" />
              <span>{t('search.sandboxTitle')}</span>
            </CardTitle>
            <span className="text-[10px] text-slate-500 font-mono">
              {t('search.diagnosticDryRunNote')}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <form onSubmit={handleRunDiagnostic} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <Input
                placeholder={t('search.queryPlaceholder')}
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                icon={<Search className="h-4 w-4" />}
                required
              />
            </div>
            <div>
              <select
                value={testIntent}
                onChange={(e) => setTestIntent(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-foreground focus:outline-none"
              >
                <option value="factual_lookup">{t('search.intentFactual')}</option>
                <option value="price_inquiry">{t('search.intentPrice')}</option>
                <option value="news_recent">{t('search.intentNews')}</option>
                <option value="technical">{t('search.intentTechnical')}</option>
              </select>
            </div>
            <div>
              <Button
                type="submit"
                variant="brand"
                className="w-full h-9 font-mono text-xs"
                isLoading={diagnosticMutation.isPending}
              >
                <Play className="h-3.5 w-3.5 me-1" />
                {t('search.btnRunProbe')}
              </Button>
            </div>
          </form>

          {/* Diagnostic Result Preview */}
          {diagnosticResult && (
            <div className="p-4 rounded-lg bg-surface-elevated/40 border border-border font-mono text-xs space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{t('search.provider')}:</span>
                  <Badge variant="purple" className="uppercase">{diagnosticResult.provider}</Badge>
                  <span className="text-slate-400 ms-2">{t('search.latency')}</span>
                  <span className="font-bold text-cyan-400">{diagnosticResult.latencyMs}ms</span>
                </div>
                <StatusBadge status={diagnosticResult.status === 'success' ? 'success' : 'failed'} size="xs" showDot={true} />
              </div>

              <div>
                <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">
                  {t('search.sampleResults', { count: String(diagnosticResult.sampleResults?.length || 0) })}
                </span>
                <div className="space-y-2">
                  {diagnosticResult.sampleResults?.map((res, i) => (
                    <div key={i} className="p-2.5 rounded bg-surface border border-border/40 space-y-1">
                      <div className="flex items-center justify-between">
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-brand-300 hover:underline flex items-center gap-1"
                        >
                          {res.title}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <span className="text-[10px] text-slate-400" dir="ltr">{truncate(res.url, 40)}</span>
                      </div>
                      <p className="text-slate-300 font-sans text-xs leading-relaxed">{res.snippet}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 7. Search Detail Drawer */}
      <SearchDetailDrawer
        searchItem={selectedSearch}
        isOpen={Boolean(selectedSearch)}
        onClose={() => setSelectedSearch(null)}
      />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-mono text-slate-400">Loading Search Intelligence...</div>}>
      <SearchContent />
    </Suspense>
  );
}
