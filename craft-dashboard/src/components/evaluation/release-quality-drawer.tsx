'use client';

import React, { useState } from 'react';
import { ReleaseQualitySignal } from '@/types/admin';
import { useLanguage } from '@/lib/i18n/language-context';
import { Badge } from '@/components/ui/badge';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  Copy,
  Check,
  GitCommit,
  Server,
  Layers,
  CheckCircle2,
  XCircle,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReleaseQualityDrawerProps {
  signal: ReleaseQualitySignal | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ReleaseQualityDrawer({ signal, isOpen, onClose }: ReleaseQualityDrawerProps) {
  const { t, isRtl } = useLanguage();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen || !signal) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'approved':
        return (
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 gap-1.5 py-1 px-3 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            {t('evaluation.releaseQuality.approved')}
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30 gap-1.5 py-1 px-3 text-xs font-semibold">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            {t('evaluation.releaseQuality.rejected')}
          </Badge>
        );
      default:
        return (
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 gap-1.5 py-1 px-3 text-xs font-semibold">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            {t('evaluation.releaseQuality.notConfigured')}
          </Badge>
        );
    }
  };

  const jsonExport = JSON.stringify(signal, null, 2);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-drawer-title"
      className="fixed inset-0 z-50 overflow-hidden"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className={cn(
        'fixed inset-y-0 max-w-full flex',
        isRtl ? 'left-0' : 'right-0'
      )}>
        <div className="relative w-screen max-w-2xl bg-surface border-l border-border shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-border bg-surface-elevated/40 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 id="release-drawer-title" className="text-base font-bold text-foreground">
                    {t('evaluation.releaseQuality.signalDetails')}
                  </h2>
                  {getDecisionBadge(signal.qualityDecision)}
                </div>
                <p className="text-xs font-mono text-slate-400">
                  Run ID: {signal.runId}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-foreground hover:bg-surface-elevated transition-colors"
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 1. Release Provenance Cards */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <GitCommit className="w-4 h-4 text-brand-400" />
                {t('evaluation.releaseQuality.provenanceIdentity')}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                    {t('evaluation.releaseQuality.commitSha')}
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-foreground">
                      {signal.releaseMetadata.commitSha || 'Not Tracked'}
                    </span>
                    {signal.releaseMetadata.commitSha && (
                      <button
                        onClick={() => handleCopy(signal.releaseMetadata.commitSha!, 'commit')}
                        className="p-1 text-slate-400 hover:text-foreground rounded"
                        title={t('common.copy')}
                      >
                        {copiedKey === 'commit' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                    {t('evaluation.releaseQuality.environment')}
                  </span>
                  <Badge variant="neutral" className="text-xs font-mono">
                    {signal.releaseMetadata.environment || 'Not Tracked'}
                  </Badge>
                </div>

                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                    {t('evaluation.releaseQuality.deploymentId')}
                  </span>
                  <span className="text-xs font-mono text-slate-300">
                    {signal.releaseMetadata.deploymentId || 'Not Tracked'}
                  </span>
                </div>

                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                    {t('evaluation.releaseQuality.version')}
                  </span>
                  <span className="text-xs font-mono text-slate-300">
                    {signal.releaseMetadata.deploymentVersion || 'Not Tracked'}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Dataset Provenance Card */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-brand-400" />
                {t('evaluation.releaseQuality.datasetProvenance')}
              </h3>
              <div className="p-4 rounded-xl border border-border bg-surface-elevated/20 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-foreground mb-0.5">
                    {signal.datasetProvenance.datasetVersion}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {signal.datasetProvenance.caseCount > 0
                      ? `${signal.datasetProvenance.caseCount} Cases across ${signal.datasetProvenance.dimensionsCount} Dimensions`
                      : 'Custom evaluation benchmark suite'}
                  </p>
                </div>
                <Badge variant="neutral" className={cn(
                  'text-xs font-mono',
                  signal.datasetProvenance.source === 'source-controlled'
                    ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                    : 'border-slate-700 text-slate-400'
                )}>
                  {signal.datasetProvenance.source}
                </Badge>
              </div>
            </div>

            {/* 3. Quality Gate Compliance Checklist */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-brand-400" />
                {t('evaluation.releaseQuality.gateCriteria')}
              </h3>
              <div className="space-y-2">
                {signal.qualityGate.checks.map((c) => (
                  <div
                    key={c.criterion}
                    className="p-3 rounded-xl border border-border bg-surface-elevated/30 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      {c.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <div>
                        <span className="text-xs font-semibold text-foreground block">
                          {c.label}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {c.message}
                        </span>
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs">
                      <span className="text-slate-400 block text-[10px]">Actual / Threshold</span>
                      <span className={cn('font-bold', c.passed ? 'text-emerald-400' : 'text-rose-400')}>
                        {c.actual} / {c.threshold}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {signal.qualityGate.failureReasons.length > 0 && (
                <div className="mt-3 p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs space-y-1">
                  <span className="font-semibold block">{t('evaluation.releaseQuality.gateFailureSummary')}:</span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-200">
                    {signal.qualityGate.failureReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 4. Execution Metrics Summary */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Server className="w-4 h-4 text-brand-400" />
                {t('evaluation.releaseQuality.metricsSummary')}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">Pass Rate</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">{signal.metrics.passRate}%</span>
                </div>
                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">Score</span>
                  <span className="text-sm font-bold font-mono text-foreground">{signal.metrics.overallScore}%</span>
                </div>
                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">Failures</span>
                  <span className="text-sm font-bold font-mono text-rose-400">{signal.metrics.failedCases}</span>
                </div>
                <div className="p-3 rounded-xl border border-border bg-surface-elevated/20">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block mb-1">Regressions</span>
                  <span className="text-sm font-bold font-mono text-amber-400">{signal.metrics.regressionCount}</span>
                </div>
              </div>
            </div>

            {/* 5. Machine-Readable CI JSON */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t('evaluation.releaseQuality.ciPayload')}
                </h3>
                <button
                  onClick={() => handleCopy(jsonExport, 'json')}
                  className="flex items-center gap-1 text-[11px] font-mono text-brand-400 hover:text-brand-300"
                >
                  {copiedKey === 'json' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'json' ? t('common.copied') : t('evaluation.releaseQuality.copyJson')}
                </button>
              </div>
              <pre className="p-3.5 rounded-xl border border-border bg-slate-950 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-48">
                {jsonExport}
              </pre>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border bg-surface-elevated/40 flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-500">
              Evaluated: {new Date(signal.generatedAt).toLocaleString()}
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-foreground hover:bg-surface-elevated transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
