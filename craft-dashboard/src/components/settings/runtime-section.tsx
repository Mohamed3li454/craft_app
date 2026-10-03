'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Server, Settings, AlertCircle, Save, RotateCcw } from 'lucide-react';
import { AdminSafeSettings } from '@/types/admin';

export interface RuntimeFormState {
  maintenanceMode: boolean;
  debugLogging: boolean;
  searchEnabled: boolean;
  proactiveEnabled: boolean;
  defaultMemoryRetentionDays: number;
}

interface RuntimeSectionProps {
  infrastructure?: AdminSafeSettings['infrastructure'];
  formState: RuntimeFormState;
  onChange: (updates: Partial<RuntimeFormState>) => void;
  onReset: () => void;
  onRequestConfirm: () => void;
  isModified: boolean;
  modifiedCount: number;
}

export function RuntimeSection({
  infrastructure,
  formState,
  onChange,
  onReset,
  onRequestConfirm,
  isModified,
  modifiedCount,
}: RuntimeSectionProps) {
  const { t } = useLanguage();
  const { canManageSettings } = useAuth();

  const uptimeHours = infrastructure?.uptimeSeconds
    ? Math.floor(infrastructure.uptimeSeconds / 3600)
    : 0;
  const uptimeMinutes = infrastructure?.uptimeSeconds
    ? Math.floor((infrastructure.uptimeSeconds % 3600) / 60)
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-mono text-xs">
      {/* 1. Infrastructure Overview (Read Only) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Server className="h-4 w-4 text-cyan-400" />
            <span>{t('settings.infraTopology')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('settings.activeEnv')}</span>
            <span className="font-bold text-foreground uppercase" dir="ltr">
              {infrastructure?.environment || 'production'}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('settings.platformDeployment')}</span>
            <span className="font-bold text-foreground font-mono" dir="ltr">
              {infrastructure?.serverlessPlatform || 'node_standard'}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('settings.deploymentVersion')}</span>
            <span className="font-bold text-brand-400 font-mono" dir="ltr">
              {infrastructure?.deploymentVersion || 'v10.2'}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated/40 border border-border">
            <span className="text-slate-400">{t('common.status')}</span>
            <span className="font-bold text-emerald-400 font-mono">
              {t('settings.uptimeFormatted')
                .replace('{hours}', String(uptimeHours))
                .replace('{minutes}', String(uptimeMinutes))}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 2. Dynamic Runtime Controls (Editable) */}
      <Card className={isModified ? 'border-brand-500/50 shadow-sm' : ''}>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Settings className="h-4 w-4 text-brand-400" />
            <span>{t('settings.runtimeControlsTitle')}</span>
          </CardTitle>
          <Badge
            variant={canManageSettings ? 'default' : 'neutral'}
            className="text-[10px] uppercase font-mono"
          >
            {canManageSettings ? t('settings.badgeEditable') : t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {/* Maintenance Mode */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
            <div className="space-y-0.5 max-w-[80%]">
              <span className="font-bold text-foreground block">{t('settings.maintenanceMode')}</span>
              <span className="text-[11px] text-slate-400 block font-sans">
                {t('settings.maintenanceDesc')}
              </span>
            </div>
            <input
              type="checkbox"
              id="setting-maintenance-mode"
              aria-label={t('settings.maintenanceMode')}
              checked={formState.maintenanceMode}
              onChange={(e) => onChange({ maintenanceMode: e.target.checked })}
              disabled={!canManageSettings}
              className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Debug Logging */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
            <div className="space-y-0.5 max-w-[80%]">
              <span className="font-bold text-foreground block">{t('settings.debugLogging')}</span>
              <span className="text-[11px] text-slate-400 block font-sans">
                {t('settings.debugDesc')}
              </span>
            </div>
            <input
              type="checkbox"
              id="setting-debug-logging"
              aria-label={t('settings.debugLogging')}
              checked={formState.debugLogging}
              onChange={(e) => onChange({ debugLogging: e.target.checked })}
              disabled={!canManageSettings}
              className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Search Subsystem */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
            <div className="space-y-0.5 max-w-[80%]">
              <span className="font-bold text-foreground block">{t('settings.searchEnabled')}</span>
              <span className="text-[11px] text-slate-400 block font-sans">
                {t('settings.searchDesc')}
              </span>
            </div>
            <input
              type="checkbox"
              id="setting-search-enabled"
              aria-label={t('settings.searchEnabled')}
              checked={formState.searchEnabled}
              onChange={(e) => onChange({ searchEnabled: e.target.checked })}
              disabled={!canManageSettings}
              className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Proactive Engine */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-elevated/40">
            <div className="space-y-0.5 max-w-[80%]">
              <span className="font-bold text-foreground block">{t('settings.proactiveEnabled')}</span>
              <span className="text-[11px] text-slate-400 block font-sans">
                {t('settings.proactiveDesc')}
              </span>
            </div>
            <input
              type="checkbox"
              id="setting-proactive-enabled"
              aria-label={t('settings.proactiveEnabled')}
              checked={formState.proactiveEnabled}
              onChange={(e) => onChange({ proactiveEnabled: e.target.checked })}
              disabled={!canManageSettings}
              className="h-4 w-4 rounded bg-surface border-border text-brand-500 focus:ring-0 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Memory Retention */}
          <div className="p-3 rounded-lg border border-border bg-surface-elevated/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-foreground block">{t('settings.retentionDays')}</span>
              <span className="text-[11px] text-brand-400 font-bold" dir="ltr">
                {formState.defaultMemoryRetentionDays} {t('settings.daysUnit')}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 block font-sans">
              {t('settings.retentionDesc')}
            </span>
            <div className="w-36 pt-1">
              <Input
                type="number"
                id="setting-retention-days"
                aria-label={t('settings.retentionDays')}
                min={1}
                max={3650}
                value={formState.defaultMemoryRetentionDays}
                onChange={(e) =>
                  onChange({
                    defaultMemoryRetentionDays: Math.min(3650, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
                disabled={!canManageSettings}
                className="font-mono text-xs"
              />
            </div>
          </div>

          {/* Action Footer & Dirty State */}
          <div className="pt-2 flex items-center justify-between flex-wrap gap-2">
            {isModified ? (
              <span className="text-amber-400 text-xs font-mono flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" />
                <span>{t('settings.modifiedCount').replace('{count}', String(modifiedCount))}</span>
              </span>
            ) : (
              <span className="text-slate-500 text-xs">
                {canManageSettings ? t('settings.integratedOperational') : t('settings.operatorReadOnlyAccess')}
              </span>
            )}

            <div className="flex items-center gap-2 ms-auto">
              {isModified && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onReset}
                  className="font-mono text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5 me-1" />
                  {t('settings.btnDiscard')}
                </Button>
              )}

              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={onRequestConfirm}
                disabled={!canManageSettings || !isModified}
                className="font-mono text-xs"
              >
                <Save className="h-3.5 w-3.5 me-1" />
                {t('settings.btnReviewApply')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
