-- ==============================================================================
-- Migration 016: Persistent AI Evaluation Runs and Case Results
-- Phase 12.2 — Evaluation Runner & Persistent Evaluation History
-- Non-destructive, backward-compatible migration
-- ==============================================================================

-- 1. Table: evaluation_runs
CREATE TABLE IF NOT EXISTS evaluation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_version VARCHAR(100) NOT NULL DEFAULT 'Phase 8.5 Golden Benchmark Dataset',
    mode VARCHAR(30) NOT NULL DEFAULT 'mock' CHECK (mode IN ('mock', 'replay', 'live')),
    status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    total_cases INT NOT NULL DEFAULT 0,
    passed_cases INT NOT NULL DEFAULT 0,
    failed_cases INT NOT NULL DEFAULT 0,
    skipped_cases INT NOT NULL DEFAULT 0,
    regression_count INT NOT NULL DEFAULT 0,
    overall_score NUMERIC(5,2) DEFAULT 0,
    duration_ms INT DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Ensure metadata column exists if table was pre-existing
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_status ON evaluation_runs(status);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_created_at ON evaluation_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_dataset_version ON evaluation_runs(dataset_version);

-- 2. Table: evaluation_case_results
CREATE TABLE IF NOT EXISTS evaluation_case_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
    case_id VARCHAR(100) NOT NULL,
    dimension VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'error')),
    score NUMERIC(5,2) NOT NULL DEFAULT 0,
    expected JSONB NOT NULL DEFAULT '{}'::jsonb,
    actual JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    regression BOOLEAN NOT NULL DEFAULT false,
    previous_status VARCHAR(30),
    previous_score NUMERIC(5,2),
    model VARCHAR(100),
    provider VARCHAR(100),
    duration_ms INT DEFAULT 0,
    tokens INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run_id ON evaluation_case_results(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_case_id ON evaluation_case_results(case_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_dimension ON evaluation_case_results(dimension);
CREATE INDEX IF NOT EXISTS idx_eval_results_regression ON evaluation_case_results(regression);
CREATE INDEX IF NOT EXISTS idx_eval_results_status ON evaluation_case_results(status);
