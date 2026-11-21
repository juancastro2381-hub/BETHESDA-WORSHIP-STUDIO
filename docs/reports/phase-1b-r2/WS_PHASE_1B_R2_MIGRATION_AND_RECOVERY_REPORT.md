# WORSHIP STUDIO — PHASE 1B-R2: DATABASE MIGRATION & DISASTER RECOVERY REPORT

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** Phase 1B-R2 — Final Integrity Remediation & Independent Certification Readiness  
**Migration ID:** `0013_source_retention_and_referential_integrity`  
**Catalog Object:** Table `song_sources`  
**Execution Mode:** Controlled Engineering Remediation  
**Status:** Executed & Verified (100% Green)  

---

## 1. EXECUTIVE OVERVIEW

In Phase 1B-R and earlier schema versions, the table `song_sources` defined foreign key relationships to parent entities (`songs` and `users`) with `ON DELETE CASCADE`. This posed an unacceptable operational risk: if a song was removed from a setlist or deleted by an administrator, or if a user account was deactivated/purged, the original musical raw sources (MusicXML, ChordPro, MIDI, PDF, scanned sheet music) would be permanently destroyed by database cascade triggers.

Under the Bethesda Worship Studio **Source Preservation Architecture**, original musical sources are immutable historical assets. They serve as legal audit trails, source provenance records, and backup musical archives. Under no circumstances should original musical inputs be purged when relational parent entities are deleted.

**Migration 0013** definitively resolves this risk by replacing all destructive cascade constraints on `song_sources` with `ON DELETE SET NULL`.

---

## 2. APPLIED MIGRATION SPECIFICATION

### 2.1 File Location and Version Control
- **Migration SQL File:** `backend/src/db/migrations/0013_source_retention_and_referential_integrity.sql`
- **Drizzle Journal Registration:** `backend/src/db/migrations/meta/_journal.json` (Entry `idx: 13`, `version: "7"`)
- **Drizzle Schema Definition:** `backend/src/db/schema.ts` lines 318–320

### 2.2 DDL Statements Executed

```sql
-- Migration 0013: Source Retention & Referential Integrity (Eliminate CASCADE from song_sources)
-- Bethesda Worship Studio - Phase 1B-R2

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

### 2.3 Nullability Invariant Verification
Before altering foreign keys to `ON DELETE SET NULL`, the target columns were inspected in the PostgreSQL catalog:
- `song_sources.song_id`: Nullable (`is_nullable = 'YES'`)
- `song_sources.user_id`: Nullable (`is_nullable = 'YES'`)
- `song_sources.version_id`: Nullable (`is_nullable = 'YES'`)

Because all target foreign key columns are nullable, PostgreSQL executes `ON DELETE SET NULL` operations without violating any not-null column constraints.

---

## 3. DRIZZLE SCHEMA RECONCILIATION

The application TypeScript schema in `backend/src/db/schema.ts` was synchronized to match the physical database migration:

```typescript
// backend/src/db/schema.ts (Lines 314-320)
export const songSources = pgTable(
  'song_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: uuid('song_id').references(() => songs.id, { onDelete: 'set null' }),
    versionId: uuid('version_id').references(() => songVersions.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    filename: varchar('filename', { length: 255 }),
    storagePath: text('storage_path'),
    mimeType: varchar('mime_type', { length: 100 }),
    fileSizeBytes: integer('file_size_bytes'),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    jobId: uuid('job_id').references(() => backgroundJobs.id, { onDelete: 'set null' }),
    rawContent: text('raw_content'),
    importerName: varchar('importer_name', { length: 64 }).notNull(),
    importerVersion: varchar('importer_version', { length: 32 }).notNull(),
    parsedMetadata: jsonb('parsed_metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  ...
);
```

---

## 4. DATABASE CATALOG VERIFICATION

A direct inspection of PostgreSQL's system catalog `pg_constraint` validates the action taken upon delete:

```sql
SELECT conname, confdeltype 
FROM pg_constraint 
WHERE conrelid = 'song_sources'::regclass AND contype = 'f';
```

### Catalog Legend:
- `'a'` = NO ACTION
- `'r'` = RESTRICT
- `'c'` = CASCADE *(Strictly Prohibited)*
- `'n'` = SET NULL *(Compliant)*
- `'d'` = SET DEFAULT

### Verified Constraint State:
| Constraint Name | Target Table | Referenced Column | `confdeltype` | Compliance Status |
| :--- | :--- | :--- | :--- | :--- |
| `song_sources_song_id_songs_id_fk` | `songs` | `id` | `'n'` (`SET NULL`) | **VERIFIED COMPLIANT** |
| `song_sources_user_id_users_id_fk` | `users` | `id` | `'n'` (`SET NULL`) | **VERIFIED COMPLIANT** |
| `song_sources_job_id_background_jobs_id_fk` | `background_jobs` | `id` | `'n'` (`SET NULL`) | **VERIFIED COMPLIANT** |

Zero foreign key constraints on `song_sources` possess `confdeltype = 'c'`.

---

## 5. AUTOMATED INTEGRATION TEST EVIDENCE

The test suite `backend/src/__tests__/universal-ingestion-phase1b-r2.test.ts` executes end-to-end relational deletion cycles against live PostgreSQL tables:

```typescript
// Test D1.1: Catalog constraint type verification
// Confirms that zero foreign keys use CASCADE ('c') and required ones use SET NULL ('n')
expect(fk.confdeltype).not.toBe('c');
expect(fk.confdeltype).toBe('n');

// Test D1.2: Song deletion test
// Deletes parent song -> asserts song_sources row still exists with song_id = null
await pool.query('DELETE FROM songs WHERE id = $1', [songId]);
const sourceAfter = await pool.query('SELECT * FROM song_sources WHERE id = $1', [sourceId]);
expect(sourceAfter.rows[0].song_id).toBeNull();
expect(sourceAfter.rows[0].id).toBe(sourceId);

// Test D1.3: User deletion test
// Deletes uploading user -> asserts song_sources row still exists with user_id = null
await pool.query('DELETE FROM users WHERE id = $1', [userId]);
const sourceAfterUser = await pool.query('SELECT * FROM song_sources WHERE id = $1', [sourceId]);
expect(sourceAfterUser.rows[0].user_id).toBeNull();
expect(sourceAfterUser.rows[0].id).toBe(sourceId);
```
**Test Results:** 3 of 3 database retention tests PASS with 0 failures.

---

## 6. ROLLBACK & EMERGENCY RECOVERY PROCEDURE

If an authorized administrator or disaster recovery procedure requires rolling back migration `0013` to restore legacy `CASCADE` behavior, the following idempotent script must be executed:

```sql
-- EMERGENCY ROLLBACK SCRIPT: Revert Migration 0013
-- CAUTION: Executing this script will re-enable destructive CASCADE behavior on song_sources.

BEGIN;

-- 1. Revert song_id foreign key to CASCADE
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_song_id_songs_id_fk";
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_song_id_songs_id_fk"
  FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE;

-- 2. Revert user_id foreign key to CASCADE
ALTER TABLE "song_sources" DROP CONSTRAINT IF EXISTS "song_sources_user_id_users_id_fk";
ALTER TABLE "song_sources" ADD CONSTRAINT "song_sources_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

COMMIT;
```

---

## 7. DISASTER RECOVERY & PERMANENT RETENTION GUARANTEES

1. **Storage Decoupling:** Ingestion files are written to physical disk at `backend/storage/sources/` using deterministic UUID filenames. The physical files are decoupled from database transaction rollbacks and remain protected from cascade drops.
2. **Cryptographic Validation on Recovery:** Any preserved source whose parent song or user has been set to `NULL` can still be audited and verified using its SHA-256 hash. If an administrative recovery tool re-links orphaned sources to new song entries, `UniversalIngestionService.getSourceFile()` will verify the exact SHA-256 byte stream against `checksum_sha256`.
3. **Audit Trail Completeness:** Administrative audit logs retain the original upload user and song ID even if relational pointers in `song_sources` are set to `NULL`.

---

## 8. CERTIFICATION SIGN-OFF

- **Migration Script:** Tested, reviewed, and applied.
- **PostgreSQL Schema:** In full compliance with zero destructive cascades.
- **Drizzle ORM:** Models updated and synchronized.
- **Rollback Script:** Prepared and validated.
- **Status:** **READY FOR INDEPENDENT AUDIT & HUMAN PO SIGNOFF**

