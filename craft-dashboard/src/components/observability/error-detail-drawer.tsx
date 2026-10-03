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
  AlertTriangle,
  Layers,
  ExternalLink,
  ShieldAlert,
  Clock,
  Activity,
} from 'lucide-react';
import {
  formatDate,
  formatLatency,
  safeJsonStringify,
  sanitizeSafeErrorDetails,
  sanitizeSafeMetadata,
} from '@/lib/utils';

export interface OperationalErrorRecord {
  id: string;
  timestamp: string;
  service: 'agent' | 'tools' | 'admin';
  severity: 'high' | 'medium' | 'low';
  errorType: string;
  errorMessage: string;
  correlationId?: string;
  runId?: string;
  toolCallId?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface ErrorDetailDrawerProps {
  errorItem: OperationalErrorRecord | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ErrorDetailDrawer({ errorItem, isOpen, onClose }: ErrorDetailDrawerProps) {
  const { t, formatRelativeTime } = useLanguage();
  const [copiedId, setCopiedId] = useState(false);
  const [copiedCorrelation, setCopiedCorrelation] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopy = (text: string, type: 'id' | 'correlation') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (type === 'id') {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      } else {
        setCopiedCorrelation(true);
        setTimeout(() => setCopiedCorrelation(false), 2000);
      }
    }
  };

  if (!isOpen || !errorItem) return null;

  // Defensive sanitization: eliminate secrets, tokens, DB URLs, system prompts, CoT
  const sanitizedMessage = sanitizeSafeErrorDetails(errorItem.errorMessage || 'Unknown error');
  const sanitizedMetadata = errorItem.metadata ? sanitizeSafeMetadata(errorItem.metadata) : null;

  const serviceLabel =
    errorItem.service === 'agent'
      ? t('observability.serviceAgent')
      : errorItem.service === 'tools'
      ? t('observability.serviceTools')
      : t('observability.serviceAdmin');

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-detail-title"
    >
      <div className="w-full h-full max-w-xl bg-surface border-s border-border flex flex-col shadow-2xl animate-in slide-in-from-right rtl:slide-in-from-left duration-200 overflow-hidden font-mono">
        {/* 1. Header Bar */}
        <div className="p-4 sm:p-5 border-b border-border bg-surface-elevated/70 shrink-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 font-bold shrink-0">
                <ShieldAlert className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    {t('observability.errorDrawerTitle')}
                  </span>
                  <StatusBadge status="failure" size="xs" showDot={true} />
                  {errorItem.durationMs !== undefined && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-surface border border-border text-cyan-400 font-semibold" dir="ltr">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatLatency(errorItem.durationMs)}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="purple" className="text-[10px] uppercase font-mono">
                    {serviceLabel}
                  </Badge>
                  <span className="font-bold text-sm text-rose-400 font-mono truncate" id="error-detail-title">
                    {errorItem.errorType}
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

        {/* 2. Scrollable Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs bg-background/50 font-mono">
          {/* Sanitized Error Diagnostic Message */}
          <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-2">
            <div className="flex items-center justify-between text-rose-400 font-bold text-xs pb-1.5 border-b border-rose-500/20">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{t('observability.sanitizedError')}</span>
              </span>
              <span className="text-[10px] text-rose-300 uppercase px-1.5 py-0.5 rounded bg-rose-500/20">
                {(errorItem.severity || 'error').toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-rose-200 font-mono leading-relaxed bg-black/30 p-3 rounded border border-rose-500/20 whitespace-pre-wrap selection:bg-rose-500/30" dir="ltr">
              {sanitizedMessage}
            </p>
          </div>

          {/* Operational Identity & Target Links */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-foreground pb-2 border-b border-border/60">
              <span className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-cyan-400" />
                <span>Execution Details</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {errorItem.timestamp ? formatRelativeTime(errorItem.timestamp) : '—'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('observability.colService')}:
                </span>
                <span className="font-bold text-foreground">
                  {serviceLabel}
                </span>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('observability.errorCode')}:
                </span>
                <span className="font-mono text-slate-300">
                  {errorItem.errorType}
                </span>
              </div>

              <div className="col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                    Record ID:
                  </span>
                  <button
                    onClick={() => handleCopy(errorItem.id, 'id')}
                    className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-foreground transition-colors font-mono"
                  >
                    {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedId ? 'Copied!' : 'Copy ID'}</span>
                  </button>
                </div>
                <p className="font-mono text-xs text-foreground bg-surface-elevated/40 p-1.5 rounded border border-border/50 truncate" dir="ltr">
                  {errorItem.id}
                </p>
              </div>

              <div className="col-span-2">
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  Timestamp:
                </span>
                <span className="text-slate-300 font-sans text-xs">
                  {formatDate(errorItem.timestamp)}
                </span>
              </div>
            </div>
          </div>

          {/* Cross-Navigation Links */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-2.5">
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              Correlated Observability Views
            </span>

            <div className="flex flex-wrap gap-2">
              {errorItem.runId && (
                <Link
                  href={`/agent-runs?runId=${encodeURIComponent(errorItem.runId)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/30 text-brand-400 text-xs font-semibold transition-colors"
                >
                  <span>{t('observability.openAgentRun')}</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}

              {errorItem.toolCallId && (
                <Link
                  href={`/tools?toolCallId=${encodeURIComponent(errorItem.toolCallId)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-semibold transition-colors"
                >
                  <span>{t('observability.openToolCall')}</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}

              {errorItem.correlationId && (
                <Link
                  href={`/audit`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors"
                >
                  <span>{t('observability.openAudit')}</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>

          {/* Correlation ID Box */}
          {errorItem.correlationId && (
            <div className="p-3.5 rounded-lg bg-surface border border-border space-y-2.5">
              <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1.5 border-b border-border/50">
                <span className="flex items-center gap-1.5 font-bold text-foreground">
                  <Layers className="h-3.5 w-3.5 text-purple-400" />
                  <span>Correlation ID</span>
                </span>
                <button
                  onClick={() => handleCopy(errorItem.correlationId || '', 'correlation')}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-foreground transition-colors font-mono"
                >
                  {copiedCorrelation ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedCorrelation ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>

              <div className="p-2 rounded bg-surface-elevated/40 border border-border/50">
                <span className="font-mono text-xs text-cyan-300 break-all select-all block" dir="ltr">
                  {errorItem.correlationId}
                </span>
              </div>
            </div>
          )}

          {/* Safe Metadata Preview */}
          {sanitizedMetadata && Object.keys(sanitizedMetadata).length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                {t('observability.safeMetadata')}
              </span>
              <div className="p-3.5 rounded-lg bg-surface border border-border overflow-x-auto max-h-60">
                <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed" dir="ltr">
                  {safeJsonStringify(sanitizedMetadata)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
