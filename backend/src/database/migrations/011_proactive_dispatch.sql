-- ============================================================================
-- Migration 011: Proactive Dispatch Log & Idempotency Table
-- Phase 7.4 — WhatsApp Window & Template Adapter
-- ============================================================================

CREATE TABLE IF NOT EXISTS proactive_dispatch_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id UUID NOT NULL REFERENCES proactive_actions(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivery_mode VARCHAR(50) NOT NULL,
    channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
    payload_type VARCHAR(50) NOT NULL, -- 'freeform' | 'template'
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'suppressed'
    provider_message_id VARCHAR(255),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_proactive_dispatch_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_action 
    ON proactive_dispatch_log (action_id);

CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_user 
    ON proactive_dispatch_log (user_id);

CREATE INDEX IF NOT EXISTS idx_proactive_dispatch_status 
    ON proactive_dispatch_log (status);
