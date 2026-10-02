import { NextResponse, NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session-constants';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Allow public assets and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/fonts') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/api/auth')
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  // Structural session check for Edge middleware: cookie must exist and contain payload + signature
  const hasSession = Boolean(
    cookie && typeof cookie === 'string' && cookie.includes('.') && cookie.split('.').length === 2
  );

  // 2. If authenticated and attempting to visit /login, redirect to /overview
  if (pathname === '/login') {
    if (hasSession) {
      return NextResponse.redirect(new URL('/overview', req.url));
    }
    return NextResponse.next();
  }

  // 3. If unauthenticated and attempting to visit protected pages or admin-proxy
  if (!hasSession) {
    if (pathname.startsWith('/api/admin-proxy')) {
      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Admin session required',
          },
        },
        { status: 401 }
      );
    }

    // Redirect to login with return url
    const loginUrl = new URL('/login', req.url);
    if (pathname !== '/' && pathname !== '/overview') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
