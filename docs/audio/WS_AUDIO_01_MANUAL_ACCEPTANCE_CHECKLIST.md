# BETHESDA WORSHIP STUDIO
# WS-AUDIO-01: MANUAL ACCEPTANCE CHECKLIST
## Project Owner Acceptance & Operational Validation Protocol — Gate 1

**Document Version:** 1.0.0  
**Phase:** Scope 1C — WS-AUDIO-01 (Audio Ingestion, Integrity & Durable Preservation)  
**Date:** November 2026  
**Status:** READY FOR EXECUTION  
**Branch:** `feature/phase-1a-core-foundation`

---

## 1. Objective & Scope

This checklist provides the Project Owner and Quality Assurance team with a reproducible, step-by-step procedure to manually verify the deliverables of **WS-AUDIO-01** before granting Gate 1 sign-off.

**Scope of Verification:**
- Audio container detection and deep magic-byte validation.
- Rejection of malicious or spoofed audio payloads (fail-closed).
- Cryptographic SHA-256 integrity and tamper detection.
- Durable audio storage and song catalog association.
- Digital music stand playback integration via `AudioPlayerBar`.
- Zero fabrication of musical notation or chord charts.
- Anti-IDOR asset authorization and real-time active user checks.
- Local Python audio worker health and decoding verification.

---

## 2. Preflight Environment Check

Ensure the development environment is active and healthy:

```bash
# 1. Verify PostgreSQL database connection
# (Ensure Docker or local PostgreSQL is running)

# 2. Verify backend dependencies and compile
cd backend
npm run typecheck

# 3. Verify frontend dependencies and compile
cd ../frontend
npm run typecheck

# 4. Verify local Python audio worker virtual environment
cd ../workers/audio_worker
.venv/Scripts/python -m pytest tests/
```

- [ ] Backend typecheck passes with 0 errors.
- [ ] Frontend typecheck passes with 0 errors.
- [ ] Python worker pytest passes (11 passed).

---

## 3. Verification Test Cases

### Test Case 1: Audio Upload & Container Recognition
- **Target:** Musical Conversion Center (`frontend/src/components/conversion/ConversionCenterWorkspace.tsx`).
- **Steps:**
  1. Open the Bethesda Worship Studio web interface.
  2. Navigate to **Conversion Center** (`/convert`).
  3. Locate the file upload zone.
  4. Select a valid audio recording (e.g., `El Señor Está en Este Lugar.mp3` or any valid `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`).
  5. Inspect the file analysis card.
- **Expected Results:**
  - [ ] File format is accurately detected as `AUDIO_RECORDING`.
  - [ ] Exact format (e.g., `MP3`, `WAV`, `FLAC`) and MIME type are displayed.
  - [ ] SHA-256 hash is computed and displayed in the analysis summary.
  - [ ] A prominent advisory informs the user that automatic transcription requires local analysis and human review in subsequent workstreams.

---

### Test Case 2: Fail-Closed Protection Against Spoofed Files
- **Target:** Binary magic-byte inspection (`audio-signature-validator.ts` and `audio-signature.ts`).
- **Steps:**
  1. Create a dummy text file named `spoofed_audio.mp3` with content `<html><body>Fake Audio</body></html>`.
  2. Attempt to upload `spoofed_audio.mp3` in the Conversion Center or via API (`POST /api/v1/songs/:id/audio`).
- **Expected Results:**
  - [ ] The file is immediately rejected.
  - [ ] Frontend displays an error indicating that the binary signature does not match any valid audio format.
  - [ ] Backend API returns HTTP 400 (`ValidationError`) and no record or file is written to storage.

---

### Test Case 3: Durable Preservation & Song Association
- **Target:** Section D of Conversion Center ("Audio Recording Preservation").
- **Steps:**
  1. In the Conversion Center with a valid audio file selected, expand Section D.
  2. Select an existing song from the catalog dropdown (e.g., "El Señor Está en Este Lugar").
  3. Click **Preserve & Link Audio to Song**.
  4. Wait for the upload and hashing process to complete.
- **Expected Results:**
  - [ ] A success confirmation appears with the persistent Asset ID and verified SHA-256 hash.
  - [ ] The audio record is stored in PostgreSQL table `song_audio_assets`.
  - [ ] The audio file is physically written to `backend/storage/audio/<assetId>.<ext>`.
  - [ ] The original song in the catalog remains intact (canonical notation is NOT overwritten).

---

### Test Case 4: Digital Music Stand Playback Integration
- **Target:** Stage Music Stand (`/workspace` / `/songs/:id`).
- **Steps:**
  1. Navigate to the song to which the audio was linked.
  2. Open the Song Workspace in the Digital Music Stand.
  3. Observe the `AudioPlayerBar` at the bottom/header of the workspace.
  4. Click **Play**.
  5. Test seeking forward and backward along the waveform/progress bar.
  6. Adjust volume and toggle mute.
- **Expected Results:**
  - [ ] Audio plays smoothly without stuttering.
  - [ ] Backend serves the file using HTTP 206 Partial Content range requests (`Accept-Ranges: bytes`).
  - [ ] Time elapsed and total duration are accurately displayed.

---

### Test Case 5: Cryptographic Tamper Detection at Rest
- **Target:** SHA-256 re-verification in `AudioService.downloadAudio`.
- **Steps:**
  1. Locate the physical audio file saved in `backend/storage/audio/<assetId>.<ext>`.
  2. Intentionally modify 1 byte of the physical file using a hex editor or text editor.
  3. Attempt to stream or download the audio via `GET /api/v1/audio/:id/download`.
- **Expected Results:**
  - [ ] The system detects that the on-disk SHA-256 does not match the database record.
  - [ ] Access is refused with HTTP 500 (`IntegrityError: Audio file integrity check failed`).
  - [ ] The tampered file is not delivered to the client.

---

### Test Case 6: Anti-IDOR & Role-Based Access Control (RBAC)
- **Target:** `DELETE /api/v1/audio/:id` and route authorization.
- **Steps:**
  1. Upload an audio asset as User A (Role: `MUSICIAN`).
  2. Authenticate as User B (Role: `MUSICIAN`, different account).
  3. Attempt to delete User A's audio asset via `DELETE /api/v1/audio/<assetId>`.
  4. Authenticate as User C (Role: `WORSHIP_LEADER` or `SUPER_ADMIN`).
  5. Attempt to delete User A's audio asset via `DELETE /api/v1/audio/<assetId>`.
- **Expected Results:**
  - [ ] User B's request is rejected with HTTP 403 Forbidden (`You can only delete audio assets that you uploaded`).
  - [ ] User C's request succeeds with HTTP 200 (privileged role authorized to manage worship repertoire assets).
  - [ ] Deleting an asset removes the database record and cleans up the physical storage file.

---

### Test Case 7: Zero Fabrication Invariant
- **Target:** `AudioIngestionAdapter` and canonical song representation.
- **Steps:**
  1. Review database record for any song associated with an audio file.
  2. Check `songs.canonicalPayload`, `songs.defaultKey`, `songs.defaultBpm`.
- **Expected Results:**
  - [ ] Un-transcribed audio does NOT populate fake chords, melody notes, or lyrics.
  - [ ] `canonicalPayload` retains its existing human-authored content or remains null if newly created.
  - [ ] Musical attributes are never hallucinated from raw audio bytes.

---

## 4. Manual Acceptance Sign-Off Form

| Item | Requirement Description | Verification Method | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **AC-1** | Binary magic-byte inspection (MP3, WAV, FLAC, OGG, M4A) | Automated test & manual upload | [ ] PASS | |
| **AC-2** | Fail-closed rejection of spoofed files | Attempt upload of fake MP3 | [ ] PASS | |
| **AC-3** | Cryptographic SHA-256 storage & tamper detection | Hex edit disk file & test download | [ ] PASS | |
| **AC-4** | Audio asset linkage to catalog songs | Section D Conversion Center upload | [ ] PASS | |
| **AC-5** | Digital Music Stand playback with AudioPlayerBar | Stage player test with range streaming | [ ] PASS | |
| **AC-6** | Anti-IDOR ownership isolation on deletion | Cross-user DELETE attempt | [ ] PASS | |
| **AC-7** | Real-time active user check on audio streaming | Deactivated user token attempt | [ ] PASS | |
| **AC-8** | Zero fabrication of chords/sheet music | Inspection of canonical payload | [ ] PASS | |
| **AC-9** | Local Python worker offline execution | Subprocess IPC and static FFmpeg | [ ] PASS | |

---

### Formal Gate 1 Review Decision

- [ ] **ACCEPTED (Gate 1 PASS)** — Workstream WS-AUDIO-01 satisfies all integrity, security, and functional criteria. Proceed to schedule review for WS-AUDIO-02 authorization.
- [ ] **REVISE (Gate 1 CONDITIONAL)** — Minor remediations required as specified in notes.
- [ ] **REJECT (Gate 1 FAIL)** — Workstream does not meet core requirements.

**Reviewer Name:** __________________________________  
**Role:** Project Owner / Lead Architect  
**Signature:** _______________________________________  
**Date:** __________________________________________

