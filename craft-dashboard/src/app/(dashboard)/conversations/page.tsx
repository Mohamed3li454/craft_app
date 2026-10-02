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
import { Drawer } from '@/components/ui/drawer';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Search, Eye, Archive, User, Bot } from 'lucide-react';
import { truncate } from '@/lib/utils';
import { AdminConversationItem } from '@/types/admin';

export default function ConversationsPage() {
  const { canMutate } = useAuth();
  const { t, formatNumber, formatDate, formatRelativeTime } = useLanguage();
  const queryClient = useQueryClient();

  const [userIdFilter, setUserIdFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [selectedConv, setSelectedConv] = useState<AdminConversationItem | null>(null);

  const queryParams = {
    userId: userIdFilter.trim() || undefined,
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-conversations', queryParams],
    queryFn: () => adminApi.getConversations(queryParams),
  });

  const conversations = data?.data || [];
  const total = data?.pagination?.total;

  // Messages Query for selected conversation
  const messagesQuery = useQuery({
    queryKey: ['admin-messages', selectedConv?.id],
    queryFn: () => adminApi.getConversationMessages(selectedConv!.id),
    enabled: Boolean(selectedConv),
  });

  const messages = messagesQuery.data?.data || [];

  const archiveMutation = useMutation({
    mutationFn: (id: string) => adminApi.archiveConversation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
      if (selectedConv) {
        setSelectedConv((prev) => (prev ? { ...prev, status: 'archived' } : null));
      }
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('conversations.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('conversations.subtitle')}
          </p>
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

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="max-w-md">
          <Input
            placeholder={t('conversations.filterPlaceholder')}
            value={userIdFilter}
            onChange={(e) => {
              setUserIdFilter(e.target.value);
              setPage(1);
            }}
            icon={<Search className="h-4 w-4" />}
          />
        </div>
      </Card>

      {/* Conversations Table */}
      <DataTable
        columns={[
          {
            header: t('conversations.colConvId'),
            accessorKey: 'id',
            cell: (c) => <span className="font-semibold text-slate-200">{truncate(c.id, 16)}</span>,
          },
          {
            header: t('conversations.colUser'),
            accessorKey: 'userPhone',
            cell: (c) => <span className="text-slate-100">{c.userPhone || truncate(c.userId, 16)}</span>,
          },
          {
            header: t('conversations.colChannel'),
            accessorKey: 'channel',
            cell: (c) => <span className="uppercase text-slate-400 text-xs">{c.channel || 'whatsapp'}</span>,
          },
          {
            header: t('conversations.colStatus'),
            accessorKey: 'status',
            cell: (c) => <StatusPill status={c.status || ((c as any).isArchived ? 'archived' : 'active')} />,
          },
          {
            header: t('conversations.colMessages'),
            accessorKey: 'messageCount',
            cell: (c) => formatNumber(c.messageCount ?? (c as any).messagesCount ?? 0),
          },
          {
            header: t('conversations.lastSnippet'),
            accessorKey: 'lastMessageSnippet',
            cell: (c) => <span className="text-slate-400 text-xs italic">{truncate(c.lastMessageSnippet || (c as any).lastMessage, 40)}</span>,
          },
          {
            header: t('conversations.updated'),
            accessorKey: 'updatedAt',
            cell: (c) => formatRelativeTime(c.updatedAt || (c as any).lastMessageAt || c.createdAt),
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
                    onClick={() => archiveMutation.mutate(c.id)}
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

      {/* Transcript Drawer */}
      <Drawer
        isOpen={Boolean(selectedConv)}
        onClose={() => setSelectedConv(null)}
        title={`${t('conversations.drawerTitle')}: ${selectedConv?.id}`}
        subtitle={`${t('conversations.colUser')}: ${selectedConv?.userPhone || selectedConv?.userId || ''} • ${t('conversations.colChannel')}: ${selectedConv?.channel || 'whatsapp'}`}
        width="2xl"
      >
        {messagesQuery.isLoading ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">{t('conversations.loadingTranscript')}</div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">{t('conversations.noMessages')}</div>
        ) : (
          <div className="space-y-4 font-mono text-xs">
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 px-1">
                    {isUser ? (
                      <>
                        <span>{formatDate(msg.createdAt || (msg as any).timestamp)}</span>
                        <span className="font-semibold text-slate-300 flex items-center gap-1">
                          {t('conversations.user')} <User className="h-3 w-3" />
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-brand-300 flex items-center gap-1">
                          <Bot className="h-3 w-3" /> {t('conversations.assistant')}
                        </span>
                        {msg.model && <span className="text-[10px] text-slate-400">({msg.model})</span>}
                        <span>• {formatDate(msg.createdAt || (msg as any).timestamp)}</span>
                      </>
                    )}
                  </div>

                  <div
                    className={`max-w-xl p-3.5 rounded-lg border leading-relaxed text-xs ${
                      isUser
                        ? 'bg-brand-950/40 border-brand-800/60 text-slate-100 rounded-te-none'
                        : 'bg-surface-elevated border-border text-slate-200 rounded-ts-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content || (msg as any).text}</p>
                    {msg.tokens !== undefined && (
                      <div className="mt-2 pt-2 border-t border-border/40 text-[10px] text-slate-400 flex items-center justify-between">
                        <span>{t('conversations.tokens', { tokens: String(msg.tokens) })}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Drawer>
    </div>
  );
}
