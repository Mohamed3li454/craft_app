-- ==============================================================================
-- Migration 005: User Preferences Isolation (Language & Personality)
-- ==============================================================================

-- 1. Create user_preferences table if not exists with JSONB structured values
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference_key VARCHAR(100) NOT NULL,
  preference_value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_user_pref UNIQUE (user_id, preference_key)
);

-- 2. Indexes for fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_key ON user_preferences(user_id, preference_key);

-- 3. Safe Deterministic Backfill:
-- ONLY migrate records matching the exact known legacy string from previous phases,
-- without converting generic facts or performing loose substring matching.
INSERT INTO user_preferences (user_id, preference_key, preference_value, created_at, updated_at)
SELECT 
  user_id,
  'language',
  '{"language": "ar", "dialect": "egyptian"}'::jsonb,
  created_at,
  NOW()
FROM memory_items
WHERE LOWER(TRIM(fact_text)) = 'المستخدم يفضل التحدث والتواصل باللهجة المصرية'
ON CONFLICT (user_id, preference_key) DO NOTHING;
