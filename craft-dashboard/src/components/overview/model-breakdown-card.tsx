'use client';

import React from 'react';
import { ModelBreakdownItem } from '@/types/admin';
import { useLanguage } from '@/lib/i18n/language-context';
import { Cpu, Zap } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export interface ModelBreakdownCardProps {
  data?: ModelBreakdownItem[];
  isLoading?: boolean;
}

// Clean model names for display without destroying the identifier
function formatModelDisplay(rawModel: string): { title: string; id: string } {
  const norm = (rawModel || '').trim();
  if (norm.toLowerCase().includes('gpt-oss-120b')) {
    return { title: 'GPT-OSS 120B', id: norm };
  }
  if (norm.toLowerCase().includes('qwen3.8-27b') || norm.toLowerCase().includes('qwen')) {
    return { title: 'Qwen 3.8 27B', id: norm };
  }
  if (norm.toLowerCase().includes('llama-3.3-70b') || norm.toLowerCase().includes('llama-70b')) {
    return { title: 'Llama 3.3 70B', id: norm };
  }
  if (norm.toLowerCase().includes('llama-3.1-8b') || norm.toLowerCase().includes('llama-8b')) {
    return { title: 'Llama 3.1 8B', id: norm };
  }

  // Fallback: parse vendor/model-name
  const parts = norm.split('/');
  const baseName = parts[parts.length - 1] || norm;
  const formattedTitle = baseName
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { title: formattedTitle, id: norm };
}

export function ModelBreakdownCard({ data = [], isLoading }: ModelBreakdownCardProps) {
  const { t, formatNumber, formatCurrency, formatTokens } = useLanguage();

  return (
    <Card className="transition-colors shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-semibold font-mono text-foreground flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-500" aria-hidden="true" />
            {t('overview.modelDistributionTitle')}
          </CardTitle>
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            {t('overview.modelDistributionSubtitle')}
          </p>
        </div>

        {/* Real Groq Production Provider Indicator */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-mono font-medium text-cyan-600 dark:text-cyan-400 shrink-0">
          <Zap className="h-3 w-3" />
          <span>Groq Cloud</span>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <DataTable
          columns={[
            {
              header: t('overview.modelCol'),
              cell: (r: ModelBreakdownItem) => {
                const { title, id } = formatModelDisplay(r.model);
                return (
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-foreground truncate text-xs">
                      {title}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-400 truncate">
                      {id}
                    </span>
                  </div>
                );
              },
            },
            {
              header: t('overview.callsCol'),
              accessorKey: 'calls',
              cell: (r: ModelBreakdownItem) => formatNumber(r.calls),
            },
            {
              header: t('overview.tokensCol'),
              accessorKey: 'tokens',
              cell: (r: ModelBreakdownItem) => formatTokens(r.tokens),
            },
            {
              header: t('overview.costCol'),
              accessorKey: 'costUsd',
              cell: (r: ModelBreakdownItem) => formatCurrency(r.costUsd),
            },
            {
              header: t('overview.avgLatencyCol'),
              accessorKey: 'avgLatencyMs',
              cell: (r: ModelBreakdownItem) => `${r.avgLatencyMs || 0}ms`,
            },
          ]}
          data={data}
          isLoading={isLoading}
          emptyMessage={t('overview.noModelRecords')}
          className="border-none rounded-none shadow-none"
        />
      </CardContent>
    </Card>
  );
}
