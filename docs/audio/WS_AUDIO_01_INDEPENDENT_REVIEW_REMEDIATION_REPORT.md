# BETHESDA WORSHIP STUDIO
# WS-AUDIO-01 — INDEPENDENT REVIEW REMEDIATION REPORT
## Security, Integrity, Operational Hardening & Gate 1 Revalidation Package

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Reviewed Baseline Commit:** `a5d27392628986475e160ca1647ce6699af960fe` (superseding prior baseline `ab016a9cdfed7e71e42176a1aa2407dc957206c8`)  
**Workstream Scope:** `WS-AUDIO-01` ONLY (WS-AUDIO-02 and WS-AUDIO-03 remain strictly gated)  
**Remediation Status:** `CONDITIONAL PASS` (Technical remediations, storage failure-path hardening & automated suites verified; 10-point Manual Acceptance Checklist `PENDING` Project Owner execution)

---

## 1. Executive Summary

Following the independent security/architecture review (Findings **A through E**) and the **Final Storage Failure-Path Audit** (`uploadAudio()` compensation failure, `deleteAudio()` physical/DB split-failure consistency, and `reconcileStorageConsistency()` concurrency & safety guards), all identified code defects, error-suppression gaps, worker production integrations, and inaccurate absolute documentation claims have been remediated cleanly within the strict boundaries of WS-AUDIO-01. Canonical musical notation (`songs` / `song_versions`) was left untouched.

---

## 2. Remediation Details by Finding

### Finding A — Streaming SHA-256 Integrity & Single-Descriptor TOCTOU Closure
- **Original Defect:**
  - `AudioService.downloadAudio()` checked SHA-256 on full binary download, whereas `AudioService.streamAudio()` called `storageProvider.getStream()` (`fs.createReadStream`) without verifying the file's SHA-256 checksum or byte size on disk. Partial HTTP Range requests (`206 Partial Content`) could serve corrupted/tampered data silently if bytes outside the requested range (or inside before verification) were altered.
  - `LocalFileSystemAudioStorageProvider.getStream()` performed separate `existsSync()`, `stat()`, and `createReadStream()` filesystem calls (TOCTOU window) and threw untyped `Error` messages instead of domain `NotFoundError` / `ValidationError`.
- **Implemented Remediation:**
  - [`backend/src/domain/audio/storage-provider.ts`](../../backend/src/domain/audio/storage-provider.ts):
    - `save()` now writes atomically via temporary file (`${targetPath}.tmp.${uuid}`) with `tempHandle.datasync()` and `fs.promises.rename()`, then applies OS read-only permissions (`chmod(0o444)`) to guard persisted audio against accidental modification. `delete()` restores writable bits (`chmod(0o666)`) before `unlink()`.
    - `resolveSafePath()` rejects empty/null-byte paths, traversal (`..`), drive-letter/absolute prefixes, and verifies symlink containment with `fs.realpathSync()` against `baseDir`.
    - `getStream(storagePath, start, end, options?: StreamIntegrityOptions)` opens **one single read file descriptor** (`fs.promises.open(fullPath, 'r')`), mapping missing files (`ENOENT` / `EISDIR`) cleanly to `NotFoundError` (HTTP `404`). On that open `FileHandle`, it runs `fileHandle.stat()`, verifies `stat.isFile()` and `options.expectedSizeBytes`, and computes full-file SHA-256 using positional `fileHandle.read()` with a fixed `64 KiB` buffer (`STREAM_HASH_CHUNK_BYTES = 65536`) before opening `fileHandle.createReadStream({ start, end, autoClose: true })` from that exact same descriptor. Size or hash mismatches close the descriptor immediately and throw `ValidationError` (HTTP `400 VALIDATION_ERROR`) with zero bytes delivered.
  - [`backend/src/application/audio-service.ts`](../../backend/src/application/audio-service.ts):
    - `streamAudio()` passes `{ expectedChecksumSha256: asset.checksumSha256, expectedSizeBytes: asset.fileSizeBytes }` to `storageProvider.getStream()` and emits `X-Checksum-Sha256` and `ETag` headers on both HTTP `200` and HTTP `206` responses.
- **Verification Evidence:**
  - `backend/src/__tests__/audio-preservation-and-worker.test.ts`: Tests **12** (out-of-range tail-byte tampering blocks `Range: bytes=0-15` stream with HTTP `400 VALIDATION_ERROR`), **13** (`404 NOT_FOUND` on missing disk file during download & stream), and **14** (`0o444` read-only permissions, `X-Checksum-Sha256` / `ETag` headers, repeated seeking without disk mutation).

---

### Finding B — Real-Time Stream Ticket Revocation Upon Account Changes
- **Original Defect:**
  - `GET /api/v1/audio/:id/stream` consumed short-lived `?ticket=` tokens (up to 25 uses / 60s TTL) or Bearer tokens without re-checking PostgreSQL user state (`accountStatus`, `lockoutUntil`, deleted user, or DB role permission). A suspended or deleted user could keep streaming audio using a previously issued stream ticket or JWT until expiry.
- **Implemented Remediation:**
  - [`backend/src/application/stream-ticket-service.ts`](../../backend/src/application/stream-ticket-service.ts):
    - Added `revokeTicket(ticket: string)` and `revokeTicketsForUser(userId: string)` to immediately purge in-memory stream tickets belonging to a revoked/compromised user.
  - [`backend/src/interfaces/http/routes/audio.routes.ts`](../../backend/src/interfaces/http/routes/audio.routes.ts):
    - Added `verifyActiveAuthorizedStreamUser(userId, 'songs:read')`, invoked unconditionally on every `GET /api/v1/audio/:id/stream` request for both the `?ticket=` path and the `Authorization: Bearer` path.
    - Queries PostgreSQL via `userRepo.findById(userId)`:
      - User deleted/missing -> revokes all user tickets and throws `UnauthorizedError` (HTTP `401`).
      - `accountStatus !== 'ACTIVE'` or `lockoutUntil > now()` or missing `'songs:read'` permission in `ROLE_PERMISSIONS` -> revokes all user tickets and throws `ForbiddenError` (HTTP `403`).
- **Verification Evidence:**
  - `backend/src/__tests__/audio-preservation-and-worker.test.ts`: Test **15** validates suspension (`SUSPENDED`), lockout (`lockoutUntil`), cross-asset ticket rejection (`401`), and DB user deletion (`401`) along with immediate `globalStreamTicketService.getTicketState(ticket) === null`.

---

### Finding C — Durable Storage Governance, Rollback & Reconciliation
- **Original Defect:**
  - If `audioRepo.create(...)` threw after `storageProvider.save(...)`, the physical file remained orphaned on disk without reference in PostgreSQL.
  - No storage reconciliation service existed to detect orphan files, missing physical files, or silent at-rest corruption across stored assets.
  - Previous documentation inaccurately cited `song_audio_assets` / `sha256Hash` and assumed production volume durability without infrastructure proof.
- **Implemented Remediation:**
  - [`backend/src/domain/audio/storage-provider.ts`](../../backend/src/domain/audio/storage-provider.ts):
    - `delete()` restores writable bits (`chmod(0o666)`) before `unlink()`. Returns `false` idempotently **only** when the file does not exist (`ENOENT`); throws `PersistenceError` on genuine filesystem/lock failures (`EACCES`, `EPERM`, `EBUSY`, `EIO`) instead of silently swallowing cleanup errors.
    - Added optional `stat()` for verification of physical file timestamps during safe orphan reconciliation.
  - [`backend/src/application/audio-service.ts`](../../backend/src/application/audio-service.ts):
    - **Upload Compensation & Failure Recovery:** `uploadAudio()` tracks active `storagePath` keys in `inFlightUploadPaths` and wraps post-save worker verification and DB persistence in `try / catch / finally`. On failure, it attempts physical compensation via `storageProvider.delete(saveResult.storagePath)` and checks `!exists()`. Whether compensation succeeds or fails, the original `primaryError` is preserved unchanged with structured `compensation` telemetry (`attempted`, `succeeded`, `compensationError`, `recoveryRecordId`, `persistedToAuditLog`). If physical compensation fails, zero orphan files is **not** falsely claimed; instead, an actionable `UPLOAD_COMPENSATION_ORPHAN` (`PENDING_RECOVERY`) recovery record is created and persisted in `audit_logs` (`AUDIO_UPLOAD_COMPENSATION_FAILED`) plus `AudioService.getRecoveryRecords()`.
    - **Delete Consistency Lifecycle (`deleteAudio(audioId, actorUserId)`):**
      - *Scenario A (Physical deletion fails before DB deletion):* `audioRepo.delete()` is NOT invoked, preserving the `audio_assets` record attached to its intact physical file, persisting `AUDIO_DELETE_PHYSICAL_FAILED` (`ABORTED_DB_PRESERVED`) in `audit_logs`, and throwing `PersistenceError`. Retrying `deleteAudio()` once the storage fault clears completes cleanly and transitions the record to `RECOVERED`.
      - *Scenario B (Physical deletion succeeds, then DB deletion fails):* Never silently returns success; persists `AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE` (`PENDING_RECOVERY`) with full asset metadata (`assetId`, `songId`, `storagePath`, `checksumSha256`, `fileSizeBytes`) in `audit_logs` + `recoveryRecords`, and throws `PersistenceError`. Subsequent retries of `deleteAudio()` or `reconcileStorageConsistency({ recoverFailedOperations: true })` verify physical absence before completing DB deletion idempotently and logging `AUDIO_RECOVERY_COMPLETED`.
    - **Safe, Audited Reconciliation (`reconcileStorageConsistency()`):** Compares `IAudioRepository.findAll()` (`audio_assets`) with `IAudioStorageProvider.listKeys()` (plus bounded `64 KiB` SHA-256 verification). Never purges files in `inFlightUploadPaths` (`skippedInFlightFiles`) or ambiguous files with unmanaged extensions / within optional `minOrphanAgeMs` grace windows (`ambiguousFiles`). Every confirmed orphan purge logs `AUDIO_ORPHAN_FILE_PURGED` (or `AUDIO_ORPHAN_PURGE_FAILED` in `failedOrphanPurges`), and recovery runs are idempotent across repeated executions.
  - [`backend/src/repositories/audio-repository.ts`](../../backend/src/repositories/audio-repository.ts):
    - Added `findAll()` to `IAudioRepository` and `DrizzleAudioRepository`.
  - **Residual Limitations (Failure Paths):**
    - Because physical disk operations and PostgreSQL writes execute without distributed two-phase commit (2PC), a simultaneous DB outage + disk lock during failed upload compensation relies on process-local `recoveryRecords` telemetry (and stderr logging) until storage or DB recovers so reconciliation can purge the confirmed orphan. Similarly, cross-process crash recovery of pending `DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE` metadata relies on durable `audit_logs` rows if the worker process restarts before automatic reconciliation runs.
  - **Infrastructure Durability Classification (`NOT PRODUCTION VERIFIED`):**
    - Audited [`docker-compose.yml`](../../docker-compose.yml): it provisions only local development PostgreSQL (`postgres:16-alpine` with volume `postgres_data`). No production container deployment or external persistent object/block volume manifest exists in the repository for `AUDIO_STORAGE_PATH` (`backend/storage/audio`). Local development persistence is atomic and reconcilable, while production persistent volume durability is explicitly documented as **NOT PRODUCTION VERIFIED**.
  - **Schema Truth Aligned:** Database table is `audio_assets` (`backend/src/db/schema.ts`) and SHA-256 column is `checksum_sha256` (TypeScript field `checksumSha256`).
- **Verification Evidence:**
  - `backend/src/__tests__/audio-preservation-and-worker.test.ts`: Tests **16** (rollback + healthy/missing/corrupted/orphan reconciliation) and **18.1 – 18.5** (upload DB failure with rollback success, upload DB failure + failed physical rollback preserving primary error + persisting `AUDIO_UPLOAD_COMPENSATION_FAILED` + later recovery, physical delete failure aborting DB delete, DB delete failure after physical delete + idempotent reconciliation & retry recovery, and concurrent in-flight upload / ambiguous file purge protection).

---

### Finding D — Manual Acceptance Closure Governance
- **Original Defect:**
  - [`docs/audio/WS_AUDIO_01_MANUAL_ACCEPTANCE_CHECKLIST.md`](./WS_AUDIO_01_MANUAL_ACCEPTANCE_CHECKLIST.md) omitted required scenarios (MP3 without ID3, stream ticket revocation upon user suspension, application restart persistence recovery), referenced inaccurate table/error names, and showed blank Pass checkboxes next to reports claiming full Gate 1 `PASS`.
- **Implemented Remediation:**
  - Replaced with a complete 10-procedure manual acceptance protocol where **every scenario is explicitly marked `PENDING`** for independent execution by the Project Owner. No synthetic pass results or unauthorized signatures are recorded.

---

### Finding E — Production Python Worker Integration & Worker Resource Bounds
- **Original Defect:**
  - `PythonAudioWorkerBridge` existed with zero production call sites (called only from test suites).
  - `workers/audio_worker/audio_inspector.py` loaded the entire audio source file into RAM (`source_path.read_bytes()`) and full derivative WAVs (`derivative_wav_path.read_bytes()`), lacked explicit URI/protocol rejection, derivative-overwrite guards, `-threads 1` CPU cap, bounded probe decode caps, and `AbortSignal` cancellation support on the Node bridge.
- **Implemented Remediation:**
  - **Production Call Sites Wired:**
    - `AudioService` accepts `PythonAudioWorkerBridge` (`globalPythonAudioWorkerBridge` default) and executes it cleanly inside:
      1. `AudioService.uploadAudio()` when `verifyWithPythonWorker: true` (exposed cleanly on `POST /api/v1/songs/:songId/audio` via optional `verifyWithWorker` boolean schema field, rolling back disk file on failure).
      2. `AudioService.inspectAndVerifyStoredAudio()` exposed via `POST /api/v1/audio/:id/verify` (guarded by `authGuard.requirePermission('songs:read', true)`).
    - Worker validation/not-found errors map cleanly to `ValidationError` (`400`) and `NotFoundError` (`404`) at the service boundary.
  - **Python Worker & Bridge Hardening:**
    - [`backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts`](../../backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts): validates 64-hex `expectedSha256`, rejects null bytes and external URI protocol schemes (`http:`, `https:`, `file:`, `tcp:`, etc.), prevents `derivativeWavPath === sourcePath`, and supports caller cancellation via `InspectAudioOptions.signal?: AbortSignal`.
    - [`workers/audio_worker/main.py`](../../workers/audio_worker/main.py): validates `expectedSha256` (`^[0-9a-fA-F]{64}$`), rejects null bytes/protocol prefixes (`INVALID_ARGUMENT`), and rejects `derivative_path.resolve() == source_path.resolve()` (`INVALID_ARGUMENT`).
    - [`workers/audio_worker/audio_inspector.py`](../../workers/audio_worker/audio_inspector.py): uses bounded 1 MiB header inspection (`_read_bounded_header_window`) + constant-memory streaming MPEG frame walking (`_count_mp3_frames_streaming` in 64 KiB chunks), streams derivative WAV verification without full `read_bytes()`, passes `-threads 1` to `ffmpeg`, and bounds headless PCM probes to `MAX_PROBE_DURATION_SECONDS = 60`.
- **Verification Evidence:**
  - `workers/audio_worker/tests/test_worker.py`: **15 passed** (includes anti-overwrite, URI rejection, malformed SHA-256, and isolated derivative WAV tests).
  - `backend/src/__tests__/audio-preservation-and-worker.test.ts`: Test **17** validates HTTP upload with `verifyWithWorker: true`, `POST /api/v1/audio/:id/verify`, rollback on decode failure, overwrite/protocol rejection, and `AbortSignal` termination.

---

### Durable Recovery After Backend Process Restart

- **Original Defect:**
  - Although audio storage failure-path compensation persisted recovery events (`AUDIO_UPLOAD_COMPENSATION_FAILED`, `AUDIO_DELETE_PHYSICAL_FAILED`, `AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE`, `AUDIO_RECOVERY_COMPLETED`, `AUDIO_ORPHAN_FILE_PURGED`) into PostgreSQL `audit_logs`, `AudioService.recoveryRecords` existed strictly in process-local RAM.
  - `IAuditLogRepository.list()` lacked server-side `eventTypes` filtering and chronological ordering (`createdAt`, `id`), so a restarted backend instance started with an empty `recoveryRecords` map and could not reconstruct pending recovery operations from durable database state.
- **Implemented Remediation (Zero Schema Changes):**
  - **Repository Query Filtering & Chronological Replay ([`backend/src/repositories/audit-repository.ts`](../../backend/src/repositories/audit-repository.ts)):** Extended `IAuditLogRepository.list(options?: ListAuditLogsOptions)` and `DrizzleAuditLogRepository.list()` with `eventTypes`, `limit`, `offset`, and `orderDirection: 'asc' | 'desc'`, adding deterministic secondary ordering by `audit_logs.id` so paginated recovery logs replay cleanly in exact chronological order.
  - **PostgreSQL Audit-Log Rehydration ([`backend/src/application/audio-service.ts`](../../backend/src/application/audio-service.ts)):** Added `AudioService.rehydrateRecoveryRecordsFromAuditLogs()`, executed automatically at the start of `reconcileStorageConsistency()`. It pages through `AUDIO_RECOVERY_EVENT_TYPES` in chronological order and reconstructs `AudioStorageRecoveryRecord` entries preserving original `id`, `recoveryType`, `storagePath`, `assetId`, `songId`, `filename`, `mimeType`, `checksumSha256`, `fileSizeBytes`, `createdAt`, `durablyRecorded`, and `aliasRecoveryIds`.
  - **Explicit Recovery Lifecycle States:** Added `AudioRecoveryLifecycleState` distinguishing `OPERATION_FAILURE`, `RECOVERY_PENDING`, `RECOVERY_COMPLETED`, and `MANUAL_INTERVENTION_REQUIRED` alongside `AudioRecoveryStatus` (`PENDING_RECOVERY`, `ABORTED_DB_PRESERVED`, `RECOVERED`, `MANUAL_INTERVENTION_REQUIRED`).
  - **Deterministic Deduplication & Non-Resurrection:** Duplicate failure events with the same `recoveryRecordId` or matching `{recoveryType, storagePath, assetId}` merge deterministically onto a single canonical record (`aliasRecoveryIds`), while `AUDIO_RECOVERY_COMPLETED` and `AUDIO_ORPHAN_FILE_PURGED` pin matching records to `RECOVERED` (`RECOVERY_COMPLETED`) so completed operations never re-execute or resurrect after subsequent restarts.
  - **Strict Metadata Validation & Zero Fabrication (`parseFailureAuditEvent()`):** Requires valid `recoveryRecordId`, traversal-safe `storagePath` (`resolveSafePath()`), `songId`, `filename`, `mimeType`, 64-hex `checksumSha256`, positive integer `fileSizeBytes`, and `assetId` for delete failures. Malformed or incomplete `audit_logs` entries never synthesize repairable records; they surface via `getMalformedRecoveryAuditEntries()` and `reconciliationReport.malformedRecoveryEvents` with `MANUAL_INTERVENTION_REQUIRED`, quarantining referenced disk paths inside `ambiguousFiles`.
  - **Non-Durable Fallback & Outage Safety:** When PostgreSQL `audit_logs` write fails during upload/delete failure compensation, `durablyRecorded` is `false` and status transitions to `MANUAL_INTERVENTION_REQUIRED`; `reconcileStorageConsistency()` never auto-purges files backed only by non-durable in-memory state. When reading `audit_logs` fails during rehydration (`rehydrationReport.rehydrationSucceeded === false`), automatic failed-operation recovery and automatic orphan purging are both blocked.
  - **Pre-Action Physical & DB Verification:** Before completing `DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE`, `reconcileStorageConsistency()` verifies that the physical file no longer exists on disk AND that the PostgreSQL `audio_assets` row matches `{storagePath, checksumSha256, fileSizeBytes}`. Before purging `UPLOAD_COMPENSATION_ORPHAN`, it verifies zero `audio_assets` references AND exact bounded streaming size + SHA-256 checksum match.
- **Verification Evidence:**
  - `backend/src/__tests__/audio-preservation-and-worker.test.ts` Criterio **19** (**`19.1`–`19.5`** / Scenarios A–E) verifies process-restart rehydration for upload compensation orphans, physical-deleted/DB-remaining cleanup, completed recovery non-resurrection across multiple restarts, duplicate audit-event deduplication, malformed metadata rejection without auto-purge, and PostgreSQL audit unavailability safety.

---

## 3. License & Distribution Review (`workers/audio_worker/`)

Inspected [`workers/audio_worker/requirements.txt`](../../workers/audio_worker/requirements.txt) and the local Python `.venv` environment (`workers/audio_worker/.venv/Scripts/python.exe`):
- `numpy >= 2.1.0, < 3.0.0`: **BSD-3-Clause** (permissive).
- `pydantic >= 2.10.0, < 3.0.0`: **MIT** (permissive).
- `pytest >= 8.0.0, < 10.0.0`: **MIT** (dev/test only, permissive).
- `imageio-ffmpeg >= 0.6.0, < 1.0.0`: Python wrapper is **BSD-2-Clause**, bundling binary executable `ffmpeg-win-x86_64-v9.0.2.exe` (`9.0.2-essentials_build-www.gyan.dev`), compiled with `--enable-gpl --enable-version3 --enable-static`.
- **Compliance Determination:**
  - **Repository / Source Code:** `.venv/` is git-ignored and NOT committed to source control. Invoking the bundled FFmpeg CLI binary strictly as an out-of-process child subprocess over `stdin`/`stdout`/temp files does **not** trigger GPLv3 copyleft propagation into Bethesda Worship Studio's MIT/proprietary TypeScript or Python application code.
  - **Future Distribution Caveat:** Bethesda Worship Studio is free, non-commercial software. However, if installers, containers, or binary packages redistributing `.venv` or the `ffmpeg` executable are ever published outside local church deployment, distributor obligations under **GPLv3** apply (supply corresponding FFmpeg source code or written offer, retain GPLv3 license notices, and impose no anti-modification/TiVoization restrictions).

---

## 4. Automated Test & Compilation Results (Verified Post-Audit)

| Verification Command | Result | Scope |
| :--- | :--- | :--- |
| `workers/audio_worker/.venv/Scripts/python.exe -m pytest workers/audio_worker/tests -v` | **15 passed in 11.46s** | Worker IPC contract, magic bytes, streaming SHA-256, FFmpeg decode, security guards |
| `npx tsx --test "backend/src/__tests__/audio-infrastructure.test.ts" "backend/src/__tests__/audio-preservation-and-worker.test.ts" "backend/src/__tests__/conversion-api.test.ts"` | **51 passed, 0 failed** (3 suites) | Audio HTTP API (14), WS-AUDIO-01 Gate 1 + Findings A/B/C/E + Storage Failure-Path Audit 18.1–18.5 + Durable Recovery Rehydration Audit 19.1–19.5 (28), Conversion API (9) |
| `npm --prefix backend run typecheck` | **0 errors** (Exit 0) | Full backend TypeScript compilation |
| `npm --prefix frontend run typecheck` | **0 errors** (Exit 0) | Full frontend TypeScript compilation |

*(Frontend production code and frontend test files were unmodified during the storage failure-path and durable recovery rehydration remediations.)*

