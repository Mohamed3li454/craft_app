'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { useLanguage } from '@/lib/i18n/language-context';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  correlationId?: string;
  error?: any;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title,
  message,
  correlationId,
  error,
  onRetry,
  className,
}: ErrorStateProps) {
  const { t } = useLanguage();

  const displayTitle = title || t('common.operationFailed');
  const displayMessage =
    message || error?.message || (typeof error === 'string' ? error : t('common.error'));
  const effectiveCorrelationId = correlationId || error?.correlationId;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-lg border border-rose-500/30 bg-rose-500/5 transition-colors',
        className
      )}
    >
      <div className="h-12 w-12 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500 mb-4 border border-rose-500/20">
        <AlertTriangle className="h-6 w-6" />
      </div>

      <h3 className="text-sm font-semibold font-mono text-rose-600 dark:text-rose-400 mb-1">
        {displayTitle}
      </h3>

      <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mb-3 font-mono leading-relaxed break-all">
        {displayMessage}
      </p>

      {effectiveCorrelationId && (
        <div className="mb-4 px-2.5 py-1 rounded bg-surface border border-border text-[11px] font-mono text-slate-500">
          <span className="text-slate-400 me-1.5">{t('common.correlationId')}:</span>
          <span className="font-semibold text-slate-700 dark:text-slate-300 select-all">
            {effectiveCorrelationId}
          </span>
        </div>
      )}

      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="font-mono text-xs border-rose-500/30 text-rose-600 dark:text-rose-300 hover:bg-rose-500/10"
        >
          <RefreshCw className="h-3.5 w-3.5 me-1.5" />
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
