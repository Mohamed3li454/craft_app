import { NextRequest, NextResponse } from 'next/server';
import { decodeSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

async function handleProxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = decodeSession(cookieValue);

    if (!session) {
      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Admin authentication required',
          },
          correlationId: req.headers.get('x-correlation-id') || 'unauth',
        },
        { status: 401 }
      );
    }

    const subPath = params.path ? params.path.join('/') : '';
    const search = req.nextUrl.search || '';
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const targetUrl = `${backendUrl}/api/admin/${subPath}${search}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.token}`,
      'X-Admin-Role': session.role,
      'X-Admin-Actor': session.actorName,
      'X-Correlation-Id': req.headers.get('x-correlation-id') || crypto.randomUUID(),
    };

    const contentType = req.headers.get('content-type');
    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const method = req.method;
    let body: string | undefined = undefined;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      try {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          body = text;
        }
      } catch {
        // Empty body is acceptable
      }
    }

    const backendRes = await fetch(targetUrl, {
      method,
      headers,
      body,
      cache: 'no-store',
    });

    const responseText = await backendRes.text();
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    const clientRes = NextResponse.json(responseData, {
      status: backendRes.status,
    });

    clientRes.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const backendCorrId = backendRes.headers.get('x-correlation-id');
    if (backendCorrId) {
      clientRes.headers.set('X-Correlation-Id', backendCorrId);
    }

    return clientRes;
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: 'PROXY_ERROR',
          message: err.message || 'Failed to connect to backend control plane',
        },
        correlationId: req.headers.get('x-correlation-id') || 'proxy-err',
      },
      { status: 502 }
    );
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const DELETE = handleProxy;
export const PATCH = handleProxy;
