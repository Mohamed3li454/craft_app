'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Activity,
  Users,
  MessageSquare,
  Brain,
  Clock,
  BookOpen,
  Cpu,
  Wrench,
  Send,
  Search,
  ShieldCheck,
  Settings,
  LogOut,
  Terminal,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { useLayout } from '@/lib/layout/layout-context';
import { StatusBadge } from './ui/status-badge';

interface NavItemConfig {
  nameKey: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

interface NavGroupConfig {
  groupNameKey: string;
  items: NavItemConfig[];
}

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    groupNameKey: 'navigation.core',
    items: [
      { nameKey: 'navigation.overview', href: '/overview', icon: LayoutDashboard },
      { nameKey: 'navigation.conversations', href: '/conversations', icon: MessageSquare },
      { nameKey: 'navigation.users', href: '/users', icon: Users },
    ],
  },
  {
    groupNameKey: 'navigation.aiOperations',
    items: [
      { nameKey: 'navigation.agentRuns', href: '/agent-runs', icon: Cpu },
      { nameKey: 'navigation.tools', href: '/tools', icon: Wrench },
      { nameKey: 'navigation.search', href: '/search', icon: Search },
    ],
  },
  {
    groupNameKey: 'navigation.userIntelligence',
    items: [
      { nameKey: 'navigation.memory', href: '/memory', icon: Brain },
      { nameKey: 'navigation.reminders', href: '/reminders', icon: Clock },
      { nameKey: 'navigation.proactive', href: '/proactive', icon: Send },
    ],
  },
  {
    groupNameKey: 'navigation.systemSection',
    items: [
      { nameKey: 'navigation.observability', href: '/observability', icon: Activity },
      { nameKey: 'navigation.knowledge', href: '/knowledge', icon: BookOpen },
      { nameKey: 'navigation.audit', href: '/audit', icon: ShieldCheck },
      { nameKey: 'navigation.settings', href: '/settings', icon: Settings },
    ],
  },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { t, isRtl } = useLanguage();
  const { isCollapsed, toggleCollapsed, isMobileOpen, setMobileOpen } = useLayout();

  const CollapseIcon = isCollapsed
    ? isRtl
      ? PanelLeftClose
      : PanelLeftOpen
    : isRtl
    ? PanelLeftOpen
    : PanelLeftClose;

  const renderNavContent = (isMobile = false) => (
    <>
      {/* Brand Header */}
      <div
        className={cn(
          'h-14 flex items-center justify-between px-3 border-b border-border bg-surface-elevated/20',
          !isMobile && isCollapsed ? 'justify-center px-2' : 'px-4'
        )}
      >
        <Link
          href="/overview"
          onClick={() => isMobile && setMobileOpen(false)}
          className="flex items-center gap-2.5 overflow-hidden"
          title={t('navigation.commandCenter')}
        >
          <div className="h-8 w-8 rounded-md bg-brand-600 flex items-center justify-center text-white shrink-0 shadow-sm border border-brand-400/30">
            <Terminal className="h-4 w-4" />
          </div>
          {(isMobile || !isCollapsed) && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-sm tracking-tight text-foreground truncate">
                  {t('navigation.commandCenter')}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 bg-brand-500/10 text-brand-600 dark:text-brand-300 border border-brand-500/30 rounded shrink-0">
                  {t('navigation.version')}
                </span>
              </div>
            </div>
          )}
        </Link>

        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1 rounded-md text-slate-500 hover:text-foreground hover:bg-surface-elevated"
            aria-label={t('common.closeMenu')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupNameKey} className="space-y-1">
            {(isMobile || !isCollapsed) ? (
              <p className="px-2.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold truncate">
                {t(group.groupNameKey)}
              </p>
            ) : (
              <div className="my-2 border-t border-border/50 mx-2" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/overview' && pathname.startsWith(item.href));
                const Icon = item.icon;
                const itemLabel = t(item.nameKey);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => isMobile && setMobileOpen(false)}
                    title={!isMobile && isCollapsed ? itemLabel : undefined}
                    className={cn(
                      'flex items-center rounded-md text-xs font-mono transition-all group relative',
                      !isMobile && isCollapsed
                        ? 'justify-center p-2.5'
                        : 'justify-between px-2.5 py-2',
                      isActive
                        ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium border border-brand-500/30 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-foreground hover:bg-surface-elevated'
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive
                            ? 'text-brand-600 dark:text-brand-400'
                            : 'text-slate-400 dark:text-slate-400 group-hover:text-foreground'
                        )}
                      />
                      {(isMobile || !isCollapsed) && (
                        <span className="truncate">{itemLabel}</span>
                      )}
                    </div>
                    {(isMobile || !isCollapsed) && item.badge && (
                      <span className="px-1.5 py-0.2 text-[10px] rounded bg-surface-elevated text-slate-500 dark:text-slate-300 shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer / User Session & Collapse Controls */}
      <div className="p-2 border-t border-border bg-surface-elevated/20 space-y-1.5">
        <div
          className={cn(
            'flex items-center rounded-md bg-surface-elevated/40 border border-border',
            !isMobile && isCollapsed ? 'p-1.5 justify-center' : 'p-2 justify-between'
          )}
        >
          {(isMobile || !isCollapsed) && (
            <div className="flex flex-col min-w-0 pe-2">
              <span className="text-xs font-mono font-medium text-foreground truncate">
                {user?.actorName || 'Admin'}
              </span>
              <div className="mt-0.5">
                <StatusBadge
                  status={user?.role || 'viewer'}
                  size="xs"
                  showDot={false}
                />
              </div>
            </div>
          )}

          <button
            onClick={logout}
            title={t('navigation.signOut')}
            aria-label={t('navigation.signOut')}
            className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* Desktop Collapse Toggle */}
        {!isMobile && (
          <button
            onClick={toggleCollapsed}
            title={isCollapsed ? t('topbar.expandSidebar') : t('topbar.collapseSidebar')}
            aria-label={isCollapsed ? t('topbar.expandSidebar') : t('topbar.collapseSidebar')}
            className={cn(
              'w-full flex items-center justify-center p-1.5 rounded-md text-slate-500 hover:text-foreground hover:bg-surface-elevated text-xs font-mono transition-colors'
            )}
          >
            <CollapseIcon className="h-4 w-4" />
            {!isCollapsed && (
              <span className="ms-2 text-[11px] text-slate-500">{t('common.collapse')}</span>
            )}
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 select-none h-screen sticky top-0 border-e border-border bg-sidebar transition-all duration-200 z-20',
          isCollapsed ? 'w-16' : 'w-64',
          className
        )}
      >
        {renderNavContent(false)}
      </aside>

      {/* Mobile Drawer Backdrop & Sidebar */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-72 max-w-[85vw] h-full flex flex-col bg-surface border-e border-border shadow-2xl">
            {renderNavContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
