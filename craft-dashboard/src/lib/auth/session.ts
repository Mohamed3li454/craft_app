import crypto from 'crypto';
import { AdminRole, SessionData, SafeClientUser } from '@/types/admin';

import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './session-constants';
export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS };

const VALID_ROLES: AdminRole[] = ['owner', 'admin', 'operator', 'support', 'viewer'];

function getSessionSigningSecret(): string {
  return (
    process.env.ADMIN_SECRET_KEY ||
    process.env.SESSION_SECRET ||
    'craft-internal-session-signing-secret-key-32b'
  );
}

/**
 * Encodes session data and cryptographically signs it with an HMAC-SHA256 signature.
 * Prevents client-side tampering, role elevation, or session forging.
 * Format: <payload_base64url>.<hmac_sha256_hex>
 */
export function encodeSession(data: SessionData, signingSecret?: string): string {
  const secret = signingSecret || getSessionSigningSecret();
  const jsonStr = JSON.stringify(data);
  const payloadB64 = Buffer.from(jsonStr, 'utf-8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

/**
 * Decodes and cryptographically verifies session data from cookie value.
 * Fails closed on:
 * - Missing or malformed cookie string
 * - Missing or invalid HMAC signature (tampering detection via constant-time comparison)
 * - Expired sessions (Date.now() > expiresAt)
 * - Unknown or invalid role values
 * - Missing authentication token
 */
export function decodeSession(
  cookieValue: string | undefined | null,
  signingSecret?: string
): SessionData | null {
  if (!cookieValue || typeof cookieValue !== 'string') return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  const secret = signingSecret || getSessionSigningSecret();
  const expectedSignature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');

  // Constant-time signature comparison to prevent timing attacks
  if (sigBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null; // Tampered cookie signature!
  }

  try {
    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const parsed = JSON.parse(jsonStr) as SessionData;

    if (!parsed.token || !parsed.role || !parsed.expiresAt) {
      return null;
    }

    if (!VALID_ROLES.includes(parsed.role)) {
      return null;
    }

    if (Date.now() > parsed.expiresAt) {
      return null; // Expired
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Role-Based Access Control (RBAC) helper functions.
 * Backend is the true security boundary; these control UI visibility and affordance.
 */
export function canMutate(role?: AdminRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin', 'operator'].includes(role);
}

export function canManageSettings(role?: AdminRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin'].includes(role);
}

export function canPurgeData(role?: AdminRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin'].includes(role);
}

export function canBanUsers(role?: AdminRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin', 'operator'].includes(role);
}

export function canRetryReminders(role?: AdminRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin', 'operator'].includes(role);
}

export function isReadOnlyRole(role?: AdminRole | null): boolean {
  if (!role) return true;
  return role === 'viewer' || role === 'support';
}

export function toSafeClientUser(session: SessionData): SafeClientUser {
  return {
    role: session.role,
    actorName: session.actorName,
  };
}
