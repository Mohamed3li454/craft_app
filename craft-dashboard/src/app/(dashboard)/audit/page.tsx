'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Search, Eye, Lock } from 'lucide-react';
import { formatDate, formatRelativeTime, truncate, safeJsonStringify } from '@/lib/utils';
import { AdminAuditItem } from '@/types/admin';

export default function AuditPage() {
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
            ADMIN AUDIT TRAIL & COMPLIANCE LOGS
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Immutable, append-only security log of all administrative actions and control plane mutations
          </p>
        </div>
      </div>

      {/* Security Callout */}
      <div className="flex items-center gap-2.5 p-3 rounded-lg border border-border bg-surface-elevated/40 text-slate-300 text-xs font-mono">
        <Lock className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>
          Compliance Invariant: The audit trail is strictly read-only and recorded synchronously with correlation IDs across all operational endpoints.
        </span>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            placeholder="Filter by Actor ID or username..."
            value={actorFilter}
            onChange={(e) => {
              setActorFilter(e.target.value);
              setPage(1);
            }}
            icon={<Search className="h-4 w-4" />}
          />
          <Input
            placeholder="Filter by Action (e.g. USER_BAN, REMINDER_RETRY)..."
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
          title="Failed to load compliance audit logs"
          onRetry={() => refetch()}
        />
      )}

      {/* Audit Table */}
      <DataTable
        columns={[
          {
            header: 'Timestamp',
            accessorKey: 'createdAt',
            cell: (a) => (
              <div>
                <span className="text-slate-200">{formatDate(a.createdAt)}</span>
                <span className="text-[10px] text-slate-400 block">{formatRelativeTime(a.createdAt)}</span>
              </div>
            ),
          },
          {
            header: 'Actor',
            accessorKey: 'actorId',
            cell: (a) => (
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-slate-100">{a.actorId || 'system'}</span>
                <Badge variant="purple" className="text-[10px] py-0 px-1">
                  {a.actorRole || 'admin'}
                </Badge>
              </div>
            ),
          },
          {
            header: 'Action',
            accessorKey: 'action',
            cell: (a) => <span className="font-mono font-bold text-brand-300">{a.action}</span>,
          },
          {
            header: 'Target Resource',
            accessorKey: 'resourceType',
            cell: (a) => (
              <span className="text-slate-300 text-xs font-mono">
                {a.resourceType}: <strong className="text-slate-100">{truncate(a.resourceId, 16)}</strong>
              </span>
            ),
          },
          {
            header: 'Correlation ID',
            accessorKey: 'correlationId',
            cell: (a) => <span className="text-slate-400 text-[11px]">{truncate(a.correlationId, 12)}</span>,
          },
          {
            header: 'Inspect',
            cell: (a) => (
              <Button variant="outline" size="sm" onClick={() => setSelectedAudit(a)}>
                <Eye className="h-3.5 w-3.5 mr-1" />
                Payload
              </Button>
            ),
          },
        ]}
        data={auditLogs}
        isLoading={isLoading}
        emptyMessage="No audit logs matching filters"
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
        title={`AUDIT EVENT: ${selectedAudit?.action}`}
        subtitle={`Actor: ${selectedAudit?.actorId} (${selectedAudit?.actorRole}) • ${formatDate(selectedAudit?.createdAt)}`}
        width="xl"
      >
        {selectedAudit && (
          <div className="space-y-4 font-mono text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400 block text-[10px] uppercase">Resource Type</span>
                <span className="font-semibold text-slate-200 mt-1 block">{selectedAudit.resourceType}</span>
              </div>
              <div className="p-3 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400 block text-[10px] uppercase">Resource ID</span>
                <span className="font-semibold text-slate-200 mt-1 block">{selectedAudit.resourceId || '—'}</span>
              </div>
            </div>

            <div className="p-3 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400 block text-[10px] uppercase">Correlation ID</span>
              <span className="font-semibold text-cyan-300 mt-1 block">{selectedAudit.correlationId}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[11px] uppercase font-semibold mb-1">
                Event Mutation Metadata
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
