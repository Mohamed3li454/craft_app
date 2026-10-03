'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs } from '@/components/ui/tabs';
import { ConversationViewer } from '@/components/conversations/conversation-viewer';
import {
  X,
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
  RotateCcw,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { cn, truncate } from '@/lib/utils';
import { AdminConversationItem } from '@/types/admin';

export interface User360WorkspaceProps {
  userId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onUserMutated?: () => void;
}

export function User360Workspace({
  userId,
  isOpen,
  onClose,
  onUserMutated,
}: User360WorkspaceProps) {
  const { canMutate, canPurgeData, canBanUsers } = useAuth();
  const { t, formatNumber, formatCurrency, formatDate, formatRelativeTime } = useLanguage();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'overview' | 'conversations' | 'memory' | 'reminders' | 'activity'>('overview');
  const [copiedId, setCopiedId] = useState(false);

  // Modal states
  const [isBanModalOpen, setIsBanModalOpen] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [cancellingReminderId, setCancellingReminderId] = useState<string | null>(null);

  // Inspecting conversation inside 360
  const [inspectingConv, setInspectingConv] = useState<AdminConversationItem | null>(null);

  // User 360 Details Query
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user-details', userId],
    queryFn: () => adminApi.getUserDetails(userId!),
    enabled: Boolean(userId && isOpen),
    staleTime: 30000,
  });

  const userDetails = data?.data;

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (inspectingConv) {
          setInspectingConv(null);
        } else if (isBanModalOpen || isPurgeModalOpen || cancellingReminderId) {
          setIsBanModalOpen(false);
          setIsPurgeModalOpen(false);
          setCancellingReminderId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, inspectingConv, isBanModalOpen, isPurgeModalOpen, cancellingReminderId, onClose]);

  // Mutations
  const toggleVipMutation = useMutation({
    mutationFn: ({ id, isVip }: { id: string; isVip: boolean }) => adminApi.toggleUserVip(id, isVip),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-details', userId] });
      onUserMutated?.();
    },
  });

  const banMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminApi.banUser(id, reason),
    onSuccess: () => {
      setIsBanModalOpen(false);
      setBanReason('');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-details', userId] });
      onUserMutated?.();
    },
  });

  const unbanMutation = useMutation({
    mutationFn: (id: string) => adminApi.unbanUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-details', userId] });
      onUserMutated?.();
    },
  });

  const purgeMemoryMutation = useMutation({
    mutationFn: (uId: string) => adminApi.purgeUserMemories(uId),
    onSuccess: () => {
      setIsPurgeModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin-user-details', userId] });
      onUserMutated?.();
    },
  });

  const retryReminderMutation = useMutation({
    mutationFn: (reminderId: string) => adminApi.retryReminder(reminderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user-details', userId] });
      onUserMutated?.();
    },
  });

  const cancelReminderMutation = useMutation({
    mutationFn: ({ reminderId, reason }: { reminderId: string; reason?: string }) =>
      adminApi.cancelReminder(reminderId, reason),
    onSuccess: () => {
      setCancellingReminderId(null);
      queryClient.invalidateQueries({ queryKey: ['admin-user-details', userId] });
      onUserMutated?.();
    },
  });

  const handleCopyId = (idToCopy: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(idToCopy);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  if (!isOpen || !userId) return null;

  const user = userDetails?.user;
  const phoneNumber = user?.phoneNumber || (user as any)?.phone || userId;
  const isBanned = user?.isBanned ?? false;
  const isVip = user?.isVip ?? false;

  // Conversations list from DTO
  const conversationsList: AdminConversationItem[] =
    userDetails?.recentConversations || userDetails?.conversations || [];

  // Memories list from DTO
  const memoriesList = userDetails?.memories || [];

  // Reminders list from DTO
  const remindersList = userDetails?.reminders || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-360-title"
        className="w-full h-full max-w-4xl 2xl:max-w-5xl bg-surface border-s border-border flex flex-col shadow-2xl animate-in slide-in-from-right rtl:slide-in-from-left duration-200 overflow-hidden font-mono"
      >
        {/* ========================================================= */}
        {/* 1. Header & Identity Bar                                  */}
        {/* ========================================================= */}
        <div className="p-4 sm:p-6 border-b border-border bg-surface-elevated/70 shrink-0 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Avatar circle */}
              <div className="h-12 w-12 rounded-full bg-brand-500/15 border-2 border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-base shrink-0 shadow-inner">
                {phoneNumber ? phoneNumber.slice(-2).toUpperCase() : 'U'}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 id="user-360-title" className="text-base sm:text-lg font-bold text-foreground tracking-tight truncate" dir="ltr">
                    {phoneNumber}
                  </h2>
                  <StatusBadge status={isBanned ? 'banned' : 'active'} size="xs" showDot={true} />
                  {isVip && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 border border-amber-500/30 text-amber-500">
                      <Star className="h-2.5 w-2.5 fill-amber-500" />
                      {t('common.vip')}
                    </span>
                  )}
                  {userDetails?.whatsappContact?.verified && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-500">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      Verified
                    </span>
                  )}
                </div>

                {/* Secondary System ID & Timestamps */}
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
                  <div className="flex items-center gap-1 bg-surface px-1.5 py-0.5 rounded border border-border/60">
                    <span className="text-[10px] text-slate-500">ID:</span>
                    <span className="text-[11px] text-foreground font-mono truncate max-w-[140px]" dir="ltr">
                      {truncate(userId, 16)}
                    </span>
                    <button
                      onClick={() => handleCopyId(userId)}
                      className="p-0.5 text-slate-400 hover:text-foreground"
                      title="Copy ID"
                      aria-label="Copy ID"
                    >
                      {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                  <span>•</span>
                  <span className="text-[11px]">
                    {t('users.firstSeen')}: {user ? formatDate(user.createdAt) : '—'}
                  </span>
                  <span>•</span>
                  <span className="text-[11px]">
                    {t('users.colLastActive')}:{' '}
                    {user ? formatRelativeTime(user.lastActiveAt || (user as any).lastActive || user.createdAt) : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Header Actions & Close */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
                title={t('common.refresh')}
                className="h-8 px-2.5"
                aria-label={t('common.refresh')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              </Button>

              {/* VIP Toggle (Mutate permitted) */}
              {canMutate && user && (
                <Button
                  variant={isVip ? 'outline' : 'secondary'}
                  size="sm"
                  onClick={() => toggleVipMutation.mutate({ id: user.id, isVip: !isVip })}
                  isLoading={toggleVipMutation.isPending}
                  className="h-8 text-xs font-mono"
                  title={isVip ? t('users.btnUnvip') : t('users.btnVip')}
                >
                  <Star className={cn('h-3.5 w-3.5 me-1', isVip ? 'text-amber-500 fill-amber-500' : 'text-slate-400')} />
                  <span>{isVip ? t('users.btnUnvip') : t('users.btnVip')}</span>
                </Button>
              )}

              {/* Ban / Unban Button (Ban permitted) */}
              {canBanUsers && user && (
                isBanned ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unbanMutation.mutate(user.id)}
                    isLoading={unbanMutation.isPending}
                    className="h-8 text-xs font-mono text-emerald-500 border-emerald-500/30 hover:border-emerald-500"
                    title={t('users.btnUnban')}
                  >
                    <CheckCircle className="h-3.5 w-3.5 me-1" />
                    <span>{t('users.btnUnban')}</span>
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsBanModalOpen(true)}
                    className="h-8 text-xs font-mono"
                    title={t('users.btnBan')}
                  >
                    <Ban className="h-3.5 w-3.5 me-1" />
                    <span>{t('users.btnBan')}</span>
                  </Button>
                )
              )}

              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="p-1.5 rounded-md text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Ban Warning Alert if Banned */}
          {isBanned && user?.banReason && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block uppercase tracking-wider text-[10px] text-rose-400">
                  {t('users.banModalTitle')}
                </span>
                <p className="mt-0.5 leading-relaxed">{user.banReason}</p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <ErrorAlert
              error={error}
              title={t('users.failedToLoad')}
              onRetry={() => refetch()}
            />
          )}

          {/* Navigation Tabs Bar */}
          <Tabs
            tabs={[
              {
                id: 'overview',
                label: t('users.tabOverview'),
                icon: <User className="h-3.5 w-3.5" />,
              },
              {
                id: 'conversations',
                label: t('users.tabConversations'),
                badge: conversationsList.length,
                icon: <MessageSquare className="h-3.5 w-3.5" />,
              },
              {
                id: 'memory',
                label: t('users.tabMemory'),
                badge: memoriesList.length,
                icon: <Brain className="h-3.5 w-3.5" />,
              },
              {
                id: 'reminders',
                label: t('users.tabReminders'),
                badge: remindersList.length,
                icon: <Clock className="h-3.5 w-3.5" />,
              },
              {
                id: 'activity',
                label: t('users.tabAgentRuns'),
                icon: <Cpu className="h-3.5 w-3.5" />,
              },
            ]}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as any)}
          />
        </div>

        {/* ========================================================= */}
        {/* 2. Workspace Body (Tabs Content)                          */}
        {/* ========================================================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 text-xs bg-background/50">
          {isLoading ? (
            <div className="space-y-4 py-8">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-lg bg-surface-elevated/40 border border-border animate-pulse" />
                ))}
              </div>
              <div className="h-40 rounded-lg bg-surface-elevated/30 border border-border animate-pulse" />
              <div className="text-center text-xs text-slate-400 font-mono py-4">
                {t('users.loadingTelemetry')}
              </div>
            </div>
          ) : !userDetails ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <User className="h-8 w-8 mx-auto text-slate-500" />
              <p>{t('users.userNotFound')}</p>
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-5">
                  {/* KPI Summary Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-4 rounded-lg bg-surface border border-border space-y-1">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                        {t('navigation.conversations')}
                      </span>
                      <span className="text-xl font-bold text-foreground">
                        {formatNumber(userDetails.stats?.totalConversations ?? 0)}
                      </span>
                    </div>
                    <div className="p-4 rounded-lg bg-surface border border-border space-y-1">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                        {t('overview.messages')}
                      </span>
                      <span className="text-xl font-bold text-foreground">
                        {formatNumber(userDetails.stats?.totalMessages ?? 0)}
                      </span>
                    </div>
                    <div className="p-4 rounded-lg bg-surface border border-border space-y-1">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                        {t('navigation.memory')}
                      </span>
                      <span className="text-xl font-bold text-purple-400">
                        {formatNumber(userDetails.stats?.memoryCount ?? memoriesList.length)}
                      </span>
                    </div>
                    <div className="p-4 rounded-lg bg-surface border border-border space-y-1">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                        {t('navigation.reminders')}
                      </span>
                      <span className="text-xl font-bold text-brand-400">
                        {formatNumber(userDetails.stats?.totalReminders ?? remindersList.length)}
                      </span>
                    </div>
                  </div>

                  {/* Resource Usage & Token Spend */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-4 rounded-lg bg-surface border border-border space-y-2">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block flex items-center gap-1.5">
                        <Zap className="h-3 w-3 text-amber-400" />
                        {t('overview.tokenUsage')}
                      </span>
                      <div className="flex items-baseline justify-between">
                        <span className="text-lg font-bold text-foreground">
                          {formatNumber(userDetails.stats?.tokenCount ?? (userDetails as any).metrics?.tokensUsed ?? 0)}
                        </span>
                        <span className="text-xs text-slate-400">tokens consumed</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-surface border border-border space-y-2">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block flex items-center gap-1.5">
                        <Cpu className="h-3 w-3 text-emerald-400" />
                        {t('users.colCost')}
                      </span>
                      <div className="flex items-baseline justify-between">
                        <span className="text-lg font-bold text-foreground">
                          {formatCurrency(userDetails.stats?.costUsd ?? (userDetails as any).metrics?.estimatedCostUsd ?? 0)}
                        </span>
                        <span className="text-xs text-slate-400">estimated compute cost</span>
                      </div>
                    </div>
                  </div>

                  {/* WhatsApp Identity Card */}
                  {userDetails.whatsappContact && (
                    <div className="p-4 rounded-lg bg-surface border border-border space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-border/60">
                        <span className="font-bold text-foreground flex items-center gap-1.5 text-xs">
                          <ShieldCheck className="h-4 w-4 text-emerald-400" />
                          WhatsApp Channel Identity
                        </span>
                        {userDetails.whatsappContact.verified && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/60 border border-emerald-800 text-emerald-300">
                            Verified Contact
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 text-[10px] block">Profile Name</span>
                          <span className="text-foreground font-semibold">{userDetails.whatsappContact.profileName || '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 text-[10px] block">WA Identifier</span>
                          <span className="text-foreground font-mono" dir="ltr">{userDetails.whatsappContact.waId || '—'}</span>
                        </div>
                        {userDetails.whatsappContact.bsuid && (
                          <div>
                            <span className="text-slate-500 dark:text-slate-400 text-[10px] block">Business Scope UID</span>
                            <span className="text-slate-400 font-mono text-[10px] truncate block" dir="ltr">
                              {userDetails.whatsappContact.bsuid}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* User Preferences Card */}
                  {userDetails.preferences && Object.keys(userDetails.preferences).length > 0 && (
                    <div className="p-4 rounded-lg bg-surface border border-border space-y-3">
                      <span className="font-bold text-foreground block text-xs">
                        User Preferences & Persona Parameters
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Object.entries(userDetails.preferences).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between p-2 rounded bg-surface-elevated/40 border border-border/50 text-xs"
                          >
                            <span className="text-slate-500 dark:text-slate-400 font-mono">{k}:</span>
                            <span className="text-foreground font-semibold font-mono">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CONVERSATIONS */}
              {activeTab === 'conversations' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground text-xs uppercase tracking-wider">
                      {t('users.tabConversations')} ({conversationsList.length})
                    </span>
                  </div>

                  {conversationsList.length === 0 ? (
                    <EmptyState
                      icon={MessageSquare}
                      title={t('users.noConversationsFound')}
                      description=""
                      className="py-10"
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {conversationsList.map((c) => (
                        <div
                          key={c.id}
                          className="p-3.5 rounded-lg bg-surface border border-border hover:border-border-strong transition-colors space-y-2"
                        >
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-950/60 border border-emerald-800 text-emerald-300">
                                {c.channel || 'whatsapp'}
                              </span>
                              <StatusBadge status={c.status || 'active'} size="xs" showDot={true} />
                            </div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {formatRelativeTime(c.updatedAt || c.lastMessageAt || c.createdAt)}
                            </span>
                          </div>

                          {c.lastMessageSnippet && (
                            <p className="text-foreground/90 text-xs italic bg-surface-elevated/40 p-2.5 rounded border border-border/40 line-clamp-2">
                              &ldquo;{c.lastMessageSnippet}&rdquo;
                            </p>
                          )}

                          <div className="flex items-center justify-between pt-1 border-t border-border/40">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              {formatNumber(c.messageCount ?? (c as any).messagesCount ?? 0)} {t('overview.messages')}
                            </span>

                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setInspectingConv(c)}
                                className="h-7 text-xs font-mono"
                              >
                                <Eye className="h-3 w-3 me-1" />
                                <span>{t('conversations.btnTranscript')}</span>
                              </Button>

                              <Link
                                href={`/conversations?id=${c.id}`}
                                className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:text-brand-500 font-medium"
                              >
                                <span>{t('users.openConversation')}</span>
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: MEMORY */}
              {activeTab === 'memory' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-purple-400" />
                      <span className="font-bold text-foreground text-xs uppercase tracking-wider">
                        {t('users.profileMemoriesCount', { count: String(memoriesList.length) })}
                      </span>
                    </div>

                    {canPurgeData && memoriesList.length > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setIsPurgeModalOpen(true)}
                        className="h-8 text-xs font-mono"
                      >
                        <Trash2 className="h-3.5 w-3.5 me-1.5" />
                        <span>{t('users.purgeMemoryBtn')}</span>
                      </Button>
                    )}
                  </div>

                  {memoriesList.length === 0 ? (
                    <EmptyState
                      icon={Brain}
                      title={t('users.noMemoriesFound')}
                      description=""
                      className="py-10"
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {memoriesList.map((mem: any, idx: number) => {
                        const category = mem.category || 'fact';
                        const key = mem.key || mem.factKey || category;
                        const value = mem.value || mem.factText || '';
                        const confRaw = mem.confidence;
                        const confidenceLabel =
                          typeof confRaw === 'number'
                            ? confRaw >= 0.8
                              ? 'High'
                              : confRaw >= 0.5
                              ? 'Medium'
                              : 'Low'
                            : confRaw || 'High';

                        return (
                          <div
                            key={mem.id || idx}
                            className="p-3.5 rounded-lg bg-surface border border-border hover:border-purple-800/60 transition-colors space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-950/60 border border-purple-800 text-purple-300">
                                  {category}
                                </span>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                  {t('users.confidence')}:{' '}
                                  <span className="font-semibold text-foreground">{confidenceLabel}</span>
                                </span>
                              </div>
                              {mem.createdAt && (
                                <span className="text-[10px] text-slate-500">
                                  {formatDate(mem.createdAt)}
                                </span>
                              )}
                            </div>

                            <div className="space-y-1 text-xs">
                              <div className="flex items-baseline gap-2">
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">
                                  Key:
                                </span>
                                <span className="font-bold text-foreground font-mono">{key}</span>
                              </div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">
                                  Value:
                                </span>
                                <span className="text-foreground leading-relaxed bg-surface-elevated/40 p-2 rounded border border-border/40 w-full block">
                                  {value}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: REMINDERS */}
              {activeTab === 'reminders' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-brand-400" />
                      <span className="font-bold text-foreground text-xs uppercase tracking-wider">
                        {t('users.scheduledRemindersCount', { count: String(remindersList.length) })}
                      </span>
                    </div>
                  </div>

                  {remindersList.length === 0 ? (
                    <EmptyState
                      icon={Clock}
                      title={t('users.noRemindersFound')}
                      description=""
                      className="py-10"
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {remindersList.map((rem: any) => {
                        const isTerminal = rem.status === 'cancelled' || rem.status === 'sent' || rem.isCompleted;
                        return (
                          <div
                            key={rem.id}
                            className="p-3.5 rounded-lg bg-surface border border-border hover:border-brand-500/40 transition-colors space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1 min-w-0">
                                <h4 className="font-bold text-foreground text-xs leading-snug">
                                  {rem.title || rem.text || 'Scheduled Notification'}
                                </h4>
                                <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                                  <span>{t('users.scheduledTime')}: {formatDate(rem.scheduledTime || rem.dueAt)}</span>
                                  {rem.recurrence && rem.recurrence !== 'none' && (
                                    <>
                                      <span>•</span>
                                      <span className="text-brand-400 font-semibold uppercase text-[10px]">
                                        ↻ {rem.recurrence}
                                      </span>
                                    </>
                                  )}
                                  {rem.attempts !== undefined && rem.attempts > 0 && (
                                    <>
                                      <span>•</span>
                                      <span>{t('users.attempts')}: {rem.attempts}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <StatusBadge status={rem.status || rem.state || 'scheduled'} size="xs" showDot={true} />
                            </div>

                            {/* Actions bar */}
                            {canMutate && (
                              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                                {!isTerminal && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCancellingReminderId(rem.id)}
                                    className="h-7 text-xs font-mono text-rose-400 hover:text-rose-300"
                                  >
                                    <Ban className="h-3 w-3 me-1" />
                                    <span>{t('users.cancel')}</span>
                                  </Button>
                                )}

                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => retryReminderMutation.mutate(rem.id)}
                                  isLoading={retryReminderMutation.isPending}
                                  className="h-7 text-xs font-mono"
                                >
                                  <RotateCcw className="h-3 w-3 me-1" />
                                  <span>{t('users.retryNow')}</span>
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: ACTIVITY & AGENT RUNS */}
              {activeTab === 'activity' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-surface border border-border space-y-3">
                    <span className="font-bold text-foreground text-xs uppercase tracking-wider block flex items-center gap-1.5">
                      <Cpu className="h-4 w-4 text-cyan-400" />
                      {t('users.telemetryStats')}
                    </span>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded bg-surface-elevated/40 border border-border/50">
                        <span className="text-slate-500 dark:text-slate-400 text-[10px] uppercase block">
                          Prompt Tokens
                        </span>
                        <span className="text-foreground font-bold text-sm">
                          {formatNumber((userDetails as any).metrics?.promptTokens ?? 0)}
                        </span>
                      </div>
                      <div className="p-3 rounded bg-surface-elevated/40 border border-border/50">
                        <span className="text-slate-500 dark:text-slate-400 text-[10px] uppercase block">
                          Completion Tokens
                        </span>
                        <span className="text-foreground font-bold text-sm">
                          {formatNumber((userDetails as any).metrics?.completionTokens ?? 0)}
                        </span>
                      </div>
                      <div className="p-3 rounded bg-surface-elevated/40 border border-border/50">
                        <span className="text-slate-500 dark:text-slate-400 text-[10px] uppercase block">
                          Daily Message Volume
                        </span>
                        <span className="text-foreground font-bold text-sm">
                          {formatNumber(
                            (userDetails as any).metrics?.dailyMessageCount ?? userDetails.user.dailyMessageCount ?? 0
                          )}
                        </span>
                      </div>
                      <div className="p-3 rounded bg-surface-elevated/40 border border-border/50">
                        <span className="text-slate-500 dark:text-slate-400 text-[10px] uppercase block">
                          Estimated Resource Spend
                        </span>
                        <span className="text-foreground font-bold text-sm">
                          {formatCurrency(
                            userDetails.stats?.costUsd ?? (userDetails as any).metrics?.estimatedCostUsd ?? 0
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Empty state for Agent Runs when none present */}
                  <EmptyState
                    icon={Cpu}
                    title={t('users.noAgentActivity')}
                    description=""
                    className="py-10"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* ========================================================= */}
        {/* 3. Sub-Modals for Confirmations                           */}
        {/* ========================================================= */}
        {/* Ban User Modal */}
        <ConfirmModal
          isOpen={isBanModalOpen}
          onClose={() => setIsBanModalOpen(false)}
          onConfirm={() => banMutation.mutate({ id: userId, reason: banReason })}
          title={`${t('users.banModalTitle')}: ${phoneNumber}`}
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

        {/* Purge Memories Modal */}
        <ConfirmModal
          isOpen={isPurgeModalOpen}
          onClose={() => setIsPurgeModalOpen(false)}
          onConfirm={() => purgeMemoryMutation.mutate(userId)}
          title={t('users.purgeModalTitle')}
          description={t('users.purgeModalDesc')}
          confirmText={t('users.confirmPurge')}
          variant="destructive"
          isLoading={purgeMemoryMutation.isPending}
        />

        {/* Cancel Reminder Modal */}
        <ConfirmModal
          isOpen={Boolean(cancellingReminderId)}
          onClose={() => setCancellingReminderId(null)}
          onConfirm={() => {
            if (cancellingReminderId) {
              cancelReminderMutation.mutate({ reminderId: cancellingReminderId });
            }
          }}
          title={t('users.cancelReminder')}
          description={t('users.cancelReminderDesc')}
          confirmText={t('users.confirmCancelReminder')}
          variant="destructive"
          isLoading={cancelReminderMutation.isPending}
        />

        {/* Inspect Conversation Viewer inside Workspace */}
        <ConversationViewer
          conversation={inspectingConv}
          isOpen={Boolean(inspectingConv)}
          onClose={() => setInspectingConv(null)}
        />
      </div>
    </div>
  );
}
