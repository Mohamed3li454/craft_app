'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { MetricCard } from '@/components/ui/metric-card';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import {
  Users,
  MessageSquare,
  Clock,
  Cpu,
  Zap,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/language-context';
import Link from 'next/link';

export default function OverviewPage() {
  const [days, setDays] = useState(14);
  const { t, formatNumber, formatCurrency, formatTokens, formatRelativeTime } = useLanguage();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['admin-overview', days],
    queryFn: () => adminApi.getOverview(days),
    refetchInterval: 30000,
  });

  const overview = data?.data?.overview;
  const modelBreakdown = data?.data?.modelBreakdown || [];
  const topUsers = data?.data?.topUsers || [];
  const dailyTrends = data?.data?.dailyTrends || [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('overview.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('overview.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-slate-200 focus:outline-none"
          >
            <option value={7}>{t('common.last7Days')}</option>
            <option value={14}>{t('common.last14Days')}</option>
            <option value={30}>{t('common.last30Days')}</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            isLoading={isRefetching}
            className="font-mono text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 me-1" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title={t('overview.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          title={t('overview.totalUsers')}
          value={isLoading ? '...' : formatNumber(overview?.totalUsers)}
          subtext={t('overview.active24h', { count: formatNumber(overview?.activeUsers24h) })}
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          title={t('overview.activeUsers7d')}
          value={isLoading ? '...' : formatNumber(overview?.activeUsers7d)}
          subtext={t('overview.weeklyReach')}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          title={t('overview.messages')}
          value={isLoading ? '...' : formatNumber(overview?.totalMessages)}
          subtext={t('overview.conversationsCount', { count: formatNumber(overview?.totalConversations) })}
          icon={<MessageSquare className="h-4 w-4" />}
        />
        <MetricCard
          title={t('overview.reminders')}
          value={isLoading ? '...' : formatNumber(overview?.totalReminders)}
          subtext={t('overview.pendingReminders', { count: formatNumber(overview?.pendingReminders) })}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          title={t('overview.tokenUsage')}
          value={isLoading ? '...' : formatTokens(overview?.totalTokens)}
          subtext={formatCurrency(overview?.totalCostUsd)}
          icon={<Cpu className="h-4 w-4" />}
        />
        <MetricCard
          title={t('overview.cacheHitRate')}
          value={isLoading ? '...' : `${overview?.cacheHitRatePercent ?? 0}%`}
          subtext={t('overview.semanticCacheSubtitle')}
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      {/* Split View: Daily Activity & Model Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Trends Summary */}
        <Card>
          <CardHeader>
            <CardTitle>
              <TrendingUp className="h-4 w-4 text-brand-400" />
              {t('overview.dailyVolumeTitle', { days: String(days) })}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { header: t('overview.dateCol'), accessorKey: 'date', cell: (r) => <span className="text-slate-200">{r.date}</span> },
                { header: t('overview.messagesCol'), accessorKey: 'messageCount', cell: (r) => formatNumber(r.messageCount) },
                { header: t('overview.activeUsersCol'), accessorKey: 'activeUsers', cell: (r) => formatNumber(r.activeUsers) },
                { header: t('overview.tokensCol'), accessorKey: 'tokenCount', cell: (r) => formatTokens(r.tokenCount) },
                { header: t('overview.costCol'), accessorKey: 'costUsd', cell: (r) => formatCurrency(r.costUsd) },
              ]}
              data={dailyTrends}
              isLoading={isLoading}
              emptyMessage={t('overview.noTrendHistory')}
            />
          </CardContent>
        </Card>

        {/* AI Model Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Cpu className="h-4 w-4 text-cyan-400" />
              {t('overview.modelDistributionTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { header: t('overview.modelCol'), accessorKey: 'model', cell: (r) => <span className="font-semibold text-slate-100">{r.model}</span> },
                { header: t('overview.callsCol'), accessorKey: 'calls', cell: (r) => formatNumber(r.calls) },
                { header: t('overview.tokensCol'), accessorKey: 'tokens', cell: (r) => formatTokens(r.tokens) },
                { header: t('overview.costCol'), accessorKey: 'costUsd', cell: (r) => formatCurrency(r.costUsd) },
                { header: t('overview.avgLatencyCol'), accessorKey: 'avgLatencyMs', cell: (r) => `${r.avgLatencyMs || 0}ms` },
              ]}
              data={modelBreakdown}
              isLoading={isLoading}
              emptyMessage={t('overview.noModelRecords')}
            />
          </CardContent>
        </Card>
      </div>

      {/* Top Users Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            <Users className="h-4 w-4 text-emerald-400" />
            {t('overview.topUsersTitle')}
          </CardTitle>
          <Link href="/users" className="text-xs font-mono text-brand-400 hover:text-brand-300">
            {t('overview.viewAllUsers')}
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={[
              { header: t('overview.userIdentifierCol'), accessorKey: 'userId', cell: (r) => <span className="text-slate-300">{r.userId}</span> },
              { header: t('overview.phoneCol'), accessorKey: 'phone', cell: (r) => <span className="text-slate-200">{r.phone || '—'}</span> },
              { header: t('overview.totalMessagesCol'), accessorKey: 'messageCount', cell: (r) => formatNumber(r.messageCount) },
              { header: t('overview.lastActiveCol'), accessorKey: 'lastActive', cell: (r) => formatRelativeTime(r.lastActive) },
            ]}
            data={topUsers}
            isLoading={isLoading}
            emptyMessage={t('overview.noActiveUsers')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
