'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Tabs } from '@/components/ui/tabs';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Brain, Check, X, Search, Sparkles } from 'lucide-react';
import { formatRelativeTime, truncate } from '@/lib/utils';
import { AdminMemoryCandidate } from '@/types/admin';

export default function MemoryPage() {
  const { canMutate } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'confirmed' | 'candidates'>('confirmed');
  const [searchUser, setSearchUser] = useState('');
  const [candidateStatus, setCandidateStatus] = useState<string>('pending');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Modals
  const [selectedCandidate, setSelectedCandidate] = useState<AdminMemoryCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // 1. Confirmed Memories Query
  const confirmedQuery = useQuery({
    queryKey: ['admin-memory', { userId: searchUser.trim() || undefined, limit, offset: (page - 1) * limit }],
    queryFn: () =>
      adminApi.getMemoryItems({
        userId: searchUser.trim() || undefined,
        limit,
        offset: (page - 1) * limit,
      }),
    enabled: activeTab === 'confirmed',
  });

  // 2. Evidence Candidates Query
  const candidatesQuery = useQuery({
    queryKey: ['admin-memory-candidates', { status: candidateStatus, limit, offset: (page - 1) * limit }],
    queryFn: () =>
      adminApi.getMemoryCandidates({
        status: candidateStatus === 'all' ? undefined : candidateStatus,
        limit,
        offset: (page - 1) * limit,
      }),
    enabled: activeTab === 'candidates',
  });

  const confirmedItems = confirmedQuery.data?.data || [];
  const candidateItems = candidatesQuery.data?.data || [];

  // Mutations
  const approveMutation = useMutation({
    mutationFn: (id: string) => adminApi.approveMemoryCandidate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-memory-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['admin-memory'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      adminApi.rejectMemoryCandidate(id, reason),
    onSuccess: () => {
      setSelectedCandidate(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['admin-memory-candidates'] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            MEMORY INTELLIGENCE & EVIDENCE ENGINE
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            User persona facts, autonomous memory extraction candidates, and verification control
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'confirmed', label: 'Confirmed Memories', icon: <Brain className="h-3.5 w-3.5" /> },
          { id: 'candidates', label: 'Evidence Candidates (Review Queue)', icon: <Sparkles className="h-3.5 w-3.5" /> },
        ]}
        activeTab={activeTab}
        onChange={(tab) => {
          setActiveTab(tab as any);
          setPage(1);
        }}
      />

      {(confirmedQuery.error || candidatesQuery.error || approveMutation.error || rejectMutation.error) && (
        <ErrorAlert
          error={(confirmedQuery.error || candidatesQuery.error || approveMutation.error || rejectMutation.error) as any}
          title="Memory Operation Error"
          onRetry={() => {
            if (activeTab === 'confirmed') confirmedQuery.refetch();
            else candidatesQuery.refetch();
          }}
        />
      )}

      {/* Confirmed Memories Tab */}
      {activeTab === 'confirmed' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="max-w-md">
              <Input
                placeholder="Filter memories by User ID or phone..."
                value={searchUser}
                onChange={(e) => {
                  setSearchUser(e.target.value);
                  setPage(1);
                }}
                icon={<Search className="h-4 w-4" />}
              />
            </div>
          </Card>

          <DataTable
            columns={[
              {
                header: 'User',
                accessorKey: 'userPhone',
                cell: (m) => <span className="font-semibold text-slate-200">{m.userPhone || truncate(m.userId, 16)}</span>,
              },
              {
                header: 'Category',
                accessorKey: 'category',
                cell: (m) => (
                  <Badge variant="purple" className="uppercase text-[10px]">
                    {m.category}
                  </Badge>
                ),
              },
              {
                header: 'Key',
                accessorKey: 'key',
                cell: (m) => <span className="text-slate-100 font-medium">{m.key}</span>,
              },
              {
                header: 'Value',
                accessorKey: 'value',
                cell: (m) => <span className="text-slate-300">{m.value}</span>,
              },
              {
                header: 'Confidence',
                accessorKey: 'confidence',
                cell: (m) => (
                  <span className="text-xs font-mono text-emerald-400">
                    {Math.round((m.confidence || 1) * 100)}%
                  </span>
                ),
              },
              {
                header: 'Source',
                accessorKey: 'source',
                cell: (m) => <span className="text-slate-400 text-xs">{m.source || 'conversation'}</span>,
              },
              {
                header: 'Updated',
                accessorKey: 'updatedAt',
                cell: (m) => formatRelativeTime(m.updatedAt || m.createdAt),
              },
            ]}
            data={confirmedItems}
            isLoading={confirmedQuery.isLoading}
            emptyMessage="No confirmed memory items found"
            pagination={{
              currentPage: page,
              hasMore: confirmedItems.length === limit,
              onNext: () => setPage((p) => p + 1),
              onPrev: () => setPage((p) => Math.max(1, p - 1)),
              total: confirmedQuery.data?.pagination?.total,
            }}
          />
        </div>
      )}

      {/* Evidence Candidates Tab */}
      {activeTab === 'candidates' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center space-x-3">
              <select
                value={candidateStatus}
                onChange={(e) => {
                  setCandidateStatus(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-slate-200 focus:outline-none"
              >
                <option value="pending">Review Queue: Pending Only</option>
                <option value="approved">Approved Candidates</option>
                <option value="rejected">Rejected Candidates</option>
                <option value="all">All Candidate States</option>
              </select>
            </div>
          </Card>

          <DataTable
            columns={[
              {
                header: 'User',
                accessorKey: 'userPhone',
                cell: (c) => <span className="font-semibold text-slate-200">{c.userPhone || truncate(c.userId, 16)}</span>,
              },
              {
                header: 'Proposed Memory',
                cell: (c) => (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="purple" className="text-[10px] py-0">
                        {c.category}
                      </Badge>
                      <span className="font-semibold text-slate-100">{c.key}</span>
                    </div>
                    <p className="text-xs text-slate-300 font-sans">{c.extractedValue}</p>
                  </div>
                ),
              },
              {
                header: 'Confidence',
                accessorKey: 'confidence',
                cell: (c) => (
                  <span className="text-xs font-mono font-bold text-amber-300">
                    {Math.round((c.confidence || 0) * 100)}%
                  </span>
                ),
              },
              {
                header: 'Evidence Snippet',
                accessorKey: 'evidenceSnippet',
                cell: (c) => (
                  <div className="max-w-md p-2 rounded bg-surface-elevated/40 border border-border/60 text-xs italic text-slate-400 font-sans">
                    &quot;{truncate(c.evidenceSnippet, 80)}&quot;
                  </div>
                ),
              },
              {
                header: 'Status',
                accessorKey: 'status',
                cell: (c) => <StatusPill status={c.status} />,
              },
              {
                header: 'Actions',
                cell: (c) => (
                  <div className="flex items-center space-x-1.5">
                    {canMutate && c.status === 'pending' ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => approveMutation.mutate(c.id)}
                          isLoading={approveMutation.isPending}
                          title="Approve Memory Candidate"
                        >
                          <Check className="h-3.5 w-3.5 mr-1 text-emerald-300" />
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setSelectedCandidate(c)}
                          title="Reject Memory Candidate"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400 font-mono">—</span>
                    )}
                  </div>
                ),
              },
            ]}
            data={candidateItems}
            isLoading={candidatesQuery.isLoading}
            emptyMessage="No evidence candidates in queue"
            pagination={{
              currentPage: page,
              hasMore: candidateItems.length === limit,
              onNext: () => setPage((p) => p + 1),
              onPrev: () => setPage((p) => Math.max(1, p - 1)),
              total: candidatesQuery.data?.pagination?.total,
            }}
          />
        </div>
      )}

      {/* Reject Candidate Modal */}
      <ConfirmModal
        isOpen={Boolean(selectedCandidate)}
        onClose={() => setSelectedCandidate(null)}
        onConfirm={() =>
          rejectMutation.mutate({
            id: selectedCandidate!.id,
            reason: rejectReason,
          })
        }
        title="Reject Evidence Candidate"
        description="Rejecting this candidate prevents it from being committed to the long-term user memory store."
        confirmText="Confirm Rejection"
        variant="destructive"
        isLoading={rejectMutation.isPending}
      >
        <div className="space-y-1 mt-2">
          <label className="text-[11px] font-mono text-slate-400">Rejection Reason</label>
          <Input
            placeholder="e.g. Inaccurate inference, transient context"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </div>
      </ConfirmModal>
    </div>
  );
}
