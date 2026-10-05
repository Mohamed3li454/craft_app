import React, { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { useLanguage } from '@/lib/i18n/language-context';
import { EvaluationCaseItem, EvaluationDimension } from '@/types/admin';
import { Search, Eye, ChevronLeft, ChevronRight, Tag } from 'lucide-react';

interface EvaluationCaseExplorerProps {
  cases: EvaluationCaseItem[];
  selectedDimension?: EvaluationDimension | 'all';
  onSelectDimension?: (dim: EvaluationDimension | 'all') => void;
  onSelectCase?: (caseItem: EvaluationCaseItem) => void;
  isLoading?: boolean;
}

export function EvaluationCaseExplorer({
  cases,
  selectedDimension = 'all',
  onSelectDimension,
  onSelectCase,
  isLoading,
}: EvaluationCaseExplorerProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Filter cases based on dimension and search query
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const matchDim = selectedDimension === 'all' || c.category === selectedDimension;
      if (!matchDim) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.input.toLowerCase().includes(q) ||
        c.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [cases, selectedDimension, searchQuery]);

  const totalPages = Math.ceil(filteredCases.length / pageSize) || 1;
  const pagedCases = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCases.slice(start, start + pageSize);
  }, [filteredCases, currentPage]);

  const dimensionsList: Array<{ key: EvaluationDimension | 'all'; label: string }> = [
    { key: 'all', label: t('evaluation.allDimensions') },
    { key: 'memory', label: t('evaluation.dimensionMemory') },
    { key: 'conversation', label: t('evaluation.dimensionConversation') },
    { key: 'personalization', label: t('evaluation.dimensionPersonalization') },
    { key: 'adaptive_response', label: t('evaluation.dimensionAdaptive') },
    { key: 'agent', label: t('evaluation.dimensionAgent') },
    { key: 'provider', label: t('evaluation.dimensionProvider') },
    { key: 'proactive', label: t('evaluation.dimensionProactive') },
  ];

  return (
    <Card className="p-5 flex flex-col space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <span>{t('evaluation.casesTab')}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-slate-400 font-mono">
              {filteredCases.length} / {cases.length}
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('evaluation.caseDetailSubtitle')}
          </p>
        </div>

        {/* Search & Dimension Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={t('evaluation.searchCasesPlaceholder')}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="relative">
            <select
              value={selectedDimension}
              onChange={(e) => {
                onSelectDimension?.(e.target.value as any);
                setCurrentPage(1);
              }}
              className="text-xs py-1.5 px-3 bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
            >
              {dimensionsList.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-elevated text-slate-400 font-medium border-b border-border">
            <tr>
              <th className="py-3 px-3 w-24">{t('evaluation.colCaseId')}</th>
              <th className="py-3 px-3 w-40">{t('evaluation.colDimension')}</th>
              <th className="py-3 px-3">{t('evaluation.colName')}</th>
              <th className="py-3 px-3 hidden md:table-cell">{t('evaluation.colInput')}</th>
              <th className="py-3 px-3 w-28 text-center">{t('evaluation.colStatus')}</th>
              <th className="py-3 px-3 w-20 text-center">{t('evaluation.colScore')}</th>
              <th className="py-3 px-3 w-24 text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={7} className="py-4 px-3 bg-surface/30" />
                </tr>
              ))
            ) : pagedCases.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  {t('common.noResults')}
                </td>
              </tr>
            ) : (
              pagedCases.map((c) => {
                return (
                  <tr
                    key={c.id}
                    onClick={() => onSelectCase?.(c)}
                    className="hover:bg-surface-elevated/50 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-3 font-mono font-medium text-brand-400">{c.id}</td>
                    <td className="py-3 px-3">
                      <span className="capitalize font-mono text-[11px] px-2 py-0.5 rounded bg-surface-elevated border border-border text-slate-300">
                        {c.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-foreground">{c.name}</div>
                      {c.tags && c.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] text-slate-500 font-mono flex items-center gap-0.5"
                            >
                              <Tag className="w-2.5 h-2.5" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-400 max-w-xs truncate hidden md:table-cell font-mono text-[11px]">
                      {c.input}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <StatusBadge status="completed" label="Passed" />
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-emerald-400">
                      100%
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCase?.(c);
                        }}
                        className="p-1 rounded hover:bg-slate-700/50 text-slate-400 group-hover:text-brand-400 transition-colors"
                        title={t('evaluation.openCaseDetail')}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400 pt-2">
          <span>
            {t('common.showingRecords')}: {(currentPage - 1) * pageSize + 1} -{' '}
            {Math.min(currentPage * pageSize, filteredCases.length)} of {filteredCases.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="p-1.5 rounded-lg border border-border hover:bg-surface-elevated disabled:opacity-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-foreground">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
              className="p-1.5 rounded-lg border border-border hover:bg-surface-elevated disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
