import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationViewer } from '../src/components/conversations/conversation-viewer';
import ConversationsPage from '../src/app/(dashboard)/conversations/page';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { AuthProvider } from '../src/lib/auth/auth-context';
import { AdminConversationItem, AdminMessageItem } from '../src/types/admin';
import { adminApi } from '../src/lib/api/admin-client';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/conversations',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getConversations: jest.fn(),
    getConversationMessages: jest.fn(),
    archiveConversation: jest.fn(),
  },
}));

// Mock auth
jest.mock('../src/lib/auth/auth-context', () => ({
  ...jest.requireActual('../src/lib/auth/auth-context'),
  useAuth: () => ({
    session: { user: { role: 'admin', actorName: 'Admin' } },
    canMutate: true,
    canPurgeData: false,
    isAuthenticated: true,
  }),
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

describe('Phase 11.3 — Conversations & Chat Explorer Redesign Test Suite', () => {
  const mockConversation: AdminConversationItem = {
    id: 'conv-101',
    userId: 'u-101',
    userPhone: '+966501234567',
    userName: 'Ahmed Ali',
    channel: 'whatsapp',
    status: 'active',
    messageCount: 3,
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
  };

  const now = new Date();
  const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).toISOString();
  const yesterdayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 10, 0, 0).toISOString();

  const mockTimelineMessages: AdminMessageItem[] = [
    {
      id: 'msg-y1',
      conversationId: 'conv-101',
      role: 'user',
      sender: 'WhatsApp User',
      senderRole: 'user',
      content: 'ما هي مواعيد العمل لديكم؟',
      createdAt: yesterdayIso,
    },
    {
      id: 'msg-y2',
      conversationId: 'conv-101',
      role: 'assistant',
      sender: 'Craft',
      senderRole: 'assistant',
      content: 'نعمل يومياً من 9 صباحاً حتى 10 مساءً.',
      createdAt: yesterdayIso,
      tokensUsed: 450,
      latencyMs: 1200,
      metadata: {
        model: 'groq/llama-3.3-70b-versatile',
        tokens: 450,
        latencyMs: 1200,
        tools: ['web_search'],
        source: 'ai',
        toolCalls: [
          {
            id: 'tc-web-1',
            toolName: 'web_search',
            arguments: { query: 'مواعيد العمل' },
            result: { resultsCount: 2, sources: ['craft.io/hours'] },
            status: 'completed',
            durationMs: 380,
          },
        ],
      },
    },
    {
      id: 'msg-t1',
      conversationId: 'conv-101',
      role: 'user',
      sender: 'WhatsApp User',
      senderRole: 'user',
      content: 'شكراً جزيلاً!',
      createdAt: todayIso,
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test('1. Renders 2-column workspace layout with Message Timeline and Conversation Info sidebar', async () => {
    const Wrapper = createWrapper('en');
    await act(async () => {
      render(
        <Wrapper>
          <ConversationViewer
            conversation={mockConversation}
            isOpen={true}
            onClose={jest.fn()}
            initialMessages={mockTimelineMessages}
          />
        </Wrapper>
      );
    });

    // Sidebar Header
    expect(screen.getByText('Conversation Details')).toBeInTheDocument();
    // User Profile in sidebar (and/or header)
    expect(screen.getAllByText('View 360° Profile').length).toBeGreaterThanOrEqual(1);
    // Thread Summary section
    expect(screen.getByText('Thread Details')).toBeInTheDocument();
    // AI Telemetry section
    expect(screen.getByText('AI Telemetry')).toBeInTheDocument();
  });

  test('2. Renders Date Separators (Today / Yesterday) between different days', async () => {
    const Wrapper = createWrapper('en');
    await act(async () => {
      render(
        <Wrapper>
          <ConversationViewer
            conversation={mockConversation}
            isOpen={true}
            onClose={jest.fn()}
            initialMessages={mockTimelineMessages}
          />
        </Wrapper>
      );
    });

    // Check for "Yesterday" and "Today" date separator pills
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  test('3. Renders Web Search source badge when web_search tool is used', async () => {
    const Wrapper = createWrapper('en');
    await act(async () => {
      render(
        <Wrapper>
          <ConversationViewer
            conversation={mockConversation}
            isOpen={true}
            onClose={jest.fn()}
            initialMessages={mockTimelineMessages}
          />
        </Wrapper>
      );
    });

    // Web Search badge should be visible
    expect(screen.getByText('Web Search')).toBeInTheDocument();
  });

  test('4. Mobile Info Drawer can be toggled', async () => {
    const Wrapper = createWrapper('en');
    await act(async () => {
      render(
        <Wrapper>
          <ConversationViewer
            conversation={mockConversation}
            isOpen={true}
            onClose={jest.fn()}
            initialMessages={mockTimelineMessages}
          />
        </Wrapper>
      );
    });

    const toggleBtn = screen.getByTitle('Toggle Information');
    expect(toggleBtn).toBeInTheDocument();

    // Click toggle button
    fireEvent.click(toggleBtn);

    // Close button in mobile drawer should exist
    const closeButtons = screen.getAllByLabelText('Close');
    expect(closeButtons.length).toBeGreaterThanOrEqual(1);
  });

  test('5. ConversationsPage renders filter bar, active filter pills, and Clear filters button', async () => {
    (adminApi.getConversations as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'c-1',
          userId: 'u-1',
          userPhone: '+966500000001',
          userName: 'User 1',
          channel: 'whatsapp',
          status: 'active',
          messageCount: 5,
          lastMessageSnippet: 'مرحباً كرافت',
          createdAt: '2026-10-01T10:00:00Z',
          updatedAt: '2026-10-02T12:00:00Z',
        },
        {
          id: 'c-2',
          userId: 'u-2',
          userPhone: '+966500000002',
          userName: 'User 2',
          channel: 'flutter',
          status: 'archived',
          messageCount: 12,
          lastMessageSnippet: 'تم التحقق بنجاح',
          createdAt: '2026-10-01T10:00:00Z',
          updatedAt: '2026-10-02T12:00:00Z',
        },
      ],
      pagination: { total: 2 },
    });

    const Wrapper = createWrapper('en');
    await act(async () => {
      render(
        <Wrapper>
          <ConversationsPage />
        </Wrapper>
      );
    });

    // Verify search input is present
    const searchInput = screen.getByPlaceholderText('Filter by User ID or phone...');
    expect(searchInput).toBeInTheDocument();

    // Type into search filter
    fireEvent.change(searchInput, { target: { value: '966500000001' } });

    // "Clear filters" button should now be rendered
    const clearBtn = screen.getByText('Clear filters');
    expect(clearBtn).toBeInTheDocument();

    // Click "Clear filters"
    fireEvent.click(clearBtn);

    // Search input should be cleared
    expect(searchInput).toHaveValue('');
  });

  test('6. ConversationsPage renders empty state with Clear filters when filters match no records', async () => {
    (adminApi.getConversations as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0 },
    });

    const Wrapper = createWrapper('en');
    await act(async () => {
      render(
        <Wrapper>
          <ConversationsPage />
        </Wrapper>
      );
    });

    // Apply a search filter
    const searchInput = screen.getByPlaceholderText('Filter by User ID or phone...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent-phone' } });

    // Empty state for filtered query
    await waitFor(() => {
      expect(screen.getByText('No conversations match your filters')).toBeInTheDocument();
    });
  });

  test('7. Arabic RTL mode renders localized headers, date separators, and badges', async () => {
    const Wrapper = createWrapper('ar');
    await act(async () => {
      render(
        <Wrapper>
          <ConversationViewer
            conversation={mockConversation}
            isOpen={true}
            onClose={jest.fn()}
            initialMessages={mockTimelineMessages}
          />
        </Wrapper>
      );
    });

    // Arabic Sidebar Header
    expect(screen.getByText('تفاصيل المحادثة')).toBeInTheDocument();
    // Arabic Date Separator "اليوم"
    expect(screen.getByText('اليوم')).toBeInTheDocument();
    // Arabic Date Separator "أمس"
    expect(screen.getByText('أمس')).toBeInTheDocument();
    // Arabic Web Search Badge
    expect(screen.getByText('بحث الويب')).toBeInTheDocument();
    // Arabic View 360 button (sidebar and/or header)
    expect(screen.getAllByText('عرض ملف 360°').length).toBeGreaterThanOrEqual(1);
  });
});
