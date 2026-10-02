'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Settings, ShieldCheck, Server, Cpu, Database, Save, CheckCircle2 } from 'lucide-react';

export default function SettingsPage() {
  const { canManageSettings } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => adminApi.getSettings(),
  });

  const settings = data?.data;

  // Local form state for runtime settings
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [debugLogging, setDebugLogging] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [proactiveEnabled, setProactiveEnabled] = useState(true);
  const [retentionDays, setRetentionDays] = useState(365);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (settings?.runtime) {
      setMaintenanceMode(settings.runtime.maintenanceMode ?? false);
      setDebugLogging(settings.runtime.debugLogging ?? false);
      setSearchEnabled(settings.runtime.searchEnabled ?? true);
      setProactiveEnabled(settings.runtime.proactiveEnabled ?? true);
      setRetentionDays(settings.runtime.defaultMemoryRetentionDays ?? 365);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: () =>
      adminApi.updateSettings({
        maintenanceMode,
        debugLogging,
        searchEnabled,
        proactiveEnabled,
        defaultMemoryRetentionDays: Number(retentionDays),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSettings) return;
    updateMutation.mutate();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
            {t('settings.title')}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {t('settings.subtitle')}
          </p>
        </div>
      </div>

      {/* Zero Secret Disclosure Guarantee Banner */}
      <div className="flex items-center gap-2.5 p-3.5 rounded-lg border border-emerald-800/40 bg-emerald-950/20 text-emerald-300 text-xs font-mono">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>
          {t('settings.securityGuarantee')}
        </span>
      </div>

      {(error || updateMutation.error) && (
        <ErrorAlert
          error={(error || updateMutation.error) as any}
          title={t('settings.configError')}
          onRetry={() => refetch()}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dynamic Runtime Controls */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Settings className="h-4 w-4 text-brand-400" />
              {t('settings.runtimeControlsTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="p-6 text-center text-xs font-mono text-slate-400">{t('settings.loading')}</div>
            ) : (
              <form onSubmit={handleSave} className="space-y-4 font-mono text-xs">
                {/* Maintenance Mode */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
                  <div>
                    <span className="font-semibold text-slate-200 block">{t('settings.maintenanceMode')}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {t('settings.maintenanceDesc')}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={maintenanceMode}
                    onChange={(e) => setMaintenanceMode(e.target.checked)}
                    disabled={!canManageSettings}
                    className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
                  />
                </div>

                {/* Debug Logging */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
                  <div>
                    <span className="font-semibold text-slate-200 block">{t('settings.debugLogging')}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {t('settings.debugDesc')}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={debugLogging}
                    onChange={(e) => setDebugLogging(e.target.checked)}
                    disabled={!canManageSettings}
                    className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
                  />
                </div>

                {/* Search Engine */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
                  <div>
                    <span className="font-semibold text-slate-200 block">{t('settings.searchEnabled')}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {t('settings.searchDesc')}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={searchEnabled}
                    onChange={(e) => setSearchEnabled(e.target.checked)}
                    disabled={!canManageSettings}
                    className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
                  />
                </div>

                {/* Proactive Engine */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
                  <div>
                    <span className="font-semibold text-slate-200 block">{t('settings.proactiveEnabled')}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {t('settings.proactiveDesc')}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={proactiveEnabled}
                    onChange={(e) => setProactiveEnabled(e.target.checked)}
                    disabled={!canManageSettings}
                    className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
                  />
                </div>

                {/* Memory Retention */}
                <div className="p-3 rounded-lg border border-border bg-surface-elevated/40 space-y-1.5">
                  <span className="font-semibold text-slate-200 block">{t('settings.retentionDays')}</span>
                  <span className="text-[11px] text-slate-400 block">
                    {t('settings.retentionDesc')}
                  </span>
                  <div className="w-32 mt-1">
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(Number(e.target.value))}
                      disabled={!canManageSettings}
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between">
                  {saveSuccess && (
                    <span className="text-emerald-400 text-xs font-mono flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" /> {t('settings.saveSuccess')}
                    </span>
                  )}
                  <div className="ms-auto">
                    <Button
                      type="submit"
                      variant="brand"
                      size="sm"
                      disabled={!canManageSettings}
                      isLoading={updateMutation.isPending}
                    >
                      <Save className="h-3.5 w-3.5 me-1" />
                      {t('settings.btnSave')}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Infrastructure & AI Provider Topology */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <Server className="h-4 w-4 text-cyan-400" />
                {t('settings.topologyTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400">{t('settings.activeEnv')}</span>
                <span className="font-semibold text-slate-200 uppercase">{settings?.infrastructure?.environment || 'production'}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400">{t('settings.platformDeployment')}</span>
                <span className="font-semibold text-slate-200">{settings?.infrastructure?.serverlessPlatform || 'node_standard'}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400">{t('settings.deploymentVersion')}</span>
                <span className="font-semibold text-brand-300">{settings?.infrastructure?.deploymentVersion || 'v10.3'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Cpu className="h-4 w-4 text-purple-400" />
                {t('settings.aiInferenceTopology')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400">{t('settings.primaryInferenceEngine')}</span>
                <Badge variant="purple">{settings?.infrastructure?.aiProvider?.primary || 'groq'} ({settings?.infrastructure?.aiProvider?.engine || 'LPU'})</Badge>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400">{t('settings.primaryProductionModel')}</span>
                <span className="font-semibold text-slate-200">{settings?.infrastructure?.aiProvider?.models?.primary || 'openai/gpt-oss-120b'}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
                <span className="text-slate-400">{t('settings.fastFallbackModel')}</span>
                <span className="font-semibold text-slate-200">{settings?.infrastructure?.aiProvider?.models?.fastFallback || 'llama-3.3-70b-versatile'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Database className="h-4 w-4 text-emerald-400" />
                {t('settings.integrationStatus')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 font-mono text-xs">
              {settings?.infrastructure?.integrations ? (
                Object.entries(settings.infrastructure.integrations).map(([name, val]: [string, any]) => (
                  <div key={name} className="flex items-center justify-between p-2.5 rounded bg-surface-elevated/40 border border-border">
                    <span className="text-slate-300 capitalize">{name.replace(/([A-Z])/g, ' $1')}</span>
                    <StatusPill status={val.configured ? 'healthy' : 'inactive'} />
                  </div>
                ))
              ) : (
                <div className="text-slate-400 text-center py-2">{t('settings.integratedOperational')}</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
