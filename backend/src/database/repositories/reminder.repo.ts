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
    let parsedDueAt: Date | null = null;

    if (dueAt) {
      if (dueAt instanceof Date) {
        parsedDueAt = dueAt;
      } else {
        const parsed = new Date(dueAt);
        if (!isNaN(parsed.getTime())) {
          parsedDueAt = parsed;
        }
      }
    }

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
}
