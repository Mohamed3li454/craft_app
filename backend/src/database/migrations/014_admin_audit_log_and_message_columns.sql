-- Phase 10.1: Admin Security & Audit Trail Foundation
-- Migration: 014_admin_audit_log_and_message_columns.sql

-- 1. Ensure required analytical columns exist on messages table cleanly without runtime DDL
ALTER TABLE messages ADD COLUMN IF NOT EXISTS latency_ms INT DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(50) DEFAULT 'text';

-- 2. Create admin audit log table for tracking state-mutating actions
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_actor VARCHAR(255) NOT NULL DEFAULT 'admin',
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure')),
    metadata JSONB DEFAULT '{}'::jsonb,
    correlation_id VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indices for efficient filtering and timeline inspection
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON admin_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_resource ON admin_audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_correlation_id ON admin_audit_logs (correlation_id);
