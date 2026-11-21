# Phase 2A-R2.2.1-R1 — Remaining Technical Risks, Assumptions & Architectural Limitations

**Document Reference:** `docs/reports/phase-2a-r2.2.1-r1/07_REMAINING_RISKS_AND_LIMITATIONS.md`  
**Execution Agent:** Antigravity — Principal Software Engineer & Systems Architect  
**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Phase:** Phase 2A-R2.2.1-R1

---

## 1. Architectural & Library Boundaries

### 1.1 `pg-boss` Unsubscription API Limitation (`offWork`)

- **Context:** The `pg-boss` library (v12.x) does not accept an `AbortSignal` or timeout configuration in `boss.offWork(queueName)`.
- **Engineering Mitigation:** In `ConversionWorker.performStop()`, the unsubscription call is raced against an epoch-deadline timeout:
  ```typescript
  await Promise.race([
    boss.offWork(CONVERSION_QUEUE_NAME),
    timeoutPromise,
  ]);
  ```
  The scheduled timer handle is strictly cleared in a `finally` block to prevent timer leakage.
- **Operational Reality:** If `boss.offWork()` were to hang indefinitely inside the library's internal client connection, the worker shutdown would still complete within the caller's specified `timeoutMs`. However, the orphaned `offWork()` promise would linger until the process terminates or the database client closes.

### 1.2 Dual-Store Coordination Between pg-boss and PostgreSQL `background_jobs`

- **Context:** While `pg-boss` maintains its queue tables in the same PostgreSQL database, queue dispatch and application state in `background_jobs` are separate entities.
- **Engineering Mitigation:** Bethesda Worship Studio uses **fencing tokens** (`leaseToken: crypto.randomUUID()`) and distributed lease expirations (`leaseExpiresAt`). All updates in `processJob()` and `recoverStaleJobs()` use conditional `WHERE` clauses matching both the row status and lease token.
- **Boundary:** If a worker crashes while processing, the pg-boss job will eventually expire according to pg-boss retention rules, and the `background_jobs` row will expire according to `leaseExpiresAt`. The authoritative recovery mechanism in `recoverStaleJobs()` safely bridges the two by re-enqueuing only when the distributed lease has genuinely expired.

---

## 2. Infrastructure & Runtime Environmental Considerations

### 2.1 Filesystem Permissions: Windows ACLs vs. POSIX Permissions

- **Context:** Development occurs on Windows 11, where filesystem permissions are governed by Windows Access Control Lists (ACLs) rather than Unix POSIX octal modes (`chmod 000`).
- **Engineering Mitigation:** Unit and integration tests for `EACCES` and `EPERM` simulate filesystem permission denial by intercepting `fs.promises.access`, `fs.promises.unlink`, and `fs.promises.readFile` with authentic Node `SystemError` objects (`code: 'EACCES'`).
- **Production Environment:** In Linux production containers (e.g. Alpine/Debian Docker containers), volume permission denial emits standard POSIX `EACCES` and `EPERM` error codes. The implementation handles both seamlessly without platform-specific assumptions.

### 2.2 Database Connection Pool Sizing Under Worker Scaling

- **Context:** Every concurrent worker processes jobs using active connection transactions, periodic heartbeats, and stale job polling.
- **Recommendation:** In production multi-pod or multi-worker deployments, ensure `PGPOOL_MAX` and PostgreSQL's `max_connections` are sized as follows:
  $$\text{Required Connections} \ge (\text{Worker Instances} \times \text{Concurrency Limit}) + \text{HTTP Server Pool} + 10$$
  In development and testing, `PGPOOL_MAX = 20` provides ample headroom.

---

## 3. Explicitly Deferred Capabilities (Phase 2B Scope)

The following capabilities are intentionally and strictly excluded from Phase 2A and scheduled for Phase 2B:

1. **Optical Music Recognition (OMR):** Audiveris, Measure Detection, Staff Line Extraction, and visual score digitization. (Attempts to convert PDF/Images report honest `SOURCE_CATEGORY_DEFERRED_PHASE` errors).
2. **Audio Transcription & Stem Separation:** Demucs v4 audio source separation, WhisperX lyric-to-audio phonetic alignment, and Basic Pitch polyphonic pitch tracking. (Audio inputs report `AUDIO_RECORDING` deferred phase errors).
3. **Tablature Direct Transpilation:** ASCII tablature (`.tab`) import and parser. (Reports `TABLATURE_INGESTION_UNSUPPORTED`).
4. **Cloud Object Storage (Cloudflare R2 / AWS S3):** Currently all sources use `LocalFileSystemSourceStorageProvider` with atomic temp files and SHA-256 deduplication. Remote S3/R2 drivers are deferred.

