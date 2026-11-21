-- Migration 0012: Universal Source Preservation, Ownership & Unknown Musical Metadata
-- Bethesda Worship Studio - Phase 1B-R

-- 1. Modificar song_sources para permitir fuentes preservadas sin canción convertida
ALTER TABLE "song_sources" ALTER COLUMN "song_id" DROP NOT NULL;

-- 2. Agregar columnas de preservación y propiedad en song_sources
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "storage_path" text;
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "mime_type" varchar(100);
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "file_size_bytes" integer;
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "checksum_sha256" varchar(64);
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "job_id" uuid REFERENCES "background_jobs"("id") ON DELETE SET NULL;

-- 3. Índices para búsqueda eficiente por usuario, hash y tarea
CREATE INDEX IF NOT EXISTS "idx_song_sources_user_id" ON "song_sources"("user_id");
CREATE INDEX IF NOT EXISTS "idx_song_sources_checksum" ON "song_sources"("checksum_sha256");
CREATE INDEX IF NOT EXISTS "idx_song_sources_job_id" ON "song_sources"("job_id");

-- 4. Permitir valores musicales desconocidos (NULL) en canciones para eliminar fabricaciones por defecto
ALTER TABLE "songs" ALTER COLUMN "default_key" DROP NOT NULL;
ALTER TABLE "songs" ALTER COLUMN "default_bpm" DROP NOT NULL;
ALTER TABLE "songs" ALTER COLUMN "default_bpm" DROP DEFAULT;
ALTER TABLE "songs" ALTER COLUMN "time_signature" DROP NOT NULL;
ALTER TABLE "songs" ALTER COLUMN "time_signature" DROP DEFAULT;

