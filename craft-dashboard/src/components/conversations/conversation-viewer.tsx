'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { adminApi } from '@/lib/api/admin-client';
import { AdminConversationItem, AdminMessageItem } from '@/types/admin';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import {
  User,
  Bot,
  X,
  RefreshCw,
  Search,
  ArrowDown,
  Wrench,
  Zap,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  MessageSquare,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConversationViewerProps {
  conversation: AdminConversationItem | null;
  isOpen: boolean;
  onClose: () => void;
  onArchiveToggle?: (id: string, isArchived: boolean) => void;
  initialMessages?: AdminMessageItem[];
  onLoadOlder?: () => void;
}

export function ConversationViewer({
  conversation,
  isOpen,
  onClose,
  onArchiveToggle,
  initialMessages,
  onLoadOlder: externalLoadOlder,
}: ConversationViewerProps) {
  const { t, formatNumber, formatDate, formatRelativeTime } = useLanguage();

  const [messages, setMessages] = useState<AdminMessageItem[]>(initialMessages || []);
  const [totalCount, setTotalCount] = useState<number>(conversation?.messageCount ?? initialMessages?.length ?? 0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [error, setError] = useState<any>(null);

  // Search in conversation
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Expanded tool call ID for viewing tool args/result
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Scroll detection for "Jump to latest"
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false);

  const PAGE_SIZE = 50;

  // 1. Initial load for selected conversation (fetches latest 50 messages)
  const fetchInitialMessages = useCallback(async (convId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminApi.getConversationMessages(convId, { limit: PAGE_SIZE, offset: 0 });
      const fetched = res.data || [];
      const total = res.pagination?.total ?? (conversation?.messageCount ?? fetched.length);
      setMessages(fetched);
      setTotalCount(total);
    } catch (err: any) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [conversation?.messageCount]);

  useEffect(() => {
    if (isOpen && conversation?.id) {
      setSearchQuery('');
      setExpandedToolId(null);
      if (initialMessages && initialMessages.length > 0) {
        setMessages(initialMessages);
        setTotalCount(conversation.messageCount || initialMessages.length);
      } else {
        fetchInitialMessages(conversation.id);
      }
    } else {
      setMessages([]);
      setTotalCount(0);
    }
  }, [isOpen, conversation?.id, conversation?.messageCount, initialMessages, fetchInitialMessages]);

  // 2. Load older messages (prepends previous page)
  const handleLoadOlder = async () => {
    if (!conversation?.id || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const offset = messages.length;
      const res = await adminApi.getConversationMessages(conversation.id, { limit: PAGE_SIZE, offset });
      const olderBatch = res.data || [];
      if (olderBatch.length > 0) {
        // Prepend older messages while preserving chronological order
        setMessages((prev) => [...olderBatch, ...prev]);
      }
      if (res.pagination?.total) {
        setTotalCount(res.pagination.total);
      }
    } catch (err: any) {
      setError(err);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // 3. Scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !isScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [isLoading, messages.length, isScrolledUp]);

  // 4. Scroll listener for "Jump to latest" button
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsScrolledUp(distanceToBottom > 180);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsScrolledUp(false);
  };

  // 5. Copy message content
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 6. Search filter and match counter
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const searchMatchesCount = useMemo(() => {
    if (!trimmedSearch) return 0;
    return messages.filter((m) => (m.content || m.text || '').toLowerCase().includes(trimmedSearch)).length;
  }, [messages, trimmedSearch]);

  // Helper to render text with search highlights
  const renderHighlightedText = (text: string) => {
    if (!trimmedSearch) return text;
    const parts = text.split(new RegExp(`(${trimmedSearch.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === trimmedSearch ? (
            <mark key={i} className="bg-amber-500/35 text-amber-200 px-0.5 rounded-xs font-semibold">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  if (!isOpen || !conversation) return null;

  const hasMoreOlder = totalCount > messages.length;
  const remainingOlderCount = Math.max(0, totalCount - messages.length);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full h-full max-w-4xl bg-surface border-s border-border flex flex-col shadow-2xl animate-in slide-in-from-right rtl:slide-in-from-left duration-200 overflow-hidden">
        {/* ========================================================= */}
        {/* 1. Conversation Header                                    */}
        {/* ========================================================= */}
        <div className="px-6 py-3.5 border-b border-border bg-surface-elevated/70 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between gap-3">
            {/* User identification & channel */}
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 shrink-0">
                <MessageSquare className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-100 font-mono tracking-tight truncate">
                    {conversation.userPhone || conversation.phone || conversation.userName || conversation.userId}
                  </h2>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-800 text-emerald-300">
                    {conversation.channel || 'whatsapp'}
                  </span>
                  <StatusPill status={conversation.status || 'active'} />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                  <span className="text-slate-300 font-semibold">
                    {formatNumber(totalCount || conversation.messageCount || messages.length)} {t('conversations.colMessages')}
                  </span>
                  <span>•</span>
                  <span>{t('conversations.updated')}: {formatRelativeTime(conversation.updatedAt || conversation.lastMessageAt || conversation.createdAt)}</span>
                </div>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchInitialMessages(conversation.id)}
                disabled={isLoading}
                title={t('common.refresh')}
                className="h-8 px-2.5"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              </Button>
              {onArchiveToggle && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onArchiveToggle(conversation.id, conversation.status !== 'archived')}
                  className="h-8 text-xs font-mono"
                >
                  {conversation.status === 'archived' ? t('conversations.unarchiveTitle') : t('conversations.btnArchive')}
                </Button>
              )}
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-surface-elevated transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Search bar inside conversation */}
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <div className="relative flex-1">
              <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('conversations.searchInConversation')}
                className="w-full h-8 ps-8 pe-8 text-xs bg-surface-elevated/90 border border-border rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute end-2 top-2 p-0.5 text-slate-400 hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {trimmedSearch && (
              <span className="text-[11px] font-mono px-2 py-1 rounded bg-surface-elevated border border-border text-slate-300 shrink-0">
                {t('conversations.searchResults', { count: String(searchMatchesCount) })}
              </span>
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* 2. Messages Stream Area                                   */}
        {/* ========================================================= */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-background/50 relative font-mono text-xs"
        >
          {/* Error Banner */}
          {error && (
            <div className="p-3">
              <ErrorAlert
                error={error}
                title={t('conversations.failedToLoad')}
                onRetry={() => fetchInitialMessages(conversation.id)}
              />
            </div>
          )}

          {/* Loading Skeleton */}
          {isLoading ? (
            <div className="space-y-4 py-8">
              <div className="flex flex-col items-end space-y-1.5 ms-auto max-w-md">
                <div className="h-3 w-24 bg-surface-elevated/70 rounded animate-pulse" />
                <div className="h-14 w-64 bg-brand-950/30 border border-brand-800/40 rounded-lg animate-pulse" />
              </div>
              <div className="flex flex-col items-start space-y-1.5 me-auto max-w-lg">
                <div className="h-3 w-28 bg-surface-elevated/70 rounded animate-pulse" />
                <div className="h-20 w-80 bg-surface-elevated/50 border border-border/60 rounded-lg animate-pulse" />
              </div>
              <div className="flex flex-col items-end space-y-1.5 ms-auto max-w-md">
                <div className="h-3 w-20 bg-surface-elevated/70 rounded animate-pulse" />
                <div className="h-10 w-48 bg-brand-950/30 border border-brand-800/40 rounded-lg animate-pulse" />
              </div>
              <div className="text-center text-xs text-slate-400 font-mono py-4">
                {t('conversations.loadingTranscript')}
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-12 text-center text-slate-400 font-mono space-y-2">
              <AlertCircle className="h-8 w-8 mx-auto text-slate-500" />
              <p>{t('conversations.noMessages')}</p>
            </div>
          ) : (
            <>
              {/* Load Older Messages Button */}
              {hasMoreOlder && (
                <div className="text-center py-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={externalLoadOlder || handleLoadOlder}
                    disabled={isLoadingOlder}
                    className="h-8 text-xs font-mono bg-surface-elevated/50 border-dashed border-border hover:bg-surface-elevated"
                  >
                    {isLoadingOlder ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 me-1.5 animate-spin text-brand-400" />
                        {t('conversations.loadingOlder')}
                      </>
                    ) : (
                      <>
                        <ChevronUp className="h-3.5 w-3.5 me-1 text-slate-400" />
                        {t('conversations.loadOlder', { count: String(remainingOlderCount) })}
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Messages Feed */}
              {messages.map((msg, index) => {
                const rawRole = (msg.role || msg.senderRole || '').toLowerCase();
                const rawSender = (msg.sender || msg.senderName || '').toLowerCase();
                const isUser =
                  rawRole === 'user' ||
                  rawSender === 'user' ||
                  rawSender.includes('whatsapp') ||
                  rawSender.includes('user');

                const isSystem = rawRole === 'system';
                const isSemanticCache =
                  msg.source === 'semantic-cache' ||
                  msg.model === 'semantic-cache' ||
                  msg.metadata?.source === 'semantic-cache';

                const textContent = msg.content || msg.text || '';
                const timestamp = msg.createdAt || msg.timestamp;

                // Rich assistant metadata
                const meta = msg.metadata || {};
                const modelName = isSemanticCache ? null : (msg.model || meta.model || null);
                const tokensUsed = isSemanticCache ? 0 : (msg.tokens ?? meta.tokens ?? null);
                const latencyMs = msg.latencyMs ?? meta.latencyMs ?? null;
                const toolsList =
                  meta.tools ||
                  (msg.toolsUsed
                    ? msg.toolsUsed.split(',').map((s) => s.trim()).filter(Boolean)
                    : undefined);
                const toolCallsList = msg.toolCalls || meta.toolCalls || [];

                // System / Confirmation / Internal Workflow Event
                if (isSystem) {
                  return (
                    <div key={msg.id || index} className="flex justify-center my-3">
                      <div className="px-3.5 py-2 rounded-lg bg-surface-elevated/40 border border-border/70 text-slate-400 text-[11px] flex items-center gap-2 max-w-md">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">{textContent}</span>
                        <span className="text-[10px] text-slate-500 ms-auto shrink-0">{formatDate(timestamp)}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id || index}
                    className={cn(
                      'flex flex-col group',
                      isUser ? 'items-end ms-auto max-w-[85%] sm:max-w-[75%]' : 'items-start me-auto max-w-[90%] sm:max-w-[82%]'
                    )}
                  >
                    {/* Message Header (Sender & Timestamp) */}
                    <div
                      className={cn(
                        'flex items-center gap-1.5 text-[11px] px-1 mb-1 font-mono',
                        isUser ? 'text-slate-400 flex-row-reverse' : 'text-slate-400'
                      )}
                    >
                      {isUser ? (
                        <>
                          <span className="font-semibold text-slate-200 flex items-center gap-1">
                            <User className="h-3 w-3 text-emerald-400" />
                            {msg.sender || 'WhatsApp User'}
                          </span>
                          <span className="text-slate-500">•</span>
                          <span className="text-[10px] text-slate-400">{formatDate(timestamp)}</span>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold text-brand-300 flex items-center gap-1">
                            <Bot className="h-3.5 w-3.5 text-brand-400" />
                            Craft
                          </span>

                          {/* Semantic Cache Source Badge */}
                          {isSemanticCache && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-950/50 border border-amber-800 text-amber-300">
                              <Sparkles className="h-2.5 w-2.5 text-amber-400" />
                              {t('conversations.semanticCacheBadge')}
                            </span>
                          )}

                          <span className="text-slate-500">•</span>
                          <span className="text-[10px] text-slate-400">{formatDate(timestamp)}</span>
                        </>
                      )}

                      {/* Copy message button on hover */}
                      <button
                        onClick={() => handleCopy(msg.id || String(index), textContent)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-slate-200 transition-opacity"
                        title="Copy text"
                      >
                        {copiedId === (msg.id || String(index)) ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>

                    {/* Speech Bubble */}
                    <div
                      className={cn(
                        'p-4 rounded-xl border leading-relaxed break-words whitespace-pre-wrap transition-shadow',
                        isUser
                          ? 'bg-brand-950/40 border-brand-800/60 text-slate-100 rounded-se-none shadow-xs'
                          : 'bg-surface-elevated/90 border-slate-800/90 text-slate-200 rounded-ss-none shadow-sm'
                      )}
                    >
                      {/* Message Content */}
                      <div className="text-[12px] font-sans antialiased leading-relaxed">
                        {renderHighlightedText(textContent)}
                      </div>

                      {/* ========================================================= */}
                      {/* Assistant Response Metadata Row                           */}
                      {/* ========================================================= */}
                      {!isUser && (
                        <div className="mt-3 pt-2.5 border-t border-border/60 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                          {/* Model Badge */}
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border text-slate-300">
                            <span className="text-slate-500">Model:</span>
                            <span className="text-slate-200 font-semibold">{modelName || '—'}</span>
                          </div>

                          {/* Tokens Badge */}
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border text-slate-300">
                            <span className="text-slate-500">Tokens:</span>
                            <span className="text-slate-200 font-semibold">
                              {tokensUsed !== null ? formatNumber(tokensUsed) : '—'}
                            </span>
                          </div>

                          {/* Latency Badge */}
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border text-slate-300">
                            <Zap className="h-3 w-3 text-amber-400" />
                            <span className="text-slate-200 font-semibold">
                              {latencyMs !== null ? `${(latencyMs / 1000).toFixed(2)}s` : '—'}
                            </span>
                          </div>

                          {/* Tools Badges (Clickable to inspect details) */}
                          {toolsList && toolsList.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              {toolsList.map((toolName, tIdx) => {
                                const matchedTc = toolCallsList.find((tc) => tc.toolName === toolName);
                                const isExpanded = matchedTc && expandedToolId === matchedTc.id;

                                return (
                                  <button
                                    key={tIdx}
                                    onClick={() => {
                                      if (matchedTc) {
                                        setExpandedToolId(isExpanded ? null : matchedTc.id);
                                      }
                                    }}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors',
                                      matchedTc
                                        ? 'bg-purple-950/60 border-purple-800 text-purple-300 hover:bg-purple-900/60 cursor-pointer'
                                        : 'bg-surface border-border text-slate-400'
                                    )}
                                    title={matchedTc ? 'Click to inspect tool execution' : undefined}
                                  >
                                    <Wrench className="h-2.5 w-2.5 text-purple-400" />
                                    <span>{toolName}</span>
                                    {matchedTc && (
                                      isExpanded ? <ChevronUp className="h-2.5 w-2.5 ms-0.5" /> : <ChevronDown className="h-2.5 w-2.5 ms-0.5" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tool Execution Details Expandable Drawer/Card */}
                      {!isUser && toolCallsList.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {toolCallsList.map((tc) => {
                            if (expandedToolId !== tc.id) return null;
                            return (
                              <div
                                key={tc.id}
                                className="p-3 rounded-lg bg-surface/90 border border-purple-800/80 text-[11px] font-mono space-y-2 animate-in fade-in duration-150"
                              >
                                <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                                  <span className="font-bold text-purple-300 flex items-center gap-1.5">
                                    <Wrench className="h-3 w-3 text-purple-400" />
                                    {tc.toolName}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <StatusPill status={tc.status} />
                                    {tc.durationMs !== undefined && (
                                      <span className="text-[10px] text-slate-400">{tc.durationMs}ms</span>
                                    )}
                                  </div>
                                </div>

                                {/* Arguments */}
                                <div>
                                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                                    {t('conversations.toolInput')}
                                  </span>
                                  <pre className="p-2 rounded bg-background/80 border border-border text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-36">
                                    {JSON.stringify(tc.arguments, null, 2)}
                                  </pre>
                                </div>

                                {/* Results */}
                                {tc.result && (
                                  <div>
                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                                      {t('conversations.toolOutput')}
                                    </span>
                                    <pre className="p-2 rounded bg-background/80 border border-border text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-40">
                                      {JSON.stringify(tc.result, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div ref={bottomRef} className="h-1" />
            </>
          )}
        </div>

        {/* ========================================================= */}
        {/* 3. Floating "Jump to Latest" Button                       */}
        {/* ========================================================= */}
        {isScrolledUp && (
          <div className="absolute bottom-6 end-8 z-10 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <Button
              onClick={scrollToBottom}
              variant="outline"
              size="sm"
              className="shadow-lg font-mono text-xs bg-surface-elevated/95 border-brand-500/80 text-brand-300 hover:bg-brand-950 hover:text-white"
            >
              <ArrowDown className="h-3.5 w-3.5 me-1.5 animate-bounce" />
              {t('conversations.jumpToLatest')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
