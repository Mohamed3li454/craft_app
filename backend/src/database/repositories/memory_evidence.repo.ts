/**
 * Memory Evidence & Observation Repository (Phase 2.2)
 *
 * Persists and aggregates evidence observations across messages and conversations.
 * Calculates evidence strength and applies category-aware promotion policies
 * to promote verified observations into long-term persistent memories.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { UserRepository, normalizePhoneNumber } from './user.repo';
import { logger } from '../../core/logger';
import {
  MemoryCategory,
  MemoryObservation,
  MemoryEvidenceCandidate,
  EvidenceStatus,
  calculateEvidenceStrength,
  evaluatePromotion,
  calculateDynamicConfidence,
  calculateDynamicImportance,
  computeEvidenceFingerprint,
} from '../../modules/memory/types';
import { MemorySafetyGate } from '../../modules/memory/memory_safety_gate';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class MemoryEvidenceRepository {
  private static instance: MemoryEvidenceRepository;
  private static sharedInMemoryCandidates: Map<string, MemoryEvidenceCandidate> = new Map();
  private inMemoryCandidates: Map<string, MemoryEvidenceCandidate> = MemoryEvidenceRepository.sharedInMemoryCandidates;
  private schemaChecked = false;

  public static clearInMemory(): void {
    MemoryEvidenceRepository.sharedInMemoryCandidates.clear();
  }

  public static getInstance(db?: DatabaseManager): MemoryEvidenceRepository {
    if (!MemoryEvidenceRepository.instance) {
      MemoryEvidenceRepository.instance = new MemoryEvidenceRepository(db);
    }
    return MemoryEvidenceRepository.instance;
  }

  constructor(
    private db: DatabaseManager = DatabaseManager.getInstance(),
    private userRepo: UserRepository = new UserRepository(db)
  ) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS memory_evidence_candidates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          candidate_key VARCHAR(150) NOT NULL,
          category VARCHAR(50) NOT NULL,
          canonical_fact TEXT NOT NULL,
          evidence_count INT NOT NULL DEFAULT 1,
          conversation_count INT NOT NULL DEFAULT 1,
          conversation_ids TEXT[] NOT NULL DEFAULT '{}',
          sources TEXT[] NOT NULL DEFAULT '{}',
          evidence_strength REAL NOT NULL DEFAULT 0.0,
          confidence REAL NOT NULL DEFAULT 0.0,
          importance VARCHAR(20) NOT NULL DEFAULT 'normal',
          status VARCHAR(20) NOT NULL DEFAULT 'observing',
          promoted_memory_id UUID REFERENCES memory_items(id) ON DELETE SET NULL,
          first_observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          CONSTRAINT uq_memory_evidence_user_key UNIQUE (user_id, candidate_key)
        );
        ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 0.0;
        ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS importance VARCHAR(20) DEFAULT 'normal';
        ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS temporal_state VARCHAR(20) DEFAULT 'unknown';
        ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE;
        ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP WITH TIME ZONE;
        CREATE INDEX IF NOT EXISTS idx_evidence_user_status ON memory_evidence_candidates(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_evidence_candidate_key ON memory_evidence_candidates(user_id, candidate_key);
        CREATE INDEX IF NOT EXISTS idx_evidence_last_observed ON memory_evidence_candidates(last_observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_evidence_confidence ON memory_evidence_candidates(user_id, confidence DESC);
        CREATE INDEX IF NOT EXISTS idx_evidence_temporal_state ON memory_evidence_candidates(user_id, temporal_state);
      `);
      this.schemaChecked = true;
    } catch (err: any) {
      logger.debug('Schema check for memory_evidence_candidates skipped/failed', {
        error: err.message,
      });
    }
  }

  public async resolveUserId(userId: string): Promise<string> {
    if (!userId) return toDeterministicUuid('anonymous');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return userId;
    }
    const cleanPhone = normalizePhoneNumber(userId.replace(/^wa_/, ''));
    if (cleanPhone && cleanPhone.length >= 8) {
      try {
        const user = await this.userRepo.findOrCreateUserByPhone(cleanPhone);
        return user.id;
      } catch {
        // Fallback to deterministic UUID
      }
    }
    return toDeterministicUuid(userId);
  }

  /**
   * Records an observation, accumulates evidence, re-computes evidence strength,
   * and evaluates promotion policy atomically.
   */
  public async recordObservation(
    observation: MemoryObservation
  ): Promise<{ candidate: MemoryEvidenceCandidate; shouldPromote: boolean }> {
    // Phase 2.8: Defense-in-depth safety gate validation on canonical fact
    const factDecision = MemorySafetyGate.getInstance().evaluate(
      observation.canonicalFact,
      observation.category
    );
    if (!factDecision.allowed) {
      logger.warn('Observation candidate fact rejected by MemorySafetyGate', {
        reason: factDecision.reason,
        category: observation.category,
      });
      throw new Error(`Memory observation rejected by safety gate: ${factDecision.reason}`);
    }

    // Phase 2.8: Defense-in-depth safety gate validation on raw signal (if present)
    if (observation.rawSignal && typeof observation.rawSignal === 'string') {
      const signalDecision = MemorySafetyGate.getInstance().evaluate(
        observation.rawSignal,
        observation.category
      );
      if (!signalDecision.allowed) {
        logger.warn('Observation raw signal rejected by MemorySafetyGate', {
          reason: signalDecision.reason,
          category: observation.category,
        });
        throw new Error(`Memory observation rejected by safety gate: ${signalDecision.reason}`);
      }
    }

    // Phase 2.8: Sanitize metadata from sensitive raw signal if present
    if (typeof observation.metadata?.rawSignal === 'string') {
      const metaSignalDecision = MemorySafetyGate.getInstance().evaluate(
        observation.metadata.rawSignal,
        observation.category
      );
      if (!metaSignalDecision.allowed) {
        const { rawSignal, ...safeMetadata } = observation.metadata;
        observation = { ...observation, metadata: safeMetadata };
      }
    }

    const userUuid = await this.resolveUserId(observation.userId);
    const convId = observation.conversationId || '';
    const pool = this.db.getPool();

    const fingerprint: string =
      observation.metadata?.evidenceFingerprint != null
        ? String(observation.metadata.evidenceFingerprint)
        : computeEvidenceFingerprint({
            userId: userUuid,
            candidateKey: observation.candidateKey,
            conversationId: convId,
            canonicalFact: observation.canonicalFact,
            rawSignal: observation.rawSignal,
            source: observation.source,
            evidenceId: observation.metadata?.evidenceId != null ? String(observation.metadata.evidenceId) : undefined,
          });

    if (pool) {
      try {
        await this.ensureSchema();
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, observation.userId]
        );

        const convArray = convId ? [convId] : [];
        const sourceArray = [observation.source];

        const upsertRes = await pool.query(
          `INSERT INTO memory_evidence_candidates (
             id, user_id, candidate_key, category, canonical_fact,
             evidence_count, conversation_count, conversation_ids, sources,
             evidence_strength, temporal_state, valid_from, valid_until,
             status, first_observed_at, last_observed_at, metadata
           ) VALUES (
             $1, $2, $3, $4, $5,
             1, CASE WHEN $12 = '' THEN 0 ELSE 1 END, $6::text[], $7::text[],
             0.0, $8, $9, $10,
             'observing', NOW(), NOW(), $11::jsonb
           )
           ON CONFLICT (user_id, candidate_key)
           DO UPDATE SET
             evidence_count = CASE
               WHEN COALESCE(memory_evidence_candidates.metadata->'evidenceFingerprints', '[]'::jsonb) ? $14
                 THEN memory_evidence_candidates.evidence_count
               ELSE memory_evidence_candidates.evidence_count + 1
             END,
             conversation_count = CASE
               WHEN $12 = '' OR $12 = ANY(memory_evidence_candidates.conversation_ids)
                 THEN memory_evidence_candidates.conversation_count
               ELSE memory_evidence_candidates.conversation_count + 1
             END,
             conversation_ids = CASE
               WHEN $12 = ANY(memory_evidence_candidates.conversation_ids) OR $12 = ''
                 THEN memory_evidence_candidates.conversation_ids
               ELSE (array_append(memory_evidence_candidates.conversation_ids, $12))[
                 GREATEST(1, cardinality(array_append(memory_evidence_candidates.conversation_ids, $12)) - 19) :
               ]
             END,
             sources = CASE
               WHEN $13 = ANY(memory_evidence_candidates.sources)
                 THEN memory_evidence_candidates.sources
               ELSE array_append(memory_evidence_candidates.sources, $13)
             END,
             last_observed_at = NOW(),
             canonical_fact = EXCLUDED.canonical_fact,
             temporal_state = COALESCE(EXCLUDED.temporal_state, memory_evidence_candidates.temporal_state),
             valid_from = COALESCE(EXCLUDED.valid_from, memory_evidence_candidates.valid_from),
             valid_until = COALESCE(EXCLUDED.valid_until, memory_evidence_candidates.valid_until),
             metadata = jsonb_set(
               COALESCE(memory_evidence_candidates.metadata, '{}'::jsonb) || EXCLUDED.metadata,
               '{evidenceFingerprints}',
               CASE
                 WHEN COALESCE(memory_evidence_candidates.metadata->'evidenceFingerprints', '[]'::jsonb) ? $14
                   THEN COALESCE(memory_evidence_candidates.metadata->'evidenceFingerprints', '[]'::jsonb)
                 ELSE COALESCE(memory_evidence_candidates.metadata->'evidenceFingerprints', '[]'::jsonb) || to_jsonb(ARRAY[$14])
               END
             )
           RETURNING id, user_id as "userId", candidate_key as "candidateKey",
                     category, canonical_fact as "canonicalFact",
                     evidence_count as "evidenceCount", conversation_count as "conversationCount",
                     conversation_ids as "conversationIds", sources,
                     evidence_strength as "evidenceStrength",
                     temporal_state as "temporalState",
                     valid_from as "validFrom",
                     valid_until as "validUntil",
                     status,
                     promoted_memory_id as "promotedMemoryId",
                     first_observed_at as "firstObservedAt", last_observed_at as "lastObservedAt",
                     metadata`,
          [
            uuidv4(),
            userUuid,
            observation.candidateKey,
            observation.category,
            observation.canonicalFact,
            convArray,
            sourceArray,
            observation.temporalState || 'unknown',
            observation.validFrom || null,
            observation.validUntil || null,
            JSON.stringify({
              ...(observation.metadata || {}),
              ...(observation.isExplicit ? { isExplicit: true } : {}),
              ...(observation.temporalMetadata ? { temporalMetadata: observation.temporalMetadata } : {}),
              evidenceFingerprints: [fingerprint],
            }),
            convId,
            observation.source,
            fingerprint,
          ]
        );

        let row = upsertRes.rows[0];

        const isExplicit =
          row.sources.includes('user_explicit') ||
          row.sources.includes('agent_tool') ||
          Boolean(row.metadata?.isExplicit);

        // Calculate evidence strength, dynamic confidence, and dynamic importance
        const strength = calculateEvidenceStrength({
          evidenceCount: row.evidenceCount,
          conversationCount: row.conversationCount,
          hasExplicitSource: isExplicit,
          sources: row.sources,
          firstObservedAt: row.firstObservedAt,
          lastObservedAt: row.lastObservedAt,
        });

        const dynamicConfidence = calculateDynamicConfidence({
          evidenceCount: row.evidenceCount,
          conversationCount: row.conversationCount,
          sources: row.sources,
          isExplicit,
          category: row.category,
        });

        const dynamicImportance = calculateDynamicImportance({
          category: row.category,
          factText: row.canonicalFact,
          isExplicit,
          source: observation.source,
          evidenceStrength: strength,
          conversationCount: row.conversationCount,
        });

        await pool.query(
          `UPDATE memory_evidence_candidates
           SET evidence_strength = $2,
               confidence = $3,
               importance = $4
           WHERE id = $1`,
          [row.id, strength, dynamicConfidence, dynamicImportance]
        );

        const candidate: MemoryEvidenceCandidate = {
          ...row,
          evidenceStrength: strength,
          confidence: dynamicConfidence,
          importance: dynamicImportance,
        };

        const decision = evaluatePromotion(candidate);
        return {
          candidate,
          shouldPromote: decision.shouldPromote && candidate.status !== 'promoted',
        };
      } catch (err: any) {
        logger.warn('Failed to record observation in database, falling back to in-memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const key = `${userUuid}:${observation.candidateKey}`;
    let existing = this.inMemoryCandidates.get(key);

    if (!existing) {
      const convIds = convId ? [convId] : [];
      const sources = [observation.source];
      const now = new Date();
      const isExplicit =
        sources.includes('user_explicit') ||
        sources.includes('agent_tool') ||
        Boolean(observation.isExplicit || observation.metadata?.isExplicit);
      const initialConvCount = convId ? 1 : 0;
      const strength = calculateEvidenceStrength({
        evidenceCount: 1,
        conversationCount: initialConvCount,
        hasExplicitSource: isExplicit,
        sources,
        firstObservedAt: now,
        lastObservedAt: now,
      });

      const dynamicConfidence = calculateDynamicConfidence({
        evidenceCount: 1,
        conversationCount: initialConvCount,
        sources,
        isExplicit,
        category: observation.category,
      });

      const dynamicImportance = calculateDynamicImportance({
        category: observation.category,
        factText: observation.canonicalFact,
        isExplicit,
        source: observation.source,
        evidenceStrength: strength,
        conversationCount: initialConvCount,
      });

      const candidate: MemoryEvidenceCandidate = {
        id: uuidv4(),
        userId: userUuid,
        candidateKey: observation.candidateKey,
        category: observation.category,
        canonicalFact: observation.canonicalFact,
        evidenceCount: 1,
        conversationCount: initialConvCount,
        conversationIds: convIds,
        sources,
        evidenceStrength: strength,
        confidence: dynamicConfidence,
        importance: dynamicImportance,
        temporalState: observation.temporalState || 'unknown',
        validFrom: observation.validFrom || null,
        validUntil: observation.validUntil || null,
        status: 'observing',
        firstObservedAt: now,
        lastObservedAt: now,
        metadata: {
          ...(observation.metadata || {}),
          ...(isExplicit ? { isExplicit: true } : {}),
          ...(observation.temporalMetadata ? { temporalMetadata: observation.temporalMetadata } : {}),
          evidenceFingerprints: [fingerprint],
        },
      };

      this.inMemoryCandidates.set(key, candidate);
      const decision = evaluatePromotion(candidate);
      return { candidate, shouldPromote: decision.shouldPromote };
    }

    // Accumulate existing
    const isNewConv = Boolean(convId && !existing.conversationIds.includes(convId));
    const newConvIds = isNewConv
      ? [...existing.conversationIds, convId].slice(-20)
      : existing.conversationIds;

    const newSources = !existing.sources.includes(observation.source)
      ? [...existing.sources, observation.source]
      : existing.sources;

    const existingFingerprints: string[] = Array.isArray(existing.metadata?.evidenceFingerprints)
      ? existing.metadata.evidenceFingerprints
      : [];
    const isDuplicateEvidence = existingFingerprints.includes(fingerprint);

    const updatedFingerprints = isDuplicateEvidence
      ? existingFingerprints
      : [...existingFingerprints, fingerprint];

    const newEvidenceCount = isDuplicateEvidence
      ? existing.evidenceCount
      : existing.evidenceCount + 1;

    const newConversationCount = isNewConv
      ? existing.conversationCount + 1
      : existing.conversationCount;
    const now = new Date();

    const isExplicit =
      newSources.includes('user_explicit') ||
      newSources.includes('agent_tool') ||
      Boolean(existing.metadata?.isExplicit || observation.isExplicit || observation.metadata?.isExplicit);

    const strength = calculateEvidenceStrength({
      evidenceCount: newEvidenceCount,
      conversationCount: newConversationCount,
      hasExplicitSource: isExplicit,
      sources: newSources,
      firstObservedAt: existing.firstObservedAt,
      lastObservedAt: now,
    });

    const dynamicConfidence = calculateDynamicConfidence({
      evidenceCount: newEvidenceCount,
      conversationCount: newConversationCount,
      sources: newSources,
      isExplicit,
      category: observation.category,
    });

    const dynamicImportance = calculateDynamicImportance({
      category: observation.category,
      factText: observation.canonicalFact,
      isExplicit,
      source: observation.source,
      evidenceStrength: strength,
      conversationCount: newConversationCount,
    });

    const updated: MemoryEvidenceCandidate = {
      ...existing,
      evidenceCount: newEvidenceCount,
      conversationCount: newConversationCount,
      conversationIds: newConvIds,
      sources: newSources,
      evidenceStrength: strength,
      confidence: dynamicConfidence,
      importance: dynamicImportance,
      temporalState: observation.temporalState || existing.temporalState || 'unknown',
      validFrom: observation.validFrom !== undefined ? observation.validFrom : existing.validFrom,
      validUntil: observation.validUntil !== undefined ? observation.validUntil : existing.validUntil,
      canonicalFact: observation.canonicalFact,
      lastObservedAt: now,
      metadata: {
        ...(existing.metadata || {}),
        ...(observation.metadata || {}),
        ...(isExplicit ? { isExplicit: true } : {}),
        ...(observation.temporalMetadata ? { temporalMetadata: observation.temporalMetadata } : {}),
        evidenceFingerprints: updatedFingerprints,
      },
    };

    this.inMemoryCandidates.set(key, updated);
    const decision = evaluatePromotion(updated);

    return {
      candidate: updated,
      shouldPromote: decision.shouldPromote && updated.status !== 'promoted',
    };
  }

  /**
   * Marks a candidate as promoted to persistent memory.
   */
  public async markPromoted(
    userId: string,
    candidateKey: string,
    memoryId: string
  ): Promise<void> {
    const userUuid = await this.resolveUserId(userId);
    const pool = this.db.getPool();

    if (pool) {
      try {
        await pool.query(
          `UPDATE memory_evidence_candidates
           SET status = 'promoted',
               promoted_memory_id = $3,
               last_observed_at = NOW()
           WHERE user_id = $1 AND candidate_key = $2`,
          [userUuid, candidateKey, memoryId]
        );
        return;
      } catch (err: any) {
        logger.warn('Failed to mark candidate promoted in database', { error: err.message });
      }
    }

    const key = `${userUuid}:${candidateKey}`;
    const candidate = this.inMemoryCandidates.get(key);
    if (candidate) {
      this.inMemoryCandidates.set(key, {
        ...candidate,
        status: 'promoted',
        promotedMemoryId: memoryId,
        lastObservedAt: new Date(),
      });
    }
  }

  /**
   * Retrieves all evidence candidates for a user, optionally filtered by status.
   */
  public async getCandidates(
    userId: string,
    status?: EvidenceStatus
  ): Promise<MemoryEvidenceCandidate[]> {
    const userUuid = await this.resolveUserId(userId);
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const params: any[] = [userUuid];
        let query = `
          SELECT id, user_id as "userId", candidate_key as "candidateKey",
                 category, canonical_fact as "canonicalFact",
                 evidence_count as "evidenceCount", conversation_count as "conversationCount",
                 conversation_ids as "conversationIds", sources,
                 evidence_strength as "evidenceStrength", confidence, importance,
                 temporal_state as "temporalState",
                 valid_from as "validFrom",
                 valid_until as "validUntil",
                 status,
                 promoted_memory_id as "promotedMemoryId",
                 first_observed_at as "firstObservedAt", last_observed_at as "lastObservedAt",
                 metadata
          FROM memory_evidence_candidates
          WHERE user_id = $1
        `;
        if (status) {
          query += ` AND status = $2`;
          params.push(status);
        }
        query += ` ORDER BY last_observed_at DESC`;

        const res = await pool.query(query, params);
        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to get candidates from database, falling back to memory store', {
          error: err.message,
        });
      }
    }

    const results: MemoryEvidenceCandidate[] = [];
    for (const [k, v] of this.inMemoryCandidates.entries()) {
      if (k.startsWith(`${userUuid}:`)) {
        if (!status || v.status === status) {
          results.push(v);
        }
      }
    }
    return results.sort((a, b) => b.lastObservedAt.getTime() - a.lastObservedAt.getTime());
  }

  /**
   * Retrieves a single candidate by user ID and candidate key.
   */
  public async getCandidateByKey(
    userId: string,
    candidateKey: string
  ): Promise<MemoryEvidenceCandidate | null> {
    const userUuid = await this.resolveUserId(userId);
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(
          `SELECT id, user_id as "userId", candidate_key as "candidateKey",
                  category, canonical_fact as "canonicalFact",
                  evidence_count as "evidenceCount", conversation_count as "conversationCount",
                  conversation_ids as "conversationIds", sources,
                  evidence_strength as "evidenceStrength", confidence, importance,
                  temporal_state as "temporalState",
                  valid_from as "validFrom",
                  valid_until as "validUntil",
                  status,
                  promoted_memory_id as "promotedMemoryId",
                  first_observed_at as "firstObservedAt", last_observed_at as "lastObservedAt",
                  metadata
           FROM memory_evidence_candidates
           WHERE user_id = $1 AND candidate_key = $2
           LIMIT 1`,
          [userUuid, candidateKey]
        );
        return res.rows[0] || null;
      } catch (err: any) {
        logger.warn('Failed to get candidate by key from database', { error: err.message });
      }
    }

    const key = `${userUuid}:${candidateKey}`;
    return this.inMemoryCandidates.get(key) || null;
  }

  /**
   * Lists evidence candidates with optional userId and status filters and pagination.
   */
  public async listCandidates(options: {
    userId?: string;
    status?: EvidenceStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: MemoryEvidenceCandidate[]; total: number }> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];
        let pIdx = 1;

        if (options.userId) {
          const userUuid = await this.resolveUserId(options.userId);
          whereClauses.push(`user_id = $${pIdx}`);
          params.push(userUuid);
          pIdx++;
        }
        if (options.status) {
          whereClauses.push(`status = $${pIdx}`);
          params.push(options.status);
          pIdx++;
        }

        const whereSql = whereClauses.join(' AND ');

        const countRes = await pool.query(
          `SELECT COUNT(*) as total FROM memory_evidence_candidates WHERE ${whereSql}`,
          params
        );
        const total = parseInt(countRes.rows[0]?.total || '0', 10);

        const listQuery = `
          SELECT id, user_id as "userId", candidate_key as "candidateKey",
                 category, canonical_fact as "canonicalFact",
                 evidence_count as "evidenceCount", conversation_count as "conversationCount",
                 conversation_ids as "conversationIds", sources,
                 evidence_strength as "evidenceStrength", confidence, importance,
                 temporal_state as "temporalState",
                 valid_from as "validFrom",
                 valid_until as "validUntil",
                 status,
                 promoted_memory_id as "promotedMemoryId",
                 first_observed_at as "firstObservedAt", last_observed_at as "lastObservedAt",
                 metadata
          FROM memory_evidence_candidates
          WHERE ${whereSql}
          ORDER BY last_observed_at DESC
          LIMIT $${pIdx} OFFSET $${pIdx + 1}
        `;
        params.push(limit, offset);

        const listRes = await pool.query(listQuery, params);
        return { items: listRes.rows, total };
      } catch (err: any) {
        logger.warn('Failed to list candidates from database', { error: err.message });
      }
    }

    let all: MemoryEvidenceCandidate[] = Array.from(this.inMemoryCandidates.values());
    if (options.userId) {
      const userUuid = toDeterministicUuid(options.userId);
      all = all.filter(c => c.userId === userUuid || c.userId === options.userId);
    }
    if (options.status) {
      all = all.filter(c => c.status === options.status);
    }
    const total = all.length;
    all.sort((a, b) => b.lastObservedAt.getTime() - a.lastObservedAt.getTime());
    return { items: all.slice(offset, offset + limit), total };
  }

  /**
   * Retrieves a candidate by its unique ID.
   */
  public async getCandidateById(id: string): Promise<MemoryEvidenceCandidate | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(
          `SELECT id, user_id as "userId", candidate_key as "candidateKey",
                  category, canonical_fact as "canonicalFact",
                  evidence_count as "evidenceCount", conversation_count as "conversationCount",
                  conversation_ids as "conversationIds", sources,
                  evidence_strength as "evidenceStrength", confidence, importance,
                  temporal_state as "temporalState",
                  valid_from as "validFrom",
                  valid_until as "validUntil",
                  status,
                  promoted_memory_id as "promotedMemoryId",
                  first_observed_at as "firstObservedAt", last_observed_at as "lastObservedAt",
                  metadata
           FROM memory_evidence_candidates
           WHERE id = $1 LIMIT 1`,
          [id]
        );
        return res.rows[0] || null;
      } catch (err: any) {
        logger.warn('Failed to get candidate by ID from database', { error: err.message, id });
      }
    }

    for (const c of this.inMemoryCandidates.values()) {
      if (c.id === id) return c;
    }
    return null;
  }

  /**
   * Rejects an evidence candidate.
   */
  public async rejectCandidate(id: string, reason?: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(
          `UPDATE memory_evidence_candidates
           SET status = 'rejected',
               metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{rejectionReason}', to_jsonb($1::text), true)
           WHERE id = $2`,
          [reason || 'Rejected by admin', id]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.error('Failed to reject candidate in database', { error: err.message, id });
      }
    }

    for (const [k, c] of this.inMemoryCandidates.entries()) {
      if (c.id === id) {
        const updated: MemoryEvidenceCandidate = {
          ...c,
          status: 'rejected',
          metadata: { ...(c.metadata || {}), rejectionReason: reason || 'Rejected by admin' },
        };
        this.inMemoryCandidates.set(k, updated);
        return true;
      }
    }
    return false;
  }

  /**
   * Resets in-memory store for unit test isolation.
   */
  public clearInMemoryStore(): void {
    this.inMemoryCandidates.clear();
  }
}
