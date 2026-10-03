import React from 'react';
import { cn } from '@/lib/utils';

export type StatusCategory =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'running';

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: string | null;
  label?: string;
  size?: 'xs' | 'sm' | 'md';
  showDot?: boolean;
  pulse?: boolean;
}

export function normalizeStatusCategory(status?: string | null): StatusCategory {
  const norm = (status || 'unknown').toLowerCase().trim();

  if (
    ['healthy', 'completed', 'delivered', 'active', 'validated', 'promoted', 'sent', 'success', 'approved', 'ok'].includes(
      norm
    )
  ) {
    return 'success';
  }
  if (['running', 'processing', 'in_progress', 'executing'].includes(norm)) {
    return 'running';
  }
  if (['pending', 'queued', 'waiting', 'checking'].includes(norm)) {
    return 'warning';
  }
  if (['failed', 'banned', 'error', 'unhealthy', 'rejected', 'unreachable'].includes(norm)) {
    return 'danger';
  }
  if (['cancelled', 'archived', 'interrupted', 'degraded'].includes(norm)) {
    return 'warning';
  }
  if (['info', 'standard', 'vip'].includes(norm)) {
    return 'info';
  }
  return 'neutral';
}

export function StatusBadge({
  status = 'unknown',
  label,
  size = 'sm',
  showDot = true,
  pulse,
  className,
  ...props
}: StatusBadgeProps) {
  const norm = (status || 'unknown').toLowerCase().trim();
  const category = normalizeStatusCategory(norm);

  const styles: Record<StatusCategory, { badge: string; dot: string; defaultPulse: boolean }> = {
    success: {
      badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      dot: 'bg-emerald-500',
      defaultPulse: false,
    },
    running: {
      badge: 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/25',
      dot: 'bg-brand-500',
      defaultPulse: true,
    },
    warning: {
      badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
      dot: 'bg-amber-500',
      defaultPulse: false,
    },
    danger: {
      badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
      dot: 'bg-rose-500',
      defaultPulse: false,
    },
    info: {
      badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
      dot: 'bg-cyan-500',
      defaultPulse: false,
    },
    neutral: {
      badge: 'bg-surface-elevated text-slate-700 dark:text-slate-300 border-border',
      dot: 'bg-slate-400',
      defaultPulse: false,
    },
  };

  const currentStyle = styles[category];
  const shouldPulse = pulse !== undefined ? pulse : currentStyle.defaultPulse;

  const sizeClasses = {
    xs: 'text-[10px] px-1.5 py-0.5 gap-1',
    sm: 'text-xs px-2.5 py-0.5 gap-1.5',
    md: 'text-xs sm:text-sm px-3 py-1 gap-2',
  };

  const displayText = label || norm;

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center rounded-full font-mono font-medium border uppercase tracking-wider select-none transition-colors',
        sizeClasses[size],
        currentStyle.badge,
        className
      )}
      {...props}
    >
      {showDot && (
        <span
          className={cn(
            'rounded-full shrink-0',
            size === 'xs' ? 'h-1 w-1' : size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5',
            currentStyle.dot,
            shouldPulse ? 'animate-pulse' : ''
          )}
        />
      )}
      <span className="truncate">{displayText}</span>
    </span>
  );
}
