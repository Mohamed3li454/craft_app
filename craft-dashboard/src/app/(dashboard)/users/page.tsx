'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Tabs } from '@/components/ui/tabs';
import {
  Search,
  Star,
  Ban,
  CheckCircle,
  Eye,
  Trash2,
  Clock,
  Brain,
  User,
  MessageSquare,
  Cpu,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { AdminUserListItem } from '@/types/admin';

export default function UsersPage() {
  const { canMutate, canPurgeData } = useAuth();
  const { t, formatNumber, formatCurrency, formatDate, formatRelativeTime } = useLanguage();
  const queryClient = useQueryClient();

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [filterVip, setFilterVip] = useState<string>('all');
  const [filterBanned, setFilterBanned] = useState<string>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Selected User for 360 Drawer
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<'overview' | 'conversations' | 'memory' | 'reminders' | 'agent-runs'>('overview');

  // Modal states
  const [banModalUser, setBanModalUser] = useState<AdminUserListItem | null>(null);
  const [banReason, setBanReason] = useState('');
  const [purgeModalUserId, setPurgeModalUserId] = useState<string | null>(null);

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

  const users = data?.data || [];
  const total = data?.pagination?.total;

  // User 360 Details Query
  const detailsQuery = useQuery({
    queryKey: ['admin-user-details', selectedUserId],
    queryFn: () => adminApi.getUserDetails(selectedUserId!),
    enabled: Boolean(selectedUserId),
  });

  const userDetails = detailsQuery.data?.data;

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

  const purgeMemoryMutation = useMutation({
    mutationFn: (userId: string) => adminApi.purgeUserMemories(userId),
    onSuccess: () => {
      setPurgeModalUserId(null);
      if (selectedUserId) queryClient.invalidateQueries({ queryKey: ['admin-user-details', selectedUserId] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('users.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('users.subtitle')}
          </p>
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

      {/* Filters Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <Input
              placeholder={t('users.searchPlaceholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              icon={<Search className="h-4 w-4" />}
            />
          </div>
          <div>
            <select
              value={filterVip}
              onChange={(e) => {
                setFilterVip(e.target.value);
                setPage(1);
              }}
              className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-slate-200 focus:outline-none"
            >
              <option value="all">{t('users.allVip')}</option>
              <option value="vip">{t('users.vipOnly')}</option>
              <option value="standard">{t('users.standardUsers')}</option>
            </select>
          </div>
          <div>
            <select
              value={filterBanned}
              onChange={(e) => {
                setFilterBanned(e.target.value);
                setPage(1);
              }}
              className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-slate-200 focus:outline-none"
            >
              <option value="all">{t('users.allStatus')}</option>
              <option value="active">{t('users.activeOnly')}</option>
              <option value="banned">{t('users.bannedOnly')}</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Users Table */}
      <DataTable
        columns={[
          {
            header: t('users.colUser'),
            accessorKey: 'phoneNumber',
            cell: (u) => (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-100">{u.phoneNumber || (u as any).phone || u.id}</span>
                {u.isVip && (
                  <Badge variant="warning" className="text-[10px] py-0 px-1">
                    <Star className="h-2.5 w-2.5 me-0.5 fill-amber-400" />
                    {t('common.vip')}
                  </Badge>
                )}
              </div>
            ),
          },
          {
            header: t('users.colStatus'),
            accessorKey: 'isBanned',
            cell: (u) => (
              <StatusPill status={u.isBanned ? 'banned' : 'active'} />
            ),
          },
          {
            header: t('overview.messages'),
            accessorKey: 'messageCount',
            cell: (u) => formatNumber(u.messageCount ?? (u as any).totalMessages ?? 0),
          },
          {
            header: t('navigation.conversations'),
            accessorKey: 'conversationCount',
            cell: (u) => formatNumber(u.conversationCount ?? 0),
          },
          {
            header: t('navigation.reminders'),
            accessorKey: 'reminderCount',
            cell: (u) => formatNumber(u.reminderCount ?? 0),
          },
          {
            header: t('users.colLastActive'),
            accessorKey: 'lastActiveAt',
            cell: (u) => formatRelativeTime(u.lastActiveAt || (u as any).lastActive),
          },
          {
            header: t('users.colActions'),
            cell: (u) => (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedUserId(u.id)}
                  title={t('users.btnView360')}
                >
                  <Eye className="h-3.5 w-3.5 me-1" />
                  360°
                </Button>

                {canMutate && (
                  <>
                    <Button
                      variant={u.isVip ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => toggleVipMutation.mutate({ id: u.id, isVip: !u.isVip })}
                      isLoading={toggleVipMutation.isPending}
                      title={u.isVip ? t('users.btnUnvip') : t('users.btnVip')}
                    >
                      <Star className={`h-3.5 w-3.5 ${u.isVip ? 'text-amber-400 fill-amber-400' : 'text-slate-400'}`} />
                    </Button>

                    {u.isBanned ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => unbanMutation.mutate(u.id)}
                        isLoading={unbanMutation.isPending}
                        title={t('users.btnUnban')}
                      >
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setBanModalUser(u)}
                        title={t('users.btnBan')}
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            ),
          },
        ]}
        data={users}
        isLoading={isLoading}
        emptyMessage={t('common.noData')}
        pagination={{
          currentPage: page,
          hasMore: total !== undefined ? page * limit < total : users.length === limit,
          onNext: () => setPage((p) => p + 1),
          onPrev: () => setPage((p) => Math.max(1, p - 1)),
          total,
        }}
      />

      {/* User 360 Drawer */}
      <Drawer
        isOpen={Boolean(selectedUserId)}
        onClose={() => setSelectedUserId(null)}
        title={`${t('users.drawerTitle')}: ${userDetails?.user?.phoneNumber || selectedUserId || ''}`}
        subtitle={t('users.systemId', { id: selectedUserId || '' })}
        width="xl"
      >
        {detailsQuery.isLoading ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">{t('users.loadingTelemetry')}</div>
        ) : detailsQuery.error ? (
          <div className="p-4">
            <ErrorAlert
              error={detailsQuery.error}
              title={t('users.failedToLoad')}
              onRetry={() => detailsQuery.refetch()}
            />
          </div>
        ) : !userDetails ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">{t('users.userNotFound')}</div>
        ) : (
          <div className="space-y-4 font-mono text-xs">
            {/* Tabs Bar */}
            <Tabs
              tabs={[
                { id: 'overview', label: t('users.tabOverview'), icon: <User className="h-3.5 w-3.5" /> },
                {
                  id: 'conversations',
                  label: t('users.tabConversations'),
                  badge: userDetails.recentConversations?.length ?? userDetails.conversations?.length ?? 0,
                  icon: <MessageSquare className="h-3.5 w-3.5" />,
                },
                {
                  id: 'memory',
                  label: t('users.tabMemory'),
                  badge: userDetails.memories?.length ?? 0,
                  icon: <Brain className="h-3.5 w-3.5" />,
                },
                {
                  id: 'reminders',
                  label: t('users.tabReminders'),
                  badge: userDetails.reminders?.length ?? 0,
                  icon: <Clock className="h-3.5 w-3.5" />,
                },
                {
                  id: 'agent-runs',
                  label: t('users.tabAgentRuns'),
                  icon: <Cpu className="h-3.5 w-3.5" />,
                },
              ]}
              activeTab={drawerTab}
              onChange={(id) => setDrawerTab(id as any)}
            />

            {/* TAB 1: OVERVIEW */}
            {drawerTab === 'overview' && (
              <div className="space-y-4">
                {/* Status & Quick Tags */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-surface-elevated/40 border border-border">
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-400 uppercase">{t('users.colStatus')}</span>
                    <div className="flex items-center gap-2">
                      <StatusPill status={userDetails.user.isBanned ? 'banned' : 'active'} />
                      {userDetails.user.isVip && <Badge variant="warning">{t('users.vipContact')}</Badge>}
                    </div>
                    {userDetails.user.isBanned && userDetails.user.banReason && (
                      <p className="text-[11px] text-red-400 mt-1">
                        {userDetails.user.banReason}
                      </p>
                    )}
                  </div>
                  <div className="text-end">
                    <span className="text-[11px] text-slate-400 uppercase">{t('users.firstSeen')}</span>
                    <p className="text-slate-200 mt-1">{formatDate(userDetails.user.createdAt)}</p>
                  </div>
                </div>

                {/* Metrics Breakdown */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 rounded bg-surface-elevated/30 border border-border">
                    <span className="text-[10px] text-slate-400 uppercase block">{t('overview.messages')}</span>
                    <span className="text-base font-bold text-slate-100">{formatNumber(userDetails.stats?.totalMessages ?? (userDetails as any).metrics?.totalMessages ?? 0)}</span>
                  </div>
                  <div className="p-3 rounded bg-surface-elevated/30 border border-border">
                    <span className="text-[10px] text-slate-400 uppercase block">{t('overview.tokenUsage')}</span>
                    <span className="text-base font-bold text-slate-100">{formatNumber(userDetails.stats?.tokenCount ?? (userDetails as any).metrics?.tokensUsed ?? 0)}</span>
                  </div>
                  <div className="p-3 rounded bg-surface-elevated/30 border border-border">
                    <span className="text-[10px] text-slate-400 uppercase block">{t('users.colCost')}</span>
                    <span className="text-base font-bold text-slate-100">{formatCurrency(userDetails.stats?.costUsd ?? (userDetails as any).metrics?.estimatedCostUsd ?? 0)}</span>
                  </div>
                </div>

                {/* WhatsApp Contact Details */}
                {userDetails.whatsappContact && (
                  <div className="p-3.5 rounded-lg bg-surface-elevated/30 border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        WhatsApp Identity
                      </span>
                      {userDetails.whatsappContact.verified && (
                        <Badge variant="success" className="text-[10px]">Verified</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-400 block">Profile Name</span>
                        <span className="text-slate-200">{userDetails.whatsappContact.profileName || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">WA ID</span>
                        <span className="text-slate-200">{userDetails.whatsappContact.waId || '—'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* User Preferences */}
                {userDetails.preferences && Object.keys(userDetails.preferences).length > 0 && (
                  <div className="p-3.5 rounded-lg bg-surface-elevated/30 border border-border space-y-2">
                    <span className="font-semibold text-slate-200 block">User Preferences</span>
                    <div className="space-y-1">
                      {Object.entries(userDetails.preferences).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-[11px] py-1 border-b border-border/40 last:border-0">
                          <span className="text-slate-400">{k}</span>
                          <span className="text-slate-200 font-medium">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: CONVERSATIONS */}
            {drawerTab === 'conversations' && (
              <div className="space-y-3">
                {(!userDetails.recentConversations || userDetails.recentConversations.length === 0) &&
                 (!userDetails.conversations || userDetails.conversations.length === 0) ? (
                  <p className="p-6 text-center rounded bg-surface-elevated/20 border border-border/40 text-slate-400">
                    {t('users.noConversationsFound')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(userDetails.recentConversations || userDetails.conversations || []).map((c: any) => (
                      <div key={c.id} className="p-3 rounded-lg bg-surface-elevated/30 border border-border hover:border-border-strong transition-colors space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="default" className="text-[10px] uppercase">{c.channel || 'whatsapp'}</Badge>
                            <StatusPill status={c.status || 'active'} />
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {formatRelativeTime(c.updatedAt || c.lastMessageAt || c.createdAt)}
                          </span>
                        </div>
                        {c.lastMessageSnippet && (
                          <p className="text-slate-300 text-[11px] line-clamp-2 bg-surface/50 p-2 rounded border border-border/30">
                            {c.lastMessageSnippet}
                          </p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] text-slate-400">
                            {formatNumber(c.messageCount || c.messagesCount || 0)} {t('overview.messages')}
                          </span>
                          <Link
                            href={`/conversations?id=${c.id}`}
                            className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 font-medium"
                          >
                            {t('users.openConversation')}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: MEMORY */}
            {drawerTab === 'memory' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase flex items-center gap-1.5">
                    <Brain className="h-3.5 w-3.5 text-purple-400" />
                    {t('users.profileMemoriesCount', { count: userDetails.memories?.length || 0 })}
                  </h4>
                  {canPurgeData && (userDetails.memories?.length || 0) > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setPurgeModalUserId(selectedUserId)}
                    >
                      <Trash2 className="h-3 w-3 me-1" />
                      {t('users.purgeMemoryBtn')}
                    </Button>
                  )}
                </div>
                {userDetails.memories?.length === 0 ? (
                  <p className="p-6 text-center rounded bg-surface-elevated/20 border border-border/40 text-slate-400">
                    {t('users.noMemoriesFound')}
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pe-1">
                    {userDetails.memories?.map((mem: any) => (
                      <div key={mem.id} className="p-2.5 rounded bg-surface-elevated/30 border border-border flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200">{mem.key || mem.factKey || mem.category || 'fact'}</span>
                            <span className="text-[10px] px-1 rounded bg-purple-950 text-purple-300 border border-purple-800">
                              {mem.category}
                            </span>
                          </div>
                          <p className="text-slate-300 mt-1">{mem.value || mem.factText}</p>
                          {mem.createdAt && (
                            <span className="text-[9px] text-slate-500 mt-1 block">
                              {formatDate(mem.createdAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: REMINDERS */}
            {drawerTab === 'reminders' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-brand-400" />
                    {t('users.scheduledRemindersCount', { count: userDetails.reminders?.length || 0 })}
                  </h4>
                </div>
                {userDetails.reminders?.length === 0 ? (
                  <p className="p-6 text-center rounded bg-surface-elevated/20 border border-border/40 text-slate-400">
                    {t('users.noRemindersFound')}
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pe-1">
                    {userDetails.reminders?.map((rem: any) => (
                      <div key={rem.id} className="p-2.5 rounded bg-surface-elevated/30 border border-border flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-200">{rem.title}</p>
                          <p className="text-[10px] text-slate-400">{formatDate(rem.scheduledTime || rem.dueAt)}</p>
                          {rem.recurrence && rem.recurrence !== 'none' && (
                            <span className="text-[9px] text-brand-300 uppercase mt-0.5 block">
                              ↻ {rem.recurrence}
                            </span>
                          )}
                        </div>
                        <StatusPill status={rem.status || rem.state} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: AGENT RUNS & TELEMETRY */}
            {drawerTab === 'agent-runs' && (
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-surface-elevated/30 border border-border space-y-3">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                    {t('users.telemetryStats')}
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <div className="p-2.5 rounded bg-surface/50 border border-border/40">
                      <span className="text-slate-400 block text-[10px] uppercase">Prompt Tokens</span>
                      <span className="text-slate-200 font-bold text-sm">
                        {formatNumber((userDetails as any).metrics?.promptTokens ?? 0)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded bg-surface/50 border border-border/40">
                      <span className="text-slate-400 block text-[10px] uppercase">Completion Tokens</span>
                      <span className="text-slate-200 font-bold text-sm">
                        {formatNumber((userDetails as any).metrics?.completionTokens ?? 0)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded bg-surface/50 border border-border/40">
                      <span className="text-slate-400 block text-[10px] uppercase">Daily Message Count</span>
                      <span className="text-slate-200 font-bold text-sm">
                        {formatNumber((userDetails as any).metrics?.dailyMessageCount ?? userDetails.user.dailyMessageCount ?? 0)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded bg-surface/50 border border-border/40">
                      <span className="text-slate-400 block text-[10px] uppercase">Estimated Spend</span>
                      <span className="text-slate-200 font-bold text-sm">
                        {formatCurrency(userDetails.stats?.costUsd ?? (userDetails as any).metrics?.estimatedCostUsd ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Ban User Modal */}
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

      {/* Purge Memory Modal */}
      <ConfirmModal
        isOpen={Boolean(purgeModalUserId)}
        onClose={() => setPurgeModalUserId(null)}
        onConfirm={() => purgeMemoryMutation.mutate(purgeModalUserId!)}
        title={t('users.purgeModalTitle')}
        description={t('users.purgeModalDesc')}
        confirmText={t('users.confirmPurge')}
        variant="destructive"
        isLoading={purgeMemoryMutation.isPending}
      />
    </div>
  );
}
