'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Terminal, Lock, Eye, EyeOff, ShieldCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/overview';
  const { refreshSession } = useAuth();

  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) {
      setError('Please provide the Admin Secret Key');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: secret.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || 'Authentication failed. Invalid secret key.');
      }

      await refreshSession();
      router.push(from);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Login failed. Verify your secret key and network connection.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-[#0f172a] shadow-2xl p-8 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-brand-600/20 border border-brand-500/40 text-brand-400 mb-2">
          <Terminal className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold font-mono tracking-tight text-white flex items-center justify-center gap-2">
          CRAFT COMMAND CENTER
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-950 text-brand-300 border border-brand-700">
            V2
          </span>
        </h1>
        <p className="text-xs text-slate-400 font-mono">
          Control Plane Authentication Gateway
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-rose-800/60 bg-rose-950/40 text-rose-300 text-xs font-mono flex items-start space-x-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-slate-300 font-medium">Admin Secret Key</label>
          <div className="relative">
            <Input
              type={showSecret ? 'text' : 'password'}
              placeholder="Enter ADMIN_SECRET_KEY..."
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              icon={<Lock className="h-4 w-4" />}
              required
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" variant="brand" className="w-full h-10 font-mono text-xs uppercase tracking-wider" isLoading={isLoading}>
          Authenticate Session
        </Button>
      </form>

      {/* Security Notice */}
      <div className="pt-4 border-t border-border/60 flex items-start space-x-2.5 text-[11px] font-mono text-slate-400">
        <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
        <p>
          Zero Secret Leakage Guarantee: The secret is verified server-side and retained solely in an HttpOnly session cookie on the backend-for-frontend. Client roles are server-authoritative.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080c14] p-4 text-slate-100">
      <Suspense fallback={<div className="text-xs font-mono text-slate-400">Loading Command Center...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
