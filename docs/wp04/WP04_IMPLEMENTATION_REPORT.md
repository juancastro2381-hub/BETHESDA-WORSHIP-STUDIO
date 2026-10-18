# Bethesda Worship Studio — WP-04 Implementation Report: PWA Offline

**Document Identifier:** `WP04_IMPLEMENTATION_REPORT.md`  
**Version:** 1.1.0 (Audited & Reconciled)  
**Date:** 2026-10-18  
**Status:** WP-04 CORE COMPLETE — AUDIO BLOCKED  
**Governance Scope:** WP-04 (PWA Offline) Authorized Only. WP-05, Phase 3B, and Phase 3C remain Strictly Unauthorized.  
**Target Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`  
**Base Implementation Commit:** `47a764b2142ed0f75bd3d1a1bf36d15c6cc82cb5`  

---

## 1. Executive Summary
This report documents the verified implementation and closure audit of **Work Package 04 (WP-04) — PWA Offline** for Bethesda Worship Studio, strictly complying with the approved technical baseline (`BETHESDA_WORSHIP_STUDIO_WP04_PWA_OFFLINE_TECHNICAL_SPEC_REVIEW.md`, v0.1) and all governance constraints established by the Project Owner.

WP-04 delivers an installable, resilient Progressive Web Application (PWA) capable of loading its minimal application shell, inspecting downloaded songs, chord sheets, interactive notation/scores, and setlists completely offline without an active internet connection. Offline operation is strictly **read-only**, enforcing total canonical immutability without mutation replay queues. Session isolation and device-sharing protection ensure that previous sessions' private liturgical data is purged and invalidated upon logout.

**Audio Delivery Finding (Outcome C — No Real Source Exists):**  
A comprehensive repository audit confirmed that the current Fastify backend contains **0 audio models, 0 database tables, 0 audio delivery/streaming routes, and no audio storage provider**. In the frontend UI, audio downloads have been explicitly disabled and marked as blocked (`Audio Bloqueado`). The core offline subsystem for songs and setlists is complete and fully verified, while audio delivery is honestly reported as **BLOCKED** pending future backend audio infrastructure.

---

## 2. Implemented Architecture & System Behavior

### 2.1 Minimal Application Shell & Service Worker (`sw.js`)
- **PWA Manifest (`frontend/public/manifest.webmanifest`):**
  - Configures app identity, icons (`192x192`, `512x512`), `standalone` display mode, `#0f172a` slate theme and background colors, and orientation constraints.
- **Service Worker (`frontend/public/sw.js`):**
  - **Precaching:** Automatically caches core application shell assets on install (`/`, `/index.html`, `/manifest.webmanifest`, styling tokens, and production bundles).
  - **Navigation Fallback:** Employs a network-first with Cache API fallback strategy for HTML document navigation, allowing the SPA shell to boot even when completely disconnected from the network.
  - **Strict Security Invariant:** The Service Worker **never caches authenticated `/api/v1/*` REST API responses**. Any intercepted offline API request returns a controlled JSON HTTP 503 response (`OFFLINE_UNAVAILABLE`), preventing any potential token leakage or cross-user session bleeding in browser worker caches.

### 2.2 Client-Side Persistence Engine: IndexedDB (`indexeddb-storage.ts`)
- Implemented as a strongly typed singleton storage abstraction (`BethesdaOfflineStorage`) managing the `bethesda_worship_studio_offline_db` IndexedDB database with version migration.
- **Four Dedicated Object Stores:**
  1. `offline_metadata`: Contains operational metadata, resource type (`SONG`, `SETLIST`, `AUDIO`), server version number, ISO timestamps (`downloadedAt`, `lastValidatedAt`), `byteSize`, `checksumSha256`, and dependency arrays (`associatedSongIds`, `missingSongIds`).
  2. `song_payloads`: Stores `OfflineSongPayload` containing the complete `CanonicalMusicPayloadJSON` graph, default key, default BPM, time signature, and artist.
  3. `setlist_payloads`: Stores `OfflineSetlistPayload` containing `FrontendSetlistDetail` with all ordered items (songs and liturgical service moments).
  4. `audio_blobs`: Stores `OfflineAudioRecord` containing binary audio `Blob` data and MIME types.
- **Node.js Memory Fallback:** Includes a transparent in-memory Map fallback used when running within Node.js native test environments where browser `window.indexedDB` is absent.
- **Tombstone Boot Recovery (`recoverPendingCleanupTombstone()`):**
  - Executed on every `storage.init()` call.
  - Inspects `localStorage.getItem('bethesda_offline_purge_pending')`. If a pending purge from an interrupted previous logout is detected, storage immediately executes a preventive wipe of that user's data before granting any access, resolving the key once verified clean.

### 2.3 Central Offline Orchestrator: `BethesdaOfflineManager` (`offline-manager.ts`)
- **Connectivity Detection (`isOnline()`):** Monitors `navigator.onLine` and emits events for transitions.
- **Read-Only Mutation Guard (`assertCanMutateServer()`):** Throws `OfflineStorageError('UNAUTHORIZED_SESSION')` if a user attempts a server mutation while offline, preventing accidental data loss or unauthorized mutation attempts.
- **Storage Quota Pre-Check (`assertStorageQuotaAvailable()`):**
  - Verifies available browser storage quota via `navigator.storage.estimate()` before authorizing downloads.
  - Safely falls back if `estimate()` is unavailable or rejects.
  - Rejects with `STORAGE_QUOTA_EXCEEDED` if projected utilization exceeds 85% (`MAX_STORAGE_QUOTA_USAGE_RATIO = 0.85`).
- **Song Download & Integrity Validation (`downloadSong()`):**
  - Fetches the song and its current version from the API.
  - Validates the payload structure against `CanonicalModelValidator.validate()`. Rejects corrupt or structurally malformed data immediately.
  - Computes SHA-256 cryptographic digest across the serialized canonical JSON.
  - Saves the payload and flags metadata as `AVAILABLE_OFFLINE`.
- **Setlist Packaging & Dependency Tracking (`downloadSetlist()`):**
  - Downloads setlist structure and inspects all `SONG` items.
  - Automatically verifies or downloads song dependencies.
  - If any song dependency cannot be resolved, marks `missingSongIds` in metadata. The setlist status remains `AVAILABLE_OFFLINE` with an explicit incomplete dependency flag (`isComplete = false`).
  - Handles `SERVICE_MOMENT` items (prayer, preaching, announcements) natively without requiring song dependencies.
- **Owner-Approved 7-Day Expiry Policy (`isAuthorizationExpired()` & `getAuthorizedSongPayload()`):**
  - Uses the timestamp of the last successful server authorization revalidation (`lastValidatedAt`), falling back to `downloadedAt` only if unvalidated.
  - Computes exact 7-day boundary: `7 * 24 * 60 * 60 * 1000` ms (604,800,000 ms).
  - Detects client clock skew or backward tampering (> 5 minutes into the past/future) and treats content as expired for safety.
  - **Active Content Blocking:** Stale content is strictly blocked from view in `getAuthorizedSongPayload()` and `getAudioObjectUrl()` when offline, throwing `OfflineStorageError('UNAUTHORIZED_SESSION')`. When online, automatically revalidates with server; if server returns HTTP 401/403, local cached copy is immediately purged.
- **Audio Download Hardening & Outcome C (`downloadAudio()`, `getAudioObjectUrl()`):**
  - Validates response `content-type` starts with `audio/` (rejecting HTML error pages and JSON responses).
  - Validates actual downloaded binary blob size (`blob.size > 0` and `blob.size <= 50MB`).
  - Blocks expired audio playback offline.
  - Since backend audio delivery does not exist, the feature is marked BLOCKED and disabled in UI.
- **Update Detection (`checkForUpdates()`):**
  - On network reconnection, queries server catalog versions and updates `lastValidatedAt` upon successful confirmation.
  - If a resource is missing from the server catalog, marks status as `FAILED` (revoked).
  - Invariant: Retains previous valid offline copy until the new update is fully downloaded and verified.

### 2.4 User Experience & UI Components
- **`OfflineStatusBar.tsx`:** Floating, accessible status bar indicating online or offline read-only mode, with direct link to the inventory modal.
- **`DownloadActionButton.tsx`:** State-aware button integrated into song headers, database song modal rows, and setlist rows. Accurately renders states: `Guardar Offline`, `Descargando...`, `Disponible Offline`, `Actualizar Copia`, `Reintentar`. When `resourceType === 'AUDIO'`, renders `🚫 Audio Bloqueado` with descriptive tooltip.
- **`OfflineInventoryModal.tsx`:** Comprehensive modal dialog allowing musicians and directors to browse downloaded songs, setlists, and audio recordings. Displays an explicit notice on the "Audios" tab informing users that audio is blocked pending backend infrastructure. Flags expired items with `Expirado (7 días)` and blocks opening/playing when offline.
- **Workspace Offline Fallback Integration (`MusicalWorkspace.tsx`, `DatabaseSongsModal.tsx`, `SetlistsModal.tsx`):**
  - Integrates `offlineManager.getAuthorizedSongPayload(songId)` ensuring stale songs cannot be loaded offline after 7 days without server revalidation.

---

## 3. Implementation of Product Decisions & Unresolved Decisions

| Decision ID | Topic | Resolution / Implemented Policy |
| :--- | :--- | :--- |
| **P-01** | Offline Mode Read-Only | **ENFORCED.** All mutation actions (saving arrangements, altering setlists, editing songs) are disabled when offline via `assertCanMutateServer()`. No deferred sync queue. |
| **P-02** | Downloadable Content Types | **PARTIALLY SUPPORTED.** Songs, chord sheets, interactive notation/scores, and setlists are fully supported. Audio tracks are BLOCKED pending backend audio infrastructure. |
| **P-03** | Device Sharing & Logout Cleanup | **ENFORCED.** Multi-tier session isolation purges user-owned offline content on logout, revokes Object URLs, and sets an emergency tombstone key recovered on boot. |
| **P-04** | Server Canonical Authority | **PRESERVED.** Local deletion affects only client storage; server data is untouched. Server remains the sole source of truth. |
| **U-01** | Offline Grace Period | **RESOLVED & VERIFIED (7 Days).** Set to 7 days (`MAX_OFFLINE_DAYS_GRACE_PERIOD = 7`). Evaluates `lastValidatedAt || downloadedAt`. Stale content is actively blocked from view/playback offline. |
| **U-02** | Audio Download Grouping | **BLOCKED (Outcome C).** Audio source does not exist in backend. Marked BLOCKED in acceptance matrix; disabled in UI. |
| **U-03** | Per-File & Quota Limits | **RESOLVED (50MB Cap & 85% Quota Guard).** Single file cap of 50MB (`MAX_SINGLE_RESOURCE_SIZE_BYTES`). Storage quota alert and rejection at 85% capacity via `assertStorageQuotaAvailable()`. |
| **U-04** | Target Browser Support | **RESOLVED.** Baseline: Chromium >= 100, Safari >= 15.4 (iOS / macOS), Firefox >= 100. |
| **U-05** | Logout Verification Failure | **RESOLVED (Double-Layer + Boot Tombstone Recovery).** Volatile purge + IndexedDB delete + `bethesda_offline_purge_pending` localStorage tombstone recovered automatically in `storage.init()`. |

---

## 4. File Inventory

### 4.1 Created Files (WP-04 Core & Documentation)
```
frontend/
├── public/
│   ├── manifest.webmanifest                               # PWA Web App Manifest
│   └── sw.js                                              # Service Worker with App Shell precaching & API isolation
├── src/
│   ├── components/
│   │   └── offline/
│   │       ├── DownloadActionButton.tsx                   # Multi-state download & delete button (with audio block)
│   │       ├── OfflineInventoryModal.tsx                  # Complete offline inventory & audio player modal
│   │       ├── OfflineStatusBar.tsx                       # Status bar with connectivity indicator
│   │       └── index.ts                                   # Barrel export
│   └── core/
│       └── offline/
│           ├── __tests__/
│           │   ├── indexeddb-storage.test.ts              # Unit tests for storage engine & CRUD
│           │   ├── offline-manager.test.ts                # Unit tests for orchestration, 7-day expiry & quota
│           │   ├── setlist-packager.test.ts               # Unit tests for setlist packaging & dependencies
│           │   └── session-isolation.test.ts              # Unit tests for logout purge, device sharing & tombstone
│           ├── storage/
│           │   └── indexeddb-storage.ts                   # Strongly-typed IndexedDB storage wrapper with boot tombstone
│           ├── index.ts                                   # Core offline module barrel
│           ├── offline-context.tsx                        # React Context & Provider for offline state
│           ├── offline-manager.ts                         # Central orchestrator & lifecycle coordinator
│           ├── types.ts                                   # Strict TypeScript interfaces, errors, and constants
│           └── use-offline.ts                             # React consumer hook
docs/
└── wp04/
    ├── ADR_004_OFFLINE_STORAGE_AND_SESSION_ISOLATION.md   # Architectural Decision Record
    ├── WP04_PREFLIGHT_TECHNICAL_REPORT.md                 # Preflight technical discovery report
    ├── WP04_IMPLEMENTATION_REPORT.md                      # This document
    ├── WP04_TEST_AND_ACCEPTANCE_REPORT.md                 # Test matrix & verification evidence
    ├── WP04_SECURITY_AND_SESSION_ISOLATION_REPORT.md      # Security & session isolation report
    └── WP04_CLOSURE_AUDIT_AND_REMEDIATION_REPORT.md       # Closure audit and remediation report
```

### 4.2 Modified Files (Integration Seams)
1. `frontend/index.html`: Added PWA Web App Manifest link, Apple touch icons, and mobile viewport meta tags.
2. `frontend/src/main.tsx`: Added secure browser hook to register `/sw.js` on window load.
3. `frontend/src/App.tsx`: Wrapped component tree in `<OfflineProvider>`, rendered `<OfflineStatusBar />`.
4. `frontend/src/core/auth/auth-context.tsx`: Injected `offlineManager.purgeSessionData(currentUserId)` call in `logout()` lifecycle before tokens and user state are cleared.
5. `frontend/src/components/workspace/MusicalWorkspace.tsx`: Added offline fallback to load canonical song payload directly from IndexedDB via `getAuthorizedSongPayload()`; wired `persistedSongId` to `SongHeader`.
6. `frontend/src/components/workspace/SongHeader.tsx`: Integrated `DownloadActionButton` for active song.
7. `frontend/src/components/workspace/DatabaseSongsModal.tsx`: Added offline fallback to query downloaded songs from IndexedDB; integrated `getAuthorizedSongPayload()` to enforce 7-day revalidation; added `DownloadActionButton` per song row.
8. `frontend/src/components/workspace/SetlistsModal.tsx`: Added offline fallback to query downloaded setlists from IndexedDB; added `⚠️ Incompleto` badge for missing dependencies; added `DownloadActionButton` per setlist row.
9. `frontend/src/index.css`: Added responsive styles for status bar, download buttons, modal inventory, and audio player controls.

---

## 5. Security & Isolation Considerations
1. **Zero Credential Storage:** IndexedDB stores only musical domain data (`CanonicalMusicPayloadJSON`, `FrontendSetlistDetail`) and audio Blobs. Under no circumstances are JWT access tokens, refresh tokens, passwords, or session secrets stored locally.
2. **Device Sharing Boundary:** `purgeSessionData()` deletes all records associated with `ownerUserId` and orphan unauthenticated records. A subsequent user logging in on the same browser cannot inspect or query the previous user's private songs or setlists.
3. **Cache API Isolation:** Authenticated API requests (`/api/v1/*`) are explicitly excluded from the Service Worker Cache API.
4. **Tombstone Resilience:** If browser storage encounters an unexpected I/O lock during logout, an emergency tombstone key (`bethesda_offline_purge_pending`) persists in `localStorage` and is proactively cleared/wiped on subsequent `storage.init()`.

---

## 6. Known Limitations & Target Browser Realities
1. **Backend Audio Infrastructure Missing (Outcome C):** The existing backend has no audio tables, delivery routes, or storage bucket integrations. Full audio download and streaming remain blocked until backend audio infrastructure is scheduled and implemented.
2. **iOS Safari Background Audio:** WebKit on iOS suspends audio playback when a PWA is backgrounded or the screen is locked, unless native media session attributes are continually refreshed.
3. **Multitracks & OMR:** Multitrack stem mixing and Optical Music Recognition (OMR) are strictly Phase 3C features and were not implemented.
