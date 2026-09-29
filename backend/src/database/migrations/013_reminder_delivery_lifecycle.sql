-- ============================================================================
-- Migration 013: Reminder Delivery Foundation & State Machine
-- Phase 9.2 — Serverless Production Delivery Lifecycle
-- ============================================================================

-- 1. Add state machine, retry, leasing, and provider receipt columns
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS state VARCHAR(50) NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS wamid VARCHAR(255);

-- 2. Backward compatibility data synchronization:
-- Previously completed reminders are safely marked as 'sent'
UPDATE reminders
SET state = 'sent'
WHERE is_completed = true AND (state = 'scheduled' OR state IS NULL);

-- 3. Composite partial index optimized for atomic claim queries:
-- Efficiently locates due, unlocked, non-completed reminders
CREATE INDEX IF NOT EXISTS idx_reminders_due_claim 
  ON reminders (due_at, state, locked_until)
  WHERE is_completed = false;

-- 4. Fast lookup for WhatsApp receipt attribution by message ID
CREATE INDEX IF NOT EXISTS idx_reminders_wamid 
  ON reminders (wamid) 
  WHERE wamid IS NOT NULL;
