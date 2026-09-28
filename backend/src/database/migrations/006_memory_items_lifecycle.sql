-- ==============================================================================
-- Migration 006: Memory Items Lifecycle, Conflict Resolution & Deduplication
-- ==============================================================================

-- 1. Add lifecycle, source, confidence, importance, temporal validity, and metadata columns
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS fact_key VARCHAR(100);
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'automatic_extraction';
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 1.0;
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS importance VARCHAR(20) DEFAULT 'normal';
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Indexes for fast active retrieval and conflict resolution
CREATE INDEX IF NOT EXISTS idx_memory_items_user_active ON memory_items(user_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_memory_items_user_fact_key ON memory_items(user_id, fact_key) WHERE fact_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_items_valid_until ON memory_items(valid_until) WHERE valid_until IS NOT NULL;
