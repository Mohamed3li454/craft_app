'use client';

import React from 'react';
import { Users, MessageSquare, Clock, Cpu, Zap, Activity } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { OverviewStats } from '@/types/admin';
import { CardSkeleton } from '@/components/ui/skeleton-loader';
import { StatusBadge } from '@/components/ui/status-badge';

export interface KpiGridProps {
  overview?: OverviewStats;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy' | 'checking';
  isLoading?: boolean;
}

export function KpiGrid({ overview, healthStatus = 'checking', isLoading }: KpiGridProps) {
  const { t, formatNumber, formatCurrency, formatTokens } = useLanguage();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <CardSkeleton key={idx} />
        ))}
      </div>
    );
  }

  const kpis = [
    {
      id: 'users',
      label: t('overview.totalUsers'),
      value: formatNumber(overview?.totalUsers ?? 0),
      context: t('overview.active24h', { count: formatNumber(overview?.activeUsers24h ?? 0) }),
      icon: Users,
      badge: undefined,
    },
    {
      id: 'messages',
      label: t('overview.messages'),
      value: formatNumber(overview?.totalMessages ?? 0),
      context: t('overview.conversationsCount', { count: formatNumber(overview?.totalConversations ?? 0) }),
      icon: MessageSquare,
      badge: undefined,
    },
    {
      id: 'reminders',
      label: t('overview.reminders'),
      value: formatNumber(overview?.totalReminders ?? 0),
      context: t('overview.pendingReminders', { count: formatNumber(overview?.pendingReminders ?? 0) }),
      icon: Clock,
      badge: undefined,
    },
    {
      id: 'tokens',
      label: t('overview.tokenUsage'),
      value: formatTokens(overview?.totalTokens ?? 0),
      context: formatCurrency(overview?.totalCostUsd ?? 0),
      icon: Cpu,
      badge: undefined,
    },
    {
      id: 'cache',
      label: t('overview.cacheHitRate'),
      value: `${overview?.cacheHitRatePercent ?? 0}%`,
      context: t('overview.semanticCacheSubtitle'),
      icon: Zap,
      badge: undefined,
    },
    {
      id: 'health',
      label: t('overview.systemHealth'),
      value:
        healthStatus === 'healthy'
          ? t('overview.allSystemsOperational')
          : healthStatus === 'degraded'
          ? t('overview.systemDegraded')
          : t('common.unknown'),
      context: t('overview.deployedProvider'),
      icon: Activity,
      badge: healthStatus,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <div
            key={kpi.id}
            className="flex flex-col justify-between p-3.5 sm:p-4 rounded-lg border border-border bg-surface hover:border-slate-400 dark:hover:border-slate-700 transition-colors shadow-xs"
          >
            <div className="flex items-center justify-between gap-1 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                {kpi.label}
              </span>
              <div className="p-1 rounded bg-surface-elevated text-slate-500 dark:text-slate-400 border border-border shrink-0">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-1">
              {kpi.badge ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusBadge
                    status={kpi.badge === 'healthy' ? 'healthy' : kpi.badge === 'checking' ? 'pending' : 'failed'}
                    size="xs"
                    showDot={true}
                  />
                  <span className="text-xs font-mono font-bold text-foreground truncate">
                    {kpi.value}
                  </span>
                </div>
              ) : (
                <span className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground truncate block">
                  {kpi.value}
                </span>
              )}

              <p className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                {kpi.context}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
