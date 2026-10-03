'use client';

import React from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/language-context';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ArrowUpRight, X } from 'lucide-react';

interface AuditConfirmationBannerProps {
  actor: string;
  onDismiss: () => void;
}

export function AuditConfirmationBanner({ actor, onDismiss }: AuditConfirmationBannerProps) {
  const { t } = useLanguage();

  return (
    <div
      className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-mono text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-in slide-in-from-top-2 duration-200"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <span className="font-bold text-foreground block text-sm">
            {t('settings.auditBannerTitle')}
          </span>
          <p className="text-[11px] text-emerald-200/90 font-sans leading-relaxed">
            {t('settings.auditBannerDesc').replace('{actor}', actor)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        <Link href="/audit?action=UPDATE_RUNTIME_SETTINGS">
          <Button
            variant="outline"
            size="sm"
            className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 font-mono text-xs h-8"
          >
            <span>{t('settings.btnViewAudit')}</span>
            <ArrowUpRight className="h-3.5 w-3.5 ms-1 rtl:rotate-270" />
          </Button>
        </Link>

        <button
          onClick={onDismiss}
          className="p-1.5 rounded-md text-emerald-400 hover:text-white hover:bg-emerald-500/20 transition-colors"
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
