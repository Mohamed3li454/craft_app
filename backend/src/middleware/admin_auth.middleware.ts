import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { logger } from '../core/logger';
import { defaultAdminRateLimiter } from './admin_rate_limiter';
import { getAdminActor, AdminRole, sendAdminError } from '../modules/admin/admin.types';

export interface AdminAuthOptions {
  allowMockInTest?: boolean;
}

/**
 * Validates administrative authorization token against configured admin secret.
 *
 * Security Requirements Enforced:
 * 1. Constant-Time Comparison: crypto.timingSafeEqual prevents timing side-channel attacks.
 * 2. Query token (?token=...) is STRICTLY FORBIDDEN to prevent leakage in URLs/access logs.
 * 3. Only Authorization: Bearer <TOKEN> and x-admin-token: <TOKEN> headers are accepted.
 * 4. Production Fail-Closed: If ADMIN_SECRET_KEY is missing or empty, all admin requests are blocked.
 * 5. Secret Redaction: Secrets are never logged.
 * 6. Standardized error contract response.
 */
export function validateAdminToken(providedToken: string | undefined): boolean {
  const isProd = process.env.NODE_ENV === 'production' || config.nodeEnv === 'production';
  const envSecret = process.env.ADMIN_SECRET_KEY ? process.env.ADMIN_SECRET_KEY.trim() : '';

  // 1. Fail-closed: In production, reject if ADMIN_SECRET_KEY is empty or missing
  if (isProd && !envSecret) {
    return false;
  }

  const expectedToken = (envSecret || config.admin?.secretKey || '').trim();

  // 2. Fail-closed: Reject if expected token is not configured in any environment
  if (!expectedToken) {
    return false;
  }

  // 3. Reject if no valid token was supplied
  if (!providedToken || typeof providedToken !== 'string') {
    return false;
  }

  const cleanProvided = providedToken.trim();
  if (!cleanProvided) {
    return false;
  }

  // 3. Constant-time comparison using crypto.timingSafeEqual
  const providedBuf = Buffer.from(cleanProvided);
  const expectedBuf = Buffer.from(expectedToken);

  if (providedBuf.length !== expectedBuf.length) {
    // Execute dummy timing operation with identical length to maintain constant time response
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Express middleware for securing admin endpoints.
 */
export function createAdminAuthMiddleware(options?: AdminAuthOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = (req as any).correlationId || req.headers['x-correlation-id'] || 'unknown';
    const clientIp = defaultAdminRateLimiter.resolveClientIp(req);

    // 1. Check if client IP is currently blocked due to repeated auth brute-force failures
    const { isBlocked, retryAfterSeconds } = defaultAdminRateLimiter.isAuthBlocked(clientIp);
    if (isBlocked) {
      res.setHeader('Retry-After', retryAfterSeconds);
      logger.warn('[Admin Auth] Client IP blocked due to excessive authentication failures', {
        ip: defaultAdminRateLimiter.maskIp(clientIp),
        correlationId,
      });

      res.status(429).json({
        error: {
          code: 'ADMIN_AUTH_THROTTLED',
          message: 'Too many failed authentication attempts. Please try again later.',
          retryAfterSeconds,
        },
        correlationId,
      });
      return;
    }

    // 2. Query token (?token=...) is strictly forbidden
    if (req.query && req.query.token !== undefined) {
      logger.warn('[Admin Auth] Rejected request containing forbidden query parameter token', {
        ip: defaultAdminRateLimiter.maskIp(clientIp),
        path: req.path,
        correlationId,
      });

      defaultAdminRateLimiter.recordAuthFailure(clientIp);
      res.status(401).json({
        error: {
          code: 'ADMIN_UNAUTHORIZED',
          message: 'Query token authentication is forbidden. Use Authorization: Bearer <TOKEN> header.',
        },
        correlationId,
      });
      return;
    }

    // 3. Extract Bearer token or custom x-admin-token header
    const authHeader = req.headers?.authorization;
    const customHeader = req.headers?.['x-admin-token'] as string;

    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;

    const providedToken = bearerToken || (customHeader ? customHeader.trim() : undefined);

    // 4. Validate token
    const isAuthorized = validateAdminToken(providedToken);

    if (!isAuthorized) {
      const { isBlocked: nowBlocked, retryAfterSeconds: blockSeconds } = defaultAdminRateLimiter.recordAuthFailure(clientIp);
      if (nowBlocked) {
        res.setHeader('Retry-After', blockSeconds);
      }

      logger.warn('[Admin Auth] Unauthorized admin request', {
        ip: defaultAdminRateLimiter.maskIp(clientIp),
        path: req.path,
        hasAuthHeader: Boolean(authHeader),
        hasCustomHeader: Boolean(customHeader),
        correlationId,
      });

      res.status(401).json({
        error: {
          code: 'ADMIN_UNAUTHORIZED',
          message: 'Unauthorized: invalid or missing admin token. Please provide valid Authorization header.',
        },
        correlationId,
      });
      return;
    }

    // 5. Successful authentication -> reset failure count for this IP
    defaultAdminRateLimiter.resetAuthFailure(clientIp);

    // Attach admin actor info with RBAC foundation
    const actor = getAdminActor(req);
    (req as any).adminUser = {
      actor: actor.name || actor.id,
      role: actor.role,
      authenticatedAt: new Date().toISOString(),
    };

    next();
  };
}

export function requireAdminRole(...allowedRoles: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actor = getAdminActor(req);
    if (!allowedRoles.includes(actor.role)) {
      sendAdminError(
        res,
        403,
        'ADMIN_FORBIDDEN',
        `Forbidden: role '${actor.role}' lacks permission for this operation. Required: ${allowedRoles.join(', ')}`
      );
      return;
    }
    next();
  };
}

export const adminAuthMiddleware = createAdminAuthMiddleware();
