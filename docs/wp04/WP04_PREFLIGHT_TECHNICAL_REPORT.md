# WP-04 — PWA Offline Preflight Technical Report
**Project:** Bethesda Worship Studio  
**Work Package:** WP-04 — PWA Offline  
**Specification Baseline:** `BETHESDA_WORSHIP_STUDIO_WP04_PWA_OFFLINE_TECHNICAL_SPEC_REVIEW.md`, Version 0.1  
**Authorization Status:** IMPLEMENTATION AUTHORIZED by Project Owner for WP-04 only  
**Governance Hold:** WP-05 (Autoscroll & Pedal Sync), Phase 3B (Realtime Liturgical Flow), Phase 3C (Multitracks & OMR) remain STRICTLY NOT AUTHORIZED  
**Evaluation Date:** October 16, 2026  
**Repository Branch:** `main`  
**Base Commit:** `47a764b2142ed0f75bd3d1a1bf36d15c6cc82cb5`  
**Working Tree Status:** Clean  

---

## 1. Executive Summary & Authorization Scope

This preflight technical report documents the architecture discovery, codebase audit, technology baseline, and execution plan for implementing **WP-04 — PWA Offline** within Bethesda Worship Studio.

The Project Owner has explicitly authorized the implementation of WP-04 under strict product and governance boundaries:
1. **WP-04 Exclusivity:** No work is authorized for WP-05 (Autoscroll & Pedal Sync), Phase 3B (Realtime Liturgical Flow), or Phase 3C (Multitracks & OMR).
2. **Read-Only Offline Operation:** Offline mode is strictly read-only. Users may consult downloaded materials (songs, chord sheets, notation/sheet music, setlists, and audio tracks) but may not create or mutate canonical server data. No deferred mutation queue is created.
3. **Server is Source of Truth:** Local deletion deletes only local offline copies; canonical server data remains untouched.
4. **Logout & Session Isolation:** Logout must purge or permanently invalidate the previous session's private offline data so that subsequent users on a shared device cannot access private content.
5. **Accurate Download States:** Status must reflect verified storage (`NOT_DOWNLOADED`, `DOWNLOADING`, `AVAILABLE_OFFLINE`, `UPDATE_AVAILABLE`, `FAILED`, `REMOVED`), never merely a started request.
6. **No Commit / Push / Deployment:** This task produces verified repository code and documentation deliverables in working-tree state without executing git commits, pushes, or live deployments.

---

## 2. Technology Stack & Current Repository Inventory

### 2.1 Frontend Stack (`@bethesda/frontend`)
- **Framework & Runtime:** React 19.3.0, React DOM 19.3.0, TypeScript 7.0.2, Node.js 26.6.2.
- **Build Tool:** Vite 8.3.0 with `@vitejs/plugin-react` 6.1.1.
- **Rendering Engines:**
  - `@coderline/alphatab` 1.8.4 (Full score and guitar/bass tablature).
  - `opensheetmusicdisplay` (OSMD) 2.1.2 (Standard MusicXML score).
  - Custom `LeadSheetDOMAdapter` (DOM/HTML-based lead sheets and chord charts).
- **Styling:** Vanilla CSS (`src/index.css`) with CSS custom properties design tokens.
- **Testing Runner:** Node.js native test runner (`node --test --experimental-strip-types "src/core/**/__tests__/**/*.test.ts"`).
  - Current baseline: **281 passing tests** across 45 test suites, 0 failures.
  - Typecheck: `tsc --noEmit` passing with 0 errors.

### 2.2 Backend Stack (`@bethesda/backend`)
- **Framework:** Fastify 5.2.1 on Node.js (`tsx` 4.19.3, TypeScript 5.7.3).
- **Database & ORM:** PostgreSQL (`pg` 8.13.3) with Drizzle ORM 0.39.3 and Drizzle Kit 0.30.4.
- **Security & Utilities:** `@fastify/jwt` 10.2.2, `@fastify/cookie` 11.1.2, `@node-rs/argon2` 2.2.1, `@fastify/rate-limit` 11.2.0, `@fastify/sensible` 6.0.3, `@fastify/helmet` 13.1.1, `@fastify/cors` 10.0.2, `zod` 3.24.2.
- **Testing Runner:** Node.js native test runner via tsx (`tsx --test --test-concurrency=1 "src/**/__tests__/**/*.test.ts"`).
  - Current baseline: **221 passing tests** across 53 test suites, 0 failures.
  - Typecheck: `tsc --noEmit` passing with 0 errors.

---

## 3. PWA Manifest, Service Worker & Storage Audit

| Component | Current Codebase State | WP-04 Required Implementation |
| :--- | :--- | :--- |
| **Web App Manifest** | **Absent.** Neither `manifest.json` nor `manifest.webmanifest` exists in `frontend/public/` or `frontend/index.html`. | Create `manifest.webmanifest` in `frontend/public/` with app name, icons (`worship_studio_saxophone_emblem.png`), standalone display mode, theme colors (`#0f172a`), and Spanish liturgical metadata. |
| **Service Worker** | **Absent.** No Service Worker is registered in `frontend/src/main.tsx` or present in `frontend/public/sw.js`. | Implement `sw.js` for App Shell precaching (HTML shell, JS/CSS bundles, fonts, static assets) using Cache API. Enforce strict isolation: **NEVER cache authenticated API requests (`/api/v1/*`) via generic SW caching**. |
| **Cache API Usage** | **None.** | Used exclusively by Service Worker for static application assets (app shell, fonts, icons). |
| **IndexedDB Storage** | **None.** No IndexedDB manager exists in `frontend/src/core/`. | Create typed IndexedDB storage manager (`BethesdaOfflineStorage`) with object stores: `offline_metadata`, `song_payloads`, `setlist_payloads`, `audio_blobs`. |
| **Web Storage (`localStorage`)** | Restricted to non-sensitive preferences. Architectural invariant forbids storing access tokens or private secrets in localStorage. | Maintain strict invariant: No auth tokens in local storage. Use localStorage only for a lightweight session tombstone flag to detect incomplete logout cleanup. |
| **Volatile Memory Caches** | `songCacheRef` in `MusicalWorkspace.tsx` (`Map<string, CanonicalMusicPayload>`). `MemoryTokenManager` in `token-manager.ts`. | Offline manager will coordinate with volatile memory to serve downloaded assets when network is offline. |

---

## 4. Authentication Lifecycle, Authorization & Tenant Isolation

### 4.1 Session & Token Lifecycle
1. **Access Token (Volatile Memory):** HS256 JWT stored strictly in memory via `MemoryTokenManager` (closure). Cleared on page refresh or logout.
2. **Refresh Token (HttpOnly Cookie):** Long-lived `bethesda_refresh_token` stored in HttpOnly, SameSite=Strict cookie. Rotated on each `/api/v1/auth/refresh` call with replay-detection family IDs.
3. **Logout Flow:**
   - Client sends `POST /api/v1/auth/logout`.
   - Server revokes refresh token family and clears the HttpOnly cookie.
   - Frontend `tokenManager.clearToken()` and `setUser(null)` execute in `AuthContext.logout()`.
4. **WP-04 Integration Point:**
   - In `AuthContext.logout()`, invoke `offlineManager.purgeUserPrivateData(currentUser.id)` before completing logout.
   - If physical browser storage fails to delete immediately, set an unverified cleanup tombstone so subsequent logins by different users reject access to prior cached data.

### 4.2 Authorization & Boundaries
- **Congregation Scope:** Current deployment is scoped to "Iglesia Cristiana Bethesda — Madrid, Cundinamarca".
- **Roles:** `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`.
- **Multi-user Device Sharing:** In church environments, shared tablets (atriles) or laptops are common. User A (Worship Leader) might log out and User B (Musician or Viewer) might log in.
- **WP-04 Invariant:** User B must never see or access downloaded private content belonging to User A. Offline records store `ownerUserId` and enforce strict access gating.

---

## 5. Song, Notation, Setlist & Audio Data Delivery Paths

### 5.1 Canonical Songs & Notation
- **Data Model:** PostgreSQL `songs` (master identity) and `song_versions` (`canonicalPayload` in JSONB).
- **Payload Schema:** `CanonicalMusicPayloadJSON` containing measures, timeline, tempo map, instrument tracks, chord events, and lyric syllables.
- **Delivery Path:** `GET /api/v1/songs/:id` returns JSON with canonical payload.
- **Supported Formats:** MusicXML (full score), ChordPro (lead sheet / lyrics with chords), AlphaTex (tablature / score).
- **Offline Delivery:** The serialized `CanonicalMusicPayloadJSON` is stored directly in IndexedDB `song_payloads`. On offline load, `CanonicalMusicPayload.fromJSON()` deserializes it into active memory with zero fidelity loss.

### 5.2 Setlists & Liturgical Moments
- **Data Model:** PostgreSQL `setlists` (`title`, `scheduledDateTime`, `status`, `directorUserId`) and `setlist_items` (`itemType: SONG | SERVICE_MOMENT`, `sequenceOrder`, `songId`, `targetKey`, `targetBpm`, `transitionType`, `momentTitle`, `durationMinutes`, `musicalKey`, `notesForTeam`).
- **Delivery Path:** `GET /api/v1/setlists/:id` returns full setlist structure with ordered items.
- **Offline Packaging:** Setlist offline package contains the setlist entity, item list, and references to all required song IDs.
- **Completeness Contract:** If any referenced song in the setlist is not downloaded, the setlist is marked `INCOMPLETE_OFFLINE` with a visual missing dependency badge. It cannot be reported as fully available offline.

### 5.3 Audio Tracks & Delivery Capabilities
- **Backend Current State:** The current backend has **NO audio models, NO database tables, and NO audio delivery/streaming endpoints**.
- **HTTP Range / Resumable Downloads:** Neither HTTP Range requests (`bytes=...`) nor resumable chunked downloads are supported by the backend.
- **Frontend Audio Offline Capability:**
  - Modern browsers support storing binary audio `Blob` / `ArrayBuffer` in IndexedDB.
  - Supported audio MIME types: `audio/mpeg` (MP3), `audio/wav`, `audio/ogg`, `audio/webm`, `audio/aac`.
  - Playback: Offline audio is played via standard HTML5 `<audio>` element using `URL.createObjectURL(blob)`.
  - Interruption & Quota Handling: If audio download is aborted or fails before completion, incomplete blobs are immediately discarded and marked `FAILED` or `NOT_DOWNLOADED`.
  - Multitracks / Stems / OMR: Phase 3C remains **STRICTLY NOT AUTHORIZED**. Audio in WP-04 is limited to single reference audio / backing track playback where available.

---

## 6. Analysis of Unresolved Design Decisions

| ID | Unresolved Decision | Categorization | Evaluation, Recommended Option & Impact | Governance / Blocker Status |
| :--- | :--- | :--- | :--- | :--- |
| **U-01** | **Offline Authorization Expiry** | Security / Data Retention Policy | **Option A (Recommended): 7-Day Validity Grace Period.** Downloaded items store `downloadedAt` and `maxOfflineDays: 7`. If 7 consecutive days elapse without online server revalidation, the app indicates "Offline authorization expired - please connect to verify ministry credentials" and restricts view access. This prevents indefinite offline retention of private church music while fully supporting weekend ministry cycles (practice Wednesday -> service Sunday).<br>*Alternative B:* 30 days. *Alternative C:* No expiry.<br>**Impact:** High security protection against revoked credentials. | **Conservative Implementation:** Implement default 7-day policy with configurable constant. Document in report for formal owner ratification. |
| **U-02** | **Audio Download Grouping** | Scope / Bandwidth & Storage | **Option A (Recommended): Explicit Opt-In for Audio.** When downloading a Setlist, canonical score and chord sheets are packaged by default (~50KB per song); audio tracks (~5-10MB each) require explicit opt-in checkbox ("Descargar audios de referencia: Sí/No") to prevent mobile data exhaustion and storage overflow.<br>*Alternative B:* Force audio download bundled. | **Reversible Choice:** Implement explicit opt-in. Low risk, prevents user surprise charges on cellular connections. |
| **U-03** | **Per-File & Total Storage Limits** | Device Stability / Safety | **Option A (Recommended): 50MB single-file cap and 80% device quota guard.** Single audio files above 50MB are rejected. Before storing, query `navigator.storage.estimate()`; if remaining space < 20MB or usage > 80%, reject with user-facing `STORAGE_QUOTA_EXCEEDED`. | **Safe Engineering Choice:** Reversible, protects browser stability. |
| **U-04** | **Target Browser Support Baseline** | Device Compatibility | **Modern Standards Baseline:** Chromium (Chrome/Edge desktop & mobile >= 100), Safari (iOS/iPadOS >= 15.4), Firefox >= 100. Document Safari 7-day inactive eviction rule on non-installed web apps. | **Documentation Deliverable:** Documented in test and implementation reports. |
| **U-05** | **Unverified Logout Cleanup Behavior** | Security / Privacy Isolation | **Option A (Recommended): Double-layer Tombstone & Overwrite.** In addition to calling `indexedDB.deleteDatabase()` / clearing user stores, immediately clear volatile memory, overwrite the active user ID, and write a localStorage flag `bethesda_offline_purge_pending: <userId>`. On subsequent app start/login by another user, if the tombstone exists, refuse access to existing stores and force wipe before proceeding. | **Material Security Decision:** Conservative, zero-leakage guarantee. Blocks unauthorized cross-user access even on browser IndexedDB lock failure. |

---

## 7. Proposed Changes, Touch Points & Rollback Strategy

### 7.1 Files to Create
1. `frontend/public/manifest.webmanifest`: Web App Manifest for PWA installation.
2. `frontend/public/sw.js`: Service Worker for App Shell precaching and runtime routing.
3. `frontend/src/core/offline/types.ts`: TypeScript contracts for offline resources, states, progress, inventory.
4. `frontend/src/core/offline/storage/indexeddb-storage.ts`: Strongly typed IndexedDB storage manager.
5. `frontend/src/core/offline/offline-manager.ts`: Core orchestrator for download, validation, status, inventory, updates, audio, and session purge.
6. `frontend/src/core/offline/offline-context.tsx`: React Context and Provider for offline subsystem.
7. `frontend/src/core/offline/use-offline.ts`: Custom hook for components.
8. `frontend/src/components/offline/OfflineStatusBar.tsx`: Visual banner indicating online/offline state and sync readiness.
9. `frontend/src/components/offline/OfflineInventoryModal.tsx`: Local inventory explorer, selective deletion, update checker, and audio player.
10. `frontend/src/components/offline/DownloadActionButton.tsx`: Reusable download action button with real-time status reflection.
11. Unit & Integration Tests:
    - `frontend/src/core/offline/__tests__/indexeddb-storage.test.ts`
    - `frontend/src/core/offline/__tests__/offline-manager.test.ts`
    - `frontend/src/core/offline/__tests__/setlist-offline-packager.test.ts`
    - `frontend/src/core/offline/__tests__/session-isolation.test.ts`

### 7.2 Files to Touch
1. `frontend/index.html`: Add manifest link and theme color meta tags.
2. `frontend/src/main.tsx`: Register service worker.
3. `frontend/src/App.tsx`: Add `OfflineProvider` and `OfflineStatusBar`.
4. `frontend/src/core/auth/auth-context.tsx`: Integrate offline manager cleanup in `logout()`.
5. `frontend/src/components/workspace/MusicalWorkspace.tsx`: Wire offline status, inventory modal button, and download buttons.
6. `frontend/src/components/workspace/DatabaseSongsModal.tsx`: Enable offline song consulting from local IndexedDB when offline.
7. `frontend/src/components/workspace/SetlistsModal.tsx`: Enable offline setlist consulting and show missing dependency indicators.

### 7.3 Backend Impact
- **ZERO backend changes required.** Backend schema, migrations, routes, and services remain completely untouched.

### 7.4 Rollback Strategy
- All offline logic is cleanly modularized under `frontend/src/core/offline/` and `frontend/src/components/offline/`.
- If rollback is needed, removing the `OfflineProvider` wrapper and reverting the touched files returns the application to its exact pre-WP-04 state without data loss or schema incompatibilities.

---

## 8. Verification and Acceptance Matrix Mapping

The implementation will be validated against all 18 scenarios (T-01 through T-18) specified in the prompt:
- **T-01:** Open after initial load with network unavailable (PASS / Automated & Manual).
- **T-02:** Open a downloaded supported resource offline (PASS / Automated unit tests for payload hydration & rendering).
- **T-03:** Open a non-downloaded resource offline (PASS / Clear unavailable-offline state).
- **T-04:** Open setlist with missing dependency (PASS / Missing resource identified).
- **T-05:** Play a fully downloaded audio track offline (PASS / Local audio plays without network).
- **T-06:** Interrupt audio download (PASS / Incomplete track marked unavailable/failed).
- **T-07:** Storage quota/error (PASS / Error is visible, inventory remains consistent).
- **T-08:** Delete local copy (PASS / Local copy removed, server untouched).
- **T-09:** Reconnect with newer content version (PASS / Update detected and handled safely).
- **T-10:** Logout with private content (PASS / Previous session's private data invalidated and purged).
- **T-11:** Sign in with another account on same device (PASS / Previous user's private data inaccessible).
- **T-12:** Logout during download (PASS / In-progress download cancelled and invalidated).
- **T-13:** Session expires while offline (PASS / Evaluated against 7-day grace policy).
- **T-14:** Permission revoked while user was offline (PASS / Access reconciled when connectivity returns).
- **T-15:** Corrupt/invalid resource (PASS / Rejected as valid; recoverable error displayed).
- **T-16:** Cross-user/tenant cache isolation (PASS / Service worker and IndexedDB isolate private content).
- **T-17:** Interrupted update (PASS / Previous valid copy preserved).
- **T-18:** Target browser/device behavior (PASS / Documented capabilities and limitations).

---

## 9. Conclusion & Go-Ahead Confirmation

Preflight inspection confirms the repository is clean, tests are passing, and the implementation plan strictly adheres to WP-04 boundaries without scope creep. Implementation of the PWA Shell, Service Worker, IndexedDB Storage, Offline Manager, and UI integration may now proceed safely.
