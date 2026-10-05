'use client';

import React, { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { useOptionalAuth } from '@/lib/auth/auth-context';
import { adminApi } from '@/lib/api/admin-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EvaluationDimension, TriggerEvaluationRunPayload } from '@/types/admin';
import {
  X,
  Play,
  FlaskConical,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Cpu,
  Layers,
  FileCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RunEvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (data: any) => void;
  role?: string;
}

export function RunEvaluationModal({ isOpen, onClose, onSuccess, role: propRole }: RunEvaluationModalProps) {
  const { t, isRtl } = useLanguage();
  const auth = useOptionalAuth();
  const role = propRole ?? auth?.role ?? 'admin';

  const [mode, setMode] = useState<'mock' | 'replay' | 'live'>('mock');
  const [scope, setScope] = useState<'all' | 'dimension' | 'custom'>('all');
  const [selectedDimension, setSelectedDimension] = useState<EvaluationDimension>('memory');
  const [customCaseIds, setCustomCaseIds] = useState('');
  const [concurrency, setConcurrency] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // RBAC check: only owner and admin can trigger evaluation runs
  const isAllowedToRun = role === 'owner' || role === 'admin';

  const dimensions: { id: EvaluationDimension; label: string; count: number }[] = [
    { id: 'memory', label: t('evaluation.dimensionMemory'), count: 8 },
    { id: 'conversation', label: t('evaluation.dimensionConversation'), count: 8 },
    { id: 'personalization', label: t('evaluation.dimensionPersonalization'), count: 8 },
    { id: 'adaptive_response', label: t('evaluation.dimensionAdaptive'), count: 8 },
    { id: 'agent', label: t('evaluation.dimensionAgent'), count: 8 },
    { id: 'provider', label: t('evaluation.dimensionProvider'), count: 8 },
    { id: 'proactive', label: t('evaluation.dimensionProactive'), count: 8 },
  ];

  const handleExecute = async () => {
    if (!isAllowedToRun || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const parsedCaseIds = scope === 'custom'
        ? customCaseIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
        : undefined;

      if (scope === 'custom' && (!parsedCaseIds || parsedCaseIds.length === 0)) {
        setErrorMessage('Please specify at least one valid evaluation case ID.');
        setIsSubmitting(false);
        return;
      }

      const payload: TriggerEvaluationRunPayload = {
        mode,
        category: scope === 'dimension' ? selectedDimension : undefined,
        ...(parsedCaseIds && parsedCaseIds.length > 0 ? { caseIds: parsedCaseIds } : {}),
        ...(concurrency !== 3 ? { concurrency: Math.min(5, Math.max(1, concurrency)) } : {}),
      };

      const res = await adminApi.triggerEvaluationRun(payload);
      if (res.success && res.data) {
        onSuccess(res.data);
        onClose();
      } else {
        setErrorMessage(t('common.operationFailed'));
      }
    } catch (err: any) {
      setErrorMessage(err.message || t('common.operationFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-eval-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-surface p-6 shadow-2xl space-y-5 text-start">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-500">
              <FlaskConical className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="run-eval-modal-title" className="text-base font-bold text-foreground">
                {t('evaluation.runBenchmarkButton') || 'Run AI Benchmark Evaluation'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Execute golden benchmark cases with deterministic assertions & regression tracking
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* RBAC Permission Banner if not owner/admin */}
        {!isAllowedToRun && (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              Role <strong>{role || 'viewer'}</strong> lacks execution permission. Only <strong>admin</strong> and <strong>owner</strong> roles can trigger evaluation runs.
            </span>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Execution Mode Selection */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
            Execution Mode
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Mock Mode */}
            <div
              onClick={() => !isSubmitting && setMode('mock')}
              className={cn(
                'p-3 rounded-lg border text-xs cursor-pointer transition-all flex flex-col justify-between space-y-1',
                mode === 'mock'
                  ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/50'
                  : 'border-border bg-surface-elevated/40 hover:border-slate-500'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <FileCheck className="h-3.5 w-3.5 text-brand-400" />
                  Mock Mode
                </span>
                <Badge variant="neutral" className="text-[10px] px-1.5 py-0 border-brand-500/30 text-brand-500 font-bold">
                  Recommended
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Deterministic in-memory evaluation. Zero external calls.
              </p>
            </div>

            {/* Replay Mode */}
            <div
              onClick={() => !isSubmitting && setMode('replay')}
              className={cn(
                'p-3 rounded-lg border text-xs cursor-pointer transition-all flex flex-col justify-between space-y-1',
                mode === 'replay'
                  ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/50'
                  : 'border-border bg-surface-elevated/40 hover:border-slate-500'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-indigo-400" />
                  Replay Mode
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Verifies against recorded execution trace bundles.
              </p>
            </div>

            {/* Live Mode */}
            <div
              onClick={() => !isSubmitting && setMode('live')}
              className={cn(
                'p-3 rounded-lg border text-xs cursor-pointer transition-all flex flex-col justify-between space-y-1',
                mode === 'live'
                  ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/50'
                  : 'border-border bg-surface-elevated/40 hover:border-slate-500'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-amber-400" />
                  Live Mode
                </span>
                <Badge variant="warning" className="text-[10px] px-1 py-0">
                  Bounded
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Live provider calls under strict token and concurrency caps.
              </p>
            </div>
          </div>
        </div>

        {/* Case Selection Scope */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
            {t('evaluation.scopeLabel')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={cn(
                'p-2 rounded-lg text-xs font-medium border text-center transition-colors',
                scope === 'all'
                  ? 'bg-brand-500/15 border-brand-500 text-brand-600 dark:text-brand-300'
                  : 'bg-surface-elevated border-border text-slate-400 hover:text-foreground'
              )}
            >
              {t('evaluation.scopeAll')}
            </button>
            <button
              type="button"
              onClick={() => setScope('dimension')}
              className={cn(
                'p-2 rounded-lg text-xs font-medium border text-center transition-colors',
                scope === 'dimension'
                  ? 'bg-brand-500/15 border-brand-500 text-brand-600 dark:text-brand-300'
                  : 'bg-surface-elevated border-border text-slate-400 hover:text-foreground'
              )}
            >
              {t('evaluation.scopeDimension')}
            </button>
            <button
              type="button"
              onClick={() => setScope('custom')}
              className={cn(
                'p-2 rounded-lg text-xs font-medium border text-center transition-colors',
                scope === 'custom'
                  ? 'bg-brand-500/15 border-brand-500 text-brand-600 dark:text-brand-300'
                  : 'bg-surface-elevated border-border text-slate-400 hover:text-foreground'
              )}
            >
              {t('evaluation.scopeCustom')}
            </button>
          </div>

          {scope === 'dimension' && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {dimensions.map((dim) => (
                <button
                  key={dim.id}
                  type="button"
                  onClick={() => setSelectedDimension(dim.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                    selectedDimension === dim.id
                      ? 'bg-brand-500/15 border-brand-500 text-brand-600 dark:text-brand-300'
                      : 'bg-surface-elevated border-border text-slate-400 hover:text-foreground'
                  )}
                >
                  {dim.label} ({dim.count})
                </button>
              ))}
            </div>
          )}

          {scope === 'custom' && (
            <div className="pt-1 space-y-1">
              <input
                type="text"
                value={customCaseIds}
                onChange={(e) => setCustomCaseIds(e.target.value)}
                placeholder="e.g. mem_01, mem_02, conv_01 (subset of Golden Dataset)"
                className="w-full px-3 py-1.5 text-xs bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
              />
              <p className="text-[10px] text-slate-400">
                Must be an exact subset of the 56 Golden Benchmark Dataset cases.
              </p>
            </div>
          )}
        </div>

        {/* Concurrency Ceiling Setting */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
              {t('evaluation.concurrencyLabel')}
            </label>
            <span className="text-xs font-mono text-brand-400 font-bold">{concurrency} workers (max 5)</span>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setConcurrency(val)}
                className={cn(
                  'flex-1 py-1 text-xs font-mono rounded border transition-colors',
                  concurrency === val
                    ? 'bg-brand-500/20 border-brand-500 text-brand-400 font-bold'
                    : 'bg-surface-elevated border-border text-slate-400 hover:text-foreground'
                )}
              >
                {val}
              </button>
            ))}
          </div>
        </div>

        {/* Safety Guarantee Strip */}
        <div className="p-3 rounded-lg border border-border bg-surface-elevated/50 flex items-start gap-2.5 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-foreground font-medium">Production Safety Guarantee</p>
            <p className="text-[11px] leading-relaxed">
              Evaluation runner is completely decoupled from business tables. Zero writes to users, conversations, messages, or proactive channels.
            </p>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExecute}
            disabled={!isAllowedToRun || isSubmitting}
            className="flex items-center gap-1.5"
          >
            <Play className={cn('h-3.5 w-3.5', isSubmitting && 'animate-spin')} />
            <span>
              {isSubmitting
                ? 'Executing Evaluation Run...'
                : 'Start Evaluation Run'}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
