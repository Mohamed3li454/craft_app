import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditPage from '../src/app/(dashboard)/audit/page';
import { AuditDetailDrawer } from '../src/components/audit/audit-detail-drawer';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import { AdminAuditItem } from '../src/types/admin';

// Mock navigation
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/audit',
  useSearchParams: () => mockSearchParams,
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getAuditLogs: jest.fn(),
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

describe('Phase 11.7 — Admin Audit Trail Test Suite', () => {
  const mockAuditLogs: AdminAuditItem[] = [
    {
      id: 'audit-001',
      adminActor: 'super_admin',
      actorRole: 'owner',
      action: 'USER_BAN',
      resourceType: 'user',
      resourceId: 'usr-vip-99',
      status: 'success',
      correlationId: 'corr-req-101',
      metadata: { reason: 'Abusive language detected' },
      createdAt: '2026-10-03T09:00:00Z',
    },
    {
      id: 'audit-002',
      adminActor: 'ops_lead',
      actorRole: 'admin',
      action: 'UPDATE_SETTINGS',
      resourceType: 'settings',
      resourceId: 'runtime_config',
      status: 'success',
      correlationId: 'corr-req-102',
      metadata: { searchEnabled: true, maintenanceMode: false },
      createdAt: '2026-10-03T09:15:00Z',
    },
    {
      id: 'audit-003',
      adminActor: 'ops_lead',
      actorRole: 'admin',
      action: 'CANCEL_REMINDER',
      resourceType: 'reminder',
      resourceId: 'rem-505',
      status: 'failure',
      errorMessage: 'Database connection timeout on lock acquisition',
      correlationId: 'corr-req-103',
      metadata: { attempt: 3 },
      createdAt: '2026-10-03T09:30:00Z',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    jest.clearAllMocks();

    (adminApi.getAuditLogs as jest.Mock).mockResolvedValue({
      data: mockAuditLogs,
      pagination: { total: 3, limit: 25, offset: 0, hasMore: false },
    });
  });

  describe('1. Audit Trail Page & Immutability UX', () => {
    it('renders header, compliance invariant notice, and verifies strictly read-only UX', async () => {
      const Wrapper = createWrapper('en');
      render(<AuditPage />, { wrapper: Wrapper });

      expect(await screen.findByText('ADMIN AUDIT TRAIL & COMPLIANCE LOGS')).toBeInTheDocument();

      // Invariant notice
      expect(
        screen.getByText(
          'Compliance Invariant: The audit trail is strictly read-only and recorded synchronously with correlation IDs across all operational endpoints.'
        )
      ).toBeInTheDocument();

      // Immutability UX Check: Verify NO mutate, edit, delete, or retry buttons exist
      expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Reschedule/i })).not.toBeInTheDocument();
    });

    it('renders audit KPI strip calculated dynamically from server records', async () => {
      const Wrapper = createWrapper('en');
      render(<AuditPage />, { wrapper: Wrapper });

      await screen.findByText('ADMIN AUDIT TRAIL & COMPLIANCE LOGS');

      expect(screen.getByText('Total Audit Events')).toBeInTheDocument();
      expect(screen.getByText('Successful Actions')).toBeInTheDocument();
      expect(screen.getByText('Failed Actions')).toBeInTheDocument();
      expect(screen.getByText('Mutation Operations')).toBeInTheDocument();
      expect(screen.getByText('Distinct Actors')).toBeInTheDocument();

      // Counts: Total 3, Success 2, Failure 1, Mutations 3, Distinct Actors 2
      expect(await screen.findAllByText('3')).toHaveLength(2); // total events & mutations
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1); // success or actors
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1); // failed
    });

    it('filters audit records by action and resets with clear filters button', async () => {
      const Wrapper = createWrapper('en');
      render(<AuditPage />, { wrapper: Wrapper });

      await screen.findByText('USER_BAN');

      const searchInput = screen.getByPlaceholderText('Filter by Actor, Action, or Resource...');
      fireEvent.change(searchInput, { target: { value: 'UPDATE_SETTINGS' } });

      // Only UPDATE_SETTINGS is visible
      expect(screen.getByText('UPDATE_SETTINGS')).toBeInTheDocument();
      expect(screen.queryByText('USER_BAN')).not.toBeInTheDocument();

      // Clear search
      const clearBtn = screen.getByLabelText('Clear search');
      fireEvent.click(clearBtn);

      expect(await screen.findByText('USER_BAN')).toBeInTheDocument();
    });
  });

  describe('2. Audit Detail Drawer & Smart Cross-Navigation', () => {
    it('opens drawer and displays event identity, action, and cross-navigation link', async () => {
      const Wrapper = createWrapper('en');
      render(<AuditPage />, { wrapper: Wrapper });

      await screen.findByText('USER_BAN');

      // Click Inspect Payload on first row
      const inspectBtns = screen.getAllByRole('button', { name: /Payload/i });
      fireEvent.click(inspectBtns[0]);

      // Drawer opens
      expect(await screen.findByText('AUDIT EVENT')).toBeInTheDocument();
      expect(screen.getByText('Identity & Origin')).toBeInTheDocument();
      expect(screen.getAllByText('super_admin').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText(/owner/i).length).toBeGreaterThanOrEqual(2);

      // Cross-navigation link to /users?search=usr-vip-99
      const userLink = screen.getByRole('link', { name: /View Target Resource/i });
      expect(userLink).toHaveAttribute('href', '/users?search=usr-vip-99');
    });

    it('renders failure diagnostic when audit event status is failure', async () => {
      const Wrapper = createWrapper('en');
      render(<AuditPage />, { wrapper: Wrapper });

      await screen.findByText('CANCEL_REMINDER');

      // Click Inspect Payload on the failure row (3rd item)
      const inspectBtns = screen.getAllByRole('button', { name: /Payload/i });
      fireEvent.click(inspectBtns[2]);

      // Drawer opens with error message
      expect(await screen.findByText('Database connection timeout on lock acquisition')).toBeInTheDocument();
    });
  });

  describe('3. Strict Secret & CoT Redaction Test (Section 27)', () => {
    it('redacts tokens, API keys, DB passwords, system prompts, and CoT from audit metadata', () => {
      const unsafeAuditItem: AdminAuditItem = {
        id: 'audit-leak-test',
        adminActor: 'admin',
        actorRole: 'admin',
        action: 'UPDATE_SETTINGS',
        resourceType: 'settings',
        resourceId: 'secrets_test',
        status: 'success',
        createdAt: '2026-10-03T10:00:00Z',
        metadata: {
          authorization: 'Bearer secret_super_token_999',
          api_key: 'sk-secret1234567890abcdef',
          database_url: 'postgres://admin:super_secret_db_pass@db.internal:5432/prod',
          system_prompt: 'private system instructions for agent',
          reasoning: 'private internal thought trace',
          safe_field: 'visible_data_content',
        },
      };

      const Wrapper = createWrapper('en');
      render(
        <AuditDetailDrawer
          auditItem={unsafeAuditItem}
          isOpen={true}
          onClose={jest.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Verify all sensitive secrets and internal reasoning are completely redacted
      expect(screen.queryByText(/secret_super_token_999/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sk-secret1234567890abcdef/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/super_secret_db_pass/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/private system instructions for agent/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/private internal thought trace/i)).not.toBeInTheDocument();

      // Verify safe field remains intact
      expect(screen.getByText(/"safe_field": "visible_data_content"/)).toBeInTheDocument();
    });
  });

  describe('4. Arabic Localization & RTL Isolation', () => {
    it('renders Audit Trail in Arabic with RTL text and technical identifiers in LTR', async () => {
      const Wrapper = createWrapper('ar');
      render(<AuditPage />, { wrapper: Wrapper });

      expect(await screen.findByText('سجل تدقيق المسؤولين والامتثال الأمني')).toBeInTheDocument();
      expect(screen.getByText('إجمالي أحداث التدقيق')).toBeInTheDocument();
      expect(screen.getByText('الإجراءات الناجحة')).toBeInTheDocument();
      expect(screen.getByText('الإجراءات الفاشلة')).toBeInTheDocument();
      expect(screen.getByText('عمليات التعديل والتحول')).toBeInTheDocument();
    });
  });
});
