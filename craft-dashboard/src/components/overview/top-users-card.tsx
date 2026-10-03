'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/language-context';
import { Users, ArrowRight, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';

export interface TopUserItemData {
  userId: string;
  phone?: string;
  messageCount: number;
  lastActive: string;
}

export interface TopUsersCardProps {
  data?: TopUserItemData[];
  isLoading?: boolean;
}

export function TopUsersCard({ data = [], isLoading }: TopUsersCardProps) {
  const { t, formatNumber, formatRelativeTime } = useLanguage();
  const router = useRouter();

  return (
    <Card className="transition-colors shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-semibold font-mono text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            {t('overview.topUsersTitle')}
          </CardTitle>
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            {t('overview.topUsersSubtitle')}
          </p>
        </div>

        <Link
          href="/users"
          className="flex items-center gap-1 text-xs font-mono text-brand-600 dark:text-brand-400 hover:text-brand-500 transition-colors"
        >
          <span>{t('overview.viewAllUsers')}</span>
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        <DataTable
          columns={[
            {
              header: t('overview.userIdentifierCol'),
              cell: (r: TopUserItemData) => (
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-foreground truncate text-xs">
                    {r.userId}
                  </span>
                  {r.phone && (
                    <span className="text-[10px] font-mono text-slate-500 truncate">
                      {r.phone}
                    </span>
                  )}
                </div>
              ),
            },
            {
              header: t('overview.totalMessagesCol'),
              accessorKey: 'messageCount',
              cell: (r: TopUserItemData) => formatNumber(r.messageCount),
            },
            {
              header: t('overview.lastActiveCol'),
              accessorKey: 'lastActive',
              cell: (r: TopUserItemData) => (
                <span className="text-xs text-slate-500">
                  {formatRelativeTime(r.lastActive)}
                </span>
              ),
            },
            {
              header: t('common.actions'),
              cell: () => (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push('/users');
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border border-border bg-surface-elevated/40 text-slate-600 dark:text-slate-300 hover:text-foreground hover:bg-surface-elevated transition-colors"
                >
                  <span>{t('overview.view360')}</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              ),
            },
          ]}
          data={data}
          isLoading={isLoading}
          emptyMessage={t('overview.noActiveUsers')}
          onRowClick={() => router.push('/users')}
          className="border-none rounded-none shadow-none"
        />
      </CardContent>
    </Card>
  );
}
