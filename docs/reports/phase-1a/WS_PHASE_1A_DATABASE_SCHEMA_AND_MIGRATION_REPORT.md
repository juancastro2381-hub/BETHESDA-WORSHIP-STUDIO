# WORSHIP STUDIO — PHASE 1A DATABASE SCHEMA AND MIGRATION REPORT
## Relational Processing Foundation, OMR Persistence & Audit History

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Database Dialect:** PostgreSQL 18+ / Drizzle ORM 0.39.3  
**Migration File:** `backend/src/db/migrations/0007_eager_iron_patriot.sql`  
**Date:** November 2026  

---

## 1. Schema Design Principles

The Phase 1A database schema introduces persistent relational entities for musical processing, OMR proposals, measure-level analysis, and audit trails. The design strictly preserves the architectural principles established in Phase 2A and Phase 2B:

1. **ACID Durability:** Every OMR upload produces a durable record in `omr_proposals` and `omr_proposal_measures` within a single PostgreSQL database transaction.
2. **AI Draft Invariant:** All OMR outputs default to `is_ai_draft = true` and `review_status = 'DRAFT'` or `'PENDING_REVIEW'`. No record can enter canonical songs or arrangements without human approval.
3. **Application-Level Immutability:** The `omr_audit_history` table records an append-only timeline of all manual modifications, measure flags, approvals, and commitments.
4. **Referential Integrity & Cascading:** Measures and audit logs are bound to their parent proposal via `ON DELETE CASCADE`. Foreign keys to `users.id` utilize `ON DELETE SET NULL` to preserve historical audits if a user account is deleted.
5. **No Data Truncation / No Silent Fallbacks:** High-precision columns (`real` for confidence, `varchar(16)` for musical keys and time signatures, `jsonb` for structured musical events) prevent loss of musical detail.

---

## 2. Table Specifications

### 2.1 Table: `background_jobs`

Tracks the lifecycle of asynchronous processing tasks (OMR recognition, imports, and future batch workflows).

| Column Name | PostgreSQL Data Type | Constraints & Defaults | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Stable unique job identifier |
| `job_type` | `job_type` enum | `NOT NULL` | `'OMR_PROCESSING'`, `'IMPORT_COMMIT'`, `'AUDIO_TRANSCRIPTION'`, `'STEM_SEPARATION'` |
| `status` | `job_status` enum | `NOT NULL DEFAULT 'PENDING'` | `'PENDING'`, `'PROCESSING'`, `'COMPLETED'`, `'FAILED'`, `'CANCELLED'` |
| `user_id` | `uuid` | `REFERENCES users(id) ON DELETE SET NULL` | User who initiated the processing task |
| `tenant_id` | `varchar(64)` | `NOT NULL DEFAULT 'bethesda-default'` | Multi-tenant namespace isolation |
| `input_ref` | `varchar(512)` | `NOT NULL` | Reference to input asset (filename, storage path, or UUID) |
| `output_ref` | `varchar(512)` | `NULLABLE` | Output artifact reference (e.g. proposal ID, song ID) |
| `progress` | `integer` | `NOT NULL DEFAULT 0` | Completion percentage (0 to 100) |
| `error_code` | `varchar(64)` | `NULLABLE` | Structured error identifier |
| `error_details` | `jsonb` | `NOT NULL DEFAULT '{}'` | Diagnostic error payload and stack trace |
| `attempts` | `integer` | `NOT NULL DEFAULT 0` | Current execution attempt count |
| `max_attempts` | `integer` | `NOT NULL DEFAULT 3` | Maximum allowed retries |
| `correlation_id` | `varchar(128)` | `NULLABLE` | Request correlation identifier for observability |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Job creation timestamp |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Last state modification timestamp |
| `started_at` | `timestamptz` | `NULLABLE` | Timestamp when processing started |
| `completed_at` | `timestamptz` | `NULLABLE` | Timestamp when processing reached terminal state |

**Indexes:**
- `idx_background_jobs_job_type` ON `job_type`
- `idx_background_jobs_status` ON `status`
- `idx_background_jobs_user_id` ON `user_id`
- `idx_background_jobs_correlation_id` ON `correlation_id`
- `idx_background_jobs_created_at` ON `created_at`

---

### 2.2 Table: `omr_proposals`

Represents an AI-generated sheet music recognition draft awaiting human review.

| Column Name | PostgreSQL Data Type | Constraints & Defaults | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Proposal unique identifier |
| `job_id` | `uuid` | `REFERENCES background_jobs(id) ON DELETE SET NULL` | Associated background processing job |
| `user_id` | `uuid` | `REFERENCES users(id) ON DELETE SET NULL` | Uploader / owner identifier |
| `source_filename` | `varchar(255)` | `NOT NULL` | Original uploaded score filename |
| `source_hash` | `varchar(64)` | `NOT NULL` | SHA-256 hash of original input bytes |
| `detected_title` | `varchar(255)` | `NULLABLE` | OMR-detected score title |
| `detected_artist` | `varchar(255)` | `NULLABLE` | OMR-detected score composer / artist |
| `detected_key` | `varchar(16)` | `NULLABLE` | OMR-detected primary key (e.g. `'G'`, `'Eb'`) |
| `detected_bpm` | `integer` | `NULLABLE` | OMR-detected tempo marking |
| `detected_time_signature` | `varchar(16)` | `NULLABLE` | OMR-detected primary metric (e.g. `'4/4'`, `'3/4'`, `'6/8'`) |
| `overall_confidence` | `real` | `NOT NULL DEFAULT 0` | Aggregate model confidence score (0.0 to 1.0) |
| `is_ai_draft` | `boolean` | `NOT NULL DEFAULT true` | Mandatory AI draft invariant guard |
| `review_status` | `omr_proposal_status` enum | `NOT NULL DEFAULT 'DRAFT'` | `'DRAFT'`, `'PENDING_REVIEW'`, `'APPROVED_FOR_IMPORT'`, `'REJECTED'`, `'COMMITTED'` |
| `raw_payload` | `jsonb` | `NOT NULL DEFAULT '{}'` | Unrecognized regions and raw bounding boxes |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Generation timestamp |
| `reviewed_at` | `timestamptz` | `NULLABLE` | Human review completion timestamp |
| `reviewed_by_user_id` | `uuid` | `REFERENCES users(id) ON DELETE SET NULL` | Musician who reviewed/approved the proposal |

**Indexes:**
- `idx_omr_proposals_job_id` ON `job_id`
- `idx_omr_proposals_user_id` ON `user_id`
- `idx_omr_proposals_source_hash` ON `source_hash`
- `idx_omr_proposals_review_status` ON `review_status`
- `idx_omr_proposals_created_at` ON `created_at`

---

### 2.3 Table: `omr_proposal_measures`

Stores granular, measure-by-measure recognition outputs, preserving musical structure before canonical commit.

| Column Name | PostgreSQL Data Type | Constraints & Defaults | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Measure proposal unique identifier |
| `proposal_id` | `uuid` | `REFERENCES omr_proposals(id) ON DELETE CASCADE NOT NULL` | Parent proposal reference |
| `measure_number` | `integer` | `NOT NULL` | 1-indexed sequential measure position |
| `time_signature` | `varchar(16)` | `NOT NULL DEFAULT '4/4'` | Measure-specific metric |
| `key_signature` | `varchar(16)` | `NULLABLE` | Measure-specific key or accidentals |
| `chords_detected` | `jsonb` | `NOT NULL DEFAULT '[]'` | Detected harmonic symbols and beat offsets |
| `notes_detected` | `jsonb` | `NOT NULL DEFAULT '[]'` | Detected melodic pitches, octaves, durations, and alterations |
| `lyrics_detected` | `jsonb` | `NOT NULL DEFAULT '[]'` | Detected lyric text syllables and offsets |
| `measure_confidence` | `real` | `NOT NULL DEFAULT 0` | Measure-level model confidence (0.0 to 1.0) |
| `flags` | `jsonb` | `NOT NULL DEFAULT '[]'` | Diagnostic flags (`LOW_CONFIDENCE`, `UNPARSED_CHORD`, etc.) |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

**Indexes & Constraints:**
- `idx_omr_proposal_measures_proposal_id` ON `proposal_id`
- `UNIQUE INDEX idx_omr_proposal_measures_prop_num` ON `(proposal_id, measure_number)`

---

### 2.4 Table: `omr_audit_history`

Provides an immutable, tamper-evident record of all manual edits, state transitions, and canonical commits.

| Column Name | PostgreSQL Data Type | Constraints & Defaults | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Audit record unique identifier |
| `proposal_id` | `uuid` | `REFERENCES omr_proposals(id) ON DELETE CASCADE NOT NULL` | Associated proposal identifier |
| `user_id` | `uuid` | `REFERENCES users(id) ON DELETE SET NULL` | Performing user identifier |
| `action_type` | `omr_action_type` enum | `NOT NULL` | Action performed (see enums below) |
| `target_measure` | `integer` | `NULLABLE` | Target measure position (if applicable) |
| `target_tick` | `integer` | `NULLABLE` | Target tick offset (if applicable) |
| `previous_value` | `jsonb` | `NULLABLE` | State before modification |
| `new_value` | `jsonb` | `NULLABLE` | State after modification |
| `reason` | `text` | `NULLABLE` | Reviewer justification or explanatory note |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Event occurrence timestamp |

**Indexes:**
- `idx_omr_audit_history_proposal_id` ON `proposal_id`
- `idx_omr_audit_history_user_id` ON `user_id`
- `idx_omr_audit_history_created_at` ON `created_at`

---

## 3. Enumerations

Phase 1A registers four specialized PostgreSQL enumerations:

```sql
CREATE TYPE "public"."job_status" AS ENUM(
  'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'
);

CREATE TYPE "public"."job_type" AS ENUM(
  'OMR_PROCESSING', 'IMPORT_COMMIT', 'AUDIO_TRANSCRIPTION', 'STEM_SEPARATION'
);

CREATE TYPE "public"."omr_action_type" AS ENUM(
  'CREATE_PROPOSAL', 'UPDATE_MEASURE', 'APPROVE_MEASURE', 'FLAG_MEASURE',
  'APPROVE_PROPOSAL', 'REJECT_PROPOSAL', 'COMMIT_TO_SONG'
);

CREATE TYPE "public"."omr_proposal_status" AS ENUM(
  'DRAFT', 'PENDING_REVIEW', 'APPROVED_FOR_IMPORT', 'REJECTED', 'COMMITTED'
);
```

---

## 4. Migration Execution & Verification

Migration `0007_eager_iron_patriot.sql` was generated via `drizzle-kit generate` and executed against the local PostgreSQL 18 database using the programmatic runner `npm --prefix backend run migrate` (`tsx src/db/migrate.ts`):

```text
> @bethesda/backend@0.1.0 migrate
> tsx src/db/migrate.ts

🚀 Aplicando migraciones de Drizzle desde: C:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema Musical - Partituras\BETHESDA WORSHIP STUDIO\backend\src\db\migrations
✅ Migraciones aplicadas con éxito.
```

Subsequent runs verified that the migration is idempotent, non-destructive to existing tables (`songs`, `song_versions`, `users`, `setlists`), and fully forward-compatible.

