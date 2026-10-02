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
import { formatNumber, formatCurrency, formatTokens, formatRelativeTime } from '@/lib/utils';
import Link from 'next/link';

export default function OverviewPage() {
  const [days, setDays] = useState(14);

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
            MISSION CONTROL OVERVIEW
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Real-time platform telemetry, user metrics, and operational performance
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-surface-elevated px-2.5 text-xs font-mono text-slate-200 focus:outline-none"
          >
            <option value={7}>Last 7 Days</option>
            <option value={14}>Last 14 Days</option>
            <option value={30}>Last 30 Days</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            isLoading={isRefetching}
            className="font-mono text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title="Failed to load mission control overview"
          onRetry={() => refetch()}
        />
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          title="Total Users"
          value={isLoading ? '...' : formatNumber(overview?.totalUsers)}
          subtext={`${formatNumber(overview?.activeUsers24h)} active 24h`}
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          title="Active Users (7d)"
          value={isLoading ? '...' : formatNumber(overview?.activeUsers7d)}
          subtext="Weekly active reach"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          title="Messages"
          value={isLoading ? '...' : formatNumber(overview?.totalMessages)}
          subtext={`${formatNumber(overview?.totalConversations)} conversations`}
          icon={<MessageSquare className="h-4 w-4" />}
        />
        <MetricCard
          title="Reminders"
          value={isLoading ? '...' : formatNumber(overview?.totalReminders)}
          subtext={`${formatNumber(overview?.pendingReminders)} pending`}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          title="Token Usage"
          value={isLoading ? '...' : formatTokens(overview?.totalTokens)}
          subtext={formatCurrency(overview?.totalCostUsd)}
          icon={<Cpu className="h-4 w-4" />}
        />
        <MetricCard
          title="Cache Hit Rate"
          value={isLoading ? '...' : `${overview?.cacheHitRatePercent ?? 0}%`}
          subtext="Semantic response cache"
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
              Daily Volume & Cost Trends ({days}d)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { header: 'Date', accessorKey: 'date', cell: (r) => <span className="text-slate-200">{r.date}</span> },
                { header: 'Messages', accessorKey: 'messageCount', cell: (r) => formatNumber(r.messageCount) },
                { header: 'Active Users', accessorKey: 'activeUsers', cell: (r) => formatNumber(r.activeUsers) },
                { header: 'Tokens', accessorKey: 'tokenCount', cell: (r) => formatTokens(r.tokenCount) },
                { header: 'Cost', accessorKey: 'costUsd', cell: (r) => formatCurrency(r.costUsd) },
              ]}
              data={dailyTrends}
              isLoading={isLoading}
              emptyMessage="No trend history recorded"
            />
          </CardContent>
        </Card>

        {/* AI Model Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Cpu className="h-4 w-4 text-cyan-400" />
              Model Inference Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { header: 'Model', accessorKey: 'model', cell: (r) => <span className="font-semibold text-slate-100">{r.model}</span> },
                { header: 'Calls', accessorKey: 'calls', cell: (r) => formatNumber(r.calls) },
                { header: 'Tokens', accessorKey: 'tokens', cell: (r) => formatTokens(r.tokens) },
                { header: 'Cost', accessorKey: 'costUsd', cell: (r) => formatCurrency(r.costUsd) },
                { header: 'Avg Latency', accessorKey: 'avgLatencyMs', cell: (r) => `${r.avgLatencyMs || 0}ms` },
              ]}
              data={modelBreakdown}
              isLoading={isLoading}
              emptyMessage="No model inference records found"
            />
          </CardContent>
        </Card>
      </div>

      {/* Top Users Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            <Users className="h-4 w-4 text-emerald-400" />
            Top Active WhatsApp Users
          </CardTitle>
          <Link href="/users" className="text-xs font-mono text-brand-400 hover:text-brand-300">
            View All Users →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={[
              { header: 'User Identifier', accessorKey: 'userId', cell: (r) => <span className="text-slate-300">{r.userId}</span> },
              { header: 'Phone', accessorKey: 'phone', cell: (r) => <span className="text-slate-200">{r.phone || '—'}</span> },
              { header: 'Total Messages', accessorKey: 'messageCount', cell: (r) => formatNumber(r.messageCount) },
              { header: 'Last Active', accessorKey: 'lastActive', cell: (r) => formatRelativeTime(r.lastActive) },
            ]}
            data={topUsers}
            isLoading={isLoading}
            emptyMessage="No active user data available"
          />
        </CardContent>
      </Card>
    </div>
  );
}
