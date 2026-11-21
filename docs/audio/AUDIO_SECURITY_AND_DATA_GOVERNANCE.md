# BETHESDA WORSHIP STUDIO
# AUDIO SECURITY & DATA GOVERNANCE POLICY
## Scope 1C — Threat Modeling, Cryptographic Integrity & User Isolation

**Document Version:** 2.0.0  
**Phase:** Scope 1C — WS-AUDIO-01  
**Status:** ACTIVE (Revalidated)  
**Repository Branch:** `feature/phase-1a-core-foundation`

---

## 1. Governance Charter & Security Invariants

Bethesda Worship Studio treats church rehearsal recordings and reference audio as private ecclesiastical media processed under four mandatory invariants:

1. **Absolute Local Processing**: Audio files never leave the local server host or invoke external cloud AI/transcription APIs.
2. **Fail-Closed Binary Validation**: Declared filenames and Content-Types are untrusted; deep binary header and MPEG/container inspection runs server-side before persistence.
3. **Pre-Delivery Cryptographic Verification**: Every physical file's size and SHA-256 digest (`audio_assets.checksum_sha256`) are verified on a single open file descriptor before both HTTP Range streaming (`206`/`200`) and full downloads.
4. **Real-Time Access Revocation & Anti-IDOR Isolation**: Active user verification applies to every request including active stream tickets, and deletion is isolated to owners or `WORSHIP_LEADER`/`SUPER_ADMIN`.

---

## 2. Threat Modeling & Mitigations

| Threat Vector | Attack / Failure Scenario | Implemented Defense | Code & Test Evidence |
| :--- | :--- | :--- | :--- |
| **T1: Extension & MIME Spoofing** | HTML, text, executable, or ID3-only stub renamed `.mp3`. | `audio-signature-validator.ts` & `signature_inspector.py` require container headers + valid audio frame syncs; reject with `ValidationError` (400). | `audio-infrastructure.test.ts` (#3, #9b); `audio-preservation-and-worker.test.ts` (#6, #7); `test_worker.py` |
| **T2: Data Tampering / TOCTOU on Stream & Download** | On-disk file altered outside target `Range` (e.g., tail byte flipped) or swapped between `stat` and `read`. | `LocalFileSystemAudioStorageProvider.getStream()` opens one `FileHandle`, verifies `stat.size` and full-file streaming SHA-256 (64 KiB chunks) before `createReadStream()`. Rejects with `400 VALIDATION_ERROR` (or `404 NOT_FOUND` if missing). | `audio-preservation-and-worker.test.ts` (#8, #12, #13) |
| **T3: Stale / Suspended User Stream Ticket Abuse** | Musician obtains 60s/25-use stream ticket, then is suspended, locked, or deleted in PostgreSQL before ticket expires. | `verifyActiveAuthorizedStreamUser()` queries `userRepo.findById()` on **both** `?ticket=` and Bearer requests in `GET /api/v1/audio/:id/stream`. Calls `globalStreamTicketService.revokeTicketsForUser()` and returns `403 FORBIDDEN` or `401 UNAUTHORIZED`. | `audio-preservation-and-worker.test.ts` (#15) |
| **T4: Insecure Direct Object Reference (IDOR)** | Non-owner `MUSICIAN` deletes audio uploaded by another team member. | `DELETE /api/v1/audio/:id` permits only `uploadedByUserId === user.sub` or `SUPER_ADMIN` / `WORSHIP_LEADER` (`403 FORBIDDEN`). | `audio-preservation-and-worker.test.ts` (#9) |
| **T5: Path Traversal & Symlink Escape** | Caller/DB key contains `../`, null bytes, drive prefixes, or symlinks escaping `AUDIO_STORAGE_PATH`. | `resolveSafePath()` rejects traversal/null bytes and checks `fs.realpathSync()` containment inside `baseDir`. Saved files use UUID names + `chmod 0o444`. | `audio-infrastructure.test.ts` (#9); `storage-provider.ts` |
| **T6: Orphan Disk Files on Partial Failures** | DB insertion or worker check fails after disk write leaves unreferenced media on disk. | `AudioService.uploadAudio()` deletes physical file in `catch`; `reconcileStorageConsistency()` detects/purges orphans. | `audio-preservation-and-worker.test.ts` (#16) |
| **T7: Worker URI SSRF / Source Overwrite / DoS** | Worker handed `https://`/`file:` URI, `derivativeWavPath == sourcePath`, or 50 MiB file exhausting RAM/CPU. | `PythonAudioWorkerBridge` + `main.py` enforce regex SHA-256, reject protocols/null bytes, forbid `derivative == source`, stream headers/frames in bounded memory, run `ffmpeg -threads 1`, cap probes at 60s, and support `AbortSignal` + 30s timeout kill. | `test_worker.py` (15 passed); `audio-preservation-and-worker.test.ts` (#17) |
| **T8: Musical Hallucination / Canonical Overwrite** | Raw audio auto-generates unverified chords or overwrites song lyrics/notation. | `AudioIngestionAdapter` outputs `null` musical fields; audio assets sit exclusively in satellite table `audio_assets`. | `audio-preservation-and-worker.test.ts` (#5); `conversion-api.test.ts` |

---

## 3. Cryptographic Integrity Flow

```
Upload Buffer ──► crypto.createHash('sha256') ──► Persisted in DB: audio_assets.checksum_sha256
                                                       │
Atomic Write (.tmp.<uuid> -> datasync -> rename -> chmod 0o444)
                                                       │
                                                       ▼
GET /api/v1/audio/:id/stream (or /download)
    ├── Verify User Active/Role in PostgreSQL (`verifyActiveAuthorizedStreamUser`)
    ├── Single FileHandle open(fullPath, 'r') ──► ENOENT? ──► 404 NOT_FOUND
    ├── fstat() size === file_size_bytes?       ──► NO?     ──► Close Handle & 400 VALIDATION_ERROR
    └── Streaming SHA-256 (64 KiB loop on fd) === checksum_sha256?
           ├── NO  ──► Close Handle & Throw ValidationError (HTTP 400, 0 bytes emitted)
           └── YES ──► fileHandle.createReadStream({ start, end, autoClose: true }) + ETag / X-Checksum-Sha256
```

---

## 4. Access Control Matrix (`audio.routes.ts`)

| Endpoint | Permission | Real-Time DB Check | Additional Enforcement |
| :--- | :--- | :--- | :--- |
| `POST /api/v1/songs/:songId/audio` | `songs:create` | Yes (`verifyDatabaseRole = true`) | Fail-closed binary signature + optional Python worker check |
| `GET /api/v1/songs/:songId/audio` | `songs:read` | Yes (`verifyDatabaseRole = true`) | Song existence validation |
| `GET /api/v1/audio/:id` | `songs:read` | Yes (`verifyDatabaseRole = true`) | Asset UUID validation |
| `POST /api/v1/audio/:id/ticket` | `songs:read` | Yes (`verifyDatabaseRole = true`) | Scoped 60s TTL, max 25 uses, bound to `userId` & `assetId` |
| `GET /api/v1/audio/:id/stream` | `songs:read` | **Yes (`verifyActiveAuthorizedStreamUser`)** | Enforced on `?ticket=` & Bearer; revokes tickets on bad user state; pre-stream SHA-256 |
| `POST /api/v1/audio/:id/verify` | `songs:read` | Yes (`verifyDatabaseRole = true`) | Local Python worker inspection & PCM decode probe |
| `GET /api/v1/audio/:id/download` | `songs:read` | Yes (`verifyDatabaseRole = true`) | Full SHA-256 verification before delivery |
| `DELETE /api/v1/audio/:id` | `songs:update_draft` | Yes (`verifyDatabaseRole = true`) | Anti-IDOR: owner OR `WORSHIP_LEADER` / `SUPER_ADMIN` |

---

## 5. Worker Licensing & Infrastructure Disclosure

- **Open-Source Stack**: Python worker uses `numpy` (BSD-3-Clause), `pydantic` (MIT), `pytest` (MIT), and `imageio-ffmpeg` (BSD-2-Clause wrapper) shipping static **FFmpeg 9.0.2** (`gyan.dev` essentials, **GPLv3**). Because FFmpeg runs out-of-process as a local CLI executable in git-ignored `.venv`, repo source code remains unencumbered; binary distribution of `.venv`/FFmpeg requires GPLv3 compliance.
- **Volume Durability**: Production persistent storage infrastructure for `AUDIO_STORAGE_PATH` is **`NOT PRODUCTION VERIFIED`** (`docker-compose.yml` contains local development PostgreSQL only).
