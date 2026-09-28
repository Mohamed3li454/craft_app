-- ============================================================================
-- Migration 012: Outbound Webhook Receipts & Engagement Tracking
-- Phase 7.5 — Outbound Webhook Receipts & Engagement Tracking
-- ============================================================================

-- 1. Extend proactive_dispatch_log with receipt and response tracking columns
ALTER TABLE proactive_dispatch_log
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS provider_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS provider_error_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS provider_error_message TEXT,
    ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS responded_message_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(255);

-- 2. Index for high-throughput webhook status matching by provider_message_id
CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_provider_msg 
    ON proactive_dispatch_log (provider_message_id);

CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_responded 
    ON proactive_dispatch_log (responded_at);

CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_user_conv 
    ON proactive_dispatch_log (user_id, conversation_id);

-- 3. Dedicated Proactive Engagement Tracking Table
CREATE TABLE IF NOT EXISTS proactive_engagement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES proactive_dispatch_log(id) ON DELETE CASCADE,
    action_id UUID REFERENCES proactive_actions(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- 'sent' | 'delivered' | 'read' | 'failed' | 'user_replied'
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    attribution_source VARCHAR(50) NOT NULL DEFAULT 'meta_webhook', -- 'meta_webhook' | 'inbound_message' | 'manual'
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_proactive_engagement_event UNIQUE (dispatch_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_proactive_engagement_action 
    ON proactive_engagement (action_id);

CREATE INDEX IF NOT EXISTS idx_proactive_engagement_user 
    ON proactive_engagement (user_id);

CREATE INDEX IF NOT EXISTS idx_proactive_engagement_event 
    ON proactive_engagement (event_type);

CREATE INDEX IF NOT EXISTS idx_proactive_engagement_occurred 
    ON proactive_engagement (occurred_at);
