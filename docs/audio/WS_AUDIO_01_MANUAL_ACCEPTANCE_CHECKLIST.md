# BETHESDA WORSHIP STUDIO
# WS-AUDIO-01: MANUAL ACCEPTANCE CHECKLIST
## Project Owner Acceptance & Operational Validation Protocol — Gate 1

**Document Version:** 2.0.0  
**Phase:** Scope 1C — WS-AUDIO-01 (Audio Ingestion, Integrity & Durable Preservation)  
**Branch:** `feature/phase-1a-core-foundation`  
**Checklist Execution Status:** **PENDING** *(All 10 procedures must be executed and verified by the Project Owner; do not pre-mark without live execution.)*

---

## 1. Objective & Scope

This checklist defines the 10 mandatory manual end-to-end procedures for Project Owner sign-off on **WS-AUDIO-01** (Acceptance Gate 1). None of these procedures have been executed automatically via a browser harness; each item remains `PENDING` until manually verified on a running stack.

**Preconditions for Manual Execution:**
- Local PostgreSQL running (`docker compose up -d postgres` or local PostgreSQL instance with migrations applied).
- Backend API server running (`npm --prefix backend run dev`).
- Frontend dev server running (`npm --prefix frontend run dev`).
- Local Python worker environment initialized (`workers/audio_worker/.venv`).
- Two test accounts available:
  - **Director (`WORSHIP_LEADER`)** or **`ADMIN`/`SUPER_ADMIN`**
  - **Musician A (`MUSICIAN`)** and **Musician B (`MUSICIAN`)**

---

## 2. Automated Preflight Sanity Check

```bash
workers/audio_worker/.venv/Scripts/python.exe -m pytest workers/audio_worker/tests -v
npx tsx --test "backend/src/__tests__/audio-infrastructure.test.ts" "backend/src/__tests__/audio-preservation-and-worker.test.ts" "backend/src/__tests__/conversion-api.test.ts"
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
npm --prefix frontend test
```

- **Status:** Automated suites verified prior to manual execution (`15/15` Python worker, `41/41` backend audio/conversion tests, `0` TS errors, `610/610` frontend tests).

---

## 3. Manual Verification Procedures (10 Scenarios — ALL `PENDING`)

### MC-01: MP3 with ID3v2 Upload, Inspection & Container Summary
- **Status:** `PENDING`
- **Steps:**
  1. Log in as **Director (`WORSHIP_LEADER`)** and open `/convert` (**Centro de Conversión Musical**).
  2. Upload a genuine `.mp3` containing an ID3v2 tag (e.g., `El Señor Está en Este Lugar.mp3`).
  3. Inspect the preflight card and confirm zero automatic transcription claims.
- **Expected Result:**
  - Detected source displays as `Audio Recording` (`MP3`, `audio/mpeg`), SHA-256 fingerprint is shown, and UI states automatic chord/score transcription awaits later workstreams and mandatory human review.

---

### MC-02: Raw MP3 Without ID3v2 Upload & Worker Verification
- **Status:** `PENDING`
- **Steps:**
  1. Generate or select an `.mp3` without ID3v2 headers (e.g., stripped with FFmpeg `-write_id3v1 0 -id3v2_version 0`).
  2. Upload and link it to a catalog song via Section D (or API `POST /api/v1/songs/:songId/audio` with `"verifyWithWorker": true`), then invoke `POST /api/v1/audio/:id/verify`.
- **Expected Result:**
  - File is accepted (`201 Created`) based on MPEG frame sync bytes even without `"ID3"` prefix; `/verify` returns `detectedFormat: "MP3"`, `hasId3v2: false`, `pcmDecodeVerified: true`.

---

### MC-03: Additional Universal Containers (WAV, FLAC, OGG, M4A)
- **Status:** `PENDING`
- **Steps:**
  1. Upload valid `.wav`, `.flac`, `.ogg`, or `.m4a` reference recordings and link them to test songs.
- **Expected Result:**
  - Each container passes magic-byte inspection, receives its normalized MIME type (`audio/wav`, `audio/flac`, `audio/ogg`, `audio/mp4`), and persists cleanly.

---

### MC-04: Fail-Closed Protection Against Disguised / Spoofed Files
- **Status:** `PENDING`
- **Steps:**
  1. Create a plain text or HTML file named `fake_worship.mp3` (e.g., `<html><body>Not audio</body></html>`) and a synthetic file containing only an `ID3` 10-byte header followed by plain text.
  2. Attempt to preserve both via UI or `POST /api/v1/songs/:songId/audio`.
- **Expected Result:**
  - Both uploads are rejected (`400 VALIDATION_ERROR`). Zero database rows are written to `audio_assets` and zero files are left in `backend/storage/audio/`.

---

### MC-05: Durable Preservation in `audio_assets`, Read-Only Disk File & Zero Canonical Mutation
- **Status:** `PENDING`
- **Steps:**
  1. Inspect PostgreSQL table `audio_assets` for the uploaded record from `MC-01`.
  2. Inspect `backend/storage/audio/<storage_path>` permissions and SHA-256 hash on disk.
  3. Query `songs` and `song_versions` for the linked catalog song.
- **Expected Result:**
  - Row exists in `audio_assets` with matching `file_size_bytes` and `checksum_sha256`.
  - Physical file on disk matches SHA-256 bit-for-bit and carries read-only permissions (`0o444`).
  - Canonical song fields (`default_key`, `default_bpm`, `time_signature`, `canonical_payload` in `song_versions`) are completely unchanged.

---

### MC-06: Digital Music Stand `AudioPlayerBar` Playback, Seeking (HTTP 206), Volume & Mute
- **Status:** `PENDING`
- **Steps:**
  1. Log in as **Musician A**, open the song linked in `MC-01` inside the Digital Music Stand.
  2. Open DevTools Network tab (inspection only) and press **Play** in `AudioPlayerBar`.
  3. Scrub/seek forward and backward along the timeline; adjust volume and toggle mute.
- **Expected Result:**
  - First request issues a short-lived ticket (`POST /api/v1/audio/:id/ticket`) and streams via `GET /api/v1/audio/:id/stream?ticket=...` returning HTTP `206 Partial Content` with `Accept-Ranges: bytes`, `Content-Range`, `X-Checksum-Sha256`, and `ETag`.
  - Playback is smooth without audio distortion or premature ticket exhaustion during seeking.

---

### MC-07: Cryptographic Tamper Detection on Stream/Download & Missing File 404
- **Status:** `PENDING`
- **Steps:**
  1. Temporarily lift read-only attribute on a test file in `backend/storage/audio/<uuid>.mp3` and flip the **last byte** of the file without changing file size.
  2. Request `GET /api/v1/audio/:id/stream` with `Range: bytes=0-15` and `GET /api/v1/audio/:id/download`.
  3. Remove a separate test file directly from disk and repeat download/stream requests.
- **Expected Result:**
  - Tampered file fails BOTH partial stream (`Range: bytes=0-15`) and full download with HTTP `400 VALIDATION_ERROR` (`Integridad física comprometida`), delivering **zero bytes** to the client.
  - Missing disk file returns structured HTTP `404 NOT_FOUND` instead of an unhandled 500 error.

---

### MC-08: Anti-IDOR Deletion Protection & RBAC Enforcement
- **Status:** `PENDING`
- **Steps:**
  1. Attempt audio upload (`POST /api/v1/songs/:songId/audio`) as **Musician A** (`MUSICIAN`).
  2. Attempt `DELETE /api/v1/audio/:id` on an asset uploaded by **Director** using **Musician A**'s session (Note: temporarily ensure permission check / test Musician B vs Musician A ownership).
  3. Attempt `DELETE /api/v1/audio/:id` using **Director** (`WORSHIP_LEADER`) or **`SUPER_ADMIN`**.
- **Expected Result:**
  - Musician upload is blocked with HTTP `403 FORBIDDEN`.
  - Unprivileged peer deletion is blocked with HTTP `403 FORBIDDEN`.
  - Owner/Director deletion returns HTTP `204 No Content`, deleting both the `audio_assets` record and the physical disk file.

---

### MC-09: Immediate Stream Ticket Revocation Upon User Suspension
- **Status:** `PENDING`
- **Steps:**
  1. As **Musician A**, load the song and request an active stream ticket (`POST /api/v1/audio/:id/ticket`); verify `GET /api/v1/audio/:id/stream?ticket=...` works (`206`).
  2. Within 10 seconds (well inside the 60s TTL), have an Administrator suspend **Musician A**'s account (`account_status = 'SUSPENDED'`).
  3. Immediately perform another `Range` stream request using that same active `?ticket=...` (or existing Bearer token).
- **Expected Result:**
  - Stream request fails immediately with HTTP `403 FORBIDDEN` (`Su cuenta se encuentra en estado 'SUSPENDED'`), and all cached stream tickets for that user are purged.

---

### MC-10: Application Restart & Durable Persistence Recovery
- **Status:** `PENDING`
- **Steps:**
  1. Stop both the backend and frontend server processes completely while leaving PostgreSQL and `backend/storage/audio/` intact.
  2. Restart backend and frontend processes cleanly.
  3. Re-authenticate, navigate to the previously preserved song, run `POST /api/v1/audio/:id/verify` (optional API check), and play the audio in `AudioPlayerBar`.
- **Expected Result:**
  - Catalog song still shows the linked audio asset from PostgreSQL `audio_assets`.
  - SHA-256 verification succeeds and `AudioPlayerBar` streams and seeks properly after process restart.

---

## 4. Manual Acceptance Sign-Off Form (`PENDING`)

| ID | Requirement Summary | Status | Date | Initials | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MC-01** | MP3 with ID3v2 upload & analysis | `PENDING` | | | |
| **MC-02** | Raw MP3 without ID3v2 upload & worker verify | `PENDING` | | | |
| **MC-03** | WAV / FLAC / OGG / M4A container support | `PENDING` | | | |
| **MC-04** | Fail-closed spoof rejection | `PENDING` | | | |
| **MC-05** | `audio_assets` persistence & zero canonical overwrite | `PENDING` | | | |
| **MC-06** | `AudioPlayerBar` playback & HTTP 206 seeking | `PENDING` | | | |
| **MC-07** | Pre-stream SHA-256 tamper block & missing-file 404 | `PENDING` | | | |
| **MC-08** | Anti-IDOR deletion protection & RBAC | `PENDING` | | | |
| **MC-09** | Stream ticket revocation upon account suspension | `PENDING` | | | |
| **MC-10** | Full process restart & playback recovery | `PENDING` | | | |

---

### Formal Gate 1 Project Owner Decision

- [ ] **APPROVED (Gate 1 PASS)** — All 10 manual checks verified cleanly. Authorize **WS-AUDIO-02** planning.
- [ ] **REVISE (Gate 1 CONDITIONAL)** — Additional changes requested prior to Gate 1 closure.
- [ ] **REJECT (Gate 1 FAIL)** — Critical defect identified.

**Reviewer Name:** __________________________________  
**Role:** Project Owner  
**Signature:** _______________________________________  
**Date:** __________________________________________
