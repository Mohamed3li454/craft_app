import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { logger } from '../../core/logger';
import {
  ReviewEvent,
  CreateReviewEventDto,
  ReviewAction,
} from './semantic_candidate.types';

export class SemanticReviewAuditRepository {
  private inMemoryEvents: ReviewEvent[] = [];

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  /**
   * Strictly append-only record of candidate review events.
   * NEVER stores raw conversational text, user identifiers, or secrets.
   */
  public async recordEvent(dto: CreateReviewEventDto): Promise<ReviewEvent> {
    const id = uuidv4();
    const candidateId = dto.candidateId;
    const action = dto.action;
    const actorId = dto.actorId ? dto.actorId.trim() : null;
    const reason = dto.reason ? dto.reason.trim() : null;
    const previousStatus = dto.previousStatus || null;
    const newStatus = dto.newStatus || null;
    const previousEligibility = dto.previousEligibility !== undefined ? dto.previousEligibility : null;
    const newEligibility = dto.newEligibility !== undefined ? dto.newEligibility : null;
    const metadata = dto.metadata || {};

    const pool = this.db.getPool();
    if (pool) {
      const res = await pool.query(
        `INSERT INTO semantic_cache_review_events (
          id, candidate_id, action, actor_id, reason,
          previous_status, new_status, previous_eligibility, new_eligibility,
          metadata, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
        ) RETURNING *`,
        [
          id,
          candidateId,
          action,
          actorId,
          reason,
          previousStatus,
          newStatus,
          previousEligibility,
          newEligibility,
          JSON.stringify(metadata),
        ]
      );
      return this.mapRowToEvent(res.rows[0]);
    }

    const event: ReviewEvent = {
      id,
      candidateId,
      action,
      actorId,
      reason,
      previousStatus,
      newStatus,
      previousEligibility,
      newEligibility,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.inMemoryEvents.push(event);
    return event;
  }

  public async listEvents(
    candidateId?: string,
    filter?: { limit?: number; offset?: number; action?: ReviewAction }
  ): Promise<ReviewEvent[]> {
    const limit = Math.max(1, Math.min(filter?.limit || 50, 100));
    const offset = Math.max(0, filter?.offset || 0);

    const pool = this.db.getPool();
    if (pool) {
      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (candidateId) {
        conditions.push(`candidate_id = $${idx++}`);
        values.push(candidateId);
      }
      if (filter?.action) {
        conditions.push(`action = $${idx++}`);
        values.push(filter.action);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(limit);
      const limitParam = `$${idx++}`;
      values.push(offset);
      const offsetParam = `$${idx++}`;

      const res = await pool.query(
        `SELECT * FROM semantic_cache_review_events ${whereClause} ORDER BY created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
        values
      );
      return res.rows.map((r) => this.mapRowToEvent(r));
    }

    let items = [...this.inMemoryEvents];
    if (candidateId) {
      items = items.filter((e) => e.candidateId === candidateId);
    }
    if (filter?.action) {
      items = items.filter((e) => e.action === filter.action);
    }
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items.slice(offset, offset + limit);
  }

  public async countEvents(candidateId?: string): Promise<number> {
    const pool = this.db.getPool();
    if (pool) {
      const query = candidateId
        ? `SELECT COUNT(*) as count FROM semantic_cache_review_events WHERE candidate_id = $1`
        : `SELECT COUNT(*) as count FROM semantic_cache_review_events`;
      const values = candidateId ? [candidateId] : [];
      const res = await pool.query(query, values);
      return parseInt(res.rows[0]?.count || '0', 10);
    }

    if (candidateId) {
      return this.inMemoryEvents.filter((e) => e.candidateId === candidateId).length;
    }
    return this.inMemoryEvents.length;
  }

  public clearInMemory(): void {
    this.inMemoryEvents = [];
  }

  private mapRowToEvent(r: any): ReviewEvent {
    return {
      id: r.id,
      candidateId: r.candidate_id,
      action: r.action as ReviewAction,
      actorId: r.actor_id || null,
      reason: r.reason || null,
      previousStatus: r.previous_status || null,
      newStatus: r.new_status || null,
      previousEligibility: r.previous_eligibility !== null && r.previous_eligibility !== undefined ? r.previous_eligibility : null,
      newEligibility: r.new_eligibility !== null && r.new_eligibility !== undefined ? r.new_eligibility : null,
      metadata: typeof r.metadata === 'object' && r.metadata !== null ? r.metadata : {},
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    };
  }
}
