'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { AuditDetailDrawer } from '@/components/audit/audit-detail-drawer';
import {
  Search,
  Eye,
  Lock,
  RefreshCw,
  X,
  RotateCcw,
  Shield,
  Copy,
  Check,
} from 'lucide-react';
import { truncate, formatDate } from '@/lib/utils';
import { AdminAuditItem } from '@/types/admin';

function AuditContent() {
  const { t, formatRelativeTime } = useLanguage();
  const _searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [resourceFilter, setResourceFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const limit = 25;

  const [selectedAudit, setSelectedAudit] = useState<AdminAuditItem | null>(null);
  const [copiedCorrelationId, setCopiedCorrelationId] = useState<string | null>(null);

  const queryParams = useMemo(() => {
    return {
      limit,
      offset: (page - 1) * limit,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      resourceType: resourceFilter !== 'all' ? resourceFilter : undefined,
    };
  }, [page, limit, statusFilter, resourceFilter]);

  const auditQuery = useQuery({
    queryKey: ['admin-audit-logs', queryParams],
    queryFn: () => adminApi.getAuditLogs(queryParams),
  });

  const rawAuditLogs = useMemo(() => auditQuery.data?.data || [], [auditQuery.data?.data]);
  const totalRecords = auditQuery.data?.pagination?.total ?? rawAuditLogs.length;

  // Client-side text filter across loaded logs (matches actor, action, resourceId, or correlationId)
  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rawAuditLogs;

    return rawAuditLogs.filter((item) => {
      const actorMatch = (item.adminActor || item.actorId || '').toLowerCase().includes(q);
      const actionMatch = (item.action || '').toLowerCase().includes(q);
      const resTypeMatch = (item.resourceType || '').toLowerCase().includes(q);
      const resIdMatch = (item.resourceId || '').toLowerCase().includes(q);
      const corrMatch = (item.correlationId || '').toLowerCase().includes(q);
      return actorMatch || actionMatch || resTypeMatch || resIdMatch || corrMatch;
    });
  }, [rawAuditLogs, search]);

  // Operational KPI metrics computed from loaded records
  const { successCount, failureCount, mutationCount, distinctActorsCount } = useMemo(() => {
    let succ = 0;
    let fail = 0;
    let mut = 0;
    const actors = new Set<string>();

    rawAuditLogs.forEach((item) => {
      const st = (item.status || 'success').toLowerCase();
      if (st === 'success') succ++;
      else if (st === 'failure' || st === 'error') fail++;

      const act = (item.action || '').toUpperCase();
      if (
        act.includes('BAN') ||
        act.includes('VIP') ||
        act.includes('UPDATE') ||
        act.includes('ARCHIVE') ||
        act.includes('PURGE') ||
        act.includes('RETRY') ||
        act.includes('CANCEL') ||
        act.includes('DELETE') ||
        act.includes('CREATE')
      ) {
        mut++;
      }

      const actor = item.adminActor || item.actorId || 'system';
      actors.add(actor);
    });

    return {
      successCount: succ,
      failureCount: fail,
      mutationCount: mut,
      distinctActorsCount: actors.size,
    };
  }, [rawAuditLogs]);

  // Copy helper
  const handleCopyCorrelation = (corrId: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(corrId);
      setCopiedCorrelationId(corrId);
      setTimeout(() => setCopiedCorrelationId(null), 2000);
    }
  };

  const isFiltered = Boolean(search.trim() || statusFilter !== 'all' || resourceFilter !== 'all');
  const activeFiltersCount =
    (search.trim() ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (resourceFilter !== 'all' ? 1 : 0);

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setResourceFilter('all');
    setPage(1);
  };

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
              <Shield className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
              {t('audit.title')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('audit.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => auditQuery.refetch()}
            isLoading={auditQuery.isRefetching}
            className="font-mono text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 me-1.5" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* 2. Cryptographic Immutability & Compliance Invariant Notice */}
      <div className="flex items-center gap-2.5 p-3.5 rounded-lg border border-border bg-surface-elevated/40 text-slate-300 text-xs font-mono leading-relaxed">
        <Lock className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>{t('audit.invariantNotice')}</span>
      </div>

      {/* 3. Operational Audit KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('audit.kpiTotalEvents')}
          </span>
          <span className="text-xl font-bold text-foreground">
            {totalRecords}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('audit.kpiSuccessful')}
          </span>
          <span className="text-xl font-bold text-emerald-500 dark:text-emerald-400">
            {successCount}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('audit.kpiFailed')}
          </span>
          <span className="text-xl font-bold text-rose-500">
            {failureCount}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('audit.kpiMutations')}
          </span>
          <span className="text-xl font-bold text-brand-400">
            {mutationCount}
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            {t('audit.kpiActors')}
          </span>
          <span className="text-xl font-bold text-purple-400">
            {distinctActorsCount}
          </span>
        </div>
      </div>

      {/* 4. Filter Toolbar */}
      <div className="p-3.5 rounded-lg bg-surface border border-border space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-12 gap-3 items-center">
          <div className="sm:col-span-2 lg:col-span-5 relative">
            <Input
              placeholder={t('audit.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              icon={<Search className="h-3.5 w-3.5" />}
              className="h-9 text-xs font-mono"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="sm:col-span-1 lg:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setPage(1);
              }}
              className="w-full h-9 rounded-md bg-surface-elevated border border-border text-foreground px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">{t('audit.filterStatusAll')}</option>
              <option value="success">{t('audit.filterStatusSuccess')}</option>
              <option value="failure">{t('audit.filterStatusFailure')}</option>
            </select>
          </div>

          <div className="sm:col-span-1 lg:col-span-3">
            <select
              value={resourceFilter}
              onChange={(e) => {
                setResourceFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-9 rounded-md bg-surface-elevated border border-border text-foreground px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">{t('audit.filterResourceAll')}</option>
              <option value="user">{t('audit.filterResourceUser')}</option>
              <option value="conversation">{t('audit.filterResourceConversation')}</option>
              <option value="memory">{t('audit.filterResourceMemory')}</option>
              <option value="settings">{t('audit.filterResourceSettings')}</option>
              <option value="reminder">{t('audit.filterResourceReminder')}</option>
              <option value="cache">{t('audit.filterResourceCache')}</option>
            </select>
          </div>

          <div className="sm:col-span-1 lg:col-span-1 flex items-center justify-end">
            {isFiltered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-9 px-2 text-xs text-slate-400 hover:text-foreground font-mono"
                title={t('audit.clearFilters')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {isFiltered && (
          <div className="flex items-center gap-2 pt-2 border-t border-border/50 text-[11px] text-slate-400">
            <span>{t('audit.activeFilters', { count: String(activeFiltersCount) })}</span>
            <span className="text-slate-600">•</span>
            <span className="text-brand-400 font-semibold">{t('audit.filteringLoadedResults')}</span>
          </div>
        )}
      </div>

      {auditQuery.error && (
        <ErrorAlert
          error={auditQuery.error}
          title={t('audit.failedToLoad')}
          onRetry={() => auditQuery.refetch()}
        />
      )}

      {/* 5. Audit Trail Data Table */}
      <Card>
        <DataTable
          columns={[
            {
              header: t('audit.colTimestamp'),
              accessorKey: 'createdAt',
              cell: (a) => (
                <div className="space-y-0.5">
                  <span className="text-foreground font-medium block">
                    {formatDate(a.createdAt)}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {formatRelativeTime(a.createdAt)}
                  </span>
                </div>
              ),
            },
            {
              header: t('audit.colActorRole'),
              cell: (a) => {
                const actor = a.adminActor || a.actorId || 'system';
                const role = a.actorRole || 'admin';
                return (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-foreground font-mono">{actor}</span>
                    <Badge variant="purple" className="text-[10px] py-0 px-1 font-mono uppercase">
                      {role}
                    </Badge>
                  </div>
                );
              },
            },
            {
              header: t('audit.colAction'),
              accessorKey: 'action',
              cell: (a) => (
                <span className="font-mono font-bold text-brand-400 text-xs px-2 py-0.5 rounded bg-brand-500/10 border border-brand-500/20 inline-block">
                  {a.action}
                </span>
              ),
            },
            {
              header: t('audit.targetResource'),
              cell: (a) => (
                <div className="space-y-0.5 font-mono text-xs">
                  <span className="text-slate-400 uppercase text-[10px] block font-semibold">
                    {a.resourceType}
                  </span>
                  <span className="text-foreground truncate max-w-[140px] block" dir="ltr" title={a.resourceId || 'global'}>
                    {a.resourceId ? truncate(a.resourceId, 16) : 'global'}
                  </span>
                </div>
              ),
            },
            {
              header: t('audit.colResult'),
              cell: (a) => {
                const status = (a.status || 'success').toLowerCase();
                return <StatusBadge status={status === 'success' ? 'success' : 'failure'} size="sm" />;
              },
            },
            {
              header: t('audit.colCorrelationId'),
              cell: (a) => {
                if (!a.correlationId) return <span className="text-slate-600">—</span>;
                const isCopied = copiedCorrelationId === a.correlationId;
                return (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-[11px] font-mono select-all" dir="ltr">
                      {truncate(a.correlationId, 10)}
                    </span>
                    <button
                      onClick={() => handleCopyCorrelation(a.correlationId || '')}
                      aria-label={t('audit.copyCorrelationId')}
                      className="p-1 text-slate-500 hover:text-foreground transition-colors"
                      title={a.correlationId}
                    >
                      {isCopied ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                );
              },
            },
            {
              header: t('audit.colActions'),
              cell: (a) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAudit(a)}
                  className="font-mono text-xs h-7 px-2"
                >
                  <Eye className="h-3 w-3 me-1 text-brand-400" />
                  <span>{t('audit.inspectPayload')}</span>
                </Button>
              ),
            },
          ]}
          data={filteredLogs}
          isLoading={auditQuery.isLoading}
          emptyMessage={t('audit.noLogs')}
          pagination={{
            currentPage: page,
            hasMore: totalRecords !== undefined ? page * limit < totalRecords : filteredLogs.length === limit,
            onNext: () => setPage((p) => p + 1),
            onPrev: () => setPage((p) => Math.max(1, p - 1)),
            total: totalRecords,
          }}
        />
      </Card>

      {/* 6. Slide-over Audit Detail Drawer */}
      <AuditDetailDrawer
        auditItem={selectedAudit}
        isOpen={Boolean(selectedAudit)}
        onClose={() => setSelectedAudit(null)}
      />
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-center text-xs font-mono text-slate-500">
          Loading audit trail...
        </div>
      }
    >
      <AuditContent />
    </Suspense>
  );
}
