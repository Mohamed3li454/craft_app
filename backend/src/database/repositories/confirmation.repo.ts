import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { ConfirmationEntity } from './types';
import { logger } from '../../core/logger';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class ConfirmationRepository {
  private inMemoryConfirmations: Map<string, ConfirmationEntity> = new Map();

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async create(
    agentRunId: string,
    userId: string,
    actionName: string,
    description: string,
    payload: Record<string, any>,
    expiresAt: Date
  ): Promise<ConfirmationEntity> {
    const pool = this.db.getPool();
    const token = uuidv4().replace(/-/g, '').substring(0, 16);
    const id = uuidv4();
    const userUuid = toDeterministicUuid(userId);
    const agentRunUuid = toDeterministicUuid(agentRunId);

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, userId]
        );
        await pool.query(
          `INSERT INTO conversations (id, user_id, channel, title) VALUES ($1, $2, 'whatsapp', 'Default') ON CONFLICT (id) DO NOTHING`,
          [agentRunUuid, userUuid]
        );
        await pool.query(
          `INSERT INTO agent_runs (id, conversation_id, user_prompt) VALUES ($1, $1, $2) ON CONFLICT (id) DO NOTHING`,
          [agentRunUuid, description]
        );

        const res = await pool.query(
          `INSERT INTO confirmation_requests (id, agent_run_id, user_id, action_name, description, payload, token, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
           RETURNING id, agent_run_id as "agentRunId", user_id as "userId", action_name as "actionName", description, payload, token, status, expires_at as "expiresAt", created_at as "createdAt"`,
          [id, agentRunUuid, userUuid, actionName, description, JSON.stringify(payload), token, expiresAt]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        logger.warn('Database insert failed in create confirmation, using in-memory store', {
          error: err.message,
        });
      }
    }

    const entity: ConfirmationEntity = {
      id,
      agentRunId,
      userId,
      actionName,
      description,
      payload,
      token,
      status: 'pending',
      expiresAt,
      createdAt: new Date(),
    };
    this.inMemoryConfirmations.set(token, entity);
    return entity;
  }

  public async getByToken(token: string): Promise<ConfirmationEntity | null> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, agent_run_id as "agentRunId", user_id as "userId", action_name as "actionName", description, payload, token, status, expires_at as "expiresAt", created_at as "createdAt"
           FROM confirmation_requests 
           WHERE token = $1`,
          [token]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        logger.warn('Database query failed in getByToken, using in-memory store', {
          error: err.message,
        });
      }
    }

    return this.inMemoryConfirmations.get(token) || null;
  }

  public async updateStatus(
    token: string,
    status: 'approved' | 'rejected' | 'expired'
  ): Promise<boolean> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE confirmation_requests 
           SET status = $1, resolved_at = now() 
           WHERE token = $2 AND status = 'pending'`,
          [status, token]
        );
        if ((res.rowCount ?? 0) > 0) {
          return true;
        }
      } catch (err: any) {
        logger.warn('Database update failed in updateStatus, using in-memory store', {
          error: err.message,
        });
      }
    }

    const entity = this.inMemoryConfirmations.get(token);
    if (entity && entity.status === 'pending') {
      entity.status = status;
      return true;
    }
    return false;
  }
}
