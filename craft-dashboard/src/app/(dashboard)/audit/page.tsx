'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Search, Eye, Lock } from 'lucide-react';
import { truncate, safeJsonStringify } from '@/lib/utils';
import { AdminAuditItem } from '@/types/admin';

export default function AuditPage() {
  const { t, formatDate, formatRelativeTime } = useLanguage();
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const [selectedAudit, setSelectedAudit] = useState<AdminAuditItem | null>(null);

  const queryParams = {
    actorId: actorFilter.trim() || undefined,
    action: actionFilter.trim() || undefined,
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-audit-logs', queryParams],
    queryFn: () => adminApi.getAuditLogs(queryParams),
  });

  const auditLogs = data?.data || [];
  const total = data?.pagination?.total;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('audit.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('audit.subtitle')}
          </p>
        </div>
      </div>

      {/* Security Callout */}
      <div className="flex items-center gap-2.5 p-3 rounded-lg border border-border bg-surface-elevated/40 text-slate-300 text-xs font-mono">
        <Lock className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>
          {t('audit.invariantNotice')}
        </span>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            placeholder={t('audit.filterActor')}
            value={actorFilter}
            onChange={(e) => {
              setActorFilter(e.target.value);
              setPage(1);
            }}
            icon={<Search className="h-4 w-4" />}
          />
          <Input
            placeholder={t('audit.filterAction')}
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            icon={<Search className="h-4 w-4" />}
          />
        </div>
      </Card>

      {error && (
        <ErrorAlert
          error={error}
          title={t('audit.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}

      {/* Audit Table */}
      <DataTable
        columns={[
          {
            header: t('audit.colTimestamp'),
            accessorKey: 'createdAt',
            cell: (a) => (
              <div>
                <span className="text-slate-200">{formatDate(a.createdAt)}</span>
                <span className="text-[10px] text-slate-400 block">{formatRelativeTime(a.createdAt)}</span>
              </div>
            ),
          },
          {
            header: t('audit.colActor'),
            accessorKey: 'actorId',
            cell: (a) => (
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-100">{a.actorId || 'system'}</span>
                <Badge variant="purple" className="text-[10px] py-0 px-1">
                  {a.actorRole || 'admin'}
                </Badge>
              </div>
            ),
          },
          {
            header: t('audit.colAction'),
            accessorKey: 'action',
            cell: (a) => <span className="font-mono font-bold text-brand-300">{a.action}</span>,
          },
          {
            header: t('audit.targetResource'),
            accessorKey: 'resourceType',
            cell: (a) => (
              <span className="text-slate-300 text-xs font-mono">
                {a.resourceType}: <strong className="text-slate-100">{truncate(a.resourceId, 16)}</strong>
              </span>
            ),
          },
          {
            header: t('audit.colCorrelationId'),
            accessorKey: 'correlationId',
            cell: (a) => <span className="text-slate-400 text-[11px]">{truncate(a.correlationId, 12)}</span>,
          },
          {
            header: t('audit.colActions'),
            cell: (a) => (
              <Button variant="outline" size="sm" onClick={() => setSelectedAudit(a)}>
                <Eye className="h-3.5 w-3.5 me-1" />
                {t('audit.inspectPayload')}
              </Button>
            ),
          },
        ]}
        data={auditLogs}
        isLoading={isLoading}
        emptyMessage={t('audit.noLogs')}
        pagination={{
          currentPage: page,
          hasMore: total !== undefined ? page * limit < total : auditLogs.length === limit,
          onNext: () => setPage((p) => p + 1),
          onPrev: () => setPage((p) => Math.max(1, p - 1)),
          total,
        }}
      />

      {/* Audit Detail Drawer */}
      <Drawer
        isOpen={Boolean(selectedAudit)}
        onClose={() => setSelectedAudit(null)}
        title={t('audit.eventTitle', { action: selectedAudit?.action || '' })}
        subtitle={t('audit.eventSubtitle', {
          actor: selectedAudit?.actorId || '',
          role: selectedAudit?.actorRole || '',
          time: formatDate(selectedAudit?.createdAt),
        })}
        width="xl"
      >
        {selectedAudit && (
          <div className="space-y-4 font-mono text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400 block text-[10px] uppercase">{t('audit.resourceType')}</span>
                <span className="font-semibold text-slate-200 mt-1 block">{selectedAudit.resourceType}</span>
              </div>
              <div className="p-3 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400 block text-[10px] uppercase">{t('audit.resourceId')}</span>
                <span className="font-semibold text-slate-200 mt-1 block">{selectedAudit.resourceId || '—'}</span>
              </div>
            </div>

            <div className="p-3 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400 block text-[10px] uppercase">{t('audit.colCorrelationId')}</span>
              <span className="font-semibold text-cyan-300 mt-1 block">{selectedAudit.correlationId}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[11px] uppercase font-semibold mb-1">
                {t('audit.mutationMetadata')}
              </span>
              <pre className="p-3 rounded-md bg-surface-elevated border border-border text-slate-200 overflow-x-auto text-[11px]">
                {safeJsonStringify(selectedAudit.details)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
