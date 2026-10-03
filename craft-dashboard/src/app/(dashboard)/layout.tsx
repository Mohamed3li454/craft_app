import React from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { LayoutProvider } from '@/lib/layout/layout-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LayoutProvider>
      <div className="flex min-h-screen bg-background text-foreground transition-colors duration-200">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto max-w-7xl w-full mx-auto space-y-6">
            {children}
          </main>
        </div>
      </div>
    </LayoutProvider>
  );
}
