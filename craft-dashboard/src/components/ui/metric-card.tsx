import React from 'react';
import { Card } from './card';
import { cn } from '@/lib/utils';

export interface MetricCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  change?: string;
  isPositive?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export function MetricCard({
  title,
  value,
  subtext,
  change,
  isPositive,
  icon,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn('p-5 flex flex-col justify-between hover:border-slate-700 transition-all', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</span>
        {icon && <div className="text-slate-400 p-1.5 rounded-md bg-surface-elevated border border-border">{icon}</div>}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono tracking-tight text-slate-100">{value}</span>
        {change && (
          <span
            className={cn(
              'text-xs font-mono font-medium',
              isPositive ? 'text-emerald-400' : 'text-rose-400'
            )}
          >
            {change}
          </span>
        )}
      </div>
      {subtext && <p className="mt-1 text-xs text-slate-400">{subtext}</p>}
    </Card>
  );
}
