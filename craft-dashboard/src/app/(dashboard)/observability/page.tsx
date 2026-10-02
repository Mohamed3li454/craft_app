'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { MetricCard } from '@/components/ui/metric-card';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Activity, Server, Zap, Clock, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/language-context';

export default function ObservabilityPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { t, formatDate, formatNumber } = useLanguage();

  const healthQuery = useQuery({
    queryKey: ['observability-health'],
    queryFn: () => adminApi.getHealth(),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const metricsQuery = useQuery({
    queryKey: ['observability-metrics'],
    queryFn: () => adminApi.getMetrics(),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const health = healthQuery.data?.data;
  const metrics = metricsQuery.data?.data;

  const components = health?.snapshot?.components || {};
  const latencies = metrics?.latencies || {};
  const counters = metrics?.counters || {};

  const formatUptime = (sec: number | undefined) => {
    if (!sec) return '—';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${hrs}h ${mins}m ${s}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('observability.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('observability.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-mono text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-surface-elevated border-border text-brand-500 focus:ring-0"
            />
            <span>{t('observability.autoRefresh')}</span>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              healthQuery.refetch();
              metricsQuery.refetch();
            }}
            isLoading={healthQuery.isRefetching || metricsQuery.isRefetching}
            className="font-mono text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 me-1" />
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

      {/* Top Health Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center justify-between border-s-4 border-s-emerald-500">
          <div>
            <span className="text-[11px] font-mono uppercase text-slate-400">{t('observability.systemState')}</span>
            <div className="mt-1">
              <StatusPill status={health?.status || 'checking'} />
            </div>
          </div>
          <Activity className="h-6 w-6 text-emerald-400" />
        </Card>

        <MetricCard
          title={t('observability.uptime')}
          value={formatUptime(health?.uptimeSeconds)}
          subtext={`${t('observability.lastCheckedCol')}: ${formatDate(health?.snapshot?.timestamp)}`}
          icon={<Clock className="h-4 w-4" />}
        />

        <MetricCard
          title={t('observability.environment')}
          value={health?.environment || 'production'}
          subtext={health?.service || 'craft-agent-backend'}
          icon={<Server className="h-4 w-4" />}
        />

        <MetricCard
          title={t('observability.operationalCounters')}
          value={formatNumber(Object.keys(counters).length)}
          subtext="Active monitored signals"
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      {/* Component Status Grid */}
      <Card>
        <CardHeader>
          <CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            {t('observability.subsystemHealth')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.keys(components).length === 0 ? (
              <div className="text-xs text-slate-400 font-mono col-span-3 py-4 text-center">
                {t('common.noData')}
              </div>
            ) : (
              Object.entries(components).map(([name, comp]: [string, any]) => (
                <div
                  key={name}
                  className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 flex items-center justify-between font-mono"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-200 uppercase">{name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {comp.latencyMs !== undefined ? `${comp.latencyMs}ms ${t('observability.latencyCol')}` : t('common.active')}
                    </p>
                  </div>
                  <StatusPill status={comp.status || 'healthy'} />
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Latency Percentiles & Key Counters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <Activity className="h-4 w-4 text-brand-400" />
              {t('observability.latencyPercentiles')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(latencies).length === 0 ? (
              <p className="text-xs text-slate-400 font-mono text-center py-6">
                {t('common.noData')}
              </p>
            ) : (
              <div className="space-y-3 font-mono">
                {Object.entries(latencies).map(([key, hist]: [string, any]) => (
                  <div key={key} className="p-3 rounded-md bg-surface-elevated/40 border border-border">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                      <span>{key}</span>
                      <span className="text-slate-400 text-[11px]">{hist.count || 0} samples</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2 pt-2 border-t border-border/60 text-[11px]">
                      <div>
                        <span className="text-slate-400">{t('observability.p50Col')}</span>
                        <p className="text-emerald-400 font-bold">{hist.p50 || 0}ms</p>
                      </div>
                      <div>
                        <span className="text-slate-400">{t('observability.p95Col')}</span>
                        <p className="text-amber-400 font-bold">{hist.p95 || 0}ms</p>
                      </div>
                      <div>
                        <span className="text-slate-400">{t('observability.p99Col')}</span>
                        <p className="text-rose-400 font-bold">{hist.p99 || 0}ms</p>
                      </div>
                      <div>
                        <span className="text-slate-400">{t('observability.maxCol')}</span>
                        <p className="text-slate-200 font-bold">{hist.max || 0}ms</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Operational Counters */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Zap className="h-4 w-4 text-amber-400" />
              {t('observability.operationalCounters')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(counters).length === 0 ? (
              <p className="text-xs text-slate-400 font-mono text-center py-6">
                {t('common.noData')}
              </p>
            ) : (
              <div className="divide-y divide-border/60 font-mono">
                {Object.entries(counters).map(([key, count]) => (
                  <div key={key} className="py-2.5 flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">{key}</span>
                    <span className="px-2 py-0.5 rounded bg-surface-elevated text-brand-300 font-bold">
                      {formatNumber(count as number)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
