'use client';

import React, { useState } from 'react';
import { FailureCluster } from '@/types/admin';
import { useLanguage } from '@/lib/i18n/language-context';
import {
  AlertTriangle,
  Search,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface FailurePatternsTableProps {
  clusters: FailureCluster[];
  taxonomyCounts: Record<string, number>;
  totalFailures: number;
  totalEvaluated?: number;
  isLoading?: boolean;
  onSelectCase?: (caseId: string) => void;
}

export function FailurePatternsTable({
  clusters,
  taxonomyCounts,
  totalFailures,
  totalEvaluated = 56,
  isLoading = false,
  onSelectCase,
}: FailurePatternsTableProps) {
  const { t, isRtl } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredClusters = clusters.filter((c) => {
    if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        c.pattern.toLowerCase().includes(q) ||
        c.dimension.toLowerCase().includes(q) ||
        c.sampleReason.toLowerCase().includes(q) ||
        c.affectedCases.some((cs) => cs.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const categoryEntries = Object.entries(taxonomyCounts || {});

  return (
    <div className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Taxonomy Distribution Bar */}
      <div className="p-4 rounded-xl border border-border bg-surface-elevated/40 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-foreground">
              {t('evaluation.failureTaxonomyTitle')}
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {totalFailures} {t('evaluation.kpiFailureRate')} / {totalEvaluated} {t('evaluation.kpiEvaluatedCases')}
          </span>
        </div>

        {categoryEntries.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400 py-1">
            <CheckCircle2 className="w-4 h-4" />
            <span>{t('evaluation.noFailuresDetected')}</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={cn(
                'text-xs px-2.5 py-1 rounded-lg border font-mono transition-colors',
                categoryFilter === 'all'
                  ? 'bg-brand-500/20 text-brand-400 border-brand-500/40 font-bold'
                  : 'bg-surface-elevated text-slate-400 border-border hover:text-foreground'
              )}
            >
              All ({clusters.length})
            </button>
            {categoryEntries.map(([cat, count]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-lg border font-mono transition-colors flex items-center gap-1.5',
                  categoryFilter === cat
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 font-bold'
                    : 'bg-surface-elevated text-slate-400 border-border hover:text-foreground'
                )}
              >
                <span>{cat.replace(/_/g, ' ')}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-surface text-[10px] font-bold">
                  {count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pattern, case, or dimension..."
            className="w-full ps-9 pe-3 py-1.5 text-xs bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <span className="text-xs text-slate-400 font-mono">
          Showing {filteredClusters.length} of {clusters.length} patterns
        </span>
      </div>

      {/* Clusters Table */}
      {isLoading ? (
        <div className="h-48 rounded-xl bg-surface/30 animate-pulse border border-border" />
      ) : filteredClusters.length === 0 ? (
        <div className="p-10 text-center rounded-xl border border-border bg-surface-elevated/20 text-slate-400 space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
          <p className="text-sm font-medium text-foreground">
            {t('evaluation.noFailuresDetected')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface-elevated/20 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left rtl:text-right">
              <thead className="bg-surface-elevated border-b border-border text-slate-400 uppercase font-mono text-[11px]">
                <tr>
                  <th className="px-4 py-3">{t('evaluation.colPattern')}</th>
                  <th className="px-3 py-3">{t('evaluation.colDimension')}</th>
                  <th className="px-3 py-3 text-center">{t('evaluation.colOccurrences')}</th>
                  <th className="px-4 py-3">{t('evaluation.colAffectedCases')}</th>
                  <th className="px-3 py-3">{t('evaluation.colFirstSeen')}</th>
                  <th className="px-3 py-3">{t('evaluation.colLastSeen')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredClusters.map((cluster) => (
                  <tr
                    key={cluster.pattern}
                    className="hover:bg-surface-elevated/40 transition-colors"
                  >
                    <td className="px-4 py-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span className="font-mono font-bold text-foreground">
                          {cluster.pattern}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono line-clamp-1 ps-5">
                        {cluster.sampleReason}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-0.5 rounded bg-surface border border-border text-slate-300 font-mono uppercase text-[10px]">
                        {cluster.dimension}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono font-bold text-[11px]">
                        {cluster.occurrences}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {cluster.affectedCases.map((cId) => (
                          <button
                            key={cId}
                            type="button"
                            onClick={() => onSelectCase && onSelectCase(cId)}
                            className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-brand-400 hover:bg-brand-500/10 transition-colors"
                          >
                            {cId}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {new Date(cluster.firstSeen).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {new Date(cluster.lastSeen).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
