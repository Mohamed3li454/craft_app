import React from 'react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { useLanguage } from '@/lib/i18n/language-context';
import { EvaluationDimension, EvaluationOverviewData, DimensionHealth } from '@/types/admin';
import {
  Brain,
  MessageSquare,
  Sparkles,
  Zap,
  Bot,
  Server,
  BellRing,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';

interface DimensionBreakdownProps {
  overview?: EvaluationOverviewData;
  healthMap?: Record<EvaluationDimension, DimensionHealth>;
  selectedDimension?: EvaluationDimension | 'all';
  onSelectDimension?: (dim: EvaluationDimension | 'all') => void;
}

interface DimensionConfig {
  key: EvaluationDimension;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  descKey: string;
}

const DIMENSIONS: DimensionConfig[] = [
  {
    key: 'memory',
    labelKey: 'evaluation.dimensionMemory',
    icon: Brain,
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    descKey: 'Relevance filtering, temporal recall, contradiction overrides, and safety gates',
  },
  {
    key: 'conversation',
    labelKey: 'evaluation.dimensionConversation',
    icon: MessageSquare,
    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    descKey: 'Standalone queries, entity resolution, topic switches, and ambiguous follow-ups',
  },
  {
    key: 'personalization',
    labelKey: 'evaluation.dimensionPersonalization',
    icon: Sparkles,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    descKey: 'Dialect matching (Egyptian/Gulf/Modern Standard), tone alignment, and style constraints',
  },
  {
    key: 'adaptive_response',
    labelKey: 'evaluation.dimensionAdaptive',
    icon: Zap,
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    descKey: 'Depth adaptation, concise direct answers, and structured synthesis',
  },
  {
    key: 'agent',
    labelKey: 'evaluation.dimensionAgent',
    icon: Bot,
    color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    descKey: 'Autonomous execution planning, step verification, tool dispatch, and loop protection',
  },
  {
    key: 'provider',
    labelKey: 'evaluation.dimensionProvider',
    icon: Server,
    color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    descKey: 'Groq primary path, fallback routing, schema adherence, and circuit breakers',
  },
  {
    key: 'proactive',
    labelKey: 'evaluation.dimensionProactive',
    icon: BellRing,
    color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    descKey: 'Intent triggers, reminder alerts, Meta 24h window compliance, and user attribution',
  },
];

export function DimensionBreakdown({
  overview,
  healthMap,
  selectedDimension = 'all',
  onSelectDimension,
}: DimensionBreakdownProps) {
  const { t } = useLanguage();
  const dimensionCounts = overview?.dimensionCoverage || {
    memory: 8,
    conversation: 8,
    personalization: 8,
    adaptive_response: 8,
    agent: 8,
    provider: 8,
    proactive: 8,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('evaluation.dimensionsTab')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('evaluation.benchmarkCoverageTitle')} (7 Subsystems • 56 Scenarios)
          </p>
        </div>
        {selectedDimension !== 'all' && onSelectDimension && (
          <button
            onClick={() => onSelectDimension('all')}
            className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors"
          >
            {t('evaluation.allDimensions')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {DIMENSIONS.map((dim) => {
          const Icon = dim.icon;
          const count = dimensionCounts[dim.key] ?? 8;
          const isSelected = selectedDimension === dim.key;
          const health = healthMap ? healthMap[dim.key] : null;
          const passRate = health?.passRate !== undefined ? `${health.passRate}%` : '100%';
          const regressions = health?.regressionsCount ?? 0;
          const topPattern = health?.topFailurePattern;

          return (
            <Card
              key={dim.key}
              onClick={() => onSelectDimension?.(isSelected ? 'all' : dim.key)}
              className={`p-4 cursor-pointer transition-all flex flex-col justify-between hover:border-slate-500 dark:hover:border-slate-600 ${
                isSelected ? 'ring-2 ring-brand-500 border-brand-500/50 bg-brand-500/5' : ''
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className={`p-2 rounded-lg border ${dim.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <StatusBadge
                    status={regressions > 0 ? 'failed' : 'completed'}
                    label={`${passRate} Pass`}
                  />
                </div>
                <h4 className="text-sm font-semibold text-foreground">{t(dim.labelKey as any)}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {dim.descKey}
                </p>
                {topPattern && (
                  <div className="mt-2 text-[10px] font-mono text-amber-400 bg-amber-500/10 p-1.5 rounded border border-amber-500/20 line-clamp-1">
                    {topPattern}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-foreground font-medium">
                    {count} {t('evaluation.dimensionCasesCount')}
                  </span>
                  <span
                    className={
                      regressions > 0
                        ? 'text-rose-400 font-mono text-[11px] flex items-center gap-0.5'
                        : 'text-emerald-500 dark:text-emerald-400 font-mono text-[11px] flex items-center gap-0.5'
                    }
                  >
                    {regressions > 0 ? null : <CheckCircle2 className="w-3 h-3" />}
                    {regressions} Regr
                  </span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
