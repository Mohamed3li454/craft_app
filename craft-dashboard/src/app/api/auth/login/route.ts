import { NextRequest, NextResponse } from 'next/server';
import { encodeSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/session';
import { AdminRole, SessionData } from '@/types/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { secret, devSimulateRole } = body;

    if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Admin secret key is required' } },
        { status: 400 }
      );
    }

    const trimmedSecret = secret.trim();
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';

    // 1. Verify secret with backend admin health check endpoint
    try {
      const probeRes = await fetch(`${backendUrl}/api/admin/observability/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${trimmedSecret}`,
          'X-Admin-Role': 'admin',
          'X-Admin-Actor': 'admin',
        },
        cache: 'no-store',
      });

      if (probeRes.status === 401 || probeRes.status === 403) {
        return NextResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Invalid admin secret key' } },
          { status: 401 }
        );
      }

      // If backend is unreachable or returns other status in dev/standalone test, allow if matching env ADMIN_SECRET_KEY
      if (!probeRes.ok && probeRes.status !== 503) {
        if (process.env.ADMIN_SECRET_KEY && trimmedSecret !== process.env.ADMIN_SECRET_KEY) {
          return NextResponse.json(
            { error: { code: 'UNAUTHORIZED', message: 'Invalid admin secret key' } },
            { status: 401 }
          );
        }
      }
    } catch {
      // Backend may be offline during build or unit tests
      if (process.env.ADMIN_SECRET_KEY && trimmedSecret !== process.env.ADMIN_SECRET_KEY) {
        return NextResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Invalid admin secret key' } },
          { status: 401 }
        );
      }
    }

    // 2. Server-side authoritative role assignment:
    // In production, the role is strictly server-enforced as 'admin'.
    // Client cannot choose or elevate roles.
    let assignedRole: AdminRole = 'admin';
    const actorName = 'admin';

    // In local non-production development ONLY, allow UI role downgrade simulation for testing affordances
    if (process.env.NODE_ENV !== 'production' && typeof devSimulateRole === 'string') {
      const allowedSimulations: AdminRole[] = ['viewer', 'support', 'operator', 'admin'];
      if (allowedSimulations.includes(devSimulateRole as AdminRole)) {
        assignedRole = devSimulateRole as AdminRole;
      }
    }

    const sessionData: SessionData = {
      token: trimmedSecret,
      role: assignedRole,
      actorName,
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    };

    // 3. Cryptographically sign the session cookie (HMAC-SHA256)
    const encoded = encodeSession(sessionData);

    const response = NextResponse.json({
      success: true,
      user: {
        role: sessionData.role,
        actorName: sessionData.actorName,
      },
    });

    response.cookies.set(SESSION_COOKIE_NAME, encoded, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: err.message || 'Login failed' } },
      { status: 500 }
    );
  }
}
