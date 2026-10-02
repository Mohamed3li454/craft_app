'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
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
import { truncate } from '@/lib/utils';

export default function KnowledgePage() {
  const { canMutate } = useAuth();
  const { t, formatNumber, formatCurrency } = useLanguage();
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
            {t('knowledge.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('knowledge.subtitle')}
          </p>
        </div>

        {activeTab === 'faq' && canMutate && (
          <Button variant="primary" size="sm" onClick={() => setShowAddFaq(true)}>
            <Plus className="h-3.5 w-3.5 me-1" />
            {t('knowledge.btnAddFaq')}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'faq', label: t('knowledge.tabFaq'), icon: <BookOpen className="h-3.5 w-3.5" /> },
          { id: 'cache', label: t('knowledge.tabCache'), icon: <Zap className="h-3.5 w-3.5" /> },
        ]}
        activeTab={activeTab}
        onChange={(tId) => setActiveTab(tId as any)}
      />

      {(faqsQuery.error || cacheMetricsQuery.error || cacheCandidatesQuery.error || createFaqMutation.error || deleteFaqMutation.error || validateCandidateMutation.error || rejectCandidateMutation.error || promoteCandidateMutation.error) && (
        <ErrorAlert
          error={(faqsQuery.error || cacheMetricsQuery.error || cacheCandidatesQuery.error || createFaqMutation.error || deleteFaqMutation.error || validateCandidateMutation.error || rejectCandidateMutation.error || promoteCandidateMutation.error) as any}
          title={t('knowledge.subsystemError')}
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
                header: t('knowledge.colQuestion'),
                accessorKey: 'question',
                cell: (f) => <span className="font-semibold text-slate-100">{f.question}</span>,
              },
              {
                header: t('knowledge.colCategory'),
                accessorKey: 'category',
                cell: (f) => <Badge variant="info">{f.category || 'general'}</Badge>,
              },
              {
                header: t('knowledge.colAnswer'),
                accessorKey: 'answer',
                cell: (f) => <span className="text-slate-300 font-sans">{truncate(f.answer, 80)}</span>,
              },
              {
                header: t('common.status'),
                accessorKey: 'isActive',
                cell: (f) => <StatusPill status={f.isActive ? 'active' : 'inactive'} />,
              },
              {
                header: t('common.actions'),
                cell: (f) => (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {canMutate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteFaqMutation.mutate(f.id)}
                        isLoading={deleteFaqMutation.isPending}
                        title={t('knowledge.deleteFaq')}
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
            emptyMessage={t('knowledge.noFaqs')}
          />
        </div>
      )}

      {/* Tab 2: Semantic Cache */}
      {activeTab === 'cache' && (
        <div className="space-y-6">
          {/* Cache Telemetry KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono">
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">{t('knowledge.activeVectorEntries')}</span>
              <span className="text-xl font-bold text-slate-100 mt-1 block">
                {formatNumber(cacheMetrics?.totalEntries)}
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">{t('knowledge.hitsMisses')}</span>
              <span className="text-xl font-bold text-slate-100 mt-1 block">
                {formatNumber(cacheMetrics?.hitCount)} / {formatNumber(cacheMetrics?.missCount)}
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">{t('knowledge.cacheHitRate')}</span>
              <span className="text-xl font-bold text-emerald-400 mt-1 block">
                {cacheMetrics?.hitRatePercent ?? 0}%
              </span>
            </Card>
            <Card className="p-4">
              <span className="text-[10px] text-slate-400 uppercase block">{t('knowledge.estimatedSavings')}</span>
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
                {t('knowledge.promotionQueueTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={[
                  {
                    header: t('knowledge.queryPrompt'),
                    accessorKey: 'prompt',
                    cell: (c) => <span className="font-semibold text-slate-100">{c.prompt}</span>,
                  },
                  {
                    header: t('knowledge.canonicalResponse'),
                    accessorKey: 'canonicalAnswer',
                    cell: (c) => <span className="text-slate-300 font-sans">{truncate(c.canonicalAnswer, 80)}</span>,
                  },
                  {
                    header: t('knowledge.colSimilarity'),
                    accessorKey: 'similarityScore',
                    cell: (c) => (
                      <span className="font-bold text-amber-300">
                        {Math.round((c.similarityScore || 0) * 100)}%
                      </span>
                    ),
                  },
                  {
                    header: t('common.status'),
                    accessorKey: 'status',
                    cell: (c) => <StatusPill status={c.status} />,
                  },
                  {
                    header: t('common.actions'),
                    cell: (c) => (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {canMutate && c.status === 'pending' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => validateCandidateMutation.mutate(c.id)}
                              isLoading={validateCandidateMutation.isPending}
                              title={t('knowledge.btnValidate')}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 me-1 text-emerald-400" />
                              {t('knowledge.btnValidate')}
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => promoteCandidateMutation.mutate(c.id)}
                              isLoading={promoteCandidateMutation.isPending}
                              title={t('knowledge.btnPromote')}
                            >
                              <ArrowUpRight className="h-3.5 w-3.5 me-1" />
                              {t('knowledge.btnPromote')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => rejectCandidateMutation.mutate(c.id)}
                              isLoading={rejectCandidateMutation.isPending}
                              title={t('knowledge.btnReject')}
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
                emptyMessage={t('knowledge.noCandidates')}
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
        title={t('knowledge.addFaqTitle')}
        description={t('knowledge.subtitle')}
        confirmText={t('knowledge.saveFaq')}
        isLoading={createFaqMutation.isPending}
      >
        <div className="space-y-3 font-mono text-xs">
          <div>
            <label className="text-slate-400 block mb-1">{t('knowledge.questionLabel')}</label>
            <Input
              placeholder="e.g. What are your opening hours?"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">{t('knowledge.categoryLabel')}</label>
            <Input
              placeholder="e.g. general, pricing, support"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">{t('knowledge.answerLabel')}</label>
            <textarea
              className="w-full h-24 rounded-md border border-border bg-surface-elevated p-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 font-sans"
              placeholder={t('knowledge.enterOfficialResponse')}
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
