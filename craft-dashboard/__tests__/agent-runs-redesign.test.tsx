import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentRunsPage from '../src/app/(dashboard)/agent-runs/page';
import { TraceExplorerWorkspace } from '../src/components/agent-runs/trace-explorer-workspace';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import { AdminAgentRunItem, AdminAgentRunDetails } from '../src/types/admin';

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
  usePathname: () => '/agent-runs',
  useSearchParams: () => mockSearchParams,
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getAgentRuns: jest.fn(),
    getAgentRunDetails: jest.fn(),
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

describe('Phase 11.5 — Agent Runs & Trace Explorer Test Suite', () => {
  const mockRunsList: AdminAgentRunItem[] = [
    {
      id: 'run-101-success',
      conversationId: 'conv-c100',
      userId: 'usr-u1',
      status: 'completed',
      model: 'openai/gpt-oss-120b',
      durationMs: 3420,
      latencyMs: 3420,
      iterationsCount: 2,
      toolCallsCount: 2,
      userPrompt: 'ما هي مواعيد عمل مطعم كرافت في عطلة نهاية الأسبوع؟',
      createdAt: '2026-10-02T10:00:00Z',
      completedAt: '2026-10-02T10:00:03.420Z',
      hasRedactedReasoning: true,
    },
    {
      id: 'run-102-failed',
      conversationId: 'conv-c200',
      userId: 'usr-u2',
      status: 'failed',
      model: 'groq/llama-3.3-70b-versatile',
      durationMs: 1850,
      latencyMs: 1850,
      iterationsCount: 1,
      toolCallsCount: 0,
      userPrompt: 'أريد حجز تذكرة طيران عاجلة',
      errorDetails: 'Upstream gateway timeout on booking provider API',
      createdAt: '2026-10-02T11:00:00Z',
      hasRedactedReasoning: true,
    },
    {
      id: 'run-103-running',
      conversationId: 'conv-c300',
      status: 'running',
      model: 'openai/gpt-oss-120b',
      durationMs: 450,
      latencyMs: 450,
      iterationsCount: 1,
      toolCallsCount: 0,
      userPrompt: 'كم تبعد الرياض عن جدة بالقطار؟',
      createdAt: '2026-10-02T11:30:00Z',
      hasRedactedReasoning: true,
    },
  ];

  const mockRunDetailsData: AdminAgentRunDetails = {
    id: 'run-101-success',
    conversationId: 'conv-c100',
    userId: 'usr-u1',
    status: 'completed',
    model: 'openai/gpt-oss-120b',
    durationMs: 3420,
    latencyMs: 3420,
    iterationsCount: 2,
    toolCallsCount: 2,
    userPrompt: 'ما هي مواعيد عمل مطعم كرافت في عطلة نهاية الأسبوع؟',
    promptSnippet: 'ما هي مواعيد عمل مطعم كرافت في عطلة نهاية الأسبوع؟',
    responseSnippet: 'يعمل مطعم كرافت يومي الجمعة والسبت من 1 ظهرًا حتى 12 منتصف الليل.',
    createdAt: '2026-10-02T10:00:00Z',
    completedAt: '2026-10-02T10:00:03.420Z',
    hasRedactedReasoning: true,
    toolCalls: [
      {
        id: 'tc-web-1',
        toolName: 'web_search',
        arguments: { query: 'مواعيد عمل مطعم كرافت نهاية الأسبوع' },
        result: { status: 'found', schedule: '1pm - 12am' },
        durationMs: 820,
        status: 'success',
      },
      {
        id: 'tc-calc-2',
        toolName: 'calculator',
        arguments: { expression: '12 - 1' },
        result: { value: 11 },
        durationMs: 120,
        status: 'success',
      },
    ],
  };

  const mockFailedDetailsData: AdminAgentRunDetails = {
    id: 'run-102-failed',
    conversationId: 'conv-c200',
    userId: 'usr-u2',
    status: 'failed',
    model: 'groq/llama-3.3-70b-versatile',
    durationMs: 1850,
    latencyMs: 1850,
    iterationsCount: 1,
    toolCallsCount: 0,
    userPrompt: 'أريد حجز تذكرة طيران عاجلة',
    promptSnippet: 'أريد حجز تذكرة طيران عاجلة',
    responseSnippet: '',
    errorDetails: 'Upstream gateway timeout on booking provider API',
    createdAt: '2026-10-02T11:00:00Z',
    hasRedactedReasoning: true,
    toolCalls: [],
  };

  beforeEach(() => {
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    jest.clearAllMocks();

    (adminApi.getAgentRuns as jest.Mock).mockResolvedValue({
      data: mockRunsList,
      pagination: { total: 3, limit: 20, offset: 0, hasMore: false },
    });

    (adminApi.getAgentRunDetails as jest.Mock).mockImplementation((id: string) => {
      if (id === 'run-102-failed') {
        return Promise.resolve({ data: mockFailedDetailsData });
      }
      return Promise.resolve({ data: mockRunDetailsData });
    });
  });

  describe('1. Agent Runs Observatory Page (/agent-runs)', () => {
    it('renders header, title, reasoning policy callout, and operational KPI strip', async () => {
      const Wrapper = createWrapper('en');
      render(<AgentRunsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('AGENT RUNS & EXECUTION TRACES')).toBeInTheDocument();
      expect(
        screen.getByText('Multi-step agent trace telemetry, token budgets, and sanitized tool execution logs')
      ).toBeInTheDocument();

      // Wait for table records to load
      await screen.findByText('run-101-succes...');

      // KPI Strip cards
      expect(screen.getByText('Total Runs')).toBeInTheDocument();
      expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Tool Calls').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Avg Duration')).toBeInTheDocument();

      // Numbers
      expect(screen.getByText('3')).toBeInTheDocument(); // total
      expect(screen.getByText('2')).toBeInTheDocument(); // total tools (2+0+0)
    });

    it('renders table columns with run ID, conversation link, iterations badge, latency, and View Trace action', async () => {
      const Wrapper = createWrapper('en');
      render(<AgentRunsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('run-101-succes...')).toBeInTheDocument();
      expect(screen.getByText('run-102-failed')).toBeInTheDocument();
      expect(screen.getByText('run-103-runnin...')).toBeInTheDocument();

      // Status badges
      expect(screen.getByText('completed')).toBeInTheDocument();
      expect(screen.getByText('failed')).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();

      // Iterations badges
      expect(screen.getByText('2 steps')).toBeInTheDocument();

      // View Trace buttons
      const traceBtns = screen.getAllByRole('button', { name: /View Trace/i });
      expect(traceBtns.length).toBe(3);
    });

    it('supports client-side search across prompt text and resets on clear button click', async () => {
      const Wrapper = createWrapper('en');
      render(<AgentRunsPage />, { wrapper: Wrapper });

      await screen.findByText('run-101-succes...');

      const searchInput = screen.getByPlaceholderText('Search by Run ID, Conversation ID, prompt...');
      fireEvent.change(searchInput, { target: { value: 'طيران' } }); // Search for booking flight prompt

      // run-102-failed matches
      expect(screen.getByText('run-102-failed')).toBeInTheDocument();
      expect(screen.queryByText('run-101-succes...')).not.toBeInTheDocument();

      // Clear search via X button
      const clearSearchBtn = screen.getByLabelText('Clear search');
      fireEvent.click(clearSearchBtn);

      expect(await screen.findByText('run-101-succes...')).toBeInTheDocument();
      expect(screen.getByText('run-102-failed')).toBeInTheDocument();
    });

    it('filters by status and tool presence with active filter pills', async () => {
      const Wrapper = createWrapper('en');
      render(<AgentRunsPage />, { wrapper: Wrapper });

      await screen.findByText('run-101-succes...');

      // Filter by Tool: With Tools Only
      const toolSelect = screen.getByDisplayValue('All Tool Invocations');
      fireEvent.change(toolSelect, { target: { value: 'with_tools' } });

      // Only run-101-success has tools
      expect(screen.getByText('run-101-succes...')).toBeInTheDocument();
      expect(screen.queryByText('run-102-failed')).not.toBeInTheDocument();

      // Active filters pill appears
      expect(screen.getByText(/Active filters:/)).toBeInTheDocument();
      expect(screen.getByText('with_tools')).toBeInTheDocument();

      // Clear filters
      const clearBtn = screen.getByRole('button', { name: /Clear filters/i });
      fireEvent.click(clearBtn);

      expect(screen.getByText('run-102-failed')).toBeInTheDocument();
    });

    it('renders empty state when search matches no records', async () => {
      const Wrapper = createWrapper('en');
      render(<AgentRunsPage />, { wrapper: Wrapper });

      await screen.findByText('run-101-succes...');

      const searchInput = screen.getByPlaceholderText('Search by Run ID, Conversation ID, prompt...');
      fireEvent.change(searchInput, { target: { value: 'non_existent_query_xyz' } });

      expect(await screen.findByText('No agent runs match your filters')).toBeInTheDocument();

      // Clicking reset restores table
      const clearBtns = screen.getAllByRole('button', { name: /Clear filters/i });
      fireEvent.click(clearBtns[0]);

      expect(await screen.findByText('run-101-succes...')).toBeInTheDocument();
    });
  });

  describe('2. Trace Explorer Workspace (TraceExplorerWorkspace)', () => {
    it('opens drawer and displays header, status badge, duration, and reasoning banner', async () => {
      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-101-success"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Wait for trace body to load
      expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();

      expect(screen.getByText('run-101-success')).toBeInTheDocument();
      expect(screen.getByText('AGENT EXECUTION TRACE')).toBeInTheDocument();
      expect(screen.getAllByText('3.42s').length).toBeGreaterThanOrEqual(1);
    });

    it('renders execution summary, conversation link, user 360 link, and user prompt', async () => {
      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-101-success"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();

      // Summary indicators
      expect(screen.getByText('2 steps')).toBeInTheDocument();
      expect(screen.getByText('User Prompt Input')).toBeInTheDocument();
      expect(screen.getByText('ما هي مواعيد عمل مطعم كرافت في عطلة نهاية الأسبوع؟')).toBeInTheDocument();

      // Deep link to conversation
      const convLink = screen.getByRole('link', { name: /Open Conversation/i });
      expect(convLink).toHaveAttribute('href', '/conversations?id=conv-c100');

      // Deep link to user 360
      const userLink = screen.getByRole('link', { name: /User 360/i });
      expect(userLink).toHaveAttribute('href', '/users?userId=usr-u1');
    });

    it('renders chronological execution timeline with preflight and tool steps', async () => {
      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-101-success"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();
      expect(screen.getByText('Request Ingestion & Preflight')).toBeInTheDocument();

      // Tool steps in timeline
      expect(screen.getByText('web_search')).toBeInTheDocument();
      expect(screen.getByText('820ms')).toBeInTheDocument();
      expect(screen.getByText('calculator')).toBeInTheDocument();
      expect(screen.getByText('120ms')).toBeInTheDocument();

      // Outcome
      expect(screen.getByText('Execution Outcome')).toBeInTheDocument();
      expect(screen.getByText('Agent completed operational loop successfully.')).toBeInTheDocument();
    });

    it('expands tool details to reveal sanitized arguments and execution output', async () => {
      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-101-success"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();
      expect(screen.getByText('web_search')).toBeInTheDocument();

      // Expand details buttons
      const toggleBtns = screen.getAllByRole('button', { name: /Toggle Details/i });
      fireEvent.click(toggleBtns[0]); // expand web_search

      // Arguments & result appear
      expect(await screen.findByText('Arguments:')).toBeInTheDocument();
      expect(screen.getByText(/"query": "مواعيد عمل مطعم كرافت نهاية الأسبوع"/)).toBeInTheDocument();
      expect(screen.getByText(/"schedule": "1pm - 12am"/)).toBeInTheDocument();
    });

    it('renders diagnostic error details for failed agent runs', async () => {
      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-102-failed"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(await screen.findByText('Execution Error & Diagnostics')).toBeInTheDocument();
      expect(screen.getByText('Upstream gateway timeout on booking provider API')).toBeInTheDocument();
      expect(screen.getByText('Execution halted with failure state.')).toBeInTheDocument();
    });
  });

  describe('3. Strict Reasoning & Security Verification (Safety Invariant)', () => {
    it('strictly redacts chain-of-thought, system prompts, and credentials from metadata', async () => {
      // Mock an unsafe backend payload that inadvertently has internal thoughts and credentials
      const unsafePayload: any = {
        ...mockRunDetailsData,
        chain_of_thought: 'Confidential reasoning: user is asking for weekend hours.',
        internal_thought: 'Model deliberate plan: invoke web_search then synthesize.',
        system_prompt: 'You are an internal system AI with root privileges.',
        api_key: 'sk_live_super_secret_groq_key_12345',
        authorization: 'Bearer token_secret_9999',
      };

      (adminApi.getAgentRunDetails as jest.Mock).mockResolvedValueOnce({
        data: unsafePayload,
      });

      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-101-success"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Wait for body to finish loading
      expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();

      // Open collapsible Safe Execution Metadata
      const rawMetadataBtn = screen.getByRole('button', { name: /Safe Execution Metadata/i });
      fireEvent.click(rawMetadataBtn);

      // Verify that NO sensitive keys or values are in the DOM
      expect(screen.queryByText(/Confidential reasoning/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/chain_of_thought/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/internal_thought/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/system_prompt/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sk_live_super_secret/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Bearer token_secret/i)).not.toBeInTheDocument();

      // Only allowlisted fields exist
      expect(screen.getByText(/"status": "completed"/)).toBeInTheDocument();
    });

    it('redacts credentials and reasoning from tool arguments and results in the DOM', async () => {
      const payloadWithUnsafeTools: AdminAgentRunDetails = {
        ...mockRunDetailsData,
        toolCalls: [
          {
            id: 'tc-unsafe-1',
            toolName: 'web_search',
            arguments: {
              query: 'latest Flutter release',
              authorization: 'Bearer secret_tok_xyz',
            },
            result: {
              status: 'ok',
              api_key: 'gsk_secret_1234567890abcdef12345',
              reasoning: 'private model reasoning step',
            },
            durationMs: 400,
            status: 'success',
          },
        ],
      };

      (adminApi.getAgentRunDetails as jest.Mock).mockResolvedValueOnce({
        data: payloadWithUnsafeTools,
      });

      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-101-success"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();

      // Expand tool details
      const toggleBtn = screen.getByRole('button', { name: /Toggle Details/i });
      fireEvent.click(toggleBtn);

      // Verify legitimate query is visible
      expect(screen.getByText(/"query": "latest Flutter release"/)).toBeInTheDocument();

      // Verify sensitive keys are redacted in the DOM
      expect(screen.getByText(/"authorization": "\[REDACTED\]"/)).toBeInTheDocument();
      expect(screen.getByText(/"api_key": "\[REDACTED\]"/)).toBeInTheDocument();
      expect(screen.getByText(/"reasoning": "\[REDACTED\]"/)).toBeInTheDocument();

      // Verify sensitive values NEVER appear anywhere in the document
      expect(screen.queryByText(/secret_tok_xyz/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/gsk_secret_1234567890abcdef12345/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/private model reasoning step/i)).not.toBeInTheDocument();
    });

    it('sanitizes database connection URLs and API keys in errorDetails and errorMessage', async () => {
      const payloadWithUnsafeErrors: AdminAgentRunDetails = {
        ...mockFailedDetailsData,
        errorDetails: 'Database connection failed: postgres://admin:secret_password_123@aws.rds.com:5432/db',
        toolCalls: [
          {
            id: 'tc-err-1',
            toolName: 'booking_api',
            arguments: { destination: 'RUH' },
            result: null,
            durationMs: 150,
            status: 'error',
            errorMessage: 'Provider 401: Invalid key gsk_abc12345678901234567890',
          },
        ],
      };

      (adminApi.getAgentRunDetails as jest.Mock).mockResolvedValueOnce({
        data: payloadWithUnsafeErrors,
      });

      const Wrapper = createWrapper('en');
      render(
        <TraceExplorerWorkspace
          runId="run-102-failed"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(await screen.findByText('Execution Error & Diagnostics')).toBeInTheDocument();

      // Sanitized database URL in error diagnostic card
      expect(
        screen.getByText('Database connection failed: postgres://admin:[REDACTED]@aws.rds.com:5432/db')
      ).toBeInTheDocument();
      expect(screen.queryByText(/secret_password_123/i)).not.toBeInTheDocument();

      // Sanitized API key in tool error message
      expect(
        screen.getByText('Provider 401: Invalid key [REDACTED]')
      ).toBeInTheDocument();
      expect(screen.queryByText(/gsk_abc12345678901234567890/i)).not.toBeInTheDocument();
    });
  });

  describe('4. Arabic RTL & Directional Isolation', () => {
    it('renders Agent Runs in Arabic with dir="ltr" on technical identifiers', async () => {
      const Wrapper = createWrapper('ar');
      render(<AgentRunsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('تشغيلات الوكلاء وتتبعات التنفيذ')).toBeInTheDocument();
      expect(screen.getByText('إجمالي التشغيلات')).toBeInTheDocument();
      expect(screen.getByText('المكتملة')).toBeInTheDocument();
      expect(screen.getByText('الفاشلة')).toBeInTheDocument();

      // Wait for table records
      const runIdElem = await screen.findByText('run-101-succes...');
      expect(runIdElem).toHaveAttribute('dir', 'ltr');
    });
  });
});
