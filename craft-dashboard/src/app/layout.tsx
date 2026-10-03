import type { Metadata } from 'next';
import './globals.css';
import { ReactQueryProvider } from '@/lib/query/query-client';
import { AuthProvider } from '@/lib/auth/auth-context';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { ThemeProvider } from '@/lib/theme/theme-context';

export const metadata: Metadata = {
  title: 'Craft Command Center V2',
  description: 'Mission Control & Control Plane for Craft AI Platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('craft_dashboard_theme') || 'dark';
                  var isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                  var l = localStorage.getItem('craft_dashboard_lang');
                  if (l === 'ar') {
                    document.documentElement.lang = 'ar';
                    document.documentElement.dir = 'rtl';
                  } else {
                    document.documentElement.lang = 'en';
                    document.documentElement.dir = 'ltr';
                  }
                } catch (_) {}
              })();
            `,
          }}
        />
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ReactQueryProvider>
          <ThemeProvider>
            <LanguageProvider>
              <AuthProvider>{children}</AuthProvider>
            </LanguageProvider>
          </ThemeProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
