'use client';

import React from 'react';
import { Database, Cpu, Search, Server, Zap } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { SystemHealthData } from '@/types/admin';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton-loader';

export interface OperationalSignalsProps {
  health?: SystemHealthData;
  isLoading?: boolean;
}

export function OperationalSignals({ health, isLoading }: OperationalSignalsProps) {
  const { t } = useLanguage();

  if (isLoading) {
    return (
      <div className="p-3 sm:p-4 rounded-lg border border-border bg-surface flex flex-wrap items-center gap-3">
        <Skeleton className="h-4 w-32" />
        <div className="flex-1 flex gap-2">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      </div>
    );
  }

  const components = health?.snapshot?.components || {};
  const overallStatus = health?.status || 'healthy';

  const signals = [
    {
      id: 'gateway',
      name: t('topbar.backendStatus'),
      status: overallStatus,
      latency: health?.uptimeSeconds ? `${Math.floor(health.uptimeSeconds / 3600)}h uptime` : undefined,
      icon: Server,
    },
    {
      id: 'database',
      name: t('overview.databaseSubsystem'),
      status: components.database?.status || overallStatus,
      latency: components.database?.latencyMs ? `${components.database.latencyMs}ms` : undefined,
      icon: Database,
    },
    {
      id: 'ai',
      name: t('overview.groqEngine'),
      status: components.llm?.status || components.ai?.status || overallStatus,
      latency: components.llm?.latencyMs || components.ai?.latencyMs ? `${components.llm?.latencyMs || components.ai?.latencyMs}ms` : 'Groq API',
      icon: Cpu,
    },
    {
      id: 'search',
      name: t('overview.searchSubsystem'),
      status: components.search?.status || 'healthy',
      latency: components.search?.latencyMs ? `${components.search.latencyMs}ms` : undefined,
      icon: Search,
    },
    {
      id: 'cache',
      name: t('overview.cacheSubsystem'),
      status: components.cache?.status || components.redis?.status || 'healthy',
      latency: undefined,
      icon: Zap,
    },
  ];

  return (
    <div className="p-3 sm:p-4 rounded-lg border border-border bg-surface flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors shadow-xs">
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        <div>
          <h3 className="text-xs font-mono font-semibold text-foreground uppercase tracking-wider">
            {t('overview.operationalSignals')}
          </h3>
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {t('overview.signalsSubtitle')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
        {signals.map((signal) => {
          const Icon = signal.icon;
          return (
            <div
              key={signal.id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-surface-elevated/40 text-xs font-mono shrink-0 select-none"
            >
              <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span className="text-slate-600 dark:text-slate-300 font-medium">
                {signal.name}
              </span>
              <StatusBadge
                status={signal.status === 'healthy' ? 'healthy' : signal.status === 'degraded' ? 'warning' : 'failed'}
                size="xs"
                showDot={true}
              />
              {signal.latency && (
                <span className="text-[10px] text-slate-400 font-mono ms-0.5">
                  ({signal.latency})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
