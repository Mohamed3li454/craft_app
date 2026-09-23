import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { UserEntity } from './types';
import { logger } from '../../core/logger';

/**
 * Normalizes phone numbers to a standard international numeric string (e.g. 201028067432).
 * Handles leading +, 00, spaces, dashes, and Egyptian local 01[0125] prefixes.
 */
export function normalizePhoneNumber(raw: string): string {
  if (!raw) return '';
  // Remove non-digit characters
  let digits = raw.replace(/\D/g, '');

  // Strip international prefix '00'
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Egyptian local mobile numbers: e.g. 010..., 011..., 012..., 015... (11 digits starting with 01)
  if (digits.length === 11 && digits.startsWith('01')) {
    digits = '20' + digits.slice(1);
  }

  return digits;
}

export function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class UserRepository {
  private inMemoryUsers: Map<string, UserEntity> = new Map();
  private schemaChecked = false;

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;

    try {
      // 1. Ensure phone_number column exists on users
      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);
        CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
      `);

      // 2. Ensure whatsapp_contacts table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_contacts (
          wa_id VARCHAR(50) PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          phone_number_id VARCHAR(50) DEFAULT '',
          profile_name VARCHAR(255),
          verified BOOLEAN DEFAULT false NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wa_contacts_user_id ON whatsapp_contacts(user_id);
      `);

      // 3. Migrate legacy records where name starts with 'wa_' and phone_number is null
      await pool.query(`
        UPDATE users 
        SET phone_number = REGEXP_REPLACE(name, '^wa_', '')
        WHERE phone_number IS NULL AND name LIKE 'wa_%';
      `);

      this.schemaChecked = true;
    } catch (err: any) {
      logger.debug('Schema check for users table skipped/failed', { error: err.message });
    }
  }

  /**
   * Resolves or creates a unified UserEntity given a phone number, raw wa_id, or user ID.
   * If a phone number is provided, all variations (+20..., 20..., 010...) resolve to the single user.
   */
  public async findOrCreateUserByPhone(
    rawPhoneOrId: string,
    displayName?: string
  ): Promise<UserEntity> {
    await this.ensureSchema();
    const cleanPhone = normalizePhoneNumber(rawPhoneOrId);
    const pool = this.db.getPool();

    if (pool && cleanPhone) {
      try {
        // Query user with phone number variants
        const variants = [
          cleanPhone,
          `+${cleanPhone}`,
          cleanPhone.startsWith('20') ? `0${cleanPhone.slice(2)}` : cleanPhone,
        ];

        const findRes = await pool.query(
          `SELECT id, name, email, phone_number as "phoneNumber", created_at as "createdAt"
           FROM users 
           WHERE phone_number = ANY($1::varchar[])
           LIMIT 1`,
          [variants]
        );

        if (findRes.rows.length > 0) {
          const user: UserEntity = findRes.rows[0];
          // Optionally update name if new display name provided and previous was default
          if (displayName && (user.name === 'User' || user.name.startsWith('wa_') || user.name.startsWith('User '))) {
            await pool.query(`UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`, [displayName, user.id]);
            user.name = displayName;
          }
          await this.linkWhatsAppContact(pool, cleanPhone, user.id, displayName);
          return user;
        }

        // Check if there's a legacy user with deterministic UUID
        const legacyUuid = toDeterministicUuid(`wa_${cleanPhone}`);
        const legacyRes = await pool.query(
          `SELECT id, name, email, phone_number as "phoneNumber", created_at as "createdAt"
           FROM users WHERE id = $1 LIMIT 1`,
          [legacyUuid]
        );

        if (legacyRes.rows.length > 0) {
          const user: UserEntity = legacyRes.rows[0];
          const newName = displayName || user.name.replace(/^wa_/, 'User ');
          await pool.query(
            `UPDATE users SET phone_number = $1, name = $2, updated_at = NOW() WHERE id = $3`,
            [cleanPhone, newName, user.id]
          );
          user.phoneNumber = cleanPhone;
          user.name = newName;
          await this.linkWhatsAppContact(pool, cleanPhone, user.id, displayName);
          return user;
        }

        // Insert new user with cleanPhone
        const newId = uuidv4();
        const finalName = displayName || `User ${cleanPhone.slice(-4)}`;
        const insertRes = await pool.query(
          `INSERT INTO users (id, name, phone_number, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING id, name, email, phone_number as "phoneNumber", created_at as "createdAt"`,
          [newId, finalName, cleanPhone]
        );

        const newUser: UserEntity = insertRes.rows[0];
        await this.linkWhatsAppContact(pool, cleanPhone, newUser.id, displayName);
        return newUser;
      } catch (err: any) {
        logger.warn('Database error in findOrCreateUserByPhone, falling back to in-memory', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const effectivePhone = cleanPhone || rawPhoneOrId;
    for (const u of this.inMemoryUsers.values()) {
      if (u.phoneNumber === effectivePhone || u.phoneNumber === cleanPhone || u.id === rawPhoneOrId) {
        return u;
      }
    }

    const newUser: UserEntity = {
      id: toDeterministicUuid(`wa_${effectivePhone}`),
      name: displayName || (cleanPhone ? `User ${cleanPhone.slice(-4)}` : 'User'),
      phoneNumber: cleanPhone || undefined,
      createdAt: new Date(),
    };
    this.inMemoryUsers.set(newUser.id, newUser);
    return newUser;
  }

  private async linkWhatsAppContact(
    pool: any,
    waId: string,
    userId: string,
    profileName?: string
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO whatsapp_contacts (wa_id, user_id, phone_number_id, profile_name, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (wa_id) 
         DO UPDATE SET user_id = EXCLUDED.user_id, 
                       profile_name = COALESCE(EXCLUDED.profile_name, whatsapp_contacts.profile_name),
                       updated_at = NOW()`,
        [waId, userId, 'craft_default_wa', profileName || null]
      );
    } catch (err: any) {
      logger.debug('Failed to link whatsapp contact', { error: err.message });
    }
  }

  public async getUserById(userId: string): Promise<UserEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, name, email, phone_number as "phoneNumber", created_at as "createdAt"
           FROM users WHERE id = $1 LIMIT 1`,
          [userId]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to get user by id', { error: err.message });
      }
    }

    return this.inMemoryUsers.get(userId) || null;
  }

  public async getUserByPhone(phone: string): Promise<UserEntity | null> {
    const cleanPhone = normalizePhoneNumber(phone);
    if (!cleanPhone) return null;
    const pool = this.db.getPool();

    if (pool) {
      try {
        const variants = [cleanPhone, `+${cleanPhone}`];
        const res = await pool.query(
          `SELECT id, name, email, phone_number as "phoneNumber", created_at as "createdAt"
           FROM users WHERE phone_number = ANY($1::varchar[]) LIMIT 1`,
          [variants]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to get user by phone', { error: err.message });
      }
    }

    for (const u of this.inMemoryUsers.values()) {
      if (u.phoneNumber === cleanPhone) return u;
    }
    return null;
  }
}
