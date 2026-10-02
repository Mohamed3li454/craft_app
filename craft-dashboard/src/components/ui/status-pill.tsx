import React from 'react';
import { cn } from '@/lib/utils';

export interface StatusPillProps {
  status: string | undefined | null;
  className?: string;
  showDot?: boolean;
}

export function StatusPill({ status = 'unknown', className, showDot = true }: StatusPillProps) {
  const norm = (status || 'unknown').toLowerCase();

  let dotColor = 'bg-slate-400';
  let badgeStyle = 'bg-slate-900/60 text-slate-300 border-slate-700/60';

  if (['healthy', 'completed', 'delivered', 'active', 'validated', 'promoted', 'sent', 'success', 'approved'].includes(norm)) {
    dotColor = 'bg-emerald-400 animate-pulse';
    badgeStyle = 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60';
  } else if (['pending', 'processing', 'running', 'queued'].includes(norm)) {
    dotColor = 'bg-amber-400 animate-spin';
    badgeStyle = 'bg-amber-950/70 text-amber-300 border-amber-800/60';
  } else if (['failed', 'banned', 'error', 'unhealthy', 'rejected'].includes(norm)) {
    dotColor = 'bg-rose-400';
    badgeStyle = 'bg-rose-950/70 text-rose-300 border-rose-800/60';
  } else if (['cancelled', 'archived', 'interrupted', 'degraded'].includes(norm)) {
    dotColor = 'bg-yellow-400';
    badgeStyle = 'bg-yellow-950/70 text-yellow-300 border-yellow-800/60';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border uppercase tracking-wider',
        badgeStyle,
        className
      )}
    >
      {showDot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColor)} />}
      <span>{norm}</span>
    </span>
  );
}
