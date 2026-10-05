'use client';

import React from 'react';
import { FlakyCaseItem } from '@/types/admin';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { CheckCircle2, Shuffle, History, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FlakyCasesPanelProps {
  cases: FlakyCaseItem[];
  isLoading?: boolean;
  onSelectCase?: (caseId: string) => void;
}

export function FlakyCasesPanel({ cases, isLoading, onSelectCase }: FlakyCasesPanelProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const flakyList = cases.filter((c) => c.isFlaky || c.flipCount > 0);

  if (flakyList.length === 0) {
    return (
      <Card className="p-8 text-center bg-surface border-border">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-3 border border-emerald-500/20">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">Zero Flaky Cases Detected</h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
          All evaluated cases demonstrate consistent deterministic outcomes across historical benchmark runs.
        </p>
        <div className="inline-flex items-center gap-1.5 mt-4 px-3 py-1 rounded-full bg-surface-elevated border border-border text-[11px] font-mono text-slate-400">
          <History className="w-3.5 h-3.5 text-brand-400" />
          <span>Criterion: Minimum 3 historical observations, ≥2 state flips (PASS ↔ FAIL)</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Shuffle className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-foreground">
            Flaky Evaluation Cases ({flakyList.length})
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          State Flipping Detected (PASS ↔ FAIL)
        </span>
      </div>

      <div className="space-y-3">
        {flakyList.map((c) => (
          <div
            key={c.caseId}
            onClick={() => onSelectCase?.(c.caseId)}
            className={cn(
              'p-4 rounded-xl border transition-all text-xs cursor-pointer',
              c.isFlaky
                ? 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50'
                : 'border-border bg-surface-elevated/40 hover:border-slate-500'
            )}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-foreground">{c.caseId}</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-mono uppercase text-slate-400">
                    {c.dimension}
                  </span>
                  <Badge variant={c.isFlaky ? 'danger' : 'neutral'} className="text-[10px] font-mono">
                    {c.isFlaky ? 'FLAKY' : 'UNSTABLE'}
                  </Badge>
                </div>
                <p className="text-slate-300 text-xs mt-1">{c.title}</p>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div className="text-[11px] font-mono">
                  <span className="text-amber-400 font-bold">{c.flipCount} flips</span>
                  <span className="text-slate-500"> / {c.totalObservations} runs</span>
                </div>
                <div className="text-[11px] font-mono">
                  <span className="text-emerald-400 font-semibold">{c.passCount}P</span>
                  <span className="text-slate-500"> : </span>
                  <span className="text-rose-400 font-semibold">{c.failCount}F</span>
                </div>
              </div>
            </div>

            {/* Run History Timeline */}
            <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-mono uppercase text-slate-500 me-2">History:</span>
              {c.history.map((h, i) => (
                <span
                  key={i}
                  className={cn(
                    'px-2 py-0.5 rounded text-[10px] font-mono font-semibold',
                    h.status === 'passed'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  )}
                  title={`Run: ${h.runId} • Score: ${h.score}% • ${h.createdAt}`}
                >
                  {h.status === 'passed' ? 'PASS' : 'FAIL'}
                </span>
              ))}
            </div>

            {/* Fingerprints */}
            {c.failureFingerprints.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <ShieldAlert className="w-3 h-3 text-slate-400" />
                <span className="text-[10px] font-mono text-slate-400">Fingerprint:</span>
                {c.failureFingerprints.map((fp, i) => (
                  <span
                    key={i}
                    className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-surface border border-border text-slate-300"
                  >
                    {fp}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
