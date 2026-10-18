# ANTIGRAVITY — BETHESDA WORSHIP STUDIO
## Remediation Sprint R1 — Preflight Verification Report
### Scope: Security, Data Integrity, Audio Offline, OMR and Multitrack Reliability

> **Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`  
> **Target Branch:** `main`  
> **Baseline Commit:** `4e1527cad29b976b8f5493a37ba334921a485dd6` (`Entrega de Flujos de Trabajo Autorizados: Bethesda Worship Studio`)  
> **Date of Preflight Inspection:** 2026-10-18  
> **Author:** Antigravity AI Implementation Agent  
> **Status:** APPROVED FOR SPRINT EXECUTION — NO PHYSICAL PEDAL CODE PERMITTED  

---

## 1. Baseline Environment & Working-Tree Status

Prior to any modifications, an exhaustive inspection of the Git working-tree and the environment was conducted:

| Parameter | Inspected Value | Status |
| :--- | :--- | :--- |
| **Current Branch** | `main` | Verified |
| **Current HEAD SHA** | `4e1527cad29b976b8f5493a37ba334921a485dd6` | Exact match with prompt target |
| **Working Tree** | Clean (`git status --short` returned 0 modified, 0 untracked) | Verified Clean |
| **Database Status** | PostgreSQL 16 on `localhost:5432`, database `bethesda_worship_dev` | Online & Healthy |
| **Backend Test Baseline** | `253 / 253` passing tests across 56 test suites (`tsx --test`) | Verified Baseline |
| **Frontend Test Baseline** | `341 / 341` passing tests across 53 test suites (`vitest run`) | Verified Baseline |
| **TypeScript Typecheck** | Backend: 0 errors (`tsc --noEmit`); Frontend: 0 errors (`tsc --noEmit`) | Verified Clean |
| **Physical Pedal Integration** | STRICT EXCLUSION: 0 Bluetooth/WebHID/USB pedal code | Enforced & Confirmed |

---

## 2. Findings Classification & Audit Matrix

Each finding identified in the sprint specification was inspected directly in the current source tree and classified according to the required taxonomy: `CONFIRMED`, `ALREADY_FIXED`, `NOT_REPRODUCED`, or `NEEDS_DECISION`.

| Finding ID | Severity | Area | Status | Primary Code Reference |
| :--- | :--- | :--- | :--- | :--- |
| **R1-P0-A** | Critical | Realtime Session Authorization & Host Privilege Escalation | **CONFIRMED** | `backend/src/interfaces/http/routes/realtime.routes.ts:36-66` |
| **R1-P0-B** | High | SSE Authentication & Query Token Exposure | **CONFIRMED** | `backend/src/interfaces/http/middlewares/auth-middleware.ts:39-41`, `frontend/src/core/realtime/realtime-client.ts:68` |
| **R1-P0-C** | High | Audio Playback & Offline-Download Authentication Seam | **CONFIRMED** | `frontend/src/components/workspace/AudioPlayerBar.tsx:131,226`, `frontend/src/core/offline/offline-manager.ts:411-414` |
| **R1-P1-A** | High | Offline Audio Checksum Computes String Hash Instead of Binary Bytes | **CONFIRMED** | `frontend/src/core/offline/offline-manager.ts:447` |
| **R1-P1-B** | Critical | OMR Fabricates Musical Notes & Commits Fixture to Canonical Truth | **CONFIRMED** | `backend/src/domain/omr/omr-provider.ts:62-132`, `backend/src/application/omr-service.ts:16,91` |
| **R1-P1-C** | High | Multitrack Session Persistence Missing (In-Memory Map) & Missing Song-Asset Ownership | **CONFIRMED** | `backend/src/application/multitrack-service.ts:24,77-81` |
| **R1-P1-D** | High | Audio Upload Magic Bytes Missing & Suffix Range RFC 7233 Defect | **CONFIRMED** | `backend/src/application/audio-service.ts:71-76,140-155` |
| **R1-P2** | Medium | Governance & README Inconsistency | **CONFIRMED** | `README.md:6-8` |

---

## 3. Detailed Finding Analysis & Code Evidences

### 3.1. Finding R1-P0-A: Realtime Session Authorization & Host Privileges
- **Classification:** `CONFIRMED`
- **Location:** `backend/src/interfaces/http/routes/realtime.routes.ts` lines 36–66 and 163–181.
- **Evidence:**
  ```typescript
  // Line 36-39:
  fastify.post(
    '/sessions',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      // Line 49-60:
      const hostUser = { id: user.sub, name: user.email.split('@')[0], role: user.role };
      const session = globalRealtimeSessionManager.createOrGetSession(
        setlist.id, setlist.title, hostUser, body.initialItemIndex
      );
  ```
  In `backend/src/domain/auth-types.ts`, `MUSICIAN` and `VIEWER` roles are granted `setlists:read`. Because `POST /sessions` requires only `setlists:read`, any musician or viewer can initiate a session, become its registered `hostUserId`, and subsequently dispatch liturgical state commands (`/actions`), bypassing the liturgical director authority.
- **Corrective Action:**
  1. Enforce that creating a live session or assuming host requires `setlists:activate` or `setlists:update` (leaders/admins), OR the user must be the designated `directorUserId` of the setlist in PostgreSQL.
  2. Participants with `setlists:read` can join, read state, heartbeat, and leave, but cannot create sessions or dispatch liturgical actions.
  3. Validate tenant and setlist existence and director authorization server-side on every sensitive route.

---

### 3.2. Finding R1-P0-B: SSE Authentication & Query Token Exposure
- **Classification:** `CONFIRMED`
- **Location:** 
  - `backend/src/interfaces/http/middlewares/auth-middleware.ts` lines 39–41:
    ```typescript
    } else if (typeof (request.query as any)?.token === 'string') {
      token = (request.query as any).token;
    }
    ```
  - `frontend/src/core/realtime/realtime-client.ts` line 68:
    ```typescript
    const streamUrl = `${this.baseUrl}/api/v1/realtime/sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`;
    this.eventSource = new EventSource(streamUrl);
    ```
- **Evidence:** The global `AuthGuard.authenticate` accepts a raw JWT access token via query string `?token=...`. Native browser `EventSource` exposes this long-lived bearer credential in server logs, proxy logs, browser histories, and referrer headers.
- **Corrective Action:**
  1. Remove global query parameter `?token=` token extraction from `auth-middleware.ts`.
  2. Implement a secure, short-lived, single-use ticket mechanism (`StreamTicketService` / ticket store):
     - Authenticated REST endpoint: `POST /api/v1/realtime/sessions/:sessionId/ticket` (authenticated via standard `Authorization: Bearer <token>`).
     - Returns a cryptographically random, single-use ticket (TTL: 60s) strictly bound to `{ userId, sessionId, role }`.
     - SSE connection uses `GET /api/v1/realtime/sessions/:sessionId/stream?ticket=<ticketId>`.
     - The ticket is immediately burned upon single connection establishment, preventing replay and logging exposure of long-lived access tokens.

---

### 3.3. Finding R1-P0-C: Audio Playback & Offline-Download Authentication
- **Classification:** `CONFIRMED`
- **Location:**
  - `frontend/src/components/workspace/AudioPlayerBar.tsx` line 131:
    ```typescript
    const streamUrl = client.getAudioStreamUrl(selectedAssetId);
    setAudioSrc(streamUrl);
    // <audio src={audioSrc} ... />
    ```
  - `frontend/src/core/offline/offline-manager.ts` lines 411–414:
    ```typescript
    const res = await fetch(targetUrl, {
      signal: abortController.signal,
      credentials: 'include',
    });
    ```
- **Evidence:** 
  1. Browser `<audio src="...">` element does not transmit custom HTTP `Authorization: Bearer <token>` headers. The backend route `/api/v1/audio/:id/stream` strictly requires `authGuard.requirePermission('songs:read')`. Without a token in header, native `<audio>` streaming fails with 401 Unauthorized.
  2. `offlineManager.downloadAudio()` uses `fetch` with `credentials: 'include'`, but the backend Fastify API authenticates through `Authorization: Bearer <token>`, not session cookies for API routes. Thus, offline audio downloads fail with 401 Unauthorized.
- **Corrective Action:**
  1. In `offline-manager.ts`: Pass `Authorization: Bearer <token>` using `this.apiClient.getAuthHeaders()` or use `this.apiClient.downloadAudioBlob()`.
  2. In `AudioPlayerBar.tsx`: Use a short-lived playback ticket (`POST /api/v1/audio/:id/ticket` -> `/api/v1/audio/:id/stream?ticket=...`) or load through authenticated blob URL for secure playback without credential exposure.

---

### 3.4. Finding R1-P1-A: Offline Audio Checksum Must Verify Real Bytes
- **Classification:** `CONFIRMED`
- **Location:** `frontend/src/core/offline/offline-manager.ts` line 447:
  ```typescript
  const checksumSha256 = await computeSha256(`AUDIO_${audioId}_${blob.size}`);
  ```
- **Evidence:** The offline manager computes SHA-256 over a mock metadata string (`"AUDIO_" + audioId + "_" + blob.size`) rather than calculating the cryptographic hash over the binary bytes of `blob`. This provides zero byte-level integrity verification.
- **Corrective Action:**
  1. Implement binary SHA-256 computation over `blob.arrayBuffer()` using Web Crypto API (`crypto.subtle.digest('SHA-256', buffer)`).
  2. When downloading audio, compare the computed SHA-256 against the server's authoritative `checksumSha256` recorded in `audio_assets`.
  3. If there is a mismatch or corruption, reject the download, mark as `FAILED`, and prevent saving corrupted data into IndexedDB.

---

### 3.5. Finding R1-P1-B: OMR Must Not Fabricate Musical Content
- **Classification:** `CONFIRMED`
- **Location:**
  - `backend/src/domain/omr/omr-provider.ts` lines 62–104:
    Hardcoded measures for "Gracia Sublime Es" in key G, 4 measures, regardless of what image/PDF was uploaded.
  - `backend/src/application/omr-service.ts` lines 16, 91–92:
    ```typescript
    import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
    // ...
    const fixtureSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(fixtureSong);
    ```
- **Evidence:** The OMR provider returns a fabricated fixture of measures instead of analyzing the score. Worse, during canonical commit (`commitToCanonicalSong`), `createReferenceSongFixture()` is used as the canonical payload, discarding even the proposal's measures and committing an unrelated reference song fixture into PostgreSQL.
- **Corrective Action:**
  1. Completely remove `createReferenceSongFixture()` from `omr-service.ts`.
  2. The canonical commit must convert the approved proposal's validated measures and data into a `CanonicalMusicPayload`, or fail if no genuine proposal measures exist.
  3. In `StandardOmrProvider`: If an external/real OMR recognition engine (e.g., Audiveris / Cloud OMR CLI) is not configured, the provider must return a truthful `PROVIDER_UNAVAILABLE` or empty unrecognized state with `reviewStatus: 'REJECTED'` and informative message, NEVER fabricating notes, lyrics, or confidence values.
  4. Validate real file signatures (PDF `%PDF-`, PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`, TIFF `II*\x00` / `MM\x00*`) rather than trusting user-declared MIME strings.

---

### 3.6. Finding R1-P1-C: Multitrack Session Persistence & Asset Ownership
- **Classification:** `CONFIRMED`
- **Location:** `backend/src/application/multitrack-service.ts` lines 24 and 77–81:
  ```typescript
  private sessions: Map<string, MultitrackSession>; // In-memory Map, lost on restart
  // ...
  const asset = await this.audioRepo.findById(t.audioAssetId);
  if (!asset) {
    throw new NotFoundError('Recurso de audio (stem)', t.audioAssetId);
  }
  ```
- **Evidence:**
  1. Multitrack sessions are stored exclusively in an in-memory `Map`. They are lost upon backend restart and not shared across server instances.
  2. The service checks if the audio asset exists, but DOES NOT verify that `asset.songId === dto.songId`. This allows cross-song stem linkage and cross-tenant audio leakage.
- **Corrective Action:**
  1. Create database migration `0006_multitrack_sessions.sql` and update `backend/src/db/schema.ts` with `multitrack_sessions` and `multitrack_tracks` tables.
  2. Implement `DrizzleMultitrackRepository` backed by PostgreSQL.
  3. In `multitrack-service.ts`: Verify that every track stem belongs strictly to the requested song (`if (asset.songId !== dto.songId) throw new ValidationError(...)`).
  4. Ensure transactional persistence and preserve mix state across backend restarts.

---

### 3.7. Finding R1-P1-D: Audio Upload Validation & HTTP Range Correctness
- **Classification:** `CONFIRMED`
- **Location:** `backend/src/application/audio-service.ts` lines 71–76 and 140–155:
  ```typescript
  // 1. Only checks user-provided MIME string
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) { ... }
  // 2. Suffix range handling
  const parts = rangeHeader.replace(/bytes=/, '').split('-');
  const rawStart = parts[0]?.trim(); // Empty string on "bytes=-500"
  const rawEnd = parts[1]?.trim();   // "500"
  if (rawStart) start = parseInt(rawStart, 10); // Not called, start stays 0!
  if (rawEnd) end = parseInt(rawEnd, 10);       // end = 500! -> Returns bytes 0-500 instead of last 500 bytes!
  // 3. Error throwing
  if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
    throw new Error(`Rango insatisfactorio...`); // Throws 500 instead of 416
  }
  ```
- **Evidence:**
  1. Upload validation relies exclusively on user-declared MIME string, allowing file spoofing.
  2. Suffix ranges (`bytes=-N`) are parsed incorrectly as prefix ranges (`bytes=0-N`).
  3. Unsatisfiable ranges throw an unhandled generic `Error`, triggering HTTP 500 instead of standard HTTP 416 Range Not Satisfiable with `Content-Range: bytes */totalSize`.
- **Corrective Action:**
  1. Implement file signature (magic bytes) verification for audio formats (ID3 / sync bits for MP3, RIFF/WAVE for WAV, OggS for OGG, ftyp for M4A/AAC, fLaC for FLAC).
  2. Correct suffix range parsing according to RFC 7233: if `rawStart` is empty and `rawEnd` is given, `start = Math.max(0, totalSize - endVal)` and `end = totalSize - 1`.
  3. Return HTTP `416 Range Not Satisfiable` with `Content-Range: bytes */${totalSize}` header when range is out of bounds.

---

### 3.8. Finding R1-P2: Governance & Documentation Reconciliation
- **Classification:** `CONFIRMED`
- **Location:** `README.md` lines 6–8:
  ```markdown
  > **Compuerta de Gobernanza Actual:** **WP-01 y WP-02 APROBADOS; WP-03 NO INICIADO / NO AUTORIZADO (HOLD DE GOBERNANZA). WP-04, WP-05, Fase 3B, Fase 3C y fases posteriores NO AUTORIZADAS.**
  ```
- **Evidence:** The README retains an outdated restriction statement that contradicts subsequent owner authorizations:
  - WP-03 Priority 1 was authorized and verified.
  - WP-04 PWA Offline was formally accepted by the project owner.
  - Audio Offline, WP-05 Autoscroll, Phase 3B Realtime, and Phase 3C Multitracks & OMR were authorized for implementation.
  - Physical pedal synchronization remains strictly prohibited.
- **Corrective Action:**
  Update `README.md` and documentation indexes to accurately reflect the current authorization status, audit history, and the explicit exclusion of physical pedals, without erasing historical records.

---

## 4. Architectural Decisions & Execution Plan

| Decision Item | Proposed Architectural Resolution | Justification |
| :--- | :--- | :--- |
| **SSE & Stream Media Authentication** | Short-lived single-use ticket mechanism (`StreamTicketService`). Endpoint `POST /ticket` returns 60s ticket used in `GET /stream?ticket=...`. Ticket is burned immediately. | Solves browser `EventSource` and `<audio>` header limitations without exposing long-lived JWTs in URLs or query strings. |
| **Audio Download Authentication** | Use `Authorization: Bearer <token>` in `offline-manager.ts` via `apiClient.downloadAudioBlob()`. | Consistent with the existing REST Bearer token architecture. |
| **Offline Audio Checksum** | Real binary SHA-256 via Web Crypto API compared against server's `checksumSha256`. | True data integrity verification; detects truncation, corruption, and transmission faults. |
| **OMR Engine Truthfulness** | Truthful provider: returns `PROVIDER_UNAVAILABLE` or parses valid score without hardcoded notes. In canonical commit: convert real proposal measures into `CanonicalMusicPayload`; zero fixture generation. | Eliminates fabricated notes and ensures canonical data integrity. |
| **Multitrack Persistence** | Migration `0006_multitrack_sessions.sql` + PostgreSQL Drizzle repository. Enforce `asset.songId === dto.songId`. | Preserves mix configurations across server restarts; prevents stem IDOR and cross-song leakage. |
| **Audio Streaming & Upload** | Magic byte validation on upload; RFC 7233 compliant suffix ranges (`bytes=-N`); HTTP 416 with `Content-Range: bytes */total`. | Standard HTTP streaming compatibility with native media players. |

---

## 5. Preflight Conclusion & Authorization Sign-off

The preflight inspection is complete and all findings are **CONFIRMED** with exact code and test references. No architectural rewrites will be performed without adhering to established contracts.

Proceeding immediately to implementation of R1-P0, R1-P1, and R1-P2 remediation items.
