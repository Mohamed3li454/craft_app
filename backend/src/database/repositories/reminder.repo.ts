import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { ReminderEntity } from './types';
import { logger } from '../../core/logger';
import { UserRepository, normalizePhoneNumber } from './user.repo';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Parses a date or timestamp with Cairo / Egypt timezone intelligence (UTC+3).
 */
export function parseDueAt(dueAt?: Date | string | null): Date | null {
  if (!dueAt) return null;
  if (dueAt instanceof Date) return dueAt;

  const str = String(dueAt).trim();
  if (!str) return null;

  // 1. Relative minutes: e.g. "بعد دقيقة", "بعد 5 دقائق", "in 2 mins"
  if (str.includes('بعد دقيقة') || str.includes('بعد دقيقه') || str === '+1m') {
    return new Date(Date.now() + 60 * 1000);
  }
  const minMatch = str.match(/(\d+)\s*(min|دقيقة|دقائق)/i);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    return new Date(Date.now() + mins * 60 * 1000);
  }

  // 2. Relative hours: e.g. "بعد ساعة", "بعد ساعتين", "بعد 3 ساعات"
  if (str.includes('بعد ساعة') || str.includes('بعد ساعه')) {
    return new Date(Date.now() + 60 * 60 * 1000);
  }
  if (str.includes('بعد ساعتين')) {
    return new Date(Date.now() + 2 * 60 * 60 * 1000);
  }
  const hourMatch = str.match(/(\d+)\s*(hour|ساعة|ساعات)/i);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  // 3. Absolute datetime without offset (e.g. "2026-09-19 18:25" or "2026-09-19T18:25:00")
  let normalized = str;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(str)) {
    // Treat as Cairo local time (+03:00) so it does NOT shift to UTC!
    normalized = str.replace(' ', 'T') + (str.length === 16 ? ':00+03:00' : '+03:00');
  } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    // Time-only string: e.g. "18:25"
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    const padded = str.length <= 5 ? str.padStart(5, '0') : str;
    normalized = `${today}T${padded}${padded.length === 5 ? ':00+03:00' : '+03:00'}`;
  }

  const parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calculates the next occurrence timestamp for a recurring reminder
 * based on Cairo local timezone (Africa/Cairo UTC+3).
 */
export function calculateNextDueAt(currentDueAt: Date | string, recurrence: string): Date {
  const current = currentDueAt instanceof Date ? currentDueAt : new Date(currentDueAt);
  const next = new Date(current.getTime());
  const now = new Date();

  const rec = (recurrence || '').toLowerCase().trim();

  if (rec === 'daily') {
    next.setDate(next.getDate() + 1);
    while (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (rec === 'weekly') {
    next.setDate(next.getDate() + 7);
    while (next <= now) {
      next.setDate(next.getDate() + 7);
    }
  } else if (rec === 'monthly') {
    next.setMonth(next.getMonth() + 1);
    while (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next;
}

export class ReminderRepository {
  private inMemoryReminders: Map<string, ReminderEntity[]> = new Map();
  private schemaMigrated = false;

  constructor(
    private db: DatabaseManager = DatabaseManager.getInstance(),
    private userRepo: UserRepository = new UserRepository(db)
  ) {}

  private async resolveUserId(userId: string): Promise<string> {
    if (!userId) return toDeterministicUuid('anonymous');
    // If userId is already a valid UUID, use it directly! NEVER strip digits as a phone number!
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return userId;
    }
    const cleanPhone = normalizePhoneNumber(userId.replace(/^wa_/, ''));
    if (cleanPhone && cleanPhone.length >= 8) {
      const user = await this.userRepo.findOrCreateUserByPhone(cleanPhone);
      return user.id;
    }
    return toDeterministicUuid(userId);
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaMigrated) return;
    const pool = this.db.getPool();
    if (pool) {
      try {
        await pool.query(
          `ALTER TABLE reminders 
             ADD COLUMN IF NOT EXISTS recurrence VARCHAR(50) DEFAULT 'none',
             ADD COLUMN IF NOT EXISTS state VARCHAR(50) NOT NULL DEFAULT 'scheduled',
             ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
             ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE,
             ADD COLUMN IF NOT EXISTS last_error TEXT,
             ADD COLUMN IF NOT EXISTS wamid VARCHAR(255)`
        );
        this.schemaMigrated = true;
      } catch (err: any) {
        logger.debug('Failed to run reminder table schema migration or already present', {
          error: err.message,
        });
      }
    }
  }

  public async create(
    userId: string,
    title: string,
    dueAt?: Date | string | null,
    recurrence: string = 'none'
  ): Promise<ReminderEntity> {
    await this.ensureSchema();
    const pool = this.db.getPool();
    const userUuid = await this.resolveUserId(userId);
    const parsedDueAt = parseDueAt(dueAt);
    const safeRecurrence = recurrence || 'none';

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, userId]
        );

        const res = await pool.query(
          `INSERT INTO reminders (user_id, title, due_at, recurrence, is_completed, state, attempts, created_at, updated_at)
           VALUES ($1, $2, $3, $4, false, 'scheduled', 0, NOW(), NOW())
           RETURNING id, user_id as "userId", title, due_at as "dueAt", recurrence,
                     is_completed as "isCompleted", state, attempts, locked_until as "lockedUntil",
                     last_error as "lastError", wamid, created_at as "createdAt", updated_at as "updatedAt"`,
          [userUuid, title, parsedDueAt, safeRecurrence]
        );

        logger.info(`Saved reminder in database for user [${userId}]`, {
          reminderId: res.rows[0].id,
          title,
          dueAt: parsedDueAt?.toISOString(),
          recurrence: safeRecurrence,
          state: res.rows[0].state,
        });
        return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to insert reminder into database, falling back to in-memory store', {
          error: err.message,
        });
      }
    }

    const newReminder: ReminderEntity = {
      id: uuidv4(),
      userId,
      title,
      dueAt: parsedDueAt,
      recurrence: safeRecurrence,
      isCompleted: false,
      state: 'scheduled',
      attempts: 0,
      lockedUntil: null,
      lastError: null,
      wamid: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const existing = this.inMemoryReminders.get(userId) || [];
    existing.push(newReminder);
    this.inMemoryReminders.set(userId, existing);

    logger.info(`Saved reminder in-memory for user [${userId}]`, {
      title,
      recurrence: safeRecurrence,
      state: 'scheduled',
    });
    return newReminder;
  }

  public async listByUser(
    userId: string,
    includeCompleted = false
  ): Promise<ReminderEntity[]> {
    await this.ensureSchema();
    const pool = this.db.getPool();
    const userUuid = await this.resolveUserId(userId);

    if (pool) {
      try {
        const query = includeCompleted
          ? `SELECT id, user_id as "userId", title, due_at as "dueAt", COALESCE(recurrence, 'none') as "recurrence",
                    is_completed as "isCompleted", state, attempts, locked_until as "lockedUntil",
                    last_error as "lastError", wamid, created_at as "createdAt", updated_at as "updatedAt"
             FROM reminders 
             WHERE user_id = $1 
             ORDER BY is_completed ASC, due_at ASC NULLS LAST, created_at DESC`
          : `SELECT id, user_id as "userId", title, due_at as "dueAt", COALESCE(recurrence, 'none') as "recurrence",
                    is_completed as "isCompleted", state, attempts, locked_until as "lockedUntil",
                    last_error as "lastError", wamid, created_at as "createdAt", updated_at as "updatedAt"
             FROM reminders 
             WHERE user_id = $1 AND is_completed = false AND state NOT IN ('cancelled', 'dead_letter')
             ORDER BY due_at ASC NULLS LAST, created_at DESC`;

        const res = await pool.query(query, [userUuid]);
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to query reminders from database, falling back to in-memory', {
          error: err.message,
        });
      }
    }

    const list = this.inMemoryReminders.get(userUuid) || this.inMemoryReminders.get(userId) || [];
    return includeCompleted
      ? list
      : list.filter((r) => !r.isCompleted && r.state !== 'cancelled' && r.state !== 'dead_letter');
  }

  public async getById(id: string): Promise<ReminderEntity | null> {
    await this.ensureSchema();
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id as "userId", title, due_at as "dueAt", COALESCE(recurrence, 'none') as "recurrence",
                  is_completed as "isCompleted", state, attempts, locked_until as "lockedUntil",
                  last_error as "lastError", wamid, created_at as "createdAt", updated_at as "updatedAt"
           FROM reminders
           WHERE id = $1`,
          [id]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        logger.warn('Failed to query reminder by id from database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) return item;
    }
    return null;
  }

  public async complete(
    idOrTitle: string,
    userId: string
  ): Promise<ReminderEntity | null> {
    await this.ensureSchema();
    const pool = this.db.getPool();
    const userUuid = await this.resolveUserId(userId);

    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders 
           SET is_completed = true, state = 'sent', updated_at = NOW() 
           WHERE user_id = $1 AND (id::text = $2 OR LOWER(title) LIKE LOWER($3))
           RETURNING id, user_id as "userId", title, due_at as "dueAt", COALESCE(recurrence, 'none') as "recurrence",
                     is_completed as "isCompleted", state, attempts, locked_until as "lockedUntil",
                     last_error as "lastError", wamid, created_at as "createdAt", updated_at as "updatedAt"`,
          [userUuid, idOrTitle, `%${idOrTitle}%`]
        );

        if (res.rows.length > 0) {
          logger.info(`Completed reminder in database: [${res.rows[0].title}]`);
          return res.rows[0];
        }
      } catch (err: any) {
        logger.warn('Failed to complete reminder in database, falling back to in-memory', {
          error: err.message,
        });
      }
    }

    const list = this.inMemoryReminders.get(userId) || [];
    const item = list.find(
      (r) =>
        !r.isCompleted &&
        (r.id === idOrTitle || r.title.toLowerCase().includes(idOrTitle.toLowerCase()))
    );

    if (item) {
      item.isCompleted = true;
      item.state = 'sent';
      item.updatedAt = new Date();
      return item;
    }

    return null;
  }

  public async cancel(idOrTitle: string, userId: string): Promise<ReminderEntity | null> {
    await this.ensureSchema();
    const pool = this.db.getPool();
    const userUuid = await this.resolveUserId(userId);

    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders 
           SET state = 'cancelled', is_completed = true, locked_until = NULL, updated_at = NOW() 
           WHERE user_id = $1 AND (id::text = $2 OR LOWER(title) LIKE LOWER($3))
           RETURNING id, user_id as "userId", title, due_at as "dueAt", COALESCE(recurrence, 'none') as "recurrence",
                     is_completed as "isCompleted", state, attempts, locked_until as "lockedUntil",
                     last_error as "lastError", wamid, created_at as "createdAt", updated_at as "updatedAt"`,
          [userUuid, idOrTitle, `%${idOrTitle}%`]
        );

        if (res.rows.length > 0) {
          logger.info(`Cancelled reminder in database: [${res.rows[0].title}]`);
          return res.rows[0];
        }
      } catch (err: any) {
        logger.warn('Failed to cancel reminder in database', { error: err.message });
      }
    }

    const list = this.inMemoryReminders.get(userId) || [];
    const item = list.find(
      (r) =>
        r.state !== 'cancelled' &&
        (r.id === idOrTitle || r.title.toLowerCase().includes(idOrTitle.toLowerCase()))
    );

    if (item) {
      item.state = 'cancelled';
      item.isCompleted = true;
      item.lockedUntil = null;
      item.updatedAt = new Date();
      return item;
    }

    return null;
  }

  public async cancelById(id: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders SET state = 'cancelled', is_completed = true, locked_until = NULL, updated_at = NOW() WHERE id = $1`,
          [id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to cancel reminder by id in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.state = 'cancelled';
        item.isCompleted = true;
        item.lockedUntil = null;
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }

  /**
   * Atomic PostgreSQL claim pattern with FOR UPDATE SKIP LOCKED and lease expiration.
   */
  public async claimDueReminders(
    batchSize = 50,
    leaseSeconds = 120
  ): Promise<Array<ReminderEntity & { userName?: string; phoneNumber?: string }>> {
    await this.ensureSchema();
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `WITH claimed AS (
             SELECT r.id, 
                    COALESCE(u.name, wc.profile_name, 'User') as "userName", 
                    COALESCE(u.phone_number, wc.wa_id, u.bsuid) as "phoneNumber"
             FROM reminders r
             LEFT JOIN users u ON r.user_id = u.id
             LEFT JOIN whatsapp_contacts wc ON wc.user_id = r.user_id
             WHERE r.is_completed = false
               AND r.state IN ('scheduled', 'due', 'retry_pending', 'claimed')
               AND r.due_at IS NOT NULL
               AND r.due_at <= NOW()
               AND (r.locked_until IS NULL OR r.locked_until <= NOW())
             ORDER BY r.due_at ASC
             LIMIT $1
             FOR UPDATE OF r SKIP LOCKED
           )
           UPDATE reminders
           SET state = 'claimed',
               locked_until = NOW() + ($2 || ' seconds')::interval,
               updated_at = NOW()
           FROM claimed
           WHERE reminders.id = claimed.id
           RETURNING reminders.id,
                     reminders.user_id as "userId",
                     reminders.title,
                     reminders.due_at as "dueAt",
                     COALESCE(reminders.recurrence, 'none') as "recurrence",
                     reminders.is_completed as "isCompleted",
                     reminders.state,
                     reminders.attempts,
                     reminders.locked_until as "lockedUntil",
                     reminders.last_error as "lastError",
                     reminders.wamid,
                     claimed."userName",
                     claimed."phoneNumber"`,
          [batchSize, leaseSeconds]
        );
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to claim due reminders from database', { error: err.message });
      }
    }

    // In-memory fallback: atomically claim rows
    const dueList: any[] = [];
    const now = new Date();
    for (const [userId, items] of this.inMemoryReminders.entries()) {
      for (const item of items) {
        const isEligibleState = ['scheduled', 'due', 'retry_pending', 'claimed'].includes(item.state || 'scheduled');
        const isUnlocked = !item.lockedUntil || item.lockedUntil <= now;
        if (!item.isCompleted && isEligibleState && item.dueAt && item.dueAt <= now && isUnlocked) {
          item.state = 'claimed';
          item.lockedUntil = new Date(Date.now() + leaseSeconds * 1000);
          item.updatedAt = new Date();
          dueList.push({
            ...item,
            userName: userId,
          });
          if (dueList.length >= batchSize) break;
        }
      }
      if (dueList.length >= batchSize) break;
    }
    return dueList;
  }

  /**
   * Backward-compatible delegation to claimDueReminders
   */
  public async getDueReminders(): Promise<Array<{
    id: string;
    userId: string;
    title: string;
    dueAt: Date;
    recurrence?: string;
    userName?: string;
    phoneNumber?: string;
  }>> {
    const list = await this.claimDueReminders(50, 120);
    return list.map((item) => ({
      ...item,
      dueAt: item.dueAt || new Date(),
    }));
  }

  public async markSending(id: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders SET state = 'sending', updated_at = NOW() WHERE id = $1`,
          [id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark reminder sending in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.state = 'sending';
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }

  public async markSent(id: string, wamid: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders 
           SET state = 'sent', is_completed = true, wamid = $1, locked_until = NULL, last_error = NULL, updated_at = NOW() 
           WHERE id = $2`,
          [wamid, id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark reminder sent in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.state = 'sent';
        item.isCompleted = true;
        item.wamid = wamid;
        item.lockedUntil = null;
        item.lastError = null;
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }

  public async markRetryPending(
    id: string,
    nextDueAt: Date,
    attempts: number,
    lastError: string
  ): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders 
           SET state = 'retry_pending', due_at = $1, attempts = $2, last_error = $3, locked_until = NULL, updated_at = NOW() 
           WHERE id = $4`,
          [nextDueAt, attempts, lastError, id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark reminder retry_pending in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.state = 'retry_pending';
        item.dueAt = nextDueAt;
        item.attempts = attempts;
        item.lastError = lastError;
        item.lockedUntil = null;
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }

  public async markDeadLetter(id: string, lastError: string, attempts?: number): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const query = attempts !== undefined
          ? `UPDATE reminders SET state = 'dead_letter', is_completed = true, attempts = $1, last_error = $2, locked_until = NULL, updated_at = NOW() WHERE id = $3`
          : `UPDATE reminders SET state = 'dead_letter', is_completed = true, last_error = $1, locked_until = NULL, updated_at = NOW() WHERE id = $2`;
        const params = attempts !== undefined ? [attempts, lastError, id] : [lastError, id];
        const res = await pool.query(query, params);
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark reminder dead_letter in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.state = 'dead_letter';
        item.isCompleted = true;
        if (attempts !== undefined) item.attempts = attempts;
        item.lastError = lastError;
        item.lockedUntil = null;
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }

  public async completeById(id: string): Promise<boolean> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders SET is_completed = true, state = 'sent', updated_at = NOW() WHERE id = $1`,
          [id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to complete reminder by id in database', { error: err.message });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.isCompleted = true;
        item.state = 'sent';
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }

  public async rescheduleRecurring(id: string, nextDueAt: Date): Promise<boolean> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders 
           SET due_at = $1, is_completed = false, state = 'scheduled', attempts = 0, wamid = NULL, locked_until = NULL, last_error = NULL, updated_at = NOW() 
           WHERE id = $2`,
          [nextDueAt, id]
        );
        logger.info(`Rescheduled recurring reminder in database: [${id}] next due at [${nextDueAt.toISOString()}]`);
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to reschedule recurring reminder in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.dueAt = nextDueAt;
        item.isCompleted = false;
        item.state = 'scheduled';
        item.attempts = 0;
        item.wamid = null;
        item.lockedUntil = null;
        item.lastError = null;
        item.updatedAt = new Date();
        logger.info(`Rescheduled recurring reminder in-memory: [${id}] next due at [${nextDueAt.toISOString()}]`);
        return true;
      }
    }
    return false;
  }

  public async revertCompletion(id: string, retryInSeconds = 60): Promise<boolean> {
    const pool = this.db.getPool();
    const nextRetry = new Date(Date.now() + retryInSeconds * 1000);

    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders 
           SET is_completed = false, state = 'retry_pending', due_at = $1, locked_until = NULL, updated_at = NOW() 
           WHERE id = $2`,
          [nextRetry, id]
        );
        logger.info(`Reverted reminder completion for retry [${id}] at [${nextRetry.toISOString()}]`);
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to revert reminder completion in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryReminders.values()) {
      const item = items.find((r) => r.id === id);
      if (item) {
        item.isCompleted = false;
        item.state = 'retry_pending';
        item.dueAt = nextRetry;
        item.lockedUntil = null;
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }
}
