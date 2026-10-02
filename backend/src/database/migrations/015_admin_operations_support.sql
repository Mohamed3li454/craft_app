-- ==============================================================================
-- Migration 015: Admin Operations Support
-- Phase 10.2 — Admin Operations API Foundation
-- Non-destructive, backward-compatible migration
-- ==============================================================================

-- 1. Add user banning and moderation columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

-- 2. Add performance indexes for agent observability and tool tracking
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_tool_calls_created_at ON tool_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_status ON tool_calls(status);
