'use client';

import React from 'react';
import { RootCauseAnalysisResult } from '@/types/admin';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { HelpCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RootCausePanelProps {
  rootCauses?: RootCauseAnalysisResult;
  isLoading?: boolean;
}

export function RootCausePanel({ rootCauses, isLoading }: RootCausePanelProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!rootCauses || rootCauses.status === 'ROOT_CAUSE_DATA_UNAVAILABLE' || rootCauses.factors.length === 0) {
    return (
      <Card className="p-8 text-center bg-surface border-border">
        <div className="mx-auto w-12 h-12 rounded-full bg-slate-500/10 flex items-center justify-center text-slate-400 mb-3 border border-border">
          <Info className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">ROOT_CAUSE_DATA_UNAVAILABLE</h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
          {rootCauses?.summary || 'Failures are either zero or dispersed evenly across dimensions with no dominant telemetry correlation.'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-bold text-foreground">
            Root Cause & Contributing Factors ({rootCauses.factors.length})
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          Strict Telemetry Correlation (Zero LLM Judge)
        </span>
      </div>

      <div className="p-3 rounded-lg bg-surface-elevated/40 border border-border/80 text-[11px] text-slate-400 flex items-center gap-2">
        <Info className="w-4 h-4 text-brand-400 shrink-0" />
        <span>
          <strong>Operational Note:</strong> Factors below are identified through deterministic telemetry clustering as <em>possible contributing factors</em>, not definitive proof of causality.
        </span>
      </div>

      <div className="space-y-3">
        {rootCauses.factors.map((factor) => {
          const isHigh = factor.confidence === 'HIGH';
          const isMed = factor.confidence === 'MEDIUM';

          return (
            <div
              key={factor.id}
              className={cn(
                'p-4 rounded-xl border text-xs space-y-2',
                isHigh
                  ? 'border-brand-500/40 bg-brand-500/5'
                  : isMed
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-border bg-surface-elevated/40'
              )}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-foreground text-xs">{factor.label}</span>
                  <Badge
                    variant={isHigh ? 'info' : isMed ? 'neutral' : 'neutral'}
                    className="text-[10px] font-mono"
                  >
                    Confidence: {factor.confidence}
                  </Badge>
                  {factor.dimension && (
                    <span className="px-1.5 py-0.2 rounded bg-surface border border-border text-[10px] font-mono uppercase text-slate-400">
                      {factor.dimension}
                    </span>
                  )}
                  {factor.tool && (
                    <span className="px-1.5 py-0.2 rounded bg-surface border border-border text-[10px] font-mono text-indigo-400">
                      tool: {factor.tool}
                    </span>
                  )}
                </div>

                <span className="font-mono text-[11px] text-slate-300 font-semibold">
                  {factor.affectedCasesCount} affected case(s)
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface/70 border border-border/60 text-[11px] font-mono text-slate-300">
                <span className="text-slate-400 block text-[10px] uppercase">Observation:</span>
                {factor.observed}
              </div>

              <p className="text-slate-400 text-[11px]">{factor.correlationExplanation}</p>

              {factor.affectedCaseIds.length > 0 && (
                <div className="pt-2 border-t border-border/40 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono text-slate-500 uppercase">Cases:</span>
                  {factor.affectedCaseIds.slice(0, 8).map((cid) => (
                    <span
                      key={cid}
                      className="px-1.5 py-0.2 rounded bg-surface border border-border font-mono text-[10px] text-slate-300"
                    >
                      {cid}
                    </span>
                  ))}
                  {factor.affectedCaseIds.length > 8 && (
                    <span className="text-[10px] font-mono text-slate-500">
                      +{factor.affectedCaseIds.length - 8} more
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
