# BETHESDA WORSHIP STUDIO — PHASE 2A-R2
## REPORT 05 — CATALOG COMMITMENT IDEMPOTENCY AND DATABASE INTEGRITY

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** Phase 2A-R2 — Processing Reliability, Concurrency & Integrity Remediation  
**Status:** IMPLEMENTED — PENDING INDEPENDENT CERTIFICATION  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  

---

### 1. Problem Statement & Database Integrity Risks

In Phase 2A-R:
1. **Unsynchronized Catalog Insertion:** `commitJobToCatalog` in `ConversionJobService` was not executed inside a single PostgreSQL database transaction. If creating the song succeeded but linking the `song_sources` or updating the job failed, an orphaned song was left in the catalog with no source provenance or job trace.
2. **Race Conditions on Double-Click / Retries:** If a worship leader clicked "Add to Catalog" twice in rapid succession, or if two clients triggered commitment concurrently, duplicate `songs`, `song_versions`, and `song_sources` records were created.
3. **Absence of Unique Database Constraints:** There were no unique indexes in PostgreSQL preventing multiple songs from referencing the same `job_id` or multiple jobs from referencing the same `committed_song_id`.

Under Phase 2A-R2, **CR-05 (Transactional & Idempotent Catalog Commitment)** and **CR-08 (Database Integrity & Migration Safety)** were implemented.

---

### 2. Forward-Only Database Migration (`0016_conversion_leases_and_concurrency.sql`)

A forward-only migration was created and applied to both development and test databases (`bethesda_worship_dev` and `bethesda_worship_test`):

```sql
-- backend/src/db/migrations/0016_conversion_leases_and_concurrency.sql

-- 1. Agregar columnas para arrendamientos y concurrencia en background_jobs
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "lease_owner" varchar(128);
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "lease_token" varchar(128);
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp with time zone;
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "committed_song_id" uuid;

-- 2. Índices de optimización para escaneo y expiración de arrendamientos
CREATE INDEX IF NOT EXISTS "idx_background_jobs_lease_expires" ON "background_jobs" ("status", "lease_expires_at") WHERE status = 'PROCESSING';
CREATE INDEX IF NOT EXISTS "idx_background_jobs_lease_token" ON "background_jobs" ("id", "lease_token");

-- 3. Índice único parcial para garantizar idempotencia en persistencia a catálogo
CREATE UNIQUE INDEX IF NOT EXISTS "idx_background_jobs_committed_song_id" ON "background_jobs" ("committed_song_id") WHERE committed_song_id IS NOT NULL;

-- 4. Índice único parcial en song_sources para evitar que un mismo trabajo genere múltiples fuentes duplicadas
CREATE UNIQUE INDEX IF NOT EXISTS "idx_song_sources_job_id_unique" ON "song_sources" ("job_id") WHERE job_id IS NOT NULL;
```

#### Migration Journal Updated
Entry 16 was recorded in `backend/src/db/migrations/meta/_journal.json`:
```json
{
  "idx": 16,
  "version": "7",
  "when": 1794101168000,
  "tag": "0016_conversion_leases_and_concurrency",
  "breakpoints": true
}
```

---

### 3. Transactional & Idempotent Catalog Commitment (CR-05)

In `backend/src/application/conversion-job-service.ts`, `commitJobToCatalog` is wrapped in an atomic database transaction using pessimistic row locking (`SELECT ... FOR UPDATE`):

```typescript
return await this.db.transaction(async (tx) => {
  // 1. Bloqueo pesimista de fila en background_jobs con FOR UPDATE (CR-05)
  const [job] = await tx
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, jobId))
    .for('update');

  if (!job) {
    throw new NotFoundError('Trabajo de conversión', jobId);
  }

  // Verificación anti-IDOR
  const isOwner = job.userId === user.id;
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (!isOwner && !isPrivileged) {
    throw new ForbiddenError('No tienes autorización para consultar este trabajo de conversión.');
  }

  // Verificación de estado terminal
  if (job.status !== 'COMPLETED' && job.status !== 'REVIEW_REQUIRED') {
    throw new ValidationError('Solo se pueden agregar al catálogo trabajos completados o revisados.');
  }

  // 2. Idempotencia Nivel 1: Si ya fue comprometido previamente en background_jobs
  if (job.committedSongId) {
    return await songService.getSong(job.committedSongId);
  }

  // 3. Idempotencia Nivel 2: Verificar si ya existe una fuente asociada con song_id
  const sources = await tx
    .select()
    .from(songSources)
    .where(eq(songSources.jobId, jobId));

  const existingLinkedSource = sources.find((s) => s.songId !== null);
  if (existingLinkedSource && existingLinkedSource.songId) {
    await tx
      .update(backgroundJobs)
      .set({ committedSongId: existingLinkedSource.songId })
      .where(eq(backgroundJobs.id, jobId));
    return await songService.getSong(existingLinkedSource.songId);
  }

  // 4. Extracción fidedigna de CanonicalMusicPayload (Zero-Fabrication)
  const details = job.errorDetails as any;
  const rawCanonicalJson = details?.canonicalPayload;
  if (!rawCanonicalJson) {
    throw new ValidationError(
      'El trabajo de conversión no generó un CanonicalMusicPayload válido para persistencia en catálogo.'
    );
  }

  // 5. Creación en catálogo mediante SongService
  const song = await songService.createSong({ ... });

  // 6. Registro atómico de committedSongId en background_jobs
  await tx
    .update(backgroundJobs)
    .set({ committedSongId: song.song.id })
    .where(eq(backgroundJobs.id, jobId));

  // 7. Vinculación atómica en song_sources
  ...
  return song;
});
```

#### Dual Idempotency Protection
1. **Level 1 Check:** Direct read of `job.committedSongId` under the `FOR UPDATE` row lock. If present, returns the existing catalog song immediately.
2. **Level 2 Check:** Queries `song_sources` for any existing row linked to `jobId`.
3. **Database-Enforced Index:** Partial unique indexes `idx_background_jobs_committed_song_id` and `idx_song_sources_job_id_unique` guarantee that even in the theoretical event of concurrency bypassing the lock, PostgreSQL rejects duplicate inserts at the storage engine level with SQL error code `23505 (unique_violation)`.

---

### 4. Automated Test Evidence

In `conversion-catalog-idempotency.test.ts`:
- **Successful Commit:** Test 1 verifies that committing a completed job creates 1 song, 1 version, updates `background_jobs.committedSongId`, and links `song_sources`.
- **Sequential Idempotency:** Test 2 verifies that consecutive calls return the identical song ID without generating duplicate database rows.
- **Concurrent Commitment:** Test 3 executes two simultaneous `commitJobToCatalog` calls in parallel. The pessimistic lock serializes them, resulting in **exactly one** song created in the `songs` table.
- **Rollback on Error:** Test 4 verifies that if validation or persistence fails midway, the entire transaction rolls back cleanly, leaving `committedSongId` null and leaving zero orphaned records.
- **Anti-IDOR Security:** Test 5 verifies that an unauthorized user attempting to commit another user's job receives `ForbiddenError` (403) and no catalog records are created.

```
▶ CR-05 & CR-08 — Transactional & Idempotent Catalog Commitment Suite
  ✔ 1. should successfully commit a COMPLETED job to catalog and update committedSongId (176.2634ms)
  ✔ 2. should be sequentially idempotent and return existing song without creating new rows (47.0492ms)
  ✔ 3. should handle concurrent commitment requests safely and create exactly 1 song (93.515ms)
  ✔ 4. should rollback completely and leave no orphans if catalog creation fails (10.6773ms)
  ✔ 5. should reject catalog commitment by unauthorized user (Anti-IDOR) (10.8679ms)
✔ CR-05 & CR-08 — Transactional & Idempotent Catalog Commitment Suite (462.989ms)
```

