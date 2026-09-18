import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { logger } from '../../core/logger';

export class WebhookRepository {
  private inMemoryEvents: Set<string> = new Set();

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async isEventProcessed(eventId: string): Promise<boolean> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT event_id FROM webhook_events WHERE event_id = $1`,
          [eventId]
        );
        return res.rows.length > 0;
      } catch (err: any) {
        logger.warn('Database query failed in isEventProcessed, using in-memory store', {
          error: err.message,
        });
      }
    }

    return this.inMemoryEvents.has(eventId);
  }

  public async markEventProcessed(
    eventId: string,
    channel = 'whatsapp',
    payload: Record<string, any> = {}
  ): Promise<void> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO webhook_events (id, event_id, channel, payload, processed)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (event_id) DO NOTHING`,
          [uuidv4(), eventId, channel, JSON.stringify(payload)]
        );
        return;
      } catch (err: any) {
        logger.warn('Database insert failed in markEventProcessed, using in-memory store', {
          error: err.message,
        });
      }
    }

    this.inMemoryEvents.add(eventId);
  }
}
