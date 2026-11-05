# WORSHIP STUDIO — PHASE 1B-R2
## SOURCE RETENTION & DATABASE INTEGRITY REPORT

**Project:** Bethesda Worship Studio  
**Workstream:** C — Source Retention, Foreign Key Invariance & Migration 0013  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R2 — Final Integrity Remediation  
**Status:** Certified Remediated & Fully Verified  

---

## 1. PURPOSE & PRINCIPLE

Under Bethesda Worship Studio's archival requirements:
> *"The raw musical source is an independent, permanent archival record of liturgical work. Deleting a song, version, or user must NEVER trigger the physical or relational deletion of the original imported score source."*

If a worship director deletes a derived song arrangement or a musician account is deactivated, the physical file and the `song_sources` record must survive with its foreign keys nulled out (`ON DELETE SET NULL`), preserving the church's musical score repository indefinitely.

---

## 2. DEFECT ROOT CAUSE & REMEDIATION

### 2.1 The Cascade Deletion Vulnerability in Prior Migrations
1. In `backend/src/db/migrations/0000_flashy_iron_lad.sql`:
   ```sql
   FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE cascade
   ```
2. In `backend/src/db/migrations/0012_sour_absorbing_man.sql`:
   ```sql
   FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
   ```
**Consequence:** When an admin or user deleted a song or deleted their user account, PostgreSQL automatically cascaded the delete to `song_sources`, destroying the database provenance of the original scores and creating orphaned files in the storage system!

### 2.2 Migration 0013: Implementation & Execution
Migration `backend/src/db/migrations/0013_source_retention_and_referential_integrity.sql` was authored, registered in `meta/_journal.json`, and executed via Drizzle:

```sql
-- 1. Actualizar clave foránea song_id en song_sources a ON DELETE SET NULL
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_song_id_songs_id_fk";
ALTER TABLE "song_sources" 
  ADD CONSTRAINT "song_sources_song_id_songs_id_fk" 
  FOREIGN KEY ("song_id") REFERENCES "songs"("id") 
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- 2. Actualizar clave foránea user_id en song_sources a ON DELETE SET NULL
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_user_id_users_id_fk";
ALTER TABLE "song_sources" 
  ADD CONSTRAINT "song_sources_user_id_users_id_fk" 
  FOREIGN KEY ("user_id") REFERENCES "users"("id") 
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- 3. Actualizar clave foránea version_id en song_sources a ON DELETE SET NULL
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_version_id_song_versions_id_fk";
ALTER TABLE "song_sources" 
  ADD CONSTRAINT "song_sources_version_id_song_versions_id_fk" 
  FOREIGN KEY ("version_id") REFERENCES "song_versions"("id") 
  ON DELETE SET NULL ON UPDATE NO ACTION;
```

### 2.3 PostgreSQL Catalog Verification
A direct query against `pg_constraint` confirmed the active constraints in the PostgreSQL 18 instance:
- `song_sources_song_id_songs_id_fk`: `confdeltype = 'n'` (`SET NULL`)
- `song_sources_user_id_users_id_fk`: `confdeltype = 'n'` (`SET NULL`)
- `song_sources_version_id_song_versions_id_fk`: `confdeltype = 'n'` (`SET NULL`)

### 2.4 Preservation of Legacy Null Owner Records
Legacy records with `userId = null` (pre-Phase 1B records or records whose owner account was deleted) are preserved intact. Under Phase 1B-R2 tenant security rules:
- Regular users cannot access null-owner sources (403 Forbidden).
- Administrators can query, download, and reassign null-owner sources.

---

## 3. AUTOMATED TEST EVIDENCE

Tests in `backend/src/__tests__/universal-ingestion-phase1b-r2.test.ts`:

| Test ID | Test Description | Result | Execution Time |
| :--- | :--- | :--- | :--- |
| **C1.1** | `should preserve song_sources record when song is deleted (ON DELETE SET NULL)` | **PASS** | 63.2 ms |
| **C1.2** | `should preserve song_sources record when user is deleted (ON DELETE SET NULL)` | **PASS** | 46.2 ms |

**Workstream C Total:** 2 passed, 0 failed.

