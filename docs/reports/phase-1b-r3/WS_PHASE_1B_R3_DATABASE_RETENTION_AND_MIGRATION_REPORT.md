# WORSHIP STUDIO — PHASE 1B-R3
## DATABASE RETENTION, REFERENTIAL INTEGRITY & MIGRATION 0014 REPORT

**Project:** Bethesda Worship Studio  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R3 — Corrective Engineering  
**Subject:** Referential Integrity, Forensic Analysis of Migration 0013 vs 0000, and Application of Migration 0014  
**Date:** 2026-11-05  
**Verification Result:** 100% PASS — ALL 4 FOREIGN KEYS CONFIGURED AS ON DELETE SET NULL  

---

## 1. FORENSIC AUDIT OF MIGRATION 0013 AND MIGRATION 0000

The independent audit of Phase 1B-R2 noted a discrepancy between the narrative documentation and the actual DDL statements:

1. **Documented Claim in Phase 1B-R2:** The Phase 1B-R2 report asserted that Migration 0013 altered `song_id`, `user_id`, and `version_id` to use `ON DELETE SET NULL`.
2. **Actual Code in Migration 0013 (`0013_source_retention_and_referential_integrity.sql`):**
   ```sql
   -- 1. Modificar foreign key song_id para usar ON DELETE SET NULL en vez de CASCADE
   ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_song_id_songs_id_fk";
   ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_song_id_songs_id_fk"
     FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL;

   -- 2. Modificar foreign key user_id para usar ON DELETE SET NULL en vez de CASCADE
   ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_user_id_fkey";
   ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_user_id_users_id_fk";
   ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_user_id_users_id_fk"
     FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
   ```
   Migration 0013 only contained DDL for `song_id` and `user_id`; `version_id` was absent from 0013.
3. **Historical Root Cause in Migration 0000 (`0000_normal_randall_flagg.sql`):**
   Inspection of line 54 of the initial schema migration revealed:
   ```sql
   ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_version_id_song_versions_id_fk"
     FOREIGN KEY ("version_id") REFERENCES "public"."song_versions"("id") ON DELETE set null ON UPDATE no action;
   ```
   Thus, `version_id` had already been created as `ON DELETE SET NULL` in the base migration 0000, which is why Drizzle ORM did not generate an alteration in 0013. However, claiming in the Phase 1B-R2 report that 0013 altered `version_id` was technically inaccurate.

---

## 2. DEFENSE-IN-DEPTH: MIGRATION 0014 IMPLEMENTATION

To eliminate any documentation-code drift and provide an explicit, idempotent DDL statement guaranteeing that `version_id` cannot be regressed, Migration 0014 was created and applied.

### 2.1 Migration DDL (`backend/src/db/migrations/0014_source_retention_version_integrity.sql`)

```sql
-- Migration 0014: Source Retention & Version Integrity (Re-assert ON DELETE SET NULL for version_id)
-- Bethesda Worship Studio - Phase 1B-R3

-- Explicitly re-assert foreign key version_id to use ON DELETE SET NULL
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_version_id_song_versions_id_fk";
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_version_id_song_versions_id_fk"
  FOREIGN KEY ("version_id") REFERENCES "song_versions"("id") ON DELETE SET NULL;
```

### 2.2 Migration Journal Registration (`backend/src/db/migrations/meta/_journal.json`)

The migration was registered at index 14:
```json
{
  "idx": 14,
  "version": "7",
  "when": 1793895600000,
  "tag": "0014_source_retention_version_integrity",
  "breakpoints": true
}
```

### 2.3 Migration Execution Evidence

Executed via `npm run migrate --prefix backend`:
```
> @bethesda/backend@0.1.0 migrate
> tsx src/db/migrate.ts

🚀 Aplicando migraciones de Drizzle desde: ...\backend\src\db\migrations
✅ Migraciones aplicadas con éxito.
```

---

## 3. POSTGRESQL CATALOG VERIFICATION EVIDENCE

A direct query to the PostgreSQL system catalog (`information_schema.referential_constraints`) verified that **every foreign key on the `song_sources` table has `delete_rule = 'SET NULL'`**:

```sql
SELECT
  rc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule,
  rc.update_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu
  ON rc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON rc.constraint_name = ccu.constraint_name
WHERE kcu.table_name = 'song_sources'
ORDER BY rc.constraint_name;
```

### Live Catalog Query Results:

| Constraint Name | Column Name | Foreign Table | Foreign Column | Delete Rule | Update Rule |
|-----------------|-------------|---------------|----------------|-------------|-------------|
| `song_sources_job_id_fkey` | `job_id` | `background_jobs` | `id` | **SET NULL** | `NO ACTION` |
| `song_sources_song_id_songs_id_fk` | `song_id` | `songs` | `id` | **SET NULL** | `NO ACTION` |
| `song_sources_user_id_users_id_fk` | `user_id` | `users` | `id` | **SET NULL** | `NO ACTION` |
| `song_sources_version_id_song_versions_id_fk` | `version_id` | `song_versions` | `id` | **SET NULL** | `NO ACTION` |

---

## 4. AUTOMATED CASCADE RETENTION VERIFICATION

Four automated tests in `universal-ingestion-phase1b-r3.test.ts` verify the physical retention of sources across entity lifecycles:

| Test ID | Test Description | Execution Result |
|---------|------------------|------------------|
| `B1.1` | PostgreSQL catalog verification proves all 4 foreign keys have `delete_rule = 'SET NULL'` | **PASS** |
| `B1.2` | Deleting a `song_version` sets `song_sources.version_id = NULL` while preserving `song_sources` record and `song_id` | **PASS** |
| `B1.3` | Deleting a `song` sets `song_sources.song_id = NULL` while preserving `song_sources` record and physical source binary | **PASS** |
| `B1.4` | Deleting a `user` sets `song_sources.user_id = NULL` while preserving `song_sources` record and physical source binary | **PASS** |

### Summary
The database retention contract for musical source files is unconditionally enforced at both the PostgreSQL engine level and the application repository level.

