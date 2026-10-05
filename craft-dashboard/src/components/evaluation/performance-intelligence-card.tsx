'use client';

import React from 'react';
import { PerformanceIntelligenceResult } from '@/types/admin';
import { MetricCard } from '@/components/ui/metric-card';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { Clock, Cpu, Zap, Activity } from 'lucide-react';

interface PerformanceIntelligenceCardProps {
  performance?: PerformanceIntelligenceResult;
  isLoading?: boolean;
}

export function PerformanceIntelligenceCard({
  performance,
  isLoading,
}: PerformanceIntelligenceCardProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (!performance || performance.sampleSize === 0) {
    return (
      <Card className="p-8 text-center bg-surface border-border">
        <Clock className="w-6 h-6 text-slate-400 mx-auto mb-2" />
        <p className="text-xs text-slate-400">No performance telemetry available yet.</p>
      </Card>
    );
  }

  const { latency, tokens, byDimension, slowestCases, topTokenCases } = performance;

  const formatVal = (val: number | string, unit = '') => {
    if (typeof val === 'number') return `${val}${unit}`;
    return val; // e.g. 'INSUFFICIENT_DATA'
  };

  return (
    <div className="space-y-6">
      {/* 1. Latency & Token KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Average Latency"
          value={`${latency.averageMs}ms`}
          subtext={`Min: ${latency.minMs}ms • Max: ${latency.maxMs}ms`}
          icon={<Clock className="w-4 h-4 text-brand-400" />}
          isPositive
        />
        <MetricCard
          title="p50 Latency (Median)"
          value={formatVal(latency.p50Ms, 'ms')}
          subtext={typeof latency.p50Ms === 'number' ? '50% of requests completed under' : 'Sample size < 5'}
          icon={<Zap className="w-4 h-4 text-emerald-400" />}
          isPositive={typeof latency.p50Ms === 'number'}
        />
        <MetricCard
          title="p90 / p95 Latency"
          value={typeof latency.p90Ms === 'number' ? `${latency.p90Ms}ms / ${formatVal(latency.p95Ms, 'ms')}` : 'N/A'}
          subtext="Tail latency upper bounds"
          icon={<Activity className="w-4 h-4 text-amber-400" />}
          isPositive={typeof latency.p90Ms === 'number'}
        />
        <MetricCard
          title="Token Consumption"
          value={`${tokens.averageTokensPerCase}`}
          subtext={`Total: ${tokens.totalTokens.toLocaleString()} tokens`}
          icon={<Cpu className="w-4 h-4 text-indigo-400" />}
          isPositive
        />
      </div>

      {/* 2. Latency by Dimension */}
      {byDimension.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
            Dimension Performance Breakdown
          </h4>
          <div className="rounded-xl border border-border overflow-hidden bg-surface-elevated/20">
            <table className="w-full text-xs text-left rtl:text-right">
              <thead className="bg-surface-elevated border-b border-border text-slate-400 uppercase font-mono text-[10px]">
                <tr>
                  <th className="px-4 py-2.5">Dimension</th>
                  <th className="px-3 py-2.5">Evaluated Cases</th>
                  <th className="px-3 py-2.5">Avg Latency</th>
                  <th className="px-3 py-2.5">p90 Latency</th>
                  <th className="px-3 py-2.5">Avg Tokens</th>
                  <th className="px-3 py-2.5">Total Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[11px]">
                {byDimension.map((dim) => (
                  <tr key={dim.dimension} className="hover:bg-surface-elevated/40">
                    <td className="px-4 py-2 font-bold text-foreground uppercase">{dim.dimension}</td>
                    <td className="px-3 py-2 text-slate-300">{dim.sampleSize}</td>
                    <td className="px-3 py-2 text-slate-300">{dim.averageLatencyMs}ms</td>
                    <td className="px-3 py-2 text-slate-300">{formatVal(dim.p90LatencyMs, 'ms')}</td>
                    <td className="px-3 py-2 text-slate-300">{dim.averageTokens}</td>
                    <td className="px-3 py-2 text-slate-300">{dim.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Slowest Cases & Top Token Cases */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Slowest Cases */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Top Slowest Scenarios</span>
          </h4>
          <div className="space-y-2">
            {slowestCases.slice(0, 5).map((c) => (
              <div
                key={c.caseId}
                className="p-3 rounded-lg border border-border bg-surface-elevated/40 text-xs flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-foreground">{c.caseId}</span>
                    <span className="px-1.5 py-0.2 rounded bg-surface border border-border text-[10px] font-mono uppercase text-slate-400">
                      {c.dimension}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{c.title}</p>
                </div>
                <span className="font-mono font-bold text-amber-400 text-xs shrink-0">
                  {c.durationMs}ms
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Token Cases */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>Top Token-Heavy Scenarios</span>
          </h4>
          <div className="space-y-2">
            {topTokenCases.slice(0, 5).map((c) => (
              <div
                key={c.caseId}
                className="p-3 rounded-lg border border-border bg-surface-elevated/40 text-xs flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-foreground">{c.caseId}</span>
                    <span className="px-1.5 py-0.2 rounded bg-surface border border-border text-[10px] font-mono uppercase text-slate-400">
                      {c.dimension}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{c.title}</p>
                </div>
                <span className="font-mono font-bold text-indigo-400 text-xs shrink-0">
                  {c.tokens.toLocaleString()} tok
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
