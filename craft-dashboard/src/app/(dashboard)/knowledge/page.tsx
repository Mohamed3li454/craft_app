'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Tabs } from '@/components/ui/tabs';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ErrorAlert } from '@/components/ui/error-alert';
import { BookOpen, Zap, Plus, Trash2, CheckCircle2, XCircle, ArrowUpRight } from 'lucide-react';
import { formatNumber, formatCurrency, truncate } from '@/lib/utils';

export default function KnowledgePage() {
  const { canMutate } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'faq' | 'cache'>('faq');

  // New FAQ form state
  const [showAddFaq, setShowAddFaq] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [newCategory, setNewCategory] = useState('general');

  // Queries
  const faqsQuery = useQuery({
    queryKey: ['admin-faqs'],
    queryFn: () => adminApi.getFaqs(),
    enabled: activeTab === 'faq',
  });

  const cacheMetricsQuery = useQuery({
    queryKey: ['admin-cache-metrics'],
    queryFn: () => adminApi.getCacheMetrics(),
    enabled: activeTab === 'cache',
  });

  const cacheCandidatesQuery = useQuery({
    queryKey: ['admin-cache-candidates'],
    queryFn: () => adminApi.getCacheCandidates(),
    enabled: activeTab === 'cache',
  });

  const faqs = faqsQuery.data?.data || [];
  const cacheMetrics = cacheMetricsQuery.data?.data;
  const cacheCandidates = cacheCandidatesQuery.data?.data || [];

  // FAQ Mutations
  const createFaqMutation = useMutation({
    mutationFn: (data: { question: string; answer: string; category?: string }) =>
      adminApi.createFaq(data),
    onSuccess: () => {
      setShowAddFaq(false);
      setNewQuestion('');
      setNewAnswer('');
      queryClient.invalidateQueries({ queryKey: ['admin-faqs'] });
    },
  });

  const deleteFaqMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteFaq(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-faqs'] });
    },
  });

  // Cache Mutations
  const validateCandidateMutation = useMutation({
    mutationFn: (id: string) => adminApi.validateCacheCandidate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cache-candidates'] });
    },
  });

  const rejectCandidateMutation = useMutation({
    mutationFn: (id: string) => adminApi.rejectCacheCandidate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cache-candidates'] });
    },
  });

  const promoteCandidateMutation = useMutation({
    mutationFn: (id: string) => adminApi.promoteCacheCandidate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cache-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['admin-cache-metrics'] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            KNOWLEDGE BASE & SEMANTIC CACHE
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Operational FAQs, automated vector semantic cache, and candidate promotion queue
          </p>
        </div>

        {activeTab === 'faq' && canMutate && (
          <Button variant="primary" size="sm" onClick={() => setShowAddFaq(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add FAQ Entry
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'faq', label: 'FAQ Knowledge Base', icon: <BookOpen className="h-3.5 w-3.5" /> },
          { id: 'cache', label: 'Semantic Cache & Learning', icon: <Zap className="h-3.5 w-3.5" /> },
        ]}
        activeTab={activeTab}
        onChange={(t) => setActiveTab(t as any)}
      />

      {(faqsQuery.error || cacheMetricsQuery.error || cacheCandidatesQuery.error || createFaqMutation.error || deleteFaqMutation.error || validateCandidateMutation.error || rejectCandidateMutation.error || promoteCandidateMutation.error) && (
        <ErrorAlert
          error={(faqsQuery.error || cacheMetricsQuery.error || cacheCandidatesQuery.error || createFaqMutation.error || deleteFaqMutation.error || validateCandidateMutation.error || rejectCandidateMutation.error || promoteCandidateMutation.error) as any}
          title="Knowledge Subsystem Error"
          onRetry={() => {
            if (activeTab === 'faq') faqsQuery.refetch();
            else {
              cacheMetricsQuery.refetch();
              cacheCandidatesQuery.refetch();
            }
          }}
        />
      )}

      {/* Tab 1: FAQ Knowledge Base */}
      {activeTab === 'faq' && (
        <div className="space-y-4">
          <DataTable
            columns={[
              {
                header: 'Question',
                accessorKey: 'question',
                cell: (f) => <span className="font-semibold text-slate-100">{f.question}</span>,
              },
              {
                header: 'Category',
                accessorKey: 'category',
                cell: (f) => <Badge variant="info">{f.category || 'general'}</Badge>,
              },
              {
                header: 'Answer',
                accessorKey: 'answer',
                cell: (f) => <span className="text-slate-300 font-sans">{truncate(f.answer, 80)}</span>,
              },
              {
                header: 'State',
                accessorKey: 'isActive',
                cell: (f) => <StatusPill status={f.isActive ? 'active' : 'inactive'} />,
              },
              {
                header: 'Actions',
                cell: (f) => (
                  <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                    {canMutate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteFaqMutation.mutate(f.id)}
                        isLoading={deleteFaqMutation.isPending}
                        title="Delete FAQ"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
            data={faqs}
            isLoading={faqsQuery.isLoading}
            emptyMessage="No FAQ knowledge items registered"
          />
        </div>
      )}

      {/* Tab 2: Semantic Cache */}
      {activeTab === 'cache' && (
        <div className="space-y-6">
          {/* Cache Telemetry KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono">
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Active Vector Entries</span>
              <span className="text-xl font-bold text-slate-100 mt-1 block">
                {formatNumber(cacheMetrics?.totalEntries)}
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Cache Hits / Misses</span>
              <span className="text-xl font-bold text-slate-100 mt-1 block">
                {formatNumber(cacheMetrics?.hitCount)} / {formatNumber(cacheMetrics?.missCount)}
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Cache Hit Rate</span>
              <span className="text-xl font-bold text-emerald-400 mt-1 block">
                {cacheMetrics?.hitRatePercent ?? 0}%
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">Estimated AI Cost Saved</span>
              <span className="text-xl font-bold text-cyan-400 mt-1 block">
                {formatCurrency(cacheMetrics?.estimatedSavingsUsd)}
              </span>
            </Card>
          </div>

          {/* Learning Candidates Table */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Zap className="h-4 w-4 text-brand-400" />
                Cache Learning Candidates (Promotion Queue)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={[
                  {
                    header: 'User Query Prompt',
                    accessorKey: 'prompt',
                    cell: (c) => <span className="font-semibold text-slate-100">{c.prompt}</span>,
                  },
                  {
                    header: 'Canonical Cached Response',
                    accessorKey: 'canonicalAnswer',
                    cell: (c) => <span className="text-slate-300 font-sans">{truncate(c.canonicalAnswer, 80)}</span>,
                  },
                  {
                    header: 'Similarity',
                    accessorKey: 'similarityScore',
                    cell: (c) => (
                      <span className="font-bold text-amber-300">
                        {Math.round((c.similarityScore || 0) * 100)}%
                      </span>
                    ),
                  },
                  {
                    header: 'Status',
                    accessorKey: 'status',
                    cell: (c) => <StatusPill status={c.status} />,
                  },
                  {
                    header: 'Actions',
                    cell: (c) => (
                      <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                        {canMutate && c.status === 'pending' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => validateCandidateMutation.mutate(c.id)}
                              isLoading={validateCandidateMutation.isPending}
                              title="Validate Candidate"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                              Validate
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => promoteCandidateMutation.mutate(c.id)}
                              isLoading={promoteCandidateMutation.isPending}
                              title="Promote to Production Cache"
                            >
                              <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                              Promote
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => rejectCandidateMutation.mutate(c.id)}
                              isLoading={rejectCandidateMutation.isPending}
                              title="Reject Candidate"
                            >
                              <XCircle className="h-3.5 w-3.5 text-rose-400" />
                            </Button>
                          </>
                        )}
                      </div>
                    ),
                  },
                ]}
                data={cacheCandidates}
                isLoading={cacheCandidatesQuery.isLoading}
                emptyMessage="No pending cache learning candidates"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add FAQ Modal */}
      <ConfirmModal
        isOpen={showAddFaq}
        onClose={() => setShowAddFaq(false)}
        onConfirm={() =>
          createFaqMutation.mutate({
            question: newQuestion.trim(),
            answer: newAnswer.trim(),
            category: newCategory.trim() || 'general',
          })
        }
        title="Add FAQ Knowledge Entry"
        description="This question and answer pair will be accessible to the agent during intent resolution."
        confirmText="Save FAQ"
        isLoading={createFaqMutation.isPending}
      >
        <div className="space-y-3 font-mono text-xs">
          <div>
            <label className="text-slate-400 block mb-1">Question</label>
            <Input
              placeholder="e.g. What are your opening hours?"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Category</label>
            <Input
              placeholder="e.g. general, pricing, support"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Answer</label>
            <textarea
              className="w-full h-24 rounded-md border border-border bg-surface-elevated p-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 font-sans"
              placeholder="Enter official response text..."
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
              required
            />
          </div>
        </div>
      </ConfirmModal>
    </div>
  );
}
