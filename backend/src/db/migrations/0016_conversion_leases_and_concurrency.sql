-- Migration 0016: Conversion Center Leases, Concurrency, and Catalog Idempotency (Phase 2A-R2)

-- 1. Añadir campos de arrendamiento (lease), testigo de ejecución (fencing token) y latido (heartbeat) a background_jobs
ALTER TABLE background_jobs
  ADD COLUMN IF NOT EXISTS lease_owner varchar(255),
  ADD COLUMN IF NOT EXISTS lease_token varchar(255),
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS committed_song_id uuid REFERENCES songs(id) ON DELETE SET NULL;

-- 2. Índices para acelerar la adquisición atómica, recuperación de arrendamientos expirados y fencing
CREATE INDEX IF NOT EXISTS idx_background_jobs_lease_expires ON background_jobs (lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_background_jobs_lease_token ON background_jobs (lease_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_committed_song_id ON background_jobs (committed_song_id) WHERE committed_song_id IS NOT NULL;

-- 3. Índice único para garantizar que un trabajo de conversión solo pueda vincularse una vez a una fuente de canción (idempotencia en catálogo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_song_sources_job_id_unique ON song_sources (job_id) WHERE job_id IS NOT NULL;

