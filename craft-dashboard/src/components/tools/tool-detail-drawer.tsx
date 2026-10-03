'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/language-context';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  X,
  Copy,
  Check,
  Wrench,
  Clock,
  ExternalLink,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import {
  formatDate,
  formatLatency,
  safeJsonStringify,
  sanitizeSafeErrorDetails,
} from '@/lib/utils';
import { AdminToolCallItem } from '@/types/admin';

export interface ToolDetailDrawerProps {
  toolCall: AdminToolCallItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ToolDetailDrawer({ toolCall, isOpen, onClose }: ToolDetailDrawerProps) {
  const { t, formatRelativeTime } = useLanguage();
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

  const handleCopyId = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  if (!isOpen || !toolCall) return null;

  const isFailed = toolCall.status === 'error' || toolCall.status === 'failed' || Boolean(toolCall.errorMessage);
  const durationMs = toolCall.durationMs;
  const runId = toolCall.runId || toolCall.agentRunId;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tool-detail-title"
    >
      <div className="w-full h-full max-w-2xl bg-surface border-s border-border flex flex-col shadow-2xl animate-in slide-in-from-right rtl:slide-in-from-left duration-200 overflow-hidden font-mono">
        {/* 1. Header & Identity Bar */}
        <div className="p-4 sm:p-5 border-b border-border bg-surface-elevated/70 shrink-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold shrink-0">
                <Wrench className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    {t('tools.drawerTitle')}
                  </span>
                  <StatusBadge status={toolCall.status} size="xs" showDot={true} />
                  {durationMs !== undefined && durationMs !== null && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-surface border border-border text-cyan-400 font-semibold" dir="ltr">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatLatency(durationMs)}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <h2
                    id="tool-detail-title"
                    className="text-base font-bold text-foreground font-mono truncate"
                    dir="ltr"
                  >
                    {toolCall.toolName}
                  </h2>
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label={t('tools.close')}
              className="p-1.5 rounded-md text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 2. Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs bg-background/50 font-mono">
          {/* Execution & Correlation Anchor */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-foreground pb-2 border-b border-border/60">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-brand-400" />
                <span>{t('tools.executionDetails')}</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {formatRelativeTime(toolCall.createdAt)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  Tool Call ID:
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-foreground truncate" dir="ltr">
                    {toolCall.id}
                  </span>
                  <button
                    onClick={() => handleCopyId(toolCall.id)}
                    className="p-1 rounded text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
                    title={t('tools.copyId')}
                    aria-label={t('tools.copyId')}
                  >
                    {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('tools.executedAt')}:
                </span>
                <span className="text-foreground">
                  {formatDate(toolCall.createdAt)}
                </span>
              </div>
            </div>

            {/* Correlation Link to Agent Run */}
            {runId && (
              <div className="pt-2 border-t border-border/50 flex items-center justify-between flex-wrap gap-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 text-[10px] uppercase">Agent Run:</span>
                  <span className="text-foreground font-mono" dir="ltr">
                    {runId}
                  </span>
                </div>

                <Link
                  href={`/agent-runs?runId=${encodeURIComponent(runId)}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/30 text-brand-400 text-xs font-medium transition-colors"
                >
                  <span>{t('tools.openAgentRun')}</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>

          {/* Failure Diagnostic (if error) */}
          {isFailed && (
            <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-200 space-y-2">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="h-4 w-4" />
                <span>{t('tools.errorDetails')}</span>
              </div>
              <p className="text-xs leading-relaxed font-mono bg-rose-950/60 p-2.5 rounded border border-rose-900/60 text-rose-100 whitespace-pre-wrap">
                {sanitizeSafeErrorDetails(toolCall.errorMessage) || t('tools.noError')}
              </p>
            </div>
          )}

          {/* Arguments Inspector */}
          <div className="space-y-1.5">
            <span className="text-slate-500 uppercase text-[10px] font-semibold block">
              {t('tools.sanitizedInput')}
            </span>
            <pre
              className="p-3 rounded-lg bg-surface-elevated border border-border/70 text-slate-200 overflow-x-auto text-[11px] leading-relaxed max-h-60"
              dir="ltr"
            >
              {safeJsonStringify(toolCall.arguments ?? toolCall.argumentsSanitized)}
            </pre>
          </div>

          {/* Result Inspector */}
          <div className="space-y-1.5">
            <span className="text-slate-500 uppercase text-[10px] font-semibold block">
              {t('tools.sanitizedOutput')}
            </span>
            <pre
              className="p-3 rounded-lg bg-surface-elevated border border-border/70 text-slate-200 overflow-x-auto text-[11px] leading-relaxed max-h-72"
              dir="ltr"
            >
              {safeJsonStringify(toolCall.result ?? toolCall.resultSanitized)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
