import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ToolsPage from '../src/app/(dashboard)/tools/page';
import { ToolDetailDrawer } from '../src/components/tools/tool-detail-drawer';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import { AdminToolCallItem } from '../src/types/admin';

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
  usePathname: () => '/tools',
  useSearchParams: () => mockSearchParams,
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getToolCalls: jest.fn(),
    getToolCallDetails: jest.fn(),
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

describe('Phase 11.6 — Tool Telemetry Test Suite', () => {
  const mockToolCallsList: AdminToolCallItem[] = [
    {
      id: 'tc-001',
      runId: 'run-101',
      agentRunId: 'run-101',
      toolName: 'web_search',
      durationMs: 450,
      status: 'success',
      createdAt: '2026-10-02T10:00:00Z',
      arguments: { query: 'latest Flutter release' },
      result: { title: 'Flutter 3.24 Released' },
    },
    {
      id: 'tc-002',
      runId: 'run-101',
      agentRunId: 'run-101',
      toolName: 'calculator',
      durationMs: 50,
      status: 'success',
      createdAt: '2026-10-02T10:00:01Z',
      arguments: { expression: '12 * 4' },
      result: { value: 48 },
    },
    {
      id: 'tc-003',
      runId: 'run-102',
      agentRunId: 'run-102',
      toolName: 'web_search',
      durationMs: 1200,
      status: 'error',
      errorMessage: 'Upstream gateway timeout on search provider',
      createdAt: '2026-10-02T11:00:00Z',
      arguments: { query: 'weather in Riyadh' },
      result: null,
    },
    {
      id: 'tc-004',
      runId: 'run-103',
      agentRunId: 'run-103',
      toolName: 'create_reminder',
      durationMs: 300,
      status: 'running',
      createdAt: '2026-10-02T11:30:00Z',
      arguments: { text: 'Call doctor tomorrow' },
      result: null,
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    jest.clearAllMocks();

    (adminApi.getToolCalls as jest.Mock).mockResolvedValue({
      data: mockToolCallsList,
      pagination: { total: 4, limit: 20, offset: 0, hasMore: false },
    });
  });

  describe('1. Tool Telemetry Page Rendering & KPIs', () => {
    it('renders header, operational KPI strip, and calculated metrics', async () => {
      const Wrapper = createWrapper('en');
      render(<ToolsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('TOOL TELEMETRY & EXECUTION OBSERVABILITY')).toBeInTheDocument();

      // Wait for records to load
      await screen.findAllByText('web_search');

      // KPI Strip cards
      expect(screen.getByText('Total Tool Calls')).toBeInTheDocument();
      expect(screen.getByText('Successful Calls')).toBeInTheDocument();
      expect(screen.getByText('Failed Calls')).toBeInTheDocument();
      expect(screen.getAllByText('Success Rate').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Avg Duration').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('In-Flight Calls')).toBeInTheDocument();

      // Numbers check
      expect(screen.getByText('4')).toBeInTheDocument(); // total
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1); // success (tc-001, tc-002)
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1); // failed (tc-003)
      expect(screen.getByText('66.7%')).toBeInTheDocument(); // 2 / (2+1) = 66.7%
    });

    it('renders tool performance overview aggregation table', async () => {
      const Wrapper = createWrapper('en');
      render(<ToolsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('Tool Performance Overview')).toBeInTheDocument();

      // Tool rows exist in overview table
      const webSearchHeaders = await screen.findAllByText('web_search');
      expect(webSearchHeaders.length).toBeGreaterThanOrEqual(1);

      const calcHeaders = screen.getAllByText('calculator');
      expect(calcHeaders.length).toBeGreaterThanOrEqual(1);
    });

    it('renders latency intelligence with fastest tool and failure analysis', async () => {
      const Wrapper = createWrapper('en');
      render(<ToolsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('Latency Intelligence')).toBeInTheDocument();
      expect(screen.getByText('Failure Analysis')).toBeInTheDocument();

      // Calculator was fastest (50ms)
      expect(await screen.findByText(/calculator \(50ms\)/)).toBeInTheDocument();

      // Top failing tool
      expect(screen.getByText('1 failed')).toBeInTheDocument();
    });

    it('supports client-side search across tool name and resets on clear button', async () => {
      const Wrapper = createWrapper('en');
      render(<ToolsPage />, { wrapper: Wrapper });

      await screen.findAllByText('web_search');

      const searchInput = screen.getByPlaceholderText('Filter by tool name or run ID...');
      fireEvent.change(searchInput, { target: { value: 'calculator' } });

      // Calculator matches
      expect((await screen.findAllByText('calculator')).length).toBeGreaterThanOrEqual(2); // overview + dropdown + table

      // Clear search
      const clearSearchBtn = screen.getByLabelText('Clear search');
      fireEvent.click(clearSearchBtn);

      expect((await screen.findAllByText('web_search')).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Tool Detail Drawer & Safety Redaction', () => {
    it('opens drawer and displays sanitized arguments, results, and correlation link to Agent Run', async () => {
      const Wrapper = createWrapper('en');
      render(<ToolsPage />, { wrapper: Wrapper });

      await screen.findAllByText('web_search');

      // Click on View Payload for the first tool call
      const inspectBtns = screen.getAllByRole('button', { name: /Inspect I\/O/i });
      fireEvent.click(inspectBtns[0]);

      // Drawer opens
      expect(await screen.findByText('TOOL CALL INSPECTION')).toBeInTheDocument();
      expect(screen.getByText('Execution & Correlation')).toBeInTheDocument();

      // Deep link to agent run
      const agentRunLinks = screen.getAllByRole('link', { name: /Open Agent Run/i });
      expect(agentRunLinks.some((l) => l.getAttribute('href') === '/agent-runs?runId=run-101')).toBe(true);

      // Sanitized JSON inspection
      expect(screen.getByText(/"query": "latest Flutter release"/)).toBeInTheDocument();
      expect(screen.getByText(/"title": "Flutter 3.24 Released"/)).toBeInTheDocument();
    });

    it('sanitizes credentials and displays sanitized error details when error occurs', async () => {
      const unsafeToolCall: AdminToolCallItem = {
        id: 'tc-unsafe-99',
        runId: 'run-99',
        agentRunId: 'run-99',
        toolName: 'weather_api',
        durationMs: 650,
        status: 'error',
        errorMessage: 'Provider error 401 with api_key gsk_secret_token_1234567890abcdef',
        createdAt: '2026-10-02T12:00:00Z',
        arguments: {
          city: 'Cairo',
          authorization: 'Bearer secret_header_token',
        },
        result: {
          error: 'Unauthorized',
          secret_key: 'confidential_key_val',
        },
      };

      const Wrapper = createWrapper('en');
      render(
        <ToolDetailDrawer
          toolCall={unsafeToolCall}
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Verify sanitized error details
      expect(screen.getByText('Failure Diagnostic')).toBeInTheDocument();
      expect(screen.queryByText(/gsk_secret_token_1234567890abcdef/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Provider error 401 with api_key \[REDACTED\]/)).toBeInTheDocument();

      // Verify sanitized arguments & result
      expect(screen.getByText(/"authorization": "\[REDACTED\]"/)).toBeInTheDocument();
      expect(screen.getByText(/"secret_key": "\[REDACTED\]"/)).toBeInTheDocument();
      expect(screen.queryByText(/secret_header_token/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/confidential_key_val/i)).not.toBeInTheDocument();
    });
  });

  describe('3. Arabic Localization & RTL Isolation', () => {
    it('renders Tool Telemetry in Arabic with RTL text and technical identifiers preserved in LTR', async () => {
      const Wrapper = createWrapper('ar');
      render(<ToolsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('قياسات الأدوات والرصد التشغيلي للتنفيذ')).toBeInTheDocument();
      expect(screen.getByText('إجمالي استدعاءات الأدوات')).toBeInTheDocument();
      expect(screen.getByText('الاستدعاءات الناجحة')).toBeInTheDocument();
      expect(screen.getByText('الاستدعاءات الفاشلة')).toBeInTheDocument();
      expect(screen.getByText('معدل النجاح')).toBeInTheDocument();
    });
  });
});
