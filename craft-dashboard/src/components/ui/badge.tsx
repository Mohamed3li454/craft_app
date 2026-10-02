import React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-brand-950/80 text-brand-300 border-brand-800/60',
    success: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
    warning: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    danger: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
    info: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60',
    purple: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
    neutral: 'bg-surface-elevated text-slate-300 border-border',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-mono font-medium border transition-colors select-none',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
