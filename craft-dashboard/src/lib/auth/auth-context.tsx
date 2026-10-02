'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminRole, SafeClientUser } from '@/types/admin';
import { canMutate, canManageSettings, canPurgeData, canBanUsers, isReadOnlyRole } from './session';

interface AuthContextType {
  user: SafeClientUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  role: AdminRole | null;
  canMutate: boolean;
  canManageSettings: boolean;
  canPurgeData: boolean;
  canBanUsers: boolean;
  isReadOnly: boolean;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeClientUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const fetchSession = async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      router.push('/login');
      router.refresh();
    }
  };

  const role = user?.role || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        logout,
        role,
        canMutate: canMutate(role),
        canManageSettings: canManageSettings(role),
        canPurgeData: canPurgeData(role),
        canBanUsers: canBanUsers(role),
        isReadOnly: isReadOnlyRole(role),
        refreshSession: fetchSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
