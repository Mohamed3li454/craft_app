'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Wrench, Search, Eye } from 'lucide-react';
import { truncate, safeJsonStringify } from '@/lib/utils';
import { AdminToolCallItem } from '@/types/admin';

export default function ToolsPage() {
  const { t, formatDate, formatRelativeTime } = useLanguage();
  const [toolNameFilter, setToolNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [selectedToolCall, setSelectedToolCall] = useState<AdminToolCallItem | null>(null);

  const queryParams = {
    toolName: toolNameFilter.trim() || undefined,
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-tool-calls', queryParams],
    queryFn: () => adminApi.getToolCalls(queryParams),
  });

  const toolCalls = data?.data || [];
  const total = data?.pagination?.total;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('tools.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('tools.subtitle')}
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="max-w-md">
          <Input
            placeholder={t('tools.filterPlaceholder')}
            value={toolNameFilter}
            onChange={(e) => {
              setToolNameFilter(e.target.value);
              setPage(1);
            }}
            icon={<Search className="h-4 w-4" />}
          />
        </div>
      </Card>

      {error && (
        <ErrorAlert
          error={error}
          title={t('tools.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}

      {/* Tool Calls Table */}
      <DataTable
        columns={[
          {
            header: t('tools.colToolName'),
            accessorKey: 'toolName',
            cell: (tCol) => (
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-brand-400" />
                <span className="font-semibold text-slate-100">{tCol.toolName}</span>
              </div>
            ),
          },
          {
            header: t('tools.colStatus'),
            accessorKey: 'status',
            cell: (tCol) => <StatusPill status={tCol.status} />,
          },
          {
            header: t('tools.colDuration'),
            accessorKey: 'durationMs',
            cell: (tCol) => (
              <span className={`font-mono text-xs ${tCol.durationMs > 2000 ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>
                {tCol.durationMs || 0}ms
              </span>
            ),
          },
          {
            header: t('tools.runId'),
            accessorKey: 'runId',
            cell: (tCol) => <span className="text-slate-400 text-xs">{truncate(tCol.runId, 16)}</span>,
          },
          {
            header: t('tools.executedAt'),
            accessorKey: 'createdAt',
            cell: (tCol) => formatRelativeTime(tCol.createdAt),
          },
          {
            header: t('common.actions'),
            cell: (tCol) => (
              <Button variant="outline" size="sm" onClick={() => setSelectedToolCall(tCol)}>
                <Eye className="h-3.5 w-3.5 me-1" />
                {t('tools.btnViewPayload')}
              </Button>
            ),
          },
        ]}
        data={toolCalls}
        isLoading={isLoading}
        emptyMessage={t('tools.noTools')}
        pagination={{
          currentPage: page,
          hasMore: total !== undefined ? page * limit < total : toolCalls.length === limit,
          onNext: () => setPage((p) => p + 1),
          onPrev: () => setPage((p) => Math.max(1, p - 1)),
          total,
        }}
      />

      {/* Tool Call Inspector Drawer */}
      <Drawer
        isOpen={Boolean(selectedToolCall)}
        onClose={() => setSelectedToolCall(null)}
        title={t('tools.inspectionTitle', { name: selectedToolCall?.toolName || '' })}
        subtitle={t('tools.inspectionSubtitle', {
          duration: String(selectedToolCall?.durationMs || 0),
          time: formatDate(selectedToolCall?.createdAt),
        })}
        width="xl"
      >
        {selectedToolCall && (
          <div className="space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400 uppercase">{t('tools.outcomeStatus')}</span>
              <StatusPill status={selectedToolCall.status} />
            </div>

            <div>
              <span className="text-slate-400 uppercase font-semibold block mb-1">
                {t('tools.sanitizedInput')}
              </span>
              <pre className="p-3 rounded-md bg-surface-elevated border border-border/70 text-slate-200 overflow-x-auto text-[11px]">
                {safeJsonStringify(selectedToolCall.argumentsSanitized)}
              </pre>
            </div>

            <div>
              <span className="text-slate-400 uppercase font-semibold block mb-1">
                {t('tools.sanitizedOutput')}
              </span>
              <pre className="p-3 rounded-md bg-surface-elevated border border-border/70 text-slate-200 overflow-x-auto text-[11px]">
                {safeJsonStringify(selectedToolCall.resultSanitized)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
