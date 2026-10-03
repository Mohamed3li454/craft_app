'use client';

import React from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flag, History, Shield, ArrowUpRight } from 'lucide-react';

export function FeatureFlagsSection() {
  const { t } = useLanguage();

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Feature Flags Governance */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Flag className="h-4 w-4 text-amber-400" />
            <span>{t('settings.tabFeatureFlags')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-amber-400 border-amber-500/30 bg-amber-500/10">
            {t('settings.badgeNotExposed')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-surface-elevated/40 border border-border text-slate-300 font-sans text-xs">
            <Shield className="h-5 w-5 text-amber-400 shrink-0" />
            <p className="leading-relaxed">
              {t('settings.featureFlagsNotice')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 2. Configuration Rollback Governance */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <History className="h-4 w-4 text-purple-400" />
            <span>Configuration Versioning & Rollback</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-purple-400 border-purple-500/30 bg-purple-500/10">
            {t('settings.badgeNotExposed')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex items-start justify-between gap-4 p-4 rounded-lg bg-surface-elevated/40 border border-border">
            <div className="space-y-1 font-sans text-xs text-slate-300 max-w-xl">
              <span className="font-bold text-foreground font-mono block">Immutable Audit Alignment</span>
              <p className="leading-relaxed">
                {t('settings.rollbackNotice')}
              </p>
            </div>

            <Link href="/audit">
              <Button variant="outline" size="sm" className="font-mono text-xs shrink-0">
                <span>{t('settings.btnViewAudit')}</span>
                <ArrowUpRight className="h-3.5 w-3.5 ms-1 rtl:rotate-270" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
