import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { ConfirmationEntity } from './types';
import { logger } from '../../core/logger';

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

    if (pool) {
      try {
        const res = await pool.query(
          `INSERT INTO confirmation_requests (id, agent_run_id, user_id, action_name, description, payload, token, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
           RETURNING id, agent_run_id as "agentRunId", user_id as "userId", action_name as "actionName", description, payload, token, status, expires_at as "expiresAt", created_at as "createdAt"`,
          [id, agentRunId, userId, actionName, description, JSON.stringify(payload), token, expiresAt]
        );
        return res.rows[0];
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
        return res.rows[0] || null;
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
        return (res.rowCount ?? 0) > 0;
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
