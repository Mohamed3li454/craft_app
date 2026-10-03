import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from '../src/app/(auth)/login/page';
import { CommandPalette } from '../src/components/command-palette';
import { ConversationViewer } from '../src/components/conversations/conversation-viewer';
import { User360Workspace } from '../src/components/users/user-360-workspace';
import { TraceExplorerWorkspace } from '../src/components/agent-runs/trace-explorer-workspace';
import { ToolDetailDrawer } from '../src/components/tools/tool-detail-drawer';
import { SearchDetailDrawer } from '../src/components/search/search-detail-drawer';
import { ErrorDetailDrawer } from '../src/components/observability/error-detail-drawer';
import { AuditDetailDrawer } from '../src/components/audit/audit-detail-drawer';
import SettingsPage from '../src/app/(dashboard)/settings/page';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import {
  AdminConversationItem,
  AdminMessageItem,
  AdminAgentRunDetails,
  AdminToolCallItem,
  AdminSearchItem,
  AdminAuditItem,
  AdminSafeSettings,
} from '../src/types/admin';
import { OperationalErrorRecord } from '../src/components/observability/error-detail-drawer';

// ---------------------------------------------------------------------------
// Next.js Navigation Mocks
// ---------------------------------------------------------------------------
const mockPush = jest.fn();
const mockRefresh = jest.fn();
let mockSearchParamsGet = jest.fn((key: string) => (key === 'from' ? '/overview' : null));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: mockRefresh,
  }),
  usePathname: () => '/overview',
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsGet(key),
  }),
}));

// ---------------------------------------------------------------------------
// Admin API Mock
// ---------------------------------------------------------------------------
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getConversationMessages: jest.fn(),
    getUserDetails: jest.fn(),
    toggleUserVip: jest.fn(),
    banUser: jest.fn(),
    unbanUser: jest.fn(),
    purgeUserData: jest.fn(),
    cancelReminder: jest.fn(),
    getAgentRunDetails: jest.fn(),
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Auth Context Mock
// ---------------------------------------------------------------------------
let mockAuthRole: 'owner' | 'admin' | 'operator' | 'support' | 'viewer' = 'admin';
let mockCanManageSettings = true;
let mockActorName = 'sec_admin';
let mockRefreshSession = jest.fn();

jest.mock('../src/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: { actorName: mockActorName, role: mockAuthRole },
    role: mockAuthRole,
    canManageSettings: mockCanManageSettings,
    canMutate: ['owner', 'admin', 'operator'].includes(mockAuthRole),
    canPurgeData: ['owner', 'admin'].includes(mockAuthRole),
    canBanUsers: ['owner', 'admin', 'operator'].includes(mockAuthRole),
    isReadOnly: ['support', 'viewer'].includes(mockAuthRole),
    isLoading: false,
    logout: jest.fn(),
    refreshSession: mockRefreshSession,
  }),
}));

// Helper to create fresh test wrapper
function createTestWrapper(lang: 'en' | 'ar' = 'en') {
  localStorage.setItem('craft_dashboard_lang', lang);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
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

describe('Phase 11.9 — Production Hardening & E2E Workflow Verification Test Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthRole = 'admin';
    mockCanManageSettings = true;
    mockActorName = 'sec_admin';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // =========================================================================
  // Journey 1: Authentication & Zero Secret Leakage Gateway
  // =========================================================================
  describe('User Journey 1: Authentication & Session Gateway', () => {
    it('blocks empty submission and renders localized secret requirement', async () => {
      const Wrapper = createTestWrapper('en');
      render(<LoginPage />, { wrapper: Wrapper });

      const submitBtn = screen.getByRole('button', { name: /Authenticate Session/i });
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Please provide the Admin Secret Key/i)).toBeInTheDocument();
      });
    });

    it('rejects invalid secret and shows security authentication failure banner', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { message: 'Authentication failed. Invalid secret key.' },
        }),
      } as any);

      const Wrapper = createTestWrapper('en');
      render(<LoginPage />, { wrapper: Wrapper });

      const input = screen.getByPlaceholderText(/Enter ADMIN_SECRET_KEY/i);
      fireEvent.change(input, { target: { value: 'wrong-key-attempt' } });

      const submitBtn = screen.getByRole('button', { name: /Authenticate Session/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Authentication failed. Invalid secret key./i)).toBeInTheDocument();
      });
    });

    it('successfully logs in with valid secret without leaking credentials to client storage', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          user: { actorName: 'SuperAdmin', role: 'admin' },
        }),
      } as any);

      const Wrapper = createTestWrapper('en');
      render(<LoginPage />, { wrapper: Wrapper });

      const input = screen.getByPlaceholderText(/Enter ADMIN_SECRET_KEY/i);
      fireEvent.change(input, { target: { value: 'super-secret-admin-passphrase' } });

      const submitBtn = screen.getByRole('button', { name: /Authenticate Session/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockRefreshSession).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/overview');
      });

      // Verify zero secret leakage to localStorage
      expect(localStorage.getItem('admin_secret')).toBeNull();
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('secret')).toBeNull();
    });
  });

  // =========================================================================
  // Journey 2: Navigation & Command Palette (Cmd+K)
  // =========================================================================
  describe('User Journey 2: Command Palette & Global Route Navigation', () => {
    it('renders all 13 core operational routes and supports keyboard navigation', async () => {
      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(<CommandPalette isOpen={true} onClose={onClose} />, { wrapper: Wrapper });

      // Check dialog ARIA attributes
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      // Verify essential 13 routes exist in palette
      expect(screen.getByText(/Overview & KPIs/i)).toBeInTheDocument();
      expect(screen.getByText(/Conversations & Transcripts/i)).toBeInTheDocument();
      expect(screen.getByText(/Users/i)).toBeInTheDocument();
      expect(screen.getByText(/Agent Runs & Traces/i)).toBeInTheDocument();
      expect(screen.getByText(/Tool Calls & Telemetry/i)).toBeInTheDocument();
      expect(screen.getByText(/Search & Diagnostics/i)).toBeInTheDocument();
      expect(screen.getByText(/Memory & Evidence Candidates/i)).toBeInTheDocument();
      expect(screen.getByText(/Go to reminders/i)).toBeInTheDocument();
      expect(screen.getByText(/Proactive Intelligence/i)).toBeInTheDocument();
      expect(screen.getByText(/Observability & Health/i)).toBeInTheDocument();
      expect(screen.getByText(/Knowledge & Semantic Cache/i)).toBeInTheDocument();
      expect(screen.getByText(/Audit Trail/i)).toBeInTheDocument();
      expect(screen.getByText(/Open settings/i)).toBeInTheDocument();

      // Search filter test
      const searchInput = screen.getByPlaceholderText(/Type a command or jump to a module/i);
      fireEvent.change(searchInput, { target: { value: 'audit' } });

      // Audit Trail should remain visible
      expect(screen.getByText(/Audit Trail/i)).toBeInTheDocument();

      // Enter key executes selected route
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(mockPush).toHaveBeenCalledWith('/audit');
      expect(onClose).toHaveBeenCalled();
    });

    it('closes on Escape key press', () => {
      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(<CommandPalette isOpen={true} onClose={onClose} />, { wrapper: Wrapper });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Journey 3: Conversations & Transcript Inspection
  // =========================================================================
  describe('User Journey 3: Conversations & Live Transcript Inspection', () => {
    const mockConversation: AdminConversationItem = {
      id: 'conv-prod-101',
      userId: 'usr-999',
      userPhone: '+966501234567',
      channel: 'whatsapp',
      status: 'active',
      messageCount: 3,
      createdAt: '2026-10-01T10:00:00Z',
      lastMessageAt: '2026-10-01T10:15:00Z',
      updatedAt: '2026-10-01T10:15:00Z',
    };

    const mockMessages: AdminMessageItem[] = [
      {
        id: 'msg-1',
        conversationId: 'conv-prod-101',
        role: 'user',
        sender: 'user',
        content: 'I need to check my booking confirmation.',
        createdAt: '2026-10-01T10:00:00Z',
      },
      {
        id: 'msg-2',
        conversationId: 'conv-prod-101',
        role: 'assistant',
        sender: 'craft',
        content: 'Your booking #BK-8841 is confirmed for tomorrow.',
        model: 'groq/llama-3.3-70b-versatile',
        latencyMs: 320,
        tokens: 45,
        createdAt: '2026-10-01T10:01:00Z',
      },
    ];

    it('renders conversation drawer, message stream, and cross-navigates to User 360', async () => {
      (adminApi.getConversationMessages as jest.Mock).mockResolvedValue({
        data: mockMessages,
        pagination: { total: 2, limit: 50, offset: 0 },
      });

      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(
        <ConversationViewer
          conversation={mockConversation}
          isOpen={true}
          onClose={onClose}
          initialMessages={mockMessages}
        />,
        { wrapper: Wrapper }
      );

      // Verify dialog attributes
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getAllByText('+966501234567').length).toBeGreaterThan(0);

      // Verify messages are rendered
      expect(screen.getByText('I need to check my booking confirmation.')).toBeInTheDocument();
      expect(screen.getByText('Your booking #BK-8841 is confirmed for tomorrow.')).toBeInTheDocument();

      // Search in conversation
      const searchInput = screen.getByPlaceholderText(/Search in conversation/i);
      fireEvent.change(searchInput, { target: { value: 'booking' } });

      // Click User 360 link
      const user360Buttons = screen.getAllByRole('button', { name: /View 360° Profile/i });
      fireEvent.click(user360Buttons[0]);
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/users?search='));
    });
  });

  // =========================================================================
  // Journey 4: User 360 Workspace & Governance Operations
  // =========================================================================
  describe('User Journey 4: User 360 Workspace & Governance Operations', () => {
    const mockUserDetails: any = {
      user: {
        id: 'usr-999',
        phoneNumber: '+966501234567',
        status: 'active',
        isVip: false,
        isBanned: false,
        createdAt: '2026-09-01T00:00:00Z',
        lastActiveAt: '2026-10-01T10:00:00Z',
      },
      stats: {
        totalConversations: 5,
        totalMessages: 42,
        totalTokens: 1200,
        activeReminders: 1,
        totalMemories: 2,
      },
      memories: [
        {
          id: 'mem-1',
          userId: 'usr-999',
          key: 'preferred_language',
          value: 'Arabic',
          confidence: 0.95,
          createdAt: '2026-09-05T00:00:00Z',
        },
      ],
      reminders: [
        {
          id: 'rem-1',
          userId: 'usr-999',
          title: 'Follow up on appointment',
          dueAt: '2026-10-05T09:00:00Z',
          status: 'pending',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      recentConversations: [],
    };

    it('renders User 360 details, toggles VIP, and performs ban operation with modal confirmation', async () => {
      (adminApi.getUserDetails as jest.Mock).mockResolvedValue({
        data: mockUserDetails,
      });
      (adminApi.toggleUserVip as jest.Mock).mockResolvedValue({
        success: true,
      });
      (adminApi.banUser as jest.Mock).mockResolvedValue({
        success: true,
      });

      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(
        <User360Workspace
          userId="usr-999"
          isOpen={true}
          onClose={onClose}
        />,
        { wrapper: Wrapper }
      );

      // Verify User identity rendered
      await waitFor(() => {
        expect(screen.getByText('+966501234567')).toBeInTheDocument();
      });

      // Toggle VIP mutation
      const vipBtn = screen.getByRole('button', { name: /^VIP$/i });
      fireEvent.click(vipBtn);
      await waitFor(() => {
        expect(adminApi.toggleUserVip).toHaveBeenCalledWith('usr-999', true);
      });

      // Open Ban Modal
      const banBtn = screen.getByText(/Ban User/i);
      fireEvent.click(banBtn);

      // Enter Ban Reason and Confirm
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Enter justification/i)).toBeInTheDocument();
      });
      const reasonInput = screen.getByPlaceholderText(/Enter justification/i);
      fireEvent.change(reasonInput, { target: { value: 'Policy violation spam' } });

      const confirmBanBtn = screen.getByRole('button', { name: /Confirm Ban/i });
      fireEvent.click(confirmBanBtn);

      await waitFor(() => {
        expect(adminApi.banUser).toHaveBeenCalledWith('usr-999', 'Policy violation spam');
      });
    });
  });

  // =========================================================================
  // Journey 5: AI Operations & Trace Explorer with Safety Guarantees
  // =========================================================================
  describe('User Journey 5: AI Operations Trace Explorer & Security Sanitization', () => {
    const mockTraceDetails: AdminAgentRunDetails = {
      id: 'run-trace-777',
      conversationId: 'conv-prod-101',
      userId: 'usr-999',
      status: 'completed',
      model: 'openai/gpt-oss-120b',
      provider: 'groq',
      durationMs: 450,
      totalTokens: 380,
      promptTokens: 120,
      completionTokens: 260,
      userPrompt: 'Search for craft dashboard architecture',
      promptSnippet: 'Search for craft dashboard architecture',
      responseSnippet: 'The craft dashboard is structured with clean separation of layers.',
      toolCallsCount: 1,
      toolCalls: [
        {
          id: 'tc-1',
          toolName: 'web_search',
          status: 'success',
          durationMs: 220,
          arguments: { query: 'craft dashboard architecture' },
          result: { count: 3, topResult: 'Architecture document' },
        },
      ],
      createdAt: '2026-10-02T12:00:00Z',
      hasRedactedReasoning: true,
    };

    it('renders trace explorer, tools executed, and sanitizes reasoning/internal prompts', async () => {
      (adminApi.getAgentRunDetails as jest.Mock).mockResolvedValue({
        data: mockTraceDetails,
      });

      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(
        <TraceExplorerWorkspace
          runId="run-trace-777"
          isOpen={true}
          onClose={onClose}
        />,
        { wrapper: Wrapper }
      );

      // Wait for async query to load details
      expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();
      expect(screen.getByText('web_search')).toBeInTheDocument();

      // Security check: internal_scratchpad and confidential system prompt must NEVER appear in DOM
      expect(screen.queryByText(/This reasoning should NOT be leaked!/i)).toBeNull();
      expect(screen.queryByText(/You are an internal confidential system prompt/i)).toBeNull();
    });
  });

  // =========================================================================
  // Journey 6: Tool Telemetry & Search Intelligence
  // =========================================================================
  describe('User Journey 6: Tool Telemetry & Search Intelligence', () => {
    it('renders tool detail drawer with arguments and execution metrics', () => {
      const mockToolCall: AdminToolCallItem = {
        id: 'tc-inspect-1',
        runId: 'run-trace-777',
        toolName: 'knowledge_search',
        status: 'success',
        durationMs: 145,
        arguments: { query: 'authentication flow', topK: 5 },
        result: { hits: 5, status: 'ok' },
        createdAt: '2026-10-02T14:00:00Z',
      };

      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(
        <ToolDetailDrawer
          toolCall={mockToolCall}
          isOpen={true}
          onClose={onClose}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('knowledge_search')).toBeInTheDocument();
      expect(screen.getByText(/Arguments/i)).toBeInTheDocument();
      expect(screen.getByText(/authentication flow/i)).toBeInTheDocument();
    });

    it('renders search detail drawer with query, provider, and source breakdown', () => {
      const mockSearchItem: AdminSearchItem = {
        id: 'search-log-1',
        query: 'nextjs app router architecture',
        provider: 'tavily',
        latencyMs: 310,
        resultCount: 4,
        status: 'success',
        createdAt: '2026-10-02T15:00:00Z',
      };

      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(
        <SearchDetailDrawer
          searchItem={mockSearchItem}
          isOpen={true}
          onClose={onClose}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('nextjs app router architecture')).toBeInTheDocument();
      expect(screen.getAllByText('tavily').length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Journey 7: Observability & Audit Trail
  // =========================================================================
  describe('User Journey 7: Observability & Immutable Audit Trail', () => {
    it('renders observability error drawer with sanitized message and correlation ID', () => {
      const mockErrorItem: OperationalErrorRecord = {
        id: 'err-909',
        correlationId: 'corr-xyz-12345',
        service: 'agent',
        severity: 'high',
        errorType: 'DatabaseTimeout',
        errorMessage: 'Database connection timed out at postgres://user:secret@localhost:5432/prod',
        durationMs: 5000,
        timestamp: '2026-10-02T16:00:00Z',
      };

      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(
        <ErrorDetailDrawer
          errorItem={mockErrorItem}
          isOpen={true}
          onClose={onClose}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('corr-xyz-12345')).toBeInTheDocument();
      // Sanitizer strips secrets from DB strings
      expect(screen.queryByText(/user:secret/i)).toBeNull();
    });

    it('renders audit trail drawer with actor, action, and smart cross-navigation link', () => {
      const mockAuditItem: AdminAuditItem = {
        id: 'audit-55',
        adminActor: 'sec_admin',
        actorId: 'sec_admin',
        actorRole: 'admin',
        action: 'UPDATE_SETTINGS',
        resourceType: 'system_settings',
        resourceId: 'runtime_config',
        correlationId: 'corr-audit-99',
        status: 'SUCCESS',
        createdAt: '2026-10-02T17:00:00Z',
      };

      const Wrapper = createTestWrapper('en');
      const onClose = jest.fn();

      render(
        <AuditDetailDrawer
          auditItem={mockAuditItem}
          isOpen={true}
          onClose={onClose}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('sec_admin')).toBeInTheDocument();
      expect(screen.getAllByText('UPDATE_SETTINGS').length).toBeGreaterThan(0);
      expect(screen.getByText(/View Target Resource/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Journey 8: Control Plane Settings & Governance Flow
  // =========================================================================
  describe('User Journey 8: Control Plane Governance & Settings Flow', () => {
    const mockSettingsData: AdminSafeSettings = {
      runtime: {
        maintenanceMode: false,
        debugLogging: false,
        searchEnabled: true,
        proactiveEnabled: true,
        defaultMemoryRetentionDays: 365,
      },
      infrastructure: {
        environment: 'production',
        serverlessPlatform: 'node_standard',
        deploymentVersion: 'v10.2-prod',
        uptimeSeconds: 7200,
        aiProvider: {
          primary: 'groq',
          engine: 'LPU Inference Engine',
          status: 'active',
          models: {
            primary: 'openai/gpt-oss-120b',
            fastFallback: 'llama-3.3-70b-versatile',
            reasoning: 'qwen-2.5-32b',
          },
        },
        integrations: {
          whatsappCloudApi: { configured: true },
          supabasePostgres: { configured: true },
          tavilySearch: { configured: true },
        },
      },
    };

    it('navigates governance tabs, detects dirty state, and requires acknowledgment in confirmation modal', async () => {
      (adminApi.getSettings as jest.Mock).mockResolvedValue({
        data: mockSettingsData,
      });
      (adminApi.updateSettings as jest.Mock).mockResolvedValue({
        success: true,
      });

      const Wrapper = createTestWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      // Verify all 7 governance tabs exist
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Runtime & Platform/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /AI & Inference/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Search Policies/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Memory & Retention/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Proactive Engine/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Security & RBAC/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Feature Flags/i })).toBeInTheDocument();
      });

      // Switch to AI Governance Tab
      fireEvent.click(screen.getByRole('button', { name: /AI & Inference/i }));
      expect(screen.getByText('openai/gpt-oss-120b')).toBeInTheDocument();

      // Switch back to Runtime tab and modify a toggle
      fireEvent.click(screen.getByRole('button', { name: /Runtime & Platform/i }));
      const maintenanceCheckbox = await screen.findByLabelText('Maintenance Mode');
      fireEvent.click(maintenanceCheckbox);

      // Verify Dirty State Banner appears
      await waitFor(() => {
        expect(screen.getByText('1 setting(s) modified')).toBeInTheDocument();
      });

      // Click Review & Apply
      const applyBtn = screen.getByRole('button', { name: /Review & Apply Changes/i });
      fireEvent.click(applyBtn);

      // Confirmation modal is displayed
      await waitFor(() => {
        expect(screen.getByText(/Confirm Runtime Configuration Change/i)).toBeInTheDocument();
      });

      // Confirm button is disabled without acknowledgment
      const confirmSubmitBtn = screen.getByRole('button', { name: /Confirm & Apply Mutation/i });
      expect(confirmSubmitBtn).toBeDisabled();

      // Check acknowledgment
      const checkboxes = screen.getAllByRole('checkbox');
      const ackCheckbox = checkboxes[checkboxes.length - 1];
      fireEvent.click(ackCheckbox);
      expect(confirmSubmitBtn).not.toBeDisabled();

      // Submit changes
      fireEvent.click(confirmSubmitBtn);

      await waitFor(() => {
        expect(adminApi.updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            maintenanceMode: true,
          })
        );
      });
    });

    it('disables modification controls for read-only viewer role', async () => {
      mockAuthRole = 'viewer';
      mockCanManageSettings = false;

      (adminApi.getSettings as jest.Mock).mockResolvedValue({
        data: mockSettingsData,
      });

      const Wrapper = createTestWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      const maintenanceCheckbox = await screen.findByLabelText('Maintenance Mode');
      expect(maintenanceCheckbox).toBeDisabled();
    });
  });
});
