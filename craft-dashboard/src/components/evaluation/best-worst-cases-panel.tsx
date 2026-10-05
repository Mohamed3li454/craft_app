'use client';

import React, { useState } from 'react';
import { RankedCaseItem } from '@/types/admin';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { Trophy, AlertOctagon, Clock, Cpu, CheckCircle2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BestWorstCasesPanelProps {
  bestCases: RankedCaseItem[];
  worstCases: RankedCaseItem[];
  isLoading?: boolean;
  onSelectCase?: (caseItem: RankedCaseItem) => void;
}

export function BestWorstCasesPanel({
  bestCases,
  worstCases,
  isLoading,
  onSelectCase,
}: BestWorstCasesPanelProps) {
  const [activeTab, setActiveTab] = useState<'worst' | 'best'>('worst');

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const currentList = activeTab === 'worst' ? worstCases : bestCases;

  return (
    <div className="space-y-4">
      {/* Switcher Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('worst')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              activeTab === 'worst'
                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                : 'text-slate-400 hover:text-foreground'
            )}
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>Problematic Cases ({worstCases.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('best')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              activeTab === 'best'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-foreground'
            )}
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Top Performing ({bestCases.length})</span>
          </button>
        </div>

        <span className="text-[11px] font-mono text-slate-400">
          {activeTab === 'worst'
            ? 'Ranked by failure, regression, low score, and latency'
            : 'Ranked by pass status, 100% score, 0 regressions, and speed'}
        </span>
      </div>

      {currentList.length === 0 ? (
        <Card className="p-8 text-center bg-surface border-border">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
          <p className="text-xs text-slate-400">No cases found matching criteria.</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {currentList.map((c, index) => {
            const isFailed = c.status === 'failed' || c.status === 'error';
            return (
              <div
                key={c.caseId}
                onClick={() => onSelectCase?.(c)}
                className={cn(
                  'p-3.5 rounded-xl border transition-all text-xs cursor-pointer',
                  c.regression
                    ? 'border-rose-500/40 bg-rose-500/5 hover:border-rose-500/60'
                    : isFailed
                    ? 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50'
                    : 'border-border bg-surface-elevated/40 hover:border-slate-500'
                )}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-2.5">
                    <span className="font-mono text-xs text-slate-500 mt-0.5">#{index + 1}</span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-foreground">{c.caseId}</span>
                        <span className="px-1.5 py-0.2 rounded bg-surface border border-border text-[10px] font-mono uppercase text-slate-400">
                          {c.dimension}
                        </span>
                        {c.regression && (
                          <Badge variant="danger" className="text-[10px] font-mono">
                            REGRESSION
                          </Badge>
                        )}
                        {c.failureCategory && (
                          <Badge variant="neutral" className="text-[10px] font-mono text-rose-400 border-rose-500/30">
                            {c.failureCategory}
                          </Badge>
                        )}
                      </div>
                      <p className="text-slate-300 text-xs mt-1">{c.title}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <span className="text-[10px] font-mono text-slate-400 block">Score</span>
                      <span
                        className={cn(
                          'font-mono font-bold text-xs',
                          c.score >= 90
                            ? 'text-emerald-400'
                            : c.score >= 70
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        )}
                      >
                        {c.score}%
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-mono text-slate-400 block">Latency</span>
                      <span className="font-mono text-xs text-slate-300 flex items-center justify-end gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {c.durationMs}ms
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-mono text-slate-400 block">Tokens</span>
                      <span className="font-mono text-xs text-slate-300 flex items-center justify-end gap-1">
                        <Cpu className="w-3 h-3 text-slate-500" />
                        {c.tokens}
                      </span>
                    </div>
                  </div>
                </div>

                {c.failureReason && (
                  <div className="mt-2 pt-2 border-t border-border/40 text-[11px] font-mono text-rose-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span className="line-clamp-1">{c.failureReason}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
