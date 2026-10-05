'use client';

import React from 'react';
import { DegradationDetectionResult } from '@/types/admin';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { AlertTriangle, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DegradationAlertsPanelProps {
  degradation?: DegradationDetectionResult;
  isLoading?: boolean;
}

export function DegradationAlertsPanel({ degradation, isLoading }: DegradationAlertsPanelProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!degradation || degradation.signals.length === 0) {
    return (
      <Card className="p-8 text-center bg-surface border-border">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-3 border border-emerald-500/20">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">Zero Quality Degradation Signals</h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
          {degradation?.statusReason || 'All quality, reliability, and performance metrics are operating within expected thresholds.'}
        </p>
      </Card>
    );
  }

  const { signals, regressionAcceleration } = degradation;

  return (
    <div className="space-y-4">
      {/* Acceleration Warning Banner if detected */}
      {regressionAcceleration?.detected && (
        <div className="p-4 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs text-rose-300 flex items-start gap-3">
          <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-sm text-rose-200">
              Regression Acceleration Active
            </span>
            <p>
              Regressions have strictly increased across {regressionAcceleration.streakLength} consecutive evaluation runs ({regressionAcceleration.consecutiveRegressions.join(' → ')}).
            </p>
          </div>
        </div>
      )}

      {/* Signals List */}
      <div className="space-y-2.5">
        {signals.map((sig) => {
          const isCrit = sig.severity === 'critical';
          const isWarn = sig.severity === 'warning';

          return (
            <div
              key={sig.id}
              className={cn(
                'p-4 rounded-xl border text-xs space-y-2',
                isCrit
                  ? 'border-rose-500/40 bg-rose-500/5'
                  : isWarn
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-border bg-surface-elevated/40'
              )}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  {isCrit ? (
                    <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span className="font-bold text-foreground text-xs">{sig.title}</span>
                  <Badge variant={isCrit ? 'danger' : 'neutral'} className="text-[10px] font-mono">
                    {sig.severity.toUpperCase()}
                  </Badge>
                  {sig.dimension && (
                    <span className="px-1.5 py-0.2 rounded bg-surface border border-border text-[10px] font-mono uppercase text-slate-400">
                      {sig.dimension}
                    </span>
                  )}
                </div>

                <span className="font-mono text-[10px] text-slate-400">
                  {new Date(sig.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <p className="text-slate-300 text-xs">{sig.message}</p>

              <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pt-1 border-t border-border/40 flex-wrap">
                <span>
                  Previous: <span className="text-slate-200">{sig.previousValue}</span>
                </span>
                <span>
                  Current: <span className={isCrit ? 'text-rose-400 font-bold' : 'text-amber-400 font-bold'}>{sig.currentValue}</span>
                </span>
                <span className="text-slate-500">
                  Threshold: {sig.thresholdBreached}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
