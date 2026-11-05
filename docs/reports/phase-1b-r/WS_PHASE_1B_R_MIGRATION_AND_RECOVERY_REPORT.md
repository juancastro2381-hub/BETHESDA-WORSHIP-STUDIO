# WORSHIP STUDIO — PHASE 1B-R
## DATABASE MIGRATION, COMPATIBILITY & DISASTER RECOVERY REPORT

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R — Remediation Only  
**Workstream:** Workstream H — Database Schema Evolution  
**Author:** Antigravity (PostgreSQL Specialist & Backend Architect)  
**Date:** 2026-11-05  

---

## 1. MIGRATION 0012 SPECIFICATION

The schema migration is registered as `0012_source_preservation_and_ownership.sql` in `backend/src/db/migrations/`:

```sql
-- Migration 0012: Source Preservation and Ownership (Phase 1B-R)
-- Desacopla la preservación física de fuentes de la creación obligatoria de canciones,
-- permitiendo que song_sources exista antes y de forma independiente del parseo musical,
-- e incorpora límites de propiedad multi-inquilino (user_id).

-- 1. Modificar canciones maestras: permitir explícitamente valores desconocidos (null)
-- sin inventar tonos, BPMs ni métricas artificiales (C, 120, 4/4)
ALTER TABLE "songs" ALTER COLUMN "default_key" DROP NOT NULL;
ALTER TABLE "songs" ALTER COLUMN "default_bpm" DROP DEFAULT;
ALTER TABLE "songs" ALTER COLUMN "default_bpm" DROP NOT NULL;
ALTER TABLE "songs" ALTER COLUMN "time_signature" DROP DEFAULT;
ALTER TABLE "songs" ALTER COLUMN "time_signature" DROP NOT NULL;

-- 2. Desacoplar song_sources de la creación obligatoria e inmediata de una canción
ALTER TABLE "song_sources" ALTER COLUMN "song_id" DROP NOT NULL;
ALTER TABLE "song_sources" ALTER COLUMN "version_id" DROP NOT NULL;

-- 3. Incorporar trazabilidad multi-inquilino, almacenamiento físico y verificación criptográfica
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "storage_path" varchar(512);
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "mime_type" varchar(100);
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "file_size_bytes" integer;
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "checksum_sha256" varchar(64);
ALTER TABLE "song_sources" ADD COLUMN IF NOT EXISTS "job_id" uuid REFERENCES "background_jobs"("id") ON DELETE SET NULL;

-- 4. Índices para acelerar búsquedas de auditoría, verificación de idempotencia y orquestación
CREATE INDEX IF NOT EXISTS "idx_song_sources_user_id" ON "song_sources" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_song_sources_checksum_sha256" ON "song_sources" ("checksum_sha256");
CREATE INDEX IF NOT EXISTS "idx_song_sources_job_id" ON "song_sources" ("job_id");
```

### 1.1 Drizzle Journal Registration
In `backend/src/db/migrations/meta/_journal.json`:
```json
    {
      "idx": 12,
      "version": "7",
      "when": 1793885000000,
      "tag": "0012_source_preservation_and_ownership",
      "breakpoints": true
    }
```

---

## 2. BACKWARD COMPATIBILITY & ZERO DATA LOSS GUARANTEE

1. **Non-Destructive Column Changes:** All modifications (`DROP NOT NULL`, `DROP DEFAULT`, `ADD COLUMN`) are backward compatible:
   - Existing rows in `songs` retain their existing `default_key`, `default_bpm`, and `time_signature` values without alteration.
   - Existing rows in `song_sources` retain their foreign keys (`song_id`, `version_id`) and simply gain `null` in the new columns until updated.
2. **Nullable Source Links:** By dropping `NOT NULL` on `song_sources.song_id` and `song_sources.version_id`, the system can now store unparseable or registration-only sources (video references, raw audio recordings, visual PDF scores awaiting OMR) without fabricating dummy songs.
3. **Foreign Key Integrity:**
   - `user_id` enforces `ON DELETE RESTRICT`, preventing accidental orphan sources if a user account is deleted while retaining audit history.
   - `job_id` enforces `ON DELETE SET NULL`, ensuring background job archival does not cascade into source deletion.

---

## 3. APPLIED MIGRATION EVIDENCE

The migration was applied and verified against both development and testing PostgreSQL 18 databases:
1. `bethesda_worship_dev`:
   ```powershell
   npx tsx --env-file=.env src/db/migrate.ts
   # Output: 🚀 Aplicando migraciones de Drizzle desde: ...\backend\src\db\migrations
   # ✅ Migraciones aplicadas con éxito.
   ```
2. `bethesda_worship_test`:
   ```powershell
   $env:NODE_ENV="test"; npx tsx --env-file=.env src/db/migrate.ts
   # Output: 🚀 Aplicando migraciones de Drizzle desde: ...\backend\src\db\migrations
   # ✅ Migraciones aplicadas con éxito.
   ```

---

## 4. ROLLBACK & DISASTER RECOVERY PROCEDURES

In the event of an operational need to roll back migration 0012:

### 4.1 SQL Rollback Script
```sql
-- 1. Eliminar índices
DROP INDEX IF EXISTS "idx_song_sources_job_id";
DROP INDEX IF EXISTS "idx_song_sources_checksum_sha256";
DROP INDEX IF EXISTS "idx_song_sources_user_id";

-- 2. Eliminar columnas agregadas
ALTER TABLE "song_sources" DROP COLUMN IF EXISTS "job_id";
ALTER TABLE "song_sources" DROP COLUMN IF EXISTS "checksum_sha256";
ALTER TABLE "song_sources" DROP COLUMN IF EXISTS "file_size_bytes";
ALTER TABLE "song_sources" DROP COLUMN IF EXISTS "mime_type";
ALTER TABLE "song_sources" DROP COLUMN IF EXISTS "storage_path";
ALTER TABLE "song_sources" DROP COLUMN IF EXISTS "user_id";

-- 3. Restaurar restricciones (requiere rellenar nulos si existen)
UPDATE "songs" SET "default_key" = 'C' WHERE "default_key" IS NULL;
UPDATE "songs" SET "default_bpm" = 120 WHERE "default_bpm" IS NULL;
UPDATE "songs" SET "time_signature" = '4/4' WHERE "time_signature" IS NULL;

ALTER TABLE "songs" ALTER COLUMN "default_key" SET NOT NULL;
ALTER TABLE "songs" ALTER COLUMN "default_bpm" SET DEFAULT 120;
ALTER TABLE "songs" ALTER COLUMN "default_bpm" SET NOT NULL;
ALTER TABLE "songs" ALTER COLUMN "time_signature" SET DEFAULT '4/4';
ALTER TABLE "songs" ALTER COLUMN "time_signature" SET NOT NULL;

DELETE FROM "song_sources" WHERE "song_id" IS NULL;
ALTER TABLE "song_sources" ALTER COLUMN "song_id" SET NOT NULL;
ALTER TABLE "song_sources" ALTER COLUMN "version_id" SET NOT NULL;
```

### 4.2 Data Safety Note
Physical storage files written to `storage/sources/` are keyed by SHA-256 and stored immutably. Even if a database migration rollback were triggered, physical original source files on disk remain completely unharmed.

