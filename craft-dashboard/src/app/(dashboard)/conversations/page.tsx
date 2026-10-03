'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/error-alert';
import { EmptyState } from '@/components/ui/empty-state';
import { ConversationViewer } from '@/components/conversations/conversation-viewer';
import {
  Search,
  Eye,
  Archive,
  MessageSquare,
  Filter,
  RefreshCw,
  X,
  RotateCcw,
} from 'lucide-react';
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
  const conversations = useMemo(() => {
    const rawConversations = data?.data || [];
    return rawConversations.filter((c) => {
      const isArch = c.status === 'archived' || !!(c as any).isArchived;
      if (statusFilter === 'active') return !isArch;
      if (statusFilter === 'archived') return isArch;
      return true;
    });
  }, [data?.data, statusFilter]);

  const total = data?.pagination?.total ?? conversations.length;

  const isFiltered = Boolean(searchFilter.trim() || channelFilter !== 'all' || statusFilter !== 'all');
  const activeFiltersCount =
    (searchFilter.trim() ? 1 : 0) + (channelFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);

  const handleClearFilters = () => {
    setSearchFilter('');
    setChannelFilter('all');
    setStatusFilter('all');
    setPage(1);
  };

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
      {/* 1. Header & Operations Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-brand-500/10 border border-brand-500/25 text-brand-600 dark:text-brand-400">
              <MessageSquare className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold font-mono tracking-tight text-foreground">
              {t('conversations.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
            {t('conversations.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-8 font-mono text-xs"
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 me-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
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

      {/* 2. Filter Bar */}
      <Card className="p-4 transition-colors shadow-xs">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search input */}
            <div className="flex-1 min-w-[240px] relative">
              <Input
                placeholder={t('conversations.filterPlaceholder')}
                value={searchFilter}
                onChange={(e) => {
                  setSearchFilter(e.target.value);
                  setPage(1);
                }}
                icon={<Search className="h-4 w-4" />}
                className="pe-8"
              />
              {searchFilter && (
                <button
                  onClick={() => {
                    setSearchFilter('');
                    setPage(1);
                  }}
                  className="absolute end-2.5 top-2.5 p-0.5 text-slate-400 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Channel selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1 shrink-0">
                <Filter className="h-3.5 w-3.5" />
                {t('conversations.colChannel')}:
              </span>
              <select
                value={channelFilter}
                onChange={(e) => {
                  setChannelFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 px-3 rounded-md bg-surface-elevated border border-border text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('conversations.filterAllChannels')}</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="flutter">Flutter</option>
                <option value="web">Web</option>
              </select>
            </div>

            {/* Status selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">
                {t('conversations.colStatus')}:
              </span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 px-3 rounded-md bg-surface-elevated border border-border text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('conversations.filterAllStatus')}</option>
                <option value="active">{t('conversations.filterActive')}</option>
                <option value="archived">{t('conversations.filterArchived')}</option>
              </select>
            </div>

            {/* Clear Filters Button */}
            {isFiltered && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="h-9 text-xs font-mono shrink-0 border-dashed text-slate-500 dark:text-slate-400 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3 me-1.5" />
                {t('conversations.clearFilters')}
              </Button>
            )}
          </div>

          {/* Active Filters Pill Strip */}
          {isFiltered && (
            <div className="flex items-center gap-2 pt-2 border-t border-border/50 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <span>{t('conversations.activeFilters', { count: String(activeFiltersCount) })}:</span>
              {searchFilter.trim() && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground">
                  <span>&quot;{truncate(searchFilter.trim(), 16)}&quot;</span>
                  <button onClick={() => setSearchFilter('')} aria-label="Remove search filter">
                    <X className="h-3 w-3 hover:text-rose-400" />
                  </button>
                </span>
              )}
              {channelFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                  <span>{channelFilter}</span>
                  <button onClick={() => setChannelFilter('all')} aria-label="Remove channel filter">
                    <X className="h-3 w-3 hover:text-rose-400" />
                  </button>
                </span>
              )}
              {statusFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                  <span>{statusFilter}</span>
                  <button onClick={() => setStatusFilter('all')} aria-label="Remove status filter">
                    <X className="h-3 w-3 hover:text-rose-400" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* 3. Conversations Table with Visual Hierarchy */}
      {conversations.length === 0 && !isLoading && isFiltered ? (
        <Card className="p-8">
          <EmptyState
            title={t('conversations.noFilteredConversations')}
            description=""
            action={{
              label: t('conversations.clearFilters'),
              onClick: handleClearFilters,
              icon: RotateCcw,
            }}
            className="border-none bg-transparent"
          />
        </Card>
      ) : (
        <DataTable
          columns={[
            {
              header: t('conversations.colChannel'),
              accessorKey: 'channel',
              className: 'w-28',
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
              className: 'min-w-[180px]',
              cell: (c) => {
                const userDisplay = c.userPhone || c.phone || truncate(c.userId, 16);
                const hasCustomName = c.userName && c.userName !== 'User' && c.userName !== userDisplay;
                return (
                  <div className="font-mono flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-[11px] shrink-0">
                      {userDisplay.slice(-2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <span className="font-semibold text-foreground block truncate">
                        {userDisplay}
                      </span>
                      {hasCustomName && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate">
                          {c.userName}
                        </span>
                      )}
                    </div>
                  </div>
                );
              },
            },
            {
              header: t('conversations.colStatus'),
              accessorKey: 'status',
              className: 'w-24',
              cell: (c) => (
                <StatusBadge
                  status={c.status || ((c as any).isArchived ? 'archived' : 'active')}
                  size="xs"
                  showDot={true}
                />
              ),
            },
            {
              header: t('conversations.colMessages'),
              accessorKey: 'messageCount',
              className: 'w-24 text-center',
              cell: (c) => (
                <span className="font-bold text-foreground font-mono">
                  {formatNumber(c.messageCount ?? (c as any).messagesCount ?? 0)}
                </span>
              ),
            },
            {
              header: t('conversations.lastSnippet'),
              accessorKey: 'lastMessageSnippet',
              cell: (c) => (
                <span className="text-slate-500 dark:text-slate-400 text-xs italic block max-w-sm sm:max-w-md truncate">
                  {c.lastMessageSnippet || (c as any).lastMessage || '—'}
                </span>
              ),
            },
            {
              header: t('conversations.updated'),
              accessorKey: 'updatedAt',
              className: 'w-32',
              cell: (c) => (
                <span className="text-slate-500 dark:text-slate-400 text-xs font-mono">
                  {formatRelativeTime(c.updatedAt || (c as any).lastMessageAt || c.createdAt)}
                </span>
              ),
            },
            {
              header: t('conversations.colActions'),
              className: 'w-36 text-end',
              cell: (c) => (
                <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedConv(c)}
                    className="h-7 text-xs font-mono"
                  >
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
                      className="h-7 w-7 p-0"
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
          onRowClick={(c) => setSelectedConv(c)}
          pagination={{
            currentPage: page,
            hasMore: total !== undefined ? page * limit < total : conversations.length === limit,
            onNext: () => setPage((p) => p + 1),
            onPrev: () => setPage((p) => Math.max(1, p - 1)),
            total,
          }}
        />
      )}

      {/* 4. Redesigned Conversation Workspace Viewer */}
      <ConversationViewer
        conversation={selectedConv}
        isOpen={Boolean(selectedConv)}
        onClose={() => setSelectedConv(null)}
        onArchiveToggle={handleArchiveToggle}
      />
    </div>
  );
}
