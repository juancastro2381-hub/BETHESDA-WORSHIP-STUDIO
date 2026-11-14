# BETHESDA WORSHIP STUDIO
# AUDIO SUBSYSTEM ARCHITECTURE & OPERATIONS MANUAL
## Scope 1C — Local Audio Processing Pipeline, Storage Governance & Worker Lifecycle

**Document Version:** 2.0.0  
**Phase:** Scope 1C — WS-AUDIO-01 Audio Foundation  
**Status:** ACTIVE (Revalidated)  
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
|  | - uploadAudio() with worker option & transactional disk rollback            |  |
|  | - streamAudio() enforcing pre-stream descriptor-bound SHA-256               |  |
|  | - reconcileStorageConsistency() (healthy/orphan/missing/corrupted audit)    |  |
|  +------------------+------------------------------------+---------------------+  |
+---------------------|------------------------------------|------------------------+
                      |                                    |
                      v                                    v
+--------------------------------------+   +----------------------------------------+
| PERSISTENCE & ATOMIC DISK STORAGE    |   | LOCAL WORKER SUBPROCESS BRIDGE         |
|                                      |   |                                        |
| 1. PostgreSQL (Drizzle ORM):         |   | PythonAudioWorkerBridge                |
|    Table: audio_assets               |   | (python-audio-worker-bridge.ts)        |
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

## 3. Ingestion, Verification & Reconciliation Lifecycle

1. **Client Preflight** (`frontend/src/core/conversion/audio-signature.ts`): Inspects file container headers in-browser without fabricating notation.
2. **Upload API** (`POST /api/v1/songs/:songId/audio`):
   - `authGuard.requirePermission('songs:create', true)` validates active DB status, role, and lockout.
   - `AudioService.uploadAudio()` checks song existence, MIME allowlist, size quota (`<= 50 MiB`), and binary magic bytes via `validateAudioMagicBytes()`.
   - `LocalFileSystemAudioStorageProvider.save()` writes `${targetPath}.tmp.${uuid}`, calls `datasync()`, renames atomically to `${uuid}${ext}`, and sets `chmod(0o444)`.
   - If `verifyWithPythonWorker: true`, `PythonAudioWorkerBridge` runs container + FFmpeg PCM verification before inserting into PostgreSQL.
   - Any failure during worker verification or `DrizzleAudioRepository.create()` triggers `storageProvider.delete()` in `catch`, preventing orphan files on disk.
3. **On-Demand Deep Verification** (`POST /api/v1/audio/:id/verify`): Runs `AudioService.inspectAndVerifyStoredAudio()` on any stored asset, mapping missing physical files to `404 NOT_FOUND` and invalid/undecodable payloads to `400 VALIDATION_ERROR`.
4. **Consistency Reconciliation** (`AudioService.reconcileStorageConsistency({ purgeOrphanFiles })`): Compares `audio_assets` rows (`audioRepo.findAll()`) with physical files (`storageProvider.listKeys()`), verifying size and SHA-256 via bounded 64 KiB streaming reads to report `healthyAssetIds`, `missingPhysicalFiles`, `corruptedPhysicalFiles`, and `orphanFiles`.

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
