'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lock, Key, Users } from 'lucide-react';
import { AdminSafeSettings } from '@/types/admin';

interface SecurityRbacSectionProps {
  integrations?: AdminSafeSettings['infrastructure']['integrations'];
}

export function SecurityRbacSection({ integrations }: SecurityRbacSectionProps) {
  const { t } = useLanguage();

  const secretRows = [
    {
      name: 'Groq Inference API Key',
      configured: true,
      mechanism: 'Provider Health Check',
      policy: 'Zero Secret Disclosure (Server-side Only)',
    },
    {
      name: 'WhatsApp Cloud Access Token',
      configured: Boolean(integrations?.whatsappCloudApi?.configured),
      mechanism: 'Environment Presence Check',
      policy: 'Zero Secret Disclosure (Server-side Only)',
    },
    {
      name: 'Supabase PostgreSQL Credentials',
      configured: Boolean(integrations?.supabasePostgres?.configured),
      mechanism: 'Connection Pool Evaluation',
      policy: 'Zero Secret Disclosure (Server-side Only)',
    },
    {
      name: 'Tavily Search API Key',
      configured: Boolean(integrations?.tavilySearch?.configured),
      mechanism: 'Integration Presence Check',
      policy: 'Zero Secret Disclosure (Server-side Only)',
    },
  ];

  const rbacCapabilities = [
    { action: 'View Settings, Telemetry & Logs', owner: true, admin: true, operator: true, support: true, viewer: true },
    { action: 'Modify Dynamic Runtime Controls', owner: true, admin: true, operator: false, support: false, viewer: false },
    { action: 'Toggle User VIP Tier & Banning', owner: true, admin: true, operator: true, support: false, viewer: false },
    { action: 'Retry / Cancel Scheduled Reminders', owner: true, admin: true, operator: true, support: false, viewer: false },
    { action: 'Purge User Memory / Archive Chats', owner: true, admin: true, operator: false, support: false, viewer: false },
  ];

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* 1. Safe Secret Configuration Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Key className="h-4 w-4 text-emerald-400" />
            <span>{t('settings.secretHealthTitle')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            {t('settings.secretHealthDesc')}
          </p>

          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-start text-[11px]">
                <thead className="bg-surface-elevated/70 border-b border-border text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5 text-start font-semibold">{t('settings.secretNameCol')}</th>
                    <th className="p-2.5 text-start font-semibold">{t('settings.secretStatusCol')}</th>
                    <th className="p-2.5 text-start font-semibold">{t('settings.secretSourceCol')}</th>
                    <th className="p-2.5 text-start font-semibold">{t('settings.secretPolicyCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {secretRows.map((row) => (
                    <tr key={row.name} className="hover:bg-surface-elevated/30 transition-colors">
                      <td className="p-2.5 font-bold text-foreground">{row.name}</td>
                      <td className="p-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                            row.configured
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                          }`}
                        >
                          {row.configured ? t('settings.badgeConfigured') : t('settings.badgeMissing')}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-400 font-sans">{row.mechanism}</td>
                      <td className="p-2.5 text-slate-300 font-sans flex items-center gap-1.5">
                        <Lock className="h-3 w-3 text-emerald-400 shrink-0" />
                        <span className="truncate">{row.policy}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Server-Authoritative RBAC Capabilities Matrix */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Users className="h-4 w-4 text-purple-400" />
            <span>{t('settings.rbacMatrixTitle')}</span>
          </CardTitle>
          <Badge variant="neutral" className="text-[10px] uppercase font-mono text-slate-400 border-border">
            {t('settings.badgeReadOnly')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            {t('settings.rbacMatrixDesc')}
          </p>

          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-start text-[11px]">
                <thead className="bg-surface-elevated/70 border-b border-border text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5 text-start font-semibold">{t('settings.colAction')}</th>
                    <th className="p-2.5 text-center font-semibold">{t('settings.colOwner')}</th>
                    <th className="p-2.5 text-center font-semibold">{t('settings.colAdmin')}</th>
                    <th className="p-2.5 text-center font-semibold">{t('settings.colOperator')}</th>
                    <th className="p-2.5 text-center font-semibold">{t('settings.colSupport')}</th>
                    <th className="p-2.5 text-center font-semibold">{t('settings.colViewer')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rbacCapabilities.map((row) => (
                    <tr key={row.action} className="hover:bg-surface-elevated/30 transition-colors">
                      <td className="p-2.5 font-bold text-foreground">{row.action}</td>
                      <td className="p-2.5 text-center">
                        <span className={row.owner ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                          {row.owner ? '✓' : '✕'}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className={row.admin ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                          {row.admin ? '✓' : '✕'}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className={row.operator ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                          {row.operator ? '✓' : '✕'}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className={row.support ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                          {row.support ? '✓' : '✕'}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className={row.viewer ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                          {row.viewer ? '✓' : '✕'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
