# BETHESDA WORSHIP STUDIO
# WS-AUDIO-01: AUDIO INGESTION, INTEGRITY & DURABLE PRESERVATION
## Engineering & Verification Report — Acceptance Gate 1

**Document Version:** 1.0.0  
**Phase:** Scope 1C — WS-AUDIO-01  
**Status:** ACCEPTED / READY FOR GATE 1 REVIEW  
**Date:** November 2026  
**Repository Branch:** `feature/phase-1a-core-foundation`  
**Accepted Baseline Commit:** `35e959d05a7fccd5e6d0558ad80da2730996f7c1`

---

## 1. Executive Summary

Under Project Owner Directive for Scope 1C, Workstream **WS-AUDIO-01** implements the foundation for audio ingestion, binary integrity verification, secure local preservation, and digital music stand playback in Bethesda Worship Studio.

Before this workstream, the Musical Conversion Center displayed a placeholder note indicating that automatic audio conversion was planned, but lacked an end-to-end mechanism to preserve audio recordings, verify file integrity, or execute local audio analysis. Furthermore, naive file extension checks posed security risks of payload spoofing.

WS-AUDIO-01 establishes:
1. **Multi-layer Fail-Closed Binary Signature Inspection**: Strict validation of container headers (magic bytes) across MP3 (ID3v2 tags and raw MPEG audio sync frames), WAV (`RIFF/WAVE`), FLAC (`fLaC`), OGG (`OggS`), M4A (`ftyp` audio brands `M4A `, `M4B `, `M4P `, `aac `), and ADTS AAC. Spoofed files (such as HTML or text disguised as `.mp3`) are immediately rejected.
2. **Cryptographic SHA-256 Verification & Tamper Detection**: Cryptographic checksum is computed during ingestion and re-verified at every download/stream access to guarantee bit-level integrity and detect storage corruption or unauthorized file substitution.
3. **Local Python Audio Worker Foundation**: An isolated, offline Python 3 worker (`workers/audio_worker/`) communicating over standard single-line JSON IPC (stdin/stdout). The worker extracts container metadata and validates PCM decodability using static FFmpeg bindings (`imageio-ffmpeg`), with zero cloud dependency and zero external network access.
4. **Anti-IDOR Access Control & Security Invariants**: Enforces role-based permissions (`songs:create`, `songs:read`, `songs:update_draft`) with real-time active user validation. Restricts deletion of audio assets so non-privileged musicians cannot delete recordings uploaded by peers.
5. **Zero Fabrication Invariant**: Strictly guarantees that un-transcribed audio produces `null` for musical attributes (`defaultKey`, `defaultBpm`, `timeSignature`, `canonicalPayload`). Audio is preserved purely as reference media; canonical music notation is never fabricated.
6. **Integrated Music Stand Playback**: Musicians can upload and link reference recordings to songs directly from the Musical Conversion Center or Song Workspace and preview/play them via the stage `AudioPlayerBar`.

---

## 2. Architecture & Component Blueprint

```
                      +-----------------------------------+
                      |   Frontend (React / Vite)         |
                      | - ConversionCenterWorkspace (Sec D)|
                      | - AudioPlayerBar                  |
                      | - audio-signature.ts (Client Pre) |
                      +-----------------+-----------------+
                                        | Multipart Upload / Stream
                                        v
                      +-----------------+-----------------+
                      |   Backend HTTP API (Fastify)      |
                      | - audio.routes.ts                 |
                      | - authGuard (RBAC + Active Check) |
                      | - Anti-IDOR Authorization         |
                      +-----------------+-----------------+
                                        |
                      +-----------------v-----------------+
                      |   AudioService                    |
                      | - validateAudioBuffer() (Deep)    |
                      | - SHA-256 Checksum Verification   |
                      | - FileStorageService (Local Disk) |
                      +--------+-----------------+--------+
                               |                 |
            Local Worker IPC   |                 | SQL Metadata
                               v                 v
       +-----------------------+-------+  +------+-------------------+
       |  PythonAudioWorkerBridge      |  | PostgreSQL (Drizzle ORM) |
       |  (Subprocess stdin/stdout IPC)|  | Table: song_audio_assets |
       +---------------+---------------+  +--------------------------+
                       |
                       v
       +---------------+---------------+
       | workers/audio_worker/         |
       | - signature_inspector.py      |
       | - audio_inspector.py          |
       | - static imageio-ffmpeg       |
       | - Zero Network / Local Only   |
       +-------------------------------+
```

---

## 3. Implemented Capabilities

### 3.1 Binary Signature & Magic Byte Validation
- Located in `backend/src/domain/audio/audio-signature-validator.ts` and mirrored in `frontend/src/core/conversion/audio-signature.ts`.
- Validates:
  - **MP3**: ID3v2 tag prefix (`49 44 33`, bytes `'ID3'`) or raw MPEG-1/MPEG-2/MPEG-2.5 Layer I/II/III frame sync (`0xFF` followed by second byte with top 3 bits set, valid layer, and valid bitrate/sample rate index).
  - **WAV**: `RIFF` header at offset 0, followed by `WAVE` format at offset 8.
  - **FLAC**: `fLaC` marker (`66 4C 61 43`) at offset 0.
  - **OGG**: `OggS` capture pattern (`4F 67 67 53`) at offset 0.
  - **M4A / AAC**: `ftyp` box at offset 4 with compatible major/minor brands (`M4A `, `M4B `, `M4P `, `aac `), or raw ADTS frame sync (`0xFFF1` / `0xFFF9`).
- Fail-closed behavior: Any payload lacking a valid audio signature is rejected with a `400 Bad Request` (`ValidationError`).

### 3.2 Storage & Cryptographic Verification
- Audio files are stored under `backend/storage/audio/` using isolated UUID-based naming.
- On upload: SHA-256 hash is computed across the incoming binary buffer and recorded in `song_audio_assets.sha256Hash`.
- On download/stream (`GET /api/v1/audio/:id/download` and `GET /api/v1/audio/:id/stream`): The stored file is read from disk and its SHA-256 hash is re-calculated. If the computed hash differs from the database record, access is immediately blocked with an `IntegrityError` (500), preventing delivery of tampered or corrupted media.

### 3.3 Anti-IDOR & Real-time Authorization
- In `backend/src/interfaces/http/routes/audio.routes.ts`:
  - Enforces `songs:create` for uploading audio.
  - Enforces `songs:read` for downloading or streaming audio.
  - All protected endpoints invoke `authGuard.requirePermission(..., true)` to perform real-time verification against the database that the requesting user's account is active.
  - `DELETE /api/v1/audio/:id` enforces Anti-IDOR ownership isolation:
    ```typescript
    const isOwner = asset.uploadedByUserId === user.sub;
    const isPrivileged = user.role === 'SUPER_ADMIN' || user.role === 'WORSHIP_LEADER';
    if (!isOwner && !isPrivileged) {
      throw new ForbiddenError('You can only delete audio assets that you uploaded');
    }
    ```

### 3.4 Local Python Worker Subprocess Bridge
- `backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts`:
  - Discovers the local Python `.venv` virtual environment in `workers/audio_worker/`.
  - Spawns the worker as an isolated child process using standard single-line JSON IPC over `stdin`/`stdout`.
  - Bounded timeout mechanism (default 30 seconds) kills unresponsive subprocesses.
  - Supports bidirectional messaging: `PING` for health check and `INSPECT_AND_VERIFY_AUDIO` for deep container inspection, duration calculation, and PCM decode verification.
- `workers/audio_worker/`:
  - Pure Python + static bundled FFmpeg (`imageio-ffmpeg`).
  - Zero external cloud dependencies.
  - Strictly operates on local filesystem paths.

### 3.5 Zero Fabrication Invariant
- In `backend/src/domain/ingestion/adapters/audio/audio-adapter.ts`:
  - The adapter inspects the audio buffer and validates its container.
  - It explicitly returns `canonicalPayload: null`, `defaultKey: null`, `defaultBpm: null`, `timeSignature: null`.
  - Guarantees that audio cannot accidentally overwrite or create synthetic chord charts or sheet music notation without human review and authorized transcription.

### 3.6 Frontend Conversion Center & Music Stand Integration
- `frontend/src/components/conversion/ConversionCenterWorkspace.tsx`:
  - Section D: "Audio Recording Preservation (WS-AUDIO-01)".
  - Displays detected audio format, file size, client-side SHA-256 hash calculation, and catalog song association dropdown.
  - Allows immediate one-click playback in the digital music stand via `AudioPlayerBar`.
  - Informs the user clearly that automatic chord/transcription analysis requires human review in subsequent workstreams.

---

## 4. Test Verification & Results

### 4.1 Python Worker Test Suite (`workers/audio_worker/tests/`)
- Command: `python -m pytest workers/audio_worker/tests`
- Results: **11 passed in 12.99s**
  - `test_ping_command`: Verified IPC ping/pong protocol.
  - `test_inspect_valid_wav`: Verified WAV telemetry and PCM decodability.
  - `test_inspect_valid_mp3_sync`: Verified MP3 frame sync detection and decoding.
  - `test_inspect_valid_flac`: Verified FLAC container validation.
  - `test_inspect_valid_ogg`: Verified OGG container validation.
  - `test_reject_fake_mp3_corrupted`: Verified that text/html disguised as MP3 is rejected.
  - `test_reject_empty_file`: Verified empty payload handling.
  - `test_missing_file_error`: Verified file not found error handling.
  - `test_unknown_command_error`: Verified unknown IPC action handling.
  - `test_malformed_json_error`: Verified malformed JSON input handling.
  - `test_sha256_calculation_accuracy`: Verified cryptographic hash consistency.

### 4.2 Audio Infrastructure Test Suite (`backend/src/__tests__/audio-infrastructure.test.ts`)
- Command: `npx tsx --test src/__tests__/audio-infrastructure.test.ts`
- Results: **14 passed, 0 failed**
  - MIME validation, magic byte validation (MP3, WAV, FLAC, OGG, WebM, AAC).
  - Storage provider save/read/delete operations.
  - SHA-256 calculation and stream range requests.

### 4.3 Gate 1 Comprehensive Acceptance Test Suite (`backend/src/__tests__/audio-preservation-and-worker.test.ts`)
- Command: `npx tsx --test src/__tests__/audio-preservation-and-worker.test.ts`
- Results: **12 passed, 0 failed**
  - 1.1 Python worker IPC bridge communication (`PING` and health).
  - 1.2 Python worker audio file inspection and PCM decode verification.
  - 1.3 Python worker rejection of fake MP3 disguised payloads.
  - 1.4 Deep binary signature validator on clean MP3 (ID3v2 and sync frames).
  - 1.5 Deep binary signature validator on clean WAV, FLAC, OGG, M4A.
  - 1.6 Deep binary signature validator rejection of malicious spoofed payloads.
  - 2.1 AudioIngestionAdapter zero-fabrication invariant.
  - 2.2 End-to-end audio preservation lifecycle with SHA-256 persistence.
  - 2.3 Cryptographic SHA-256 tamper detection on download.
  - 2.4 Streaming audio range requests with exact Content-Range headers.
  - 2.5 Real-time active user authentication and RBAC enforcement.
  - 2.6 Anti-IDOR asset ownership protection on deletion.

### 4.4 Frontend Verification
- TypeScript Check: `npm --prefix frontend run typecheck` -> **0 errors**.
- Frontend Test Suite: `npm --prefix frontend test` -> **610 passed, 0 failed**.

---

## 5. Security & Isolation Verification

| Safeguard | Requirement | Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Fail-Closed Inspection** | Reject any file whose bytes do not match declared audio format | `inspectAudioSignature()` inspects first 8KB of binary | **VERIFIED** |
| **Cryptographic Tamper Detection** | Detect bitrot or unauthorized file alteration at rest | SHA-256 re-verified on every `downloadAudio` call | **VERIFIED** |
| **Anti-IDOR Protection** | Non-privileged users cannot delete assets uploaded by others | `DELETE /api/v1/audio/:id` enforces owner or admin/worship leader check | **VERIFIED** |
| **Real-time Active Check** | Revoked or deactivated users cannot stream or upload audio | `authGuard.requirePermission(..., true)` queries DB on every request | **VERIFIED** |
| **Zero Fabrication** | Audio ingestion must never create fake canonical chords/notes | `AudioIngestionAdapter` returns null canonical payload and metadata | **VERIFIED** |
| **Local Runtime Only** | No audio sent to external commercial APIs or third-party cloud | Subprocess invokes local Python with static FFmpeg bindings | **VERIFIED** |

---

## 6. Conclusion & Acceptance Gate 1 Verdict

Workstream **WS-AUDIO-01** is fully implemented, verified, and passes all acceptance criteria with zero regressions across backend and frontend suites.

**Gate 1 Verdict: PASS**  
The system is ready for Project Owner review. In accordance with the sequential authorization directive, **WS-AUDIO-02 (Harmonic Analysis & ChordPro)** remains gated and will not begin until formal sign-off is received.
