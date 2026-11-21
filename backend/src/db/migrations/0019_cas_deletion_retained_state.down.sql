-- Migration 0019 Down: Revert CAS Deletion Retained State and Granular Companion Tracking
--
-- NOTE ON POSTGRESQL ENUM LIFECYCLE & DOWN MIGRATION SAFETY:
-- PostgreSQL standard DDL does not support `ALTER TYPE ... DROP VALUE`.
-- The enum labels 'RETAINED' and 'CANCELLED' added in migration 0019 cannot be removed
-- via standard DDL without dropping and rebuilding the `cas_deletion_state` enum and all
-- dependent tables (`cas_deletion_intents`), which would cause catastrophic table rewrites
-- or data loss in production.
--
-- In accordance with PostgreSQL best practices and enterprise database governance:
-- 1. Unreferenced enum values in PostgreSQL are completely harmless and dormant.
-- 2. Dropping the added columns and index safely reverts the schema to the Phase 2B.1 baseline.
-- 3. 'CANCELLED' remains intentionally reserved for manual/administrative cancellation workflows.
-- 4. No destructive type conversions or catalog manipulations are executed.

DROP INDEX IF EXISTS idx_cas_deletion_intents_canonical_key;

ALTER TABLE cas_deletion_intents
    DROP COLUMN IF EXISTS canonical_key,
    DROP COLUMN IF EXISTS primary_deleted,
    DROP COLUMN IF EXISTS companion_deleted,
    DROP COLUMN IF EXISTS primary_error,
    DROP COLUMN IF EXISTS companion_error;

