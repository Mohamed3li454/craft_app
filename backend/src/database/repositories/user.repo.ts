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

export interface FindOrCreateWhatsAppUserParams {
  phone?: string;
  bsuid?: string;
  displayName?: string;
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
      // 1. Ensure phone_number, bsuid, is_vip, and daily_message_count columns exist on users
      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS bsuid VARCHAR(255);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_message_count INT DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_message_date DATE DEFAULT CURRENT_DATE;
        CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
        CREATE INDEX IF NOT EXISTS idx_users_bsuid ON users(bsuid);
        CREATE INDEX IF NOT EXISTS idx_users_is_vip ON users(is_vip);
      `);

      // 2. Ensure whatsapp_contacts table exists and wa_id supports up to 255-char BSUIDs
      await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_contacts (
          wa_id VARCHAR(255) PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          phone_number_id VARCHAR(50) DEFAULT '',
          profile_name VARCHAR(255),
          verified BOOLEAN DEFAULT false NOT NULL,
          bsuid VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
        );
        ALTER TABLE whatsapp_contacts ALTER COLUMN wa_id TYPE VARCHAR(255);
        ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS bsuid VARCHAR(255);
        CREATE INDEX IF NOT EXISTS idx_wa_contacts_user_id ON whatsapp_contacts(user_id);
        CREATE INDEX IF NOT EXISTS idx_wa_contacts_bsuid ON whatsapp_contacts(bsuid);
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
   * Resolves or creates a unified UserEntity given either:
   * 1. A traditional phone number (e.g. +2010...)
   * 2. A modern Meta Business-Scoped User ID (BSUID)
   * 3. Both (associating the BSUID with the existing phone user)
   */
  public async findOrCreateWhatsAppUser(
    params: FindOrCreateWhatsAppUserParams
  ): Promise<UserEntity> {
    await this.ensureSchema();
    const cleanPhone = params.phone ? normalizePhoneNumber(params.phone) : undefined;
    const bsuid = params.bsuid ? params.bsuid.trim() : undefined;
    const pool = this.db.getPool();

    if (pool) {
      try {
        // 1. If BSUID provided, check whatsapp_contacts by wa_id or bsuid, or users by bsuid
        if (bsuid) {
          const bsuidRes = await pool.query(
            `SELECT u.id, u.name, u.email, u.phone_number as "phoneNumber", u.bsuid, u.created_at as "createdAt"
             FROM users u
             LEFT JOIN whatsapp_contacts wc ON wc.user_id = u.id
             WHERE wc.wa_id = $1 OR wc.bsuid = $1 OR u.bsuid = $1
             LIMIT 1`,
            [bsuid]
          );

          if (bsuidRes.rows.length > 0) {
            const user: UserEntity = bsuidRes.rows[0];
            // If phone also provided and user didn't have phone before, link phone
            if (cleanPhone && !user.phoneNumber) {
              await pool.query(
                `UPDATE users SET phone_number = $1, updated_at = NOW() WHERE id = $2`,
                [cleanPhone, user.id]
              );
              user.phoneNumber = cleanPhone;
            }
            // Optionally update name if new display name provided and previous was default
            if (params.displayName && (user.name === 'User' || user.name === 'WhatsApp User' || user.name.startsWith('wa_') || user.name.startsWith('User '))) {
              await pool.query(`UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`, [params.displayName, user.id]);
              user.name = params.displayName;
            }
            await this.linkWhatsAppContact(pool, bsuid, user.id, params.displayName, bsuid);
            return user;
          }
        }

        // 2. If phone provided, query user with phone number variants
        if (cleanPhone) {
          const variants = [
            cleanPhone,
            `+${cleanPhone}`,
            cleanPhone.startsWith('20') ? `0${cleanPhone.slice(2)}` : cleanPhone,
          ];

          const phoneRes = await pool.query(
            `SELECT id, name, email, phone_number as "phoneNumber", bsuid, created_at as "createdAt"
             FROM users 
             WHERE phone_number = ANY($1::varchar[])
             LIMIT 1`,
            [variants]
          );

          if (phoneRes.rows.length > 0) {
            const user: UserEntity = phoneRes.rows[0];
            // If BSUID also provided, attach to user
            if (bsuid && !user.bsuid) {
              await pool.query(
                `UPDATE users SET bsuid = $1, updated_at = NOW() WHERE id = $2`,
                [bsuid, user.id]
              );
              user.bsuid = bsuid;
            }
            if (params.displayName && (user.name === 'User' || user.name === 'WhatsApp User' || user.name.startsWith('wa_') || user.name.startsWith('User '))) {
              await pool.query(`UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`, [params.displayName, user.id]);
              user.name = params.displayName;
            }
            await this.linkWhatsAppContact(pool, cleanPhone, user.id, params.displayName, bsuid);
            return user;
          }
        }

        // 3. Create new user (supports phone-only, BSUID-only, or both)
        const newId = uuidv4();
        const finalName =
          params.displayName ||
          (cleanPhone ? `User ${cleanPhone.slice(-4)}` : 'WhatsApp User');
        const effectivePhoneNumber = cleanPhone || null;
        const effectiveBsuid = bsuid || null;

        const insertRes = await pool.query(
          `INSERT INTO users (id, name, phone_number, bsuid, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING id, name, email, phone_number as "phoneNumber", bsuid, created_at as "createdAt"`,
          [newId, finalName, effectivePhoneNumber, effectiveBsuid]
        );

        const newUser: UserEntity = insertRes.rows[0];
        await this.linkWhatsAppContact(pool, cleanPhone || bsuid || newId, newUser.id, params.displayName, bsuid);
        return newUser;
      } catch (err: any) {
        logger.warn('Database error in findOrCreateWhatsAppUser, falling back to in-memory', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    if (bsuid) {
      for (const u of this.inMemoryUsers.values()) {
        if (u.bsuid === bsuid || u.id === toDeterministicUuid(`wa_${bsuid}`)) {
          if (cleanPhone && !u.phoneNumber) u.phoneNumber = cleanPhone;
          return u;
        }
      }
    }

    if (cleanPhone) {
      for (const u of this.inMemoryUsers.values()) {
        if (u.phoneNumber === cleanPhone || u.id === toDeterministicUuid(`wa_${cleanPhone}`)) {
          if (bsuid && !u.bsuid) u.bsuid = bsuid;
          return u;
        }
      }
    }

    const primaryKey = bsuid || cleanPhone || uuidv4();
    const newUser: UserEntity = {
      id: toDeterministicUuid(`wa_${primaryKey}`),
      name:
        params.displayName ||
        (cleanPhone ? `User ${cleanPhone.slice(-4)}` : 'WhatsApp User'),
      phoneNumber: cleanPhone,
      bsuid: bsuid,
      createdAt: new Date(),
    };
    this.inMemoryUsers.set(newUser.id, newUser);
    return newUser;
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
    profileName?: string,
    bsuid?: string
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO whatsapp_contacts (wa_id, user_id, phone_number_id, profile_name, bsuid, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (wa_id) 
         DO UPDATE SET user_id = EXCLUDED.user_id, 
                       profile_name = COALESCE(EXCLUDED.profile_name, whatsapp_contacts.profile_name),
                       bsuid = COALESCE(EXCLUDED.bsuid, whatsapp_contacts.bsuid),
                       updated_at = NOW()`,
        [waId, userId, 'craft_default_wa', profileName || null, bsuid || null]
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

  /**
   * Checks and increments the daily message count for rate limiting (40 msgs/day).
   * VIP users and numbers in VIP_PHONE_NUMBERS bypass this limit.
   */
  public async checkAndIncrementDailyLimit(
    userId: string,
    phoneNumber?: string
  ): Promise<{ allowed: boolean; remaining: number; isVip: boolean }> {
    const limit = 40;
    const cleanPhone = normalizePhoneNumber(phoneNumber || '');

    // 1. Check if phone is in static VIP list from environment
    const isStaticVip = (process.env.VIP_PHONE_NUMBERS || '201028067432')
      .split(',')
      .map((p) => normalizePhoneNumber(p.trim()))
      .filter(Boolean)
      .some((vip) => vip === cleanPhone);

    const pool = this.db.getPool();
    if (!pool) {
      const user = this.inMemoryUsers.get(userId);
      if (isStaticVip || (user as any)?.isVip) {
        return { allowed: true, remaining: 9999, isVip: true };
      }
      return { allowed: true, remaining: limit, isVip: false };
    }

    try {
      await this.ensureSchema();

      // Today's date in Cairo timezone (YYYY-MM-DD)
      const cairoDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const userUuid = toDeterministicUuid(userId);
      const res = await pool.query(
        `SELECT is_vip, daily_message_count, last_message_date, phone_number FROM users WHERE id = $1`,
        [userUuid]
      );

      if (res.rows.length === 0) {
        return { allowed: true, remaining: limit, isVip: false };
      }

      const row = res.rows[0];
      const dbIsVip = !!row.is_vip;
      const isVip = isStaticVip || dbIsVip;

      if (isVip) {
        return { allowed: true, remaining: 9999, isVip: true };
      }

      const lastDate = row.last_message_date
        ? new Date(row.last_message_date).toISOString().split('T')[0]
        : '';
      const isNewDay = lastDate !== cairoDate;

      const currentCount = isNewDay ? 0 : (row.daily_message_count || 0);

      if (currentCount >= limit) {
        return { allowed: false, remaining: 0, isVip: false };
      }

      const newCount = currentCount + 1;
      await pool.query(
        `UPDATE users SET daily_message_count = $1, last_message_date = $2, updated_at = NOW() WHERE id = $3`,
        [newCount, cairoDate, userUuid]
      );

      return {
        allowed: true,
        remaining: Math.max(0, limit - newCount),
        isVip: false,
      };
    } catch (err: any) {
      logger.warn('Failed to check rate limit in DB, allowing message', { error: err.message });
      return { allowed: true, remaining: limit, isVip: isStaticVip };
    }
  }

  /**
   * Toggles VIP status for a user
   */
  public async toggleVipStatus(userId: string): Promise<boolean | null> {
    const pool = this.db.getPool();
    if (!pool) return null;
    try {
      await this.ensureSchema();
      const userUuid = toDeterministicUuid(userId);
      const res = await pool.query(
        `UPDATE users SET is_vip = NOT COALESCE(is_vip, false), updated_at = NOW() WHERE id = $1 RETURNING is_vip`,
        [userUuid]
      );
      return res.rows[0]?.is_vip ?? false;
    } catch (err: any) {
      logger.error('Failed to toggle user VIP status', { error: err.message, userId });
      return null;
    }
  }

  public async setVipStatus(userId: string, isVip: boolean): Promise<boolean> {
    const pool = this.db.getPool();
    if (!pool) return false;
    try {
      await this.ensureSchema();
      const userUuid = toDeterministicUuid(userId);
      await pool.query(`UPDATE users SET is_vip = $1, updated_at = NOW() WHERE id = $2`, [isVip, userUuid]);
      return true;
    } catch (err: any) {
      logger.error('Failed to set user VIP status', { error: err.message, userId });
      return false;
    }
  }
}
