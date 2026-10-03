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
import { ErrorAlert } from '@/components/ui/error-alert';
import { ConversationViewer } from '@/components/conversations/conversation-viewer';
import { Search, Eye, Archive, MessageSquare, Filter, RefreshCw } from 'lucide-react';
import { truncate } from '@/lib/utils';
import { AdminConversationItem } from '@/types/admin';

export default function ConversationsPage() {
  const { canMutate } = useAuth();
  const { t, formatNumber, formatRelativeTime } = useLanguage();
  const queryClient = useQueryClient();

  const [searchFilter, setSearchFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [selectedConv, setSelectedConv] = useState<AdminConversationItem | null>(null);

  const queryParams = {
    search: searchFilter.trim() || undefined,
    channel: channelFilter !== 'all' ? channelFilter : undefined,
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-conversations', queryParams, statusFilter],
    queryFn: () => adminApi.getConversations(queryParams),
  });

  // Client-side status filter if specified
  const rawConversations = data?.data || [];
  const conversations = rawConversations.filter((c) => {
    if (statusFilter === 'active') return c.status !== 'archived' && !(c as any).isArchived;
    if (statusFilter === 'archived') return c.status === 'archived' || !!(c as any).isArchived;
    return true;
  });

  const total = data?.pagination?.total ?? conversations.length;

  const archiveMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => adminApi.archiveConversation(id),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
      if (selectedConv && selectedConv.id === vars.id) {
        setSelectedConv((prev) => (prev ? { ...prev, status: 'archived', isArchived: true } : null));
      }
    },
  });

  const handleArchiveToggle = (id: string) => {
    archiveMutation.mutate({ id });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-emerald-400" />
            {t('conversations.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('conversations.subtitle')}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
          className="self-start sm:self-auto h-8 font-mono text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 me-1.5 ${isLoading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title={t('conversations.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}
      {archiveMutation.error && (
        <ErrorAlert error={archiveMutation.error} title={t('conversations.failedToArchive')} />
      )}

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search input */}
          <div className="flex-1 min-w-[240px]">
            <Input
              placeholder={t('conversations.filterPlaceholder')}
              value={searchFilter}
              onChange={(e) => {
                setSearchFilter(e.target.value);
                setPage(1);
              }}
              icon={<Search className="h-4 w-4" />}
            />
          </div>

          {/* Channel selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" />
              {t('conversations.colChannel')}:
            </span>
            <select
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 px-3 rounded-md bg-surface-elevated border border-border text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">{t('conversations.filterAllChannels')}</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="flutter">Flutter</option>
              <option value="web">Web</option>
            </select>
          </div>

          {/* Status selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">
              {t('conversations.colStatus')}:
            </span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 px-3 rounded-md bg-surface-elevated border border-border text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">{t('conversations.filterAllStatus')}</option>
              <option value="active">{t('conversations.filterActive')}</option>
              <option value="archived">{t('conversations.filterArchived')}</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Conversations Table */}
      <DataTable
        columns={[
          {
            header: t('conversations.colChannel'),
            accessorKey: 'channel',
            cell: (c) => (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold font-mono uppercase tracking-wider bg-emerald-950/60 border border-emerald-800 text-emerald-300">
                <MessageSquare className="h-3 w-3 text-emerald-400" />
                {c.channel || 'whatsapp'}
              </span>
            ),
          },
          {
            header: t('conversations.colUser'),
            accessorKey: 'userPhone',
            cell: (c) => (
              <div className="font-mono">
                <span className="font-semibold text-slate-100 block">
                  {c.userPhone || c.phone || truncate(c.userId, 16)}
                </span>
                {c.userName && c.userName !== 'User' && (
                  <span className="text-[11px] text-slate-400">{c.userName}</span>
                )}
              </div>
            ),
          },
          {
            header: t('conversations.colStatus'),
            accessorKey: 'status',
            cell: (c) => <StatusPill status={c.status || ((c as any).isArchived ? 'archived' : 'active')} />,
          },
          {
            header: t('conversations.colMessages'),
            accessorKey: 'messageCount',
            cell: (c) => (
              <span className="font-bold text-slate-200 font-mono">
                {formatNumber(c.messageCount ?? (c as any).messagesCount ?? 0)}
              </span>
            ),
          },
          {
            header: t('conversations.lastSnippet'),
            accessorKey: 'lastMessageSnippet',
            cell: (c) => (
              <span className="text-slate-400 text-xs italic block max-w-xs truncate">
                {c.lastMessageSnippet || (c as any).lastMessage || '—'}
              </span>
            ),
          },
          {
            header: t('conversations.updated'),
            accessorKey: 'updatedAt',
            cell: (c) => (
              <span className="text-slate-400 text-xs font-mono">
                {formatRelativeTime(c.updatedAt || (c as any).lastMessageAt || c.createdAt)}
              </span>
            ),
          },
          {
            header: t('conversations.colActions'),
            cell: (c) => (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" onClick={() => setSelectedConv(c)}>
                  <Eye className="h-3.5 w-3.5 me-1" />
                  {t('conversations.btnTranscript')}
                </Button>
                {canMutate && c.status !== 'archived' && !(c as any).isArchived && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleArchiveToggle(c.id)}
                    isLoading={archiveMutation.isPending}
                    title={t('conversations.archiveTitle')}
                  >
                    <Archive className="h-3.5 w-3.5 text-slate-400 hover:text-amber-400" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
        data={conversations}
        isLoading={isLoading}
        emptyMessage={t('conversations.noMessages')}
        pagination={{
          currentPage: page,
          hasMore: total !== undefined ? page * limit < total : conversations.length === limit,
          onNext: () => setPage((p) => p + 1),
          onPrev: () => setPage((p) => Math.max(1, p - 1)),
          total,
        }}
      />

      {/* Redesigned Conversation Viewer */}
      <ConversationViewer
        conversation={selectedConv}
        isOpen={Boolean(selectedConv)}
        onClose={() => setSelectedConv(null)}
        onArchiveToggle={handleArchiveToggle}
      />
    </div>
  );
}
