import { Request, Response, NextFunction } from 'express';
import { logger } from '../../../core/logger';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

/**
 * Lightweight, zero-dependency in-memory rate limiter specifically for Admin APIs.
 *
 * Production Hardening Characteristics:
 * 1. Sliding/Fixed window per client IP.
 * 2. Automatic cleanup of expired entries prevents memory leaks.
 * 3. Zero external packages/dependencies required.
 * 4. Configurable via environment variables with safe production defaults (60 req/min).
 * 5. Provides standard HTTP 429 response with Retry-After header.
 */
export class AdminRateLimiter {
  private store: Map<string, RateLimitRecord> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options?: { windowMs?: number; maxRequests?: number }) {
    const isTest = process.env.NODE_ENV === 'test';
    this.windowMs = options?.windowMs ?? (parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000);
    this.maxRequests = options?.maxRequests ?? (
      parseInt(process.env.ADMIN_RATE_LIMIT_MAX || (isTest ? '1000' : '60'), 10) || (isTest ? 1000 : 60)
    );

    // Periodic sweep every 60 seconds to prune stale IP records
    if (!isTest) {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs);
      if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
        this.cleanupTimer.unref();
      }
    }
  }

  /**
   * Express middleware handler for admin endpoints.
   */
  public middleware = (req: Request, res: Response, next: NextFunction): void => {
    const ip = this.resolveClientIp(req);
    const now = Date.now();
    let record = this.store.get(ip);

    if (!record || now >= record.resetAt) {
      record = { count: 1, resetAt: now + this.windowMs };
      this.store.set(ip, record);
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

      res.status(429).json({
        success: false,
        error: 'Too many requests on admin API. Please try again later.',
        retryAfterSeconds: resetSeconds,
      });
      return;
    }

    next();
  };

  /**
   * Cleans up expired IP records to prevent unbounded memory growth.
   */
  public cleanup(): void {
    const now = Date.now();
    for (const [ip, record] of this.store.entries()) {
      if (now >= record.resetAt) {
        this.store.delete(ip);
      }
    }
  }

  /**
   * Resets rate limiter store (useful in test suites).
   */
  public reset(): void {
    this.store.clear();
  }

  public getLimit(): number {
    return this.maxRequests;
  }

  public getWindowMs(): number {
    return this.windowMs;
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }

  private resolveClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : forwarded[0]?.trim();
      if (first) return first;
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }

  private maskIp(ip: string): string {
    if (ip.includes('.')) {
      const parts = ip.split('.');
      if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip.slice(0, 8) + '...';
  }
}
