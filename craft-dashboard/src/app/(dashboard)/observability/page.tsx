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
import { formatNumber, formatDate } from '@/lib/utils';

export default function ObservabilityPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);

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
            SYSTEM OBSERVABILITY & HEALTH
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Component status, AI latency percentiles, and runtime telemetry
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <label className="flex items-center space-x-2 text-xs font-mono text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-surface-elevated border-border text-brand-500 focus:ring-0"
            />
            <span>Auto-refresh (10s)</span>
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
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Probe Now
          </Button>
        </div>
      </div>

      {(healthQuery.error || metricsQuery.error) && (
        <ErrorAlert
          error={healthQuery.error || metricsQuery.error}
          title="Telemetry Connection Alert"
          onRetry={() => {
            healthQuery.refetch();
            metricsQuery.refetch();
          }}
        />
      )}

      {/* Top Health Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center justify-between border-l-4 border-l-emerald-500">
          <div>
            <span className="text-[11px] font-mono uppercase text-slate-400">System State</span>
            <div className="mt-1">
              <StatusPill status={health?.status || 'checking'} />
            </div>
          </div>
          <Activity className="h-6 w-6 text-emerald-400" />
        </Card>

        <MetricCard
          title="Uptime"
          value={formatUptime(health?.uptimeSeconds)}
          subtext={`Started ${formatDate(health?.snapshot?.timestamp)}`}
          icon={<Clock className="h-4 w-4" />}
        />

        <MetricCard
          title="Environment"
          value={health?.environment || 'production'}
          subtext={health?.service || 'craft-agent-backend'}
          icon={<Server className="h-4 w-4" />}
        />

        <MetricCard
          title="Telemetry Counters"
          value={Object.keys(counters).length}
          subtext="Active monitored signals"
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      {/* Component Status Grid */}
      <Card>
        <CardHeader>
          <CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Core Infrastructure Components
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.keys(components).length === 0 ? (
              <div className="text-xs text-slate-400 font-mono col-span-3 py-4 text-center">
                All subsystem checks operational
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
                      {comp.latencyMs !== undefined ? `${comp.latencyMs}ms latency` : 'Active'}
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
              Latency Percentiles (p50 / p95 / p99)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(latencies).length === 0 ? (
              <p className="text-xs text-slate-400 font-mono text-center py-6">
                No latency histograms collected in current snapshot
              </p>
            ) : (
              <div className="space-y-3 font-mono">
                {Object.entries(latencies).map(([key, hist]: [string, any]) => (
                  <div key={key} className="p-3 rounded-md bg-surface-elevated/40 border border-border">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                      <span>{key}</span>
                      <span className="text-slate-400">{formatNumber(hist.count)} samples</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-border/40 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block">P50 (Median)</span>
                        <span className="font-bold text-slate-200">{hist.p50}ms</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">P95</span>
                        <span className="font-bold text-amber-300">{hist.p95}ms</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">P99 (Tail)</span>
                        <span className="font-bold text-rose-300">{hist.p99}ms</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Zap className="h-4 w-4 text-amber-400" />
              System Event Counters
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(counters).length === 0 ? (
              <p className="text-xs text-slate-400 font-mono text-center py-6">
                No active event counters recorded
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 font-mono">
                {Object.entries(counters).map(([key, val]) => (
                  <div key={key} className="p-3 rounded-md bg-surface-elevated/40 border border-border">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block truncate" title={key}>
                      {key}
                    </span>
                    <span className="text-lg font-bold text-slate-100 mt-1 block">
                      {formatNumber(val as number)}
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
