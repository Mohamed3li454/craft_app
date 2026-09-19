import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { ReminderEntity } from './types';
import { logger } from '../../core/logger';

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

export class ReminderRepository {
  private inMemoryReminders: Map<string, ReminderEntity[]> = new Map();

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async create(
    userId: string,
    title: string,
    dueAt?: Date | string | null
  ): Promise<ReminderEntity> {
    const pool = this.db.getPool();
    const userUuid = toDeterministicUuid(userId);
    const parsedDueAt = parseDueAt(dueAt);

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, userId]
        );

        const res = await pool.query(
          `INSERT INTO reminders (user_id, title, due_at, is_completed, created_at, updated_at)
           VALUES ($1, $2, $3, false, NOW(), NOW())
           RETURNING id, user_id as "userId", title, due_at as "dueAt", is_completed as "isCompleted", created_at as "createdAt", updated_at as "updatedAt"`,
          [userUuid, title, parsedDueAt]
        );

        logger.info(`Saved reminder in database for user [${userId}]`, {
          reminderId: res.rows[0].id,
          title,
          dueAt: parsedDueAt?.toISOString(),
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
      isCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const existing = this.inMemoryReminders.get(userId) || [];
    existing.push(newReminder);
    this.inMemoryReminders.set(userId, existing);

    logger.info(`Saved reminder in-memory for user [${userId}]`, { title });
    return newReminder;
  }

  public async listByUser(
    userId: string,
    includeCompleted = false
  ): Promise<ReminderEntity[]> {
    const pool = this.db.getPool();
    const userUuid = toDeterministicUuid(userId);

    if (pool) {
      try {
        const query = includeCompleted
          ? `SELECT id, user_id as "userId", title, due_at as "dueAt", is_completed as "isCompleted", created_at as "createdAt", updated_at as "updatedAt"
             FROM reminders 
             WHERE user_id = $1 
             ORDER BY is_completed ASC, due_at ASC NULLS LAST, created_at DESC`
          : `SELECT id, user_id as "userId", title, due_at as "dueAt", is_completed as "isCompleted", created_at as "createdAt", updated_at as "updatedAt"
             FROM reminders 
             WHERE user_id = $1 AND is_completed = false 
             ORDER BY due_at ASC NULLS LAST, created_at DESC`;

        const res = await pool.query(query, [userUuid]);
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to query reminders from database, falling back to in-memory', {
          error: err.message,
        });
      }
    }

    const list = this.inMemoryReminders.get(userId) || [];
    return includeCompleted ? list : list.filter((r) => !r.isCompleted);
  }

  public async complete(
    idOrTitle: string,
    userId: string
  ): Promise<ReminderEntity | null> {
    const pool = this.db.getPool();
    const userUuid = toDeterministicUuid(userId);

    if (pool) {
      try {
        // Try match by UUID or title
        const res = await pool.query(
          `UPDATE reminders 
           SET is_completed = true, updated_at = NOW() 
           WHERE user_id = $1 AND (id::text = $2 OR LOWER(title) LIKE LOWER($3))
           RETURNING id, user_id as "userId", title, due_at as "dueAt", is_completed as "isCompleted", created_at as "createdAt", updated_at as "updatedAt"`,
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
      item.updatedAt = new Date();
      return item;
    }

    return null;
  }

  public async getDueReminders(): Promise<Array<{
    id: string;
    userId: string;
    title: string;
    dueAt: Date;
    userName?: string;
    phoneNumber?: string;
  }>> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT r.id, r.user_id as "userId", r.title, r.due_at as "dueAt", u.name as "userName", u.phone_number as "phoneNumber"
           FROM reminders r
           JOIN users u ON r.user_id = u.id
           WHERE r.is_completed = false
             AND r.due_at IS NOT NULL
             AND r.due_at <= NOW()
           ORDER BY r.due_at ASC
           LIMIT 50`
        );
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to query due reminders from database', { error: err.message });
      }
    }

    // In-memory fallback
    const dueList: any[] = [];
    const now = new Date();
    for (const [userId, items] of this.inMemoryReminders.entries()) {
      for (const item of items) {
        if (!item.isCompleted && item.dueAt && item.dueAt <= now) {
          dueList.push({
            id: item.id,
            userId,
            title: item.title,
            dueAt: item.dueAt,
            userName: userId,
          });
        }
      }
    }
    return dueList;
  }

  public async completeById(id: string): Promise<boolean> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE reminders SET is_completed = true, updated_at = NOW() WHERE id = $1`,
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
        item.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }
}
