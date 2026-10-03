'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErrorState } from '@/components/ui/error-state';
import { AdminConversationItem } from '@/types/admin';

export function RecentConversations() {
  const { t, formatNumber, formatRelativeTime } = useLanguage();
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-recent-conversations-overview'],
    queryFn: () => adminApi.getConversations({ limit: 5 }),
    staleTime: 30000,
  });

  const conversations = data?.data || [];

  return (
    <Card className="transition-colors shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-semibold font-mono text-foreground flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-brand-500" aria-hidden="true" />
            {t('overview.recentConversations')}
          </CardTitle>
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            {t('overview.recentConversationsSubtitle')}
          </p>
        </div>

        <Link
          href="/conversations"
          className="flex items-center gap-1 text-xs font-mono text-brand-600 dark:text-brand-400 hover:text-brand-500 transition-colors"
        >
          <span>{t('overview.viewAllConversations')}</span>
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {error ? (
          <div className="p-4">
            <ErrorState
              title={t('common.operationFailed')}
              error={error}
              onRetry={() => refetch()}
            />
          </div>
        ) : (
          <DataTable
            columns={[
              {
                header: t('common.user'),
                cell: (r: AdminConversationItem) => (
                  <div className="flex flex-col min-w-0 max-w-[130px] sm:max-w-[160px]">
                    <span className="font-semibold text-foreground truncate text-xs">
                      {r.userName || r.userPhone || r.userId}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 truncate">
                      {r.userId}
                    </span>
                  </div>
                ),
              },
              {
                header: t('overview.channelCol'),
                cell: (r: AdminConversationItem) => (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-elevated text-slate-600 dark:text-slate-300 border border-border uppercase">
                    {r.channel || 'whatsapp'}
                  </span>
                ),
              },
              {
                header: t('overview.lastMessageCol'),
                cell: (r: AdminConversationItem) => (
                  <p className="text-xs text-slate-600 dark:text-slate-300 truncate max-w-[200px] sm:max-w-[280px]">
                    {r.lastMessageSnippet || r.lastMessage || '—'}
                  </p>
                ),
              },
              {
                header: t('overview.messagesCol'),
                cell: (r: AdminConversationItem) => formatNumber(r.messageCount ?? r.messagesCount ?? 0),
              },
              {
                header: t('common.status'),
                cell: (r: AdminConversationItem) => (
                  <StatusBadge
                    status={r.status || 'active'}
                    size="xs"
                    showDot={true}
                  />
                ),
              },
              {
                header: t('overview.lastActiveCol'),
                cell: (r: AdminConversationItem) => (
                  <span className="text-xs text-slate-500">
                    {formatRelativeTime(r.updatedAt || r.lastMessageAt || r.createdAt)}
                  </span>
                ),
              },
            ]}
            data={conversations}
            isLoading={isLoading}
            emptyMessage={t('overview.noRecentConversations')}
            onRowClick={() => router.push('/conversations')}
            className="border-none rounded-none shadow-none"
          />
        )}
      </CardContent>
    </Card>
  );
}
