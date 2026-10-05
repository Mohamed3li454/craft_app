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
  FlaskConical,
  ShieldCheck,
  Settings,
  Sun,
  Languages,
  X,
  LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { useTheme } from '@/lib/theme/theme-context';

interface CommandItemConfig {
  id: string;
  nameKey: string;
  categoryKey: string;
  href?: string;
  action?: () => void;
  icon: LucideIcon;
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const { t, toggleLanguage } = useLanguage();
  const { toggleTheme } = useTheme();

  const commandItemsConfig: CommandItemConfig[] = useMemo(
    () => [
      // CORE
      { id: 'overview', nameKey: 'commandPalette.viewOverview', href: '/overview', icon: LayoutDashboard, categoryKey: 'navigation.core' },
      { id: 'conversations', nameKey: 'commandPalette.viewConversations', href: '/conversations', icon: MessageSquare, categoryKey: 'navigation.core' },
      { id: 'users', nameKey: 'navigation.users', href: '/users', icon: Users, categoryKey: 'navigation.core' },

      // AI OPERATIONS
      { id: 'agent-runs', nameKey: 'commandPalette.viewAgentRuns', href: '/agent-runs', icon: Cpu, categoryKey: 'navigation.aiOperations' },
      { id: 'tools', nameKey: 'commandPalette.viewTools', href: '/tools', icon: Wrench, categoryKey: 'navigation.aiOperations' },
      { id: 'search', nameKey: 'commandPalette.viewSearch', href: '/search', icon: Search, categoryKey: 'navigation.aiOperations' },
      { id: 'evaluation', nameKey: 'commandPalette.viewEvaluation', href: '/evaluation', icon: FlaskConical, categoryKey: 'navigation.aiOperations' },

      // USER INTELLIGENCE
      { id: 'memory', nameKey: 'commandPalette.viewMemory', href: '/memory', icon: Brain, categoryKey: 'navigation.userIntelligence' },
      { id: 'reminders', nameKey: 'commandPalette.goToReminders', href: '/reminders', icon: Clock, categoryKey: 'navigation.userIntelligence' },
      { id: 'proactive', nameKey: 'commandPalette.viewProactive', href: '/proactive', icon: Send, categoryKey: 'navigation.userIntelligence' },

      // SYSTEM
      { id: 'observability', nameKey: 'commandPalette.viewObservability', href: '/observability', icon: Activity, categoryKey: 'navigation.systemSection' },
      { id: 'knowledge', nameKey: 'commandPalette.viewKnowledge', href: '/knowledge', icon: BookOpen, categoryKey: 'navigation.systemSection' },
      { id: 'audit', nameKey: 'commandPalette.viewAudit', href: '/audit', icon: ShieldCheck, categoryKey: 'navigation.systemSection' },
      { id: 'settings', nameKey: 'commandPalette.openSettings', href: '/settings', icon: Settings, categoryKey: 'navigation.systemSection' },

      // ACTIONS
      {
        id: 'toggle-theme',
        nameKey: 'commandPalette.switchTheme',
        categoryKey: 'common.theme',
        icon: Sun,
        action: () => toggleTheme(),
      },
      {
        id: 'toggle-lang',
        nameKey: 'commandPalette.switchLanguage',
        categoryKey: 'topbar.switchLanguage',
        icon: Languages,
        action: () => toggleLanguage(),
      },
    ],
    [toggleTheme, toggleLanguage]
  );

  const items = useMemo(() => {
    return commandItemsConfig.map((item) => ({
      id: item.id,
      name: t(item.nameKey),
      category: t(item.categoryKey),
      href: item.href,
      action: item.action,
      icon: item.icon,
    }));
  }, [commandItemsConfig, t]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleExecute = React.useCallback(
    (item: (typeof filtered)[number]) => {
      if (item.action) {
        item.action();
      } else if (item.href) {
        router.push(item.href);
      }
      onClose();
      setQuery('');
    },
    [router, onClose]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        }
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      } else if (isOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (filtered[selectedIndex]) {
            handleExecute(filtered[selectedIndex]);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, filtered, selectedIndex, handleExecute]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('commandPalette.placeholder')}
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-xl rounded-lg border border-border bg-surface shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-border bg-surface-elevated/40">
          <Search className="h-4 w-4 text-slate-400 me-2.5 shrink-0" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls="command-palette-results"
            placeholder={t('commandPalette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-slate-500 focus:outline-none font-mono text-start"
          />
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-foreground ms-2 p-1 rounded-md"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results List */}
        <div id="command-palette-results" role="listbox" className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 font-mono">
              {t('commandPalette.noMatching')}
            </div>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleExecute(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-start text-xs font-mono transition-colors group ${
                    isSelected
                      ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium border border-brand-500/30'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-surface-elevated'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isSelected
                          ? 'text-brand-600 dark:text-brand-400'
                          : 'text-slate-400 group-hover:text-foreground'
                      }`}
                    />
                    <span className="truncate">{item.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 dark:text-slate-400 uppercase tracking-wider shrink-0 ms-2">
                    {item.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-surface-elevated/20 text-[11px] text-slate-500 font-mono">
          <span>{t('commandPalette.navigateHint')}</span>
          <span>{t('commandPalette.escHint')}</span>
        </div>
      </div>
    </div>
  );
}
