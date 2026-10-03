'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';

const SIDEBAR_COLLAPSED_KEY = 'craft_sidebar_collapsed';

interface LayoutContextValue {
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  toggleMobile: () => void;
}

const defaultContextValue: LayoutContextValue = {
  isCollapsed: false,
  toggleCollapsed: () => {},
  setCollapsed: () => {},
  isMobileOpen: false,
  setMobileOpen: () => {},
  toggleMobile: () => {},
};

const LayoutContext = createContext<LayoutContextValue>(defaultContextValue);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Initialize collapsed preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored !== null) {
        setIsCollapsed(stored === 'true');
      }
    } catch {
      // ignore
    }
  }, []);

  const setCollapsed = useCallback((val: boolean) => {
    setIsCollapsed(val);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(val));
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!isCollapsed);
  }, [isCollapsed, setCollapsed]);

  const toggleMobile = useCallback(() => {
    setIsMobileOpen((prev) => !prev);
  }, []);

  const value = useMemo(
    () => ({
      isCollapsed,
      toggleCollapsed,
      setCollapsed,
      isMobileOpen,
      setMobileOpen: setIsMobileOpen,
      toggleMobile,
    }),
    [isCollapsed, toggleCollapsed, setCollapsed, isMobileOpen, toggleMobile]
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutContextValue {
  return useContext(LayoutContext);
}
