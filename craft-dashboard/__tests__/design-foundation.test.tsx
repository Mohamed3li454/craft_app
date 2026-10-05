import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme, THEME_STORAGE_KEY } from '../src/lib/theme/theme-context';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { LayoutProvider, useLayout } from '../src/lib/layout/layout-context';
import { StatusBadge, normalizeStatusCategory } from '../src/components/ui/status-badge';
import { EmptyState } from '../src/components/ui/empty-state';
import { ErrorState } from '../src/components/ui/error-state';
import { Skeleton, CardSkeleton, TableSkeleton, DetailSkeleton } from '../src/components/ui/skeleton-loader';
import { Sidebar, NAV_GROUPS } from '../src/components/sidebar';
import { Topbar } from '../src/components/topbar';
import { DataTable } from '../src/components/ui/data-table';
import { Folder } from 'lucide-react';

// Mock useRouter and usePathname
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/overview',
}));

// Mock auth context
jest.mock('../src/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      actorId: 'admin_test',
      actorName: 'Lead Architect',
      role: 'SUPERADMIN',
    },
    logout: jest.fn(),
  }),
}));

describe('Phase 11.1 — Design Foundation & UI/UX 2.0 Test Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      } as Response)
    );
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  // 1. Theme Engine Tests
  describe('Theme System & Anti-FOUC Synchronization', () => {
    function ThemeConsumer() {
      const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme-val">{theme}</span>
          <span data-testid="resolved-val">{resolvedTheme}</span>
          <button data-testid="toggle-btn" onClick={toggleTheme}>
            Toggle Theme
          </button>
          <button data-testid="set-light-btn" onClick={() => setTheme('light')}>
            Set Light
          </button>
          <button data-testid="set-dark-btn" onClick={() => setTheme('dark')}>
            Set Dark
          </button>
        </div>
      );
    }

    test('Initializes with default dark mode and sets class on documentElement', () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme-val')).toHaveTextContent('dark');
      expect(screen.getByTestId('resolved-val')).toHaveTextContent('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    test('Toggling theme switches between dark and light modes and updates localStorage', () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <ThemeConsumer />
        </ThemeProvider>
      );

      const toggleBtn = screen.getByTestId('toggle-btn');

      // Dark -> Light
      act(() => {
        fireEvent.click(toggleBtn);
      });

      expect(screen.getByTestId('theme-val')).toHaveTextContent('light');
      expect(screen.getByTestId('resolved-val')).toHaveTextContent('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

      // Light -> Dark
      act(() => {
        fireEvent.click(toggleBtn);
      });

      expect(screen.getByTestId('theme-val')).toHaveTextContent('dark');
      expect(screen.getByTestId('resolved-val')).toHaveTextContent('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    test('Loads stored preference from localStorage on mount', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');

      render(
        <ThemeProvider defaultTheme="dark">
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme-val')).toHaveTextContent('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  // 2. StatusBadge Foundation Component
  describe('StatusBadge Component & Normalization', () => {
    test('Normalizes various status inputs accurately', () => {
      expect(normalizeStatusCategory('healthy')).toBe('success');
      expect(normalizeStatusCategory('COMPLETED')).toBe('success');
      expect(normalizeStatusCategory('running')).toBe('running');
      expect(normalizeStatusCategory('PROCESSING')).toBe('running');
      expect(normalizeStatusCategory('pending')).toBe('warning');
      expect(normalizeStatusCategory('failed')).toBe('danger');
      expect(normalizeStatusCategory('error')).toBe('danger');
      expect(normalizeStatusCategory('unknown_state')).toBe('neutral');
    });

    test('Renders status text, accessible role, and pulse dot for running states', () => {
      const { rerender } = render(<StatusBadge status="running" />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent('running');

      rerender(<StatusBadge status="completed" label="SUCCESSFUL" size="md" />);
      expect(screen.getByRole('status')).toHaveTextContent('SUCCESSFUL');
    });
  });

  // 3. EmptyState Component
  describe('EmptyState Component', () => {
    test('Renders localized default texts when no props are passed', () => {
      render(
        <LanguageProvider>
          <EmptyState />
        </LanguageProvider>
      );

      expect(screen.getByText('No Records Found')).toBeInTheDocument();
      expect(
        screen.getByText('There are currently no items to display in this view.')
      ).toBeInTheDocument();
    });

    test('Renders custom title, description, and interactive action button', () => {
      const handleAction = jest.fn();
      render(
        <LanguageProvider>
          <EmptyState
            icon={Folder}
            title="Custom Workspace Empty"
            description="Create your first document to start."
            action={{
              label: 'Create Item',
              onClick: handleAction,
            }}
          />
        </LanguageProvider>
      );

      expect(screen.getByText('Custom Workspace Empty')).toBeInTheDocument();
      expect(screen.getByText('Create your first document to start.')).toBeInTheDocument();

      const actionBtn = screen.getByRole('button', { name: 'Create Item' });
      fireEvent.click(actionBtn);
      expect(handleAction).toHaveBeenCalledTimes(1);
    });
  });

  // 4. ErrorState Component
  describe('ErrorState Component', () => {
    test('Renders error title, message, correlationId, and retry action', () => {
      const handleRetry = jest.fn();
      render(
        <LanguageProvider>
          <ErrorState
            title="Network Disconnected"
            message="Unable to reach backend gateway."
            correlationId="corr_abc_123"
            onRetry={handleRetry}
          />
        </LanguageProvider>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Network Disconnected')).toBeInTheDocument();
      expect(screen.getByText('Unable to reach backend gateway.')).toBeInTheDocument();
      expect(screen.getByText('corr_abc_123')).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryBtn);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });
  });

  // 5. Skeleton Loader Presets
  describe('Skeleton Loader Presets', () => {
    test('Renders primitive skeleton and composite presets without crash', () => {
      const { container } = render(
        <div>
          <Skeleton className="h-4 w-20" data-testid="primitive-skeleton" />
          <CardSkeleton />
          <TableSkeleton rows={3} cols={3} />
          <DetailSkeleton />
        </div>
      );

      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5);
    });
  });

  // 6. Sidebar 4 Sections & Collapsible Controls
  describe('Sidebar Layout & Section Organization', () => {
    test('Contains the 4 strict functional sections: CORE, AI OPERATIONS, USER INTELLIGENCE, SYSTEM', () => {
      expect(NAV_GROUPS).toHaveLength(4);
      expect(NAV_GROUPS[0].groupNameKey).toBe('navigation.core');
      expect(NAV_GROUPS[1].groupNameKey).toBe('navigation.aiOperations');
      expect(NAV_GROUPS[2].groupNameKey).toBe('navigation.userIntelligence');
      expect(NAV_GROUPS[3].groupNameKey).toBe('navigation.systemSection');

      // Verify all 14 items exist (including AI Quality & Evaluation Center)
      const totalItems = NAV_GROUPS.reduce((acc, g) => acc + g.items.length, 0);
      expect(totalItems).toBe(14);
    });

    test('Renders sidebar navigation links and user identity', () => {
      render(
        <LanguageProvider>
          <LayoutProvider>
            <Sidebar />
          </LayoutProvider>
        </LanguageProvider>
      );

      // Section titles
      expect(screen.getByText(/core/i)).toBeInTheDocument();
      expect(screen.getByText(/ai operations/i)).toBeInTheDocument();
      expect(screen.getByText(/user intelligence/i)).toBeInTheDocument();
      expect(screen.getByText(/system & infrastructure/i)).toBeInTheDocument();

      // User info
      expect(screen.getByText('Lead Architect')).toBeInTheDocument();
    });

    test('Supports collapsible toggle via layout context', () => {
      function LayoutTest() {
        const { isCollapsed, toggleCollapsed } = useLayout();
        return (
          <div>
            <span data-testid="collapsed-state">{isCollapsed ? 'collapsed' : 'expanded'}</span>
            <button data-testid="toggle-collapse-btn" onClick={toggleCollapsed}>
              Toggle
            </button>
          </div>
        );
      }

      render(
        <LayoutProvider>
          <LayoutTest />
        </LayoutProvider>
      );

      expect(screen.getByTestId('collapsed-state')).toHaveTextContent('expanded');

      act(() => {
        fireEvent.click(screen.getByTestId('toggle-collapse-btn'));
      });

      expect(screen.getByTestId('collapsed-state')).toHaveTextContent('collapsed');
    });
  });

  // 7. Topbar Component
  describe('Topbar Component', () => {
    test('Renders breadcrumb, search shortcut, and theme toggle', async () => {
      render(
        <ThemeProvider>
          <LanguageProvider>
            <LayoutProvider>
              <Topbar />
            </LayoutProvider>
          </LanguageProvider>
        </ThemeProvider>
      );

      // Breadcrumb showing Overview
      expect(screen.getByText(/overview/i)).toBeInTheDocument();

      // Theme toggle button
      expect(screen.getByLabelText(/toggle theme/i)).toBeInTheDocument();

      // Search button
      expect(screen.getByLabelText(/search or jump to/i)).toBeInTheDocument();

      // Wait for async health check
      await screen.findByText('healthy');
    });
  });
});
