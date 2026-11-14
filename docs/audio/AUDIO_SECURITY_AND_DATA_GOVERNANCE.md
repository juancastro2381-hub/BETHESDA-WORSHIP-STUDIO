# BETHESDA WORSHIP STUDIO
# AUDIO SECURITY & DATA GOVERNANCE POLICY
## Scope 1C — Threat Modeling, Cryptographic Integrity & User Isolation

**Document Version:** 1.0.0  
**Phase:** Scope 1C — WS-AUDIO-01  
**Date:** November 2026  
**Status:** ACTIVE  
**Repository Branch:** `feature/phase-1a-core-foundation`

---

## 1. Governance Charter & Principles

Bethesda Worship Studio is a non-commercial, privacy-respecting worship software platform. Worship team audio recordings—often consisting of rehearsals, proprietary arrangements, or private church performances—are treated as sensitive ecclesiastical data.

The system adheres to four mandatory security invariants:

1. **Absolute Local Processing**: No audio binary, waveform telemetry, or derived metadata may ever be transmitted to external commercial cloud providers, remote AI services, or third-party transcription APIs.
2. **Fail-Closed Binary Validation**: The server must never trust user-supplied file extensions or declared MIME types. Every byte stream is subjected to deep header and container analysis before being persisted.
3. **Cryptographic Non-Repudiation & Tamper Resistance**: Every audio asset is bound to a SHA-256 cryptographic digest at the moment of ingestion. Any discrepancy detected at rest blocks file delivery immediately.
4. **Anti-IDOR Ownership & Lifecycle Isolation**: Audio assets belong strictly to their uploaders and worship leaders. Unprivileged users cannot modify, replace, or delete assets uploaded by other team members.

---

## 2. Threat Modeling & Defense-in-Depth

The audio subsystem's threat matrix and mitigations are summarized below:

| Threat Vector | Attack Scenario | Implemented Mitigation | Verification |
| :--- | :--- | :--- | :--- |
| **T1: Extension Spoofing** | Attacker renames malicious executable, HTML, or PHP script to `.mp3` or `.wav` to exploit downstream parsers. | `audio-signature-validator.ts` and `signature_inspector.py` inspect magic bytes against strict container standards. Rejects with 400. | Unit & regression tests in `audio-infrastructure.test.ts` and `audio-preservation-and-worker.test.ts`. |
| **T2: Data Tampering at Rest** | Storage disk is compromised or files are swapped/modified out-of-band by an unauthorized process. | `AudioService.downloadAudio` recalculates SHA-256 from disk and compares against `song_audio_assets.sha256Hash`. Discrepancy triggers `IntegrityError` (500). | Verified in `test('2.3 should detect tampering if stored file is altered on disk')`. |
| **T3: Insecure Direct Object References (IDOR)** | Authenticated musician accesses `DELETE /api/v1/audio/:id` specifying a target ID belonging to another worship leader. | `audio.routes.ts` evaluates `asset.uploadedByUserId === user.sub` or `SUPER_ADMIN`/`WORSHIP_LEADER`. Rejects with 403. | Verified in `test('2.6 should prevent musicians from deleting audio assets uploaded by other users')`. |
| **T4: Revoked User Access** | Deactivated or banned user attempts to stream or download audio using a previously issued valid JWT. | `authGuard.requirePermission('songs:read', true)` executes a real-time database query to ensure the user account is active. | Verified in `test('2.5 should enforce real-time active user check on audio streaming')`. |
| **T5: Subprocess Hang / DoS** | Malformed audio stream causes local decoder or FFmpeg subprocess to hang in an infinite loop. | `PythonAudioWorkerBridge` executes via `Promise.race` with an enforce-killed timeout (default 30s) and line-buffered IPC. | Verified in IPC bridge timeout tests. |
| **T6: Path Traversal** | Attacker injects `../../` or Windows path traversal sequences into filename. | Stored filenames use server-generated UUIDs (`<assetId>.<ext>`) in dedicated storage root; original filenames are sanitized and stored as text metadata only. | Verified in `FileStorageService` tests. |
| **T7: Notation Hallucination / Fabrication** | Un-transcribed audio causes system to generate random chords or overwrite canonical sheet music. | `AudioIngestionAdapter` returns null canonical payload, null key, and null BPM. Audio is purely linked as an attachment. | Verified in `test('2.1 should preserve zero-fabrication invariant in AudioIngestionAdapter')`. |
| **T8: Cloud Leakage** | External transcription libraries make background phone-home calls or upload chunks to cloud servers. | Local Python worker dependencies are statically bundled (`imageio-ffmpeg`); worker has zero HTTP client code and zero network permissions. | Audited via dependency analysis and offline worker verification. |

---

## 3. Cryptographic Specification

### 3.1 SHA-256 Digest Lifecycle

```
[Incoming Buffer] ──────────────────────► crypto.createHash('sha256').update(buffer).digest('hex')
                                                         │
                                                         ▼
                                            Stored in PostgreSQL DB:
                                            song_audio_assets.sha256Hash
                                                         │
                                                         ▼
[Physical File on Disk] ─────────────────► backend/storage/audio/<id>.<ext>
                                                         │
                                      [Streaming / Download Request]
                                                         │
                                                         ▼
[Re-read Disk Buffer] ──────────────────► crypto.createHash('sha256').update(diskBuffer).digest('hex')
                                                         │
                                          ┌──────────────┴──────────────┐
                                          │ Computed === Persisted ?    │
                                          └──────────────┬──────────────┘
                                                         │
                                    ┌────────────────────┴────────────────────┐
                                    │ YES                                     │ NO
                                    ▼                                         ▼
                            Deliver to Client                    Throw IntegrityError (500)
                            (HTTP 200 / 206)                     Block Stream Immediately
```

### 3.2 Magic Byte Signatures Enforced

- **MP3 (MPEG-1/2 Audio Layer III)**:
  - Header Tag: `49 44 33` (`ID3`) with valid version byte `< 0xFF`.
  - Frame Sync: First byte `0xFF`, second byte `0xE0` mask (11 sync bits), Layer I/II/III bits non-zero, bitrate index `< 15`, sample rate index `< 3`.
- **WAV (RIFF Waveform Audio)**:
  - Bytes 0-3: `52 49 46 46` (`RIFF`).
  - Bytes 8-11: `57 41 56 45` (`WAVE`).
- **FLAC (Free Lossless Audio Codec)**:
  - Bytes 0-3: `66 4C 61 43` (`fLaC`).
- **OGG (Ogg Vorbis / Opus Container)**:
  - Bytes 0-3: `4F 67 67 53` (`OggS`).
- **M4A / AAC (MPEG-4 Audio)**:
  - Bytes 4-7: `66 74 79 70` (`ftyp`), followed by brands `M4A `, `M4B `, `M4P `, `aac `.
  - Raw ADTS Frame Sync: Bytes `0xFFF1` or `0xFFF9`.

Any buffer deviating from these signatures is rejected prior to any filesystem write.

---

## 4. Role-Based Access Control (RBAC) & Ownership Matrix

| Action | HTTP Route | Required Permission | Active DB Check | Role Allowed | IDOR Check Enforced |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Upload Audio** | `POST /api/v1/songs/:songId/audio` | `songs:create` | Yes (Real-time) | Musician, Worship Leader, Admin | Associated with uploader's user ID |
| **Stream Audio** | `GET /api/v1/audio/:id/stream` | `songs:read` | Yes (Real-time) | All active authenticated users | N/A (Shared Repertoire) |
| **Download Audio** | `GET /api/v1/audio/:id/download` | `songs:read` | Yes (Real-time) | All active authenticated users | N/A (Shared Repertoire) |
| **Delete Audio** | `DELETE /api/v1/audio/:id` | `songs:read` | Yes (Real-time) | Uploader, Worship Leader, Admin | **Enforced**: Non-owner musicians receive 403 Forbidden |

---

## 5. Subprocess Sandbox & Isolation Standards

The Python worker runs as an isolated helper subprocess:
1. **Operating Environment**:
   - Executes inside a virtual environment (`workers/audio_worker/.venv`).
   - Run under the operating system account of the backend service without elevated privileges.
2. **File System Boundaries**:
   - The worker only accesses file paths passed explicitly in the JSON request payload.
   - It performs read-only inspection of target audio files.
3. **Execution Timeouts**:
   - Node.js wrapper enforces a hard timeout (default 30,000 ms) using `setTimeout`.
   - On timeout, `childProcess.kill('SIGKILL')` is dispatched, releasing memory and file handles immediately.
4. **Zero Networking**:
   - No socket libraries (`urllib`, `requests`, `aiohttp`, etc.) are imported.
   - No external ports are opened.

---

## 6. Auditability & Incident Response

- **Security Logging**: All integrity check failures and Anti-IDOR rejections are logged at `WARN`/`ERROR` level with request IP, user ID, asset ID, and timestamp.
- **Corrupted Asset Quarantine**: If an `IntegrityError` is triggered, an administrative alert is generated to notify the system administrator to investigate disk health or restore from backup.
- **Revocation Propagation**: When a user account is deactivated in the administrative console, the real-time active check terminates their audio streaming capability on the very next HTTP request.

