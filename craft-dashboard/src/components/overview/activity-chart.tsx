'use client';

import React, { useState, useMemo } from 'react';
import { DailyTrend } from '@/types/admin';
import { useLanguage } from '@/lib/i18n/language-context';
import { TrendingUp, MessageSquare, Users, Cpu, DollarSign } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { cn } from '@/lib/utils';

export interface ActivityChartProps {
  data?: DailyTrend[];
  isLoading?: boolean;
  days?: number;
}

type MetricKey = 'messages' | 'users' | 'tokens' | 'cost';

export function ActivityChart({ data = [], isLoading, days = 14 }: ActivityChartProps) {
  const { t, formatNumber, formatCurrency, formatTokens, isRtl } = useLanguage();
  const [activeMetric, setActiveMetric] = useState<MetricKey>('messages');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const metricsConfig: { id: MetricKey; label: string; icon: any; color: string }[] = [
    { id: 'messages', label: t('overview.messagesCol'), icon: MessageSquare, color: 'brand' },
    { id: 'users', label: t('overview.activeUsersCol'), icon: Users, color: 'emerald' },
    { id: 'tokens', label: t('overview.tokensCol'), icon: Cpu, color: 'cyan' },
    { id: 'cost', label: t('overview.costCol'), icon: DollarSign, color: 'amber' },
  ];

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const getValue = (item: DailyTrend, key: MetricKey): number => {
    switch (key) {
      case 'messages':
        return item.messageCount || 0;
      case 'users':
        return item.activeUsers || 0;
      case 'tokens':
        return item.tokenCount || 0;
      case 'cost':
        return item.costUsd || 0;
    }
  };

  const formatValue = (val: number, key: MetricKey): string => {
    switch (key) {
      case 'messages':
      case 'users':
        return formatNumber(val);
      case 'tokens':
        return formatTokens(val);
      case 'cost':
        return formatCurrency(val);
    }
  };

  const maxValue = useMemo(() => {
    if (sortedData.length === 0) return 1;
    const max = Math.max(...sortedData.map((d) => getValue(d, activeMetric)));
    return max > 0 ? max : 1;
  }, [sortedData, activeMetric]);

  const totalValue = useMemo(() => {
    return sortedData.reduce((acc, d) => acc + getValue(d, activeMetric), 0);
  }, [sortedData, activeMetric]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-8 w-48 rounded-md" />
        </div>
        <Skeleton className="h-56 w-full rounded-md" />
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold font-mono text-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand-500" />
            {t('overview.activityTrends')}
          </h3>
        </div>
        <EmptyState
          title={t('overview.noTrendHistory')}
          description=""
          className="py-12 bg-transparent border-dashed"
        />
      </div>
    );
  }

  const activeColor = metricsConfig.find((m) => m.id === activeMetric)?.color || 'brand';

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5 transition-colors shadow-xs">
      {/* Header & Metric Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold font-mono text-foreground">
              {t('overview.dailyVolumeTitle', { days: String(days) })}
            </h3>
          </div>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            Total: <span className="font-semibold text-foreground">{formatValue(totalValue, activeMetric)}</span> across recorded period
          </p>
        </div>

        {/* Metric Switcher Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-elevated/70 border border-border self-start sm:self-auto overflow-x-auto max-w-full">
          {metricsConfig.map((m) => {
            const Icon = m.icon;
            const isSelected = activeMetric === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setActiveMetric(m.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all shrink-0',
                  isSelected
                    ? 'bg-surface text-foreground shadow-xs font-medium border border-border'
                    : 'text-slate-500 hover:text-foreground'
                )}
              >
                <Icon className="h-3 w-3" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart Canvas & Bars */}
      <div className="space-y-2">
        <div className="relative h-48 sm:h-56 flex items-end gap-1 sm:gap-2 pt-6 pb-2 px-1 border-b border-border/70">
          {/* Subtle Grid Lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
            <div className="border-b border-dashed border-slate-500 w-full" />
            <div className="border-b border-dashed border-slate-500 w-full" />
            <div className="border-b border-dashed border-slate-500 w-full" />
          </div>

          {/* Data Bars */}
          {sortedData.map((item, idx) => {
            const rawVal = getValue(item, activeMetric);
            const heightPercent = Math.max((rawVal / maxValue) * 100, 4);
            const isHovered = hoveredIndex === idx;

            return (
              <div
                key={item.date}
                className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Tooltip */}
                {isHovered && (
                  <div
                    className={cn(
                      'absolute bottom-full mb-2 z-20 px-2.5 py-1.5 rounded-md bg-slate-900 text-slate-100 text-[11px] font-mono shadow-xl border border-slate-700 pointer-events-none whitespace-nowrap animate-in fade-in zoom-in-95',
                      isRtl ? 'right-1/2 translate-x-1/2' : 'left-1/2 -translate-x-1/2'
                    )}
                  >
                    <div className="font-semibold text-slate-300 mb-0.5">{item.date}</div>
                    <div className="text-white font-bold">{formatValue(rawVal, activeMetric)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {formatNumber(item.messageCount)} msgs • {formatNumber(item.activeUsers)} users
                    </div>
                  </div>
                )}

                {/* Visual Bar */}
                <div
                  style={{ height: `${heightPercent}%` }}
                  className={cn(
                    'w-full max-w-[32px] rounded-t-sm transition-all duration-200',
                    activeColor === 'brand'
                      ? isHovered ? 'bg-brand-500' : 'bg-brand-500/70 hover:bg-brand-500'
                      : activeColor === 'emerald'
                      ? isHovered ? 'bg-emerald-500' : 'bg-emerald-500/70 hover:bg-emerald-500'
                      : activeColor === 'cyan'
                      ? isHovered ? 'bg-cyan-500' : 'bg-cyan-500/70 hover:bg-cyan-500'
                      : isHovered ? 'bg-amber-500' : 'bg-amber-500/70 hover:bg-amber-500'
                  )}
                />
              </div>
            );
          })}
        </div>

        {/* X-Axis Date Labels */}
        <div className="flex justify-between items-center px-1 text-[10px] font-mono text-slate-500">
          <span>{sortedData[0]?.date}</span>
          {sortedData.length > 2 && (
            <span>{sortedData[Math.floor(sortedData.length / 2)]?.date}</span>
          )}
          <span>{sortedData[sortedData.length - 1]?.date}</span>
        </div>
      </div>
    </div>
  );
}
