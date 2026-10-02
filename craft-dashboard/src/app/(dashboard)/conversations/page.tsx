'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Search, Eye, Archive, User, Bot } from 'lucide-react';
import { formatNumber, formatDate, formatRelativeTime, truncate } from '@/lib/utils';
import { AdminConversationItem } from '@/types/admin';

export default function ConversationsPage() {
  const { canMutate } = useAuth();
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
            CONVERSATION INSPECTOR & TRANSCRIPTS
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Real-time chat threads, user turn history, and assistant telemetry
          </p>
        </div>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title="Failed to load conversations"
          onRetry={() => refetch()}
        />
      )}
      {archiveMutation.error && (
        <ErrorAlert error={archiveMutation.error} title="Failed to archive conversation" />
      )}

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="max-w-md">
          <Input
            placeholder="Filter by User ID or phone..."
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
            header: 'Conversation ID',
            accessorKey: 'id',
            cell: (c) => <span className="font-semibold text-slate-200">{truncate(c.id, 16)}</span>,
          },
          {
            header: 'User / Contact',
            accessorKey: 'userPhone',
            cell: (c) => <span className="text-slate-100">{c.userPhone || truncate(c.userId, 16)}</span>,
          },
          {
            header: 'Channel',
            accessorKey: 'channel',
            cell: (c) => <span className="uppercase text-slate-400 text-xs">{c.channel || 'whatsapp'}</span>,
          },
          {
            header: 'Status',
            accessorKey: 'status',
            cell: (c) => <StatusPill status={c.status} />,
          },
          {
            header: 'Messages',
            accessorKey: 'messageCount',
            cell: (c) => formatNumber(c.messageCount),
          },
          {
            header: 'Last Snippet',
            accessorKey: 'lastMessageSnippet',
            cell: (c) => <span className="text-slate-400 text-xs italic">{truncate(c.lastMessageSnippet, 40)}</span>,
          },
          {
            header: 'Updated',
            accessorKey: 'updatedAt',
            cell: (c) => formatRelativeTime(c.updatedAt),
          },
          {
            header: 'Actions',
            cell: (c) => (
              <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" onClick={() => setSelectedConv(c)}>
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  Transcript
                </Button>
                {canMutate && c.status !== 'archived' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => archiveMutation.mutate(c.id)}
                    isLoading={archiveMutation.isPending}
                    title="Archive Conversation"
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
        emptyMessage="No conversations recorded"
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
        title={`TRANSCRIPT: ${selectedConv?.id}`}
        subtitle={`User: ${selectedConv?.userPhone || selectedConv?.userId || ''} • Channel: ${selectedConv?.channel || 'whatsapp'}`}
        width="2xl"
      >
        {messagesQuery.isLoading ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">Loading conversation transcript...</div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">No messages in this conversation thread</div>
        ) : (
          <div className="space-y-4 font-mono text-xs">
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
                >
                  <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 px-1">
                    {isUser ? (
                      <>
                        <span>{formatDate(msg.createdAt)}</span>
                        <span className="font-semibold text-slate-300 flex items-center gap-1">
                          User <User className="h-3 w-3" />
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-brand-300 flex items-center gap-1">
                          <Bot className="h-3 w-3" /> Assistant
                        </span>
                        {msg.model && <span className="text-[10px] text-slate-400">({msg.model})</span>}
                        <span>• {formatDate(msg.createdAt)}</span>
                      </>
                    )}
                  </div>

                  <div
                    className={`max-w-xl p-3.5 rounded-lg border leading-relaxed text-xs ${
                      isUser
                        ? 'bg-brand-950/40 border-brand-800/60 text-slate-100 rounded-tr-none'
                        : 'bg-surface-elevated border-border text-slate-200 rounded-tl-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.tokens !== undefined && (
                      <div className="mt-2 pt-2 border-t border-border/40 text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Tokens: {msg.tokens}</span>
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
