import React from 'react';
import { ShieldAlert, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReasoningBannerProps {
  className?: string;
  compact?: boolean;
}

export function ReasoningBanner({ className, compact = false }: ReasoningBannerProps) {
  if (compact) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-950/40 border border-amber-800/50 text-[11px] font-mono text-amber-300 select-none',
          className
        )}
      >
        <Lock className="h-3 w-3 text-amber-400" />
        <span>Reasoning Redacted (Security Policy)</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3.5 rounded-md border border-amber-800/40 bg-amber-950/20 text-amber-200 text-xs font-mono select-none',
        className
      )}
    >
      <div className="p-2 rounded bg-amber-900/40 border border-amber-700/50 shrink-0">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
      </div>
      <div>
        <p className="font-semibold text-amber-300">Internal Chain-of-Thought Redacted</p>
        <p className="text-[11px] text-amber-400/80 mt-0.5">
          Per platform security and privacy invariants, internal reasoning tokens and raw model thinking traces are filtered at the backend boundary before reaching the admin control plane.
        </p>
      </div>
    </div>
  );
}
