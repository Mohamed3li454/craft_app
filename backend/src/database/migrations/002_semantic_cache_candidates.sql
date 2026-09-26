-- Migration 002: Add semantic_cache_candidates table for Safe Learning Pipeline
-- Non-destructive, isolated candidate storage

-- 1. Create table for semantic cache learning candidates
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

-- 2. Indexes for fast status filtering and deduplication lookups
CREATE INDEX IF NOT EXISTS idx_candidates_status ON semantic_cache_candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_intent ON semantic_cache_candidates(intent);
CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON semantic_cache_candidates(created_at DESC);

-- 3. Row Level Security: Server-side only
ALTER TABLE semantic_cache_candidates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Revoke access from public/client roles
  REVOKE ALL ON semantic_cache_candidates FROM PUBLIC;
  REVOKE ALL ON semantic_cache_candidates FROM anon;
  REVOKE ALL ON semantic_cache_candidates FROM authenticated;

  -- Grant access only to server roles
  GRANT ALL ON semantic_cache_candidates TO service_role;
  GRANT ALL ON semantic_cache_candidates TO postgres;
EXCEPTION WHEN OTHERS THEN
  -- Gracefully ignore if roles do not exist in test/local environments
  NULL;
END
$$;
