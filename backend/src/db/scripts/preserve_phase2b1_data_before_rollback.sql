-- ==============================================================================
-- Bethesda Worship Studio — Phase 2B.1 Data Preservation & Rollback Safety Script
-- Purpose: Export and preserve all externalized output references prior to schema rollback.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS background_jobs_phase2b1_rollback_backup (
    backup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    user_id UUID,
    status VARCHAR(50),
    input_ref TEXT,
    output_ref TEXT,
    output_storage_key TEXT,
    output_checksum_sha256 VARCHAR(64),
    output_byte_length BIGINT,
    pruned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO background_jobs_phase2b1_rollback_backup (
    job_id, user_id, status, input_ref, output_ref, output_storage_key,
    output_checksum_sha256, output_byte_length, pruned_at, created_at, completed_at
)
SELECT id, user_id, status, input_ref, output_ref, output_storage_key,
       output_checksum_sha256, output_byte_length, pruned_at, created_at, completed_at
FROM background_jobs
WHERE output_storage_key IS NOT NULL;

-- Log audit confirmation
DO $$
DECLARE
    v_backed_up_count integer;
BEGIN
    SELECT count(*) INTO v_backed_up_count FROM background_jobs_phase2b1_rollback_backup;
    RAISE NOTICE 'Preserved % Phase 2B.1 output records into background_jobs_phase2b1_rollback_backup.', v_backed_up_count;
END $$;

COMMIT;
