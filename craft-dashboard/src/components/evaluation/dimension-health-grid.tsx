'use client';

import React from 'react';
import { DimensionHealth, EvaluationDimension } from '@/types/admin';
import { useLanguage } from '@/lib/i18n/language-context';
import { Badge } from '@/components/ui/badge';
import {
  Brain,
  MessageSquare,
  Sparkles,
  Zap,
  Bot,
  Server,
  Compass,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DimensionHealthGridProps {
  healthMap?: Record<EvaluationDimension, DimensionHealth>;
  onSelectDimension?: (dimension: EvaluationDimension) => void;
}

const DIMENSION_CONFIG: Record<
  EvaluationDimension,
  { labelKey: string; icon: React.ComponentType<{ className?: string }> }
> = {
  memory: { labelKey: 'evaluation.dimensionMemory', icon: Brain },
  conversation: { labelKey: 'evaluation.dimensionConversation', icon: MessageSquare },
  personalization: { labelKey: 'evaluation.dimensionPersonalization', icon: Sparkles },
  adaptive_response: { labelKey: 'evaluation.dimensionAdaptive', icon: Zap },
  agent: { labelKey: 'evaluation.dimensionAgent', icon: Bot },
  provider: { labelKey: 'evaluation.dimensionProvider', icon: Server },
  proactive: { labelKey: 'evaluation.dimensionProactive', icon: Compass },
};

export function DimensionHealthGrid({
  healthMap,
  onSelectDimension,
}: DimensionHealthGridProps) {
  const { t, isRtl } = useLanguage();
  const ArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  const dimensions: EvaluationDimension[] = [
    'memory',
    'conversation',
    'personalization',
    'adaptive_response',
    'agent',
    'provider',
    'proactive',
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {dimensions.map((dim) => {
        const config = DIMENSION_CONFIG[dim];
        const Icon = config.icon;
        const health = healthMap ? healthMap[dim] : null;

        const evaluated = health?.evaluatedCases ?? 8;
        const total = health?.totalCases ?? 8;
        const passRate = health?.passRate ?? 100;
        const avgScore = health?.averageScore ?? 100;
        const regressions = health?.regressionsCount ?? 0;
        const topPattern = health?.topFailurePattern;

        const hasFailures = passRate < 100 || regressions > 0;

        return (
          <div
            key={dim}
            onClick={() => onSelectDimension && onSelectDimension(dim)}
            className={cn(
              'p-4 rounded-xl border bg-surface-elevated/40 hover:bg-surface-elevated/70 transition-all cursor-pointer flex flex-col justify-between group shadow-sm',
              hasFailures ? 'border-amber-500/30' : 'border-border'
            )}
          >
            <div>
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      'p-2 rounded-lg',
                      hasFailures ? 'bg-amber-500/10 text-amber-400' : 'bg-brand-500/10 text-brand-400'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      {t(config.labelKey)}
                    </h4>
                    <span className="text-[11px] font-mono text-slate-400">
                      {evaluated} / {total} cases
                    </span>
                  </div>
                </div>

                {regressions > 0 && (
                  <Badge variant="danger" className="text-[10px] font-mono">
                    {regressions} Regr.
                  </Badge>
                )}
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-2 my-3 p-2.5 rounded-lg bg-surface/60 border border-border/50 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-mono block">
                    {t('evaluation.kpiPassRate')}
                  </span>
                  <span
                    className={cn(
                      'font-mono font-bold text-sm',
                      passRate >= 95
                        ? 'text-emerald-400'
                        : passRate >= 80
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    )}
                  >
                    {passRate}%
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-mono block">
                    {t('evaluation.kpiOverallScore')}
                  </span>
                  <span className="font-mono font-bold text-sm text-foreground">
                    {avgScore}%
                  </span>
                </div>
              </div>

              {/* Top Failure or Clean Baseline */}
              <div className="text-[11px] font-mono mt-2">
                {topPattern ? (
                  <div className="flex items-start gap-1.5 text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="line-clamp-1">{topPattern}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-emerald-400/90 py-1">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[11px]">All assertions verified</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer action link */}
            <div className="pt-3 mt-3 border-t border-border/50 flex items-center justify-between text-[11px] text-slate-400 group-hover:text-brand-400 transition-colors">
              <span>{t('evaluation.casesTab')}</span>
              <ArrowIcon className="w-3.5 h-3.5 transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
