# BETHESDA WORSHIP STUDIO
# AUDIO SUBSYSTEM ARCHITECTURE & OPERATIONS MANUAL
## Scope 1C — Local Audio Processing Pipeline, Storage Governance & Worker Lifecycle

**Document Version:** 2.1.0  
**Phase:** Scope 1C — WS-AUDIO-01 Audio Foundation  
**Status:** ACTIVE (Storage Failure-Path Hardened)  
**Repository Branch:** `feature/phase-1a-core-foundation`

---

## 1. System Overview

The Bethesda Worship Studio Audio Subsystem provides local-only ingestion, fail-closed container inspection, cryptographic SHA-256 verification, atomic disk preservation, HTTP 206 streaming with ticket revocation checks, and isolated Python/FFmpeg verification.

Mandatory Scope 1C Invariants:
1. **Local-Only Execution**: Zero external commercial transcription APIs or cloud audio transfers.
2. **Zero Fabrication**: Un-transcribed audio produces `null` musical fields (`defaultKey`, `defaultBpm`, `timeSignature`, `canonicalPayload`).
3. **Canonical Protection**: Audio records live in `audio_assets` and never overwrite human-authored canonical songs.

---

## 2. Architectural Blueprint

```
+-----------------------------------------------------------------------------------+
| FRONTEND CLIENT (React / TypeScript / Vite)                                       |
|                                                                                   |
|  +----------------------------------+      +-----------------------------------+  |
|  | ConversionCenterWorkspace.tsx    |      | AudioPlayerBar.tsx                |  |
|  | - Section D: Audio Preservation  |      | - Music Stand Stage Playback      |  |
|  | - audio-signature.ts (Preflight) |      | - HTTP 206 Range Seeking          |  |
|  +----------------+-----------------+      +-----------------+-----------------+  |
+-------------------|------------------------------------------|--------------------+
                    | JSON Base64 Upload / /ticket             | /stream?ticket=...
                    v                                          v
+-----------------------------------------------------------------------------------+
| BACKEND API GATEWAY (Fastify / TypeScript)                                        |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | audio.routes.ts                                                             |  |
|  | - AuthGuard real-time DB permission checks on upload/download/verify/delete |  |
|  | - verifyActiveAuthorizedStreamUser() on BOTH ?ticket= and Bearer streams    |  |
|  | - Anti-IDOR ownership enforcement on DELETE /api/v1/audio/:id               |  |
|  +--------------------------------------+--------------------------------------+  |
|                                         |                                         |
|                                         v                                         |
|  +-----------------------------------------------------------------------------+  |
|  | AudioService (audio-service.ts)                                             |  |
|  | - validateAudioMagicBytes() -> audio-signature-validator.ts                 |  |
|  | - uploadAudio() (best-effort rollback + audit_logs recovery)                 |  |
|  | - streamAudio() enforcing pre-stream descriptor-bound SHA-256               |  |
|  | - deleteAudio() + reconcileStorageConsistency() (in-flight & ambiguous guards)|  |
|  +------------------+------------------------------------+---------------------+  |
+---------------------|------------------------------------|------------------------+
                      |                                    |
                      v                                    v
+--------------------------------------+   +----------------------------------------+
| PERSISTENCE & ATOMIC DISK STORAGE    |   | LOCAL WORKER SUBPROCESS BRIDGE         |
|                                      |   |                                        |
| 1. PostgreSQL (Drizzle ORM):         |   | PythonAudioWorkerBridge                |
|    Tables: audio_assets, audit_logs  |   | (python-audio-worker-bridge.ts)        |
|    - id, song_id, title, filename    |   | - Discovers workers/audio_worker/.venv |
|    - storage_path, mime_type         |   | - stdin/stdout JSON Lines IPC (v1)     |
|    - file_size_bytes, checksum_sha256|   | - 30s default timeout + AbortSignal    |
|    - duration_seconds, uploaded_by.. |   +--------------------+-------------------+
|                                      |                        |
| 2. LocalFileSystemAudioStorageProvider                        v
|    Path: AUDIO_STORAGE_PATH (<uuid>.ext)   PYTHON WORKER (workers/audio_worker/)  |
|    - Atomic .tmp + datasync + rename |     - main.py (v1 validator & dispatcher)  |
|    - Read-only mode (chmod 0o444)    |     - signature_inspector.py               |
|    - Single FileHandle + 64KiB SHA   |     - audio_inspector.py (bounded streaming|
|    - NOT PRODUCTION VERIFIED volume  |       + static imageio-ffmpeg -threads 1)|
+--------------------------------------+   +----------------------------------------+
```

---

## 3. Ingestion, Verification, Failure Compensation & Reconciliation Lifecycle

1. **Client Preflight** (`frontend/src/core/conversion/audio-signature.ts`): Inspects file container headers in-browser without fabricating notation.
2. **Upload API, Contract Normalization, Idempotency & Compensation Failure Handling** (`POST /api/v1/songs/:songId/audio` -> `AudioService.uploadAudio()`):
   - `authGuard.requirePermission('songs:create', true)` validates active DB status, role, and lockout.
   - Route `bodyLimit` is configured to `80 MiB` (`AUDIO_UPLOAD_HTTP_BODY_LIMIT`) to accommodate `50 MiB` audio files in either binary `multipart/form-data` (`file` or `audio` part + metadata fields) or `application/json` Base64 format (`uploadSongAudio()` explicitly sets `Content-Type: application/json`).
   - `AudioService.uploadAudio()` checks song existence, normalizes browser MIME aliases and strips `; codecs=...` parameters, validates size quota (`<= 50 MiB`), and inspects binary magic bytes via `validateAudioMagicBytes()` (including up to 4 chained `ID3v2` headers and a `128 KiB` post-ID3 MPEG frame scan window).
   - **Idempotency & Single-Flight Coalescing:** Concurrent identical uploads coalesce via `inFlightUploadsByKey`, and sequential retries matching `(songId, checksumSha256, fileSizeBytes, filename, title)` (or `idempotencyKey`) return the existing `AudioAsset` after verifying physical disk existence, byte length, and SHA-256 integrity.
   - **Auth Refresh Lifecycle Parity:** `POST /api/v1/auth/refresh` and `GET /api/v1/auth/refresh` validate and rotate the `bethesda_refresh_token` HttpOnly cookie; on `401/403` rejection, `BethesdaApiClient.refreshSession()` throws a structured `ApiError` recognized by `isServerAuthRejectionError()` and notifies `AuthProvider` via `registerAuthFailureListener()` to purge stale local session state immediately.
   - `LocalFileSystemAudioStorageProvider.save()` writes `${targetPath}.tmp.${uuid}`, calls `datasync()`, renames atomically to `${uuid}${ext}`, and sets `chmod(0o444)`.
   - The key is registered in `inFlightUploadPaths` immediately after disk creation and cleared in `finally` to shield concurrent uploads from reconciliation purges.
   - If `verifyWithPythonWorker: true`, `PythonAudioWorkerBridge` runs container + FFmpeg PCM verification before inserting into PostgreSQL.
   - If worker verification or `audioRepo.create()` throws `primaryError`, `AudioService.uploadAudio()` attempts `storageProvider.delete(saveResult.storagePath)` and checks `!exists()`.
     - **Compensation succeeds:** The original `primaryError` is re-thrown with `.compensation = { attempted: true, succeeded: true, ... }`.
     - **Compensation fails:** The original `primaryError` is preserved unchanged (never masked by cleanup errors), `.compensation = { attempted: true, succeeded: false, compensationError, recoveryRecordId, persistedToAuditLog }` is attached, and an actionable recovery record (`UPLOAD_COMPENSATION_ORPHAN`, status `PENDING_RECOVERY`) is stored in `audit_logs` (`AUDIO_UPLOAD_COMPENSATION_FAILED`) and `AudioService.getRecoveryRecords()`. Zero orphan files is therefore achieved *when physical deletion succeeds*, NOT promised unconditionally under filesystem locks.
3. **Delete Consistency Lifecycle** (`DELETE /api/v1/audio/:id` -> `AudioService.deleteAudio(audioId, actorUserId)`):
   - Anti-IDOR ownership (`uploadedByUserId === user.sub` or `SUPER_ADMIN` / `WORSHIP_LEADER`) runs at the HTTP boundary (`audio.routes.ts`).
   - `LocalFileSystemAudioStorageProvider.delete()` restores `0o666` permissions before `unlink()`. Returns `false` idempotently **only** for missing files (`ENOENT`); throws `PersistenceError` on actual unlink/OS errors (`EACCES`, `EBUSY`, `EPERM`, `EIO`).
   - **Scenario A — Physical delete fails before DB delete:** `audioRepo.delete()` is NOT executed. The `audio_assets` row stays attached to its intact disk file, `AUDIO_DELETE_PHYSICAL_FAILED` (`ABORTED_DB_PRESERVED`) is written to `audit_logs`, and `PersistenceError` is thrown.
   - **Scenario B — Physical delete succeeds, then DB delete fails:** Never returns `204`/success. Persists `AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE` (`PENDING_RECOVERY`) with full asset metadata (`assetId`, `songId`, `storagePath`, `checksumSha256`, `fileSizeBytes`) in `audit_logs` + `recoveryRecords`, and throws `PersistenceError`. Retrying `deleteAudio()` or running `reconcileStorageConsistency({ recoverFailedOperations: true })` completes DB removal idempotently and logs `AUDIO_RECOVERY_COMPLETED`.
4. **On-Demand Deep Verification** (`POST /api/v1/audio/:id/verify`): Runs `AudioService.inspectAndVerifyStoredAudio()` on any stored asset, mapping missing physical files to `404 NOT_FOUND` and invalid/undecodable payloads to `400 VALIDATION_ERROR`.
5. **Safe Consistency Reconciliation & Recovery Procedures** (`AudioService.reconcileStorageConsistency(options)`):
   - **Detected states:** `healthyAssetIds`, `missingPhysicalFiles`, `corruptedPhysicalFiles`, `orphanFiles`, `skippedInFlightFiles`, `ambiguousFiles`, `failedOrphanPurges`, `pendingRecoveryRecords`, `recoveredOperations`, and `auditLogIds`.
   - **Concurrency & Ambiguous File Safety:** Keys in `inFlightUploadPaths` and `.tmp.*` temp files are never purged. Unreferenced files with non-audio extensions or newer than `minOrphanAgeMs` (unless matched to a confirmed `UPLOAD_COMPENSATION_ORPHAN` record) are flagged in `ambiguousFiles` and never auto-purged.
   - **Operational Recovery Procedure:**
     1. Run dry inspection first: `reconcileStorageConsistency({ purgeOrphanFiles: false, recoverFailedOperations: false })`.
     2. Review `pendingRecoveryRecords`, `missingPhysicalFiles`, `corruptedPhysicalFiles`, and `ambiguousFiles`, resolving any underlying disk permissions (`chmod`/`chkdsk`/volume remount) or DB connectivity issues.
     3. Execute idempotent recovery & orphan cleanup: `reconcileStorageConsistency({ purgeOrphanFiles: true, recoverFailedOperations: true, minOrphanAgeMs: 60_000 })`.
     4. Verify `audit_logs` contains `AUDIO_ORPHAN_FILE_PURGED` / `AUDIO_RECOVERY_COMPLETED` and `failedOrphanPurges` is empty.
   - **Residual Limitations:** Absence of distributed 2PC between disk and PostgreSQL means a simultaneous storage lock + PostgreSQL outage keeps recovery metadata in process memory (`AudioService.getRecoveryRecords()`) until either subsystem recovers; files flagged in `ambiguousFiles` always require manual operator disposition.

---

## 4. Local Python Worker IPC Protocol (Contract v1)

Implemented verbatim in `workers/audio_worker/main.py` and `backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts`:

### Command: `PING`
- **Request:**
  ```json
  {"contractVersion": "1.0", "jobId": "ping-1731558000", "command": "PING"}
  ```
- **Result:**
  ```json
  {"type": "RESULT", "contractVersion": "1.0", "jobId": "ping-1731558000", "data": {"status": "READY", "workerVersion": "0.1.0", "pythonVersion": "3.14.2"}}
  ```

### Command: `INSPECT_AND_VERIFY_AUDIO`
- **Request:**
  ```json
  {
    "contractVersion": "1.0",
    "jobId": "verify-asset-123",
    "command": "INSPECT_AND_VERIFY_AUDIO",
    "sourcePath": "C:/.../storage/audio/<uuid>.mp3",
    "expectedSha256": "<64-hex-sha256>",
    "derivativeWavPath": "C:/.../tmp/normalized.wav"
  }
  ```
  - `expectedSha256` must match `^[0-9a-fA-F]{64}$`.
  - Null bytes, network/FFmpeg protocol schemes (`http:`, `https:`, `file:`, `tcp:`, `udp:`, etc.), and `derivativeWavPath` resolving to `sourcePath` are rejected with `errorCode: "INVALID_ARGUMENT"`.
- **Progress Events:**
  ```json
  {"type": "PROGRESS", "contractVersion": "1.0", "jobId": "verify-asset-123", "progress": 40, "stage": "Validating binary magic bytes and audio frame signatures"}
  ```
- **Result (`RESULT`):**
  Returns `contractVersion`, `workerVersion`, `verifiedSha256`, `fileSizeBytes`, `detectedFormat`, `mimeType`, `hasId3v2`, `id3TagSizeBytes`, `sampleRateHz`, `channels`, `bitrateKbps`, `durationMs`, `mpegFrameCount`, `pcmDecodeVerified`, `decoderUsed`, `derivativePcmPath`, `derivativePcmSha256`, `derivativePcmBytes`, `warnings`, `pythonVersion`.
- **Errors (`ERROR`):**
  Structured `errorCode` (`INVALID_WORKER_REQUEST`, `MISSING_REQUIRED_FIELDS`, `INVALID_ARGUMENT`, `SOURCE_FILE_NOT_FOUND`, `AUDIO_VALIDATION_FAILED`, `AUDIO_DECODE_FAILED`, `DECODER_UNAVAILABLE`, `WORKER_INTERNAL_ERROR`).

### Resource & License Profile (`workers/audio_worker/`)
- **Dependencies & Licenses (`requirements.txt`):** `numpy` (BSD-3-Clause), `pydantic` (MIT), `pytest` (MIT), `imageio-ffmpeg` (BSD-2-Clause wrapper).
- **Bundled FFmpeg Binary:** `imageio-ffmpeg` ships `ffmpeg-win-x86_64-v9.0.2.exe` (`9.0.2-essentials_build-www.gyan.dev`), built with `--enable-gpl --enable-version3 --enable-static` (**GPLv3**). Invoked strictly as a child CLI process (`-nostdin -threads 1`) via local `.venv` (not committed to git). Redistributing binary installers containing `.venv`/FFmpeg requires GPLv3 compliance (source offer + license notices + no DRM).
- **Memory Bounds:** Worker hashes in `64 KiB` chunks, inspects a bounded `1 MiB` header window (`_read_bounded_header_window`), counts MPEG frames incrementally in `64 KiB` buffers (`_count_mp3_frames_streaming`), streams derivative WAVs in `64 KiB` chunks, and caps headless PCM probes to `MAX_PROBE_DURATION_SECONDS = 60`.

---

## 5. Stage Streaming & Storage Durability Status

- **Range Streaming (`GET /api/v1/audio/:id/stream`):**
  - Validates `?ticket=` (or Bearer JWT) **and** runs `verifyActiveAuthorizedStreamUser(userId, 'songs:read')` against PostgreSQL before opening the file.
  - `LocalFileSystemAudioStorageProvider.getStream()` opens a single `FileHandle`, validates `stat.size === asset.fileSizeBytes` and full-file streaming SHA-256 before delivering HTTP `200`/`206` ranges, setting `X-Checksum-Sha256` and `ETag`.
  - Corrupted physical files return HTTP `400 VALIDATION_ERROR`; missing physical files return HTTP `404 NOT_FOUND`.
- **Backup & Durability Classification:**
  - Development `docker-compose.yml` configures only `postgres:16-alpine` (`postgres_data` local volume). No production persistent volume manifest or redundant object-store configuration exists in the repository for `backend/storage/audio/`.
  - **Production Persistent Volume Durability:** **`NOT PRODUCTION VERIFIED`**. Production deployments must mount persistent, snapshotted storage at `AUDIO_STORAGE_PATH`, back up PostgreSQL `audio_assets` alongside audio binaries, and run `AudioService.reconcileStorageConsistency()` after restores.

### Durable Recovery After Backend Process Restart

- **Audit-Log Rehydration Path:** Before reconciling disk and database consistency, `AudioService.reconcileStorageConsistency()` calls `AudioService.rehydrateRecoveryRecordsFromAuditLogs()`, querying PostgreSQL `audit_logs` via `IAuditLogRepository.list({ eventTypes: [...AUDIO_RECOVERY_EVENT_TYPES], orderDirection: 'asc' })` with secondary ordering by `audit_logs.id` and paginated batching (`pageSize = 1000`).
- **Validated State Reconstruction:** Failure events (`AUDIO_UPLOAD_COMPENSATION_FAILED`, `AUDIO_DELETE_PHYSICAL_FAILED`, `AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE`) are validated strictly in `parseFailureAuditEvent()` (requiring `recoveryRecordId`, traversal-safe `storagePath`, `songId`, `filename`, `mimeType`, 64-hex `checksumSha256`, positive integer `fileSizeBytes`, and `assetId` for deletes). Duplicate events merge deterministically via `aliasRecoveryIds`, and completion events (`AUDIO_RECOVERY_COMPLETED`, `AUDIO_ORPHAN_FILE_PURGED`) transition matching records permanently to `RECOVERED` (`RECOVERY_COMPLETED`).
- **Four Recovery Lifecycle States:** `OPERATION_FAILURE`, `RECOVERY_PENDING`, `RECOVERY_COMPLETED`, and `MANUAL_INTERVENTION_REQUIRED`.
- **Pre-Action Safety & Failure Handling:**
  - Pending `DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE` records only remove `audio_assets` rows after confirming both physical absence on disk and metadata equality (`storagePath`, `checksumSha256`, `fileSizeBytes`).
  - Pending `UPLOAD_COMPENSATION_ORPHAN` records only purge disk files after confirming zero `audio_assets` references and bounded streaming size + SHA-256 verification.
  - Malformed `audit_logs` events never synthesize records; they are exposed in `reconciliationReport.malformedRecoveryEvents` (`getMalformedRecoveryAuditEntries()`) as `MANUAL_INTERVENTION_REQUIRED`, and any candidate disk path is held in `ambiguousFiles` without auto-purge.
  - Non-durable in-memory fallback records (`durablyRecorded: false` when `audit_logs` write fails) are marked `MANUAL_INTERVENTION_REQUIRED` and never trigger automated file purging; if `audit_logs` cannot be read during rehydration (`rehydrationSucceeded === false`), automatic orphan purge and automatic failed-operation recovery are both blocked.
- **Controlled Startup Recovery Governance (`server.ts`, `env.ts`, `audio.routes.ts`):**
  - **Bootstrap Sequence:** After `runMigrations()` and `buildApp()` initialize PostgreSQL connectivity and the Fastify instance (`globalAudioService`), `server.ts` executes `globalAudioService.runStartupRecovery({ enabled: env.AUDIO_STARTUP_RECOVERY_ENABLED, purgeConfirmedOrphans: env.AUDIO_STARTUP_PURGE_CONFIRMED_ORPHANS, logger: app.log })` before `app.listen()`.
  - **Automatic vs Administrator-Controlled Actions:**
    - *Automatic by default (`AUDIO_STARTUP_RECOVERY_ENABLED=true`, `AUDIO_STARTUP_PURGE_CONFIRMED_ORPHANS=false`):* Rehydrates and validates `audit_logs`, performs verified non-destructive DB cleanup for `DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE`, keeps disk orphan files untouched, serializes against concurrent runs via `withRecoveryLock()` and single-flight coalescing, emits structured logs (`AUDIO_STARTUP_RECOVERY_*`), and returns `FAILED_NON_FATAL` (non-blocking) if PostgreSQL `audit_logs` is unreachable so `/api/v1/health` and `/api/v1/audio/recovery/status` remain observable.
    - *Administrator-controlled:* Setting `AUDIO_STARTUP_PURGE_CONFIRMED_ORPHANS=true` for confirmed startup orphan purging, calling `GET /api/v1/audio/recovery/status` or `POST /api/v1/audio/recovery/reconcile` (`authGuard.requirePermission('audit:read', true)` — `SUPER_ADMIN` / `ADMIN` only), and manually resolving `MANUAL_INTERVENTION_REQUIRED` / malformed entries.
- **Test Database Isolation Strategy (`audio-preservation-and-worker.test.ts`):**
  - Integration tests run strictly against isolated `TEST_DATABASE_URL` (`bethesda_worship_test` verified distinct from `DATABASE_URL` `bethesda_worship_dev`), validated by `assertIsolatedTestDatabaseForAuditCleanup()` before any test or cleanup runs.
  - Test audit rows carry per-run/per-scope metadata (`testRunCorrelationId`, `testScopeCorrelationId`), cleaned deterministically by exact `id` + correlation predicates in `try / finally` (`withIsolatedTestScope`) without touching historical `audit_logs` records or altering append-only production audit services (verified by Criterio `20.1`–`20.4`).
- **Operational Limitations:**
  - No continuous background cron scheduler runs after startup; ongoing post-boot reconciliation is invoked explicitly by administrators via `POST /api/v1/audio/recovery/reconcile`.
  - Crashes during simultaneous PostgreSQL `audit_logs` unavailability (`durablyRecorded: false`) leave no durable database record across process restarts and require manual storage/database audit.
  - Persistent volume backup and replication for `AUDIO_STORAGE_PATH` remain **`NOT PRODUCTION VERIFIED`**.
