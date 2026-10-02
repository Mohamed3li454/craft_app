import { Response, Request } from 'express';

export interface AdminErrorPayload {
  code: string;
  message: string;
  details?: any;
}

export interface AdminErrorResponse {
  error: AdminErrorPayload;
  correlationId: string;
}

export interface AdminSuccessResponse<T> {
  success: true;
  data: T;
  pagination?: {
    nextCursor: string | null;
    total?: number;
  };
  correlationId: string;
  timestamp: string;
}

export interface PaginationQuery {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export type AdminRole = 'owner' | 'admin' | 'operator' | 'support' | 'viewer';

export interface AdminActor {
  id: string;
  role: AdminRole;
  actorType: 'bearer_token' | 'user' | 'api_key';
  name?: string;
}

export function getAdminActor(req: Request): AdminActor {
  if ((req as any).adminActor) {
    return (req as any).adminActor;
  }
  const roleHeader = (req.headers['x-admin-role'] as string)?.toLowerCase();
  const validRoles: AdminRole[] = ['owner', 'admin', 'operator', 'support', 'viewer'];
  const role: AdminRole = validRoles.includes(roleHeader as AdminRole) ? (roleHeader as AdminRole) : 'admin';
  const actorName = (req.headers['x-admin-actor'] as string) || (req as any).adminUser?.actor || 'admin';

  const actor: AdminActor = {
    id: actorName,
    role,
    actorType: 'bearer_token',
    name: actorName,
  };
  (req as any).adminActor = actor;
  return actor;
}

export function getCorrelationId(req: Request): string {
  return (req as any).correlationId || (req.headers['x-correlation-id'] as string) || 'unknown';
}

export function sendAdminError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: any
): void {
  const req = (res as any).req as Request;
  const correlationId = req ? getCorrelationId(req) : 'unknown';

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    correlationId,
  });
}

export function sendAdminSuccess<T>(
  res: Response,
  data: T,
  pagination?: { nextCursor: string | null; total?: number }
): void {
  const req = (res as any).req as Request;
  const correlationId = req ? getCorrelationId(req) : 'unknown';

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.status(200).json({
    success: true,
    data,
    ...(pagination ? { pagination } : {}),
    correlationId,
    timestamp: new Date().toISOString(),
  });
}
