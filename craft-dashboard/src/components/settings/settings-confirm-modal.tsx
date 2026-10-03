'use client';

import React, { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { useAuth } from '@/lib/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ShieldAlert, X, Check, ArrowRight, Lock } from 'lucide-react';

export interface PendingSettingDiff {
  key: string;
  label: string;
  previousValue: string | boolean | number;
  newValue: string | boolean | number;
  impact: string;
}

interface SettingsConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  diffs: PendingSettingDiff[];
  isPending: boolean;
}

export function SettingsConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  diffs,
  isPending,
}: SettingsConfirmModalProps) {
  const { t } = useLanguage();
  const { user, role } = useAuth();
  const [acknowledged, setAcknowledged] = useState(false);

  if (!isOpen) return null;

  const actorName = user?.actorName || 'admin';
  const roleName = (role || 'admin').toUpperCase();

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!acknowledged || isPending) return;
    onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-2xl bg-surface border border-border rounded-xl shadow-2xl overflow-hidden font-mono flex flex-col max-h-[90vh]">
        {/* 1. Modal Header */}
        <div className="p-4 sm:p-5 border-b border-border bg-surface-elevated/70 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold shrink-0">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-foreground tracking-tight" id="confirm-modal-title">
                {t('settings.confirmModalTitle')}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('settings.confirmModalSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="p-1 rounded-md text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 2. Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs">
          {/* Warning Banner */}
          <div className="flex items-start gap-3 p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="space-y-1">
              <span className="font-bold block">{t('settings.confirmWarningTitle')}</span>
              <p className="text-[11px] text-amber-200/90 leading-relaxed font-sans">
                {t('settings.confirmWarningDesc')}
              </p>
            </div>
          </div>

          {/* Diffs Table */}
          <div className="space-y-2">
            <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px] block">
              {t('settings.confirmWhatWillChange')} ({diffs.length})
            </span>
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-start text-[11px]">
                  <thead className="bg-surface-elevated/70 border-b border-border text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="p-2.5 text-start font-semibold">{t('settings.colSetting')}</th>
                      <th className="p-2.5 text-start font-semibold">{t('settings.colCurrentVal')}</th>
                      <th className="p-2.5 text-start font-semibold">{t('settings.colProposedVal')}</th>
                      <th className="p-2.5 text-start font-semibold">{t('settings.colImpact')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {diffs.map((diff) => (
                      <tr key={diff.key} className="hover:bg-surface-elevated/30 transition-colors">
                        <td className="p-2.5 font-bold text-foreground">{diff.label}</td>
                        <td className="p-2.5 text-slate-400 font-mono" dir="ltr">
                          {typeof diff.previousValue === 'boolean'
                            ? diff.previousValue
                              ? t('settings.enabled')
                              : t('settings.disabled')
                            : String(diff.previousValue)}
                        </td>
                        <td className="p-2.5 font-mono text-brand-400 font-semibold flex items-center gap-1.5" dir="ltr">
                          <ArrowRight className="h-3 w-3 rtl:rotate-180 shrink-0 text-slate-500" />
                          <span>
                            {typeof diff.newValue === 'boolean'
                              ? diff.newValue
                                ? t('settings.enabled')
                                : t('settings.disabled')
                              : String(diff.newValue)}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-300 font-sans text-[11px] leading-tight">
                          {diff.impact}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Actor & Authority Card */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
            <span className="text-slate-400 font-semibold">{t('settings.confirmActorLabel')}:</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">{actorName}</span>
              <Badge variant="purple" className="text-[10px] uppercase font-mono">
                {roleName}
              </Badge>
            </div>
          </div>

          {/* Operator Acknowledgment Checkbox */}
          <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/60">
            <label className="flex items-start gap-3 cursor-pointer select-none text-slate-200">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={isPending}
                className="mt-0.5 h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-brand-500 focus:ring-offset-0 cursor-pointer disabled:opacity-50"
              />
              <span className="text-[11px] font-mono leading-relaxed text-slate-300">
                {t('settings.confirmAcknowledgment')}
              </span>
            </label>
          </div>
        </div>

        {/* 3. Modal Actions Footer */}
        <div className="p-4 sm:p-5 border-t border-border bg-surface-elevated/70 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Lock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{t('settings.zeroSecretNotice')}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPending}
            >
              {t('settings.btnDiscard')}
            </Button>

            <Button
              type="button"
              variant="brand"
              size="sm"
              onClick={handleConfirmSubmit}
              disabled={!acknowledged || isPending}
              isLoading={isPending}
            >
              <Check className="h-3.5 w-3.5 me-1.5" />
              {t('settings.btnConfirmSubmit')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
