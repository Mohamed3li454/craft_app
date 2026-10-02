'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { Button } from './button';
import { useLanguage } from '@/lib/i18n/language-context';

export interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  pagination?: {
    currentPage?: number;
    hasMore?: boolean;
    onNext?: () => void;
    onPrev?: () => void;
    total?: number;
  };
  className?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  isLoading,
  emptyMessage,
  onRowClick,
  pagination,
  className,
}: DataTableProps<T>) {
  const { t, isRtl } = useLanguage();
  const effectiveEmptyMessage = emptyMessage || t('common.noResults');

  // Directional icons: in RTL, Next is Left arrow, Previous is Right arrow
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className={cn('w-full flex flex-col rounded-lg border border-border bg-surface overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-xs sm:text-sm">
          <thead className="bg-surface-elevated/70 text-slate-400 uppercase font-mono text-[11px] tracking-wider border-b border-border">
            <tr>
              {columns.map((col, idx) => (
                <th key={idx} className={cn('px-4 py-3 font-semibold select-none text-start', col.className)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 font-mono">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, rIdx) => (
                <tr key={rIdx} className="animate-pulse">
                  {columns.map((_, cIdx) => (
                    <td key={cIdx} className="px-4 py-3">
                      <div className="h-4 bg-surface-elevated rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Inbox className="h-8 w-8 text-slate-400" />
                    <span>{effectiveEmptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item, rowIdx) => (
                <tr
                  key={item.id || rowIdx}
                  onClick={() => onRowClick && onRowClick(item)}
                  className={cn(
                    'transition-colors hover:bg-surface-elevated/50',
                    onRowClick ? 'cursor-pointer' : ''
                  )}
                >
                  {columns.map((col, colIdx) => (
                    <td key={colIdx} className={cn('px-4 py-3 text-slate-200 text-xs sm:text-sm align-middle text-start', col.className)}>
                      {col.cell ? col.cell(item) : (col.accessorKey ? String(item[col.accessorKey] ?? '—') : '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface-elevated/40 text-xs font-mono text-slate-400">
          <div>
            {pagination.total !== undefined ? (
              <span>
                {t('common.totalRecords', { count: String(pagination.total) })}
              </span>
            ) : (
              <span>
                {t('common.showingRecords', { count: String(data.length) })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={pagination.onPrev}
              disabled={!pagination.currentPage || pagination.currentPage <= 1 || isLoading}
            >
              <PrevIcon className="h-3.5 w-3.5 me-1" />
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={pagination.onNext}
              disabled={!pagination.hasMore || isLoading}
            >
              {t('common.next')}
              <NextIcon className="h-3.5 w-3.5 ms-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
