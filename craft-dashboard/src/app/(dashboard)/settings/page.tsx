'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { GovernanceHeader } from '@/components/settings/governance-header';
import { RuntimeSection, RuntimeFormState } from '@/components/settings/runtime-section';
import { AiGovernanceSection } from '@/components/settings/ai-governance-section';
import { SearchPolicySection } from '@/components/settings/search-policy-section';
import { MemoryPolicySection } from '@/components/settings/memory-policy-section';
import { ProactivePolicySection } from '@/components/settings/proactive-policy-section';
import { SecurityRbacSection } from '@/components/settings/security-rbac-section';
import { FeatureFlagsSection } from '@/components/settings/feature-flags-section';
import { SettingsConfirmModal, PendingSettingDiff } from '@/components/settings/settings-confirm-modal';
import { AuditConfirmationBanner } from '@/components/settings/audit-confirmation-banner';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Skeleton } from '@/components/ui/skeleton-loader';
import { Server, Cpu, Search, Database, BellRing, ShieldCheck, Flag } from 'lucide-react';

type SettingsTab = 'runtime' | 'ai' | 'search' | 'memory' | 'proactive' | 'security' | 'flags';

const DEFAULT_RUNTIME_STATE: RuntimeFormState = {
  maintenanceMode: false,
  debugLogging: false,
  searchEnabled: true,
  proactiveEnabled: true,
  defaultMemoryRetentionDays: 365,
};

export default function SettingsPage() {
  const { t } = useLanguage();
  const { user, canManageSettings } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<SettingsTab>('runtime');
  const [formState, setFormState] = useState<RuntimeFormState>(DEFAULT_RUNTIME_STATE);
  const [initialState, setInitialState] = useState<RuntimeFormState>(DEFAULT_RUNTIME_STATE);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [showAuditBanner, setShowAuditBanner] = useState(false);

  // 1. Fetch Verified Settings & Telemetry
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => adminApi.getSettings(),
  });

  const settings = data?.data;
  const runtime = settings?.runtime || settings?.runtimeSettings;
  const infrastructure = settings?.infrastructure;

  // 2. Synchronize initial state
  useEffect(() => {
    if (runtime) {
      const syncedState: RuntimeFormState = {
        maintenanceMode: Boolean(runtime.maintenanceMode),
        debugLogging: Boolean(runtime.debugLogging),
        searchEnabled: runtime.searchEnabled !== undefined ? Boolean(runtime.searchEnabled) : true,
        proactiveEnabled: runtime.proactiveEnabled !== undefined ? Boolean(runtime.proactiveEnabled) : true,
        defaultMemoryRetentionDays: runtime.defaultMemoryRetentionDays || 365,
      };
      setFormState(syncedState);
      setInitialState(syncedState);
    }
  }, [runtime]);

  // 3. Compute dirty diffs
  const diffs: PendingSettingDiff[] = useMemo(() => {
    const list: PendingSettingDiff[] = [];
    if (formState.maintenanceMode !== initialState.maintenanceMode) {
      list.push({
        key: 'maintenanceMode',
        label: t('settings.maintenanceMode'),
        previousValue: initialState.maintenanceMode,
        newValue: formState.maintenanceMode,
        impact: t('settings.maintenanceImpact'),
      });
    }
    if (formState.debugLogging !== initialState.debugLogging) {
      list.push({
        key: 'debugLogging',
        label: t('settings.debugLogging'),
        previousValue: initialState.debugLogging,
        newValue: formState.debugLogging,
        impact: t('settings.debugLoggingImpact'),
      });
    }
    if (formState.searchEnabled !== initialState.searchEnabled) {
      list.push({
        key: 'searchEnabled',
        label: t('settings.searchEnabled'),
        previousValue: initialState.searchEnabled,
        newValue: formState.searchEnabled,
        impact: t('settings.searchEnabledImpact'),
      });
    }
    if (formState.proactiveEnabled !== initialState.proactiveEnabled) {
      list.push({
        key: 'proactiveEnabled',
        label: t('settings.proactiveEnabled'),
        previousValue: initialState.proactiveEnabled,
        newValue: formState.proactiveEnabled,
        impact: t('settings.proactiveEnabledImpact'),
      });
    }
    if (formState.defaultMemoryRetentionDays !== initialState.defaultMemoryRetentionDays) {
      list.push({
        key: 'defaultMemoryRetentionDays',
        label: t('settings.retentionDays'),
        previousValue: initialState.defaultMemoryRetentionDays,
        newValue: formState.defaultMemoryRetentionDays,
        impact: t('settings.retentionDaysImpact'),
      });
    }
    return list;
  }, [formState, initialState, t]);

  const isModified = diffs.length > 0;

  // 4. Update Mutation
  const updateMutation = useMutation({
    mutationFn: () =>
      adminApi.updateSettings({
        maintenanceMode: formState.maintenanceMode,
        debugLogging: formState.debugLogging,
        searchEnabled: formState.searchEnabled,
        proactiveEnabled: formState.proactiveEnabled,
        defaultMemoryRetentionDays: Number(formState.defaultMemoryRetentionDays),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      setIsConfirmModalOpen(false);
      setShowAuditBanner(true);
      setInitialState({ ...formState });
    },
  });

  const handleFieldChange = (updates: Partial<RuntimeFormState>) => {
    setFormState((prev) => ({ ...prev, ...updates }));
  };

  const handleResetForm = () => {
    setFormState({ ...initialState });
  };

  const handleOpenConfirmModal = () => {
    if (!canManageSettings || !isModified) return;
    setIsConfirmModalOpen(true);
  };

  const handleExecuteMutation = () => {
    updateMutation.mutate();
  };

  const tabs = [
    { id: 'runtime' as SettingsTab, label: t('settings.tabRuntime'), icon: Server },
    { id: 'ai' as SettingsTab, label: t('settings.tabAiInference'), icon: Cpu },
    { id: 'search' as SettingsTab, label: t('settings.tabSearch'), icon: Search },
    { id: 'memory' as SettingsTab, label: t('settings.tabMemory'), icon: Database },
    { id: 'proactive' as SettingsTab, label: t('settings.tabProactive'), icon: BellRing },
    { id: 'security' as SettingsTab, label: t('settings.tabSecurity'), icon: ShieldCheck },
    { id: 'flags' as SettingsTab, label: t('settings.tabFeatureFlags'), icon: Flag },
  ];

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Header & Operator Context */}
      <GovernanceHeader />

      {/* 2. Audit Trail Confirmation Banner */}
      {showAuditBanner && (
        <AuditConfirmationBanner
          actor={user?.actorName || 'admin'}
          onDismiss={() => setShowAuditBanner(false)}
        />
      )}

      {/* 3. Error Alert */}
      {(error || updateMutation.error) && (
        <ErrorAlert
          error={(error || updateMutation.error) as any}
          title={t('settings.configError')}
          onRetry={() => refetch()}
        />
      )}

      {/* 4. Tab Navigation Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border pb-2 scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono font-medium transition-colors shrink-0 ${
                isActive
                  ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
                  : 'text-slate-400 hover:text-foreground hover:bg-surface-elevated/40 border border-transparent'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 5. Main Content Area */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <div>
          {activeTab === 'runtime' && (
            <RuntimeSection
              infrastructure={infrastructure}
              formState={formState}
              onChange={handleFieldChange}
              onReset={handleResetForm}
              onRequestConfirm={handleOpenConfirmModal}
              isModified={isModified}
              modifiedCount={diffs.length}
            />
          )}

          {activeTab === 'ai' && (
            <AiGovernanceSection aiProvider={infrastructure?.aiProvider} />
          )}

          {activeTab === 'search' && (
            <SearchPolicySection
              searchConfigured={infrastructure?.integrations?.tavilySearch?.configured}
              searchEnabled={formState.searchEnabled}
            />
          )}

          {activeTab === 'memory' && (
            <MemoryPolicySection
              retentionDays={formState.defaultMemoryRetentionDays}
            />
          )}

          {activeTab === 'proactive' && (
            <ProactivePolicySection
              proactiveEnabled={formState.proactiveEnabled}
            />
          )}

          {activeTab === 'security' && (
            <SecurityRbacSection
              integrations={infrastructure?.integrations}
            />
          )}

          {activeTab === 'flags' && <FeatureFlagsSection />}
        </div>
      )}

      {/* 6. Settings Confirmation Modal */}
      <SettingsConfirmModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleExecuteMutation}
        diffs={diffs}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}
