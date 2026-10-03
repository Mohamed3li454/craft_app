import { NextRequest, NextResponse } from 'next/server';
import { decodeSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

function normalizeAdminResponse(subPath: string, data: any): any {
  if (!data || typeof data !== 'object') return data;
  const pathParts = subPath.split('/');
  const root = pathParts[0];

  // 1. Users list
  if (root === 'users' && pathParts.length === 1 && Array.isArray(data.data)) {
    data.data = data.data.map((u: any) => {
      const id = u.id || u.userId || '';
      const phone = u.phoneNumber || u.phone || '';
      const msgCount = u.messageCount ?? u.totalMessages ?? 0;
      const lastAct = u.lastActiveAt || u.lastActive || undefined;
      return {
        ...u,
        id,
        userId: u.userId || id,
        phoneNumber: phone,
        phone,
        messageCount: msgCount,
        totalMessages: u.totalMessages ?? msgCount,
        conversationCount: u.conversationCount ?? 0,
        reminderCount: u.reminderCount ?? 0,
        lastActiveAt: lastAct,
        lastActive: u.lastActive || lastAct,
      };
    });
  }

  // 2. User 360 details
  if (root === 'users' && pathParts.length === 2 && data.data && typeof data.data === 'object') {
    const userDetail = data.data;
    if (userDetail.metrics && !userDetail.stats) {
      userDetail.stats = {
        totalConversations: userDetail.metrics.totalConversations || 0,
        totalMessages: userDetail.metrics.totalMessages || 0,
        totalReminders: userDetail.metrics.reminderCount || (userDetail.reminders ? userDetail.reminders.length : 0),
        activeReminders: userDetail.metrics.activeRemindersCount || 0,
        memoryCount: userDetail.metrics.memoryCount || (userDetail.memories ? userDetail.memories.length : 0),
        tokenCount: userDetail.metrics.tokensUsed || 0,
        costUsd: userDetail.metrics.estimatedCostUsd || 0,
      };
    } else if (userDetail.stats && !userDetail.metrics) {
      userDetail.metrics = {
        totalConversations: userDetail.stats.totalConversations || 0,
        totalMessages: userDetail.stats.totalMessages || 0,
        tokensUsed: userDetail.stats.tokenCount || 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: userDetail.stats.costUsd || 0,
      };
    }
    if (Array.isArray(userDetail.memories)) {
      userDetail.memories = userDetail.memories.map((m: any) => ({
        ...m,
        key: m.key || m.factKey || m.category || 'fact',
        value: m.value || m.factText || '',
      }));
    }
    if (Array.isArray(userDetail.reminders)) {
      userDetail.reminders = userDetail.reminders.map((r: any) => ({
        ...r,
        scheduledTime: r.scheduledTime || r.dueAt || undefined,
        status: r.status || r.state || (r.isCompleted ? 'sent' : 'scheduled'),
      }));
    }
    if (!userDetail.recentConversations && Array.isArray(userDetail.conversations)) {
      userDetail.recentConversations = userDetail.conversations;
    }
  }

  // 3. Conversations list
  if (root === 'conversations' && pathParts.length === 1 && Array.isArray(data.data)) {
    data.data = data.data.map((c: any) => {
      const phone = c.userPhone || c.phone || '';
      const msgCount = c.messageCount ?? c.messagesCount ?? 0;
      const snippet = c.lastMessageSnippet || c.lastMessage || '';
      const updated = c.updatedAt || c.lastMessageAt || c.createdAt || '';
      const status = c.status || (c.isArchived ? 'archived' : 'active');
      return {
        ...c,
        userPhone: phone,
        phone,
        messageCount: msgCount,
        messagesCount: c.messagesCount ?? msgCount,
        lastMessageSnippet: snippet,
        lastMessage: c.lastMessage || snippet,
        status,
        updatedAt: updated,
        lastMessageAt: c.lastMessageAt || updated,
      };
    });
  }

  // 4. Conversation transcript & messages
  const isConversationMessages =
    root === 'conversations' &&
    pathParts.length >= 2 &&
    (pathParts[pathParts.length - 1] === 'messages' || pathParts[pathParts.length - 1] === 'transcript');

  if (isConversationMessages && Array.isArray(data.data)) {
    data.data = data.data.map((m: any) => {
      const ts = m.createdAt || m.timestamp || '';
      const text = m.content || m.text || '';
      const rawRole = (m.role || m.senderRole || '').toLowerCase();
      const rawSender = (m.sender || m.senderName || '').toLowerCase();
      const isUser =
        rawRole === 'user' ||
        rawSender === 'user' ||
        rawSender.includes('whatsapp') ||
        rawSender.includes('user');
      const isSemanticCache =
        m.model === 'semantic-cache' ||
        m.modelName === 'semantic-cache' ||
        m.source === 'semantic-cache';

      const role = isUser ? 'user' : 'assistant';
      const sender = isUser ? (m.sender || m.senderName || 'WhatsApp User') : 'Craft';
      const source = isSemanticCache ? 'semantic-cache' : (isUser ? 'system' : 'ai');

      // Clean metadata
      const rawMeta = m.metadata || {};
      const model = isSemanticCache ? null : (m.model || m.modelName || rawMeta.model || null);
      const tokens = isSemanticCache ? 0 : (m.tokens ?? m.tokensUsed ?? rawMeta.tokens ?? null);
      const latencyMs = m.latencyMs ?? rawMeta.latencyMs ?? null;
      const tools =
        m.tools ||
        (m.toolsUsed ? m.toolsUsed.split(',').map((s: string) => s.trim()).filter(Boolean) : rawMeta.tools);
      const toolCalls = m.toolCalls || rawMeta.toolCalls || undefined;

      return {
        ...m,
        id: m.id,
        conversationId: m.conversationId,
        createdAt: ts,
        timestamp: m.timestamp || ts,
        content: text,
        text,
        role,
        sender,
        source,
        model,
        tokens,
        latencyMs,
        tools,
        toolCalls,
        metadata: {
          model,
          tokens,
          latencyMs,
          tools,
          source,
          toolCalls,
          promptTokens: m.promptTokens ?? rawMeta.promptTokens ?? null,
          completionTokens: m.completionTokens ?? rawMeta.completionTokens ?? null,
        },
      };
    });
  }

  // 5. Agent runs list
  if (root === 'agent-runs' && pathParts.length === 1 && Array.isArray(data.data)) {
    data.data = data.data.map((r: any) => {
      const latency = r.latencyMs ?? r.durationMs ?? 0;
      return {
        ...r,
        latencyMs: latency,
        durationMs: r.durationMs ?? latency,
        toolCallsCount: r.toolCallsCount ?? 0,
        model: r.model || null,
        totalTokens: r.totalTokens !== undefined ? r.totalTokens : null,
      };
    });
  }

  // 6. Agent run details
  if (root === 'agent-runs' && pathParts.length === 2 && data.data && typeof data.data === 'object') {
    const run = data.data;
    const latency = run.latencyMs ?? run.durationMs ?? 0;
    run.latencyMs = latency;
    run.durationMs = run.durationMs ?? latency;
    run.promptSnippet = run.promptSnippet || run.userPrompt || '';
    run.responseSnippet = run.responseSnippet || '';
    run.model = run.model || null;
    run.totalTokens = run.totalTokens !== undefined ? run.totalTokens : null;
    if (Array.isArray(run.toolCalls)) {
      run.toolCalls = run.toolCalls.map((tc: any) => ({
        ...tc,
        args: tc.args || tc.arguments || {},
        arguments: tc.arguments || tc.args || {},
      }));
    }
  }

  // 7. Tool calls list
  if (root === 'tool-calls' && pathParts.length === 1 && Array.isArray(data.data)) {
    data.data = data.data.map((t: any) => ({
      ...t,
      runId: t.runId || t.agentRunId || '',
      agentRunId: t.agentRunId || t.runId || '',
      argumentsSanitized: t.argumentsSanitized || t.arguments || {},
      resultSanitized: t.resultSanitized || t.result || {},
    }));
  }

  // 8. Memory items list
  if (root === 'memory' && Array.isArray(data.data)) {
    data.data = data.data.map((m: any) => ({
      ...m,
      key: m.key || m.factKey || m.category || 'fact',
      value: m.value || m.factText || '',
      userPhone: m.userPhone || (m.userId ? m.userId.replace(/^wa_/, '') : ''),
    }));
  }

  // 9. Reminders list
  if (root === 'reminders' && Array.isArray(data.data)) {
    data.data = data.data.map((r: any) => ({
      ...r,
      scheduledTime: r.scheduledTime || r.dueAt || undefined,
      status: r.status || r.state || (r.isCompleted ? 'sent' : 'scheduled'),
      retryCount: r.retryCount ?? r.attempts ?? 0,
      userPhone: r.userPhone || (r.userId ? r.userId.replace(/^wa_/, '') : ''),
    }));
  }

  // 10. Settings normalization
  if (root === 'settings' && data.data && typeof data.data === 'object') {
    if (data.data.runtimeSettings && !data.data.runtime) {
      data.data.runtime = data.data.runtimeSettings;
    } else if (data.data.runtime && !data.data.runtimeSettings) {
      data.data.runtimeSettings = data.data.runtime;
    }
  }

  return data;
}

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
      responseData = normalizeAdminResponse(subPath, responseData);
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
