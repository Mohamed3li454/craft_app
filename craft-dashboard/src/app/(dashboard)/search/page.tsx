'use client';

import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Search, Play, ExternalLink, Globe } from 'lucide-react';
import { formatRelativeTime, truncate } from '@/lib/utils';
import { SearchDiagnosticResult } from '@/types/admin';

export default function SearchPage() {
  const [testQuery, setTestQuery] = useState('');
  const [testIntent, setTestIntent] = useState('factual_lookup');
  const [diagnosticResult, setDiagnosticResult] = useState<SearchDiagnosticResult | null>(null);

  // Recent Searches Query
  const recentSearchesQuery = useQuery({
    queryKey: ['admin-search-recent'],
    queryFn: () => adminApi.getRecentSearches(),
  });

  const recentSearches = recentSearchesQuery.data?.data || [];

  // Diagnostic Probe Mutation
  const diagnosticMutation = useMutation({
    mutationFn: () => adminApi.runSearchDiagnostic(testQuery.trim(), testIntent),
    onSuccess: (res) => {
      setDiagnosticResult(res.data);
    },
  });

  const handleRunDiagnostic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim()) return;
    diagnosticMutation.mutate();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            SEARCH INTELLIGENCE & DIAGNOSTIC SANDBOX
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Real-time web query logs, search intent distribution, and interactive provider probe
          </p>
        </div>
      </div>

      {(recentSearchesQuery.error || diagnosticMutation.error) && (
        <ErrorAlert
          error={(recentSearchesQuery.error || diagnosticMutation.error) as any}
          title="Search Subsystem Alert"
          onRetry={() => {
            if (recentSearchesQuery.error) recentSearchesQuery.refetch();
          }}
        />
      )}

      {/* Interactive Search Diagnostic Sandbox */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Globe className="h-4 w-4 text-cyan-400" />
            Dry-Run Search Provider Diagnostic Probe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleRunDiagnostic} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <Input
                placeholder="Enter test search query (e.g. current gold price in Egypt)..."
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                icon={<Search className="h-4 w-4" />}
                required
              />
            </div>
            <div>
              <select
                value={testIntent}
                onChange={(e) => setTestIntent(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-surface-elevated px-3 text-xs font-mono text-slate-200 focus:outline-none"
              >
                <option value="factual_lookup">Intent: Factual Lookup</option>
                <option value="price_inquiry">Intent: Price Inquiry</option>
                <option value="news_recent">Intent: Recent News</option>
                <option value="technical">Intent: Technical / Code</option>
              </select>
            </div>
            <div>
              <Button
                type="submit"
                variant="brand"
                className="w-full h-9 font-mono text-xs"
                isLoading={diagnosticMutation.isPending}
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                Probe Provider
              </Button>
            </div>
          </form>

          {/* Diagnostic Result Preview */}
          {diagnosticResult && (
            <div className="p-4 rounded-lg bg-surface-elevated/40 border border-border font-mono text-xs space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-400">Provider:</span>
                  <Badge variant="info">{diagnosticResult.provider}</Badge>
                  <span className="text-slate-400 ml-2">Latency:</span>
                  <span className="font-bold text-slate-200">{diagnosticResult.latencyMs}ms</span>
                </div>
                <StatusPill status={diagnosticResult.status} />
              </div>

              <div>
                <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">
                  Sample Results ({diagnosticResult.sampleResults?.length || 0})
                </span>
                <div className="space-y-2">
                  {diagnosticResult.sampleResults?.map((res, i) => (
                    <div key={i} className="p-2.5 rounded bg-surface border border-border/40 space-y-1">
                      <div className="flex items-center justify-between">
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-brand-300 hover:underline flex items-center gap-1"
                        >
                          {res.title}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <span className="text-[10px] text-slate-400">{truncate(res.url, 40)}</span>
                      </div>
                      <p className="text-slate-300 font-sans text-xs leading-relaxed">{res.snippet}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Searches Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Search className="h-4 w-4 text-brand-400" />
            Recent Production Searches
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={[
              {
                header: 'Search Query',
                accessorKey: 'query',
                cell: (s) => <span className="font-semibold text-slate-100">{s.query}</span>,
              },
              {
                header: 'Intent',
                accessorKey: 'intent',
                cell: (s) => <Badge variant="purple">{s.intent || 'general'}</Badge>,
              },
              {
                header: 'Results Returned',
                accessorKey: 'resultCount',
                cell: (s) => <span className="text-slate-300">{s.resultCount ?? 0}</span>,
              },
              {
                header: 'Latency',
                accessorKey: 'latencyMs',
                cell: (s) => <span className="text-slate-200">{s.latencyMs || 0}ms</span>,
              },
              {
                header: 'Executed At',
                accessorKey: 'createdAt',
                cell: (s) => formatRelativeTime(s.createdAt),
              },
            ]}
            data={recentSearches}
            isLoading={recentSearchesQuery.isLoading}
            emptyMessage="No search telemetry queries recorded"
          />
        </CardContent>
      </Card>
    </div>
  );
}
