# BETHESDA WORSHIP STUDIO
# AUDIO SUBSYSTEM ARCHITECTURE & OPERATIONS MANUAL
## Scope 1C — Local Audio Processing Pipeline & Worker Lifecycle

**Document Version:** 1.0.0  
**Phase:** Scope 1C — Audio Conversion & Preservation Foundation  
**Date:** November 2026  
**Status:** ACTIVE  
**Repository Branch:** `feature/phase-1a-core-foundation`

---

## 1. System Overview

The Bethesda Worship Studio Audio Subsystem provides end-to-end ingestion, cryptographic validation, durable storage, local offline analysis, and low-latency stage playback for worship team recordings.

In accordance with Project Owner directives for Scope 1C:
1. **Local-Only Processing**: All audio decoding, telemetry extraction, and signal processing run strictly on the local host machine. No audio bytes or metadata are ever transmitted to external commercial clouds, third-party APIs, or remote AI platforms.
2. **Zero Fabrication**: Raw audio is never converted into fabricated or hallucinated chord charts or musical scores without verified processing and mandatory human review.
3. **Canonical Song Protection**: Audio files exist as satellite assets/attachments to songs; active canonical song notation is never overwritten automatically.

---

## 2. High-Level Architectural Diagram

```
+-----------------------------------------------------------------------------------+
| FRONTEND CLIENT (React 18 / TypeScript / Vite)                                    |
|                                                                                   |
|  +--------------------------------+       +------------------------------------+  |
|  | ConversionCenterWorkspace.tsx  |       | AudioPlayerBar.tsx                 |  |
|  | - Section D: Audio Preservation|       | - Stage Music Stand Playback       |  |
|  | - audio-signature.ts (Preflight)|       | - Range Streaming & Scrubber       |  |
|  +----------------+---------------+       +-----------------+------------------+  |
+-------------------|-----------------------------------------|---------------------+
                    | Multipart Form Upload                   | HTTP 206 Range Stream
                    v                                         v
+-----------------------------------------------------------------------------------+
| BACKEND API GATEWAY (Node.js / Fastify / TypeScript)                              |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | audio.routes.ts                                                             |  |
|  | - AuthGuard: Permission validation (songs:create, songs:read)               |  |
|  | - Active User Check: Real-time DB lookup (revoked session protection)       |  |
|  | - Anti-IDOR Authorization: Ownership isolation on DELETE                    |  |
|  +--------------------------------------+--------------------------------------+  |
|                                         |                                         |
|                                         v                                         |
|  +-----------------------------------------------------------------------------+  |
|  | AudioService.ts                                                             |  |
|  | - Deep binary signature inspection: audio-signature-validator.ts           |  |
|  | - Cryptographic SHA-256 calculation & re-verification on download           |  |
|  | - MIME normalization & metadata extraction                                  |  |
|  +------------------+------------------------------------+---------------------+  |
+---------------------|------------------------------------|------------------------+
                      |                                    |
                      v                                    v
+------------------------------------+   +------------------------------------------+
| PERSISTENCE & STORAGE              |   | LOCAL WORKER SUBPROCESS BRIDGE           |
|                                    |   |                                          |
| 1. PostgreSQL (Drizzle ORM):       |   | PythonAudioWorkerBridge.ts               |
|    Table: song_audio_assets        |   | - Dynamic .venv discovery                |
|    - id, songId, filename, mime    |   | - Stdin/stdout JSON IPC protocol v1      |
|    - sha256Hash, fileSize, duration|   | - Bounded timeout (default 30s)          |
|    - uploadedByUserId, createdAt   |   +---------------------+--------------------+
|                                    |                         | JSON Lines IPC
| 2. Local Disk Storage:             |                         v
|    backend/storage/audio/          |   +------------------------------------------+
|    File: <assetId>.<ext>           |   | PYTHON WORKER (workers/audio_worker/)    |
|    Permissions: Private / Non-pub  |   |                                          |
+------------------------------------+   | - main.py (Single-line JSON dispatcher)  |
                                         | - signature_inspector.py (Magic bytes)   |
                                         | - audio_inspector.py (PCM validation)    |
                                         | - imageio-ffmpeg (Static binary FFmpeg)  |
                                         | - Zero Cloud / Zero Network Sockets      |
                                         +------------------------------------------+
```

---

## 3. Ingestion & Preservation Pipeline

The ingestion lifecycle executes the following stages:

```
[Uploaded File]
      |
      v
[1. Client-Side Pre-validation] (frontend/src/core/conversion/audio-signature.ts)
      - Inspects initial bytes in browser.
      - Confirms basic container match before spending bandwidth.
      |
      v
[2. Multipart Upload to Fastify] (POST /api/v1/songs/:songId/audio)
      - Real-time active user verification (`authGuard.requirePermission('songs:create', true)`).
      - Song existence verification via `SongRepository`.
      |
      v
[3. Deep Magic-Byte Validation] (backend/src/domain/audio/audio-signature-validator.ts)
      - Validates minimum header size (8 KB sample window).
      - Checks container magic bytes:
          * MP3: ID3v2 header (`49 44 33`) or raw MPEG frame sync (`0xFFE0` mask).
          * WAV: `RIFF` + `WAVE`.
          * FLAC: `fLaC`.
          * OGG: `OggS`.
          * M4A: `ftyp` with brand `'M4A '`, `'M4B '`, `'M4P '`, `'aac '`.
          * AAC: ADTS frame sync (`0xFFF1` / `0xFFF9`).
      - Fails closed immediately if bytes do not match declared extension or audio structure.
      |
      v
[4. Cryptographic Hashing]
      - SHA-256 computed across the entire uploaded binary buffer.
      |
      v
[5. Local Disk Storage]
      - Target path: `backend/storage/audio/<assetId>.<extension>`.
      - Written securely using `FileStorageService.save()`.
      |
      v
[6. Database Persistence]
      - Record inserted into `song_audio_assets`:
          * `id`: UUID v4
          * `songId`: Reference to target song
          * `fileName`: Original filename sanitized
          * `mimeType`: Verified MIME type
          * `fileSize`: Exact byte length
          * `sha256Hash`: Cryptographic checksum
          * `uploadedByUserId`: Uploader ID for Anti-IDOR enforcement
          * `createdAt`: UTC timestamp
      |
      v
[7. Python Worker Deep Inspection (Optional/Deferred)]
      - Worker executes `INSPECT_AND_VERIFY_AUDIO` to compute exact duration and confirm PCM decode.
```

---

## 4. Local Python Worker Architecture & IPC Protocol

### 4.1 Virtual Environment & Isolation
- Located at: `workers/audio_worker/`.
- Isolated `.venv` virtual environment configured with Python 3.10+.
- Dependencies defined in `requirements.txt`:
  - `numpy`: Numerical processing for future audio DSP.
  - `pydantic`: Strict schema validation for IPC messages.
  - `imageio-ffmpeg`: Packages a statically linked FFmpeg binary, eliminating system-wide PATH dependencies.
  - `pytest`: Comprehensive unit and regression test suite.
- Security boundary:
  - The Python worker has **zero network access**. It does not open HTTP sockets, make DNS queries, or contact external servers.
  - It only reads and writes over `stdin` and `stdout` as a subprocess spawned by Node.js.

### 4.2 Single-Line JSON IPC Protocol (v1)
Communication between Node.js and Python uses newline-delimited JSON (`\n` separated):

#### Command: `PING`
- **Request (Node.js -> Python):**
  ```json
  {"version": "1.0", "command": "PING", "payload": {}}
  ```
- **Response (Python -> Node.js):**
  ```json
  {"version": "1.0", "status": "SUCCESS", "data": {"message": "PONG", "timestamp": 1731558000.0}}
  ```

#### Command: `INSPECT_AND_VERIFY_AUDIO`
- **Request (Node.js -> Python):**
  ```json
  {
    "version": "1.0",
    "command": "INSPECT_AND_VERIFY_AUDIO",
    "payload": {
      "filePath": "C:/path/to/backend/storage/audio/asset.mp3",
      "expectedFormat": "MP3"
    }
  }
  ```
- **Progress Event (Python -> Node.js):**
  ```json
  {"type": "PROGRESS", "stage": "VALIDATING_CONTAINER", "percent": 25.0}
  ```
- **Response (Python -> Node.js):**
  ```json
  {
    "version": "1.0",
    "status": "SUCCESS",
    "data": {
      "valid": true,
      "detectedFormat": "MP3",
      "fileSizeBytes": 5242880,
      "verifiedSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "durationSeconds": 245.5,
      "containerDetails": {
        "codec": "mp3",
        "sampleRate": 44100,
        "channels": 2,
        "bitRate": 192000
      },
      "decodeTested": true
    }
  }
  ```

#### Error Handling
If an unrecoverable error occurs, the worker returns:
```json
{
  "version": "1.0",
  "status": "ERROR",
  "error": {
    "code": "INVALID_CONTAINER",
    "message": "File does not match declared format signature."
  }
}
```

### 4.3 Subprocess Lifecycle Management (`PythonAudioWorkerBridge.ts`)
- **Auto-Discovery**: Locates `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (Unix) relative to the workspace root.
- **Process Spawning**: Uses `child_process.spawn()` with pipes for `stdin`, `stdout`, and `stderr`.
- **Bounded Timeout**: Every command is wrapped in a `Promise.race` with an execution timeout (default 30 seconds). If a timeout occurs, the subprocess is terminated with `SIGKILL` to prevent orphan processes.
- **Buffer Safety**: Uses line buffering via `readline` to avoid pipe deadlocks on Windows and Unix handles.

---

## 5. Stage Music Stand Streaming & Range Requests

To support responsive playback in the stage music stand without downloading multi-megabyte audio files upfront, the backend implements **HTTP 206 Partial Content**:

- **Endpoint**: `GET /api/v1/audio/:id/stream`
- **Request Headers**:
  - `Authorization: Bearer <token>`
  - `Range: bytes=0-1048575` (requests the first 1 MB)
- **Response Headers**:
  - `HTTP/1.1 206 Partial Content`
  - `Content-Range: bytes 0-1048575/5242880`
  - `Accept-Ranges: bytes`
  - `Content-Length: 1048576`
  - `Content-Type: audio/mpeg`
- **Playback Component**:
  - `AudioPlayerBar.tsx` connects to the streaming endpoint.
  - Supports instant seeking across long rehearsal recordings without latency.

---

## 6. Storage Layout & Maintenance Operations

### Directory Layout
```
backend/
└── storage/
    └── audio/
        ├── .gitkeep
        ├── 018fa2b3-1111-7000-8000-000000000001.mp3
        ├── 018fa2b3-2222-7000-8000-000000000002.wav
        └── 018fa2b3-3333-7000-8000-000000000003.flac
```

### Backup and Restore
1. **Metadata**: Backed up with standard PostgreSQL pg_dump:
   ```bash
   pg_dump -t song_audio_assets bethesda_worship_studio > backup_audio_metadata.sql
   ```
2. **Audio Binaries**: Backed up via filesystem rsync / copy:
   ```bash
   tar -czvf audio_storage_backup.tar.gz backend/storage/audio/
   ```
3. **Restoration Verification**: After restoring both database and storage directory, running the regression test suite or downloading assets will automatically verify all SHA-256 hashes against stored records.

---

## 7. Operational Troubleshooting

| Symptom | Root Cause | Remediation |
| :--- | :--- | :--- |
| `PythonAudioWorkerBridge: Python executable not found` | Virtual environment has not been initialized. | Run `python -m venv workers/audio_worker/.venv` and install `requirements.txt`. |
| `IntegrityError: Audio file integrity check failed` | File on disk was modified, corrupted, or replaced out-of-band. | Restore original audio file matching the persisted SHA-256 hash or re-upload. |
| `ValidationError: File content does not match audio signature` | User attempted to upload a file with an audio extension but non-audio magic bytes. | Reject file; advise user to verify file validity. |
| `ForbiddenError: You can only delete audio assets that you uploaded` | Non-admin user attempted to delete an asset uploaded by another user. | Normal security behavior (Anti-IDOR). Request worship leader or admin to remove. |
| `Subprocess timed out after 30000ms` | Extremely large audio file or slow disk I/O during PCM decode test. | Worker was killed safely. Check disk performance or adjust timeout setting if processing massive multi-hour multitracks. |
