'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/error-alert';
import { DataTable } from '@/components/ui/data-table';
import {
  ErrorDetailDrawer,
  OperationalErrorRecord,
} from '@/components/observability/error-detail-drawer';
import {
  Activity,
  Server,
  Zap,
  ShieldCheck,
  RefreshCw,
  Database,
  Cpu,
  Globe,
  Layers,
  ExternalLink,
  AlertTriangle,
  Eye,
  BarChart3,
} from 'lucide-react';
import {
  formatDate,
  formatLatency,
  formatNumber,
  formatTokens,
  formatCurrency,
  truncate,
  sanitizeSafeErrorDetails,
} from '@/lib/utils';
import { AdminAgentRunItem, AdminToolCallItem } from '@/types/admin';

function ObservabilityContent() {
  const router = useRouter();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { t, formatRelativeTime } = useLanguage();

  // Correlation Explorer Input
  const [correlationInput, setCorrelationInput] = useState('');

  // Selected error for diagnostic drawer
  const [selectedError, setSelectedError] = useState<OperationalErrorRecord | null>(null);

  // 1. System Health Snapshot Query
  const healthQuery = useQuery({
    queryKey: ['observability-health'],
    queryFn: () => adminApi.getHealth(),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  // 2. Metrics Registry Snapshot Query
  const metricsQuery = useQuery({
    queryKey: ['observability-metrics'],
    queryFn: () => adminApi.getMetrics(),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  // 3. Semantic Cache Metrics Query
  const cacheMetricsQuery = useQuery({
    queryKey: ['observability-cache-metrics'],
    queryFn: () => adminApi.getCacheMetrics(),
    refetchInterval: autoRefresh ? 30000 : false,
  });

  // 4. Recent Failed Agent Runs (for Error Intelligence)
  const failedRunsQuery = useQuery({
    queryKey: ['observability-failed-runs'],
    queryFn: () => adminApi.getAgentRuns({ status: 'failed', limit: 10 }),
    refetchInterval: autoRefresh ? 15000 : false,
  });

  // 5. Recent Failed Tool Calls (for Error Intelligence)
  const failedToolsQuery = useQuery({
    queryKey: ['observability-failed-tools'],
    queryFn: () => adminApi.getToolCalls({ status: 'error', limit: 10 }),
    refetchInterval: autoRefresh ? 15000 : false,
  });

  const healthData = healthQuery.data?.data;
  const snapshot = healthData?.snapshot;
  const metricsData = metricsQuery.data?.data;
  const cacheData = cacheMetricsQuery.data?.data;

  const uptimeSeconds = healthData?.uptimeSeconds ?? snapshot?.uptimeSeconds;
  const formatUptime = (sec: number | undefined) => {
    if (!sec && sec !== 0) return '—';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${hrs}h ${mins}m ${s}s`;
  };

  // Compile Unified Operational Errors from real server records
  const recentErrors = useMemo<OperationalErrorRecord[]>(() => {
    const records: OperationalErrorRecord[] = [];

    // Failed Agent Runs
    const runs = (failedRunsQuery.data?.data || []) as AdminAgentRunItem[];
    runs.forEach((r) => {
      records.push({
        id: r.id,
        timestamp: r.completedAt || r.createdAt,
        service: 'agent',
        severity: 'high',
        errorType: r.errorDetails ? 'AGENT_EXECUTION_FAILURE' : 'AGENT_RUN_FAILED',
        errorMessage: r.errorDetails || 'Agent execution failed before completion',
        runId: r.id,
        correlationId: r.conversationId,
        durationMs: r.durationMs ?? r.latencyMs,
        metadata: {
          model: r.model,
          provider: r.provider,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          toolCallsCount: r.toolCallsCount,
        },
      });
    });

    // Failed Tool Calls
    const tools = (failedToolsQuery.data?.data || []) as AdminToolCallItem[];
    tools.forEach((tc) => {
      records.push({
        id: tc.id,
        timestamp: tc.completedAt || tc.createdAt,
        service: 'tools',
        severity: 'medium',
        errorType: `${(tc.toolName || 'tool').toUpperCase()}_ERROR`,
        errorMessage: tc.errorMessage || 'Tool invocation encountered an unhandled exception',
        runId: tc.runId || tc.agentRunId,
        toolCallId: tc.id,
        durationMs: tc.durationMs,
        metadata: {
          toolName: tc.toolName,
          status: tc.status,
        },
      });
    });

    // Sort descending by timestamp
    return records.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [failedRunsQuery.data?.data, failedToolsQuery.data?.data]);

  // AI Histograms from Metrics Registry
  const histograms = metricsData?.histograms || {};

  // Handlers for Correlation Explorer
  const handleCorrelationNavigate = (target: 'run' | 'tool' | 'conv' | 'audit') => {
    const id = correlationInput.trim();
    if (!id) return;

    if (target === 'run') {
      router.push(`/agent-runs?runId=${encodeURIComponent(id)}`);
    } else if (target === 'tool') {
      router.push(`/tools?toolCallId=${encodeURIComponent(id)}`);
    } else if (target === 'conv') {
      router.push(`/conversations?conversationId=${encodeURIComponent(id)}`);
    } else if (target === 'audit') {
      router.push(`/audit`);
    }
  };

  const groqHealth = snapshot?.ai?.providerHealth?.groq;
  const isGroqHealthy = (groqHealth?.status || 'healthy').toLowerCase() === 'healthy';
  const circuitBreakerState = groqHealth?.circuitBreaker || 'closed';

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Header Bar & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-400">
              <Activity className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
              {t('observability.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('observability.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          <label className="flex items-center gap-2 text-xs font-mono text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-surface border-border text-brand-500 focus:ring-0"
            />
            <span>{t('observability.autoRefresh')}</span>
          </label>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              healthQuery.refetch();
              metricsQuery.refetch();
              cacheMetricsQuery.refetch();
              failedRunsQuery.refetch();
              failedToolsQuery.refetch();
            }}
            isLoading={
              healthQuery.isRefetching ||
              metricsQuery.isRefetching ||
              cacheMetricsQuery.isRefetching
            }
            className="font-mono text-xs h-8"
          >
            <RefreshCw className="h-3.5 w-3.5 me-1.5" />
            {t('observability.probeNow')}
          </Button>
        </div>
      </div>

      {(healthQuery.error || metricsQuery.error) && (
        <ErrorAlert
          error={healthQuery.error || metricsQuery.error}
          title={t('observability.telemetryAlert')}
          onRetry={() => {
            healthQuery.refetch();
            metricsQuery.refetch();
          }}
        />
      )}

      {/* 2. Operational KPI Strip (Verified Metrics Only!) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* System Status */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('observability.kpiSystemStatus')}
          </span>
          <div className="pt-0.5">
            <StatusBadge
              status={
                healthData?.status === 'unhealthy'
                  ? 'unhealthy'
                  : healthData?.status === 'degraded'
                  ? 'degraded'
                  : 'healthy'
              }
              size="sm"
            />
          </div>
        </div>

        {/* API Request Volume & Error Rate */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('observability.kpiApiHealth')}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-foreground">
              {snapshot?.requests ? formatNumber(snapshot.requests.total) : '—'}
            </span>
            {snapshot?.requests && (
              <span className="text-[10px] text-slate-400 font-semibold" dir="ltr">
                ({snapshot.requests.errorRate}%)
              </span>
            )}
          </div>
        </div>

        {/* AI Provider Health (Groq) */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('observability.kpiAiProvider')}
          </span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className={`h-2 w-2 rounded-full ${isGroqHealthy ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
            <span className="text-sm font-bold text-foreground">
              {isGroqHealthy ? t('observability.statusHealthy') : t('observability.statusDegraded')}
            </span>
          </div>
        </div>

        {/* Search Retrieval */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('observability.kpiSearch')}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-cyan-400">
              {snapshot?.tools ? formatNumber(snapshot.tools.calls) : '—'}
            </span>
            <span className="text-[10px] text-slate-400">calls</span>
          </div>
        </div>

        {/* Semantic Cache */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('observability.kpiSemanticCache')}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-purple-400">
              {cacheData ? `${cacheData.hitRatePercent}%` : '—'}
            </span>
            <span className="text-[10px] text-slate-400">hit rate</span>
          </div>
        </div>

        {/* Database Health (Strictly Unknown if not emitted!) */}
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('observability.kpiDatabase')}
          </span>
          <div className="pt-0.5">
            <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400">
              {t('observability.statusUnknown')}
            </Badge>
          </div>
        </div>
      </div>

      {/* 3. System Health Grid (Dedicated Subsystem Cards) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-foreground font-mono">
              {t('observability.gridTitle')}
            </h2>
          </div>
          <span className="text-[10px] text-slate-500">
            {snapshot?.timestamp ? `${t('observability.lastChecked')}: ${formatDate(snapshot.timestamp)}` : '—'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Card 1: API Gateway & Ingestion */}
          <Card className="p-4 space-y-3 bg-surface border border-border">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-brand-400" />
                <span className="font-bold text-xs text-foreground font-mono">
                  {t('observability.apiGatewayTitle')}
                </span>
              </div>
              <StatusBadge status={snapshot?.requests?.errorRate && snapshot.requests.errorRate > 25 ? 'degraded' : 'healthy'} size="xs" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.kpiRequestVolume')}:</span>
                <span className="font-bold text-foreground">{snapshot?.requests ? formatNumber(snapshot.requests.total) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.errorRate')}:</span>
                <span className="font-bold text-cyan-400" dir="ltr">{snapshot?.requests?.errorRate ?? 0}%</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.uptime')}:</span>
                <span className="font-mono text-slate-300" dir="ltr">{formatUptime(uptimeSeconds)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.environment')}:</span>
                <span className="font-mono text-slate-300 uppercase">{healthData?.environment || 'production'}</span>
              </div>
            </div>
          </Card>

          {/* Card 2: PostgreSQL Database Subsystem */}
          <Card className="p-4 space-y-3 bg-surface border border-border">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-xs text-foreground font-mono">
                  {t('observability.databaseTitle')}
                </span>
              </div>
              <Badge variant="neutral" className="text-[10px] uppercase text-slate-400 font-mono">
                {t('observability.statusUnknown')}
              </Badge>
            </div>

            <div className="space-y-2 text-[11px]">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">Connection Pool:</span>
                  <span className="text-slate-400 font-mono">{t('observability.telemetryUnavailable')}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">{t('observability.latencyCol')}:</span>
                  <span className="text-slate-400 font-mono">N/A</span>
                </div>
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed bg-surface-elevated/40 p-2 rounded border border-border/40">
                {t('observability.databaseNote')}
              </p>
            </div>
          </Card>

          {/* Card 3: Groq AI Inference Engine */}
          <Card className="p-4 space-y-3 bg-surface border border-border">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-purple-400" />
                <span className="font-bold text-xs text-foreground font-mono">
                  {t('observability.groqTitle')}
                </span>
              </div>
              <StatusBadge status={isGroqHealthy ? 'healthy' : 'degraded'} size="xs" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.circuitBreaker')}:</span>
                <span className={`font-bold ${circuitBreakerState === 'closed' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {circuitBreakerState === 'closed' ? t('observability.circuitClosed') : t('observability.circuitOpen')}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.tokensTotal')}:</span>
                <span className="font-bold text-foreground">{snapshot?.ai ? formatTokens(snapshot.ai.tokensTotal) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">AI Requests:</span>
                <span className="font-bold text-slate-300">{snapshot?.ai ? formatNumber(snapshot.ai.requests) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Failures:</span>
                <span className={`font-bold ${snapshot?.ai?.failures ? 'text-rose-400' : 'text-slate-300'}`}>
                  {snapshot?.ai ? formatNumber(snapshot.ai.failures) : '0'}
                </span>
              </div>
            </div>
          </Card>

          {/* Card 4: Web Search Subsystem */}
          <Card className="p-4 space-y-3 bg-surface border border-border">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-cyan-400" />
                <span className="font-bold text-xs text-foreground font-mono">
                  {t('observability.searchTitle')}
                </span>
              </div>
              <StatusBadge status="healthy" size="xs" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Provider:</span>
                <span className="font-bold text-brand-300 uppercase">TAVILY</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Tool Invocations:</span>
                <span className="font-bold text-foreground">{snapshot?.tools ? formatNumber(snapshot.tools.calls) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Failures:</span>
                <span className="font-bold text-slate-300">{snapshot?.tools ? formatNumber(snapshot.tools.failures) : '0'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Guarded:</span>
                <span className="font-bold text-slate-300">{snapshot?.tools ? formatNumber(snapshot.tools.confirmations) : '0'}</span>
              </div>
            </div>

            <div className="pt-1">
              <Link
                href="/search"
                className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 underline"
              >
                <span>Open Search Intelligence</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </Card>

          {/* Card 5: Semantic Vector Cache */}
          <Card className="p-4 space-y-3 bg-surface border border-border">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-400" />
                <span className="font-bold text-xs text-foreground font-mono">
                  {t('observability.semanticCacheTitle')}
                </span>
              </div>
              <StatusBadge status="healthy" size="xs" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.hitRate')}:</span>
                <span className="font-bold text-amber-400">{cacheData ? `${cacheData.hitRatePercent}%` : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">{t('observability.vectorEntries')}:</span>
                <span className="font-bold text-foreground">{cacheData ? formatNumber(cacheData.totalEntries) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Hits / Misses:</span>
                <span className="font-mono text-slate-300" dir="ltr">
                  {cacheData ? `${cacheData.hitCount} / ${cacheData.missCount}` : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Savings:</span>
                <span className="font-bold text-emerald-400">{cacheData ? formatCurrency(cacheData.estimatedSavingsUsd) : '$0.00'}</span>
              </div>
            </div>
          </Card>

          {/* Card 6: Autonomous Agent Operations */}
          <Card className="p-4 space-y-3 bg-surface border border-border">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-brand-400" />
                <span className="font-bold text-xs text-foreground font-mono">
                  Agent Pipeline Runtime
                </span>
              </div>
              <StatusBadge status={snapshot?.agent?.failed && snapshot.agent.failed > 0 ? 'healthy' : 'healthy'} size="xs" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Completed Runs:</span>
                <span className="font-bold text-foreground">{snapshot?.agent ? formatNumber(snapshot.agent.runs) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Pipeline Steps:</span>
                <span className="font-bold text-brand-300">{snapshot?.agent ? formatNumber(snapshot.agent.steps) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Failed Runs:</span>
                <span className={`font-bold ${snapshot?.agent?.failed ? 'text-rose-400' : 'text-slate-300'}`}>
                  {snapshot?.agent ? formatNumber(snapshot.agent.failed) : '0'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Proactive Sent:</span>
                <span className="font-bold text-slate-300">{snapshot?.proactive ? formatNumber(snapshot.proactive.sent) : '0'}</span>
              </div>
            </div>

            <div className="pt-1">
              <Link
                href="/agent-runs"
                className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 underline"
              >
                <span>Open Agent Traces</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* 4. Correlation & Trace Intelligence Explorer (Section 7) */}
      <Card className="p-4 space-y-3 bg-surface border border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border/60">
          <div>
            <h3 className="font-bold text-xs text-foreground font-mono flex items-center gap-2">
              <Layers className="h-4 w-4 text-purple-400" />
              <span>{t('observability.correlationTitle')}</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('observability.correlationSubtitle')}
            </p>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            Deterministic Navigation
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="relative flex-1 w-full">
            <Input
              placeholder={t('observability.searchCorrelationPlaceholder')}
              value={correlationInput}
              onChange={(e) => setCorrelationInput(e.target.value)}
              className="h-9 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCorrelationNavigate('run')}
              disabled={!correlationInput.trim()}
              className="h-9 font-mono text-xs"
            >
              {t('observability.openAgentRun')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCorrelationNavigate('tool')}
              disabled={!correlationInput.trim()}
              className="h-9 font-mono text-xs"
            >
              {t('observability.openToolCall')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCorrelationNavigate('conv')}
              disabled={!correlationInput.trim()}
              className="h-9 font-mono text-xs"
            >
              {t('observability.openConversation')}
            </Button>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
          {t('observability.correlationNotice')}
        </p>
      </Card>

      {/* 5. Recent Operational Errors & Root-Cause Intelligence (Section 9) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            <h3 className="text-sm font-bold text-foreground font-mono">
              {t('observability.recentErrorsTitle')}
            </h3>
          </div>
          <span className="text-[10px] text-slate-500">
            {recentErrors.length} recent error events
          </span>
        </div>

        <Card>
          <DataTable
            columns={[
              {
                header: t('common.timestamp'),
                accessorKey: 'timestamp',
                cell: (e) => (
                  <div className="space-y-0.5">
                    <span className="text-foreground font-medium block">
                      {formatDate(e.timestamp)}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {formatRelativeTime(e.timestamp)}
                    </span>
                  </div>
                ),
              },
              {
                header: t('observability.colService'),
                cell: (e) => {
                  const label =
                    e.service === 'agent'
                      ? t('observability.serviceAgent')
                      : e.service === 'tools'
                      ? t('observability.serviceTools')
                      : t('observability.serviceAdmin');
                  return (
                    <Badge variant={e.service === 'agent' ? 'purple' : 'neutral'} className="text-[10px] font-mono">
                      {label}
                    </Badge>
                  );
                },
              },
              {
                header: t('observability.colSeverity'),
                cell: (e) => (
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                      e.severity === 'high'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {e.severity.toUpperCase()}
                  </span>
                ),
              },
              {
                header: t('observability.colErrorType'),
                cell: (e) => (
                  <div className="space-y-0.5 max-w-[280px]">
                    <span className="font-mono font-bold text-rose-400 text-xs block truncate" title={e.errorType}>
                      {e.errorType}
                    </span>
                    <span className="text-slate-400 text-[11px] block truncate font-mono" title={e.errorMessage}>
                      {sanitizeSafeErrorDetails(e.errorMessage)}
                    </span>
                  </div>
                ),
              },
              {
                header: t('observability.colCorrelation'),
                cell: (e) => {
                  const corr = e.runId || e.correlationId || e.id;
                  return (
                    <span className="font-mono text-slate-400 text-[11px] select-all" dir="ltr">
                      {truncate(corr, 12)}
                    </span>
                  );
                },
              },
              {
                header: t('common.duration'),
                cell: (e) => (
                  <span className="font-mono text-slate-300 text-xs" dir="ltr">
                    {formatLatency(e.durationMs)}
                  </span>
                ),
              },
              {
                header: t('common.actions'),
                cell: (e) => (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedError(e)}
                    className="font-mono text-xs h-7 px-2"
                  >
                    <Eye className="h-3 w-3 me-1 text-rose-400" />
                    <span>{t('observability.inspectError')}</span>
                  </Button>
                ),
              },
            ]}
            data={recentErrors}
            isLoading={failedRunsQuery.isLoading || failedToolsQuery.isLoading}
            emptyMessage={t('observability.noErrors')}
          />
        </Card>
      </div>

      {/* 6. Infrastructure Latency Histograms (Section 11) */}
      <Card className="p-4 space-y-3 bg-surface border border-border">
        <div className="flex items-center justify-between pb-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            <h3 className="font-bold text-xs text-foreground font-mono">
              {t('observability.latencyHistogramsTitle')}
            </h3>
          </div>
          <span className="text-[10px] text-slate-500">
            {Object.keys(histograms).length} active latency distributions
          </span>
        </div>

        {Object.keys(histograms).length === 0 ? (
          <p className="text-xs text-slate-500 font-mono text-center py-6">
            {t('observability.noHistograms')}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(histograms).map(([metricKey, hist]) => (
              <div
                key={metricKey}
                className="p-3.5 rounded-lg bg-surface-elevated/40 border border-border space-y-2.5 font-mono"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="truncate max-w-[260px]" title={metricKey}>
                    {metricKey}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {t('observability.samplesCount', { count: String(hist.count || 0) })}
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-2 pt-2 border-t border-border/50 text-[10px]">
                  <div>
                    <span className="text-slate-500 block uppercase">AVG</span>
                    <span className="font-bold text-cyan-400">{hist.avg || 0}ms</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase">p50</span>
                    <span className="font-bold text-emerald-400">{hist.p50 || 0}ms</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase">p90</span>
                    <span className="font-bold text-amber-400">{hist.p90 ?? hist.p95 ?? 0}ms</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase">p95</span>
                    <span className="font-bold text-purple-400">{hist.p95 || 0}ms</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase">p99</span>
                    <span className="font-bold text-rose-400">{hist.p99 || 0}ms</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 7. Slide-over Error Detail Drawer */}
      <ErrorDetailDrawer
        errorItem={selectedError}
        isOpen={Boolean(selectedError)}
        onClose={() => setSelectedError(null)}
      />
    </div>
  );
}

export default function ObservabilityPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-center text-xs font-mono text-slate-500">
          Loading system observability...
        </div>
      }
    >
      <ObservabilityContent />
    </Suspense>
  );
}
