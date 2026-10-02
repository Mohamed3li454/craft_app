import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import {
  LanguageProvider,
  useLanguage,
  LANGUAGE_STORAGE_KEY,
} from '../src/lib/i18n/language-context';
import { LanguageSwitcher } from '../src/components/language-switcher';
import { en, ar } from '../src/locales';

describe('Dashboard Localization & Bi-directional RTL Engine', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    document.cookie = '';
  });

  afterEach(() => {
    localStorage.clear();
  });

  // 1. Structural Dictionary Parity
  describe('Dictionary Parity and Completeness', () => {
    function getLeafKeys(obj: any, prefix = ''): string[] {
      let keys: string[] = [];
      for (const k of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof obj[k] === 'object' && obj[k] !== null) {
          keys = keys.concat(getLeafKeys(obj[k], fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    }

    test('English and Arabic dictionaries have exact key parity', () => {
      const enKeys = getLeafKeys(en).sort();
      const arKeys = getLeafKeys(ar).sort();

      expect(arKeys).toEqual(enKeys);
      expect(enKeys.length).toBeGreaterThan(150);
    });

    test('All Arabic entries contain non-empty translations', () => {
      const arKeys = getLeafKeys(ar);
      for (const keyPath of arKeys) {
        const parts = keyPath.split('.');
        let val: any = ar;
        for (const p of parts) {
          val = val[p];
        }
        expect(typeof val).toBe('string');
        expect(val.trim().length).toBeGreaterThan(0);
      }
    });

    test('Technical models, engines, and protocols are preserved accurately', () => {
      expect(en.settings.primaryInferenceEngine).toBe('Primary Inference Engine');
      expect(ar.settings.primaryInferenceEngine).toContain('محرك الاستدلال الأساسي');
      expect(en.security.reasoningRedactedTitle).toContain('Internal Chain-of-Thought Redacted');
      expect(ar.security.reasoningRedactedTitle).toContain('سلسلة التفكير الداخلي');
    });
  });

  // 2. Language Provider and Hooks
  describe('LanguageProvider State and Direction Handling', () => {
    function TestConsumer() {
      const {
        language,
        dir,
        isRtl,
        toggleLanguage,
        setLanguage,
        t,
        formatNumber,
        formatCurrency,
        formatTokens,
      } = useLanguage();

      return (
        <div>
          <span data-testid="lang">{language}</span>
          <span data-testid="dir">{dir}</span>
          <span data-testid="isRtl">{isRtl ? 'true' : 'false'}</span>
          <span data-testid="title">{t('navigation.overview')}</span>
          <span data-testid="interpolated">
            {t('common.showingRecords', { count: 42 })}
          </span>
          <span data-testid="formatted-number">{formatNumber(1250000)}</span>
          <span data-testid="formatted-currency">{formatCurrency(19.99)}</span>
          <span data-testid="formatted-tokens">{formatTokens(1500000)}</span>
          <button data-testid="btn-toggle" onClick={toggleLanguage}>
            Toggle
          </button>
          <button data-testid="btn-set-ar" onClick={() => setLanguage('ar')}>
            Set Arabic
          </button>
          <button data-testid="btn-set-en" onClick={() => setLanguage('en')}>
            Set English
          </button>
        </div>
      );
    }

    test('Initializes with default English and LTR layout', () => {
      render(
        <LanguageProvider>
          <TestConsumer />
        </LanguageProvider>
      );

      expect(screen.getByTestId('lang')).toHaveTextContent('en');
      expect(screen.getByTestId('dir')).toHaveTextContent('ltr');
      expect(screen.getByTestId('isRtl')).toHaveTextContent('false');
      expect(screen.getByTestId('title')).toHaveTextContent('Overview');
    });

    test('Toggling language switches to Arabic and flips dir to RTL', () => {
      render(
        <LanguageProvider>
          <TestConsumer />
        </LanguageProvider>
      );

      const toggleBtn = screen.getByTestId('btn-toggle');

      act(() => {
        fireEvent.click(toggleBtn);
      });

      expect(screen.getByTestId('lang')).toHaveTextContent('ar');
      expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
      expect(screen.getByTestId('isRtl')).toHaveTextContent('true');
      expect(screen.getByTestId('title')).toHaveTextContent('نظرة عامة');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
    });

    test('Interpolates template parameters correctly in both languages', () => {
      render(
        <LanguageProvider>
          <TestConsumer />
        </LanguageProvider>
      );

      expect(screen.getByTestId('interpolated')).toHaveTextContent('Showing 42 records');

      act(() => {
        fireEvent.click(screen.getByTestId('btn-set-ar'));
      });

      expect(screen.getByTestId('interpolated')).toHaveTextContent('عرض 42 من السجلات');
    });

    test('Persists user preference to localStorage and reloads on mount', () => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ar');

      render(
        <LanguageProvider>
          <TestConsumer />
        </LanguageProvider>
      );

      expect(screen.getByTestId('lang')).toHaveTextContent('ar');
      expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
      expect(screen.getByTestId('isRtl')).toHaveTextContent('true');
    });

    test('Formatters handle numbers, currency, and tokens reliably', () => {
      render(
        <LanguageProvider>
          <TestConsumer />
        </LanguageProvider>
      );

      expect(screen.getByTestId('formatted-number')).toHaveTextContent('1,250,000');
      expect(screen.getByTestId('formatted-currency')).toHaveTextContent('$19.99');
      expect(screen.getByTestId('formatted-tokens')).toHaveTextContent('1.50M');
    });
  });

  // 3. Language Switcher UI Component
  describe('LanguageSwitcher Component', () => {
    test('renders interactive language switcher with pill variant', () => {
      render(
        <LanguageProvider>
          <LanguageSwitcher variant="pill" />
        </LanguageProvider>
      );

      const arBtn = screen.getByRole('button', { name: /العربية/i });
      expect(arBtn).toBeInTheDocument();
      expect(arBtn).toHaveAttribute('aria-pressed', 'false');

      act(() => {
        fireEvent.click(arBtn);
      });

      expect(arBtn).toHaveAttribute('aria-pressed', 'true');
      expect(document.documentElement.dir).toBe('rtl');
    });

    test('renders compact variant and toggles language on click', () => {
      render(
        <LanguageProvider>
          <LanguageSwitcher variant="compact" />
        </LanguageProvider>
      );

      const compactBtn = screen.getByRole('button', { name: /switch to arabic/i });
      expect(compactBtn).toBeInTheDocument();

      act(() => {
        fireEvent.click(compactBtn);
      });

      expect(screen.getByRole('button', { name: /switch to english/i })).toBeInTheDocument();
    });
  });
});
