import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UsersPage from '../src/app/(dashboard)/users/page';
import { User360Workspace } from '../src/components/users/user-360-workspace';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import { AdminUserListItem, UserDetails360 } from '../src/types/admin';

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
  usePathname: () => '/users',
  useSearchParams: () => mockSearchParams,
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getUsers: jest.fn(),
    getUserDetails: jest.fn(),
    toggleUserVip: jest.fn(),
    banUser: jest.fn(),
    unbanUser: jest.fn(),
    purgeUserMemories: jest.fn(),
    retryReminder: jest.fn(),
    cancelReminder: jest.fn(),
  },
}));

// Mock auth state
let mockAuthRole: 'admin' | 'operator' | 'viewer' | 'support' = 'admin';
let mockCanMutate = true;
let mockCanBanUsers = true;
let mockCanPurgeData = true;

jest.mock('../src/lib/auth/auth-context', () => ({
  ...jest.requireActual('../src/lib/auth/auth-context'),
  useAuth: () => ({
    user: { id: 'admin-1', role: mockAuthRole, username: 'admin' },
    role: mockAuthRole,
    canMutate: mockCanMutate,
    canBanUsers: mockCanBanUsers,
    canPurgeData: mockCanPurgeData,
    canManageSettings: mockAuthRole === 'admin',
    isReadOnly: !mockCanMutate,
    isLoading: false,
    logout: jest.fn(),
    refreshSession: jest.fn(),
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

describe('Phase 11.4 — Users & User 360 Redesign Test Suite', () => {
  const mockUsersList: AdminUserListItem[] = [
    {
      id: 'usr-101',
      phoneNumber: '+966501112233',
      channel: 'whatsapp',
      isVip: true,
      isBanned: false,
      conversationCount: 14,
      messageCount: 82,
      reminderCount: 3,
      createdAt: '2026-09-01T12:00:00Z',
      lastActiveAt: '2026-10-02T15:30:00Z',
    },
    {
      id: 'usr-102',
      phoneNumber: '+966509998877',
      channel: 'flutter',
      isVip: false,
      isBanned: true,
      banReason: 'Spam policy violation',
      conversationCount: 2,
      messageCount: 9,
      reminderCount: 0,
      createdAt: '2026-09-15T08:00:00Z',
      lastActiveAt: '2026-09-20T10:00:00Z',
    },
  ];

  const mockUserDetailsData: UserDetails360 = {
    user: {
      id: 'usr-101',
      phoneNumber: '+966501112233',
      channel: 'whatsapp',
      isVip: true,
      isBanned: false,
      messageCount: 82,
      conversationCount: 14,
      reminderCount: 1,
      createdAt: '2026-09-01T12:00:00Z',
      lastActiveAt: '2026-10-02T15:30:00Z',
      dailyMessageCount: 12,
    },
    stats: {
      totalConversations: 14,
      totalMessages: 82,
      memoryCount: 2,
      totalReminders: 1,
      activeReminders: 1,
      tokenCount: 45200,
      costUsd: 0.089,
    },
    whatsappContact: {
      waId: '966501112233',
      profileName: 'Tariq Al-Mansour',
      verified: true,
      bsuid: 'bsuid-whatsapp-966501112233',
    },
    preferences: {
      preferredLanguage: 'ar',
      dietaryPreference: 'Gluten-Free',
    },
    recentConversations: [
      {
        id: 'conv-c1',
        userId: 'usr-101',
        channel: 'whatsapp',
        status: 'active',
        messageCount: 18,
        lastMessageSnippet: 'هل يمكن تأكيد حجز طاولة لشخصين الليلة؟',
        createdAt: '2026-10-01T18:00:00Z',
        updatedAt: '2026-10-02T15:30:00Z',
      },
    ],
    memories: [
      {
        id: 'mem-1',
        userId: 'usr-101',
        category: 'preference',
        key: 'dietary',
        value: 'Strictly gluten-free and prefers quiet seating',
        confidence: 0.95,
        createdAt: '2026-09-05T14:20:00Z',
      },
      {
        id: 'mem-2',
        userId: 'usr-101',
        category: 'fact',
        key: 'vip_status',
        value: 'Frequent executive diner since August 2026',
        confidence: 0.88,
        createdAt: '2026-09-10T11:00:00Z',
      },
    ],
    reminders: [
      {
        id: 'rem-1',
        userId: 'usr-101',
        title: 'Send dinner booking confirmation via WhatsApp',
        status: 'scheduled',
        scheduledTime: '2026-10-04T17:00:00Z',
        recurrence: 'daily',
        attempts: 0,
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    mockAuthRole = 'admin';
    mockCanMutate = true;
    mockCanBanUsers = true;
    mockCanPurgeData = true;
    jest.clearAllMocks();

    (adminApi.getUsers as jest.Mock).mockResolvedValue({
      data: mockUsersList,
      pagination: { total: 2, limit: 20, offset: 0, hasMore: false },
    });

    (adminApi.getUserDetails as jest.Mock).mockResolvedValue({
      data: mockUserDetailsData,
    });
  });

  describe('1. Users Directory Page (/users)', () => {
    it('renders header, title, and operational KPI chips from real data', async () => {
      const Wrapper = createWrapper('en');
      render(<UsersPage />, { wrapper: Wrapper });

      expect(await screen.findByText('USER DIRECTORY & 360° INTELLIGENCE')).toBeInTheDocument();
      expect(screen.getByText('Filter and inspect user profiles, VIP overrides, memory, and safety status')).toBeInTheDocument();

      // Wait for table data to load
      await screen.findByText('+966501112233');

      // KPI chips
      expect(screen.getByText(/Total Users:/)).toBeInTheDocument();
      expect(screen.getByText(/Active Users:/)).toBeInTheDocument();
      expect(screen.getByText(/VIP:/)).toBeInTheDocument();
      expect(screen.getByText(/Banned:/)).toBeInTheDocument();
    });

    it('renders users table with user identity, phone with ltr, and badges', async () => {
      const Wrapper = createWrapper('en');
      render(<UsersPage />, { wrapper: Wrapper });

      expect(await screen.findByText('+966501112233')).toBeInTheDocument();
      expect(screen.getByText('+966509998877')).toBeInTheDocument();

      // Check VIP badge
      const vipBadges = screen.getAllByTitle('VIP');
      expect(vipBadges.length).toBeGreaterThanOrEqual(1);

      // Check status badge (Active and Banned)
      expect(screen.getByText('active')).toBeInTheDocument();
      expect(screen.getByText('banned')).toBeInTheDocument();

      // Check 360° action buttons
      const buttons360 = screen.getAllByText('360°');
      expect(buttons360.length).toBe(2);
    });

    it('supports search input and resets on clear button click', async () => {
      const Wrapper = createWrapper('en');
      render(<UsersPage />, { wrapper: Wrapper });

      const searchInput = await screen.findByPlaceholderText('Search by phone number or ID...');
      fireEvent.change(searchInput, { target: { value: '966501112233' } });

      // Search clear button appears
      const clearSearchBtn = screen.getByLabelText('Clear search');
      expect(clearSearchBtn).toBeInTheDocument();

      // Active filters pill appears
      expect(screen.getByText(/Active filters:/)).toBeInTheDocument();
      expect(screen.getByText(/"966501112233"/)).toBeInTheDocument();

      // Clicking clear resets search
      fireEvent.click(clearSearchBtn);
      expect(searchInput).toHaveValue('');
    });

    it('filters users by channel and shows active filter pill', async () => {
      const Wrapper = createWrapper('en');
      render(<UsersPage />, { wrapper: Wrapper });

      await screen.findByText('+966501112233');

      // Select Flutter channel
      const channelSelect = screen.getByDisplayValue('All Channels');
      fireEvent.change(channelSelect, { target: { value: 'flutter' } });

      // Now only flutter user is shown
      expect(screen.queryByText('+966501112233')).not.toBeInTheDocument();
      expect(screen.getByText('+966509998877')).toBeInTheDocument();

      // Clear filters button
      const clearFiltersBtn = screen.getByText('Clear filters');
      fireEvent.click(clearFiltersBtn);

      // Both users are back
      expect(screen.getByText('+966501112233')).toBeInTheDocument();
      expect(screen.getByText('+966509998877')).toBeInTheDocument();
    });

    it('renders empty state when search/filter yields zero results', async () => {
      const Wrapper = createWrapper('en');
      render(<UsersPage />, { wrapper: Wrapper });

      await screen.findByText('+966501112233');

      // Filter by Web channel (which none of mock users have)
      const channelSelect = screen.getByDisplayValue('All Channels');
      fireEvent.change(channelSelect, { target: { value: 'web' } });

      expect(await screen.findByText('No users match your filters')).toBeInTheDocument();

      // Clicking clear filters in empty state restores list
      const clearBtns = screen.getAllByRole('button', { name: /Clear filters/i });
      fireEvent.click(clearBtns[0]);

      expect(await screen.findByText('+966501112233')).toBeInTheDocument();
    });
  });

  describe('2. User 360 Workspace Drawer (User360Workspace)', () => {
    it('opens drawer and displays identity header with phone, status, and verified WhatsApp tag', async () => {
      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(await screen.findByText('+966501112233')).toBeInTheDocument();
      expect(screen.getByText('Verified')).toBeInTheDocument();
      expect(screen.getByText(/ID:/)).toBeInTheDocument();
    });

    it('renders Overview tab with KPIs, WhatsApp contact identity, and user preferences', async () => {
      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Wait until user details are loaded
      expect(await screen.findByText('Tariq Al-Mansour')).toBeInTheDocument();

      // KPI cards
      expect(screen.getByText('14')).toBeInTheDocument();
      expect(screen.getByText('82')).toBeInTheDocument();
      expect(screen.getByText('45,200')).toBeInTheDocument();

      // WhatsApp Contact
      expect(screen.getByText('WhatsApp Channel Identity')).toBeInTheDocument();
      expect(screen.getByText('966501112233')).toBeInTheDocument();
      expect(screen.getByText('bsuid-whatsapp-966501112233')).toBeInTheDocument();

      // User Preferences
      expect(screen.getByText('User Preferences & Persona Parameters')).toBeInTheDocument();
      expect(screen.getByText('dietaryPreference:')).toBeInTheDocument();
      expect(screen.getByText('Gluten-Free')).toBeInTheDocument();
    });

    it('renders Conversations tab with snippet, message count, and deep link', async () => {
      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Wait until loaded
      await screen.findByText('Tariq Al-Mansour');

      // Click on Conversations tab button
      const convTabBtn = screen.getByRole('button', { name: /Conversations/i });
      fireEvent.click(convTabBtn);

      // Verify snippet
      expect(await screen.findByText(/هل يمكن تأكيد حجز طاولة لشخصين الليلة؟/)).toBeInTheDocument();
      expect(screen.getByText(/18 Messages/i)).toBeInTheDocument();
      expect(screen.getByText('View Transcript')).toBeInTheDocument();
      expect(screen.getByText('Open Conversation')).toBeInTheDocument();

      // Deep link has correct query param
      const link = screen.getByRole('link', { name: /Open Conversation/i });
      expect(link).toHaveAttribute('href', '/conversations?id=conv-c1');
    });

    it('renders Memory tab with confidence, key, value, and triggers purge modal', async () => {
      (adminApi.purgeUserMemories as jest.Mock).mockResolvedValue({ success: true });

      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      await screen.findByText('Tariq Al-Mansour');

      // Click Memory tab button
      const memTabBtn = screen.getByRole('button', { name: /Stored Memories/i });
      fireEvent.click(memTabBtn);

      // Verify memory items
      expect(await screen.findByText('Strictly gluten-free and prefers quiet seating')).toBeInTheDocument();
      expect(screen.getByText('Frequent executive diner since August 2026')).toBeInTheDocument();
      expect(screen.getByText('dietary')).toBeInTheDocument();
      expect(screen.getByText('vip_status')).toBeInTheDocument();

      // Purge memories button is present for admin
      const purgeBtn = screen.getByRole('button', { name: /Purge All Memories/i });
      fireEvent.click(purgeBtn);

      // Purge confirmation modal opens
      expect(await screen.findByText('Purge All User Memories')).toBeInTheDocument();
      const confirmPurgeBtn = screen.getByRole('button', { name: /Purge User Memory/i });
      fireEvent.click(confirmPurgeBtn);

      await waitFor(() => {
        expect(adminApi.purgeUserMemories).toHaveBeenCalledWith('usr-101');
      });
    });

    it('renders Reminders tab and handles retry & cancel with modal', async () => {
      (adminApi.retryReminder as jest.Mock).mockResolvedValue({ success: true });
      (adminApi.cancelReminder as jest.Mock).mockResolvedValue({ success: true });

      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      await screen.findByText('Tariq Al-Mansour');

      // Click Reminders tab button
      const remTabBtn = screen.getByRole('button', { name: /Active Reminders/i });
      fireEvent.click(remTabBtn);

      expect(await screen.findByText('Send dinner booking confirmation via WhatsApp')).toBeInTheDocument();
      expect(screen.getByText(/↻ daily/)).toBeInTheDocument();

      // Test Retry
      const retryBtn = screen.getByRole('button', { name: /Retry Now/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(adminApi.retryReminder).toHaveBeenCalledWith('rem-1');
      });

      // Test Cancel with confirmation modal
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      expect(await screen.findByText('Cancel Reminder')).toBeInTheDocument();
      const confirmCancelBtn = screen.getByRole('button', { name: /Confirm Cancellation/i });
      fireEvent.click(confirmCancelBtn);

      await waitFor(() => {
        expect(adminApi.cancelReminder).toHaveBeenCalledWith('rem-1', undefined);
      });
    });

    it('renders Activity tab with telemetry token stats', async () => {
      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      await screen.findByText('Tariq Al-Mansour');

      // Click Activity tab button
      const activityTabBtn = screen.getByRole('button', { name: /Agent Telemetry/i });
      fireEvent.click(activityTabBtn);

      expect(await screen.findByText('Telemetry & Metrics')).toBeInTheDocument();
      expect(screen.getByText('Prompt Tokens')).toBeInTheDocument();
      expect(screen.getByText('Completion Tokens')).toBeInTheDocument();
      expect(screen.getByText('Daily Message Volume')).toBeInTheDocument();
      expect(screen.getByText('Estimated Resource Spend')).toBeInTheDocument();
      expect(screen.getByText('No agent activity recorded.')).toBeInTheDocument();
    });
  });

  describe('3. RBAC Enforcement', () => {
    it('hides Purge Memories button when role is operator (cannot purge)', async () => {
      mockAuthRole = 'operator';
      mockCanMutate = true;
      mockCanBanUsers = true;
      mockCanPurgeData = false;

      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      await screen.findByText('Tariq Al-Mansour');
      const memTabBtn = screen.getByRole('button', { name: /Stored Memories/i });
      fireEvent.click(memTabBtn);

      await screen.findByText('Strictly gluten-free and prefers quiet seating');

      // Purge button must NOT be present
      expect(screen.queryByRole('button', { name: /Purge All Memories/i })).not.toBeInTheDocument();
    });

    it('disables/hides all mutation controls for viewer role (read-only)', async () => {
      mockAuthRole = 'viewer';
      mockCanMutate = false;
      mockCanBanUsers = false;
      mockCanPurgeData = false;

      const Wrapper = createWrapper('en');
      render(
        <User360Workspace
          userId="usr-101"
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      await screen.findByText('Tariq Al-Mansour');

      // VIP button hidden
      expect(screen.queryByTitle(/VIP/i)).not.toBeInTheDocument();
      // Ban button hidden
      expect(screen.queryByTitle(/Ban User/i)).not.toBeInTheDocument();

      // Check Reminders tab has no Retry or Cancel buttons
      const remTabBtn = screen.getByRole('button', { name: /Active Reminders/i });
      fireEvent.click(remTabBtn);

      await screen.findByText('Send dinner booking confirmation via WhatsApp');
      expect(screen.queryByRole('button', { name: /Retry Now/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument();
    });
  });

  describe('4. Arabic RTL & Localization', () => {
    it('renders users page and user 360 in Arabic with dir="ltr" on phone numbers', async () => {
      const Wrapper = createWrapper('ar');
      render(<UsersPage />, { wrapper: Wrapper });

      expect(await screen.findByText('دليل المستخدمين وذكاء الملف التعريفي 360°')).toBeInTheDocument();
      expect(screen.getByText(/إجمالي المستخدمين/)).toBeInTheDocument();
      expect(screen.getByText(/المستخدمون النشطون/)).toBeInTheDocument();

      // Phone numbers retain ltr attribute
      const phoneElem = await screen.findByText('+966501112233');
      expect(phoneElem).toHaveAttribute('dir', 'ltr');
    });
  });
});
