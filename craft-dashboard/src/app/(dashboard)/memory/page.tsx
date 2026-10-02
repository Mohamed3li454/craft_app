'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
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
import { truncate } from '@/lib/utils';
import { AdminMemoryCandidate } from '@/types/admin';

export default function MemoryPage() {
  const { canMutate } = useAuth();
  const { t, formatRelativeTime } = useLanguage();
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
            {t('memory.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('memory.subtitle')}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'confirmed', label: t('memory.tabConfirmed'), icon: <Brain className="h-3.5 w-3.5" /> },
          { id: 'candidates', label: t('memory.tabCandidates'), icon: <Sparkles className="h-3.5 w-3.5" /> },
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
          title={t('memory.operationError')}
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
                placeholder={t('memory.filterPlaceholder')}
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
                header: t('memory.colUser'),
                accessorKey: 'userPhone',
                cell: (m) => <span className="font-semibold text-slate-200">{m.userPhone || truncate(m.userId, 16)}</span>,
              },
              {
                header: t('memory.colCategory'),
                accessorKey: 'category',
                cell: (m) => (
                  <Badge variant="purple" className="uppercase text-[10px]">
                    {m.category}
                  </Badge>
                ),
              },
              {
                header: t('memory.colKey'),
                accessorKey: 'key',
                cell: (m) => <span className="text-slate-100 font-medium">{m.key}</span>,
              },
              {
                header: t('memory.colValue'),
                accessorKey: 'value',
                cell: (m) => <span className="text-slate-300">{m.value}</span>,
              },
              {
                header: t('memory.colConfidence'),
                accessorKey: 'confidence',
                cell: (m) => (
                  <span className="text-xs font-mono text-emerald-400">
                    {Math.round((m.confidence || 1) * 100)}%
                  </span>
                ),
              },
              {
                header: t('memory.colSource'),
                accessorKey: 'source',
                cell: (m) => <span className="text-slate-400 text-xs">{m.source || 'conversation'}</span>,
              },
              {
                header: t('memory.colRecorded'),
                accessorKey: 'updatedAt',
                cell: (m) => formatRelativeTime(m.updatedAt || m.createdAt),
              },
            ]}
            data={confirmedItems}
            isLoading={confirmedQuery.isLoading}
            emptyMessage={t('memory.noConfirmed')}
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
            <div className="flex items-center gap-3">
              <select
                value={candidateStatus}
                onChange={(e) => {
                  setCandidateStatus(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-slate-200 focus:outline-none"
              >
                <option value="pending">{t('memory.pendingCandidates')}</option>
                <option value="approved">{t('memory.validatedCandidates')}</option>
                <option value="rejected">{t('memory.rejectedCandidates')}</option>
                <option value="all">{t('memory.allCandidates')}</option>
              </select>
            </div>
          </Card>

          <DataTable
            columns={[
              {
                header: t('memory.colUser'),
                accessorKey: 'userPhone',
                cell: (c) => <span className="font-semibold text-slate-200">{c.userPhone || truncate(c.userId, 16)}</span>,
              },
              {
                header: t('memory.colProposedMemory'),
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
                header: t('memory.colConfidence'),
                accessorKey: 'confidence',
                cell: (c) => (
                  <span className="text-xs font-mono font-bold text-amber-300">
                    {Math.round((c.confidence || 0) * 100)}%
                  </span>
                ),
              },
              {
                header: t('memory.colEvidenceSnippet'),
                accessorKey: 'evidenceSnippet',
                cell: (c) => (
                  <div className="max-w-md p-2 rounded bg-surface-elevated/40 border border-border/60 text-xs italic text-slate-400 font-sans">
                    &quot;{truncate(c.evidenceSnippet, 80)}&quot;
                  </div>
                ),
              },
              {
                header: t('memory.colStatus'),
                accessorKey: 'status',
                cell: (c) => <StatusPill status={c.status} />,
              },
              {
                header: t('memory.colActions'),
                cell: (c) => (
                  <div className="flex items-center gap-1.5">
                    {canMutate && c.status === 'pending' ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => approveMutation.mutate(c.id)}
                          isLoading={approveMutation.isPending}
                          title={t('memory.btnApprove')}
                        >
                          <Check className="h-3.5 w-3.5 me-1 text-emerald-300" />
                          {t('memory.btnApprove')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setSelectedCandidate(c)}
                          title={t('memory.btnReject')}
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
            emptyMessage={t('memory.noCandidates')}
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
        title={t('memory.rejectModalTitle')}
        description={t('memory.rejectModalDesc')}
        confirmText={t('memory.confirmReject')}
        variant="destructive"
        isLoading={rejectMutation.isPending}
      >
        <div className="space-y-1 mt-2">
          <label className="text-[11px] font-mono text-slate-400">{t('memory.reasonLabel')}</label>
          <Input
            placeholder={t('memory.rejectReasonPlaceholder')}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </div>
      </ConfirmModal>
    </div>
  );
}
