/**
 * Proactive Dispatch Log & Engagement Repository (Phases 7.4 & 7.5)
 *
 * Provides persistent, concurrency-safe dispatch logging with unique idempotency keys,
 * monotonic webhook status transitions, user response attribution, and engagement auditing.
 * Backed by PostgreSQL with a fast in-memory fallback for unit testing.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../../database/connection';
import { logger } from '../../core/logger';
import { CreateDispatchLogInput, ProactiveDispatchLogEntity } from './types';
import {
  RECEIPT_STATUS_RANK,
  ProactiveEngagementEntity,
  CreateEngagementInput,
} from './receipt_types';
import { toDeterministicUuid } from '../proactive/proactive_action.repo';

export function generateIdempotencyKey(
  actionId: string,
  deliveryMode: string,
  payloadType: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${actionId}:${deliveryMode}:${payloadType}`)
    .digest('hex');
}

export class ProactiveDispatchRepository {
  private static sharedInMemoryLogs: Map<string, ProactiveDispatchLogEntity> = new Map();
  private static sharedInMemoryEngagements: Map<string, ProactiveEngagementEntity> = new Map();

  private inMemoryLogs: Map<string, ProactiveDispatchLogEntity> = ProactiveDispatchRepository.sharedInMemoryLogs;
  private inMemoryEngagements: Map<string, ProactiveEngagementEntity> = ProactiveDispatchRepository.sharedInMemoryEngagements;
  private schemaMigrated = false;

  public static clearInMemory(): void {
    ProactiveDispatchRepository.sharedInMemoryLogs.clear();
    ProactiveDispatchRepository.sharedInMemoryEngagements.clear();
  }

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaMigrated) return;
    const pool = this.db.getPool();
    if (pool) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS proactive_dispatch_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            action_id UUID NOT NULL REFERENCES proactive_actions(id) ON DELETE CASCADE,
            idempotency_key VARCHAR(128) NOT NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            delivery_mode VARCHAR(50) NOT NULL,
            channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
            payload_type VARCHAR(50) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            provider_message_id VARCHAR(255),
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            sent_at TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            metadata JSONB DEFAULT '{}'::jsonb,
            delivered_at TIMESTAMP WITH TIME ZONE,
            read_at TIMESTAMP WITH TIME ZONE,
            failed_at TIMESTAMP WITH TIME ZONE,
            provider_status VARCHAR(50),
            provider_error_code VARCHAR(50),
            provider_error_message TEXT,
            responded_at TIMESTAMP WITH TIME ZONE,
            responded_message_id VARCHAR(255),
            conversation_id VARCHAR(255),
            CONSTRAINT uq_proactive_dispatch_idempotency UNIQUE (idempotency_key)
          );
          CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_action 
            ON proactive_dispatch_log (action_id);
          CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_user 
            ON proactive_dispatch_log (user_id);
          CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_status 
            ON proactive_dispatch_log (status);
          CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_provider_msg 
            ON proactive_dispatch_log (provider_message_id);
          CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_responded 
            ON proactive_dispatch_log (responded_at);

          CREATE TABLE IF NOT EXISTS proactive_engagement (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            dispatch_id UUID NOT NULL REFERENCES proactive_dispatch_log(id) ON DELETE CASCADE,
            action_id UUID REFERENCES proactive_actions(id) ON DELETE SET NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            event_type VARCHAR(50) NOT NULL,
            occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            attribution_source VARCHAR(50) NOT NULL DEFAULT 'meta_webhook',
            metadata JSONB DEFAULT '{}'::jsonb,
            CONSTRAINT uq_proactive_engagement_event UNIQUE (dispatch_id, event_type)
          );
          CREATE INDEX IF NOT EXISTS idx_proactive_engagement_action ON proactive_engagement (action_id);
          CREATE INDEX IF NOT EXISTS idx_proactive_engagement_user ON proactive_engagement (user_id);
          CREATE INDEX IF NOT EXISTS idx_proactive_engagement_event ON proactive_engagement (event_type);
          CREATE INDEX IF NOT EXISTS idx_proactive_engagement_occurred ON proactive_engagement (occurred_at);
        `);
        this.schemaMigrated = true;
      } catch (err: any) {
        logger.debug('Proactive dispatch log schema ensure skipped or present', { error: err.message });
      }
    }
  }

  public async createOrGet(input: CreateDispatchLogInput): Promise<ProactiveDispatchLogEntity> {
    await this.ensureSchema();
    const idempotencyKey = input.idempotencyKey;
    const channel = input.channel || 'whatsapp';
    const metadata = input.metadata || {};
    const conversationId = input.conversationId || (metadata.conversationId as string) || null;

    const pool = this.db.getPool();
    if (pool) {
      try {
        const actionUuid = toDeterministicUuid(input.actionId);
        const userUuid = toDeterministicUuid(input.userId);

        const query = `
          INSERT INTO proactive_dispatch_log (
            action_id, idempotency_key, user_id, delivery_mode, channel,
            payload_type, status, conversation_id, metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, NOW(), NOW())
          ON CONFLICT (idempotency_key) DO UPDATE 
            SET updated_at = NOW()
          RETURNING 
            id, action_id as "actionId", idempotency_key as "idempotencyKey",
            user_id as "userId", delivery_mode as "deliveryMode", channel,
            payload_type as "payloadType", status, provider_message_id as "providerMessageId",
            attempt_count as "attemptCount", last_error as "lastError",
            created_at as "createdAt", sent_at as "sentAt", updated_at as "updatedAt",
            delivered_at as "deliveredAt", read_at as "readAt", failed_at as "failedAt",
            provider_status as "providerStatus", provider_error_code as "providerErrorCode",
            provider_error_message as "providerErrorMessage", responded_at as "respondedAt",
            responded_message_id as "respondedMessageId", conversation_id as "conversationId",
            metadata
        `;
        const res = await pool.query(query, [
          actionUuid,
          idempotencyKey,
          userUuid,
          input.deliveryMode,
          channel,
          input.payloadType,
          conversationId,
          JSON.stringify(metadata),
        ]);
        if (res.rows.length > 0) {
          return {
            ...res.rows[0],
            actionId: input.actionId,
            userId: input.userId,
          };
        }
      } catch (err: any) {
        logger.warn('Failed to insert dispatch log into database, using in-memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const existing = this.inMemoryLogs.get(idempotencyKey);
    if (existing) {
      existing.updatedAt = new Date();
      return existing;
    }

    const newRecord: ProactiveDispatchLogEntity = {
      id: uuidv4(),
      actionId: input.actionId,
      idempotencyKey,
      userId: input.userId,
      deliveryMode: input.deliveryMode,
      channel,
      payloadType: input.payloadType,
      status: 'pending',
      attemptCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      conversationId: conversationId || undefined,
      metadata,
    };
    this.inMemoryLogs.set(idempotencyKey, newRecord);
    return newRecord;
  }

  public async markSending(idempotencyKey: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_dispatch_log 
           SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW() 
           WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark dispatch sending in DB', { error: err.message });
      }
    }
    const item = this.inMemoryLogs.get(idempotencyKey);
    if (item) {
      item.status = 'sending';
      item.attemptCount += 1;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markSent(idempotencyKey: string, providerMessageId: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_dispatch_log 
           SET status = 'sent', provider_message_id = $1, sent_at = NOW(), updated_at = NOW() 
           WHERE idempotency_key = $2`,
          [providerMessageId, idempotencyKey]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark dispatch sent in DB', { error: err.message });
      }
    }
    const item = this.inMemoryLogs.get(idempotencyKey);
    if (item) {
      item.status = 'sent';
      item.providerMessageId = providerMessageId;
      item.sentAt = new Date();
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markFailed(idempotencyKey: string, errorMsg: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_dispatch_log 
           SET status = 'failed', last_error = $1, updated_at = NOW() 
           WHERE idempotency_key = $2`,
          [errorMsg, idempotencyKey]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark dispatch failed in DB', { error: err.message });
      }
    }
    const item = this.inMemoryLogs.get(idempotencyKey);
    if (item) {
      item.status = 'failed';
      item.lastError = errorMsg;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markUnknown(idempotencyKey: string, errorMsg: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_dispatch_log 
           SET status = 'unknown', last_error = $1, updated_at = NOW() 
           WHERE idempotency_key = $2`,
          [errorMsg, idempotencyKey]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark dispatch unknown in DB', { error: err.message });
      }
    }
    const item = this.inMemoryLogs.get(idempotencyKey);
    if (item) {
      item.status = 'unknown';
      item.lastError = errorMsg;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async markSuppressed(idempotencyKey: string, reason: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_dispatch_log 
           SET status = 'suppressed', last_error = $1, updated_at = NOW() 
           WHERE idempotency_key = $2`,
          [reason, idempotencyKey]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark dispatch suppressed in DB', { error: err.message });
      }
    }
    const item = this.inMemoryLogs.get(idempotencyKey);
    if (item) {
      item.status = 'suppressed';
      item.lastError = reason;
      item.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public async findByIdempotencyKey(key: string): Promise<ProactiveDispatchLogEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, action_id as "actionId", idempotency_key as "idempotencyKey",
                  user_id as "userId", delivery_mode as "deliveryMode", channel,
                  payload_type as "payloadType", status, provider_message_id as "providerMessageId",
                  attempt_count as "attemptCount", last_error as "lastError",
                  created_at as "createdAt", sent_at as "sentAt", updated_at as "updatedAt",
                  delivered_at as "deliveredAt", read_at as "readAt", failed_at as "failedAt",
                  provider_status as "providerStatus", provider_error_code as "providerErrorCode",
                  provider_error_message as "providerErrorMessage", responded_at as "respondedAt",
                  responded_message_id as "respondedMessageId", conversation_id as "conversationId",
                  metadata
           FROM proactive_dispatch_log WHERE idempotency_key = $1 LIMIT 1`,
          [key]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to find dispatch log by idempotency key', { error: err.message });
      }
    }
    return this.inMemoryLogs.get(key) || null;
  }

  public async findById(id: string): Promise<ProactiveDispatchLogEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, action_id as "actionId", idempotency_key as "idempotencyKey",
                  user_id as "userId", delivery_mode as "deliveryMode", channel,
                  payload_type as "payloadType", status, provider_message_id as "providerMessageId",
                  attempt_count as "attemptCount", last_error as "lastError",
                  created_at as "createdAt", sent_at as "sentAt", updated_at as "updatedAt",
                  delivered_at as "deliveredAt", read_at as "readAt", failed_at as "failedAt",
                  provider_status as "providerStatus", provider_error_code as "providerErrorCode",
                  provider_error_message as "providerErrorMessage", responded_at as "respondedAt",
                  responded_message_id as "respondedMessageId", conversation_id as "conversationId",
                  metadata
           FROM proactive_dispatch_log WHERE id = $1 LIMIT 1`,
          [id]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to find dispatch log by id', { error: err.message });
      }
    }
    for (const log of this.inMemoryLogs.values()) {
      if (log.id === id) return log;
    }
    return null;
  }

  /**
   * Finds a proactive dispatch log by Meta provider_message_id (wamid).
   */
  public async findByProviderMessageId(providerMessageId: string): Promise<ProactiveDispatchLogEntity | null> {
    if (!providerMessageId) return null;
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, action_id as "actionId", idempotency_key as "idempotencyKey",
                  user_id as "userId", delivery_mode as "deliveryMode", channel,
                  payload_type as "payloadType", status, provider_message_id as "providerMessageId",
                  attempt_count as "attemptCount", last_error as "lastError",
                  created_at as "createdAt", sent_at as "sentAt", updated_at as "updatedAt",
                  delivered_at as "deliveredAt", read_at as "readAt", failed_at as "failedAt",
                  provider_status as "providerStatus", provider_error_code as "providerErrorCode",
                  provider_error_message as "providerErrorMessage", responded_at as "respondedAt",
                  responded_message_id as "respondedMessageId", conversation_id as "conversationId",
                  metadata
           FROM proactive_dispatch_log WHERE provider_message_id = $1 LIMIT 1`,
          [providerMessageId]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to find dispatch log by provider message id', { error: err.message });
      }
    }
    for (const log of this.inMemoryLogs.values()) {
      if (log.providerMessageId === providerMessageId) {
        return log;
      }
    }
    return null;
  }

  /**
   * Monotonically records receipt status updates from Meta WhatsApp webhook receipts.
   * Enforces strict state precedence: pending < sending < sent < delivered < read.
   * Out-of-order receipt deliveries will update timestamp columns without regressing the status.
   */
  public async updateReceiptStatus(input: {
    providerMessageId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: Date;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<{ updated: boolean; log: ProactiveDispatchLogEntity | null; previousStatus?: string }> {
    const log = await this.findByProviderMessageId(input.providerMessageId);
    if (!log) {
      return { updated: false, log: null };
    }

    const previousStatus = log.status;
    const currentRank = RECEIPT_STATUS_RANK[log.status] ?? 0;
    const incomingRank = RECEIPT_STATUS_RANK[input.status] ?? -1;

    let targetStatus = log.status;
    let deliveredAt = log.deliveredAt;
    let readAt = log.readAt;
    let failedAt = log.failedAt;
    let providerStatus = log.providerStatus || log.status;
    let providerErrorCode = log.providerErrorCode;
    let providerErrorMessage = log.providerErrorMessage;
    let lastError = log.lastError;

    if (input.status === 'failed') {
      // Delivered or read messages cannot retroactively fail delivery
      if (log.status !== 'delivered' && log.status !== 'read') {
        targetStatus = 'failed';
        failedAt = input.timestamp;
        providerStatus = 'failed';
      }
      providerErrorCode = input.errorCode || providerErrorCode;
      providerErrorMessage = input.errorMessage || providerErrorMessage;
      lastError = input.errorMessage || lastError;
    } else {
      // Monotonic progression for sent, delivered, read
      if (input.status === 'delivered') {
        deliveredAt = deliveredAt || input.timestamp;
      } else if (input.status === 'read') {
        readAt = readAt || input.timestamp;
      }

      if (incomingRank > currentRank) {
        targetStatus = input.status;
        providerStatus = input.status;
      }
    }

    // Persist to PostgreSQL if available
    const pool = this.db.getPool();
    if (pool) {
      try {
        await pool.query(
          `UPDATE proactive_dispatch_log
           SET status = $1,
               delivered_at = $2,
               read_at = $3,
               failed_at = $4,
               provider_status = $5,
               provider_error_code = $6,
               provider_error_message = $7,
               last_error = $8,
               updated_at = NOW()
           WHERE id = $9`,
          [
            targetStatus,
            deliveredAt || null,
            readAt || null,
            failedAt || null,
            providerStatus,
            providerErrorCode || null,
            providerErrorMessage || null,
            lastError || null,
            log.id,
          ]
        );
      } catch (err: any) {
        logger.warn('Failed to update dispatch receipt in DB', { error: err.message });
      }
    }

    // Update in-memory copy
    log.status = targetStatus as any;
    log.deliveredAt = deliveredAt;
    log.readAt = readAt;
    log.failedAt = failedAt;
    log.providerStatus = providerStatus;
    log.providerErrorCode = providerErrorCode;
    log.providerErrorMessage = providerErrorMessage;
    log.lastError = lastError;
    log.updatedAt = new Date();

    return { updated: true, log, previousStatus };
  }

  /**
   * Records a distinct proactive engagement event (sent, delivered, read, failed, user_replied)
   * with unique deduplication on (dispatch_id, event_type).
   */
  public async recordEngagement(input: CreateEngagementInput): Promise<ProactiveEngagementEntity | null> {
    await this.ensureSchema();
    const eventId = uuidv4();
    const occurredAt = input.occurredAt || new Date();
    const attributionSource = input.attributionSource || 'meta_webhook';
    const metadata = input.metadata || {};

    const pool = this.db.getPool();
    if (pool) {
      try {
        const actionUuid = input.actionId ? toDeterministicUuid(input.actionId) : null;
        const userUuid = toDeterministicUuid(input.userId);

        const res = await pool.query(
          `INSERT INTO proactive_engagement (
            id, dispatch_id, action_id, user_id, event_type, occurred_at, attribution_source, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (dispatch_id, event_type) DO NOTHING
          RETURNING id, dispatch_id as "dispatchId", action_id as "actionId", user_id as "userId",
                    event_type as "eventType", occurred_at as "occurredAt",
                    attribution_source as "attributionSource", metadata`,
          [
            eventId,
            input.dispatchId,
            actionUuid,
            userUuid,
            input.eventType,
            occurredAt,
            attributionSource,
            JSON.stringify(metadata),
          ]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        logger.warn('Failed to record proactive engagement in DB, falling back to in-memory', {
          error: err.message,
        });
      }
    }

    // In-memory deduplication and persistence
    const dedupKey = `${input.dispatchId}:${input.eventType}`;
    const existing = this.inMemoryEngagements.get(dedupKey);
    if (existing) {
      return existing;
    }

    const newRecord: ProactiveEngagementEntity = {
      id: eventId,
      dispatchId: input.dispatchId,
      actionId: input.actionId || null,
      userId: input.userId,
      eventType: input.eventType,
      occurredAt,
      attributionSource,
      metadata,
    };
    this.inMemoryEngagements.set(dedupKey, newRecord);
    return newRecord;
  }

  /**
   * Retrieves all engagement events for a dispatch.
   */
  public async getEngagementsForDispatch(dispatchId: string): Promise<ProactiveEngagementEntity[]> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, dispatch_id as "dispatchId", action_id as "actionId", user_id as "userId",
                  event_type as "eventType", occurred_at as "occurredAt",
                  attribution_source as "attributionSource", metadata
           FROM proactive_engagement
           WHERE dispatch_id = $1
           ORDER BY occurred_at ASC`,
          [dispatchId]
        );
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to fetch engagements from DB', { error: err.message });
      }
    }

    const results: ProactiveEngagementEntity[] = [];
    for (const eng of this.inMemoryEngagements.values()) {
      if (eng.dispatchId === dispatchId) {
        results.push(eng);
      }
    }
    return results.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  /**
   * Finds the latest eligible proactive dispatch log for a user to attribute an inbound message.
   * Matches userId, status (sent/delivered/read), unresponded, within window, and conversationId.
   */
  public async findLatestAttributableDispatch(
    userId: string,
    conversationId?: string,
    windowStart?: Date
  ): Promise<ProactiveDispatchLogEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const userUuid = toDeterministicUuid(userId);
        const res = await pool.query(
          `SELECT id, action_id as "actionId", idempotency_key as "idempotencyKey",
                  user_id as "userId", delivery_mode as "deliveryMode", channel,
                  payload_type as "payloadType", status, provider_message_id as "providerMessageId",
                  attempt_count as "attemptCount", last_error as "lastError",
                  created_at as "createdAt", sent_at as "sentAt", updated_at as "updatedAt",
                  delivered_at as "deliveredAt", read_at as "readAt", failed_at as "failedAt",
                  provider_status as "providerStatus", provider_error_code as "providerErrorCode",
                  provider_error_message as "providerErrorMessage", responded_at as "respondedAt",
                  responded_message_id as "respondedMessageId", conversation_id as "conversationId",
                  metadata
           FROM proactive_dispatch_log
           WHERE user_id = $1
             AND status IN ('sent', 'delivered', 'read')
             AND responded_at IS NULL
             AND ($2::timestamptz IS NULL OR sent_at >= $2)
             AND (
               $3::varchar IS NULL 
               OR conversation_id = $3 
               OR (metadata->>'conversationId') = $3
               OR conversation_id IS NULL
             )
           ORDER BY sent_at DESC NULLS LAST, created_at DESC
           LIMIT 1`,
          [userUuid, windowStart || null, conversationId || null]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to find latest attributable dispatch in DB', { error: err.message });
      }
    }

    // In-memory fallback
    const eligible: ProactiveDispatchLogEntity[] = [];
    for (const log of this.inMemoryLogs.values()) {
      if (log.userId !== userId) continue;
      if (!['sent', 'delivered', 'read'].includes(log.status)) continue;
      if (log.respondedAt) continue;

      const sentTime = log.sentAt ? log.sentAt.getTime() : log.createdAt.getTime();
      if (windowStart && sentTime < windowStart.getTime()) continue;

      const logConvId = log.conversationId || (log.metadata?.conversationId as string);
      if (conversationId && logConvId && logConvId !== conversationId) continue;

      eligible.push(log);
    }

    if (eligible.length === 0) return null;

    eligible.sort((a, b) => {
      const timeA = a.sentAt ? a.sentAt.getTime() : a.createdAt.getTime();
      const timeB = b.sentAt ? b.sentAt.getTime() : b.createdAt.getTime();
      return timeB - timeA;
    });

    return eligible[0];
  }

  /**
   * Marks a dispatch log as responded to by an inbound user reply.
   */
  public async markResponded(
    dispatchId: string,
    respondedAt: Date,
    respondedMessageId?: string
  ): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE proactive_dispatch_log
           SET responded_at = $1, responded_message_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [respondedAt, respondedMessageId || null, dispatchId]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to mark dispatch responded in DB', { error: err.message });
      }
    }

    for (const log of this.inMemoryLogs.values()) {
      if (log.id === dispatchId) {
        log.respondedAt = respondedAt;
        log.respondedMessageId = respondedMessageId || null;
        log.updatedAt = new Date();
        return true;
      }
    }
    return false;
  }

  /**
   * Lists dispatch logs with optional status, userId filters, and pagination.
   */
  public async listDispatchLogs(options: {
    status?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: ProactiveDispatchLogEntity[]; total: number }> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];
        let pIdx = 1;

        if (options.status) {
          whereClauses.push(`status = $${pIdx}`);
          params.push(options.status);
          pIdx++;
        }
        if (options.userId) {
          const userUuid = toDeterministicUuid(options.userId);
          whereClauses.push(`user_id = $${pIdx}`);
          params.push(userUuid);
          pIdx++;
        }

        const whereSql = whereClauses.join(' AND ');
        const countRes = await pool.query(
          `SELECT COUNT(*) as total FROM proactive_dispatch_log WHERE ${whereSql}`,
          params
        );
        const total = parseInt(countRes.rows[0]?.total || '0', 10);

        const listQuery = `
          SELECT id, user_id as "userId", action_id as "actionId",
                 candidate_type as "candidateType", message_text as "messageText",
                 idempotency_key as "idempotencyKey", status,
                 provider_message_id as "providerMessageId", error_message as "errorMessage",
                 receipt_status as "receiptStatus", delivered_at as "deliveredAt",
                 read_at as "readAt", responded_at as "respondedAt",
                 responded_message_id as "respondedMessageId", metadata,
                 created_at as "createdAt", updated_at as "updatedAt"
          FROM proactive_dispatch_log
          WHERE ${whereSql}
          ORDER BY created_at DESC
          LIMIT $${pIdx} OFFSET $${pIdx + 1}
        `;
        params.push(limit, offset);

        const listRes = await pool.query(listQuery, params);
        return { items: listRes.rows, total };
      } catch (err: any) {
        logger.warn('Failed to list proactive dispatch logs from database', { error: err.message });
      }
    }

    let all = Array.from(this.inMemoryLogs.values());
    if (options.status) all = all.filter(l => l.status === options.status);
    if (options.userId) {
      const userUuid = toDeterministicUuid(options.userId);
      all = all.filter(l => l.userId === userUuid || l.userId === options.userId);
    }
    const total = all.length;
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: all.slice(offset, offset + limit), total };
  }

  /**
   * Lists engagement records with pagination.
   */
  public async listEngagements(options: {
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: ProactiveEngagementEntity[]; total: number }> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const countRes = await pool.query(`SELECT COUNT(*) as total FROM proactive_engagement`);
        const total = parseInt(countRes.rows[0]?.total || '0', 10);

        const listQuery = `
          SELECT id, dispatch_id as "dispatchId", action_id as "actionId",
                 user_id as "userId", event_type as "eventType",
                 occurred_at as "occurredAt", attribution_source as "attributionSource",
                 metadata
          FROM proactive_engagement
          ORDER BY occurred_at DESC
          LIMIT $1 OFFSET $2
        `;
        const listRes = await pool.query(listQuery, [limit, offset]);
        return { items: listRes.rows, total };
      } catch (err: any) {
        logger.warn('Failed to list proactive engagements from database', { error: err.message });
      }
    }

    const all = Array.from(this.inMemoryEngagements.values());
    const total = all.length;
    all.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return { items: all.slice(offset, offset + limit), total };
  }

  public clearInMemory(): void {
    this.inMemoryLogs.clear();
    this.inMemoryEngagements.clear();
  }
}
