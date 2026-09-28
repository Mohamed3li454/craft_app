/**
 * Proactive Action Repository (Phase 7.3)
 *
 * Provides PostgreSQL persistence with atomic `FOR UPDATE SKIP LOCKED` claiming,
 * deterministic deduplication keys, and an in-memory fallback for unit testing.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../../database/connection';
import { logger } from '../../core/logger';
import {
  CreateProactiveActionInput,
  ProactiveActionEntity,
  ProactiveActionStatus,
  ProactiveHistorySnapshot,
} from './types';

export function generateDedupKey(
  userId: string,
  candidateType: string,
  topic?: string | null,
  contextDigest: string = ''
): string {
  const normTopic = (topic || 'general').trim().toLowerCase();
  const normDigest = contextDigest.trim().toLowerCase();
  return crypto
    .createHash('sha256')
    .update(`${userId}:${candidateType}:${normTopic}:${normDigest}`)
    .digest('hex');
}

export function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class ProactiveActionRepository {
  private inMemoryActions: Map<string, ProactiveActionEntity> = new Map();
  private schemaMigrated = false;

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaMigrated) return;
    const pool = this.db.getPool();
    if (pool) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS proactive_actions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            conversation_id VARCHAR(255),
            candidate_type VARCHAR(50) NOT NULL,
            topic VARCHAR(255),
            context_digest TEXT NOT NULL,
            reason VARCHAR(255) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            delivery_mode VARCHAR(50) NOT NULL DEFAULT 'out_of_turn',
            eligible_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            claimed_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            dedup_key VARCHAR(128) NOT NULL,
            metadata JSONB DEFAULT '{}'::jsonb,
            CONSTRAINT uq_proactive_actions_dedup UNIQUE (dedup_key)
          );
          CREATE INDEX IF NOT EXISTS idx_proactive_actions_status_eligible 
            ON proactive_actions (status, eligible_at) 
            WHERE status IN ('pending', 'deferred');
          CREATE INDEX IF NOT EXISTS idx_proactive_actions_user_status 
            ON proactive_actions (user_id, status);
          CREATE INDEX IF NOT EXISTS idx_proactive_actions_dedup_key 
            ON proactive_actions (dedup_key);
        `);
        this.schemaMigrated = true;
      } catch (err: any) {
        logger.debug('Proactive actions table schema ensure skipped or present', { error: err.message });
      }
    }
  }

  public async createOrGet(input: CreateProactiveActionInput): Promise<ProactiveActionEntity> {
    await this.ensureSchema();
    const dedupKey = generateDedupKey(input.userId, input.candidateType, input.topic, input.contextDigest);
    const eligibleAt = input.eligibleAt || new Date();
    const expiresAt = input.expiresAt || new Date(eligibleAt.getTime() + 48 * 60 * 60 * 1000); // 48h TTL
    const deliveryMode = input.deliveryMode || 'out_of_turn';
    const metadata = input.metadata || {};

    const pool = this.db.getPool();
    if (pool) {
      try {
        const userUuid = toDeterministicUuid(input.userId);
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, input.userId]
        );

        const query = `
          INSERT INTO proactive_actions (
            user_id, conversation_id, candidate_type, topic, context_digest,
            reason, status, delivery_mode, eligible_at, expires_at, dedup_key,
            metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, NOW(), NOW())
          ON CONFLICT (dedup_key) DO UPDATE 
            SET updated_at = NOW()
          RETURNING 
            id, user_id as "userId", conversation_id as "conversationId",
            candidate_type as "candidateType", topic, context_digest as "contextDigest",
            reason, status, delivery_mode as "deliveryMode", eligible_at as "eligibleAt",
            expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt",
            claimed_at as "claimedAt", completed_at as "completedAt",
            attempt_count as "attemptCount", last_error as "lastError",
            dedup_key as "dedupKey", metadata
        `;
        const res = await pool.query(query, [
          userUuid,
          input.conversationId || null,
          input.candidateType,
          input.topic || null,
          input.contextDigest,
          input.reason,
          deliveryMode,
          eligibleAt,
          expiresAt,
          dedupKey,
          JSON.stringify(metadata),
        ]);
        if (res.rows.length > 0) {
          return { ...res.rows[0], userId: input.userId };
        }
      } catch (err: any) {
        logger.warn('Failed to insert proactive action into database, using in-memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const existing = Array.from(this.inMemoryActions.values()).find((a) => a.dedupKey === dedupKey);
    if (existing) {
      existing.updatedAt = new Date();
      return existing;
    }

    const newAction: ProactiveActionEntity = {
      id: uuidv4(),
      userId: input.userId,
      conversationId: input.conversationId,
      candidateType: input.candidateType,
      topic: input.topic || null,
      contextDigest: input.contextDigest,
      reason: input.reason,
      status: 'pending',
      deliveryMode,
      eligibleAt,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      attemptCount: 0,
      dedupKey,
      metadata,
    };
    this.inMemoryActions.set(newAction.id, newAction);
    return newAction;
  }

  /**
   * Concurrency-safe atomic claim using PostgreSQL `FOR UPDATE SKIP LOCKED`.
   * Automatically expires any actions past expiresAt.
   */
  public async claimDueActions(limit = 50, now: Date = new Date()): Promise<ProactiveActionEntity[]> {
    await this.ensureSchema();
    const pool = this.db.getPool();

    if (pool) {
      try {
        // 1. Expire outdated actions
        await pool.query(
          `UPDATE proactive_actions 
           SET status = 'expired', updated_at = NOW() 
           WHERE status IN ('pending', 'deferred') AND expires_at <= $1`,
          [now]
        );

        // 2. Concurrency-safe atomic claim
        const claimQuery = `
          WITH claimed AS (
            SELECT id
            FROM proactive_actions
            WHERE status IN ('pending', 'deferred')
              AND eligible_at <= $1
              AND expires_at > $1
            ORDER BY eligible_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
          )
          UPDATE proactive_actions
          SET status = 'claimed', claimed_at = $1, updated_at = NOW()
          FROM claimed
          WHERE proactive_actions.id = claimed.id
          RETURNING 
            proactive_actions.id,
            proactive_actions.user_id as "userId",
            proactive_actions.conversation_id as "conversationId",
            proactive_actions.candidate_type as "candidateType",
            proactive_actions.topic,
            proactive_actions.context_digest as "contextDigest",
            proactive_actions.reason,
            proactive_actions.status,
            proactive_actions.delivery_mode as "deliveryMode",
            proactive_actions.eligible_at as "eligibleAt",
            proactive_actions.expires_at as "expiresAt",
            proactive_actions.created_at as "createdAt",
            proactive_actions.updated_at as "updatedAt",
            proactive_actions.claimed_at as "claimedAt",
            proactive_actions.completed_at as "completedAt",
            proactive_actions.attempt_count as "attemptCount",
            proactive_actions.last_error as "lastError",
            proactive_actions.dedup_key as "dedupKey",
            proactive_actions.metadata
        `;
        const res = await pool.query(claimQuery, [now, limit]);
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to claim due proactive actions from database, using in-memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const claimedList: ProactiveActionEntity[] = [];
    const candidates = Array.from(this.inMemoryActions.values())
      .filter((action) => action.status === 'pending' || action.status === 'deferred')
      .sort((a, b) => a.eligibleAt.getTime() - b.eligibleAt.getTime());

    for (const action of candidates) {
      if (action.expiresAt <= now) {
        action.status = 'expired';
        action.updatedAt = new Date();
        continue;
      }
      if (action.eligibleAt <= now && claimedList.length < limit) {
        action.status = 'claimed';
        action.claimedAt = now;
        action.updatedAt = new Date();
        claimedList.push({ ...action });
      }
    }
    return claimedList;
  }

  public async markCompleted(id: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_actions 
           SET status = 'completed', completed_at = NOW(), updated_at = NOW() 
           WHERE id = $1`,
          [id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark proactive action completed in database', { error: err.message, id });
      }
    }
    const item = this.inMemoryActions.get(id);
    if (item) {
      item.status = 'completed';
      item.completedAt = new Date();
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markSuppressed(id: string, reason: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_actions 
           SET status = 'suppressed', reason = $1, updated_at = NOW() 
           WHERE id = $2`,
          [reason, id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark proactive action suppressed in database', { error: err.message, id });
      }
    }
    const item = this.inMemoryActions.get(id);
    if (item) {
      item.status = 'suppressed';
      item.reason = reason;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markDeferred(id: string, newEligibleAt: Date, reason?: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_actions 
           SET status = 'deferred', eligible_at = $1, reason = COALESCE($2, reason), updated_at = NOW() 
           WHERE id = $3`,
          [newEligibleAt, reason || null, id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark proactive action deferred in database', { error: err.message, id });
      }
    }
    const item = this.inMemoryActions.get(id);
    if (item) {
      item.status = 'deferred';
      item.eligibleAt = newEligibleAt;
      if (reason) item.reason = reason;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markExpired(id: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_actions 
           SET status = 'expired', updated_at = NOW() 
           WHERE id = $1`,
          [id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark proactive action expired in database', { error: err.message, id });
      }
    }
    const item = this.inMemoryActions.get(id);
    if (item) {
      item.status = 'expired';
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markFailed(id: string, errorMsg: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_actions 
           SET status = 'failed', last_error = $1, attempt_count = attempt_count + 1, updated_at = NOW() 
           WHERE id = $2`,
          [errorMsg, id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark proactive action failed in database', { error: err.message, id });
      }
    }
    const item = this.inMemoryActions.get(id);
    if (item) {
      item.status = 'failed';
      item.lastError = errorMsg;
      item.attemptCount += 1;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async revertClaimForRetry(id: string, retryInSeconds = 60, errorMsg?: string): Promise<boolean> {
    const nextRetry = new Date(Date.now() + retryInSeconds * 1000);
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_actions 
           SET status = 'deferred', eligible_at = $1, attempt_count = attempt_count + 1, last_error = $2, updated_at = NOW() 
           WHERE id = $3`,
          [nextRetry, errorMsg || null, id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to revert proactive action claim for retry in database', { error: err.message, id });
      }
    }
    const item = this.inMemoryActions.get(id);
    if (item) {
      item.status = 'deferred';
      item.eligibleAt = nextRetry;
      item.attemptCount += 1;
      if (errorMsg) item.lastError = errorMsg;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async updateStatus(
    id: string,
    status: ProactiveActionStatus,
    options?: { reason?: string; error?: string; eligibleAt?: Date }
  ): Promise<boolean> {
    if (status === 'completed') return this.markCompleted(id);
    if (status === 'suppressed') return this.markSuppressed(id, options?.reason || 'Suppressed');
    if (status === 'deferred') return this.markDeferred(id, options?.eligibleAt || new Date(Date.now() + 15 * 60 * 1000), options?.reason);
    if (status === 'expired') return this.markExpired(id);
    if (status === 'failed') return this.markFailed(id, options?.error || 'Failed');

    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_actions SET status = $1, updated_at = NOW() WHERE id = $2`,
          [status, id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to update proactive action status in database', { error: err.message, id, status });
      }
    }
    const item = this.inMemoryActions.get(id);
    if (item) {
      item.status = status;
      if (status === 'claimed') item.claimedAt = new Date();
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async queryByStatus(status: ProactiveActionStatus, userId?: string): Promise<ProactiveActionEntity[]> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const query = userId
          ? `SELECT id, user_id as "userId", conversation_id as "conversationId",
                    candidate_type as "candidateType", topic, context_digest as "contextDigest",
                    reason, status, delivery_mode as "deliveryMode", eligible_at as "eligibleAt",
                    expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt",
                    claimed_at as "claimedAt", completed_at as "completedAt",
                    attempt_count as "attemptCount", last_error as "lastError",
                    dedup_key as "dedupKey", metadata
             FROM proactive_actions WHERE status = $1 AND user_id = $2 ORDER BY created_at DESC`
          : `SELECT id, user_id as "userId", conversation_id as "conversationId",
                    candidate_type as "candidateType", topic, context_digest as "contextDigest",
                    reason, status, delivery_mode as "deliveryMode", eligible_at as "eligibleAt",
                    expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt",
                    claimed_at as "claimedAt", completed_at as "completedAt",
                    attempt_count as "attemptCount", last_error as "lastError",
                    dedup_key as "dedupKey", metadata
             FROM proactive_actions WHERE status = $1 ORDER BY created_at DESC`;
        const userUuid = userId ? toDeterministicUuid(userId) : undefined;
        const params = userUuid ? [status, userUuid] : [status];
        const res = await pool.query(query, params);
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to query proactive actions by status from database', { error: err.message });
      }
    }
    return Array.from(this.inMemoryActions.values()).filter(
      (a) => a.status === status && (!userId || a.userId === userId)
    );
  }

  public async findById(id: string): Promise<ProactiveActionEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id as "userId", conversation_id as "conversationId",
                  candidate_type as "candidateType", topic, context_digest as "contextDigest",
                  reason, status, delivery_mode as "deliveryMode", eligible_at as "eligibleAt",
                  expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt",
                  claimed_at as "claimedAt", completed_at as "completedAt",
                  attempt_count as "attemptCount", last_error as "lastError",
                  dedup_key as "dedupKey", metadata
           FROM proactive_actions WHERE id = $1 LIMIT 1`,
          [id]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to find proactive action by id from database', { error: err.message, id });
      }
    }
    return this.inMemoryActions.get(id) || null;
  }

  public async getRecentHistory(
    userId: string,
    rollingWindowMs = 24 * 60 * 60 * 1000,
    now: Date = new Date()
  ): Promise<ProactiveHistorySnapshot> {
    const windowStart = new Date(now.getTime() - rollingWindowMs);
    const pool = this.db.getPool();

    if (pool) {
      try {
        const userUuid = toDeterministicUuid(userId);
        const res = await pool.query(
          `SELECT completed_at as "completedAt", dedup_key as "dedupKey", topic, candidate_type as "candidateType"
           FROM proactive_actions
           WHERE user_id = $1 AND status = 'completed' AND completed_at >= $2
           ORDER BY completed_at DESC`,
          [userUuid, windowStart]
        );

        const rows = res.rows;
        const lastProactiveAt = rows.length > 0 && rows[0].completedAt ? new Date(rows[0].completedAt) : undefined;
        const proactiveCountInRollingWindow = rows.length;
        const recentOpportunities = rows.map((r: any) => `${r.candidateType}:${r.topic || 'general'}`);

        return {
          lastProactiveAt,
          proactiveCountInRollingWindow,
          recentOpportunities,
        };
      } catch (err: any) {
        logger.warn('Failed to query proactive history from database, using in-memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const userActions = Array.from(this.inMemoryActions.values()).filter(
      (a) => a.userId === userId && a.status === 'completed' && a.completedAt && a.completedAt >= windowStart
    );
    userActions.sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0));

    const lastProactiveAt = userActions.length > 0 ? userActions[0].completedAt : undefined;
    const proactiveCountInRollingWindow = userActions.length;
    const recentOpportunities = userActions.map((a) => `${a.candidateType}:${a.topic || 'general'}`);

    return {
      lastProactiveAt: lastProactiveAt || undefined,
      proactiveCountInRollingWindow,
      recentOpportunities,
    };
  }

  /**
   * Helper for tests to reset in-memory state.
   */
  public clearInMemory(): void {
    this.inMemoryActions.clear();
  }
}
