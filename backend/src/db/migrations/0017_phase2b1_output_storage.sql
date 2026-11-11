-- Migration 0017: Output Storage Architecture and Database TOAST Optimization (Phase 2B.1)
-- Agrega columnas de almacenamiento externo, integridad criptográfica y ciclo de vida de podado a background_jobs.

-- 1. Añadir columnas de almacenamiento externo para desacoplar cargas binarias/pesadas de PostgreSQL TOAST
ALTER TABLE background_jobs
  ADD COLUMN IF NOT EXISTS output_storage_key varchar(512),
  ADD COLUMN IF NOT EXISTS output_checksum_sha256 varchar(64),
  ADD COLUMN IF NOT EXISTS output_byte_length integer,
  ADD COLUMN IF NOT EXISTS pruned_at timestamp with time zone;

-- 2. Índices de aceleración para búsqueda por clave, hash CAS y políticas de retención
CREATE INDEX IF NOT EXISTS idx_background_jobs_output_storage_key ON background_jobs (output_storage_key);
CREATE INDEX IF NOT EXISTS idx_background_jobs_output_checksum ON background_jobs (output_checksum_sha256);
CREATE INDEX IF NOT EXISTS idx_background_jobs_pruned_at ON background_jobs (pruned_at);

