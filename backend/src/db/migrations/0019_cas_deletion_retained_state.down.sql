-- Migration 0019 Down: Revert CAS Deletion Retained State and Granular Companion Tracking

DROP INDEX IF EXISTS idx_cas_deletion_intents_canonical_key;

ALTER TABLE cas_deletion_intents
    DROP COLUMN IF EXISTS canonical_key,
    DROP COLUMN IF EXISTS primary_deleted,
    DROP COLUMN IF EXISTS companion_deleted,
    DROP COLUMN IF EXISTS primary_error,
    DROP COLUMN IF EXISTS companion_error;

