import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SearchPage from '../src/app/(dashboard)/search/page';
import { SearchDetailDrawer } from '../src/components/search/search-detail-drawer';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import { AdminSearchItem, SearchDiagnosticResult } from '../src/types/admin';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// Mock next/navigation
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/search',
  useSearchParams: () => mockSearchParams,
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getRecentSearches: jest.fn(),
    runSearchDiagnostic: jest.fn(),
  },
}));

function createWrapper(initialLang: 'en' | 'ar' = 'en') {
  localStorage.setItem('craft_dashboard_lang', initialLang);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  };
}

describe('Phase 11.6 — Search Intelligence Test Suite', () => {
  const mockSearchesList: AdminSearchItem[] = [
    {
      id: 'tc-search-101',
      query: 'what is the current price of gold in Egypt',
      provider: 'tavily',
      latencyMs: 820,
      sourceCount: 5,
      status: 'success',
      createdAt: '2026-10-02T10:00:00Z',
      freshness: '2026-10-02T10:00:00.820Z',
    },
    {
      id: 'tc-search-102',
      query: 'weather forecast for Alexandria this weekend',
      provider: 'tavily',
      latencyMs: 410,
      sourceCount: 3,
      status: 'success',
      createdAt: '2026-10-02T10:30:00Z',
      freshness: '2026-10-02T10:30:00.410Z',
    },
    {
      id: 'tc-search-103',
      query: 'historical exchange rates 2020',
      provider: 'direct',
      latencyMs: 1500,
      sourceCount: 0,
      status: 'error',
      error: 'Upstream rate limit exceeded',
      createdAt: '2026-10-02T11:00:00Z',
      freshness: '2026-10-02T11:00:01.500Z',
    },
  ];

  const mockDiagnosticResult: SearchDiagnosticResult = {
    query: 'test ping probe',
    provider: 'tavily',
    status: 'success',
    totalResults: 1,
    latencyMs: 120,
    sampleResults: [
      {
        title: 'Craft App Overview',
        url: 'https://craft.example.com',
        snippet: 'Autonomous intelligence assistant operations platform.',
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    jest.clearAllMocks();

    (adminApi.getRecentSearches as jest.Mock).mockResolvedValue({
      data: mockSearchesList,
      pagination: { total: 3, limit: 20, offset: 0, hasMore: false },
    });

    (adminApi.runSearchDiagnostic as jest.Mock).mockResolvedValue({
      data: mockDiagnosticResult,
    });
  });

  describe('1. Search Intelligence Page & KPI Strip', () => {
    it('renders header, operational KPIs, and N/A cards for untracked metrics', async () => {
      const Wrapper = createWrapper('en');
      render(<SearchPage />, { wrapper: Wrapper });

      expect(await screen.findByText('SEARCH INTELLIGENCE & TELEMETRY OBSERVATORY')).toBeInTheDocument();

      // Wait for table to load
      await screen.findByText('what is the current price of gold in Egypt');

      // KPIs
      expect(screen.getByText('Search Operations')).toBeInTheDocument();
      expect(screen.getByText('Successful Searches')).toBeInTheDocument();
      expect(screen.getByText('Failed Searches')).toBeInTheDocument();
      expect(screen.getByText('Avg Search Latency')).toBeInTheDocument();

      // Untracked / N/A metrics
      expect(screen.getByText('Query Refinements')).toBeInTheDocument();
      expect(screen.getByText('Cache Hits')).toBeInTheDocument();
      expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('Telemetry not tracked').length).toBeGreaterThanOrEqual(2);
    });

    it('renders Search Intent Unavailable card per Section 13 specification', async () => {
      const Wrapper = createWrapper('en');
      render(<SearchPage />, { wrapper: Wrapper });

      // Verifies exact required notice without guessing from query text
      expect(
        await screen.findByText('Search intent telemetry is not currently available.')
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'The current search engine does not persist semantic intent classification in its operational telemetry.'
        )
      ).toBeInTheDocument();
    });

    it('renders provider breakdown table and quality signals card', async () => {
      const Wrapper = createWrapper('en');
      render(<SearchPage />, { wrapper: Wrapper });

      expect(await screen.findByText('what is the current price of gold in Egypt')).toBeInTheDocument();
      expect(screen.getByText('Search Provider & Source Intelligence')).toBeInTheDocument();
      expect(screen.getByText('Search Quality Signals')).toBeInTheDocument();
      expect(screen.getByText('Search quality telemetry: Limited')).toBeInTheDocument();

      // Provider rows
      expect(screen.getAllByText('TAVILY').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('DIRECT').length).toBeGreaterThanOrEqual(1);
    });

    it('filters search operations table by query and status', async () => {
      const Wrapper = createWrapper('en');
      render(<SearchPage />, { wrapper: Wrapper });

      await screen.findByText('what is the current price of gold in Egypt');

      const searchInput = screen.getByPlaceholderText('Filter searches by query or provider...');
      fireEvent.change(searchInput, { target: { value: 'Alexandria' } });

      // Only Alexandria match is rendered in filtered list
      expect(screen.getByText('weather forecast for Alexandria this weekend')).toBeInTheDocument();
      expect(screen.queryByText('what is the current price of gold in Egypt')).not.toBeInTheDocument();

      // Reset
      const clearSearchBtn = screen.getByLabelText('Clear search');
      fireEvent.click(clearSearchBtn);

      expect(await screen.findByText('what is the current price of gold in Egypt')).toBeInTheDocument();
    });
  });

  describe('2. Search Detail Drawer & Cross-Navigation', () => {
    it('opens drawer and displays query, telemetry signals, and link to Tool Telemetry', async () => {
      const Wrapper = createWrapper('en');
      render(<SearchPage />, { wrapper: Wrapper });

      await screen.findByText('what is the current price of gold in Egypt');

      // Click on Inspect
      const inspectBtns = screen.getAllByRole('button', { name: /Inspect/i });
      fireEvent.click(inspectBtns[0]);

      // Drawer opens
      expect(await screen.findByText('SEARCH OPERATION DETAILS')).toBeInTheDocument();
      expect(screen.getAllByText('what is the current price of gold in Egypt').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Correlated as Tool Call')).toBeInTheDocument();

      // Cross-navigation link to /tools?toolCallId=tc-search-101
      const toolLink = screen.getByRole('link', { name: /View in Tool Telemetry/i });
      expect(toolLink).toHaveAttribute('href', '/tools?toolCallId=tc-search-101');
    });

    it('sanitizes search query string and prevents credential exposure', () => {
      const unsafeSearchItem: AdminSearchItem = {
        id: 'tc-search-99',
        query: 'search with token Bearer secret_query_token_123',
        provider: 'tavily',
        latencyMs: 300,
        sourceCount: 2,
        status: 'success',
        createdAt: '2026-10-02T12:00:00Z',
      };

      const Wrapper = createWrapper('en');
      render(
        <SearchDetailDrawer
          searchItem={unsafeSearchItem}
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Verify token is redacted in displayed query
      expect(screen.queryByText(/secret_query_token_123/i)).not.toBeInTheDocument();
      expect(screen.getByText(/search with token Bearer \[REDACTED\]/)).toBeInTheDocument();
    });
  });

  describe('3. Diagnostic Probe Execution (Dry-Run)', () => {
    it('triggers dry-run diagnostic mutation and renders result preview', async () => {
      const Wrapper = createWrapper('en');
      render(<SearchPage />, { wrapper: Wrapper });

      const probeInput = screen.getByPlaceholderText('Enter test search query (e.g. current gold price in Egypt)...');
      fireEvent.change(probeInput, { target: { value: 'test ping probe' } });

      const probeBtn = screen.getByRole('button', { name: /Probe Provider/i });
      fireEvent.click(probeBtn);

      // Verify probe response rendered
      expect(await screen.findByText('Craft App Overview')).toBeInTheDocument();
      expect(
        screen.getByText('Autonomous intelligence assistant operations platform.')
      ).toBeInTheDocument();
    });
  });

  describe('4. Arabic Localization & RTL Isolation', () => {
    it('renders Search Intelligence in Arabic with RTL text and technical identifiers preserved in LTR', async () => {
      const Wrapper = createWrapper('ar');
      render(<SearchPage />, { wrapper: Wrapper });

      expect(await screen.findByText('ذكاء البحث ومرصد القياسات التشغيلية')).toBeInTheDocument();
      expect(screen.getByText('عمليات البحث')).toBeInTheDocument();
      expect(screen.getByText('عمليات البحث الناجحة')).toBeInTheDocument();
      expect(screen.getByText('عمليات البحث الفاشلة')).toBeInTheDocument();
      expect(screen.getByText('متوسط زمن البحث')).toBeInTheDocument();
    });
  });
});
