'use client';

import React from 'react';
import { Button } from './button';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/language-context';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'destructive' | 'primary' | 'warning';
  isLoading?: boolean;
  children?: React.ReactNode;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  variant = 'primary',
  isLoading = false,
  children,
}: ConfirmModalProps) {
  const { t } = useLanguage();
  if (!isOpen) return null;

  const effectiveConfirmText = confirmText || t('common.confirm');
  const effectiveCancelText = cancelText || t('common.cancel');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl space-y-4 text-start">
        <button
          onClick={onClose}
          disabled={isLoading}
          aria-label={t('common.close')}
          className="absolute top-4 end-4 text-slate-400 hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3">
          <div
            className={cn(
              'p-2 rounded-full border shrink-0',
              variant === 'destructive'
                ? 'bg-rose-950/80 text-rose-400 border-rose-800'
                : 'bg-amber-950/80 text-amber-400 border-amber-800'
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">{description}</p>
          </div>
        </div>

        {children && <div className="mt-2 text-xs">{children}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            {effectiveCancelText}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'primary'}
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {effectiveConfirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
