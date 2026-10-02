import { Request, Response, NextFunction } from 'express';
import { logger } from '../core/logger';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface AdminRateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  keyPrefix?: string;
}

/**
 * Lightweight, zero-dependency in-memory rate limiter specifically for Admin APIs.
 * Includes support for general request throttling and strict authentication brute-force protection.
 */
export class AdminRateLimiter {
  private store: Map<string, RateLimitRecord> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly keyPrefix: string;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options?: AdminRateLimiterOptions) {
    const isTest = process.env.NODE_ENV === 'test';
    this.windowMs = options?.windowMs ?? (parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000);
    this.maxRequests = options?.maxRequests ?? (
      parseInt(process.env.ADMIN_RATE_LIMIT_MAX || (isTest ? '1000' : '120'), 10) || (isTest ? 1000 : 120)
    );
    this.keyPrefix = options?.keyPrefix || 'admin';

    if (!isTest) {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs);
      if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
        this.cleanupTimer.unref();
      }
    }
  }

  public resolveClientIp(req: Request): string {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string') {
      const firstIp = xForwardedFor.split(',')[0].trim();
      if (firstIp) return firstIp;
    } else if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      return xForwardedFor[0].trim();
    }
    return req.socket.remoteAddress || req.ip || '127.0.0.1';
  }

  public maskIp(ip: string): string {
    if (ip.includes('.')) {
      const parts = ip.split('.');
      return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : ip;
    }
    return ip.slice(0, 8) + '...';
  }

  public middleware = (req: Request, res: Response, next: NextFunction): void => {
    const ip = this.resolveClientIp(req);
    const key = `${this.keyPrefix}:${ip}`;
    const now = Date.now();
    let record = this.store.get(key);

    if (!record || now >= record.resetAt) {
      record = { count: 1, resetAt: now + this.windowMs };
      this.store.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, this.maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);

    res.setHeader('RateLimit-Limit', this.maxRequests);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (record.count > this.maxRequests) {
      res.setHeader('Retry-After', resetSeconds);
      logger.warn('Admin API rate limit exceeded', { ip: this.maskIp(ip), count: record.count });

      const correlationId = (req as any).correlationId || req.headers['x-correlation-id'] || 'unknown';
      res.status(429).json({
        error: {
          code: 'ADMIN_RATE_LIMITED',
          message: 'Too many requests on admin API. Please try again later.',
          retryAfterSeconds: resetSeconds,
        },
        correlationId,
      });
      return;
    }

    next();
  };

  /**
   * Tracks an authentication failure and returns true if client has exceeded auth failure threshold.
   */
  public recordAuthFailure(ip: string, maxFailures = 10): { isBlocked: boolean; retryAfterSeconds: number } {
    const key = `auth_fail:${ip}`;
    const now = Date.now();
    let record = this.store.get(key);

    if (!record || now >= record.resetAt) {
      record = { count: 1, resetAt: now + this.windowMs };
      this.store.set(key, record);
    } else {
      record.count += 1;
    }

    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);
    return {
      isBlocked: record.count >= maxFailures,
      retryAfterSeconds: resetSeconds,
    };
  }

  public isAuthBlocked(ip: string, maxFailures = 10): { isBlocked: boolean; retryAfterSeconds: number } {
    const key = `auth_fail:${ip}`;
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now >= record.resetAt) {
      return { isBlocked: false, retryAfterSeconds: 0 };
    }

    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);
    return {
      isBlocked: record.count >= maxFailures,
      retryAfterSeconds: resetSeconds,
    };
  }

  public resetAuthFailure(ip: string): void {
    this.store.delete(`auth_fail:${ip}`);
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now >= record.resetAt) {
        this.store.delete(key);
      }
    }
  }

  public reset(): void {
    this.store.clear();
  }

  public getLimit(): number {
    return this.maxRequests;
  }
}

// Global default admin rate limiter singleton
export const defaultAdminRateLimiter = new AdminRateLimiter();
