'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EvaluationRunItem, QualityGateEvaluationResult, QualityReleaseSnapshot } from '@/types/admin';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  FileCode2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QualityGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  run: EvaluationRunItem | null;
}

export function QualityGateModal({ isOpen, onClose, run }: QualityGateModalProps) {
  const { t, isRtl } = useLanguage();
  const [copied, setCopied] = useState(false);

  // Fetch Quality Gate Compliance
  const { data: gateResponse, isLoading: isGateLoading } = useQuery({
    queryKey: ['evaluation-quality-gate', run?.id],
    queryFn: () => (run ? adminApi.getEvaluationQualityGate(run.id) : null),
    enabled: Boolean(isOpen && run?.id),
  });

  // Fetch Release Snapshot
  const { data: snapshotResponse, isLoading: isSnapshotLoading } = useQuery({
    queryKey: ['evaluation-quality-snapshot', run?.id],
    queryFn: () => (run ? adminApi.getEvaluationQualitySnapshot(run.id) : null),
    enabled: Boolean(isOpen && run?.id),
  });

  if (!isOpen || !run) return null;

  const gateResult: QualityGateEvaluationResult | undefined = gateResponse?.data;
  const snapshot: QualityReleaseSnapshot | undefined = snapshotResponse?.data;

  const handleCopySnapshot = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'passed':
        return (
          <Badge variant="success" className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Passed</span>
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="danger" className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5" />
            <span>Failed</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="neutral" className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{t('evaluation.notConfigured')}</span>
          </Badge>
        );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quality-gate-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="relative w-full max-w-2xl rounded-xl border border-border bg-surface p-6 shadow-2xl space-y-5 text-start max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'p-2.5 rounded-lg border',
                gateResult?.status === 'passed'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : gateResult?.status === 'failed'
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  : 'bg-slate-800 border-border text-slate-400'
              )}
            >
              {gateResult?.status === 'passed' ? (
                <ShieldCheck className="h-5 w-5" />
              ) : gateResult?.status === 'failed' ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <HelpCircle className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="quality-gate-modal-title" className="text-base font-bold text-foreground">
                  {t('evaluation.qualityGateTitle')}
                </h2>
                {getStatusBadge(gateResult?.status)}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Run ID: {run.id} • {run.datasetVersion}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Loading state */}
        {isGateLoading ? (
          <div className="space-y-3 py-6">
            <div className="h-16 rounded-lg bg-surface-elevated animate-pulse border border-border" />
            <div className="h-28 rounded-lg bg-surface-elevated animate-pulse border border-border" />
          </div>
        ) : (
          <>
            {/* Unconfigured Notice */}
            {!gateResult?.policyConfigured && (
              <div className="p-3.5 rounded-lg border border-slate-700 bg-surface-elevated text-xs text-slate-300 space-y-1">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-slate-400" />
                  <span>Quality Gate Policy Not Configured</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  No automated quality thresholds are defined in the environment. Set{' '}
                  <code className="px-1 py-0.5 rounded bg-slate-800 font-mono text-[10px]">
                    QUALITY_GATE_MIN_PASS_RATE
                  </code>
                  ,{' '}
                  <code className="px-1 py-0.5 rounded bg-slate-800 font-mono text-[10px]">
                    QUALITY_GATE_MAX_REGRESSIONS
                  </code>{' '}
                  to activate hard release gating.
                </p>
              </div>
            )}

            {/* Criteria Checklist */}
            <div className="space-y-2.5">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Deterministic Policy Criteria
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(gateResult?.checks || []).map((check) => (
                  <div
                    key={check.criterion}
                    className={cn(
                      'p-3 rounded-lg border text-xs flex flex-col justify-between space-y-2',
                      check.passed
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : check.threshold === 'Not Configured'
                        ? 'border-border bg-surface-elevated/40'
                        : 'border-rose-500/20 bg-rose-500/5'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{check.label}</span>
                      {check.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : check.threshold === 'Not Configured' ? (
                        <span className="text-[10px] font-mono text-slate-500">N/A</span>
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/40 font-mono">
                      <span className="text-slate-400">
                        Req: <span className="text-foreground">{check.threshold}</span>
                      </span>
                      <span className="text-slate-400">
                        Actual:{' '}
                        <span className={check.passed ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {check.actual}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Failure Reasons list if failed */}
            {gateResult?.failureReasons && gateResult.failureReasons.length > 0 && (
              <div className="p-3.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-400 space-y-1.5">
                <span className="font-semibold text-rose-300 block">Failure Violations:</span>
                <ul className="list-disc list-inside space-y-1 text-[11px]">
                  {gateResult.failureReasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Quality Release Snapshot Preview */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <FileCode2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Quality Release Snapshot (Sanitized)</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopySnapshot}
                  disabled={!snapshot || isSnapshotLoading}
                  className="h-7 text-xs flex items-center gap-1.5"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t('evaluation.snapshotCopied')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t('evaluation.btnCopySnapshot')}</span>
                    </>
                  )}
                </Button>
              </div>

              {snapshot && (
                <div className="p-3 rounded-lg bg-surface-elevated border border-border text-[11px] font-mono text-slate-300 space-y-1 overflow-x-auto max-h-40">
                  <div className="text-slate-500 font-sans text-[10px] pb-1 border-b border-border flex items-center justify-between">
                    <span>Zero CoT • Zero Credentials • Factual Scores</span>
                    <span>{snapshot.snapshotGeneratedAt}</span>
                  </div>
                  <pre className="text-[10px] text-slate-300">
                    {JSON.stringify(
                      {
                        runId: snapshot.runId,
                        datasetVersion: snapshot.datasetVersion,
                        passRate: `${snapshot.passRate}%`,
                        overallScore: `${snapshot.overallScore}%`,
                        regressions: snapshot.regressionCount,
                        dimensionScores: Object.fromEntries(
                          Object.entries(snapshot.dimensionScores).map(([k, v]) => [k, `${v.passRate}%`])
                        ),
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
