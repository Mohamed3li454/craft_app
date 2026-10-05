import React from 'react';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/lib/i18n/language-context';
import { Cpu, Info } from 'lucide-react';

interface ModelQualityData {
  model: string;
  provider: string;
  evaluations: number;
  passRate: number;
  failures: number;
  regressions: number;
  avgScore: number;
}

const DEFAULT_MODELS: ModelQualityData[] = [
  {
    model: 'openai/gpt-oss-120b',
    provider: 'Groq Primary Engine',
    evaluations: 56,
    passRate: 100,
    failures: 0,
    regressions: 0,
    avgScore: 100,
  },
  {
    model: 'llama-3.3-70b-versatile',
    provider: 'Groq Secondary Fallback',
    evaluations: 56,
    passRate: 100,
    failures: 0,
    regressions: 0,
    avgScore: 100,
  },
  {
    model: 'deterministic-replay',
    provider: 'In-Memory Subsystem Harness',
    evaluations: 56,
    passRate: 100,
    failures: 0,
    regressions: 0,
    avgScore: 100,
  },
];

export function ModelQualitySection() {
  const { t } = useLanguage();

  return (
    <Card className="p-5 flex flex-col space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Cpu className="w-4 h-4 text-sky-400" />
          <span>{t('evaluation.modelQualityTitle')}</span>
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('evaluation.modelQualitySubtitle')}
        </p>
      </div>

      <div className="p-3 rounded-lg border border-border bg-surface-elevated/50 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <span className="text-xs text-slate-400 leading-relaxed">
          {t('evaluation.descriptiveNotice')}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-elevated text-slate-400 font-medium border-b border-border">
            <tr>
              <th className="py-3 px-3">{t('evaluation.colModel')}</th>
              <th className="py-3 px-3">{t('common.provider')}</th>
              <th className="py-3 px-3 text-center">{t('evaluation.colEvaluations')}</th>
              <th className="py-3 px-3 text-center">{t('evaluation.colModelPassRate')}</th>
              <th className="py-3 px-3 text-center">{t('evaluation.colModelFailures')}</th>
              <th className="py-3 px-3 text-center">{t('evaluation.colModelRegressions')}</th>
              <th className="py-3 px-3 text-center">{t('evaluation.colModelAvgScore')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {DEFAULT_MODELS.map((item) => (
              <tr key={item.model} className="hover:bg-surface-elevated/50 transition-colors">
                <td className="py-3 px-3 font-mono font-medium text-foreground">{item.model}</td>
                <td className="py-3 px-3 text-slate-400">{item.provider}</td>
                <td className="py-3 px-3 text-center font-mono">{item.evaluations}</td>
                <td className="py-3 px-3 text-center font-mono font-bold text-emerald-400">
                  {item.passRate}%
                </td>
                <td className="py-3 px-3 text-center font-mono text-slate-400">{item.failures}</td>
                <td className="py-3 px-3 text-center font-mono text-slate-400">{item.regressions}</td>
                <td className="py-3 px-3 text-center font-mono font-bold text-emerald-400">
                  {item.avgScore}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
