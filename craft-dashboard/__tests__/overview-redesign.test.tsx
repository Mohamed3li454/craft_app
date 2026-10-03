import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { LayoutProvider } from '../src/lib/layout/layout-context';
import { KpiGrid } from '../src/components/overview/kpi-grid';
import { OperationalSignals } from '../src/components/overview/operational-signals';
import { ActivityChart } from '../src/components/overview/activity-chart';
import { ModelBreakdownCard } from '../src/components/overview/model-breakdown-card';
import { RecentConversations } from '../src/components/overview/recent-conversations';
import { TopUsersCard } from '../src/components/overview/top-users-card';
import OverviewPage from '../src/app/(dashboard)/overview/page';
import { adminApi } from '../src/lib/api/admin-client';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/overview',
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getOverview: jest.fn(),
    getHealth: jest.fn(),
    getConversations: jest.fn(),
  },
}));

function createWrapper() {
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
          <LanguageProvider>
            <LayoutProvider>{children}</LayoutProvider>
          </LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  };
}

describe('Phase 11.2 — Overview Redesign & App Shell Test Suite', () => {
  const mockOverviewData = {
    totalUsers: 244,
    activeUsers24h: 38,
    activeUsers7d: 112,
    totalConversations: 98,
    totalMessages: 956,
    totalReminders: 24,
    pendingReminders: 4,
    deliveredReminders: 20,
    totalTokens: 1450000,
    totalCostUsd: 0.85,
    cacheHitRatePercent: 42,
  };

  const mockDailyTrends = [
    {
      date: '2026-10-01',
      messageCount: 45,
      activeUsers: 18,
      tokenCount: 85000,
      costUsd: 0.05,
    },
    {
      date: '2026-10-02',
      messageCount: 68,
      activeUsers: 26,
      tokenCount: 130000,
      costUsd: 0.08,
    },
  ];

  const mockModelBreakdown = [
    {
      model: 'openai/gpt-oss-120b',
      calls: 150,
      tokens: 1100000,
      costUsd: 0.65,
      avgLatencyMs: 320,
    },
    {
      model: 'qwen/qwen3.8-27b',
      calls: 42,
      tokens: 350000,
      costUsd: 0.2,
      avgLatencyMs: 210,
    },
  ];

  const mockTopUsers = [
    {
      userId: 'wa_201012345678',
      phone: '+201012345678',
      messageCount: 88,
      lastActive: '2026-10-03T05:00:00Z',
    },
  ];

  const mockHealthData = {
    service: 'craft-backend',
    environment: 'production',
    status: 'healthy' as const,
    uptimeSeconds: 7200,
    snapshot: {
      status: 'healthy',
      uptimeSeconds: 7200,
      timestamp: '2026-10-03T06:00:00Z',
      components: {
        database: { status: 'healthy', latencyMs: 5 },
        llm: { status: 'healthy', latencyMs: 240 },
        search: { status: 'healthy', latencyMs: 180 },
        cache: { status: 'healthy' },
      },
    },
  };

  const mockRecentConversations = [
    {
      id: 'conv_123',
      userId: 'wa_201012345678',
      userPhone: '+201012345678',
      channel: 'whatsapp',
      status: 'active',
      messageCount: 14,
      lastMessageSnippet: 'Can you remind me about my meeting tomorrow?',
      createdAt: '2026-10-02T10:00:00Z',
      updatedAt: '2026-10-03T04:30:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (adminApi.getOverview as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        overview: mockOverviewData,
        dailyTrends: mockDailyTrends,
        modelBreakdown: mockModelBreakdown,
        topUsers: mockTopUsers,
      },
    });
    (adminApi.getHealth as jest.Mock).mockResolvedValue({
      success: true,
      data: mockHealthData,
    });
    (adminApi.getConversations as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRecentConversations,
    });
  });

  // 1. KPI Grid
  test('KpiGrid renders all 6 real KPI metrics accurately', () => {
    const Wrapper = createWrapper();
    render(
      <KpiGrid
        overview={mockOverviewData}
        healthStatus="healthy"
        isLoading={false}
      />,
      { wrapper: Wrapper }
    );

    // Total Users
    expect(screen.getByText('244')).toBeInTheDocument();
    expect(screen.getByText(/38 active 24h/i)).toBeInTheDocument();

    // Messages
    expect(screen.getByText('956')).toBeInTheDocument();
    expect(screen.getByText(/98 conversations/i)).toBeInTheDocument();

    // Reminders
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText(/4 pending/i)).toBeInTheDocument();

    // Token Usage
    expect(screen.getByText('1.45M')).toBeInTheDocument();
    expect(screen.getByText('$0.85')).toBeInTheDocument();

    // Semantic Cache
    expect(screen.getByText('42%')).toBeInTheDocument();

    // Operational Health
    expect(screen.getByText(/all systems operational/i)).toBeInTheDocument();
  });

  // 2. Operational Signals
  test('OperationalSignals renders real subsystem telemetry', () => {
    const Wrapper = createWrapper();
    render(
      <OperationalSignals health={mockHealthData} isLoading={false} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/operational signals/i)).toBeInTheDocument();
    expect(screen.getByText(/database pool/i)).toBeInTheDocument();
    expect(screen.getByText(/groq inference engine/i)).toBeInTheDocument();
    expect(screen.getByText('(5ms)')).toBeInTheDocument();
  });

  // 3. Activity Volume Chart
  test('ActivityChart renders data bars and responds to metric switching', () => {
    const Wrapper = createWrapper();
    render(
      <ActivityChart data={mockDailyTrends} isLoading={false} days={14} />,
      { wrapper: Wrapper }
    );

    // Initial messages view
    expect(screen.getByText(/daily volume & cost trends/i)).toBeInTheDocument();
    expect(screen.getByText('2026-10-01')).toBeInTheDocument();
    expect(screen.getByText('2026-10-02')).toBeInTheDocument();

    // Switch to Tokens metric
    const tokensTab = screen.getByRole('button', { name: /tokens/i });
    fireEvent.click(tokensTab);

    // Total tokens formatted
    expect(screen.getByText('215.0k')).toBeInTheDocument();
  });

  // 4. Model Breakdown Card
  test('ModelBreakdownCard cleans Groq model identifiers without losing the ID', () => {
    const Wrapper = createWrapper();
    render(
      <ModelBreakdownCard data={mockModelBreakdown} isLoading={false} />,
      { wrapper: Wrapper }
    );

    // Display title & technical ID
    expect(screen.getByText('GPT-OSS 120B')).toBeInTheDocument();
    expect(screen.getByText('openai/gpt-oss-120b')).toBeInTheDocument();
    expect(screen.getByText('Qwen 3.8 27B')).toBeInTheDocument();
    expect(screen.getByText('qwen/qwen3.8-27b')).toBeInTheDocument();

    // Groq Cloud badge
    expect(screen.getByText('Groq Cloud')).toBeInTheDocument();
  });

  // 5. Recent Conversations
  test('RecentConversations renders recent interaction rows and links to conversations', async () => {
    const Wrapper = createWrapper();
    render(<RecentConversations />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('wa_201012345678')).toBeInTheDocument();
    });

    expect(screen.getByText(/Can you remind me about my meeting tomorrow\?/i)).toBeInTheDocument();
    expect(screen.getByText(/view all conversations/i)).toBeInTheDocument();
  });

  // 6. Top Users Card
  test('TopUsersCard renders top active user records with User 360 link', () => {
    const Wrapper = createWrapper();
    render(
      <TopUsersCard data={mockTopUsers} isLoading={false} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText('wa_201012345678')).toBeInTheDocument();
    expect(screen.getByText('+201012345678')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText(/view 360/i)).toBeInTheDocument();
  });

  // 7. Full Overview Page Integration
  test('OverviewPage coordinates queries and renders the complete control plane layout', async () => {
    const Wrapper = createWrapper();
    render(<OverviewPage />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('MISSION CONTROL OVERVIEW')).toBeInTheDocument();
      expect(screen.getByText('244')).toBeInTheDocument();
    });

    // Operational signals loaded
    expect(screen.getByText(/operational signals/i)).toBeInTheDocument();

    // Model breakdown loaded
    expect(screen.getByText('GPT-OSS 120B')).toBeInTheDocument();

    // Top users and recent interactions loaded
    expect(screen.getAllByText('+201012345678').length).toBeGreaterThan(0);
  });
});
