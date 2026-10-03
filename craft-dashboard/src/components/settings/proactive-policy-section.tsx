'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BellRing, ShieldAlert, MessageSquare, Clock } from 'lucide-react';

interface ProactivePolicySectionProps {
  proactiveEnabled?: boolean;
}

export function ProactivePolicySection({ proactiveEnabled = true }: ProactivePolicySectionProps) {
  const { t } = useLanguage();

  const guardrails = [
    'Do not interrupt the current answer.',
    'Do not repeat the unresolved issue unnecessarily.',
    'Do not force a reminder.',
    'Do not mention old topics after a topic switch.',
    'Do not claim that Craft will follow up later.',
    'Never promise autonomous future contact.',
  ];

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Proactive Policy Resolver & Confidence Gates */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <BellRing className="h-4 w-4 text-brand-400" />
            <span>{t('settings.proactivePolicyTitle')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            {t('settings.proactivePolicyDesc')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">Autonomous Engine Status</span>
              <span className={`font-bold ${proactiveEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                {proactiveEnabled ? t('settings.enabled') : t('settings.disabled')}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.confidenceThresholdLabel')}</span>
              <span className="font-bold text-foreground">0.70 (70%)</span>
            </div>
          </div>

          {/* Negative Guardrails List */}
          <div className="p-3.5 rounded-lg border border-border bg-surface-elevated/40 space-y-2">
            <span className="text-amber-400 font-bold block text-[11px] flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <span>{t('settings.guardrailsTitle')}</span>
            </span>
            <ul className="space-y-1.5 text-slate-300 font-sans text-[11px]">
              {guardrails.map((rule, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* 2. Meta WhatsApp 24-Hour Customer Service Window */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-emerald-400" />
            <span>{t('settings.whatsappWindowTitle')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            {t('settings.whatsappWindowDesc')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 space-y-1">
              <span className="font-bold text-emerald-300 block text-[11px] flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                <span>Within 24 Hours</span>
              </span>
              <p className="text-[11px] text-emerald-200/90 font-sans leading-relaxed">
                {t('settings.within24hRule')}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 space-y-1">
              <span className="font-bold text-rose-300 block text-[11px] flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Outside 24 Hours</span>
              </span>
              <p className="text-[11px] text-rose-200/90 font-sans leading-relaxed">
                {t('settings.outside24hRule')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
