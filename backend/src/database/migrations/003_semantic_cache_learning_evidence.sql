-- Migration 003: Add Evidence Accumulation & Controlled Promotion fields to semantic_cache_candidates
-- Non-destructive, backward-compatible migration

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

-- Indexes for fast querying of promotion-eligible candidates and staleness auditing
CREATE INDEX IF NOT EXISTS idx_candidates_promotion_eligible 
  ON semantic_cache_candidates(promotion_eligible, status) 
  WHERE promotion_eligible = true;

CREATE INDEX IF NOT EXISTS idx_candidates_last_observed_at 
  ON semantic_cache_candidates(last_observed_at DESC);
