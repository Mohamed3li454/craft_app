-- ==============================================================================
-- Migration 007: Memory Evidence & Observation Candidates
-- Non-destructive, backward-compatible migration for Phase 2.2
-- ==============================================================================

-- 1. Create table to track accumulated evidence observations before promotion
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
  status VARCHAR(20) NOT NULL DEFAULT 'observing',
  promoted_memory_id UUID REFERENCES memory_items(id) ON DELETE SET NULL,
  first_observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_memory_evidence_user_key UNIQUE (user_id, candidate_key)
);

-- 2. Indexes for fast candidate lookup, promotion auditing, and recency queries
CREATE INDEX IF NOT EXISTS idx_evidence_user_status ON memory_evidence_candidates(user_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_candidate_key ON memory_evidence_candidates(user_id, candidate_key);
CREATE INDEX IF NOT EXISTS idx_evidence_last_observed ON memory_evidence_candidates(last_observed_at DESC);
