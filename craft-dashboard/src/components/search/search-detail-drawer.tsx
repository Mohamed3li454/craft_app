'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/language-context';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import {
  X,
  Copy,
  Check,
  Search,
  Clock,
  ExternalLink,
  Globe,
  Layers,
  Wrench,
  ShieldCheck,
} from 'lucide-react';
import {
  formatDate,
  formatLatency,
  sanitizeSafeString,
} from '@/lib/utils';
import { AdminSearchItem } from '@/types/admin';

export interface SearchDetailDrawerProps {
  searchItem: AdminSearchItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SearchDetailDrawer({ searchItem, isOpen, onClose }: SearchDetailDrawerProps) {
  const { t, formatRelativeTime } = useLanguage();
  const [copiedQuery, setCopiedQuery] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopy = (text: string, type: 'query' | 'id') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (type === 'query') {
        setCopiedQuery(true);
        setTimeout(() => setCopiedQuery(false), 2000);
      } else {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      }
    }
  };

  if (!isOpen || !searchItem) return null;

  const sanitizedQuery = sanitizeSafeString(searchItem.query || '');
  const sourcesCount = searchItem.sourceCount ?? searchItem.resultCount ?? 0;
  const timestamp = searchItem.freshness || searchItem.createdAt;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-detail-title"
    >
      <div className="w-full h-full max-w-xl bg-surface border-s border-border flex flex-col shadow-2xl animate-in slide-in-from-right rtl:slide-in-from-left duration-200 overflow-hidden font-mono">
        {/* 1. Header & Identity Bar */}
        <div className="p-4 sm:p-5 border-b border-border bg-surface-elevated/70 shrink-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold shrink-0">
                <Globe className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    {t('search.drawerTitle')}
                  </span>
                  <StatusBadge status={searchItem.status || 'success'} size="xs" showDot={true} />
                  {searchItem.latencyMs !== undefined && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-surface border border-border text-cyan-400 font-semibold" dir="ltr">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatLatency(searchItem.latencyMs)}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="purple" className="text-[10px] uppercase font-mono">
                    {searchItem.provider || 'default'}
                  </Badge>
                  <span className="text-slate-400 text-xs">
                    {t('search.sourcesCount', { count: String(sourcesCount) })}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 rounded-md text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 2. Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs bg-background/50 font-mono">
          {/* Query Inspection Box */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-2">
            <div className="flex items-center justify-between text-slate-500 text-[10px] uppercase font-semibold">
              <span className="flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 text-brand-400" />
                <span>{t('search.colQuery')}</span>
              </span>
              <button
                onClick={() => handleCopy(sanitizedQuery, 'query')}
                className="inline-flex items-center gap-1 text-slate-400 hover:text-foreground transition-colors font-mono"
              >
                {copiedQuery ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiedQuery ? t('search.queryCopied') : t('search.copyQuery')}</span>
              </button>
            </div>
            <p className="text-sm font-sans font-semibold text-foreground p-3 rounded bg-surface-elevated/40 border border-border/50 leading-relaxed selection:bg-brand-500/20">
              {sanitizedQuery}
            </p>
          </div>

          {/* Operational Metadata */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-foreground pb-2 border-b border-border/60">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-cyan-400" />
                <span>Telemetry Signals</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {timestamp ? formatRelativeTime(timestamp) : '—'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('search.colProvider')}:
                </span>
                <span className="font-bold text-brand-300 uppercase">
                  {searchItem.provider || 'direct'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('search.colDuration')}:
                </span>
                <span className="font-bold text-cyan-400" dir="ltr">
                  {formatLatency(searchItem.latencyMs)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('search.colSources')}:
                </span>
                <span className="text-foreground font-semibold">
                  {sourcesCount}
                </span>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('search.colFreshness')}:
                </span>
                <span className="text-foreground">
                  {timestamp ? formatDate(timestamp) : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Cross-Navigation: Correlated Tool Call */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-2.5">
            <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1.5 border-b border-border/50">
              <span className="flex items-center gap-1.5 font-bold text-foreground">
                <Wrench className="h-3.5 w-3.5 text-purple-400" />
                <span>{t('search.searchToToolCorrelation')}</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">web_search</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Every real-time web search execution is dispatched as an autonomous agent tool invocation. You can inspect raw arguments and execution parameters in Tool Telemetry.
            </p>

            <div className="pt-1 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-500">ID:</span>
                <span className="text-foreground font-mono truncate max-w-[160px]" dir="ltr">
                  {searchItem.id}
                </span>
                <button
                  onClick={() => handleCopy(searchItem.id, 'id')}
                  className="p-1 rounded text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
                  title="Copy Tool Call ID"
                >
                  {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>

              <Link
                href={`/tools?toolCallId=${encodeURIComponent(searchItem.id)}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-medium transition-colors"
              >
                <span>{t('search.viewInToolTelemetry')}</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {/* Privacy & Safety Callout */}
          <div className="p-3 rounded-lg bg-surface-elevated/40 border border-border/60 text-[11px] text-slate-400 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Internal planner reasoning and Chain-of-Thought (CoT) traces are redacted by security policy. Operational timing and provider metrics remain observable.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
