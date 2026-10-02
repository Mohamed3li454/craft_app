'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Search, RotateCcw, XCircle, AlertCircle, ShieldAlert } from 'lucide-react';
import { truncate } from '@/lib/utils';
import { AdminReminderItem } from '@/types/admin';

export default function RemindersPage() {
  const { canMutate } = useAuth();
  const { t, formatDate, formatRelativeTime } = useLanguage();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Modals
  const [cancelModalReminder, setCancelModalReminder] = useState<AdminReminderItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [retryModalReminder, setRetryModalReminder] = useState<AdminReminderItem | null>(null);

  const queryParams = {
    search: search.trim() || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-reminders', queryParams],
    queryFn: () => adminApi.getReminders(queryParams),
  });

  const reminders = data?.data || [];
  const total = data?.pagination?.total;

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      adminApi.cancelReminder(id, reason),
    onSuccess: () => {
      setCancelModalReminder(null);
      setCancelReason('');
      queryClient.invalidateQueries({ queryKey: ['admin-reminders'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => adminApi.retryReminder(id),
    onSuccess: () => {
      setRetryModalReminder(null);
      queryClient.invalidateQueries({ queryKey: ['admin-reminders'] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('reminders.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('reminders.subtitle')}
          </p>
        </div>
      </div>

      {/* Safety Notice Banner */}
      <div className="flex items-center gap-2.5 p-3 rounded-lg border border-brand-800/40 bg-brand-950/20 text-brand-300 text-xs font-mono">
        <ShieldAlert className="h-4 w-4 shrink-0 text-brand-400" />
        <span>
          {t('reminders.invariantNotice')}
        </span>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title={t('reminders.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}
      {cancelMutation.error && (
        <ErrorAlert error={cancelMutation.error} title={t('reminders.failedToCancel')} />
      )}
      {retryMutation.error && (
        <ErrorAlert error={retryMutation.error} title={t('reminders.failedToRetry')} />
      )}

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Input
              placeholder={t('reminders.searchPlaceholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              icon={<Search className="h-4 w-4" />}
            />
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-slate-200 focus:outline-none"
            >
              <option value="all">{t('common.allStatuses')}</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Reminders Table */}
      <DataTable
        columns={[
          {
            header: t('reminders.titleCol'),
            accessorKey: 'title',
            cell: (r) => (
              <div>
                <span className="font-semibold text-slate-100">{r.title}</span>
                {r.lastError && (
                  <p className="text-[11px] text-rose-400 mt-0.5 italic flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {truncate(r.lastError, 40)}
                  </p>
                )}
              </div>
            ),
          },
          {
            header: t('reminders.recipientContact'),
            accessorKey: 'userPhone',
            cell: (r) => <span className="text-slate-200">{r.userPhone || ((r as any).userId ? (r as any).userId.replace(/^wa_/, '') : '') || truncate(r.userId, 16)}</span>,
          },
          {
            header: t('reminders.scheduledFor'),
            accessorKey: 'scheduledTime',
            cell: (r) => {
              const time = r.scheduledTime || (r as any).dueAt;
              return (
                <div>
                  <span className="text-slate-200">{formatDate(time)}</span>
                  <span className="text-[10px] text-slate-400 block">{formatRelativeTime(time)}</span>
                </div>
              );
            },
          },
          {
            header: t('reminders.colStatus'),
            accessorKey: 'status',
            cell: (r) => <StatusPill status={r.status || (r as any).state || 'scheduled'} />,
          },
          {
            header: t('reminders.colRetries'),
            accessorKey: 'retryCount',
            cell: (r) => {
              const retries = r.retryCount ?? (r as any).attempts ?? 0;
              return (
                <span className={`font-mono text-xs ${retries > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                  {retries}
                </span>
              );
            },
          },
          {
            header: t('reminders.colActions'),
            cell: (r) => (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {canMutate && (
                  <>
                    {(r.status === 'failed' || r.status === 'cancelled' || (r as any).state === 'failed' || (r as any).state === 'cancelled') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setRetryModalReminder(r)}
                        title={t('reminders.btnRetry')}
                      >
                        <RotateCcw className="h-3.5 w-3.5 me-1 text-cyan-400" />
                        {t('reminders.btnRetry')}
                      </Button>
                    )}

                    {(r.status === 'pending' || r.status === 'failed') && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setCancelModalReminder(r)}
                        title={t('reminders.btnCancel')}
                      >
                        <XCircle className="h-3.5 w-3.5 me-1" />
                        {t('reminders.btnCancel')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            ),
          },
        ]}
        data={reminders}
        isLoading={isLoading}
        emptyMessage={t('reminders.noReminders')}
        pagination={{
          currentPage: page,
          hasMore: total !== undefined ? page * limit < total : reminders.length === limit,
          onNext: () => setPage((p) => p + 1),
          onPrev: () => setPage((p) => Math.max(1, p - 1)),
          total,
        }}
      />

      {/* Cancel Reminder Modal */}
      <ConfirmModal
        isOpen={Boolean(cancelModalReminder)}
        onClose={() => setCancelModalReminder(null)}
        onConfirm={() =>
          cancelMutation.mutate({
            id: cancelModalReminder!.id,
            reason: cancelReason,
          })
        }
        title={`${t('reminders.cancelModalTitle')}: "${cancelModalReminder?.title}"`}
        description={t('reminders.cancelModalDesc')}
        confirmText={t('reminders.confirmCancel')}
        variant="destructive"
        isLoading={cancelMutation.isPending}
      >
        <div className="space-y-1 mt-2">
          <label className="text-[11px] font-mono text-slate-400">{t('reminders.optionalReason')}</label>
          <Input
            placeholder={t('reminders.reasonPlaceholder')}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      </ConfirmModal>

      {/* Retry Reminder Modal */}
      <ConfirmModal
        isOpen={Boolean(retryModalReminder)}
        onClose={() => setRetryModalReminder(null)}
        onConfirm={() => retryMutation.mutate(retryModalReminder!.id)}
        title={`${t('reminders.retryModalTitle')}: "${retryModalReminder?.title}"`}
        description={t('reminders.retryModalDesc')}
        confirmText={t('reminders.rescheduleDispatch')}
        variant="primary"
        isLoading={retryMutation.isPending}
      />
    </div>
  );
}
