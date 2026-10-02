'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Wrench, Search, Eye } from 'lucide-react';
import { formatDate, formatRelativeTime, truncate, safeJsonStringify } from '@/lib/utils';
import { AdminToolCallItem } from '@/types/admin';

export default function ToolsPage() {
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
            TOOL TELEMETRY & EXECUTION I/O
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Observability on tool invocations, duration latencies, and sanitized parameters
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="max-w-md">
          <Input
            placeholder="Filter by tool name (e.g. web_search, create_reminder)..."
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
          title="Failed to load tool execution telemetry"
          onRetry={() => refetch()}
        />
      )}

      {/* Tool Calls Table */}
      <DataTable
        columns={[
          {
            header: 'Tool Name',
            accessorKey: 'toolName',
            cell: (t) => (
              <div className="flex items-center space-x-2">
                <Wrench className="h-3.5 w-3.5 text-brand-400" />
                <span className="font-semibold text-slate-100">{t.toolName}</span>
              </div>
            ),
          },
          {
            header: 'Status',
            accessorKey: 'status',
            cell: (t) => <StatusPill status={t.status} />,
          },
          {
            header: 'Duration',
            accessorKey: 'durationMs',
            cell: (t) => (
              <span className={`font-mono text-xs ${t.durationMs > 2000 ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>
                {t.durationMs || 0}ms
              </span>
            ),
          },
          {
            header: 'Run ID',
            accessorKey: 'runId',
            cell: (t) => <span className="text-slate-400 text-xs">{truncate(t.runId, 16)}</span>,
          },
          {
            header: 'Executed At',
            accessorKey: 'createdAt',
            cell: (t) => formatRelativeTime(t.createdAt),
          },
          {
            header: 'Actions',
            cell: (t) => (
              <Button variant="outline" size="sm" onClick={() => setSelectedToolCall(t)}>
                <Eye className="h-3.5 w-3.5 mr-1" />
                Inspect I/O
              </Button>
            ),
          },
        ]}
        data={toolCalls}
        isLoading={isLoading}
        emptyMessage="No tool telemetry records found"
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
        title={`TOOL CALL INSPECTION: ${selectedToolCall?.toolName}`}
        subtitle={`Execution duration: ${selectedToolCall?.durationMs}ms • Recorded: ${formatDate(selectedToolCall?.createdAt)}`}
        width="xl"
      >
        {selectedToolCall && (
          <div className="space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400 uppercase">Outcome Status</span>
              <StatusPill status={selectedToolCall.status} />
            </div>

            <div>
              <span className="text-slate-400 uppercase font-semibold block mb-1">
                Sanitized Input Arguments
              </span>
              <pre className="p-3 rounded-md bg-surface-elevated border border-border/70 text-slate-200 overflow-x-auto text-[11px]">
                {safeJsonStringify(selectedToolCall.argumentsSanitized)}
              </pre>
            </div>

            <div>
              <span className="text-slate-400 uppercase font-semibold block mb-1">
                Execution Output Result
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
