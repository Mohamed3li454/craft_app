'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { useAuth } from '@/lib/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Sliders, UserCheck } from 'lucide-react';

export function GovernanceHeader() {
  const { t } = useLanguage();
  const { user, role, canManageSettings } = useAuth();

  const actorName = user?.actorName || 'admin';
  const roleName = (role || 'viewer').toUpperCase();

  return (
    <div className="space-y-4">
      {/* 1. Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-brand-500/10 border border-brand-500/25 text-brand-400">
              <Sliders className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
              {t('settings.governanceTitle')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
            {t('settings.governanceSubtitle')}
          </p>
        </div>

        {/* Operator Identity Context */}
        <div className="flex items-center gap-3 self-start sm:self-auto p-2.5 rounded-lg border border-border bg-surface-elevated/40 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-slate-400">
            <UserCheck className="h-4 w-4 text-brand-400 shrink-0" />
            <span className="text-[11px] uppercase tracking-wider">{t('settings.operatorRoleLabel')}:</span>
          </div>
          <span className="font-bold text-foreground">{actorName}</span>
          <Badge variant="purple" className="text-[10px] uppercase font-mono">
            {roleName}
          </Badge>
          <span
            className={`text-[10px] px-2 py-0.5 rounded font-mono ${
              canManageSettings
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
            }`}
          >
            {canManageSettings ? t('settings.operatorFullAccess') : t('settings.operatorReadOnlyAccess')}
          </span>
        </div>
      </div>

      {/* 2. Zero Secret Disclosure Guarantee Banner */}
      <div className="flex items-center gap-2.5 p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-mono leading-relaxed">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>{t('settings.securityGuarantee')}</span>
      </div>
    </div>
  );
}
