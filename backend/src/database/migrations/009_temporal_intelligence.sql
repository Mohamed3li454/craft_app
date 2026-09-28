-- ==============================================================================
-- Migration 009: Temporal Intelligence & State Awareness
-- Non-destructive, backward-compatible migration for Phase 2.4
-- ==============================================================================

-- 1. Add temporal state and valid_from to memory_items
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS temporal_state VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE;

-- 2. Add temporal state and valid_from to memory_evidence_candidates
ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS temporal_state VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE;

-- 3. Indexes for fast temporal state filtering and lifecycle auditing
CREATE INDEX IF NOT EXISTS idx_memory_items_temporal_state ON memory_items(user_id, temporal_state);
CREATE INDEX IF NOT EXISTS idx_evidence_temporal_state ON memory_evidence_candidates(user_id, temporal_state);

COMMENT ON COLUMN memory_items.temporal_state IS 
  'Temporal classification: historical, current, planned, temporary, unknown.';

COMMENT ON COLUMN memory_items.valid_from IS 
  'Timestamp when the fact became true or valid, if known or inferable.';

COMMENT ON COLUMN memory_evidence_candidates.temporal_state IS 
  'Temporal state of candidate evidence: historical, current, planned, temporary, unknown.';
