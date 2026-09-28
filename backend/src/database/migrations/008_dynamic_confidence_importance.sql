-- ==============================================================================
-- Migration 008: Dynamic Confidence & Importance
-- Non-destructive, backward-compatible migration for Phase 2.3
-- ==============================================================================

-- 1. Add confidence and importance columns to memory_evidence_candidates
ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 0.0;
ALTER TABLE memory_evidence_candidates ADD COLUMN IF NOT EXISTS importance VARCHAR(20) DEFAULT 'normal';

-- 2. Index for fast querying by confidence
CREATE INDEX IF NOT EXISTS idx_evidence_confidence ON memory_evidence_candidates(user_id, confidence DESC);
