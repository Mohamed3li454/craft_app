'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { en, ar, Language, Direction } from '@/locales';

export const LANGUAGE_STORAGE_KEY = 'craft_dashboard_lang';
export const DEFAULT_LANGUAGE: Language = 'en';

export interface LanguageContextType {
  language: Language;
  dir: Direction;
  isRtl: boolean;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatNumber: (value: number | undefined | null) => string;
  formatCurrency: (amount: number | undefined | null) => string;
  formatDate: (
    dateStr: string | Date | undefined | null,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  formatRelativeTime: (dateStr: string | Date | undefined | null) => string;
  formatTokens: (tokens: number | undefined | null) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  // Initialize from storage or cookie on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
      if (stored === 'en' || stored === 'ar') {
        setLanguageState(stored);
        document.documentElement.lang = stored;
        document.documentElement.dir = stored === 'ar' ? 'rtl' : 'ltr';
      } else {
        // Fallback to checking document attributes
        const docLang = document.documentElement.lang as Language;
        if (docLang === 'ar') {
          setLanguageState('ar');
        }
      }
    } catch {
      // Ignore localStorage access failures
    }
  }, []);

  const dir: Direction = language === 'ar' ? 'rtl' : 'ltr';
  const isRtl = dir === 'rtl';

  const setLanguage = useCallback((newLang: Language) => {
    setLanguageState(newLang);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, newLang);
      document.cookie = `craft_lang=${newLang}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.lang = newLang;
      document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr';
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  }, [language, setLanguage]);

  // Translation helper
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const dict = language === 'ar' ? ar : en;
      let text = getNestedValue(dict, key);

      // Fallback to English if missing in Arabic
      if (text === undefined && language === 'ar') {
        text = getNestedValue(en, key);
      }

      // Fallback to the key itself if not found
      if (text === undefined) {
        return key;
      }

      // Interpolate parameters {count}, {days}, etc.
      if (params) {
        Object.entries(params).forEach(([paramKey, paramVal]) => {
          text = text!.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
        });
      }

      return text;
    },
    [language]
  );

  // Number formatting (using standard digits for clean technical telemetry)
  const formatNumber = useCallback(
    (value: number | undefined | null): string => {
      if (value === undefined || value === null) return '0';
      try {
        const locale = language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
        return new Intl.NumberFormat(locale).format(value);
      } catch {
        return String(value);
      }
    },
    [language]
  );

  // Currency formatting
  const formatCurrency = useCallback(
    (amount: number | undefined | null): string => {
      if (amount === undefined || amount === null) return '$0.00';
      try {
        const locale = language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        }).format(amount);
      } catch {
        return `$${Number(amount).toFixed(2)}`;
      }
    },
    [language]
  );

  // Date formatting
  const formatDate = useCallback(
    (
      dateStr: string | Date | undefined | null,
      options?: Intl.DateTimeFormatOptions
    ): string => {
      if (!dateStr) return '—';
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return String(dateStr);
        const locale = language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
        const defaultOptions: Intl.DateTimeFormatOptions = {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        };
        return new Intl.DateTimeFormat(locale, options || defaultOptions).format(d);
      } catch {
        return String(dateStr);
      }
    },
    [language]
  );

  // Relative time formatting
  const formatRelativeTime = useCallback(
    (dateStr: string | Date | undefined | null): string => {
      if (!dateStr) return '—';
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return String(dateStr);
        const now = Date.now();
        const diffSec = Math.floor((now - d.getTime()) / 1000);

        if (language === 'ar') {
          if (diffSec < 60) return `منذ ${Math.max(0, diffSec)} ثانية`;
          const diffMin = Math.floor(diffSec / 60);
          if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
          const diffHr = Math.floor(diffMin / 60);
          if (diffHr < 24) return `منذ ${diffHr} ساعة`;
          const diffDay = Math.floor(diffHr / 24);
          if (diffDay < 30) return `منذ ${diffDay} يوم`;
          return formatDate(dateStr);
        } else {
          if (diffSec < 60) return `${Math.max(0, diffSec)}s ago`;
          const diffMin = Math.floor(diffSec / 60);
          if (diffMin < 60) return `${diffMin}m ago`;
          const diffHr = Math.floor(diffMin / 60);
          if (diffHr < 24) return `${diffHr}h ago`;
          const diffDay = Math.floor(diffHr / 24);
          if (diffDay < 30) return `${diffDay}d ago`;
          return formatDate(dateStr);
        }
      } catch {
        return String(dateStr);
      }
    },
    [language, formatDate]
  );

  // Token formatting
  const formatTokens = useCallback(
    (tokens: number | undefined | null): string => {
      if (!tokens) return '0';
      if (tokens >= 1_000_000) {
        return `${(tokens / 1_000_000).toFixed(2)}M`;
      }
      if (tokens >= 1_000) {
        return `${(tokens / 1_000).toFixed(1)}k`;
      }
      return formatNumber(tokens);
    },
    [formatNumber]
  );

  const contextValue = useMemo<LanguageContextType>(
    () => ({
      language,
      dir,
      isRtl,
      setLanguage,
      toggleLanguage,
      t,
      formatNumber,
      formatCurrency,
      formatDate,
      formatRelativeTime,
      formatTokens,
    }),
    [
      language,
      dir,
      isRtl,
      setLanguage,
      toggleLanguage,
      t,
      formatNumber,
      formatCurrency,
      formatDate,
      formatRelativeTime,
      formatTokens,
    ]
  );

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
}

const fallbackContext: LanguageContextType = {
  language: 'en',
  dir: 'ltr',
  isRtl: false,
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key: string, params?: Record<string, string | number>): string => {
    let text = getNestedValue(en, key) ?? key;
    if (params) {
      Object.entries(params).forEach(([paramKey, paramVal]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
      });
    }
    return text;
  },
  formatNumber: (v) => (v !== undefined && v !== null ? new Intl.NumberFormat('en-US').format(v) : '0'),
  formatCurrency: (v) => (v !== undefined && v !== null ? `$${Number(v).toFixed(2)}` : '$0.00'),
  formatDate: (d) => (d ? String(d) : '—'),
  formatRelativeTime: (d) => (d ? String(d) : '—'),
  formatTokens: (v) => (v ? String(v) : '0'),
};

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    return fallbackContext;
  }
  return context;
}
