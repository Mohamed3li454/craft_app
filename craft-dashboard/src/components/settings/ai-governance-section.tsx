'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Cpu, GitBranch, Scale, ShieldAlert } from 'lucide-react';
import { AdminSafeSettings } from '@/types/admin';

interface AiGovernanceSectionProps {
  aiProvider?: AdminSafeSettings['infrastructure']['aiProvider'];
}

export function AiGovernanceSection({ aiProvider }: AiGovernanceSectionProps) {
  const { t } = useLanguage();

  const primaryModel = aiProvider?.models?.primary || 'openai/gpt-oss-120b';
  const fastFallback = aiProvider?.models?.fastFallback || 'llama-3.3-70b-versatile';
  const reasoningModel = aiProvider?.models?.reasoning || 'qwen-2.5-32b';
  const providerEngine = aiProvider?.engine || 'LPU Inference Engine';

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Active Provider & Model Topology */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Cpu className="h-4 w-4 text-purple-400" />
            <span>{t('settings.aiInferenceTopology')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('settings.primaryInferenceEngine')}</span>
            <div className="flex items-center gap-2">
              <Badge variant="purple" className="text-[10px] uppercase font-mono">
                {aiProvider?.primary || 'groq'}
              </Badge>
              <span className="text-slate-300 font-semibold">{providerEngine}</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('settings.primaryProductionModel')}</span>
            <span className="font-bold text-foreground" dir="ltr">
              {primaryModel}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('settings.fastFallbackModel')}</span>
            <span className="font-bold text-foreground" dir="ltr">
              {fastFallback}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('agentRuns.reasoningModel')}</span>
            <span className="font-bold text-foreground" dir="ltr">
              {reasoningModel}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 2. Routing Policy & Bounded Fallbacks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-brand-400" />
              <span>{t('settings.aiRoutingTitle')}</span>
            </CardTitle>
            <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
              {t('settings.badgeReadOnly')}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              {t('settings.aiRoutingDesc')}
            </p>

            <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.maxAttemptsLabel')}</span>
              <span className="font-bold text-foreground">2 (Hard Limit)</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.timeoutLabel')}</span>
              <span className="font-bold text-foreground">30,000ms</span>
            </div>

            <div className="p-3 rounded-lg bg-surface-elevated/40 border border-border space-y-1.5">
              <span className="text-emerald-400 font-bold block text-[11px]">
                {t('settings.retryableCategories')}:
              </span>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['timeout', 'network', 'rate_limit', 'unavailable', 'model_unavailable', 'malformed_response'].map(
                  (cat) => (
                    <span
                      key={cat}
                      className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 text-[10px]"
                    >
                      {cat}
                    </span>
                  )
                )}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface-elevated/40 border border-border space-y-1.5">
              <span className="text-rose-400 font-bold block text-[11px] flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" />
                <span>{t('settings.nonRetryableCategories')}:</span>
              </span>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['authentication', 'authorization', 'invalid_request', 'context_overflow'].map((cat) => (
                  <span
                    key={cat}
                    className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/25 text-[10px]"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. Execution Budgets & Ceilings */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Scale className="h-4 w-4 text-emerald-400" />
              <span>{t('settings.executionBudgetTitle')}</span>
            </CardTitle>
            <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
              {t('settings.badgeReadOnly')}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              {t('settings.executionBudgetDesc')}
            </p>

            <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.maxStepsLabel')}</span>
              <div className="flex items-baseline gap-1">
                <span className="font-bold text-foreground">3</span>
                <span className="text-[10px] text-slate-500">(Hard Max: 5)</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.maxToolsLabel')}</span>
              <div className="flex items-baseline gap-1">
                <span className="font-bold text-foreground">3</span>
                <span className="text-[10px] text-slate-500">(Hard Max: 5)</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.maxTurnTimeLabel')}</span>
              <div className="flex items-baseline gap-1">
                <span className="font-bold text-foreground">30,000ms</span>
                <span className="text-[10px] text-slate-500">(Hard Max: 45,000ms)</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.maxOutputCharsLabel')}</span>
              <div className="flex items-baseline gap-1">
                <span className="font-bold text-foreground">12,000 chars</span>
                <span className="text-[10px] text-slate-500">(Ceiling: 30,000)</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
              <span className="text-slate-400">{t('settings.parallelExecutionLabel')}</span>
              <span className="font-bold text-amber-400">{t('settings.sequentialOnly')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
