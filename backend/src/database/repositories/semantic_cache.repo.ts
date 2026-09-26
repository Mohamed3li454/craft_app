import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { logger } from '../../core/logger';
import {
  SemanticCacheItem,
  SemanticCacheMatch,
  FindSimilarOptions,
  CreateSemanticCacheDto,
  UpdateSemanticCacheDto,
  ResponseStrategy,
} from './semantic_cache.types';

function computeCosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export class SemanticCacheRepository {
  private inMemoryItems: Map<string, SemanticCacheItem> = new Map();
  private schemaChecked = false;

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  /**
   * Safe, idempotent migration to ensure pgvector extension and semantic columns exist in faq_items.
   * Preserves all existing data and backfills missing semantic fields language-neutrally.
   */
  public async ensureSchema(hnswIndexDimension?: number): Promise<void> {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;

    try {
      // 1. Ensure pgvector extension
      await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

      // 2. Add new columns to faq_items if they do not exist
      await pool.query(`
        ALTER TABLE faq_items 
          ADD COLUMN IF NOT EXISTS intent VARCHAR(100),
          ADD COLUMN IF NOT EXISTS examples TEXT[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS response_strategy VARCHAR(50) NOT NULL DEFAULT 'dynamic_template',
          ADD COLUMN IF NOT EXISTS response_templates JSONB NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS is_cacheable BOOLEAN NOT NULL DEFAULT true,
          ADD COLUMN IF NOT EXISTS is_dynamic BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS requires_search BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS requires_user_context BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS confidence_threshold REAL NOT NULL DEFAULT 0.88,
          ADD COLUMN IF NOT EXISTS embedding vector,
          ADD COLUMN IF NOT EXISTS embedding_dimension INT,
          ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE;
      `);

      // 3. Backfill existing rows non-destructively and language-neutrally
      await pool.query(`
        UPDATE faq_items
        SET 
          intent = COALESCE(intent, category),
          examples = CASE 
            WHEN examples IS NULL OR cardinality(examples) = 0 THEN patterns 
            ELSE examples 
          END,
          response_strategy = CASE
            WHEN response_strategy IS NULL OR response_strategy = 'template' THEN 'dynamic_template'
            ELSE response_strategy
          END,
          response_templates = CASE 
            WHEN response_templates IS NULL OR response_templates = '{}'::jsonb THEN 
              jsonb_build_object('default', jsonb_build_array(response))
            WHEN NOT (response_templates ? 'default') THEN
              response_templates || jsonb_build_object('default', jsonb_build_array(response))
            ELSE response_templates 
          END
        WHERE intent IS NULL 
           OR examples IS NULL 
           OR cardinality(examples) = 0 
           OR response_strategy = 'template'
           OR response_templates IS NULL 
           OR response_templates = '{}'::jsonb
           OR NOT (response_templates ? 'default');
      `);

      // 4. Create standard B-tree indexes for fast filtering
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_faq_items_intent ON faq_items(intent);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_faq_items_is_active_cacheable ON faq_items(is_active, is_cacheable);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_faq_items_embedding_dimension ON faq_items(embedding_dimension);`);

      // 5. Create secure Server-Side Stored Procedure / Function for Semantic Search
      // Threshold Semantics:
      // - Per-entry threshold (f.confidence_threshold) is ALWAYS strictly enforced.
      // - Caller query threshold (match_threshold) acts as an optional stricter floor, but NEVER lowers the per-entry safety threshold.
      // - Effective threshold = GREATEST(f.confidence_threshold, match_threshold).
      await pool.query(`
        CREATE OR REPLACE FUNCTION match_semantic_cache(
          query_embedding vector,
          match_threshold float DEFAULT NULL,
          match_count int DEFAULT 5,
          query_dimension int DEFAULT NULL
        )
        RETURNS TABLE (
          id uuid,
          intent varchar,
          category varchar,
          title varchar,
          examples text[],
          patterns text[],
          response text,
          response_strategy varchar,
          response_templates jsonb,
          match_type varchar,
          is_active boolean,
          is_cacheable boolean,
          is_dynamic boolean,
          requires_search boolean,
          requires_user_context boolean,
          confidence_threshold real,
          similarity float,
          hit_count int,
          embedding_dimension int,
          last_used_at timestamptz,
          created_at timestamptz,
          updated_at timestamptz
        )
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        BEGIN
          RETURN QUERY
          SELECT
            f.id,
            f.intent,
            f.category,
            f.title,
            f.examples,
            f.patterns,
            f.response,
            f.response_strategy,
            f.response_templates,
            f.match_type,
            f.is_active,
            f.is_cacheable,
            f.is_dynamic,
            f.requires_search,
            f.requires_user_context,
            f.confidence_threshold,
            (1 - (f.embedding <=> query_embedding))::float AS similarity,
            f.hit_count,
            f.embedding_dimension,
            f.last_used_at,
            f.created_at,
            f.updated_at
          FROM faq_items f
          WHERE f.is_active = true
            AND f.is_cacheable = true
            AND f.embedding IS NOT NULL
            AND (query_dimension IS NULL OR f.embedding_dimension = query_dimension)
            AND (1 - (f.embedding <=> query_embedding)) >= (
              CASE 
                WHEN match_threshold IS NOT NULL THEN GREATEST(f.confidence_threshold, match_threshold)
                ELSE f.confidence_threshold
              END
            )
          ORDER BY f.embedding <=> query_embedding ASC
          LIMIT match_count;
        END;
        $$;
      `);

      // 6. Security: Restrict execution strictly to server-side roles
      try {
        await pool.query(`
          REVOKE EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) FROM PUBLIC;
          REVOKE EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) FROM anon;
          REVOKE EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) FROM authenticated;
          GRANT EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) TO service_role;
          GRANT EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) TO postgres;
        `);
      } catch (secErr: any) {
        logger.warn('Privilege adjustment for match_semantic_cache skipped or partially applied', {
          error: secErr.message,
        });
      }

      // 7. Optional HNSW index if explicitly requested for benchmarks/production
      if (hnswIndexDimension && hnswIndexDimension > 0) {
        await this.ensureVectorIndex(hnswIndexDimension);
      }

      this.schemaChecked = true;
      logger.info('SemanticCacheRepository schema ensured successfully');
    } catch (err: any) {
      logger.error('Failed to ensure semantic cache schema in PostgreSQL', { error: err.message });
      throw err;
    }
  }

  /**
   * Creates an HNSW index on the unconstrained vector column for a specific dimension.
   * Kept as a tool for future scaling without premature activation.
   */
  public async ensureVectorIndex(dimension: number): Promise<void> {
    const pool = this.db.getPool();
    if (!pool || !dimension || dimension <= 0) return;

    try {
      const indexName = `idx_faq_items_embedding_hnsw_${dimension}`;
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ${indexName}
        ON faq_items USING hnsw ((embedding::vector(${dimension})) vector_cosine_ops)
        WHERE embedding IS NOT NULL AND embedding_dimension = ${dimension};
      `);
      logger.info(`HNSW vector index created or verified for dimension ${dimension}`);
    } catch (err: any) {
      logger.warn(`Failed to create HNSW vector index for dimension ${dimension}`, { error: err.message });
    }
  }

  /**
   * Server-side similarity search using cosine distance (<=>).
   *
   * Threshold Semantics:
   * - Each entry's individual confidence_threshold is ALWAYS enforced.
   * - If caller passes options.threshold, effective threshold = GREATEST(entry.confidence_threshold, options.threshold).
   * - Caller-passed threshold cannot bypass/lower the per-entry safety threshold.
   */
  public async findSimilar(vector: number[], options?: FindSimilarOptions): Promise<SemanticCacheMatch[]> {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Vector must be a non-empty array of numbers');
    }

    for (let i = 0; i < vector.length; i++) {
      if (typeof vector[i] !== 'number' || !Number.isFinite(vector[i])) {
        throw new Error(`Vector contains invalid element at index ${i}: ${vector[i]}`);
      }
    }

    const dimension = options?.dimension ?? vector.length;
    const queryThreshold = options?.threshold !== undefined ? options.threshold : null;
    const limit = options?.limit ?? 3;
    const category = options?.category ?? null;

    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();

      const vectorString = `[${vector.join(',')}]`;
      const query = `
        SELECT 
          id, intent, category, title, examples, patterns, response,
          response_strategy, response_templates, match_type, is_active,
          is_cacheable, is_dynamic, requires_search, requires_user_context,
          confidence_threshold, hit_count, embedding_dimension,
          last_used_at, created_at, updated_at,
          (1 - (embedding <=> $1::vector))::float AS similarity
        FROM faq_items
        WHERE is_active = true 
          AND is_cacheable = true 
          AND embedding IS NOT NULL
          AND ($2::int IS NULL OR embedding_dimension = $2::int)
          AND (1 - (embedding <=> $1::vector)) >= (
            CASE 
              WHEN $3::float IS NOT NULL THEN GREATEST(confidence_threshold, $3::float)
              ELSE confidence_threshold
            END
          )
          AND ($4::varchar IS NULL OR category = $4::varchar)
        ORDER BY embedding <=> $1::vector ASC
        LIMIT $5::int;
      `;

      try {
        const res = await pool.query(query, [vectorString, dimension, queryThreshold, category, limit]);
        return res.rows.map((r: any) => ({
          similarity: parseFloat(r.similarity),
          item: this.mapRowToItem(r),
        }));
      } catch (err: any) {
        logger.error('Failed to execute semantic search query in PostgreSQL', { error: err.message });
        throw err;
      }
    }

    // In-memory fallback
    const matches: SemanticCacheMatch[] = [];
    for (const item of this.inMemoryItems.values()) {
      if (!item.isActive || !item.isCacheable || !item.embedding) continue;
      if (dimension && item.embeddingDimension && item.embeddingDimension !== dimension) continue;
      if (category && item.category !== category) continue;

      const sim = computeCosineSimilarity(vector, item.embedding);
      const effectiveThreshold = queryThreshold !== null 
        ? Math.max(item.confidenceThreshold, queryThreshold) 
        : item.confidenceThreshold;

      if (sim >= effectiveThreshold) {
        matches.push({ item, similarity: sim });
      }
    }

    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, limit);
  }

  /**
   * Finds an active item by exact intent or category name.
   */
  public async findByIntent(intent: string): Promise<SemanticCacheItem | null> {
    if (!intent) return null;
    const cleanIntent = intent.trim().toLowerCase();

    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(
        `SELECT * FROM faq_items 
         WHERE is_active = true AND (LOWER(intent) = $1 OR LOWER(category) = $1)
         ORDER BY hit_count DESC LIMIT 1`,
        [cleanIntent]
      );
      if (res.rows.length === 0) return null;
      return this.mapRowToItem(res.rows[0]);
    }

    for (const item of this.inMemoryItems.values()) {
      if (item.isActive && (item.intent.toLowerCase() === cleanIntent || item.category.toLowerCase() === cleanIntent)) {
        return item;
      }
    }
    return null;
  }

  public async findById(id: string): Promise<SemanticCacheItem | null> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(`SELECT * FROM faq_items WHERE id = $1`, [id]);
      if (res.rows.length === 0) return null;
      return this.mapRowToItem(res.rows[0]);
    }
    return this.inMemoryItems.get(id) || null;
  }

  /**
   * Creates a new semantic cache item with optional embedding.
   */
  public async create(dto: CreateSemanticCacheDto): Promise<SemanticCacheItem> {
    const id = uuidv4();
    const category = (dto.category || 'custom').trim();
    const intent = (dto.intent || category).trim();
    const title = dto.title.trim();
    const examples = (dto.examples || dto.patterns || []).map((e) => e.trim()).filter(Boolean);
    const patterns = (dto.patterns || dto.examples || []).map((p) => p.trim()).filter(Boolean);
    const response = dto.response.trim();
    const responseStrategy: ResponseStrategy = dto.responseStrategy || 'dynamic_template';
    const responseTemplates = dto.responseTemplates || { default: [response] };
    const matchType = dto.matchType === 'exact' ? 'exact' : 'contains';
    const isCacheable = dto.isCacheable !== undefined ? dto.isCacheable : true;
    const isDynamic = dto.isDynamic !== undefined ? dto.isDynamic : false;
    const requiresSearch = dto.requiresSearch !== undefined ? dto.requiresSearch : false;
    const requiresUserContext = dto.requiresUserContext !== undefined ? dto.requiresUserContext : false;
    const confidenceThreshold = dto.confidenceThreshold !== undefined ? dto.confidenceThreshold : 0.88;
    const isActive = dto.isActive !== undefined ? dto.isActive : true;

    let embeddingStr: string | null = null;
    let dimension: number | null = null;
    if (dto.embedding && dto.embedding.length > 0) {
      embeddingStr = `[${dto.embedding.join(',')}]`;
      dimension = dto.embedding.length;
    }

    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(
        `INSERT INTO faq_items (
          id, category, intent, title, examples, patterns, response,
          response_strategy, response_templates, match_type, is_active,
          is_cacheable, is_dynamic, requires_search, requires_user_context,
          confidence_threshold, embedding, embedding_dimension, hit_count,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::vector, $18, 0, NOW(), NOW()
        ) RETURNING *`,
        [
          id, category, intent, title, examples, patterns, response,
          responseStrategy, JSON.stringify(responseTemplates), matchType, isActive,
          isCacheable, isDynamic, requiresSearch, requiresUserContext,
          confidenceThreshold, embeddingStr, dimension
        ]
      );
      return this.mapRowToItem(res.rows[0]);
    }

    const now = new Date().toISOString();
    const item: SemanticCacheItem = {
      id,
      intent,
      category,
      title,
      examples,
      patterns,
      response,
      responseStrategy,
      responseTemplates,
      matchType,
      isCacheable,
      isDynamic,
      requiresSearch,
      requiresUserContext,
      confidenceThreshold,
      embedding: dto.embedding || null,
      embeddingDimension: dimension,
      isActive,
      hitCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryItems.set(id, item);
    return item;
  }

  /**
   * Updates an existing semantic cache item.
   */
  public async update(id: string, dto: UpdateSemanticCacheDto): Promise<SemanticCacheItem | null> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const updates: string[] = ['updated_at = NOW()'];
      const values: any[] = [];
      let idx = 1;

      if (dto.intent !== undefined) {
        updates.push(`intent = $${idx++}`);
        values.push(dto.intent.trim());
      }
      if (dto.category !== undefined) {
        updates.push(`category = $${idx++}`);
        values.push(dto.category.trim());
      }
      if (dto.title !== undefined) {
        updates.push(`title = $${idx++}`);
        values.push(dto.title.trim());
      }
      if (dto.examples !== undefined) {
        updates.push(`examples = $${idx++}`);
        const cleaned = dto.examples.map((e) => e.trim()).filter(Boolean);
        values.push(cleaned);
        if (dto.patterns === undefined) {
          updates.push(`patterns = $${idx++}`);
          values.push(cleaned);
        }
      }
      if (dto.patterns !== undefined) {
        updates.push(`patterns = $${idx++}`);
        values.push(dto.patterns.map((p) => p.trim()).filter(Boolean));
      }
      if (dto.response !== undefined) {
        updates.push(`response = $${idx++}`);
        values.push(dto.response.trim());
      }
      if (dto.responseStrategy !== undefined) {
        updates.push(`response_strategy = $${idx++}`);
        values.push(dto.responseStrategy);
      }
      if (dto.responseTemplates !== undefined) {
        updates.push(`response_templates = $${idx++}`);
        values.push(JSON.stringify(dto.responseTemplates));
      }
      if (dto.matchType !== undefined) {
        updates.push(`match_type = $${idx++}`);
        values.push(dto.matchType === 'exact' ? 'exact' : 'contains');
      }
      if (dto.isCacheable !== undefined) {
        updates.push(`is_cacheable = $${idx++}`);
        values.push(dto.isCacheable);
      }
      if (dto.isDynamic !== undefined) {
        updates.push(`is_dynamic = $${idx++}`);
        values.push(dto.isDynamic);
      }
      if (dto.requiresSearch !== undefined) {
        updates.push(`requires_search = $${idx++}`);
        values.push(dto.requiresSearch);
      }
      if (dto.requiresUserContext !== undefined) {
        updates.push(`requires_user_context = $${idx++}`);
        values.push(dto.requiresUserContext);
      }
      if (dto.confidenceThreshold !== undefined) {
        updates.push(`confidence_threshold = $${idx++}`);
        values.push(dto.confidenceThreshold);
      }
      if (dto.isActive !== undefined) {
        updates.push(`is_active = $${idx++}`);
        values.push(dto.isActive);
      }
      if (dto.embedding !== undefined) {
        if (dto.embedding === null) {
          updates.push(`embedding = NULL`);
          updates.push(`embedding_dimension = NULL`);
        } else {
          updates.push(`embedding = $${idx++}::vector`);
          values.push(`[${dto.embedding.join(',')}]`);
          updates.push(`embedding_dimension = $${idx++}`);
          values.push(dto.embedding.length);
        }
      }

      values.push(id);
      const res = await pool.query(
        `UPDATE faq_items SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (res.rows.length === 0) return null;
      return this.mapRowToItem(res.rows[0]);
    }

    const existing = this.inMemoryItems.get(id);
    if (!existing) return null;

    const updated: SemanticCacheItem = {
      ...existing,
      intent: dto.intent !== undefined ? dto.intent.trim() : existing.intent,
      category: dto.category !== undefined ? dto.category.trim() : existing.category,
      title: dto.title !== undefined ? dto.title.trim() : existing.title,
      examples: dto.examples !== undefined ? dto.examples.map((e) => e.trim()).filter(Boolean) : existing.examples,
      patterns: dto.patterns !== undefined ? dto.patterns.map((p) => p.trim()).filter(Boolean) : existing.patterns,
      response: dto.response !== undefined ? dto.response.trim() : existing.response,
      responseStrategy: dto.responseStrategy !== undefined ? dto.responseStrategy : existing.responseStrategy,
      responseTemplates: dto.responseTemplates !== undefined ? dto.responseTemplates : existing.responseTemplates,
      matchType: dto.matchType !== undefined ? dto.matchType : existing.matchType,
      isCacheable: dto.isCacheable !== undefined ? dto.isCacheable : existing.isCacheable,
      isDynamic: dto.isDynamic !== undefined ? dto.isDynamic : existing.isDynamic,
      requiresSearch: dto.requiresSearch !== undefined ? dto.requiresSearch : existing.requiresSearch,
      requiresUserContext: dto.requiresUserContext !== undefined ? dto.requiresUserContext : existing.requiresUserContext,
      confidenceThreshold: dto.confidenceThreshold !== undefined ? dto.confidenceThreshold : existing.confidenceThreshold,
      embedding: dto.embedding !== undefined ? dto.embedding : existing.embedding,
      embeddingDimension: dto.embedding !== undefined ? (dto.embedding ? dto.embedding.length : null) : existing.embeddingDimension,
      isActive: dto.isActive !== undefined ? dto.isActive : existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.inMemoryItems.set(id, updated);
    return updated;
  }

  /**
   * Fast targeted update for vector embedding.
   */
  public async updateEmbedding(id: string, embedding: number[]): Promise<boolean> {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding must be a non-empty array of numbers');
    }
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(
        `UPDATE faq_items 
         SET embedding = $1::vector, embedding_dimension = $2, updated_at = NOW() 
         WHERE id = $3`,
        [`[${embedding.join(',')}]`, embedding.length, id]
      );
      return (res.rowCount ?? 0) > 0;
    }

    const item = this.inMemoryItems.get(id);
    if (!item) return false;
    item.embedding = embedding;
    item.embeddingDimension = embedding.length;
    item.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Records a cache hit, incrementing hit_count and updating last_used_at.
   */
  public async recordHit(id: string): Promise<void> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        await pool.query(`UPDATE faq_items SET hit_count = hit_count + 1, last_used_at = NOW() WHERE id = $1`, [id]);
      } catch (err: any) {
        logger.debug('Failed to record cache hit in DB', { error: err.message, id });
      }
    } else {
      const item = this.inMemoryItems.get(id);
      if (item) {
        item.hitCount += 1;
        item.lastUsedAt = new Date().toISOString();
      }
    }
  }

  public async delete(id: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const res = await pool.query(`DELETE FROM faq_items WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    }
    return this.inMemoryItems.delete(id);
  }

  public async getAll(options?: { activeOnly?: boolean; withEmbeddingsOnly?: boolean }): Promise<SemanticCacheItem[]> {
    const pool = this.db.getPool();
    if (pool) {
      await this.ensureSchema();
      const conditions: string[] = [];
      if (options?.activeOnly) conditions.push('is_active = true');
      if (options?.withEmbeddingsOnly) conditions.push('embedding IS NOT NULL');

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await pool.query(`SELECT * FROM faq_items ${whereClause} ORDER BY hit_count DESC, created_at ASC`);
      return res.rows.map((r: any) => this.mapRowToItem(r));
    }

    let items = Array.from(this.inMemoryItems.values());
    if (options?.activeOnly) items = items.filter((i) => i.isActive);
    if (options?.withEmbeddingsOnly) items = items.filter((i) => i.embedding !== null && i.embedding !== undefined);
    return items;
  }

  private mapRowToItem(r: any): SemanticCacheItem {
    let embedding: number[] | null = null;
    if (typeof r.embedding === 'string') {
      try {
        embedding = JSON.parse(r.embedding);
      } catch {
        const cleaned = r.embedding.replace(/^\[|\]$/g, '');
        embedding = cleaned ? cleaned.split(',').map((n: string) => parseFloat(n.trim())) : null;
      }
    } else if (Array.isArray(r.embedding)) {
      embedding = r.embedding;
    }

    return {
      id: r.id,
      intent: r.intent || r.category || 'custom',
      category: r.category || 'custom',
      title: r.title,
      examples: Array.isArray(r.examples) ? r.examples : [],
      patterns: Array.isArray(r.patterns) ? r.patterns : [],
      response: r.response,
      responseStrategy: r.response_strategy || 'dynamic_template',
      responseTemplates: typeof r.response_templates === 'object' && r.response_templates !== null 
        ? r.response_templates 
        : { default: [r.response] },
      matchType: r.match_type || 'contains',
      isActive: r.is_active !== undefined ? r.is_active : true,
      isCacheable: r.is_cacheable !== undefined ? r.is_cacheable : true,
      isDynamic: r.is_dynamic !== undefined ? r.is_dynamic : false,
      requiresSearch: r.requires_search !== undefined ? r.requires_search : false,
      requiresUserContext: r.requires_user_context !== undefined ? r.requires_user_context : false,
      confidenceThreshold: r.confidence_threshold !== undefined && r.confidence_threshold !== null 
        ? parseFloat(r.confidence_threshold) 
        : 0.88,
      embedding,
      embeddingDimension: r.embedding_dimension !== undefined && r.embedding_dimension !== null 
        ? parseInt(r.embedding_dimension, 10) 
        : null,
      hitCount: parseInt(r.hit_count || '0', 10),
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  }
}
