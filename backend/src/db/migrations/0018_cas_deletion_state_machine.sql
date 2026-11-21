-- Migration 0018: CAS Deletion State Machine and Intent Log (Phase 2B.1 Deletion Safety Remediation)
-- Implementa un protocolo durable de dos fases (DB Intent -> Physical Unlink -> DB State/Audit)
-- para garantizar recuperabilidad total ante caídas del proceso o fallos de red.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cas_deletion_state') THEN
        CREATE TYPE cas_deletion_state AS ENUM (
            'DELETE_PENDING',
            'DELETED',
            'DELETE_FAILED',
            'RETRY_PENDING'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS cas_deletion_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key VARCHAR(512) NOT NULL UNIQUE,
    checksum_sha256 VARCHAR(64),
    job_id UUID REFERENCES background_jobs(id) ON DELETE SET NULL,
    state cas_deletion_state NOT NULL DEFAULT 'DELETE_PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    audited BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_cas_deletion_intents_state ON cas_deletion_intents (state);
CREATE INDEX IF NOT EXISTS idx_cas_deletion_intents_key ON cas_deletion_intents (storage_key);

