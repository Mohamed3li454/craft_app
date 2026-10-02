'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Tabs } from '@/components/ui/tabs';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Send, RotateCcw, XCircle, BarChart3, Radio } from 'lucide-react';
import { formatNumber, formatDate, formatRelativeTime, truncate } from '@/lib/utils';
import { AdminProactiveAction } from '@/types/admin';

export default function ProactivePage() {
  const { canMutate } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'actions' | 'engagement'>('actions');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Modals
  const [cancelModalAction, setCancelModalAction] = useState<AdminProactiveAction | null>(null);
  const [retryModalAction, setRetryModalAction] = useState<AdminProactiveAction | null>(null);

  // Queries
  const actionsQuery = useQuery({
    queryKey: ['admin-proactive-actions', { status: statusFilter === 'all' ? undefined : statusFilter, limit, offset: (page - 1) * limit }],
    queryFn: () =>
      adminApi.getProactiveActions({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit,
        offset: (page - 1) * limit,
      }),
    enabled: activeTab === 'actions',
  });

  const engagementQuery = useQuery({
    queryKey: ['admin-proactive-engagement'],
    queryFn: () => adminApi.getProactiveEngagement(),
    enabled: activeTab === 'engagement',
  });

  const dispatchLogQuery = useQuery({
    queryKey: ['admin-proactive-dispatch-log'],
    queryFn: () => adminApi.getProactiveDispatchLog(),
    enabled: activeTab === 'engagement',
  });

  const actions = actionsQuery.data?.data || [];
  const engagement = engagementQuery.data?.data;
  const dispatchLogs = dispatchLogQuery.data?.data || [];

  // Mutations
  const cancelMutation = useMutation({
    mutationFn: (id: string) => adminApi.cancelProactiveAction(id),
    onSuccess: () => {
      setCancelModalAction(null);
      queryClient.invalidateQueries({ queryKey: ['admin-proactive-actions'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => adminApi.retryProactiveAction(id),
    onSuccess: () => {
      setRetryModalAction(null);
      queryClient.invalidateQueries({ queryKey: ['admin-proactive-actions'] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            PROACTIVE ENGAGEMENT ENGINE
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Autonomous follow-ups, contextual check-ins, and conversation reactivation
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'actions', label: 'Proactive Actions', icon: <Radio className="h-3.5 w-3.5" /> },
          { id: 'engagement', label: 'Engagement & Dispatch Logs', icon: <BarChart3 className="h-3.5 w-3.5" /> },
        ]}
        activeTab={activeTab}
        onChange={(t) => setActiveTab(t as any)}
      />

      {(actionsQuery.error || engagementQuery.error || dispatchLogQuery.error || cancelMutation.error || retryMutation.error) && (
        <ErrorAlert
          error={(actionsQuery.error || engagementQuery.error || dispatchLogQuery.error || cancelMutation.error || retryMutation.error) as any}
          title="Proactive Subsystem Error"
          onRetry={() => {
            if (activeTab === 'actions') actionsQuery.refetch();
            else {
              engagementQuery.refetch();
              dispatchLogQuery.refetch();
            }
          }}
        />
      )}

      {/* Tab 1: Proactive Actions */}
      {activeTab === 'actions' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="max-w-xs">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-slate-200 focus:outline-none"
              >
                <option value="all">Action Status: All</option>
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </Card>

          <DataTable
            columns={[
              {
                header: 'Action Type',
                accessorKey: 'actionType',
                cell: (a) => (
                  <Badge variant="purple" className="uppercase text-[10px]">
                    {a.actionType}
                  </Badge>
                ),
              },
              {
                header: 'Recipient',
                accessorKey: 'userPhone',
                cell: (a) => <span className="font-semibold text-slate-200">{a.userPhone || truncate(a.userId, 16)}</span>,
              },
              {
                header: 'Scheduled For',
                accessorKey: 'scheduledAt',
                cell: (a) => (
                  <div>
                    <span className="text-slate-200">{formatDate(a.scheduledAt)}</span>
                    <span className="text-[10px] text-slate-400 block">{formatRelativeTime(a.scheduledAt)}</span>
                  </div>
                ),
              },
              {
                header: 'Status',
                accessorKey: 'status',
                cell: (a) => <StatusPill status={a.status} />,
              },
              {
                header: 'Payload Preview',
                accessorKey: 'payload',
                cell: (a) => (
                  <span className="text-slate-400 text-xs italic">
                    {truncate(typeof a.payload === 'string' ? a.payload : JSON.stringify(a.payload), 40)}
                  </span>
                ),
              },
              {
                header: 'Actions',
                cell: (a) => (
                  <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                    {canMutate && (
                      <>
                        {a.status === 'failed' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setRetryModalAction(a)}
                            title="Retry Proactive Dispatch"
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1 text-cyan-400" />
                            Retry
                          </Button>
                        )}
                        {a.status === 'pending' && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setCancelModalAction(a)}
                            title="Cancel Action"
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Cancel
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            data={actions}
            isLoading={actionsQuery.isLoading}
            emptyMessage="No proactive actions recorded"
            pagination={{
              currentPage: page,
              hasMore: actionsQuery.data?.pagination?.total !== undefined ? page * limit < actionsQuery.data.pagination.total : actions.length === limit,
              onNext: () => setPage((p) => p + 1),
              onPrev: () => setPage((p) => Math.max(1, p - 1)),
              total: actionsQuery.data?.pagination?.total,
            }}
          />
        </div>
      )}

      {/* Tab 2: Engagement Metrics & Dispatch Logs */}
      {activeTab === 'engagement' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono">
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Total Dispatched</span>
              <span className="text-xl font-bold text-slate-100 mt-1 block">
                {formatNumber(engagement?.totalDispatches)}
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Delivered</span>
              <span className="text-xl font-bold text-emerald-400 mt-1 block">
                {formatNumber(engagement?.deliveredCount)}
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">User Replies</span>
              <span className="text-xl font-bold text-brand-300 mt-1 block">
                {formatNumber(engagement?.repliedCount)}
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Response Rate</span>
              <span className="text-xl font-bold text-amber-300 mt-1 block">
                {engagement?.responseRatePercent ?? 0}%
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Opt-Outs</span>
              <span className="text-xl font-bold text-slate-400 mt-1 block">
                {formatNumber(engagement?.optOutCount)}
              </span>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                <Send className="h-4 w-4 text-emerald-400" />
                Recent Proactive Dispatches
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={[
                  {
                    header: 'Recipient',
                    accessorKey: 'recipientPhone',
                    cell: (l) => <span className="font-semibold text-slate-200">{l.recipientPhone || l.userId || '—'}</span>,
                  },
                  {
                    header: 'Action Type',
                    accessorKey: 'actionType',
                    cell: (l) => <Badge variant="purple">{l.actionType || 'follow_up'}</Badge>,
                  },
                  {
                    header: 'Status',
                    accessorKey: 'status',
                    cell: (l) => <StatusPill status={l.status || 'delivered'} />,
                  },
                  {
                    header: 'Timestamp',
                    accessorKey: 'createdAt',
                    cell: (l) => formatRelativeTime(l.createdAt),
                  },
                ]}
                data={dispatchLogs}
                isLoading={dispatchLogQuery.isLoading}
                emptyMessage="No dispatch log events recorded"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cancel Modal */}
      <ConfirmModal
        isOpen={Boolean(cancelModalAction)}
        onClose={() => setCancelModalAction(null)}
        onConfirm={() => cancelMutation.mutate(cancelModalAction!.id)}
        title="Cancel Proactive Action"
        description="This will prevent the scheduled message from being dispatched to the user."
        confirmText="Cancel Action"
        variant="destructive"
        isLoading={cancelMutation.isPending}
      />

      {/* Retry Modal */}
      <ConfirmModal
        isOpen={Boolean(retryModalAction)}
        onClose={() => setRetryModalAction(null)}
        onConfirm={() => retryMutation.mutate(retryModalAction!.id)}
        title="Retry Proactive Dispatch"
        description="This will reset the action status and schedule immediate delivery attempt."
        confirmText="Retry Dispatch"
        variant="primary"
        isLoading={retryMutation.isPending}
      />
    </div>
  );
}
