'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, ShieldCheck, EyeOff, Filter } from 'lucide-react';

interface SearchPolicySectionProps {
  searchConfigured?: boolean;
  searchEnabled?: boolean;
}

export function SearchPolicySection({ searchConfigured = true, searchEnabled = true }: SearchPolicySectionProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-6 font-mono text-xs">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Search className="h-4 w-4 text-cyan-400" />
            <span>{t('settings.searchPolicyTitle')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            {t('settings.searchPolicyDesc')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">Search Engine Provider</span>
              <span className="font-bold text-foreground">Tavily Search</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">Integration Credential Status</span>
              <span className="font-bold text-emerald-400">
                {searchConfigured ? t('settings.badgeConfigured') : t('settings.badgeMissing')}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">Runtime Tool Invocations</span>
              <span className={`font-bold ${searchEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                {searchEnabled ? t('settings.enabled') : t('settings.disabled')}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">Search Freshness Policy</span>
              <span className="font-bold text-foreground">Real-time / Dynamic</span>
            </div>
          </div>

          {/* Core Architectural Presentation Rules */}
          <div className="space-y-3 pt-2">
            <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 space-y-1.5">
              <div className="flex items-center gap-2 text-foreground font-bold">
                <EyeOff className="h-4 w-4 text-brand-400 shrink-0" />
                <span>{t('settings.sourcePresentationRule')}</span>
              </div>
              <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                {t('settings.sourcePresentationDetail')}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 space-y-1.5">
              <div className="flex items-center gap-2 text-foreground font-bold">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>{t('settings.rawResultsGuard')}</span>
              </div>
              <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                {t('settings.rawResultsDetail')}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 space-y-1.5">
              <div className="flex items-center gap-2 text-foreground font-bold">
                <Filter className="h-4 w-4 text-purple-400 shrink-0" />
                <span>{t('settings.snippetsRule')}</span>
              </div>
              <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                {t('settings.snippetsDetail')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
