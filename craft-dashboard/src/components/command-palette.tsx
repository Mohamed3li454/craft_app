'use client';

import React, { useEffect, useState } from 'react';
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

interface NavItem {
  name: string;
  href: string;
  icon: any;
  category: string;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Overview & KPIs', href: '/overview', icon: LayoutDashboard, category: 'Platform' },
  { name: 'Observability & Health', href: '/observability', icon: Activity, category: 'Platform' },
  { name: 'Users & 360 Profiles', href: '/users', icon: Users, category: 'Operations' },
  { name: 'Conversations & Transcripts', href: '/conversations', icon: MessageSquare, category: 'Operations' },
  { name: 'Memory & Evidence Candidates', href: '/memory', icon: Brain, category: 'Intelligence' },
  { name: 'Reminders Lifecycle', href: '/reminders', icon: Clock, category: 'Operations' },
  { name: 'Knowledge & Semantic Cache', href: '/knowledge', icon: BookOpen, category: 'Intelligence' },
  { name: 'Agent Runs & Traces', href: '/agent-runs', icon: Cpu, category: 'Intelligence' },
  { name: 'Tool Calls & Telemetry', href: '/tools', icon: Wrench, category: 'Observability' },
  { name: 'Proactive Intelligence', href: '/proactive', icon: Send, category: 'Operations' },
  { name: 'Search & Diagnostics', href: '/search', icon: Search, category: 'Intelligence' },
  { name: 'Audit Trail', href: '/audit', icon: ShieldCheck, category: 'Security' },
  { name: 'Runtime Settings', href: '/settings', icon: Settings, category: 'System' },
];

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Open
        }
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filtered = NAV_ITEMS.filter((item) =>
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
          <Search className="h-4 w-4 text-slate-400 mr-2 shrink-0" />
          <input
            autoFocus
            type="text"
            placeholder="Type a command or jump to a module... (e.g. users, traces, memory)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none font-mono"
          />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 ml-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400 font-mono">No matching views found</div>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => handleSelect(item.href)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-surface-elevated text-left text-xs font-mono transition-colors group"
                >
                  <div className="flex items-center space-x-3">
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
          <span>Navigate with click or arrow keys</span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
}
