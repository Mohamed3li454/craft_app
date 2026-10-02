import {
  encodeSession,
  decodeSession,
  canMutate,
  canManageSettings,
  canPurgeData,
  canBanUsers,
  isReadOnlyRole,
  toSafeClientUser,
} from '../src/lib/auth/session';
import { SessionData, AdminRole } from '../src/types/admin';

describe('Admin Dashboard Session & RBAC Foundation', () => {
  const validSession: SessionData = {
    token: 'super-secret-admin-key-12345',
    role: 'admin',
    actorName: 'admin',
    expiresAt: Date.now() + 3600 * 1000,
  };

  test('encodes and decodes session data accurately with HMAC signature', () => {
    const encoded = encodeSession(validSession);
    expect(typeof encoded).toBe('string');
    expect(encoded).toContain('.'); // Format: payload.signature

    const decoded = decodeSession(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.token).toBe(validSession.token);
    expect(decoded?.role).toBe(validSession.role);
    expect(decoded?.actorName).toBe(validSession.actorName);
  });

  test('rejects tampered cookie payload attempting privilege escalation', () => {
    const viewerSession: SessionData = {
      token: 'super-secret-admin-key-12345',
      role: 'viewer',
      actorName: 'guest',
      expiresAt: Date.now() + 3600 * 1000,
    };
    const validCookie = encodeSession(viewerSession);
    const [payloadB64, signature] = validCookie.split('.');

    // Attacker modifies decoded JSON from 'viewer' to 'owner'
    const tamperedJson = JSON.stringify({
      ...viewerSession,
      role: 'owner',
    });
    const tamperedPayloadB64 = Buffer.from(tamperedJson).toString('base64url');

    // Attacker tries to submit tampered payload with original signature
    const forgedCookie = `${tamperedPayloadB64}.${signature}`;
    const decoded = decodeSession(forgedCookie);

    // Cryptographic HMAC verification MUST reject the tampered cookie
    expect(decoded).toBeNull();
  });

  test('rejects unsigned raw base64 cookies', () => {
    const rawB64 = Buffer.from(JSON.stringify(validSession)).toString('base64url');
    expect(decodeSession(rawB64)).toBeNull();
  });

  test('rejects cookie signed with wrong secret key', () => {
    const forgedWithWrongKey = encodeSession(validSession, 'attacker-secret-key-999');
    expect(decodeSession(forgedWithWrongKey)).toBeNull();
  });

  test('rejects invalid or unsupported role claims', () => {
    const maliciousSession = {
      ...validSession,
      role: 'super_root_hacker' as any,
    };
    const cookie = encodeSession(maliciousSession);
    expect(decodeSession(cookie)).toBeNull();
  });

  test('rejects expired session tokens', () => {
    const expiredSession: SessionData = {
      ...validSession,
      expiresAt: Date.now() - 1000, // expired 1s ago
    };
    const encoded = encodeSession(expiredSession);
    const decoded = decodeSession(encoded);
    expect(decoded).toBeNull();
  });

  test('rejects corrupted or malformed cookie tokens', () => {
    expect(decodeSession(null)).toBeNull();
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession('')).toBeNull();
    expect(decodeSession('not-base64-json')).toBeNull();
    expect(decodeSession('part1.part2.part3')).toBeNull();
  });

  test('toSafeClientUser strictly strips sensitive secret tokens', () => {
    const safeUser = toSafeClientUser(validSession);
    expect((safeUser as any).token).toBeUndefined();
    expect(safeUser.role).toBe('admin');
    expect(safeUser.actorName).toBe('admin');
  });

  test('enforces RBAC permissions per assigned role', () => {
    // Owner
    expect(canMutate('owner')).toBe(true);
    expect(canManageSettings('owner')).toBe(true);
    expect(canPurgeData('owner')).toBe(true);
    expect(canBanUsers('owner')).toBe(true);
    expect(isReadOnlyRole('owner')).toBe(false);

    // Admin
    expect(canMutate('admin')).toBe(true);
    expect(canManageSettings('admin')).toBe(true);
    expect(canPurgeData('admin')).toBe(true);
    expect(canBanUsers('admin')).toBe(true);
    expect(isReadOnlyRole('admin')).toBe(false);

    // Operator
    expect(canMutate('operator')).toBe(true);
    expect(canManageSettings('operator')).toBe(false); // Only owner & admin
    expect(canPurgeData('operator')).toBe(false); // Only owner & admin
    expect(canBanUsers('operator')).toBe(true);
    expect(isReadOnlyRole('operator')).toBe(false);

    // Support
    expect(canMutate('support')).toBe(false);
    expect(canManageSettings('support')).toBe(false);
    expect(canBanUsers('support')).toBe(false);
    expect(isReadOnlyRole('support')).toBe(true);

    // Viewer
    expect(canMutate('viewer')).toBe(false);
    expect(canManageSettings('viewer')).toBe(false);
    expect(canBanUsers('viewer')).toBe(false);
    expect(isReadOnlyRole('viewer')).toBe(true);
  });
});
