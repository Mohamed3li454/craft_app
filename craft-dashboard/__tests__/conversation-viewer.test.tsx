import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConversationViewer } from '../src/components/conversations/conversation-viewer';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { AdminMessageItem, AdminConversationItem } from '../src/types/admin';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('Conversation Viewer & Data Contract Verification', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  const mockConversation: AdminConversationItem = {
    id: 'conv-12345',
    userId: 'u-999',
    userPhone: '+201012345678',
    channel: 'whatsapp',
    status: 'active',
    messageCount: 3,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
  };

  const mockMessages: AdminMessageItem[] = [
    {
      id: 'msg-1',
      conversationId: 'conv-12345',
      role: 'user',
      sender: 'WhatsApp User',
      senderRole: 'user',
      senderName: 'WhatsApp User',
      content: 'صباح الخير كرافت، ممكن تفاصيل الحجز؟',
      createdAt: '2026-10-02T11:58:00Z',
    },
    {
      id: 'msg-2',
      conversationId: 'conv-12345',
      role: 'assistant',
      sender: 'Craft',
      senderRole: 'assistant',
      senderName: 'Craft',
      content: 'صباح النور! تم العثور على حجزك المسجل.',
      createdAt: '2026-10-02T11:59:00Z',
      tokensUsed: 1420,
      metadata: {
        model: 'openai/gpt-oss-120b',
        tokens: 1420,
        latencyMs: 1850,
        source: 'ai',
        tools: ['check_booking'],
        toolCalls: [
          {
            id: 'tc-1',
            toolName: 'check_booking',
            arguments: { bookingId: 'BK-789' },
            result: { status: 'confirmed', hotel: 'Craft Grand' },
            status: 'completed',
            durationMs: 420,
          },
        ],
      },
    },
    {
      id: 'msg-3',
      conversationId: 'conv-12345',
      role: 'assistant',
      sender: 'Craft',
      senderRole: 'assistant',
      senderName: 'Craft',
      content: 'هذه الإجابة مخزنة مسبقاً في الذاكرة السريعة.',
      createdAt: '2026-10-02T12:00:00Z',
      tokensUsed: 0,
      metadata: {
        model: null,
        tokens: 0,
        latencyMs: 15,
        source: 'semantic-cache',
      },
    },
  ];

  const renderWithLang = (ui: React.ReactElement, initialLang: 'en' | 'ar' = 'ar') => {
    localStorage.setItem('craft_dashboard_lang', initialLang);
    return render(<LanguageProvider>{ui}</LanguageProvider>);
  };

  test('1. Separates WhatsApp user message and Assistant message with distinct roles', async () => {
    await act(async () => {
      renderWithLang(
        <ConversationViewer
          conversation={mockConversation}
          isOpen={true}
          onClose={jest.fn()}
          initialMessages={mockMessages}
        />
      );
    });

    // User message should be rendered
    expect(screen.getByText('صباح الخير كرافت، ممكن تفاصيل الحجز؟')).toBeInTheDocument();
    // Assistant message should be rendered
    expect(screen.getByText('صباح النور! تم العثور على حجزك المسجل.')).toBeInTheDocument();

    // Verify WhatsApp User label vs Craft label
    expect(screen.getByText('WhatsApp User')).toBeInTheDocument();
    expect(screen.getAllByText('Craft').length).toBeGreaterThanOrEqual(1);
  });

  test('2. Renders Assistant metadata row (Model, Tokens, Latency, Tools)', async () => {
    await act(async () => {
      renderWithLang(
        <ConversationViewer
          conversation={mockConversation}
          isOpen={true}
          onClose={jest.fn()}
          initialMessages={mockMessages}
        />
      );
    });

    // Model name
    expect(screen.getByText('openai/gpt-oss-120b')).toBeInTheDocument();
    // Latency
    expect(screen.getByText('1.85s')).toBeInTheDocument();
    // Tools badge
    expect(screen.getByText('check_booking')).toBeInTheDocument();
  });

  test('3. Semantic Cache is rendered as a clean source badge, not fake assistant model', async () => {
    await act(async () => {
      renderWithLang(
        <ConversationViewer
          conversation={mockConversation}
          isOpen={true}
          onClose={jest.fn()}
          initialMessages={mockMessages}
        />,
        'en'
      );
    });

    expect(screen.getByText('Semantic Cache')).toBeInTheDocument();
  });

  test('4. Tool Call details can be toggled and inspected with sanitized arguments and results', async () => {
    await act(async () => {
      renderWithLang(
        <ConversationViewer
          conversation={mockConversation}
          isOpen={true}
          onClose={jest.fn()}
          initialMessages={mockMessages}
        />,
        'en'
      );
    });

    // Initially tool details collapsed
    expect(screen.queryByText('"bookingId": "BK-789"')).not.toBeInTheDocument();

    // Click on tool call toggle button
    const toolBadge = screen.getByText('check_booking');
    fireEvent.click(toolBadge);

    // Now tool arguments and result are visible
    expect(screen.getByText(/"bookingId":\s*"BK-789"/)).toBeInTheDocument();
    expect(screen.getByText(/"status":\s*"confirmed"/)).toBeInTheDocument();
  });

  test('5. In-conversation search filters matches and displays match count', async () => {
    await act(async () => {
      renderWithLang(
        <ConversationViewer
          conversation={mockConversation}
          isOpen={true}
          onClose={jest.fn()}
          initialMessages={mockMessages}
        />,
        'en'
      );
    });

    // Search input
    const searchInput = screen.getByPlaceholderText('Search in conversation...');
    fireEvent.change(searchInput, { target: { value: 'حجزك' } });

    // Should display matches found
    expect(screen.getByText(/1 matches found/i)).toBeInTheDocument();
  });

  test('6. Pagination button renders when there are older messages remaining', async () => {
    const onLoadOlder = jest.fn();
    const convWith10 = { ...mockConversation, messageCount: 10 };
    await act(async () => {
      renderWithLang(
        <ConversationViewer
          conversation={convWith10}
          isOpen={true}
          onClose={jest.fn()}
          initialMessages={mockMessages}
          onLoadOlder={onLoadOlder}
        />,
        'en'
      );
    });

    const loadOlderBtn = screen.getByText(/Load older messages/i);
    expect(loadOlderBtn).toBeInTheDocument();
    expect(screen.getByText(/7 remaining/i)).toBeInTheDocument();

    fireEvent.click(loadOlderBtn);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  test('7. Empty state renders cleanly when no messages exist', async () => {
    const emptyConv = { ...mockConversation, messageCount: 0 };
    await act(async () => {
      renderWithLang(
        <ConversationViewer
          conversation={emptyConv}
          isOpen={true}
          onClose={jest.fn()}
          initialMessages={[]}
        />,
        'en'
      );
    });

    expect(screen.getByText('No messages found in this conversation thread.')).toBeInTheDocument();
  });
});
