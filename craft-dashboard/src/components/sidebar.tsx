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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/auth-context';
import { useLanguage } from '@/lib/i18n/language-context';
import { StatusPill } from './ui/status-pill';

interface NavItemConfig {
  nameKey: string;
  href: string;
  icon: any;
  badge?: string;
}

interface NavGroupConfig {
  groupNameKey: string;
  items: NavItemConfig[];
}

const NAV_GROUPS: NavGroupConfig[] = [
  {
    groupNameKey: 'navigation.platform',
    items: [
      { nameKey: 'navigation.overview', href: '/overview', icon: LayoutDashboard },
      { nameKey: 'navigation.observability', href: '/observability', icon: Activity },
    ],
  },
  {
    groupNameKey: 'navigation.operations',
    items: [
      { nameKey: 'navigation.users', href: '/users', icon: Users },
      { nameKey: 'navigation.conversations', href: '/conversations', icon: MessageSquare },
      { nameKey: 'navigation.reminders', href: '/reminders', icon: Clock },
      { nameKey: 'navigation.proactive', href: '/proactive', icon: Send },
    ],
  },
  {
    groupNameKey: 'navigation.intelligence',
    items: [
      { nameKey: 'navigation.memory', href: '/memory', icon: Brain },
      { nameKey: 'navigation.knowledge', href: '/knowledge', icon: BookOpen },
      { nameKey: 'navigation.agentRuns', href: '/agent-runs', icon: Cpu },
      { nameKey: 'navigation.search', href: '/search', icon: Search },
    ],
  },
  {
    groupNameKey: 'navigation.system',
    items: [
      { nameKey: 'navigation.tools', href: '/tools', icon: Wrench },
      { nameKey: 'navigation.audit', href: '/audit', icon: ShieldCheck },
      { nameKey: 'navigation.settings', href: '/settings', icon: Settings },
    ],
  },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { t } = useLanguage();

  return (
    <aside
      className={cn(
        'w-64 border-e border-border bg-[#090d16] flex flex-col shrink-0 select-none h-screen sticky top-0',
        className
      )}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-border/80 bg-surface-elevated/20">
        <Link href="/overview" className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md bg-brand-600 flex items-center justify-center text-white shadow-sm border border-brand-400/30">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-sm tracking-tight text-white">
                {t('navigation.commandCenter')}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-brand-950 text-brand-300 border border-brand-800 rounded">
                {t('navigation.version')}
              </span>
            </div>
            <p className="text-[10px] font-mono text-slate-400">{t('navigation.overview')}</p>
          </div>
        </Link>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupNameKey} className="space-y-1">
            <p className="px-3 text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
              {t(group.groupNameKey)}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/overview' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 rounded-md text-xs font-mono transition-all group',
                      isActive
                        ? 'bg-brand-600/15 text-brand-300 font-medium border border-brand-500/30 shadow-xs'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-surface-elevated/60'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={cn(
                          'h-4 w-4 transition-colors',
                          isActive ? 'text-brand-400' : 'text-slate-400 group-hover:text-slate-200'
                        )}
                      />
                      <span>{t(item.nameKey)}</span>
                    </div>
                    {item.badge && (
                      <span className="px-1.5 py-0.2 text-[10px] rounded bg-surface-elevated text-slate-300">
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

      {/* User Session Footer */}
      <div className="p-3 border-t border-border/80 bg-surface-elevated/20">
        <div className="flex items-center justify-between p-2 rounded-md bg-surface-elevated/40 border border-border/60">
          <div className="flex flex-col min-w-0 pe-2">
            <span className="text-xs font-mono font-medium text-slate-200 truncate">
              {user?.actorName || 'Admin'}
            </span>
            <div className="mt-1">
              <StatusPill status={user?.role || 'viewer'} showDot={false} className="text-[10px] px-1.5 py-0" />
            </div>
          </div>
          <button
            onClick={logout}
            title={t('navigation.signOut')}
            aria-label={t('navigation.signOut')}
            className="p-1.5 rounded text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
