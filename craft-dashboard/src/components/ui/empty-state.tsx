'use client';

import React from 'react';
import { Inbox, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { useLanguage } from '@/lib/i18n/language-context';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const { t } = useLanguage();

  const displayTitle = title || t('common.emptyStateTitle');
  const displayDescription = description || t('common.emptyStateDescription');
  const ActionIcon = action?.icon;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-lg border border-dashed border-border bg-surface/50 transition-colors',
        className
      )}
    >
      <div className="h-12 w-12 rounded-full bg-surface-elevated flex items-center justify-center text-slate-400 mb-4 border border-border">
        <Icon className="h-6 w-6 text-slate-400" />
      </div>
      <h3 className="text-sm font-semibold font-mono text-foreground mb-1">
        {displayTitle}
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4 font-mono leading-relaxed">
        {displayDescription}
      </p>
      {action && (
        <Button
          variant="outline"
          size="sm"
          onClick={action.onClick}
          className="font-mono text-xs"
        >
          {ActionIcon && <ActionIcon className="h-3.5 w-3.5 me-1.5" />}
          {action.label}
        </Button>
      )}
    </div>
  );
}
