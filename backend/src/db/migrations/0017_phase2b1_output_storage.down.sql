-- Rollback Migration 0017: Output Storage Architecture and Database TOAST Optimization (Phase 2B.1)

DROP INDEX IF EXISTS idx_background_jobs_pruned_at;
DROP INDEX IF EXISTS idx_background_jobs_output_checksum;
DROP INDEX IF EXISTS idx_background_jobs_output_storage_key;

ALTER TABLE background_jobs
  DROP COLUMN IF EXISTS pruned_at,
  DROP COLUMN IF EXISTS output_byte_length,
  DROP COLUMN IF EXISTS output_checksum_sha256,
  DROP COLUMN IF EXISTS output_storage_key;

