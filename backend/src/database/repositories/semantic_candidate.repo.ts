import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { logger } from '../../core/logger';
import {
  CandidateStatus,
  EligibilityReason,
  SemanticCacheCandidate,
  CreateCandidateDto,
  UpdateCandidateEvidenceDto,
  ListCandidatesFilter,
} from './semantic_candidate.types';

export const MAX_PAGE_SIZE = 100;

export class SemanticCandidateRepository {
  private inMemoryItems: Map<string, SemanticCacheCandidate> = new Map();
  private schemaChecked = false;

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;

    try {
      // 1. Create table if not exists (Migration 002)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS semantic_cache_candidates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          intent VARCHAR(100) NOT NULL,
          category VARCHAR(100) NOT NULL DEFAULT 'custom',
          input_examples TEXT[] NOT NULL DEFAULT '{}',
          response TEXT NOT NULL,
          response_strategy VARCHAR(50) NOT NULL DEFAULT 'static',
          response_templates JSONB NOT NULL DEFAULT '{}'::jsonb,
          language VARCHAR(10) NOT NULL DEFAULT 'default',
          source_model VARCHAR(100),
          source_provider VARCHAR(50),
          source_run_id VARCHAR(100),
          confidence REAL NOT NULL DEFAULT 0.0,
          eligibility_reason VARCHAR(50) NOT NULL DEFAULT 'static_reusable',
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected', 'promoted')),
          rejection_reason TEXT,
          promoted_faq_id UUID REFERENCES faq_items(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          validated_at TIMESTAMP WITH TIME ZONE,
          promoted_at TIMESTAMP WITH TIME ZONE
        );
      `);

      // 2. Add Phase 6 Evidence Model columns safely (Migration 003)
      await pool.query(`
        ALTER TABLE semantic_cache_candidates
          ADD COLUMN IF NOT EXISTS observation_count INT NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS unique_example_count INT NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS first_observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS last_observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS validation_count INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS rejection_count INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS safety_violation_count INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS duplicate_count INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS conflict_count INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS semantic_consistency REAL,
          ADD COLUMN IF NOT EXISTS promotion_eligible BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS promotion_reasons TEXT[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS promotion_blockers TEXT[] NOT NULL DEFAULT '{}';
      `);

      // 3. Phase 7: Create Review Audit and Metrics Tables (Migration 004)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS semantic_cache_review_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          candidate_id UUID NOT NULL REFERENCES semantic_cache_candidates(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          actor_id VARCHAR(100),
          reason TEXT,
          previous_status VARCHAR(20),
          new_status VARCHAR(20),
          previous_eligibility BOOLEAN,
          new_eligibility BOOLEAN,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS semantic_cache_metrics_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_type VARCHAR(50) NOT NULL,
          source VARCHAR(50),
          intent VARCHAR(100),
          language VARCHAR(10),
          similarity REAL,
          threshold REAL,
          reason VARCHAR(100),
          latency_ms INT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_status ON semantic_cache_candidates(status);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_intent ON semantic_cache_candidates(intent);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON semantic_cache_candidates(created_at DESC);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_last_observed_at ON semantic_cache_candidates(last_observed_at DESC);`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_candidates_promotion_eligible 
        ON semantic_cache_candidates(promotion_eligible, status) 
        WHERE promotion_eligible = true;
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_status_created ON semantic_cache_candidates(status, created_at DESC);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_confidence ON semantic_cache_candidates(confidence DESC);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_language ON semantic_cache_candidates(language);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_events_candidate_id ON semantic_cache_review_events(candidate_id, created_at DESC);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_events_action ON semantic_cache_review_events(action, created_at DESC);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_metrics_events_type_created ON semantic_cache_metrics_events(event_type, created_at DESC);`);

      // Trigger for strict audit immutability
      await pool.query(`
        CREATE OR REPLACE FUNCTION prevent_review_events_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
          IF current_setting('app.allow_audit_cleanup', true) = 'true' THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION 'semantic_cache_review_events is strictly append-only. UPDATE and DELETE operations are forbidden.';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_prevent_review_events_mutation ON semantic_cache_review_events;
        CREATE TRIGGER trg_prevent_review_events_mutation
        BEFORE UPDATE OR DELETE ON semantic_cache_review_events
        FOR EACH ROW EXECUTE FUNCTION prevent_review_events_mutation();
      `);

      this.schemaChecked = true;
      logger.info('SemanticCandidateRepository schema ensured successfully with Phase 7 audit support');
    } catch (err: any) {
      logger.error('Failed to ensure semantic_cache_candidates schema in PostgreSQL', { error: err.message });
      throw err;
    }
  }

  public async create(dto: CreateCandidateDto): Promise<SemanticCacheCandidate> {
    const id = uuidv4();
    const intent = dto.intent.trim();
    const category = (dto.category || 'custom').trim();
    const inputExamples = (dto.inputExamples || []).map((e) => e.trim()).filter(Boolean);
    const response = dto.response.trim();
    const responseStrategy = dto.responseStrategy || 'static';
    const responseTemplates = dto.responseTemplates || { default: [response] };
    const language = (dto.language || 'default').trim();
    const sourceModel = dto.sourceModel ? dto.sourceModel.trim() : null;
    const sourceProvider = dto.sourceProvider ? dto.sourceProvider.trim() : null;
    const sourceRunId = dto.sourceRunId ? dto.sourceRunId.trim() : null;
    const confidence = dto.confidence !== undefined ? dto.confidence : 0.0;
    const eligibilityReason: EligibilityReason = dto.eligibilityReason || 'static_reusable';
    const status: CandidateStatus = dto.status || 'pending';
    const rejectionReason = dto.rejectionReason ? dto.rejectionReason.trim() : null;

    // Phase 6 Evidence fields
    const observationCount = dto.observationCount !== undefined ? dto.observationCount : 1;
    const uniqueExampleCount = dto.uniqueExampleCount !== undefined ? dto.uniqueExampleCount : inputExamples.length || 1;
    const firstObservedAt = dto.firstObservedAt || new Date().toISOString();
    const lastObservedAt = dto.lastObservedAt || new Date().toISOString();
    const validationCount = dto.validationCount !== undefined ? dto.validationCount : 0;
    const rejectionCount = dto.rejectionCount !== undefined ? dto.rejectionCount : 0;
    const safetyViolationCount = dto.safetyViolationCount !== undefined ? dto.safetyViolationCount : 0;
    const duplicateCount = dto.duplicateCount !== undefined ? dto.duplicateCount : 0;
    const conflictCount = dto.conflictCount !== undefined ? dto.conflictCount : 0;
    const semanticConsistency = dto.semanticConsistency !== undefined ? dto.semanticConsistency : null;
    const promotionEligible = dto.promotionEligible !== undefined ? dto.promotionEligible : false;
    const promotionReasons = dto.promotionReasons || [];
    const promotionBlockers = dto.promotionBlockers || [];

    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(
        `INSERT INTO semantic_cache_candidates (
          id, intent, category, input_examples, response,
          response_strategy, response_templates, language,
          source_model, source_provider, source_run_id,
          confidence, eligibility_reason, status, rejection_reason,
          observation_count, unique_example_count, first_observed_at, last_observed_at,
          validation_count, rejection_count, safety_violation_count, duplicate_count, conflict_count,
          semantic_consistency, promotion_eligible, promotion_reasons, promotion_blockers,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
          NOW(), NOW()
        ) RETURNING *`,
        [
          id,
          intent,
          category,
          inputExamples,
          response,
          responseStrategy,
          JSON.stringify(responseTemplates),
          language,
          sourceModel,
          sourceProvider,
          sourceRunId,
          confidence,
          eligibilityReason,
          status,
          rejectionReason,
          observationCount,
          uniqueExampleCount,
          firstObservedAt,
          lastObservedAt,
          validationCount,
          rejectionCount,
          safetyViolationCount,
          duplicateCount,
          conflictCount,
          semanticConsistency,
          promotionEligible,
          promotionReasons,
          promotionBlockers,
        ]
      );
      return this.mapRowToCandidate(res.rows[0]);
    }

    const now = new Date().toISOString();
    const candidate: SemanticCacheCandidate = {
      id,
      intent,
      category,
      inputExamples,
      response,
      responseStrategy,
      responseTemplates,
      language,
      sourceModel,
      sourceProvider,
      sourceRunId,
      confidence,
      eligibilityReason,
      status,
      rejectionReason,
      promotedFaqId: null,
      observationCount,
      uniqueExampleCount,
      firstObservedAt,
      lastObservedAt,
      validationCount,
      rejectionCount,
      safetyViolationCount,
      duplicateCount,
      conflictCount,
      semanticConsistency,
      promotionEligible,
      promotionReasons,
      promotionBlockers,
      createdAt: now,
      updatedAt: now,
      validatedAt: null,
      promotedAt: null,
    };
    this.inMemoryItems.set(id, candidate);
    return candidate;
  }

  public async findById(id: string): Promise<SemanticCacheCandidate | null> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(`SELECT * FROM semantic_cache_candidates WHERE id = $1`, [id]);
      if (res.rows.length === 0) return null;
      return this.mapRowToCandidate(res.rows[0]);
    }
    return this.inMemoryItems.get(id) || null;
  }

  public async findByIntent(intent: string): Promise<SemanticCacheCandidate[]> {
    if (!intent) return [];
    const clean = intent.trim().toLowerCase();

    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(
        `SELECT * FROM semantic_cache_candidates WHERE LOWER(intent) = $1 ORDER BY created_at DESC`,
        [clean]
      );
      return res.rows.map((r) => this.mapRowToCandidate(r));
    }

    const matches: SemanticCacheCandidate[] = [];
    for (const c of this.inMemoryItems.values()) {
      if (c.intent.toLowerCase() === clean) {
        matches.push(c);
      }
    }
    return matches;
  }

  public async list(filter?: ListCandidatesFilter): Promise<SemanticCacheCandidate[]> {
    const limit = Math.max(1, Math.min(filter?.limit || 50, MAX_PAGE_SIZE));
    const offset = Math.max(0, filter?.offset || 0);

    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (filter?.status) {
        conditions.push(`status = $${idx++}`);
        values.push(filter.status);
      }
      if (filter?.promotionEligible !== undefined) {
        conditions.push(`promotion_eligible = $${idx++}`);
        values.push(filter.promotionEligible);
      } else if (filter?.promotionEligibleOnly) {
        conditions.push(`promotion_eligible = true`);
      }
      if (filter?.intent) {
        conditions.push(`LOWER(intent) LIKE $${idx++}`);
        values.push(`%${filter.intent.toLowerCase()}%`);
      }
      if (filter?.category) {
        conditions.push(`category = $${idx++}`);
        values.push(filter.category);
      }
      if (filter?.language) {
        conditions.push(`language = $${idx++}`);
        values.push(filter.language);
      }
      if (filter?.sourceModel) {
        conditions.push(`source_model = $${idx++}`);
        values.push(filter.sourceModel);
      }
      if (filter?.responseStrategy) {
        conditions.push(`response_strategy = $${idx++}`);
        values.push(filter.responseStrategy);
      }
      const fromDate = filter?.from || filter?.createdAfter;
      if (fromDate) {
        conditions.push(`created_at >= $${idx++}`);
        values.push(fromDate);
      }
      const toDate = filter?.to || filter?.createdBefore;
      if (toDate) {
        conditions.push(`created_at <= $${idx++}`);
        values.push(toDate);
      }
      if (filter?.updatedAfter) {
        conditions.push(`updated_at >= $${idx++}`);
        values.push(filter.updatedAfter);
      }
      if (filter?.minConfidence !== undefined) {
        conditions.push(`confidence >= $${idx++}`);
        values.push(filter.minConfidence);
      }
      if (filter?.maxConfidence !== undefined) {
        conditions.push(`confidence <= $${idx++}`);
        values.push(filter.maxConfidence);
      }
      if (filter?.minObservations !== undefined) {
        conditions.push(`observation_count >= $${idx++}`);
        values.push(filter.minObservations);
      }
      if (filter?.hasConflict === true) {
        conditions.push(`conflict_count > 0`);
      } else if (filter?.hasConflict === false) {
        conditions.push(`conflict_count = 0`);
      }
      if (filter?.isStale === true) {
        conditions.push(`last_observed_at <= NOW() - INTERVAL '90 days'`);
      } else if (filter?.isStale === false) {
        conditions.push(`last_observed_at > NOW() - INTERVAL '90 days'`);
      }
      if (filter?.cursor) {
        conditions.push(`created_at < $${idx++}`);
        values.push(filter.cursor);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(limit);
      const limitParam = `$${idx++}`;
      values.push(offset);
      const offsetParam = `$${idx++}`;

      const res = await pool.query(
        `SELECT * FROM semantic_cache_candidates ${whereClause} ORDER BY created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
        values
      );
      return res.rows.map((r) => this.mapRowToCandidate(r));
    }

    let items = Array.from(this.inMemoryItems.values());
    if (filter?.status) {
      items = items.filter((c) => c.status === filter.status);
    }
    if (filter?.promotionEligible !== undefined) {
      items = items.filter((c) => c.promotionEligible === filter.promotionEligible);
    } else if (filter?.promotionEligibleOnly) {
      items = items.filter((c) => c.promotionEligible === true);
    }
    if (filter?.intent) {
      const q = filter.intent.toLowerCase();
      items = items.filter((c) => c.intent.toLowerCase().includes(q));
    }
    if (filter?.category) {
      items = items.filter((c) => c.category === filter.category);
    }
    if (filter?.language) {
      items = items.filter((c) => c.language === filter.language);
    }
    if (filter?.sourceModel) {
      items = items.filter((c) => c.sourceModel === filter.sourceModel);
    }
    if (filter?.responseStrategy) {
      items = items.filter((c) => c.responseStrategy === filter.responseStrategy);
    }
    const fromDate = filter?.from || filter?.createdAfter;
    if (fromDate) {
      const after = new Date(fromDate).getTime();
      items = items.filter((c) => new Date(c.createdAt).getTime() >= after);
    }
    const toDate = filter?.to || filter?.createdBefore;
    if (toDate) {
      const before = new Date(toDate).getTime();
      items = items.filter((c) => new Date(c.createdAt).getTime() <= before);
    }
    if (filter?.updatedAfter) {
      const after = new Date(filter.updatedAfter).getTime();
      items = items.filter((c) => new Date(c.updatedAt).getTime() >= after);
    }
    if (filter?.minConfidence !== undefined) {
      items = items.filter((c) => c.confidence >= filter.minConfidence!);
    }
    if (filter?.maxConfidence !== undefined) {
      items = items.filter((c) => c.confidence <= filter.maxConfidence!);
    }
    if (filter?.minObservations !== undefined) {
      items = items.filter((c) => c.observationCount >= filter.minObservations!);
    }
    if (filter?.hasConflict === true) {
      items = items.filter((c) => c.conflictCount > 0);
    } else if (filter?.hasConflict === false) {
      items = items.filter((c) => c.conflictCount === 0);
    }
    if (filter?.isStale !== undefined) {
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      items = items.filter((c) => {
        const obsTime = new Date(c.lastObservedAt || c.createdAt).getTime();
        return filter.isStale ? obsTime <= ninetyDaysAgo : obsTime > ninetyDaysAgo;
      });
    }
    if (filter?.cursor) {
      const cursorTime = new Date(filter.cursor).getTime();
      items = items.filter((c) => new Date(c.createdAt).getTime() < cursorTime);
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items.slice(offset, offset + limit);
  }

  public async count(filter?: ListCandidatesFilter): Promise<number> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (filter?.status) {
        conditions.push(`status = $${idx++}`);
        values.push(filter.status);
      }
      if (filter?.promotionEligible !== undefined) {
        conditions.push(`promotion_eligible = $${idx++}`);
        values.push(filter.promotionEligible);
      } else if (filter?.promotionEligibleOnly) {
        conditions.push(`promotion_eligible = true`);
      }
      if (filter?.intent) {
        conditions.push(`LOWER(intent) LIKE $${idx++}`);
        values.push(`%${filter.intent.toLowerCase()}%`);
      }
      if (filter?.category) {
        conditions.push(`category = $${idx++}`);
        values.push(filter.category);
      }
      if (filter?.language) {
        conditions.push(`language = $${idx++}`);
        values.push(filter.language);
      }
      if (filter?.sourceModel) {
        conditions.push(`source_model = $${idx++}`);
        values.push(filter.sourceModel);
      }
      if (filter?.responseStrategy) {
        conditions.push(`response_strategy = $${idx++}`);
        values.push(filter.responseStrategy);
      }
      const fromDate = filter?.from || filter?.createdAfter;
      if (fromDate) {
        conditions.push(`created_at >= $${idx++}`);
        values.push(fromDate);
      }
      const toDate = filter?.to || filter?.createdBefore;
      if (toDate) {
        conditions.push(`created_at <= $${idx++}`);
        values.push(toDate);
      }
      if (filter?.updatedAfter) {
        conditions.push(`updated_at >= $${idx++}`);
        values.push(filter.updatedAfter);
      }
      if (filter?.minConfidence !== undefined) {
        conditions.push(`confidence >= $${idx++}`);
        values.push(filter.minConfidence);
      }
      if (filter?.maxConfidence !== undefined) {
        conditions.push(`confidence <= $${idx++}`);
        values.push(filter.maxConfidence);
      }
      if (filter?.minObservations !== undefined) {
        conditions.push(`observation_count >= $${idx++}`);
        values.push(filter.minObservations);
      }
      if (filter?.hasConflict === true) {
        conditions.push(`conflict_count > 0`);
      } else if (filter?.hasConflict === false) {
        conditions.push(`conflict_count = 0`);
      }
      if (filter?.isStale === true) {
        conditions.push(`last_observed_at <= NOW() - INTERVAL '90 days'`);
      } else if (filter?.isStale === false) {
        conditions.push(`last_observed_at > NOW() - INTERVAL '90 days'`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await pool.query(
        `SELECT COUNT(*) as count FROM semantic_cache_candidates ${whereClause}`,
        values
      );
      return parseInt(res.rows[0]?.count || '0', 10);
    }

    const items = await this.list({ ...filter, limit: 10000, offset: 0 });
    return items.length;
  }

  /**
   * Updates evidence signals, observation counts, and promotion evaluation results atomically.
   */
  public async updateEvidence(id: string, dto: UpdateCandidateEvidenceDto): Promise<SemanticCacheCandidate | null> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const updates = ['updated_at = NOW()'];
      const values: any[] = [];
      let idx = 1;

      if (dto.observationCount !== undefined) {
        updates.push(`observation_count = $${idx++}`);
        values.push(dto.observationCount);
      }
      if (dto.uniqueExampleCount !== undefined) {
        updates.push(`unique_example_count = $${idx++}`);
        values.push(dto.uniqueExampleCount);
      }
      if (dto.inputExamples !== undefined) {
        updates.push(`input_examples = $${idx++}`);
        values.push(dto.inputExamples);
      }
      if (dto.lastObservedAt !== undefined) {
        updates.push(`last_observed_at = $${idx++}`);
        values.push(dto.lastObservedAt);
      } else {
        updates.push(`last_observed_at = NOW()`);
      }
      if (dto.validationCount !== undefined) {
        updates.push(`validation_count = $${idx++}`);
        values.push(dto.validationCount);
      }
      if (dto.rejectionCount !== undefined) {
        updates.push(`rejection_count = $${idx++}`);
        values.push(dto.rejectionCount);
      }
      if (dto.safetyViolationCount !== undefined) {
        updates.push(`safety_violation_count = $${idx++}`);
        values.push(dto.safetyViolationCount);
      }
      if (dto.duplicateCount !== undefined) {
        updates.push(`duplicate_count = $${idx++}`);
        values.push(dto.duplicateCount);
      }
      if (dto.conflictCount !== undefined) {
        updates.push(`conflict_count = $${idx++}`);
        values.push(dto.conflictCount);
      }
      if (dto.confidence !== undefined) {
        updates.push(`confidence = $${idx++}`);
        values.push(dto.confidence);
      }
      if (dto.semanticConsistency !== undefined) {
        updates.push(`semantic_consistency = $${idx++}`);
        values.push(dto.semanticConsistency);
      }
      if (dto.promotionEligible !== undefined) {
        updates.push(`promotion_eligible = $${idx++}`);
        values.push(dto.promotionEligible);
      }
      if (dto.promotionReasons !== undefined) {
        updates.push(`promotion_reasons = $${idx++}`);
        values.push(dto.promotionReasons);
      }
      if (dto.promotionBlockers !== undefined) {
        updates.push(`promotion_blockers = $${idx++}`);
        values.push(dto.promotionBlockers);
      }
      if (dto.status !== undefined) {
        updates.push(`status = $${idx++}`);
        values.push(dto.status);
      }
      if (dto.rejectionReason !== undefined) {
        updates.push(`rejection_reason = $${idx++}`);
        values.push(dto.rejectionReason);
      }

      values.push(id);
      const res = await pool.query(
        `UPDATE semantic_cache_candidates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (res.rows.length === 0) return null;
      return this.mapRowToCandidate(res.rows[0]);
    }

    const existing = this.inMemoryItems.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated: SemanticCacheCandidate = {
      ...existing,
      observationCount: dto.observationCount !== undefined ? dto.observationCount : existing.observationCount,
      uniqueExampleCount: dto.uniqueExampleCount !== undefined ? dto.uniqueExampleCount : existing.uniqueExampleCount,
      inputExamples: dto.inputExamples !== undefined ? dto.inputExamples : existing.inputExamples,
      lastObservedAt: dto.lastObservedAt || now,
      validationCount: dto.validationCount !== undefined ? dto.validationCount : existing.validationCount,
      rejectionCount: dto.rejectionCount !== undefined ? dto.rejectionCount : existing.rejectionCount,
      safetyViolationCount: dto.safetyViolationCount !== undefined ? dto.safetyViolationCount : existing.safetyViolationCount,
      duplicateCount: dto.duplicateCount !== undefined ? dto.duplicateCount : existing.duplicateCount,
      conflictCount: dto.conflictCount !== undefined ? dto.conflictCount : existing.conflictCount,
      confidence: dto.confidence !== undefined ? dto.confidence : existing.confidence,
      semanticConsistency: dto.semanticConsistency !== undefined ? dto.semanticConsistency : existing.semanticConsistency,
      promotionEligible: dto.promotionEligible !== undefined ? dto.promotionEligible : existing.promotionEligible,
      promotionReasons: dto.promotionReasons !== undefined ? dto.promotionReasons : existing.promotionReasons,
      promotionBlockers: dto.promotionBlockers !== undefined ? dto.promotionBlockers : existing.promotionBlockers,
      status: dto.status !== undefined ? dto.status : existing.status,
      rejectionReason: dto.rejectionReason !== undefined ? dto.rejectionReason : existing.rejectionReason,
      updatedAt: now,
    };
    this.inMemoryItems.set(id, updated);
    return updated;
  }

  public async updateStatus(
    id: string,
    status: CandidateStatus,
    options?: {
      rejectionReason?: string;
      promotedFaqId?: string;
    }
  ): Promise<SemanticCacheCandidate | null> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const updates = ['status = $1', 'updated_at = NOW()'];
      const values: any[] = [status];
      let idx = 2;

      if (status === 'validated') {
        updates.push(`validated_at = NOW()`);
        updates.push(`validation_count = validation_count + 1`);
      } else if (status === 'promoted') {
        updates.push(`promoted_at = NOW()`);
        if (options?.promotedFaqId) {
          updates.push(`promoted_faq_id = $${idx++}`);
          values.push(options.promotedFaqId);
        }
      } else if (status === 'rejected') {
        updates.push(`rejection_count = rejection_count + 1`);
        if (options?.rejectionReason) {
          updates.push(`rejection_reason = $${idx++}`);
          values.push(options.rejectionReason);
        }
      }

      values.push(id);
      const res = await pool.query(
        `UPDATE semantic_cache_candidates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (res.rows.length === 0) return null;
      return this.mapRowToCandidate(res.rows[0]);
    }

    const existing = this.inMemoryItems.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated: SemanticCacheCandidate = {
      ...existing,
      status,
      updatedAt: now,
      validatedAt: status === 'validated' ? now : existing.validatedAt,
      validationCount: status === 'validated' ? existing.validationCount + 1 : existing.validationCount,
      rejectionCount: status === 'rejected' ? existing.rejectionCount + 1 : existing.rejectionCount,
      promotedAt: status === 'promoted' ? now : existing.promotedAt,
      promotedFaqId: options?.promotedFaqId !== undefined ? options.promotedFaqId : existing.promotedFaqId,
      rejectionReason: options?.rejectionReason !== undefined ? options.rejectionReason : existing.rejectionReason,
    };
    this.inMemoryItems.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(`DELETE FROM semantic_cache_candidates WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    }
    return this.inMemoryItems.delete(id);
  }

  public clearInMemory(): void {
    this.inMemoryItems.clear();
  }

  private mapRowToCandidate(r: any): SemanticCacheCandidate {
    return {
      id: r.id,
      intent: r.intent,
      category: r.category || 'custom',
      inputExamples: Array.isArray(r.input_examples) ? r.input_examples : [],
      response: r.response,
      responseStrategy: r.response_strategy || 'static',
      responseTemplates:
        typeof r.response_templates === 'object' && r.response_templates !== null
          ? r.response_templates
          : { default: [r.response] },
      language: r.language || 'default',
      sourceModel: r.source_model || null,
      sourceProvider: r.source_provider || null,
      sourceRunId: r.source_run_id || null,
      confidence: r.confidence !== undefined && r.confidence !== null ? parseFloat(r.confidence) : 0.0,
      eligibilityReason: r.eligibility_reason || 'static_reusable',
      status: r.status,
      rejectionReason: r.rejection_reason || null,
      promotedFaqId: r.promoted_faq_id || null,

      // Phase 6 Evidence Model fields
      observationCount: parseInt(r.observation_count || '1', 10),
      uniqueExampleCount: parseInt(r.unique_example_count || '1', 10),
      firstObservedAt: r.first_observed_at ? new Date(r.first_observed_at).toISOString() : new Date().toISOString(),
      lastObservedAt: r.last_observed_at ? new Date(r.last_observed_at).toISOString() : new Date().toISOString(),
      validationCount: parseInt(r.validation_count || '0', 10),
      rejectionCount: parseInt(r.rejection_count || '0', 10),
      safetyViolationCount: parseInt(r.safety_violation_count || '0', 10),
      duplicateCount: parseInt(r.duplicate_count || '0', 10),
      conflictCount: parseInt(r.conflict_count || '0', 10),
      semanticConsistency: r.semantic_consistency !== null && r.semantic_consistency !== undefined ? parseFloat(r.semantic_consistency) : null,
      promotionEligible: r.promotion_eligible === true,
      promotionReasons: Array.isArray(r.promotion_reasons) ? r.promotion_reasons : [],
      promotionBlockers: Array.isArray(r.promotion_blockers) ? r.promotion_blockers : [],

      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
      validatedAt: r.validated_at ? new Date(r.validated_at).toISOString() : null,
      promotedAt: r.promoted_at ? new Date(r.promoted_at).toISOString() : null,
    };
  }
}
