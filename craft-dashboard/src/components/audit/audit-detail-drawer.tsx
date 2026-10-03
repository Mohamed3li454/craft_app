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
  ShieldCheck,
  Lock,
  Layers,
  ExternalLink,
  AlertTriangle,
  User,
  Activity,
} from 'lucide-react';
import {
  formatDate,
  safeJsonStringify,
  sanitizeSafeMetadata,
  sanitizeSafeString,
} from '@/lib/utils';
import { AdminAuditItem } from '@/types/admin';

export interface AuditDetailDrawerProps {
  auditItem: AdminAuditItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AuditDetailDrawer({ auditItem, isOpen, onClose }: AuditDetailDrawerProps) {
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

  if (!isOpen || !auditItem) return null;

  const actorName = auditItem.adminActor || auditItem.actorId || (auditItem as any).actor || 'system';
  const actorRole = auditItem.actorRole || 'admin';
  const statusOutcome = (auditItem.status || 'success').toLowerCase();
  const isSuccess = statusOutcome === 'success';

  // Sanitized metadata preview (strictly eliminating secrets, DB URLs, CoT, etc.)
  const rawMetadata = auditItem.metadata || auditItem.details;
  const sanitizedMetadata = rawMetadata ? sanitizeSafeMetadata(rawMetadata) : null;
  const sanitizedErrorMessage = auditItem.errorMessage
    ? sanitizeSafeString(auditItem.errorMessage)
    : null;

  // Determine smart resource cross-navigation target
  const resType = (auditItem.resourceType || '').toLowerCase();
  const resId = auditItem.resourceId;

  let crossNavLink: { href: string; label: string } | null = null;
  if (resType.includes('user') && resId) {
    crossNavLink = { href: `/users?search=${encodeURIComponent(resId)}`, label: t('audit.viewResource') };
  } else if (resType.includes('conversation') && resId) {
    crossNavLink = { href: `/conversations?conversationId=${encodeURIComponent(resId)}`, label: t('audit.viewResource') };
  } else if ((resType.includes('run') || resType.includes('agent')) && resId) {
    crossNavLink = { href: `/agent-runs?runId=${encodeURIComponent(resId)}`, label: t('audit.viewResource') };
  } else if (resType.includes('tool') && resId) {
    crossNavLink = { href: `/tools?toolCallId=${encodeURIComponent(resId)}`, label: t('audit.viewResource') };
  } else if (resType.includes('setting')) {
    crossNavLink = { href: '/settings', label: t('audit.viewResource') };
  } else if (resType.includes('reminder')) {
    crossNavLink = { href: '/reminders', label: t('audit.viewResource') };
  } else if (resType.includes('memory') || resType.includes('cache')) {
    crossNavLink = { href: '/memory', label: t('audit.viewResource') };
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-detail-title"
    >
      <div className="w-full h-full max-w-xl bg-surface border-s border-border flex flex-col shadow-2xl animate-in slide-in-from-right rtl:slide-in-from-left duration-200 overflow-hidden font-mono">
        {/* 1. Header Bar */}
        <div className="p-4 sm:p-5 border-b border-border bg-surface-elevated/70 shrink-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    {t('audit.drawerTitle')}
                  </span>
                  <StatusBadge status={isSuccess ? 'success' : 'error'} size="xs" showDot={true} />
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <span className="font-bold text-base text-foreground font-mono truncate" id="audit-detail-title">
                    {auditItem.action}
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

          {/* Cryptographic Immutability Notice */}
          <div className="flex items-center gap-2 p-2 rounded bg-surface/80 border border-border/80 text-[11px] text-slate-400 leading-tight">
            <Lock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>{t('audit.readOnlyComplianceNotice')}</span>
          </div>
        </div>

        {/* 2. Scrollable Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs bg-background/50 font-mono">
          {/* Identity & Origin Card */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-foreground pb-2 border-b border-border/60">
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-brand-400" />
                <span>{t('audit.identitySection')}</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {auditItem.createdAt ? formatRelativeTime(auditItem.createdAt) : '—'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('audit.colActor')}:
                </span>
                <span className="font-bold text-foreground truncate block">
                  {actorName}
                </span>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('common.role')}:
                </span>
                <Badge variant="purple" className="text-[10px] uppercase font-mono">
                  {actorRole}
                </Badge>
              </div>

              <div className="col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                    {t('common.id')}:
                  </span>
                  <button
                    onClick={() => handleCopy(auditItem.id, 'id')}
                    className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-foreground transition-colors font-mono"
                  >
                    {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedId ? t('audit.idCopied') : t('audit.copyId')}</span>
                  </button>
                </div>
                <p className="font-mono text-xs text-foreground bg-surface-elevated/40 p-1.5 rounded border border-border/50 truncate" dir="ltr">
                  {auditItem.id}
                </p>
              </div>

              <div className="col-span-2">
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('audit.colTimestamp')}:
                </span>
                <span className="text-slate-300 font-sans text-xs">
                  {formatDate(auditItem.createdAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Action & Resource Card */}
          <div className="p-3.5 rounded-lg bg-surface border border-border space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-foreground pb-2 border-b border-border/60">
              <span className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-cyan-400" />
                <span>{t('audit.actionSection')}</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {auditItem.resourceType}
              </span>
            </div>

            <div className="space-y-2.5 text-[11px]">
              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('audit.colAction')}:
                </span>
                <span className="font-bold text-brand-300 font-mono text-xs">
                  {auditItem.action}
                </span>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('audit.targetResource')}:
                </span>
                <div className="flex items-center justify-between gap-2 p-2 rounded bg-surface-elevated/40 border border-border/50">
                  <span className="font-mono text-xs text-foreground truncate" dir="ltr">
                    {auditItem.resourceType}: <strong className="text-brand-400">{auditItem.resourceId || 'global'}</strong>
                  </span>
                  {crossNavLink && (
                    <Link
                      href={crossNavLink.href}
                      className="inline-flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 underline font-semibold shrink-0"
                    >
                      <span>{crossNavLink.label}</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] block mb-0.5">
                  {t('audit.colResult')}:
                </span>
                <StatusBadge status={isSuccess ? 'success' : 'failure'} size="sm" />
              </div>
            </div>
          </div>

          {/* Failure Diagnostics (if status is failure) */}
          {sanitizedErrorMessage && (
            <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-2">
              <div className="flex items-center gap-1.5 text-rose-400 font-bold text-xs">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{t('common.error')}</span>
              </div>
              <p className="text-xs text-rose-300 font-mono leading-relaxed bg-black/20 p-2.5 rounded border border-rose-500/20">
                {sanitizedErrorMessage}
              </p>
            </div>
          )}

          {/* Correlation & Trace Links Card */}
          {auditItem.correlationId && (
            <div className="p-3.5 rounded-lg bg-surface border border-border space-y-2.5">
              <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1.5 border-b border-border/50">
                <span className="flex items-center gap-1.5 font-bold text-foreground">
                  <Layers className="h-3.5 w-3.5 text-purple-400" />
                  <span>{t('audit.correlationSection')}</span>
                </span>
                <button
                  onClick={() => handleCopy(auditItem.correlationId || '', 'correlation')}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-foreground transition-colors font-mono"
                >
                  {copiedCorrelation ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedCorrelation ? t('audit.correlationCopied') : t('audit.copyCorrelationId')}</span>
                </button>
              </div>

              <div className="p-2 rounded bg-surface-elevated/40 border border-border/50">
                <span className="font-mono text-xs text-cyan-300 break-all select-all block" dir="ltr">
                  {auditItem.correlationId}
                </span>
              </div>
            </div>
          )}

          {/* Sanitized Mutation Metadata */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>{t('audit.sanitizedMetadata')}</span>
            </span>
            <div className="p-3.5 rounded-lg bg-surface border border-border overflow-x-auto max-h-72">
              <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed" dir="ltr">
                {sanitizedMetadata ? safeJsonStringify(sanitizedMetadata) : '{}'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
