'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { Search, Shield, Zap, Menu, Sun, Moon, Monitor } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { useTheme } from '@/lib/theme/theme-context';
import { useLayout } from '@/lib/layout/layout-context';
import { CommandPalette } from './command-palette';
import { LanguageSwitcher } from './language-switcher';
import { StatusBadge } from './ui/status-badge';
import { NAV_GROUPS } from './sidebar';

export function Topbar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { toggleMobile } = useLayout();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'checking' | 'unreachable'>('checking');

  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/admin-proxy/observability/health', { cache: 'no-store' });
        if (isMounted) {
          if (res.ok) {
            setHealthStatus('healthy');
          } else {
            setHealthStatus('unreachable');
          }
        }
      } catch {
        if (isMounted) {
          setHealthStatus('unreachable');
        }
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Compute breadcrumb / current section & page
  const breadcrumb = useMemo(() => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (
          pathname === item.href ||
          (item.href !== '/overview' && pathname.startsWith(item.href))
        ) {
          return {
            section: t(group.groupNameKey),
            page: t(item.nameKey),
          };
        }
      }
    }
    return {
      section: t('navigation.core'),
      page: t('navigation.overview'),
    };
  }, [pathname, t]);

  const cycleTheme = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('system');
    else setTheme('dark');
  };

  const ThemeIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <>
      <header className="h-14 border-b border-border bg-surface/85 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 transition-colors">
        {/* Left Section: Mobile Menu + Breadcrumbs */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={toggleMobile}
            className="lg:hidden p-1.5 rounded-md text-slate-500 hover:text-foreground hover:bg-surface-elevated"
            aria-label={t('topbar.menu')}
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumb Hierarchy */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">
              {breadcrumb.section}
            </span>
            <span className="text-slate-400">/</span>
            <span className="text-foreground font-semibold truncate">
              {breadcrumb.page}
            </span>
          </div>
        </div>

        {/* Center / Right Section: Search & Actions */}
        <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono">
          {/* Quick Search Trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-surface-elevated/70 text-slate-500 hover:text-foreground hover:border-slate-500 text-xs font-mono transition-all group"
            aria-label={t('topbar.searchPlaceholder')}
          >
            <Search className="h-3.5 w-3.5 text-slate-400 group-hover:text-brand-500 transition-colors" />
            <span className="hidden md:inline text-slate-600 dark:text-slate-400">{t('topbar.searchPlaceholder')}</span>
            <kbd className="hidden sm:inline ms-1 px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] text-slate-500">
              ⌘K
            </kbd>
          </button>

          {/* Theme Switcher */}
          <button
            onClick={cycleTheme}
            className="p-1.5 rounded-md border border-border bg-surface-elevated/40 text-slate-500 hover:text-foreground hover:bg-surface-elevated transition-colors"
            title={`${t('topbar.themeToggle')}: ${theme === 'system' ? t('topbar.themeSystem') : theme === 'dark' ? t('topbar.themeDark') : t('topbar.themeLight')}`}
            aria-label={t('topbar.themeToggle')}
          >
            <ThemeIcon className="h-4 w-4" />
          </button>

          {/* Language Switcher */}
          <LanguageSwitcher variant="pill" />

          {/* Backend Connectivity Status */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-elevated/40 border border-border">
            <Zap className="h-3 w-3 text-emerald-500" />
            <span className="text-[11px] text-slate-500">{t('topbar.backendStatus')}</span>
            <StatusBadge
              status={healthStatus === 'healthy' ? 'healthy' : healthStatus === 'checking' ? 'pending' : 'failed'}
              size="xs"
            />
          </div>

          {/* Active Admin Role Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-elevated/40 border border-border">
            <Shield className="h-3 w-3 text-brand-500" />
            <span className="text-[11px] text-slate-500">{t('topbar.role')}</span>
            <span className="font-semibold text-brand-600 dark:text-brand-300 uppercase tracking-wide">
              {user?.role || 'VIEWER'}
            </span>
          </div>
        </div>
      </header>

      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
