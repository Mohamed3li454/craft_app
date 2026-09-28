-- Phase 7.3: Proactive Persistence & Action Lifecycle Table
-- Stores scheduled proactive opportunities with concurrency-safe locking and deduplication.

CREATE TABLE IF NOT EXISTS proactive_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id VARCHAR(255),
  candidate_type VARCHAR(50) NOT NULL,
  topic VARCHAR(255),
  context_digest TEXT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  delivery_mode VARCHAR(50) NOT NULL DEFAULT 'out_of_turn',
  eligible_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  dedup_key VARCHAR(128) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT uq_proactive_actions_dedup UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_proactive_actions_status_eligible 
  ON proactive_actions (status, eligible_at) 
  WHERE status IN ('pending', 'deferred');

CREATE INDEX IF NOT EXISTS idx_proactive_actions_user_status 
  ON proactive_actions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_proactive_actions_dedup_key 
  ON proactive_actions (dedup_key);
