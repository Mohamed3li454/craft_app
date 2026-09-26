-- Migration 001: Add Semantic Multilingual Cache support to faq_items table
-- Non-destructive, backward-compatible migration

-- 1. Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add new columns to faq_items safely
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

-- 3. Backfill existing rows safely and language-neutrally without altering or losing data
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

-- 4. Create standard B-tree indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_faq_items_intent ON faq_items(intent);
CREATE INDEX IF NOT EXISTS idx_faq_items_is_active_cacheable ON faq_items(is_active, is_cacheable);
CREATE INDEX IF NOT EXISTS idx_faq_items_embedding_dimension ON faq_items(embedding_dimension);

-- 5. Create secure Server-Side Stored Procedure / Function for Semantic Search
-- Threshold Semantics:
-- - Per-entry threshold (f.confidence_threshold) is ALWAYS strictly enforced.
-- - Caller query threshold (match_threshold) acts as an optional stricter floor, but NEVER lowers the per-entry safety threshold.
-- - Effective threshold = GREATEST(f.confidence_threshold, match_threshold).
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

-- 6. Lock down execution privileges: Server-side only
REVOKE EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION match_semantic_cache(vector, float, int, int) TO postgres;
