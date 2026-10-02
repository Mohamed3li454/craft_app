'use client';

import React from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';

export interface LanguageSwitcherProps {
  className?: string;
  variant?: 'pill' | 'button' | 'compact';
}

export function LanguageSwitcher({ className, variant = 'pill' }: LanguageSwitcherProps) {
  const { language, setLanguage } = useLanguage();

  if (variant === 'compact') {
    return (
      <button
        onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono transition-colors border border-border/80 bg-surface-elevated/40 text-slate-300 hover:text-white hover:border-brand-500/50',
          className
        )}
        title={language === 'en' ? 'التحويل إلى العربية' : 'Switch to English'}
        aria-label={language === 'en' ? 'Switch to Arabic' : 'Switch to English'}
      >
        <Languages className="h-3.5 w-3.5 text-brand-400" />
        <span className="font-semibold">{language === 'en' ? 'العربية' : 'EN'}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-border/80 bg-surface-elevated/40 p-0.5 text-xs font-mono select-none',
        className
      )}
      role="group"
      aria-label="Language Selector"
    >
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 rounded transition-all',
          language === 'en'
            ? 'bg-brand-600 text-white font-semibold shadow-xs'
            : 'text-slate-400 hover:text-slate-200'
        )}
        aria-pressed={language === 'en'}
      >
        <span>English</span>
      </button>

      <button
        type="button"
        onClick={() => setLanguage('ar')}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 rounded transition-all font-sans',
          language === 'ar'
            ? 'bg-brand-600 text-white font-semibold shadow-xs'
            : 'text-slate-400 hover:text-slate-200'
        )}
        aria-pressed={language === 'ar'}
      >
        <span>العربية</span>
      </button>
    </div>
  );
}
