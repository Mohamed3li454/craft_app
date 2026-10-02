'use client';

import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/language-context';

export interface ErrorAlertProps {
  error: any;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorAlert({ error, title, onRetry, className }: ErrorAlertProps) {
  const { t } = useLanguage();
  if (!error) return null;

  const displayTitle = title || t('common.operationFailed');
  const message = error?.message || String(error);
  const code = error?.code;
  const correlationId = error?.correlationId;

  return (
    <div
      className={cn(
        'p-4 rounded-lg border border-rose-800/60 bg-rose-950/40 text-rose-200 text-xs font-mono flex items-start justify-between gap-4 text-start',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-rose-300">{displayTitle}</p>
          <p className="text-slate-300 text-xs leading-relaxed">{message}</p>
          {(code || correlationId) && (
            <div className="flex items-center gap-3 text-[11px] text-rose-400/80 pt-1">
              {code && <span>{t('common.code')}: <strong>{code}</strong></span>}
              {correlationId && <span>Correlation ID: <strong>{correlationId}</strong></span>}
            </div>
          )}
        </div>
      </div>

      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="shrink-0 border-rose-800 text-rose-300 hover:bg-rose-900/40 text-xs font-mono"
        >
          <RotateCcw className="h-3.5 w-3.5 me-1" />
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
