'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import {
  Search,
  Star,
  Ban,
  CheckCircle,
  Eye,
  Trash2,
  Clock,
  Brain,
} from 'lucide-react';
import { AdminUserListItem } from '@/types/admin';
import { formatNumber, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';

export default function UsersPage() {
  const { canMutate, canPurgeData } = useAuth();
  const queryClient = useQueryClient();

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [filterVip, setFilterVip] = useState<string>('all');
  const [filterBanned, setFilterBanned] = useState<string>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Selected User for 360 Drawer
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

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
            USER CONTROL PLANE & 360° PROFILES
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Manage WhatsApp contacts, VIP tiers, enforcement bans, and memory profiles
          </p>
        </div>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          title="Failed to load users list"
          onRetry={() => refetch()}
        />
      )}
      {toggleVipMutation.error && (
        <ErrorAlert error={toggleVipMutation.error} title="Failed to toggle VIP tier" />
      )}
      {banMutation.error && (
        <ErrorAlert error={banMutation.error} title="Failed to update ban status" />
      )}
      {unbanMutation.error && (
        <ErrorAlert error={unbanMutation.error} title="Failed to unban user account" />
      )}

      {/* Filters Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <Input
              placeholder="Search phone number or user ID..."
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
              <option value="all">VIP Status: All</option>
              <option value="vip">VIP Only</option>
              <option value="standard">Standard Only</option>
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
              <option value="all">Account State: All</option>
              <option value="active">Active Only</option>
              <option value="banned">Banned Only</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Users Table */}
      <DataTable
        columns={[
          {
            header: 'Contact / Phone',
            accessorKey: 'phoneNumber',
            cell: (u) => (
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-100">{u.phoneNumber || u.id}</span>
                {u.isVip && (
                  <Badge variant="warning" className="text-[10px] py-0 px-1">
                    <Star className="h-2.5 w-2.5 mr-0.5 fill-amber-400" />
                    VIP
                  </Badge>
                )}
              </div>
            ),
          },
          {
            header: 'Status',
            accessorKey: 'isBanned',
            cell: (u) => (
              <StatusPill status={u.isBanned ? 'banned' : 'active'} />
            ),
          },
          {
            header: 'Messages',
            accessorKey: 'messageCount',
            cell: (u) => formatNumber(u.messageCount),
          },
          {
            header: 'Conversations',
            accessorKey: 'conversationCount',
            cell: (u) => formatNumber(u.conversationCount),
          },
          {
            header: 'Reminders',
            accessorKey: 'reminderCount',
            cell: (u) => formatNumber(u.reminderCount),
          },
          {
            header: 'Last Active',
            accessorKey: 'lastActiveAt',
            cell: (u) => formatRelativeTime(u.lastActiveAt),
          },
          {
            header: 'Actions',
            cell: (u) => (
              <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedUserId(u.id)}
                  title="View User 360 Profile"
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  360°
                </Button>

                {canMutate && (
                  <>
                    <Button
                      variant={u.isVip ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => toggleVipMutation.mutate({ id: u.id, isVip: !u.isVip })}
                      isLoading={toggleVipMutation.isPending}
                      title={u.isVip ? 'Revoke VIP Tier' : 'Promote to VIP Tier'}
                    >
                      <Star className={`h-3.5 w-3.5 ${u.isVip ? 'text-amber-400 fill-amber-400' : 'text-slate-400'}`} />
                    </Button>

                    {u.isBanned ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => unbanMutation.mutate(u.id)}
                        isLoading={unbanMutation.isPending}
                        title="Unban User Account"
                      >
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setBanModalUser(u)}
                        title="Ban User Account"
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
        emptyMessage="No users matching the filters found"
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
        title={`USER 360° PROFILE: ${userDetails?.user?.phoneNumber || selectedUserId || ''}`}
        subtitle={`System ID: ${selectedUserId || ''}`}
        width="xl"
      >
        {detailsQuery.isLoading ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">Loading user profile telemetry...</div>
        ) : detailsQuery.error ? (
          <div className="p-4">
            <ErrorAlert
              error={detailsQuery.error}
              title="Failed to load User 360 Profile"
              onRetry={() => detailsQuery.refetch()}
            />
          </div>
        ) : !userDetails ? (
          <div className="p-8 text-center text-xs font-mono text-slate-400">User details not found</div>
        ) : (
          <div className="space-y-6 font-mono text-xs">
            {/* Status & Quick Tags */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-surface-elevated/40 border border-border">
              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 uppercase">Account State</span>
                <div className="flex items-center gap-2">
                  <StatusPill status={userDetails.user.isBanned ? 'banned' : 'active'} />
                  {userDetails.user.isVip && <Badge variant="warning">VIP CONTACT</Badge>}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-slate-400 uppercase">First Seen</span>
                <p className="text-slate-200 mt-1">{formatDate(userDetails.user.createdAt)}</p>
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded bg-surface-elevated/30 border border-border">
                <span className="text-[10px] text-slate-400 uppercase block">Messages</span>
                <span className="text-base font-bold text-slate-100">{formatNumber(userDetails.stats?.totalMessages)}</span>
              </div>
              <div className="p-3 rounded bg-surface-elevated/30 border border-border">
                <span className="text-[10px] text-slate-400 uppercase block">Tokens</span>
                <span className="text-base font-bold text-slate-100">{formatNumber(userDetails.stats?.tokenCount)}</span>
              </div>
              <div className="p-3 rounded bg-surface-elevated/30 border border-border">
                <span className="text-[10px] text-slate-400 uppercase block">Inference Cost</span>
                <span className="text-base font-bold text-slate-100">{formatCurrency(userDetails.stats?.costUsd)}</span>
              </div>
            </div>

            {/* User Reminders Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-200 uppercase flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-brand-400" />
                  Scheduled Reminders ({userDetails.reminders?.length || 0})
                </h4>
              </div>
              {userDetails.reminders?.length === 0 ? (
                <p className="p-3 rounded bg-surface-elevated/20 border border-border/40 text-slate-400">
                  No active or past reminders found
                </p>
              ) : (
                <div className="space-y-1.5">
                  {userDetails.reminders?.map((rem: any) => (
                    <div key={rem.id} className="p-2.5 rounded bg-surface-elevated/30 border border-border flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-200">{rem.title}</p>
                        <p className="text-[10px] text-slate-400">{formatDate(rem.scheduledTime)}</p>
                      </div>
                      <StatusPill status={rem.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* User Memories */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-200 uppercase flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-purple-400" />
                  Profile Memories ({userDetails.memories?.length || 0})
                </h4>
                {canPurgeData && (userDetails.memories?.length || 0) > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setPurgeModalUserId(selectedUserId)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Purge All Memories
                  </Button>
                )}
              </div>
              {userDetails.memories?.length === 0 ? (
                <p className="p-3 rounded bg-surface-elevated/20 border border-border/40 text-slate-400">
                  No memory profile facts recorded
                </p>
              ) : (
                <div className="space-y-1.5">
                  {userDetails.memories?.map((mem: any) => (
                    <div key={mem.id} className="p-2.5 rounded bg-surface-elevated/30 border border-border flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">{mem.key}</span>
                          <span className="text-[10px] px-1 rounded bg-purple-950 text-purple-300 border border-purple-800">
                            {mem.category}
                          </span>
                        </div>
                        <p className="text-slate-300 mt-1">{mem.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Ban User Modal */}
      <ConfirmModal
        isOpen={Boolean(banModalUser)}
        onClose={() => setBanModalUser(null)}
        onConfirm={() => banMutation.mutate({ id: banModalUser!.id, reason: banReason })}
        title={`Ban User Contact: ${banModalUser?.phoneNumber || banModalUser?.id}`}
        description="Banning will prevent the user from triggering further AI executions or receiving proactive dispatches. Existing scheduled reminders will be preserved unless cancelled."
        confirmText="Confirm Ban"
        variant="destructive"
        isLoading={banMutation.isPending}
      >
        <div className="space-y-1 mt-2">
          <label className="text-[11px] font-mono text-slate-400">Optional Enforcement Reason</label>
          <Input
            placeholder="e.g. Rate limit abuse, spam activity"
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
        title="Purge All User Memories"
        description="This will permanently delete all stored memory profile facts for this user. This action cannot be undone."
        confirmText="Purge Memories"
        variant="destructive"
        isLoading={purgeMemoryMutation.isPending}
      />
    </div>
  );
}
