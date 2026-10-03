import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from '../src/app/(dashboard)/settings/page';
import { LanguageProvider } from '../src/lib/i18n/language-context';
import { ThemeProvider } from '../src/lib/theme/theme-context';
import { adminApi } from '../src/lib/api/admin-client';
import { AdminSafeSettings } from '../src/types/admin';

// Mock Next.js router
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/settings',
}));

// Mock adminApi
jest.mock('../src/lib/api/admin-client', () => ({
  adminApi: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

// Mock auth context module to allow custom role simulation
let mockAuthRole: 'owner' | 'admin' | 'operator' | 'support' | 'viewer' = 'admin';
let mockCanManageSettings = true;
let mockActorName = 'sec_admin';

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

describe('Phase 11.8 — Control Plane Governance & Settings Test Suite', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthRole = 'admin';
    mockCanManageSettings = true;
    mockActorName = 'sec_admin';
    (adminApi.getSettings as jest.Mock).mockResolvedValue({ data: mockSettingsData });
    (adminApi.updateSettings as jest.Mock).mockResolvedValue({
      data: { ...mockSettingsData.runtime, maintenanceMode: true },
    });
  });

  describe('1. Settings Discovery & Tab Navigation', () => {
    it('renders governance header with security guarantee and operator identity', async () => {
      const Wrapper = createWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      expect(
        await screen.findByText('CONTROL PLANE GOVERNANCE & PLATFORM SETTINGS')
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Zero secret keys, auth tokens, database credentials/i)
      ).toBeInTheDocument();

      // Operator identity
      expect(screen.getByText('sec_admin')).toBeInTheDocument();
      expect(screen.getByText('ADMIN')).toBeInTheDocument();
      expect(screen.getByText('Full Control Plane Management')).toBeInTheDocument();
    });

    it('renders all governance tabs and switches active tab views', async () => {
      const Wrapper = createWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      await screen.findByText('CONTROL PLANE GOVERNANCE & PLATFORM SETTINGS');

      // Verify all 7 tabs are present
      expect(screen.getByRole('button', { name: /Runtime & Platform/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /AI & Inference/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Search Policies/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Memory & Retention/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Proactive Engine/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Security & RBAC/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Feature Flags/i })).toBeInTheDocument();

      // Switch to AI & Inference
      fireEvent.click(screen.getByRole('button', { name: /AI & Inference/i }));
      expect(await screen.findByText('openai/gpt-oss-120b')).toBeInTheDocument();
      expect(screen.getByText('llama-3.3-70b-versatile')).toBeInTheDocument();
      expect(screen.getByText('Max Provider Attempts')).toBeInTheDocument();

      // Switch to Search Policies
      fireEvent.click(screen.getByRole('button', { name: /Search Policies/i }));
      expect(
        await screen.findByText('Search Intelligence & Source Presentation Policy')
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Sources and URLs are NEVER presented to users unless explicitly requested/i)
      ).toBeInTheDocument();

      // Switch to Feature Flags (Not Exposed section)
      fireEvent.click(screen.getByRole('button', { name: /Feature Flags/i }));
      expect(
        await screen.findByText('Feature flag management is not currently exposed by the Admin API.')
      ).toBeInTheDocument();
      expect(screen.getAllByText('Not Exposed').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Server-Authoritative RBAC affordance', () => {
    it('disables controls and displays Read-Only Inspection badge for viewer role', async () => {
      mockAuthRole = 'viewer';
      mockCanManageSettings = false;
      mockActorName = 'viewer_auditor';

      const Wrapper = createWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      await screen.findByText('CONTROL PLANE GOVERNANCE & PLATFORM SETTINGS');

      expect(screen.getByText('viewer_auditor')).toBeInTheDocument();
      expect(screen.getByText('VIEWER')).toBeInTheDocument();
      expect(screen.getByText('Read-Only Governance Inspection')).toBeInTheDocument();

      // Maintenance mode checkbox should be disabled
      const maintenanceCheckbox = await screen.findByLabelText('Maintenance Mode');
      expect(maintenanceCheckbox).toBeDisabled();

      // Retention days input should be disabled
      const retentionInput = screen.getByLabelText('Default Memory Retention (Days)');
      expect(retentionInput).toBeDisabled();

      // Save button should be disabled
      const saveButton = screen.getByRole('button', { name: /Review & Apply Changes/i });
      expect(saveButton).toBeDisabled();
    });
  });

  describe('3. Dynamic Settings Mutation & Confirmation Modal Workflow', () => {
    it('tracks dirty state, opens confirmation modal, requires acknowledgment, and saves', async () => {
      const Wrapper = createWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      const maintenanceCheckbox = await screen.findByLabelText('Maintenance Mode');
      expect(maintenanceCheckbox).not.toBeChecked();

      // Save button initially disabled (no modifications)
      const reviewButton = screen.getByRole('button', { name: /Review & Apply Changes/i });
      expect(reviewButton).toBeDisabled();

      // Toggle Maintenance Mode
      fireEvent.click(maintenanceCheckbox);
      expect(maintenanceCheckbox).toBeChecked();

      // Dirty state tracked
      expect(screen.getByText('1 setting(s) modified')).toBeInTheDocument();
      expect(reviewButton).not.toBeDisabled();

      // Click Review & Apply Changes
      fireEvent.click(reviewButton);

      // Confirmation Modal opens
      expect(
        await screen.findByText('Confirm Runtime Configuration Change')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Inbound user messages will be rejected with a temporary maintenance notification.')
      ).toBeInTheDocument();

      // Submit button should be disabled until checkbox is checked
      const submitBtn = screen.getByRole('button', { name: /Confirm & Apply Mutation/i });
      expect(submitBtn).toBeDisabled();

      // Check acknowledgment
      const ackCheckbox = screen.getByRole('checkbox', {
        name: /I understand this changes production behavior/i,
      });
      fireEvent.click(ackCheckbox);
      expect(submitBtn).not.toBeDisabled();

      // Confirm mutation
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(adminApi.updateSettings).toHaveBeenCalledWith({
          maintenanceMode: true,
          debugLogging: false,
          searchEnabled: true,
          proactiveEnabled: true,
          defaultMemoryRetentionDays: 365,
        });
      });

      // Audit confirmation banner displays
      expect(
        await screen.findByText('Runtime Settings Successfully Applied')
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Action UPDATE_RUNTIME_SETTINGS was recorded in the immutable audit log/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /View Audit Log/i })).toBeInTheDocument();
    });

    it('allows discarding changes with Discard Changes button', async () => {
      const Wrapper = createWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      const debugCheckbox = await screen.findByLabelText('Verbose Debug Logging');
      fireEvent.click(debugCheckbox);
      expect(debugCheckbox).toBeChecked();

      // Discard button visible
      const discardBtn = screen.getByRole('button', { name: /Discard Changes/i });
      fireEvent.click(discardBtn);

      expect(debugCheckbox).not.toBeChecked();
      expect(screen.queryByText(/setting\(s\) modified/i)).not.toBeInTheDocument();
    });
  });

  describe('4. Security & Zero Secret Disclosure', () => {
    it('renders safe secret status table without disclosing plaintext secrets or tokens', async () => {
      const Wrapper = createWrapper('en');
      render(<SettingsPage />, { wrapper: Wrapper });

      // Navigate to Security & RBAC tab
      const securityTab = await screen.findByRole('button', { name: /Security & RBAC/i });
      fireEvent.click(securityTab);

      expect(await screen.findByText('Safe Credential & Secret Configuration Status')).toBeInTheDocument();
      expect(screen.getByText('Groq Inference API Key')).toBeInTheDocument();
      expect(screen.getByText('WhatsApp Cloud Access Token')).toBeInTheDocument();
      expect(screen.getByText('Supabase PostgreSQL Credentials')).toBeInTheDocument();
      expect(screen.getByText('Tavily Search API Key')).toBeInTheDocument();

      // Configured badge present
      expect(screen.getAllByText('Configured').length).toBeGreaterThanOrEqual(4);

      // Verify no sensitive keys or connection strings exist in DOM
      expect(screen.queryByText(/gsk_/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/EAAG/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/postgres:\/\//i)).not.toBeInTheDocument();
      expect(screen.queryByText(/WHATSAPP_TOKEN/i)).not.toBeInTheDocument();
    });
  });

  describe('5. Arabic Localization & RTL Isolation', () => {
    it('renders Settings and Governance in Arabic with technical values in LTR', async () => {
      const Wrapper = createWrapper('ar');
      render(<SettingsPage />, { wrapper: Wrapper });

      expect(await screen.findByText('حوكمة منصة التحكم وإعدادات النظام')).toBeInTheDocument();
      expect(screen.getByText('بيئة التشغيل والمنصة')).toBeInTheDocument();
      expect(screen.getByText('الذكاء الاصطناعي والاستدلال')).toBeInTheDocument();
      expect(screen.getByText('سياسات البحث')).toBeInTheDocument();
      expect(screen.getByText('الذاكرة والاستبقاء')).toBeInTheDocument();
      expect(screen.getByText('المحرك الاستباقي')).toBeInTheDocument();
      expect(screen.getByText('الأمان والصلاحيات')).toBeInTheDocument();
      expect(screen.getByText('ميزات المنصة (Flags)')).toBeInTheDocument();

      // Technical value in LTR
      expect(await screen.findByText(/production/i)).toBeInTheDocument();
    });
  });
});
