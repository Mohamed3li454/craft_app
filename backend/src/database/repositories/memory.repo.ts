import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { MemoryItemEntity } from './types';
import { logger } from '../../core/logger';
import { UserRepository, normalizePhoneNumber } from './user.repo';
import {
  MemoryCategory,
  MemorySource,
  MemoryStatus,
  MemoryImportance,
  TemporalState,
  MemorySaveOptions,
  SOURCE_PRIORITY,
  normalizeFactText,
  calculateTokenSimilarity,
  deriveFactKey,
  LanguagePreference,
  PersonalityPreference,
  calculateDynamicConfidence,
  calculateDynamicImportance,
  computeEvidenceFingerprint,
  ConsolidationResult,
} from '../../modules/memory/types';
import { UserPreferenceRepository } from './user_preference.repo';
import { MemoryEvidenceRepository } from './memory_evidence.repo';
import { MemorySafetyGate } from '../../modules/memory/memory_safety_gate';
import { MemoryCandidateExtractor } from '../../modules/memory/memory_extractor';
import { SemanticContradictionService } from '../../modules/memory/semantic_contradiction.service';
import { MemoryConsolidationService } from '../../modules/memory/memory_consolidation.service';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class MemoryRepository {
  private inMemoryItems: Map<string, MemoryItemEntity[]> = new Map();
  private schemaChecked = false;

  constructor(
    private db: DatabaseManager = DatabaseManager.getInstance(),
    private userRepo: UserRepository = new UserRepository(db),
    private userPreferenceRepo: UserPreferenceRepository = new UserPreferenceRepository(db, userRepo),
    private evidenceRepo: MemoryEvidenceRepository = MemoryEvidenceRepository.getInstance(db)
  ) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;

    try {
      await pool.query(`
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS fact_key VARCHAR(100);
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'automatic_extraction';
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 1.0;
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS importance VARCHAR(20) DEFAULT 'normal';
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS temporal_state VARCHAR(20) DEFAULT 'unknown';
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE;
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP WITH TIME ZONE;
        ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
        CREATE INDEX IF NOT EXISTS idx_memory_items_user_active ON memory_items(user_id, status) WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_memory_items_user_fact_key ON memory_items(user_id, fact_key) WHERE fact_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_memory_items_valid_until ON memory_items(valid_until) WHERE valid_until IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_memory_items_temporal_state ON memory_items(user_id, temporal_state);
      `);
      this.schemaChecked = true;
    } catch (err: any) {
      logger.debug('Schema check for memory_items table skipped/failed', { error: err.message });
    }
  }

  private async resolveUserId(userId: string): Promise<string> {
    if (!userId) return toDeterministicUuid('anonymous');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return userId;
    }
    const cleanPhone = normalizePhoneNumber(userId.replace(/^wa_/, ''));
    if (cleanPhone && cleanPhone.length >= 8) {
      const user = await this.userRepo.findOrCreateUserByPhone(cleanPhone);
      return user.id;
    }
    return toDeterministicUuid(userId);
  }

  /**
   * Saves a memory fact about the user with deduplication, conflict resolution,
   * authority ranking, and temporal validity awareness.
   */
  public async saveFact(
    userId: string,
    factText: string,
    category: MemoryCategory | string = 'general',
    options?: MemorySaveOptions
  ): Promise<MemoryItemEntity> {
    const cleanText = normalizeFactText(factText);

    // Phase 4.5: Defense-in-depth safety gate evaluation
    const safetyDecision = MemorySafetyGate.getInstance().evaluate(cleanText, category);
    if (!safetyDecision.allowed) {
      logger.warn('saveFact candidate blocked by MemorySafetyGate', {
        reason: safetyDecision.reason,
        category,
      });
      throw new Error(`Memory fact rejected by safety gate: ${safetyDecision.reason}`);
    }
    const source: MemorySource = options?.source || 'automatic_extraction';
    const confidence = options?.confidence ?? 1.0;
    const importance: MemoryImportance = options?.importance || 'normal';
    const temporalState: TemporalState =
      options?.temporalState || (category === 'ephemeral_context' ? 'temporary' : 'unknown');
    const validFrom: Date | null = options?.validFrom || null;
    const factKey = options?.factKey || deriveFactKey(cleanText, category);
    const newPriority = SOURCE_PRIORITY[source] || 1;

    let validUntil: Date | null = null;
    if (options?.validUntil !== undefined) {
      validUntil = options.validUntil;
    } else if (category === 'ephemeral_context') {
      validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h default for ephemeral
    }

    let status: MemoryStatus = options?.status || 'active';
    if (validUntil && new Date(validUntil).getTime() <= Date.now()) {
      status = 'expired';
    }

    const rawMeta = { ...((options?.metadata || {}) as Record<string, any>) };
    // Phase 2.8: Ensure sensitive raw signal is not persisted in metadata
    if (typeof rawMeta.rawSignal === 'string') {
      const metaSignalDecision = MemorySafetyGate.getInstance().evaluate(
        rawMeta.rawSignal,
        category
      );
      if (!metaSignalDecision.allowed) {
        delete rawMeta.rawSignal;
      }
    }
    const initConvIds: string[] = Array.isArray(rawMeta.conversationIds)
      ? rawMeta.conversationIds
      : rawMeta.conversationId
      ? [String(rawMeta.conversationId)]
      : [];
    const hasConvMetadata =
      rawMeta.conversationCount !== undefined ||
      rawMeta.conversationId !== undefined ||
      rawMeta.conversationIds !== undefined;
    const initConvCount =
      typeof rawMeta.conversationCount === 'number'
        ? rawMeta.conversationCount
        : (initConvIds.length > 0 ? initConvIds.length : (hasConvMetadata ? 1 : 0));
    const normalizedOptionsMetadata: Record<string, any> = {
      ...rawMeta,
      conversationIds: initConvIds.slice(-20),
      conversationCount: initConvCount,
      evidenceCount: Number(rawMeta.evidenceCount || 1),
      sources: Array.isArray(rawMeta.sources) ? rawMeta.sources : [source],
    };
    options = {
      ...options,
      metadata: normalizedOptionsMetadata,
    };

    const pool = this.db.getPool();
    const userUuid = await this.resolveUserId(userId);

    if (pool) {
      try {
        await this.ensureSchema();

        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, userId]
        );

        // Fetch existing active memories for this user
        const existingRes = await pool.query(
          `SELECT id, user_id as "userId", fact_text as "factText", category,
                  status, fact_key as "factKey", source, confidence,
                  importance, temporal_state as "temporalState",
                  valid_from as "validFrom", valid_until as "validUntil", metadata,
                  created_at as "createdAt", updated_at as "updatedAt"
           FROM memory_items
           WHERE user_id = $1
             AND (status IS NULL OR status = 'active')
             AND (valid_until IS NULL OR valid_until > NOW())`,
          [userUuid]
        );

        const activeRows: MemoryItemEntity[] = existingRes.rows;



        // 3. Phase 2.5: Semantic Contradiction & Evolution Reasoning
        const relationResult = SemanticContradictionService.getInstance().evaluateRelationAgainstActive(
          {
            factText: cleanText,
            category,
            temporalState,
            factKey,
            source,
            validUntil,
          },
          activeRows
        );

        if (relationResult.relation === 'contradicts' && relationResult.targetMemoryId) {
          const targetMem = activeRows.find((m) => m.id === relationResult.targetMemoryId);
          if (targetMem) {
            const existingPrio = SOURCE_PRIORITY[targetMem.source as MemorySource] || 1;
            if (newPriority >= existingPrio) {
              const newId = uuidv4();
              await pool.query(
                `UPDATE memory_items
                 SET status = 'superseded',
                     updated_at = NOW(),
                     metadata = jsonb_set(
                       COALESCE(metadata, '{}'::jsonb),
                       '{supersededBy}',
                       to_jsonb($2::text)
                     )
                 WHERE id = $1`,
                [targetMem.id, newId]
              );

              const insertRes = await pool.query(
                `INSERT INTO memory_items (
                   id, user_id, fact_text, category, status, fact_key,
                   source, confidence, importance, temporal_state, valid_from, valid_until, metadata,
                   created_at, updated_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
                 RETURNING id, user_id as "userId", fact_text as "factText", category,
                           status, fact_key as "factKey", source, confidence,
                           importance, temporal_state as "temporalState",
                           valid_from as "validFrom", valid_until as "validUntil", metadata,
                           created_at as "createdAt", updated_at as "updatedAt"`,
                [
                  newId,
                  userUuid,
                  cleanText,
                  category,
                  status,
                  factKey || null,
                  source,
                  confidence,
                  importance,
                  temporalState,
                  validFrom,
                  validUntil,
                  JSON.stringify({
                    ...(options?.metadata || {}),
                    relationResult: {
                      relation: relationResult.relation,
                      reason: relationResult.reason,
                      signals: relationResult.signals,
                    },
                  }),
                ]
              );
              return insertRes.rows[0];
            } else {
              // Higher authority target already active. Retain target.
              return targetMem;
            }
          }
        } else if (relationResult.relation === 'evolves' && relationResult.targetMemoryId) {
          const targetMem = activeRows.find((m) => m.id === relationResult.targetMemoryId);
          if (targetMem) {
            const existingPrio = SOURCE_PRIORITY[targetMem.source as MemorySource] || 1;
            if (newPriority >= existingPrio) {
              const newId = uuidv4();
              await pool.query(
                `UPDATE memory_items
                 SET temporal_state = 'historical',
                     updated_at = NOW(),
                     metadata = jsonb_set(
                       COALESCE(metadata, '{}'::jsonb),
                       '{evolvedTo}',
                       to_jsonb($2::text)
                     )
                 WHERE id = $1`,
                [targetMem.id, newId]
              );

              const insertRes = await pool.query(
                `INSERT INTO memory_items (
                   id, user_id, fact_text, category, status, fact_key,
                   source, confidence, importance, temporal_state, valid_from, valid_until, metadata,
                   created_at, updated_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
                 RETURNING id, user_id as "userId", fact_text as "factText", category,
                           status, fact_key as "factKey", source, confidence,
                           importance, temporal_state as "temporalState",
                           valid_from as "validFrom", valid_until as "validUntil", metadata,
                           created_at as "createdAt", updated_at as "updatedAt"`,
                [
                  newId,
                  userUuid,
                  cleanText,
                  category,
                  status,
                  factKey || null,
                  source,
                  confidence,
                  importance,
                  temporalState,
                  validFrom,
                  validUntil,
                  JSON.stringify({
                    ...(options?.metadata || {}),
                    relationResult: {
                      relation: relationResult.relation,
                      reason: relationResult.reason,
                      signals: relationResult.signals,
                    },
                  }),
                ]
              );
              return insertRes.rows[0];
            }
          }
        }

        // 4. Phase 2.6: Memory Consolidation (Reinforce / Merge)
        const consolidationResult = MemoryConsolidationService.getInstance().evaluateConsolidation(
          {
            factText: cleanText,
            category,
            temporalState,
            factKey,
            source,
            confidence,
            importance,
            validUntil,
            metadata: options?.metadata || {},
          },
          activeRows
        );

        if (
          (consolidationResult.action === 'reinforce' || consolidationResult.action === 'merge') &&
          consolidationResult.canonicalMemoryId
        ) {
          const canonicalMem = activeRows.find((m) => m.id === consolidationResult.canonicalMemoryId);
          if (canonicalMem) {
            const consolidatedFactText = consolidationResult.consolidatedFactText || canonicalMem.factText;
            const consolidatedConfidence =
              consolidationResult.consolidatedConfidence ?? Math.max(canonicalMem.confidence ?? 0.7, confidence);
            const consolidatedImportance =
              consolidationResult.consolidatedImportance || canonicalMem.importance;

            const existingMetadata = canonicalMem.metadata || {};
            const incomingMetadata = options?.metadata || {};

            const existingCount = Number(existingMetadata.evidenceCount || 1);
            const incomingCount = Number(incomingMetadata.evidenceCount || 1);

            const incomingFPs: string[] = Array.isArray(incomingMetadata.evidenceFingerprints)
              ? incomingMetadata.evidenceFingerprints
              : incomingMetadata.evidenceFingerprint
              ? [incomingMetadata.evidenceFingerprint]
              : [
                  computeEvidenceFingerprint({
                    userId: userUuid,
                    candidateKey: options?.factKey || factKey,
                    conversationId: (Array.isArray(incomingMetadata.conversationIds) && incomingMetadata.conversationIds[0]) || '',
                    canonicalFact: cleanText,
                    rawSignal: typeof incomingMetadata.rawSignal === 'string' ? incomingMetadata.rawSignal : undefined,
                    source,
                  }),
                ];

            const existingFPs: string[] = Array.isArray(existingMetadata.evidenceFingerprints)
              ? existingMetadata.evidenceFingerprints
              : [];

            const newFPs = incomingFPs.filter((fp) => !existingFPs.includes(fp));
            const isDuplicateObservation = existingFPs.length > 0 && newFPs.length === 0;

            const updatedFPs = isDuplicateObservation
              ? existingFPs
              : [...existingFPs, ...newFPs];

            const totalCount = isDuplicateObservation
              ? existingCount
              : (existingFPs.length > 0
                  ? existingCount + (incomingCount > 1 ? newFPs.length : 1)
                  : existingCount + incomingCount);

            const existingConvIds: string[] = Array.isArray(existingMetadata.conversationIds)
              ? existingMetadata.conversationIds
              : existingMetadata.conversationId
              ? [String(existingMetadata.conversationId)]
              : [];
            const incomingConvIds: string[] = Array.isArray(incomingMetadata.conversationIds)
              ? incomingMetadata.conversationIds
              : incomingMetadata.conversationId
              ? [String(incomingMetadata.conversationId)]
              : [];

            const existingConvCount = typeof existingMetadata.conversationCount === 'number'
              ? existingMetadata.conversationCount
              : (existingConvIds.length > 0 ? existingConvIds.length : 0);
            const incomingConvCount = typeof incomingMetadata.conversationCount === 'number'
              ? incomingMetadata.conversationCount
              : (incomingConvIds.length > 0 ? incomingConvIds.length : 0);

            const newlyAddedConvIds = incomingConvIds.filter((id) => id && !existingConvIds.includes(id));
            const totalConvCount = isDuplicateObservation
              ? existingConvCount
              : (existingConvCount === 0 && incomingConvCount === 0 && newlyAddedConvIds.length === 0
                  ? 0
                  : Math.max(
                      existingConvCount + newlyAddedConvIds.length,
                      incomingConvCount
                    ));

            const combinedConvIds = Array.from(new Set([...existingConvIds, ...incomingConvIds]));

            const existingSources: string[] = Array.isArray(existingMetadata.sources)
              ? existingMetadata.sources
              : [canonicalMem.source || 'automatic_extraction'];
            const incomingSources: string[] = Array.isArray(incomingMetadata.sources)
              ? incomingMetadata.sources
              : [source];
            const combinedSources = Array.from(new Set([...existingSources, ...incomingSources]));

            const calcDynamic = calculateDynamicConfidence({
              evidenceCount: totalCount,
              conversationCount: totalConvCount,
              sources: combinedSources as MemorySource[],
              isExplicit:
                combinedSources.includes('user_explicit') ||
                combinedSources.includes('agent_tool') ||
                Boolean(existingMetadata.isExplicit || incomingMetadata.isExplicit),
              category,
            });

            const finalConfidence = isDuplicateObservation
              ? (canonicalMem.confidence ?? 0.7)
              : Math.max(
                  canonicalMem.confidence ?? 0.7,
                  confidence,
                  consolidationResult.consolidatedConfidence ?? 0.7,
                  calcDynamic
                );

            const consolidatedFrom: string[] = Array.isArray(existingMetadata.consolidatedFrom)
              ? existingMetadata.consolidatedFrom
              : [];
            const candidateId = options?.metadata?.candidateId ? String(options.metadata.candidateId) : null;
            if (candidateId && !consolidatedFrom.includes(candidateId)) {
              consolidatedFrom.push(candidateId);
            }

            const updatedMetadata = {
              ...existingMetadata,
              ...incomingMetadata,
              evidenceCount: totalCount,
              conversationCount: totalConvCount,
              conversationIds: combinedConvIds.slice(-20),
              sources: combinedSources,
              consolidatedFrom: consolidatedFrom.slice(-10),
              consolidatedAt: new Date().toISOString(),
              consolidationReason: consolidationResult.reason,
              evidenceFingerprints: updatedFPs,
            };

            const primaryIncomingFP = incomingFPs[0] || '';
            const updateRes = await pool.query(
              `UPDATE memory_items
               SET fact_text = $2,
                   confidence = CASE
                     WHEN $6 != '' AND COALESCE(metadata->'evidenceFingerprints', '[]'::jsonb) ? $6
                       THEN memory_items.confidence
                     ELSE $3
                   END,
                   importance = $4,
                   metadata = CASE
                     WHEN $6 != '' AND COALESCE(memory_items.metadata->'evidenceFingerprints', '[]'::jsonb) ? $6
                       THEN memory_items.metadata
                     ELSE $5::jsonb
                   END,
                   updated_at = NOW()
               WHERE id = $1
               RETURNING id, user_id as "userId", fact_text as "factText", category,
                         status, fact_key as "factKey", source, confidence,
                         importance, temporal_state as "temporalState",
                         valid_from as "validFrom", valid_until as "validUntil", metadata,
                         created_at as "createdAt", updated_at as "updatedAt"`,
              [
                canonicalMem.id,
                consolidatedFactText,
                finalConfidence,
                consolidatedImportance,
                JSON.stringify(updatedMetadata),
                primaryIncomingFP,
              ]
            );

            return updateRes.rows[0] || canonicalMem;
          }
        }

        if (factKey) {
          const conflictingRows = activeRows.filter((m) => m.factKey === factKey);
          if (conflictingRows.length > 0) {
            const hasHigherAuthorityConflict = conflictingRows.some(
              (m) => (SOURCE_PRIORITY[m.source as MemorySource] || 1) > newPriority
            );

            if (hasHigherAuthorityConflict) {
              // Higher authority memory already active. Retain it.
              const highestAuthItem = conflictingRows.sort(
                (a, b) =>
                  (SOURCE_PRIORITY[b.source as MemorySource] || 1) -
                  (SOURCE_PRIORITY[a.source as MemorySource] || 1)
              )[0];
              return highestAuthItem;
            }

            // Supersede existing conflicting items
            const newId = uuidv4();
            await pool.query(
              `UPDATE memory_items
               SET status = 'superseded',
                   updated_at = NOW(),
                   metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{supersededBy}',
                     to_jsonb($2::text)
                   )
               WHERE user_id = $1 AND fact_key = $3 AND (status IS NULL OR status = 'active')`,
              [userUuid, newId, factKey]
            );

            const insertRes = await pool.query(
              `INSERT INTO memory_items (
                 id, user_id, fact_text, category, status, fact_key,
                 source, confidence, importance, temporal_state, valid_from, valid_until, metadata,
                 created_at, updated_at
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
               RETURNING id, user_id as "userId", fact_text as "factText", category,
                         status, fact_key as "factKey", source, confidence,
                         importance, temporal_state as "temporalState",
                         valid_from as "validFrom", valid_until as "validUntil", metadata,
                         created_at as "createdAt", updated_at as "updatedAt"`,
              [
                newId,
                userUuid,
                cleanText,
                category,
                status,
                factKey,
                source,
                confidence,
                importance,
                temporalState,
                validFrom,
                validUntil,
                JSON.stringify(options?.metadata || {}),
              ]
            );
            return insertRes.rows[0];
          }
        }

        // 5. Standard insert
        const id = uuidv4();
        const insertRes = await pool.query(
          `INSERT INTO memory_items (
             id, user_id, fact_text, category, status, fact_key,
             source, confidence, importance, temporal_state, valid_from, valid_until, metadata,
             created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
           RETURNING id, user_id as "userId", fact_text as "factText", category,
                     status, fact_key as "factKey", source, confidence,
                     importance, temporal_state as "temporalState",
                     valid_from as "validFrom", valid_until as "validUntil", metadata,
                     created_at as "createdAt", updated_at as "updatedAt"`,
          [
            id,
            userUuid,
            cleanText,
            category,
            status,
            factKey || null,
            source,
            confidence,
            importance,
            temporalState,
            validFrom,
            validUntil,
            JSON.stringify(options?.metadata || {}),
          ]
        );

        logger.info(`Saved long-term memory fact for user [${userId}]`, {
          factText: cleanText,
          category,
          factKey,
          source,
        });
        return insertRes.rows[0];
      } catch (err: any) {
        logger.warn('Failed to insert memory item into database, falling back to memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const userItems = this.inMemoryItems.get(userUuid) || this.inMemoryItems.get(userId) || [];
    const now = new Date();
    const activeItems = userItems.filter((m) => {
      const isActive = !m.status || m.status === 'active';
      const notExpired = !m.validUntil || new Date(m.validUntil).getTime() > now.getTime();
      return isActive && notExpired;
    });



    // 3. Phase 2.5: Semantic Contradiction & Evolution Reasoning
    const relationResult = SemanticContradictionService.getInstance().evaluateRelationAgainstActive(
      {
        factText: cleanText,
        category,
        temporalState,
        factKey,
        source,
        validUntil,
      },
      activeItems
    );

    const newId = uuidv4();

    if (relationResult.relation === 'contradicts' && relationResult.targetMemoryId) {
      const targetMem = activeItems.find((m) => m.id === relationResult.targetMemoryId);
      if (targetMem) {
        const existingPrio = SOURCE_PRIORITY[targetMem.source as MemorySource] || 1;
        if (newPriority >= existingPrio) {
          targetMem.status = 'superseded';
          targetMem.updatedAt = new Date();
          targetMem.metadata = {
            ...(targetMem.metadata || {}),
            supersededBy: newId,
            supersededAt: new Date().toISOString(),
            supersedeReason: relationResult.reason,
            relationResult: {
              relation: relationResult.relation,
              reason: relationResult.reason,
              signals: relationResult.signals,
            },
          };
        } else {
          // Higher authority memory already active. Retain it.
          return targetMem;
        }
      }
    } else if (relationResult.relation === 'evolves' && relationResult.targetMemoryId) {
      const targetMem = activeItems.find((m) => m.id === relationResult.targetMemoryId);
      if (targetMem) {
        const existingPrio = SOURCE_PRIORITY[targetMem.source as MemorySource] || 1;
        if (newPriority >= existingPrio) {
          targetMem.temporalState = 'historical';
          targetMem.updatedAt = new Date();
          targetMem.metadata = {
            ...(targetMem.metadata || {}),
            evolvedTo: newId,
            evolvedAt: new Date().toISOString(),
            evolutionReason: relationResult.reason,
            relationResult: {
              relation: relationResult.relation,
              reason: relationResult.reason,
              signals: relationResult.signals,
            },
          };
        }
      }
    }

    // 4. Phase 2.6: Memory Consolidation (Reinforce / Merge)
    const consolidationResult = MemoryConsolidationService.getInstance().evaluateConsolidation(
      {
        factText: cleanText,
        category,
        temporalState,
        factKey,
        source,
        confidence,
        importance,
        validUntil,
        metadata: options?.metadata || {},
      },
      activeItems
    );

    if (
      (consolidationResult.action === 'reinforce' || consolidationResult.action === 'merge') &&
      consolidationResult.canonicalMemoryId
    ) {
      const canonicalMem = activeItems.find((m) => m.id === consolidationResult.canonicalMemoryId);
      if (canonicalMem) {
        const consolidatedFactText = consolidationResult.consolidatedFactText || canonicalMem.factText;
        const consolidatedConfidence =
          consolidationResult.consolidatedConfidence ?? Math.max(canonicalMem.confidence ?? 0.7, confidence);
        const consolidatedImportance =
          consolidationResult.consolidatedImportance || canonicalMem.importance;

        const existingMetadata = canonicalMem.metadata || {};
        const incomingMetadata = options?.metadata || {};

        const existingCount = Number(existingMetadata.evidenceCount || 1);
        const incomingCount = Number(incomingMetadata.evidenceCount || 1);

        const incomingFPs: string[] = Array.isArray(incomingMetadata.evidenceFingerprints)
          ? incomingMetadata.evidenceFingerprints
          : incomingMetadata.evidenceFingerprint
          ? [incomingMetadata.evidenceFingerprint]
          : [
              computeEvidenceFingerprint({
                userId: userUuid,
                candidateKey: options?.factKey || factKey,
                conversationId: (Array.isArray(incomingMetadata.conversationIds) && incomingMetadata.conversationIds[0]) || '',
                canonicalFact: cleanText,
                rawSignal: typeof incomingMetadata.rawSignal === 'string' ? incomingMetadata.rawSignal : undefined,
                source,
              }),
            ];

        const existingFPs: string[] = Array.isArray(existingMetadata.evidenceFingerprints)
          ? existingMetadata.evidenceFingerprints
          : [];

        const newFPs = incomingFPs.filter((fp) => !existingFPs.includes(fp));
        const isDuplicateObservation = existingFPs.length > 0 && newFPs.length === 0;

        const updatedFPs = isDuplicateObservation
          ? existingFPs
          : [...existingFPs, ...newFPs];

        const totalCount = isDuplicateObservation
          ? existingCount
          : (existingFPs.length > 0
              ? existingCount + (incomingCount > 1 ? newFPs.length : 1)
              : existingCount + incomingCount);

        const existingConvIds: string[] = Array.isArray(existingMetadata.conversationIds)
          ? existingMetadata.conversationIds
          : existingMetadata.conversationId
          ? [String(existingMetadata.conversationId)]
          : [];
        const incomingConvIds: string[] = Array.isArray(incomingMetadata.conversationIds)
          ? incomingMetadata.conversationIds
          : incomingMetadata.conversationId
          ? [String(incomingMetadata.conversationId)]
          : [];

        const existingConvCount = typeof existingMetadata.conversationCount === 'number'
          ? existingMetadata.conversationCount
          : (existingConvIds.length > 0 ? existingConvIds.length : 0);
        const incomingConvCount = typeof incomingMetadata.conversationCount === 'number'
          ? incomingMetadata.conversationCount
          : (incomingConvIds.length > 0 ? incomingConvIds.length : 0);

        const newlyAddedConvIds = incomingConvIds.filter((id) => id && !existingConvIds.includes(id));
        const totalConvCount = isDuplicateObservation
          ? existingConvCount
          : (existingConvCount === 0 && incomingConvCount === 0 && newlyAddedConvIds.length === 0
              ? 0
              : Math.max(
                  existingConvCount + newlyAddedConvIds.length,
                  incomingConvCount
                ));

        const combinedConvIds = Array.from(new Set([...existingConvIds, ...incomingConvIds]));

        const existingSources: string[] = Array.isArray(existingMetadata.sources)
          ? existingMetadata.sources
          : [canonicalMem.source || 'automatic_extraction'];
        const incomingSources: string[] = Array.isArray(incomingMetadata.sources)
          ? incomingMetadata.sources
          : [source];
        const combinedSources = Array.from(new Set([...existingSources, ...incomingSources]));

        const calcDynamic = calculateDynamicConfidence({
          evidenceCount: totalCount,
          conversationCount: totalConvCount,
          sources: combinedSources as MemorySource[],
          isExplicit:
            combinedSources.includes('user_explicit') ||
            combinedSources.includes('agent_tool') ||
            Boolean(existingMetadata.isExplicit || incomingMetadata.isExplicit),
          category,
        });

        const finalConfidence = isDuplicateObservation
          ? (canonicalMem.confidence ?? 0.7)
          : Math.max(
              canonicalMem.confidence ?? 0.7,
              confidence,
              consolidationResult.consolidatedConfidence ?? 0.7,
              calcDynamic
            );

        const consolidatedFrom: string[] = Array.isArray(existingMetadata.consolidatedFrom)
          ? existingMetadata.consolidatedFrom
          : [];
        const candidateId = options?.metadata?.candidateId ? String(options.metadata.candidateId) : null;
        if (candidateId && !consolidatedFrom.includes(candidateId)) {
          consolidatedFrom.push(candidateId);
        }

        canonicalMem.factText = consolidatedFactText;
        canonicalMem.confidence = finalConfidence;
        canonicalMem.importance = consolidatedImportance;
        canonicalMem.updatedAt = new Date();
        canonicalMem.metadata = {
          ...existingMetadata,
          ...incomingMetadata,
          evidenceCount: totalCount,
          conversationCount: totalConvCount,
          conversationIds: combinedConvIds.slice(-20),
          sources: combinedSources,
          consolidatedFrom: consolidatedFrom.slice(-10),
          consolidatedAt: new Date().toISOString(),
          consolidationReason: consolidationResult.reason,
          evidenceFingerprints: updatedFPs,
        };

        return canonicalMem;
      }
    }

    if (factKey) {
      const conflicting = activeItems.filter((m) => m.factKey === factKey);
      if (conflicting.length > 0) {
        const hasHigherAuthorityConflict = conflicting.some(
          (m) => (SOURCE_PRIORITY[m.source as MemorySource] || 1) > newPriority
        );

        if (hasHigherAuthorityConflict) {
          const highestAuthItem = conflicting.sort(
            (a, b) =>
              (SOURCE_PRIORITY[b.source as MemorySource] || 1) -
              (SOURCE_PRIORITY[a.source as MemorySource] || 1)
          )[0];
          return highestAuthItem;
        }

        for (const oldItem of conflicting) {
          oldItem.status = 'superseded';
          oldItem.updatedAt = new Date();
          oldItem.metadata = {
            ...(oldItem.metadata || {}),
            supersededBy: newId,
            supersededAt: new Date().toISOString(),
            supersedeReason: `Superseded by newer fact with source ${source} (priority ${newPriority})`,
          };
        }
      }
    }

    const newItem: MemoryItemEntity = {
      id: newId,
      userId: userUuid,
      factText: cleanText,
      category,
      status,
      factKey: factKey || undefined,
      source,
      confidence,
      importance,
      temporalState,
      validFrom,
      validUntil,
      metadata: options?.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    userItems.push(newItem);
    this.inMemoryItems.set(userUuid, userItems);
    if (userId !== userUuid) {
      this.inMemoryItems.set(userId, userItems);
    }
    logger.info(`Saved in-memory memory fact for user [${userId}]`, {
      factText: cleanText,
      category,
      factKey,
      source,
    });
    return newItem;
  }

  /**
   * Retrieves active, non-expired memory facts for a user as plain strings.
   * Excludes superseded and expired items.
   */
  public async getMemories(userId: string, limit = 20): Promise<string[]> {
    const pool = this.db.getPool();
    const userUuid = await this.resolveUserId(userId);

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT fact_text as "factText", category
           FROM memory_items
           WHERE user_id = $1
             AND (status IS NULL OR status = 'active')
             AND (valid_until IS NULL OR valid_until > NOW())
           ORDER BY created_at DESC
           LIMIT $2`,
          [userUuid, limit]
        );

        return res.rows.map((r) => r.factText);
      } catch (err: any) {
        logger.warn('Failed to query memory items from database, falling back to memory store', {
          error: err.message,
        });
      }
    }

    const userItems = this.inMemoryItems.get(userUuid) || this.inMemoryItems.get(userId) || [];
    const now = new Date();
    return userItems
      .filter((m) => {
        const isActive = !m.status || m.status === 'active';
        const notExpired = !m.validUntil || new Date(m.validUntil).getTime() > now.getTime();
        return isActive && notExpired;
      })
      .slice(-limit)
      .map((m) => m.factText);
  }

  /**
   * Retrieves full structured active memory records for a user.
   */
  public async getActiveMemories(userId: string, limit = 50): Promise<MemoryItemEntity[]> {
    const pool = this.db.getPool();
    const userUuid = await this.resolveUserId(userId);

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id as "userId", fact_text as "factText", category,
                  status, fact_key as "factKey", source, confidence,
                  importance, temporal_state as "temporalState",
                  valid_from as "validFrom", valid_until as "validUntil", metadata,
                  created_at as "createdAt", updated_at as "updatedAt"
           FROM memory_items
           WHERE user_id = $1
             AND (status IS NULL OR status = 'active')
             AND (valid_until IS NULL OR valid_until > NOW())
           ORDER BY created_at DESC
           LIMIT $2`,
          [userUuid, limit]
        );

        return res.rows;
      } catch (err: any) {
        logger.warn('Failed to query active memory records, falling back to memory store', {
          error: err.message,
        });
      }
    }

    const userItems = this.inMemoryItems.get(userUuid) || this.inMemoryItems.get(userId) || [];
    const now = new Date();
    return userItems
      .filter((m) => {
        const isActive = !m.status || m.status === 'active';
        const notExpired = !m.validUntil || new Date(m.validUntil).getTime() > now.getTime();
        return isActive && notExpired;
      })
      .slice(-limit);
  }

  /**
   * Supersedes a fact by its ID.
   */
  public async supersedeFact(
    factId: string,
    supersededById?: string,
    reason?: string
  ): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE memory_items
           SET status = 'superseded',
               updated_at = NOW(),
               metadata = jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 '{supersededBy}',
                 to_jsonb($2::text)
               )
           WHERE id = $1`,
          [factId, supersededById || null]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to supersede fact in database', { error: err.message });
      }
    }

    for (const items of this.inMemoryItems.values()) {
      const item = items.find((i) => i.id === factId);
      if (item) {
        item.status = 'superseded';
        item.updatedAt = new Date();
        item.metadata = {
          ...(item.metadata || {}),
          supersededBy: supersededById,
          supersededAt: new Date().toISOString(),
          supersedeReason: reason || 'Explicitly superseded',
        };
        return true;
      }
    }
    return false;
  }

  /**
   * Updates an existing fact.
   */
  public async updateFact(
    factId: string,
    updates: Partial<MemoryItemEntity>
  ): Promise<MemoryItemEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const setClauses: string[] = ['updated_at = NOW()'];
        const values: any[] = [factId];
        let idx = 2;

        if (updates.factText !== undefined) {
          setClauses.push(`fact_text = $${idx++}`);
          values.push(updates.factText);
        }
        if (updates.status !== undefined) {
          setClauses.push(`status = $${idx++}`);
          values.push(updates.status);
        }
        if (updates.confidence !== undefined) {
          setClauses.push(`confidence = $${idx++}`);
          values.push(updates.confidence);
        }
        if (updates.importance !== undefined) {
          setClauses.push(`importance = $${idx++}`);
          values.push(updates.importance);
        }
        if (updates.validUntil !== undefined) {
          setClauses.push(`valid_until = $${idx++}`);
          values.push(updates.validUntil);
        }
        if (updates.metadata !== undefined) {
          setClauses.push(`metadata = $${idx++}`);
          values.push(JSON.stringify(updates.metadata));
        }

        const res = await pool.query(
          `UPDATE memory_items
           SET ${setClauses.join(', ')}
           WHERE id = $1
           RETURNING id, user_id as "userId", fact_text as "factText", category,
                     status, fact_key as "factKey", source, confidence,
                     importance, valid_until as "validUntil", metadata,
                     created_at as "createdAt", updated_at as "updatedAt"`,
          values
        );
        return res.rows[0] || null;
      } catch (err: any) {
        logger.warn('Failed to update fact in database', { error: err.message });
      }
    }

    for (const items of this.inMemoryItems.values()) {
      const item = items.find((i) => i.id === factId);
      if (item) {
        if (updates.factText !== undefined) item.factText = updates.factText;
        if (updates.status !== undefined) item.status = updates.status;
        if (updates.confidence !== undefined) item.confidence = updates.confidence;
        if (updates.importance !== undefined) item.importance = updates.importance;
        if (updates.validUntil !== undefined) item.validUntil = updates.validUntil;
        if (updates.metadata !== undefined) item.metadata = updates.metadata;
        item.updatedAt = new Date();
        return item;
      }
    }
    return null;
  }

  /**
   * Searches for potential duplicates of a fact for a user.
   */
  public async findPotentialDuplicates(
    userId: string,
    factText: string,
    category?: string
  ): Promise<MemoryItemEntity[]> {
    const active = await this.getActiveMemories(userId);
    const clean = normalizeFactText(factText).toLowerCase();

    return active.filter((item) => {
      // 1. Exact match
      if (normalizeFactText(item.factText).toLowerCase() === clean) return true;
      // 2. Token similarity in same category
      if (category && item.category === category) {
        return calculateTokenSimilarity(factText, item.factText) >= 0.85;
      }
      return false;
    });
  }

  /**
   * Deletes a fact by its ID.
   */
  public async deleteFact(factId: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        const res = await pool.query(`DELETE FROM memory_items WHERE id = $1`, [factId]);
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.warn('Failed to delete fact from database', { error: err.message });
      }
    }

    for (const items of this.inMemoryItems.values()) {
      const idx = items.findIndex((i) => i.id === factId);
      if (idx !== -1) {
        items.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Lists memory items with optional user and status filters and pagination.
   */
  public async listMemoryItems(options: {
    userId?: string;
    status?: string;
    category?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: MemoryItemEntity[]; total: number }> {
    const pool = this.db.getPool();
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);

    if (pool) {
      try {
        await this.ensureSchema();
        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];
        let pIdx = 1;

        if (options.userId) {
          const userUuid = toDeterministicUuid(options.userId);
          whereClauses.push(`m.user_id = $${pIdx}`);
          params.push(userUuid);
          pIdx++;
        }
        if (options.status) {
          whereClauses.push(`m.status = $${pIdx}`);
          params.push(options.status);
          pIdx++;
        }
        if (options.category) {
          whereClauses.push(`m.category = $${pIdx}`);
          params.push(options.category);
          pIdx++;
        }

        const whereSql = whereClauses.join(' AND ');

        const countRes = await pool.query(
          `SELECT COUNT(*) as total FROM memory_items m WHERE ${whereSql}`,
          params
        );
        const total = parseInt(countRes.rows[0]?.total || '0', 10);

        const listQuery = `
          SELECT m.id, m.user_id as "userId",
                 COALESCE(u.phone_number, wc.wa_id, '') as "userPhone",
                 m.fact_text as "factText",
                 m.category, m.status, m.fact_key as "factKey",
                 m.source, m.confidence, m.importance, m.temporal_state as "temporalState",
                 m.valid_from as "validFrom", m.valid_until as "validUntil",
                 m.metadata, m.created_at as "createdAt", m.updated_at as "updatedAt"
          FROM memory_items m
          LEFT JOIN users u ON u.id::text = m.user_id::text
          LEFT JOIN whatsapp_contacts wc ON wc.user_id::text = m.user_id::text
          WHERE ${whereSql}
          ORDER BY m.created_at DESC
          LIMIT $${pIdx} OFFSET $${pIdx + 1}
        `;
        params.push(limit, offset);

        const listRes = await pool.query(listQuery, params);
        const items: MemoryItemEntity[] = listRes.rows.map((r: any) => ({
          ...r,
          userPhone: (r.userPhone || '').replace(/^wa_/, ''),
          key: r.factKey || r.category || 'fact',
          value: r.factText,
        }));
        return { items, total };
      } catch (err: any) {
        logger.warn('Failed to list memory items from database', { error: err.message });
      }
    }

    // In-memory fallback
    let allItems: MemoryItemEntity[] = [];
    for (const items of this.inMemoryItems.values()) {
      allItems.push(...items);
    }
    if (options.userId) {
      const userUuid = toDeterministicUuid(options.userId);
      allItems = allItems.filter(i => i.userId === userUuid || i.userId === options.userId);
    }
    if (options.status) {
      allItems = allItems.filter(i => i.status === options.status);
    }
    if (options.category) {
      allItems = allItems.filter(i => i.category === options.category);
    }

    const total = allItems.length;
    allItems.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    const items = allItems.slice(offset, offset + limit).map(i => ({
      ...i,
      key: i.factKey || (typeof i.category === 'string' ? i.category : 'fact'),
      value: i.factText,
      userPhone: i.userId.replace(/^wa_/, ''),
    }));
    return { items, total };
  }

  /**
   * Retrieves a single memory item by its ID.
   */
  public async getMemoryById(id: string): Promise<MemoryItemEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(
          `SELECT m.id, m.user_id as "userId",
                  COALESCE(u.phone_number, wc.wa_id, '') as "userPhone",
                  m.fact_text as "factText",
                  m.category, m.status, m.fact_key as "factKey",
                  m.source, m.confidence, m.importance, m.temporal_state as "temporalState",
                  m.valid_from as "validFrom", m.valid_until as "validUntil",
                  m.metadata, m.created_at as "createdAt", m.updated_at as "updatedAt"
           FROM memory_items m
           LEFT JOIN users u ON u.id::text = m.user_id::text
           LEFT JOIN whatsapp_contacts wc ON wc.user_id::text = m.user_id::text
           WHERE m.id = $1 LIMIT 1`,
          [id]
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          ...r,
          userPhone: (r.userPhone || '').replace(/^wa_/, ''),
          key: r.factKey || r.category || 'fact',
          value: r.factText,
        };
      } catch (err: any) {
        logger.warn('Failed to get memory by ID from database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryItems.values()) {
      const item = items.find(i => i.id === id);
      if (item) {
        return {
          ...item,
          key: item.factKey || (typeof item.category === 'string' ? item.category : 'fact'),
          value: item.factText,
        };
      }
    }
    return null;
  }

  /**
   * Updates an existing memory fact (text, category, importance, status).
   */
  public async updateMemoryFact(
    id: string,
    updates: {
      factText?: string;
      category?: string;
      importance?: string;
      status?: string;
    }
  ): Promise<MemoryItemEntity | null> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        await this.ensureSchema();
        const setClauses: string[] = ['updated_at = NOW()'];
        const params: any[] = [id];
        let pIdx = 2;

        if (updates.factText) {
          setClauses.push(`fact_text = $${pIdx}`);
          params.push(updates.factText);
          pIdx++;
        }
        if (updates.category) {
          setClauses.push(`category = $${pIdx}`);
          params.push(updates.category);
          pIdx++;
        }
        if (updates.importance) {
          setClauses.push(`importance = $${pIdx}`);
          params.push(updates.importance);
          pIdx++;
        }
        if (updates.status) {
          setClauses.push(`status = $${pIdx}`);
          params.push(updates.status);
          pIdx++;
        }

        const query = `
          UPDATE memory_items
          SET ${setClauses.join(', ')}
          WHERE id = $1
          RETURNING id, user_id as "userId", fact_text as "factText",
                    category, status, fact_key as "factKey",
                    source, confidence, importance, temporal_state as "temporalState",
                    valid_from as "validFrom", valid_until as "validUntil",
                    metadata, created_at as "createdAt", updated_at as "updatedAt"
        `;
        const res = await pool.query(query, params);
        return res.rows[0] || null;
      } catch (err: any) {
        logger.error('Failed to update memory fact in database', { error: err.message, id });
      }
    }

    for (const items of this.inMemoryItems.values()) {
      const item = items.find(i => i.id === id);
      if (item) {
        if (updates.factText) item.factText = updates.factText;
        if (updates.category) item.category = updates.category as any;
        if (updates.importance) item.importance = updates.importance as any;
        if (updates.status) item.status = updates.status as any;
        item.updatedAt = new Date();
        return item;
      }
    }
    return null;
  }

  /**
   * Purges all memories for a given user (admin operation).
   */
  public async purgeUserMemories(userId: string): Promise<number> {
    const userUuid = toDeterministicUuid(userId);
    const pool = this.db.getPool();
    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(`DELETE FROM memory_items WHERE user_id = $1`, [userUuid]);
        return res.rowCount ?? 0;
      } catch (err: any) {
        logger.error('Failed to purge user memories from database', { error: err.message, userId });
      }
    }

    const items = this.inMemoryItems.get(userUuid) || this.inMemoryItems.get(userId);
    const count = items ? items.length : 0;
    this.inMemoryItems.delete(userUuid);
    this.inMemoryItems.delete(userId);
    return count;
  }

  /**
   * Resets the in-memory fallback cache (used for test isolation).
   */
  public clearInMemoryStore(): void {
    this.inMemoryItems.clear();
    this.evidenceRepo.clearInMemoryStore();
  }

  /**
   * Automatically inspects incoming user text for critical personal facts and saves them.
   * Isolates Language and Personality preferences into UserPreferenceRepository,
   * passes candidates through MemorySafetyGate, records observations in MemoryEvidenceRepository,
   * and promotes qualified evidence candidates into memory_items.
   * Returns descriptions of newly detected/saved items.
   */
  public async extractAndSaveFacts(
    userId: string,
    text: string,
    conversationId?: string
  ): Promise<string[]> {
    const extractor = MemoryCandidateExtractor.getInstance();
    const candidates = extractor.extractCandidates(text);
    const saved: string[] = [];

    for (const candidate of candidates) {
      if (candidate.isPreference) {
        // Route to user_preferences, NEVER memory_items!
        if (candidate.preferenceType === 'language' && candidate.preferenceData) {
          await this.userPreferenceRepo.setLanguagePreference(
            userId,
            candidate.preferenceData as LanguagePreference
          );
          saved.push(candidate.factText);
        } else if (candidate.preferenceType === 'personality' && candidate.preferenceData) {
          await this.userPreferenceRepo.setPersonalityPreference(
            userId,
            candidate.preferenceData as PersonalityPreference
          );
          saved.push(candidate.factText);
        }
      } else {
        // Run candidate through Safety Gate
        const decision = MemorySafetyGate.getInstance().evaluate(
          candidate.factText,
          candidate.category
        );
        if (!decision.allowed) {
          logger.warn('Automatic extraction candidate blocked by safety gate', {
            reason: decision.reason,
            category: candidate.category,
          });
          continue;
        }

        // Phase 2.2: Evidence & Observation Engine
        const candidateKey =
          candidate.candidateKey ||
          candidate.factKey ||
          deriveFactKey(candidate.factText, candidate.category) ||
          `generic.${normalizeFactText(candidate.factText).slice(0, 30)}`;

        const obsResult = await this.evidenceRepo.recordObservation({
          userId,
          candidateKey,
          category: candidate.category,
          rawSignal: text,
          canonicalFact: candidate.factText,
          source: candidate.source,
          confidence: candidate.confidence,
          conversationId,
          isExplicit: candidate.isExplicit,
          temporalState: candidate.temporalState,
          validFrom: candidate.validFrom,
          validUntil: candidate.validUntil,
          temporalMetadata: candidate.temporalMetadata,
          metadata: {
            factKey: candidate.factKey,
            isExplicit: candidate.isExplicit,
            ...(candidate.temporalMetadata ? { temporalMetadata: candidate.temporalMetadata } : {}),
          },
        });

        if (obsResult.shouldPromote) {
          const savedMemory = await this.saveFact(
            userId,
            candidate.factText,
            candidate.category,
            {
              source: candidate.source,
              factKey: candidate.factKey,
              confidence: obsResult.candidate.confidence,
              importance: obsResult.candidate.importance,
              temporalState: obsResult.candidate.temporalState || candidate.temporalState,
              validFrom: obsResult.candidate.validFrom || candidate.validFrom,
              validUntil: candidate.validUntil,
              metadata: {
                isExplicit: candidate.isExplicit,
                conversationIds: obsResult.candidate.conversationIds,
                conversationCount: obsResult.candidate.conversationCount,
                evidenceCount: obsResult.candidate.evidenceCount,
                sources: obsResult.candidate.sources,
                candidateId: obsResult.candidate.id,
                ...(candidate.temporalMetadata ? { temporalMetadata: candidate.temporalMetadata } : {}),
              },
            }
          );
          if (savedMemory?.id) {
            await this.evidenceRepo.markPromoted(userId, candidateKey, savedMemory.id);
          }
          saved.push(candidate.factText);
        } else {
          logger.debug('Memory candidate retained in observing stage', {
            candidateKey,
            evidenceCount: obsResult.candidate.evidenceCount,
            conversationCount: obsResult.candidate.conversationCount,
            evidenceStrength: obsResult.candidate.evidenceStrength,
          });
        }
      }
    }

    return saved;
  }

  /**
   * Consolidates all existing active memories for a user into canonical representations,
   * merging duplicates and preserving evidence, sources, and temporal separation.
   */
  public async consolidateMemoriesForUser(userId: string): Promise<ConsolidationResult[]> {
    const active = await this.getActiveMemories(userId);
    const results: ConsolidationResult[] = [];
    const pool = this.db.getPool();

    // Group active memories by (temporalState, category)
    const groups = new Map<string, MemoryItemEntity[]>();
    for (const mem of active) {
      // Phase 2.8: Defense-in-depth safety filter
      const safety = MemorySafetyGate.getInstance().evaluate(mem.factText, mem.category);
      if (!safety.allowed) {
        continue;
      }
      const key = `${mem.temporalState || 'unknown'}:${mem.category || 'general'}`;
      const list = groups.get(key) || [];
      list.push(mem);
      groups.set(key, list);
    }

    for (const [, mems] of groups.entries()) {
      if (mems.length <= 1) continue;

      const visited = new Set<string>();

      for (let i = 0; i < mems.length; i++) {
        const canonical = mems[i];
        if (visited.has(canonical.id)) continue;

        for (let j = i + 1; j < mems.length; j++) {
          const duplicate = mems[j];
          if (visited.has(duplicate.id)) continue;

          const evalResult = MemoryConsolidationService.getInstance().evaluateConsolidation(
            {
              id: duplicate.id,
              factText: duplicate.factText,
              category: duplicate.category,
              temporalState: duplicate.temporalState,
              factKey: duplicate.factKey,
              source: duplicate.source,
              confidence: duplicate.confidence,
              importance: duplicate.importance,
              metadata: duplicate.metadata,
            },
            [canonical]
          );

          if (evalResult.action === 'reinforce' || evalResult.action === 'merge') {
            visited.add(duplicate.id);

            const canonicalText = evalResult.consolidatedFactText || canonical.factText;
            const canonicalConf = evalResult.consolidatedConfidence ?? canonical.confidence;
            const canonicalImp = evalResult.consolidatedImportance || canonical.importance;

            const existingMeta = canonical.metadata || {};
            const dupMeta = duplicate.metadata || {};

            const canonicalFPs: string[] = Array.isArray(existingMeta.evidenceFingerprints)
              ? existingMeta.evidenceFingerprints
              : [`mem:${canonical.id}`];
            const dupFPs: string[] = Array.isArray(dupMeta.evidenceFingerprints)
              ? dupMeta.evidenceFingerprints
              : [`mem:${duplicate.id}`];
            const combinedFPs = Array.from(new Set([...canonicalFPs, ...dupFPs]));

            const newDupFPs = dupFPs.filter((fp) => !canonicalFPs.includes(fp));
            const isDuplicateAlreadyMerged = canonicalFPs.length > 0 && newDupFPs.length === 0;

            const canonicalEv = Number(existingMeta.evidenceCount || 1);
            const dupEv = Number(dupMeta.evidenceCount || 1);

            const totalEv = isDuplicateAlreadyMerged
              ? canonicalEv
              : (canonicalFPs.length > 0 && dupFPs.length > 0
                  ? Math.max(combinedFPs.length, canonicalEv + newDupFPs.length)
                  : canonicalEv + dupEv);

            const existingConvs: string[] = Array.isArray(existingMeta.conversationIds)
              ? existingMeta.conversationIds
              : existingMeta.conversationId
              ? [String(existingMeta.conversationId)]
              : [];
            const dupConvs: string[] = Array.isArray(dupMeta.conversationIds)
              ? dupMeta.conversationIds
              : dupMeta.conversationId
              ? [String(dupMeta.conversationId)]
              : [];
            const convs = Array.from(new Set([...existingConvs, ...dupConvs]));

            const existingConvCount = typeof existingMeta.conversationCount === 'number'
              ? existingMeta.conversationCount
              : (existingConvs.length > 0 ? existingConvs.length : 0);
            const dupConvCount = typeof dupMeta.conversationCount === 'number'
              ? dupMeta.conversationCount
              : (dupConvs.length > 0 ? dupConvs.length : 0);

            const newlyAddedConvs = dupConvs.filter((id) => id && !existingConvs.includes(id));
            const totalConvCount = (existingConvCount === 0 && dupConvCount === 0 && convs.length === 0)
              ? 0
              : Math.max(convs.length, existingConvCount + newlyAddedConvs.length, dupConvCount);

            const sources = Array.from(new Set([
              ...(Array.isArray(existingMeta.sources) ? existingMeta.sources : [canonical.source || 'automatic_extraction']),
              ...(Array.isArray(dupMeta.sources) ? dupMeta.sources : [duplicate.source || 'automatic_extraction']),
            ]));
            const mergedFrom = Array.from(new Set([
              ...(Array.isArray(existingMeta.consolidatedFrom) ? existingMeta.consolidatedFrom : []),
              duplicate.id,
            ]));

            const calcDynamic = calculateDynamicConfidence({
              evidenceCount: totalEv,
              conversationCount: totalConvCount,
              sources: sources as MemorySource[],
              isExplicit:
                sources.includes('user_explicit') ||
                sources.includes('agent_tool') ||
                Boolean(existingMeta.isExplicit || dupMeta.isExplicit),
              category: canonical.category,
            });
            const finalCanonicalConf = Math.max(
              canonicalConf ?? 0.7,
              calcDynamic
            );

            const updatedMeta = {
              ...existingMeta,
              evidenceCount: totalEv,
              conversationCount: totalConvCount,
              conversationIds: convs.slice(-20),
              sources,
              consolidatedFrom: mergedFrom.slice(-10),
              consolidatedAt: new Date().toISOString(),
              consolidationReason: evalResult.reason,
              evidenceFingerprints: combinedFPs,
            };

            const updatedDupMeta = {
              ...(duplicate.metadata || {}),
              supersededBy: canonical.id,
              supersededAt: new Date().toISOString(),
              supersedeType: 'consolidation',
              consolidatedInto: canonical.id,
              consolidatedAt: new Date().toISOString(),
              consolidationReason: evalResult.reason || 'same_canonical_fact',
            };

            // Supersede duplicate in SQL (strictly non-destructive: status='superseded' with traceability)
            if (pool) {
              await pool.query(
                `UPDATE memory_items
                 SET status = 'superseded',
                     updated_at = NOW(),
                     metadata = $2::jsonb
                 WHERE id = $1`,
                [duplicate.id, JSON.stringify(updatedDupMeta)]
              );

              await pool.query(
                `UPDATE memory_items
                 SET fact_text = $2,
                     confidence = $3,
                     importance = $4,
                     metadata = $5,
                     updated_at = NOW()
                 WHERE id = $1`,
                [canonical.id, canonicalText, finalCanonicalConf, canonicalImp, JSON.stringify(updatedMeta)]
              );
            }

            // In-memory update (strictly non-destructive: status='superseded' with traceability)
            duplicate.status = 'superseded';
            duplicate.updatedAt = new Date();
            duplicate.metadata = updatedDupMeta;

            canonical.factText = canonicalText;
            canonical.confidence = finalCanonicalConf;
            canonical.importance = canonicalImp;
            canonical.metadata = updatedMeta;
            canonical.updatedAt = new Date();

            results.push({
              action: 'merge',
              canonicalMemoryId: canonical.id,
              mergedMemoryIds: [duplicate.id],
              preservedMemoryIds: [canonical.id],
              reason: evalResult.reason,
              signals: evalResult.signals,
            });
          }
        }
      }
    }

    return results;
  }
}
