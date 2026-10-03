'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, Clock, Layers } from 'lucide-react';

interface MemoryPolicySectionProps {
  retentionDays?: number;
}

export function MemoryPolicySection({ retentionDays = 365 }: MemoryPolicySectionProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-6 font-mono text-xs">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Database className="h-4 w-4 text-emerald-400" />
            <span>{t('settings.memorySafetyTitle')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            {t('settings.memorySafetyDesc')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-brand-400" />
                <span>{t('settings.retentionDays')}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-foreground" dir="ltr">
                  {retentionDays} {t('settings.daysUnit')}
                </span>
                <Badge variant="default" className="text-[9px] uppercase font-mono">
                  {t('settings.badgeEditable')}
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">Vector Storage Engine</span>
              <span className="font-bold text-foreground font-mono">Supabase pgvector</span>
            </div>
          </div>

          {/* 3-Tier Lifecycle */}
          <div className="space-y-3 pt-2">
            <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px] block flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-purple-400" />
              <span>Multi-Tier Safety Gate Verification Lifecycle</span>
            </span>

            <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 space-y-1">
              <span className="font-bold text-slate-200 block text-[11px]">
                {t('settings.tier1Draft')}
              </span>
              <p className="text-[11px] text-slate-400 font-sans">
                Extracted during user interaction turns. Stored ephemerally with low confidence until cross-verified.
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 space-y-1">
              <span className="font-bold text-brand-400 block text-[11px]">
                {t('settings.tier2Candidate')}
              </span>
              <p className="text-[11px] text-slate-400 font-sans">
                Accumulated recurrence across multiple conversations. Pending operator confirmation or reinforcement.
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 space-y-1">
              <span className="font-bold text-emerald-400 block text-[11px]">
                {t('settings.tier3Fact')}
              </span>
              <p className="text-[11px] text-slate-400 font-sans">
                Immutable, high-confidence profile fact loaded into retrieval context for personalized assistant turns.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
