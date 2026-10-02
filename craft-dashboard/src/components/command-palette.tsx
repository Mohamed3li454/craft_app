'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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
  X,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';

interface NavItemConfig {
  nameKey: string;
  categoryKey: string;
  href: string;
  icon: any;
}

const NAV_ITEMS_CONFIG: NavItemConfig[] = [
  { nameKey: 'commandPalette.viewOverview', href: '/overview', icon: LayoutDashboard, categoryKey: 'navigation.platform' },
  { nameKey: 'commandPalette.viewObservability', href: '/observability', icon: Activity, categoryKey: 'navigation.platform' },
  { nameKey: 'navigation.users', href: '/users', icon: Users, categoryKey: 'navigation.operations' },
  { nameKey: 'commandPalette.viewConversations', href: '/conversations', icon: MessageSquare, categoryKey: 'navigation.operations' },
  { nameKey: 'commandPalette.viewMemory', href: '/memory', icon: Brain, categoryKey: 'navigation.intelligence' },
  { nameKey: 'commandPalette.goToReminders', href: '/reminders', icon: Clock, categoryKey: 'navigation.operations' },
  { nameKey: 'commandPalette.viewKnowledge', href: '/knowledge', icon: BookOpen, categoryKey: 'navigation.intelligence' },
  { nameKey: 'commandPalette.viewAgentRuns', href: '/agent-runs', icon: Cpu, categoryKey: 'navigation.intelligence' },
  { nameKey: 'commandPalette.viewTools', href: '/tools', icon: Wrench, categoryKey: 'navigation.system' },
  { nameKey: 'commandPalette.viewProactive', href: '/proactive', icon: Send, categoryKey: 'navigation.operations' },
  { nameKey: 'commandPalette.viewSearch', href: '/search', icon: Search, categoryKey: 'navigation.intelligence' },
  { nameKey: 'commandPalette.viewAudit', href: '/audit', icon: ShieldCheck, categoryKey: 'navigation.system' },
  { nameKey: 'commandPalette.openSettings', href: '/settings', icon: Settings, categoryKey: 'navigation.system' },
];

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { t } = useLanguage();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        }
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const items = useMemo(() => {
    return NAV_ITEMS_CONFIG.map((item) => ({
      name: t(item.nameKey),
      category: t(item.categoryKey),
      href: item.href,
      icon: item.icon,
    }));
  }, [t]);

  if (!isOpen) return null;

  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()) ||
    item.category.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (href: string) => {
    router.push(href);
    onClose();
    setQuery('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl rounded-lg border border-border bg-surface shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="flex items-center px-4 py-3 border-b border-border bg-surface-elevated/40">
          <Search className="h-4 w-4 text-slate-400 me-2 shrink-0" />
          <input
            autoFocus
            type="text"
            placeholder={t('commandPalette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none font-mono text-start"
          />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 ms-2" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400 font-mono">
              {t('commandPalette.noMatching')}
            </div>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => handleSelect(item.href)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-surface-elevated text-start text-xs font-mono transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-slate-400 group-hover:text-brand-400 transition-colors" />
                    <span className="text-slate-200 group-hover:text-white">{item.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider">{item.category}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-surface-elevated/20 text-[11px] text-slate-400 font-mono">
          <span>{t('commandPalette.navigateHint')}</span>
          <span>{t('commandPalette.escHint')}</span>
        </div>
      </div>
    </div>
  );
}
