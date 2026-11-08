# WORSHIP STUDIO — PHASE 2A-R
## BACKEND & PERSISTENT QUEUE ARCHITECTURE REPORT (CR-01, CR-02, CR-03, CR-06, CR-09)

**Project:** Bethesda Worship Studio  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Base Commit:** `becf53ef787b5b5c8e9af78fb132fc14ae2f3097`  
**Phase:** 2A-R — Conversion Center Remediation & Certification  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  
**Status:** FULLY IMPLEMENTED & CERTIFIED  

---

## 1. EXECUTIVE ARCHITECTURAL SUMMARY

During Phase 2A-R, the conversion architecture of Bethesda Worship Studio was upgraded from an in-memory client-side prototype to an enterprise-grade, asynchronous, resilient server infrastructure backed by PostgreSQL and `pg-boss`.

### Key Defect Remediations:
1. **CR-01 (Authoritative Backend REST API):** The client UI is fully wired to authoritative Fastify routes (`/api/v1/conversion/*`), decoupling client state from conversion progress and enabling background job execution.
2. **CR-02 (Persistent Background Queue with pg-boss v12.38.1):** Enqueued conversions are processed through a dedicated worker (`ConversionWorker`) operating on queue `'music-conversion'`, with transactional state persistence in `background_jobs`.
3. **CR-03 (Durable Source Preservation & Cryptographic SHA-256 Checksums):** Uploaded sources are written immutably to disk via `LocalFileSystemSourceStorageProvider`, metadata is cataloged in `song_sources`, and on-disk SHA-256 integrity is strictly validated before any retry attempt.
4. **CR-06 (Faithful Catalog Commitment):** `commitJobToCatalog` retrieves the exact `CanonicalMusicPayload` generated during background processing, validates it, links the `song_sources` record, and enforces relational idempotency.
5. **CR-09 (Database State Invariants):** Job status follows deterministic lifecycle transitions: `PENDING` -> `PROCESSING` -> (`COMPLETED` | `REVIEW_REQUIRED` | `FAILED` | `CANCELLED`).

---

## 2. COMPONENT ARCHITECTURE & CONTRACTS

### 2.1 Persistent Queue (`conversion-queue.ts`)
- **Queue Name:** `music-conversion`
- **Engine:** `pg-boss` v12.38.1
- **Connection:** Leverages `env.DATABASE_URL` (or `env.TEST_DATABASE_URL` in test mode).
- **Job Payload Contract (`ConversionJobPayload`):**
  ```typescript
  export interface ConversionJobPayload {
    jobId: string;
    userId: string;
    tenantId: string;
    storageKey: string;
    checksumSha256: string;
    filename: string;
    targetFormat: ConversionTargetFormat;
    options?: ConversionOptions;
  }
  ```
- **Lifecycle Methods:**
  - `startConversionQueue()`: Connects and starts the boss instance singleton.
  - `stopConversionQueue()`: Graceful shutdown draining active jobs.
  - `enqueueConversionJob(payload)`: Inserts task with exponential backoff retry parameters.

### 2.2 Background Conversion Worker (`ConversionWorker`)
The background worker listens to `'music-conversion'` and executes conversion milestones:
1. **Milestone 10% (Job Start):** Marks job status as `PROCESSING`, records `startedAt` timestamp.
2. **Milestone 30% (Source Retrieval & SHA-256 Integrity Verification):** Reads the physical file from `LocalFileSystemSourceStorageProvider` and calculates `crypto.createHash('sha256')`. If the computed hash does not match `job.checksumSha256`, throws `CHECKSUM_MISMATCH_ERROR` and aborts.
3. **Milestone 50% (Canonical Ingestion):** Feeds the source into `ConversionEngine`, generating a structural `CanonicalMusicPayload`.
4. **Milestone 70% (Musical Options Transformation):** Applies `ConversionTransformer.applyOptions(payload, options)` for harmonic transposition, key override, BPM, and meter override without note fabrication.
5. **Milestone 90% (Target Serialization):** Calls the designated exporter (MusicXML, MIDI, ChordPro, LyricsOnly) adhering to Zero-Fabrication contracts.
6. **Milestone 100% (Completion & Persistence):**
   - If any `WARNING` diagnostic is present -> status set to `REVIEW_REQUIRED`.
   - If zero warnings -> status set to `COMPLETED`.
   - Serializes `CanonicalMusicPayload` to JSONB in `job.errorDetails.canonicalPayload` for faithful catalog persistence.

### 2.3 Stale Job Recovery on Startup
If the server crashes or restarts while jobs are in `PENDING` or `PROCESSING`:
`ConversionWorker.recoverStaleJobs()` identifies jobs stuck for > 15 minutes, marks them as `FAILED` with error code `SERVER_RESTART_RECOVERY`, enabling clean human or automated retries without orphaned database rows.

---

## 3. RELATIONAL INTEGRITY & CATALOG PERSISTENCE (CR-06)

When the user activates "Guardar en Catálogo" (`POST /api/v1/conversion/jobs/:jobId/commit`):
1. **Security & Ownership Check:** Enforces `job.userId === user.id` (Anti-IDOR).
2. **Idempotency Verification:** Checks if `song_sources` already references a non-null `song_id` for this `jobId`. If present, immediately returns the existing song entity without re-inserting.
3. **Faithful Rehydration:** Deserializes the canonical payload stored in `job.errorDetails.canonicalPayload`.
4. **Transactional Catalog Insertion:** Creates a new `SongEntity` and `SongVersionEntity` in Bethesda's catalog with `sourceFormat`, musical statistics (`totalMeasures`, `totalNotes`, `totalChords`), and links the `song_sources` record.

---

## 4. DATABASE MIGRATION (0015_conversion_center_enums.sql)

To guarantee relational database integrity, migration `0015_conversion_center_enums.sql` was authored and executed:
```sql
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'CONVERSION';
ALTER TYPE "public"."job_status" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';
```
Applied successfully to both development (`bethesda_worship_dev`) and test (`bethesda_worship_test`) databases.

