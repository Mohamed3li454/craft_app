'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { RefreshCw, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { KpiGrid } from '@/components/overview/kpi-grid';
import { OperationalSignals } from '@/components/overview/operational-signals';
import { ActivityChart } from '@/components/overview/activity-chart';
import { ModelBreakdownCard } from '@/components/overview/model-breakdown-card';
import { RecentConversations } from '@/components/overview/recent-conversations';
import { TopUsersCard } from '@/components/overview/top-users-card';

export default function OverviewPage() {
  const [days, setDays] = useState(14);
  const { t, formatRelativeTime } = useLanguage();

  // 1. Primary Overview Query (Real metrics only, zero fake data)
  const {
    data: overviewRes,
    isLoading: isOverviewLoading,
    error: overviewError,
    refetch: refetchOverview,
    isRefetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['admin-overview', days],
    queryFn: () => adminApi.getOverview(days),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // 2. Real System Health Query
  const { data: healthRes, isLoading: isHealthLoading } = useQuery({
    queryKey: ['admin-health-overview'],
    queryFn: () => adminApi.getHealth(),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const overview = overviewRes?.data?.overview;
  const modelBreakdown = overviewRes?.data?.modelBreakdown || [];
  const topUsers = overviewRes?.data?.topUsers || [];
  const dailyTrends = overviewRes?.data?.dailyTrends || [];
  const health = healthRes?.data;

  const lastUpdatedText = dataUpdatedAt
    ? formatRelativeTime(new Date(dataUpdatedAt).toISOString())
    : t('overview.justNow');

  return (
    <div className="space-y-6">
      {/* A. Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            </div>
            <h1 className="text-lg sm:text-xl font-bold font-mono tracking-tight text-foreground">
              {t('overview.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
            {t('overview.subtitle')}
          </p>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {dataUpdatedAt > 0 && (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-400 me-1 hidden md:inline">
              {t('overview.lastUpdated', { time: lastUpdatedText })}
            </span>
          )}

          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={t('overview.metricFilter')}
            className="h-8 rounded-md border border-border bg-surface-elevated/70 px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value={7}>{t('common.last7Days')}</option>
            <option value={14}>{t('common.last14Days')}</option>
            <option value={30}>{t('common.last30Days')}</option>
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchOverview()}
            isLoading={isRefetching}
            className="font-mono text-xs"
            aria-label={t('common.refresh')}
          >
            <RefreshCw className="h-3.5 w-3.5 me-1.5" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Global Error Banner (Isolated) */}
      {overviewError && (
        <ErrorState
          error={overviewError}
          title={t('overview.failedToLoad')}
          onRetry={() => refetchOverview()}
        />
      )}

      {/* B. KPI Grid (6 Cards) */}
      <KpiGrid
        overview={overview}
        healthStatus={health?.status}
        isLoading={isOverviewLoading}
      />

      {/* C. Operational Signals (Live telemetry across subsystems) */}
      <OperationalSignals
        health={health}
        isLoading={isHealthLoading}
      />

      {/* D. Main Analytics Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Activity Volume Chart & Recent Conversations */}
        <div className="lg:col-span-7 space-y-6">
          <ActivityChart
            data={dailyTrends}
            isLoading={isOverviewLoading}
            days={days}
          />

          <RecentConversations />
        </div>

        {/* Right Column (5 cols): AI Model Breakdown & Top Active Users */}
        <div className="lg:col-span-5 space-y-6">
          <ModelBreakdownCard
            data={modelBreakdown}
            isLoading={isOverviewLoading}
          />

          <TopUsersCard
            data={topUsers}
            isLoading={isOverviewLoading}
          />
        </div>
      </div>
    </div>
  );
}
