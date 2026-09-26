-- ==============================================================================
-- Migration 004: Semantic Cache Review Audit, Immutability & Production Observability
-- ==============================================================================

-- 1. Create Immutable Audit Table for Candidate Review Actions
CREATE TABLE IF NOT EXISTS semantic_cache_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES semantic_cache_candidates(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- 'view', 'validate', 'reject', 'promote'
  actor_id VARCHAR(100),
  reason TEXT,
  previous_status VARCHAR(20),
  new_status VARCHAR(20),
  previous_eligibility BOOLEAN,
  new_eligibility BOOLEAN,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create Metrics Storage Table for Cache Hit/Miss & Observability Aggregation
CREATE TABLE IF NOT EXISTS semantic_cache_metrics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL, -- 'exact_hit', 'semantic_hit', 'semantic_miss', 'ineligible_dynamic', 'false_positive', etc.
  source VARCHAR(50), -- 'exact', 'semantic', 'ai_router'
  intent VARCHAR(100),
  language VARCHAR(10),
  similarity REAL,
  threshold REAL,
  reason VARCHAR(100),
  latency_ms INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Composite Performance Indexes for Candidate Review & Filtering Queries
CREATE INDEX IF NOT EXISTS idx_candidates_status_created 
  ON semantic_cache_candidates(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidates_promotion_eligible_status 
  ON semantic_cache_candidates(promotion_eligible, status);

CREATE INDEX IF NOT EXISTS idx_candidates_confidence 
  ON semantic_cache_candidates(confidence DESC);

CREATE INDEX IF NOT EXISTS idx_candidates_language 
  ON semantic_cache_candidates(language);

CREATE INDEX IF NOT EXISTS idx_candidates_last_observed_at 
  ON semantic_cache_candidates(last_observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidates_updated_at 
  ON semantic_cache_candidates(updated_at DESC);

-- 4. Indexes for Review Audit Events
CREATE INDEX IF NOT EXISTS idx_review_events_candidate_id 
  ON semantic_cache_review_events(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_events_action 
  ON semantic_cache_review_events(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_events_created_at 
  ON semantic_cache_review_events(created_at DESC);

-- 5. Indexes for Metrics Events
CREATE INDEX IF NOT EXISTS idx_metrics_events_type_created 
  ON semantic_cache_metrics_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_events_created_at 
  ON semantic_cache_metrics_events(created_at DESC);

-- 6. Trigger to Enforce Strict Append-Only Immutability on Audit Events
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
