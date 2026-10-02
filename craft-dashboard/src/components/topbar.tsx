'use client';

import React, { useEffect, useState } from 'react';
import { Search, Shield, Zap } from 'lucide-react';
import { StatusPill } from './ui/status-pill';
import { useAuth } from '@/lib/auth/auth-context';
import { CommandPalette } from './command-palette';

export function Topbar() {
  const { user } = useAuth();
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

  return (
    <>
      <header className="h-14 border-b border-border bg-[#090d16]/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-md border border-border bg-surface-elevated/60 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-xs font-mono transition-all group"
          >
            <Search className="h-3.5 w-3.5 text-slate-400 group-hover:text-brand-400" />
            <span>Search or jump to...</span>
            <kbd className="ml-2 px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] text-slate-400">
              ⌘K
            </kbd>
          </button>
        </div>

        <div className="flex items-center space-x-3 text-xs font-mono">
          {/* Backend Connectivity Status */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-surface-elevated/40 border border-border/80">
            <Zap className="h-3 w-3 text-emerald-400" />
            <span className="text-[11px] text-slate-400">Backend:</span>
            <StatusPill
              status={healthStatus === 'healthy' ? 'active' : healthStatus === 'checking' ? 'pending' : 'failed'}
              className="text-[10px] py-0 px-1.5"
            />
          </div>

          {/* Active Admin Role Pill */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-surface-elevated/40 border border-border/80">
            <Shield className="h-3 w-3 text-brand-400" />
            <span className="text-[11px] text-slate-400">Role:</span>
            <span className="font-semibold text-brand-300 uppercase tracking-wide">
              {user?.role || 'VIEWER'}
            </span>
          </div>
        </div>
      </header>

      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
