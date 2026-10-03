'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import { EmptyState } from '@/components/ui/empty-state';
import { User360Workspace } from '@/components/users/user-360-workspace';
import {
  Search,
  Star,
  Ban,
  CheckCircle,
  Eye,
  RefreshCw,
  X,
  RotateCcw,
  Users,
} from 'lucide-react';
import { cn, truncate } from '@/lib/utils';
import { AdminUserListItem } from '@/types/admin';

function UsersDirectoryContent() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const initialUserId = searchParams.get('userId') || null;

  const { canMutate, canBanUsers } = useAuth();
  const { t, formatNumber, formatRelativeTime } = useLanguage();
  const queryClient = useQueryClient();

  // Search & Filter state
  const [search, setSearch] = useState(initialSearch);
  const [filterVip, setFilterVip] = useState<string>('all');
  const [filterBanned, setFilterBanned] = useState<string>('all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Selected User for 360 Workspace
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialUserId);

  // Ban confirmation modal
  const [banModalUser, setBanModalUser] = useState<AdminUserListItem | null>(null);
  const [banReason, setBanReason] = useState('');

  const queryParams = {
    search: search.trim() || undefined,
    isVip: filterVip === 'all' ? undefined : filterVip === 'vip',
    isBanned: filterBanned === 'all' ? undefined : filterBanned === 'banned',
    limit,
    offset: (page - 1) * limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-users', queryParams],
    queryFn: () => adminApi.getUsers(queryParams),
  });

  const rawUsers = useMemo(() => data?.data || [], [data?.data]);

  // Client-side channel filtering if channel filter is set
  const users = useMemo(() => {
    if (filterChannel === 'all') return rawUsers;
    return rawUsers.filter((u: any) => {
      const ch = (u.channel || 'whatsapp').toLowerCase();
      return ch === filterChannel.toLowerCase();
    });
  }, [rawUsers, filterChannel]);

  const total = data?.pagination?.total ?? users.length;

  const isFiltered = Boolean(
    search.trim() || filterVip !== 'all' || filterBanned !== 'all' || filterChannel !== 'all'
  );

  const activeFiltersCount =
    (search.trim() ? 1 : 0) +
    (filterVip !== 'all' ? 1 : 0) +
    (filterBanned !== 'all' ? 1 : 0) +
    (filterChannel !== 'all' ? 1 : 0);

  const handleClearFilters = () => {
    setSearch('');
    setFilterVip('all');
    setFilterBanned('all');
    setFilterChannel('all');
    setPage(1);
  };

  // KPI computations from loaded records
  const { activeCount, vipCount, bannedCount } = useMemo(() => {
    let act = 0;
    let vip = 0;
    let ban = 0;
    rawUsers.forEach((u) => {
      if (u.isBanned) ban++;
      else act++;
      if (u.isVip) vip++;
    });
    return { activeCount: act, vipCount: vip, bannedCount: ban };
  }, [rawUsers]);

  // Mutations
  const toggleVipMutation = useMutation({
    mutationFn: ({ id, isVip }: { id: string; isVip: boolean }) => adminApi.toggleUserVip(id, isVip),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      if (selectedUserId) queryClient.invalidateQueries({ queryKey: ['admin-user-details', selectedUserId] });
    },
  });

  const banMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminApi.banUser(id, reason),
    onSuccess: () => {
      setBanModalUser(null);
      setBanReason('');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      if (selectedUserId) queryClient.invalidateQueries({ queryKey: ['admin-user-details', selectedUserId] });
    },
  });

  const unbanMutation = useMutation({
    mutationFn: (id: string) => adminApi.unbanUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      if (selectedUserId) queryClient.invalidateQueries({ queryKey: ['admin-user-details', selectedUserId] });
    },
  });

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Header & Operational Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-brand-500/10 border border-brand-500/25 text-brand-600 dark:text-brand-400">
              <Users className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {t('users.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('users.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <div className="hidden md:flex items-center gap-2 text-[11px] font-mono me-2">
            <span className="px-2.5 py-1 rounded-md bg-surface border border-border text-slate-400">
              {t('users.totalUsers')}: <strong className="text-foreground">{formatNumber(total)}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 dark:text-emerald-400">
              {t('users.activeUsers')}: <strong>{formatNumber(activeCount)}</strong>
            </span>
            {vipCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-500">
                VIP: <strong>{formatNumber(vipCount)}</strong>
              </span>
            )}
            {bannedCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-rose-500/10 border border-rose-500/25 text-rose-500">
                Banned: <strong>{formatNumber(bannedCount)}</strong>
              </span>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-8 text-xs font-mono"
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
          title={t('users.failedToLoad')}
          onRetry={() => refetch()}
        />
      )}
      {toggleVipMutation.error && (
        <ErrorAlert error={toggleVipMutation.error} title={t('users.failedToToggleVip')} />
      )}
      {banMutation.error && (
        <ErrorAlert error={banMutation.error} title={t('users.failedToBan')} />
      )}
      {unbanMutation.error && (
        <ErrorAlert error={unbanMutation.error} title={t('users.failedToUnban')} />
      )}

      {/* 2. Filter Bar */}
      <Card className="p-4 transition-colors shadow-xs">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search input */}
            <div className="sm:col-span-2 relative">
              <Input
                placeholder={t('users.searchPlaceholder')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                icon={<Search className="h-4 w-4" />}
                className="pe-8"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                  }}
                  className="absolute end-2.5 top-2.5 p-0.5 text-slate-400 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* VIP selector */}
            <div>
              <select
                value={filterVip}
                onChange={(e) => {
                  setFilterVip(e.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('users.allVip')}</option>
                <option value="vip">{t('users.vipOnly')}</option>
                <option value="standard">{t('users.standardUsers')}</option>
              </select>
            </div>

            {/* Status selector */}
            <div>
              <select
                value={filterBanned}
                onChange={(e) => {
                  setFilterBanned(e.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('users.allStatus')}</option>
                <option value="active">{t('users.activeOnly')}</option>
                <option value="banned">{t('users.bannedOnly')}</option>
              </select>
            </div>

            {/* Channel selector */}
            <div className="flex items-center gap-2">
              <select
                value={filterChannel}
                onChange={(e) => {
                  setFilterChannel(e.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">{t('users.filterAllChannels')}</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="flutter">Flutter</option>
                <option value="web">Web</option>
              </select>
            </div>
          </div>

          {/* Active Filters Pill Strip */}
          {isFiltered && (
            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[11px] font-mono text-slate-500 dark:text-slate-400 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span>{t('users.activeFilters', { count: String(activeFiltersCount) })}:</span>
                {search.trim() && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground">
                    <span>&quot;{truncate(search.trim(), 16)}&quot;</span>
                    <button onClick={() => setSearch('')} aria-label="Remove search filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}
                {filterVip !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                    <span>{filterVip}</span>
                    <button onClick={() => setFilterVip('all')} aria-label="Remove VIP filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}
                {filterBanned !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                    <span>{filterBanned}</span>
                    <button onClick={() => setFilterBanned('all')} aria-label="Remove status filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}
                {filterChannel !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-foreground uppercase">
                    <span>{filterChannel}</span>
                    <button onClick={() => setFilterChannel('all')} aria-label="Remove channel filter">
                      <X className="h-3 w-3 hover:text-rose-400" />
                    </button>
                  </span>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="h-7 text-xs font-mono border-dashed text-slate-500 dark:text-slate-400 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3 me-1.5" />
                {t('users.clearFilters')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* 3. Users Table with Visual Priority */}
      {users.length === 0 && !isLoading && isFiltered ? (
        <Card className="p-8">
          <EmptyState
            title={t('users.noFilteredUsers')}
            description=""
            action={{
              label: t('users.clearFilters'),
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
              header: t('users.colUser'),
              accessorKey: 'phoneNumber',
              className: 'min-w-[200px]',
              cell: (u) => {
                const phoneDisplay = u.phoneNumber || (u as any).phone || u.id;
                return (
                  <div className="font-mono flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-xs shrink-0">
                      {phoneDisplay ? phoneDisplay.slice(-2).toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground truncate" dir="ltr">
                          {phoneDisplay}
                        </span>
                        {u.isVip && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-500"
                            title={t('common.vip')}
                          >
                            <Star className="h-2.5 w-2.5 fill-amber-500" />
                            {t('common.vip')}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block truncate" dir="ltr">
                        {truncate(u.id, 14)}
                      </span>
                    </div>
                  </div>
                );
              },
            },
            {
              header: t('users.colStatus'),
              accessorKey: 'isBanned',
              className: 'w-24',
              cell: (u) => (
                <StatusBadge status={u.isBanned ? 'banned' : 'active'} size="xs" showDot={true} />
              ),
            },
            {
              header: t('users.colLastActive'),
              accessorKey: 'lastActiveAt',
              className: 'w-28',
              cell: (u) => (
                <span className="text-slate-500 dark:text-slate-400 text-xs">
                  {formatRelativeTime(u.lastActiveAt || (u as any).lastActive || u.createdAt)}
                </span>
              ),
            },
            {
              header: t('navigation.conversations'),
              accessorKey: 'conversationCount',
              className: 'w-28 text-center',
              cell: (u) => (
                <span className="font-bold text-foreground">
                  {formatNumber(u.conversationCount ?? 0)}
                </span>
              ),
            },
            {
              header: t('overview.messages'),
              accessorKey: 'messageCount',
              className: 'w-24 text-center',
              cell: (u) => (
                <span className="font-bold text-foreground">
                  {formatNumber(u.messageCount ?? (u as any).totalMessages ?? 0)}
                </span>
              ),
            },
            {
              header: t('navigation.reminders'),
              accessorKey: 'reminderCount',
              className: 'w-24 text-center',
              cell: (u) => (
                <span className="font-bold text-slate-400">
                  {formatNumber(u.reminderCount ?? 0)}
                </span>
              ),
            },
            {
              header: t('users.colActions'),
              className: 'w-36 text-end',
              cell: (u) => (
                <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedUserId(u.id)}
                    className="h-7 text-xs font-mono"
                    title={t('users.btnView360')}
                  >
                    <Eye className="h-3 w-3 me-1" />
                    <span>360°</span>
                  </Button>

                  {canMutate && (
                    <Button
                      variant={u.isVip ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => toggleVipMutation.mutate({ id: u.id, isVip: !u.isVip })}
                      isLoading={toggleVipMutation.isPending}
                      className="h-7 w-7 p-0"
                      title={u.isVip ? t('users.btnUnvip') : t('users.btnVip')}
                    >
                      <Star
                        className={cn(
                          'h-3.5 w-3.5',
                          u.isVip ? 'text-amber-500 fill-amber-500' : 'text-slate-400'
                        )}
                      />
                    </Button>
                  )}

                  {canBanUsers && (
                    u.isBanned ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => unbanMutation.mutate(u.id)}
                        isLoading={unbanMutation.isPending}
                        className="h-7 w-7 p-0 text-emerald-400 border-emerald-500/30 hover:border-emerald-500"
                        title={t('users.btnUnban')}
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setBanModalUser(u)}
                        className="h-7 w-7 p-0"
                        title={t('users.btnBan')}
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )
                  )}
                </div>
              ),
            },
          ]}
          data={users}
          isLoading={isLoading}
          emptyMessage={t('common.noData')}
          onRowClick={(u) => setSelectedUserId(u.id)}
          pagination={{
            currentPage: page,
            hasMore: total !== undefined ? page * limit < total : users.length === limit,
            onNext: () => setPage((p) => p + 1),
            onPrev: () => setPage((p) => Math.max(1, p - 1)),
            total,
          }}
        />
      )}

      {/* 4. User 360 Workspace Drawer */}
      <User360Workspace
        userId={selectedUserId}
        isOpen={Boolean(selectedUserId)}
        onClose={() => setSelectedUserId(null)}
        onUserMutated={() => refetch()}
      />

      {/* 5. Ban User Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(banModalUser)}
        onClose={() => setBanModalUser(null)}
        onConfirm={() => banMutation.mutate({ id: banModalUser!.id, reason: banReason })}
        title={`${t('users.banModalTitle')}: ${banModalUser?.phoneNumber || banModalUser?.id || ''}`}
        description={t('users.banModalDesc')}
        confirmText={t('users.confirmBan')}
        variant="destructive"
        isLoading={banMutation.isPending}
      >
        <div className="space-y-1 mt-2">
          <label className="text-[11px] font-mono text-slate-400">{t('users.optionalEnforcementReason')}</label>
          <Input
            placeholder={t('users.banReasonPlaceholder')}
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
          />
        </div>
      </ConfirmModal>
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-mono text-slate-400">Loading...</div>}>
      <UsersDirectoryContent />
    </Suspense>
  );
}
