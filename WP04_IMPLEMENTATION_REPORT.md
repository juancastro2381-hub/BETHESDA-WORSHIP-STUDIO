# Bethesda Worship Studio — WP-04 Implementation Report: PWA Offline

**Document Identifier:** `WP04_IMPLEMENTATION_REPORT.md`  
**Version:** 1.0.0  
**Date:** 2026-10-16  
**Status:** IMPLEMENTED & VERIFIED (Pending Project Owner Review)  
**Governance Scope:** WP-04 (PWA Offline) Authorized Only. WP-05, Phase 3B, and Phase 3C remain Strictly Unauthorized.  
**Target Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`  
**Base Commit:** `47a764b2142ed0f75bd3d1a1bf36d15c6cc82cb5`  

---

## 1. Executive Summary
This report documents the completed implementation of **Work Package 04 (WP-04) — PWA Offline** for Bethesda Worship Studio, strictly complying with the approved technical baseline (`BETHESDA_WORSHIP_STUDIO_WP04_PWA_OFFLINE_TECHNICAL_SPEC_REVIEW.md`, v0.1) and all governance constraints established by the Project Owner.

WP-04 transforms Bethesda Worship Studio into an installable, resilient Progressive Web Application (PWA) capable of loading its minimal application shell, inspecting downloaded songs, chord sheets, interactive notation/scores, setlists, and guide audio tracks completely offline without an active internet connection. Offline operation is strictly **read-only**, enforcing total canonical immutability without mutation replay queues. Session isolation and device-sharing protection ensure that previous sessions' private liturgical data is purged and invalidated upon logout.

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

### 2.3 Central Offline Orchestrator: `BethesdaOfflineManager` (`offline-manager.ts`)
- **Connectivity Detection (`isOnline()`):** Monitors `navigator.onLine` and emits events for transitions.
- **Read-Only Mutation Guard (`assertCanMutateServer()`):** Throws `OfflineStorageError('UNAUTHORIZED_SESSION')` if a user attempts a server mutation while offline, preventing accidental data loss or unauthorized mutation attempts.
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
- **Single-Track Audio Download & Playback (`downloadAudio()`, `getAudioUrl()`):**
  - Downloads reference and guide audio tracks using fetch streams.
  - Enforces the 50MB per-file quota (`OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES`).
  - Stores binary audio Blobs in IndexedDB.
  - Creates and manages volatile HTML5 `URL.createObjectURL(blob)` instances, systematically tracking them to revoke on cleanup or logout.
- **Update Detection (`checkForUpdates()`):**
  - On network reconnection, queries server catalog versions and flags local copies as `UPDATE_AVAILABLE` when newer revisions exist.
  - Invariant: Retains previous valid offline copy until the new update is fully downloaded and verified.

### 2.4 User Experience & UI Components
- **`OfflineStatusBar.tsx`:** Floating, accessible, non-intrusive status bar indicating whether the system is connected to the server or operating in offline read-only atril mode. Provides quick access to the offline inventory modal.
- **`DownloadActionButton.tsx`:** State-aware button integrated into song headers, database song modal rows, and setlist rows. Accurately renders states: `Guardar Offline`, `Descargando...`, `Disponible Offline`, `Actualizar Copia`, `Reintentar`. Supports selective local deletion without mutating the server.
- **`OfflineInventoryModal.tsx`:** Comprehensive modal dialog allowing musicians and directors to:
  - Browse downloaded songs, setlists, and audio recordings.
  - Inspect storage utilization with a visual usage meter and byte counts.
  - Identify incomplete setlists with missing song warning badges.
  - Play back downloaded guide audio using an integrated HTML5 player.
  - Selectively remove local offline copies.
- **Workspace Offline Fallback Integration (`MusicalWorkspace.tsx`, `DatabaseSongsModal.tsx`, `SetlistsModal.tsx`):**
  - When network is offline, `DatabaseSongsModal` reads directly from `offlineStorage.listMetadata('SONG')`.
  - `SetlistsModal` falls back to `offlineStorage.listMetadata('SETLIST')`, presenting downloaded cultos and identifying missing dependencies.
  - Selecting a song or setlist item while offline fetches the canonical payload from `offlineStorage.getSongPayload(songId)` and renders it seamlessly in the atril viewport.

---

## 3. Implementation of Product Decisions & Unresolved Decisions

| Decision ID | Topic | Resolution / Implemented Policy |
| :--- | :--- | :--- |
| **P-01** | Offline Mode Read-Only | **ENFORCED.** All mutation actions (saving arrangements, altering setlists, editing songs) are disabled when offline via `assertCanMutateServer()`. No deferred sync queue. |
| **P-02** | Downloadable Content Types | **SUPPORTED.** Songs, chord sheets, interactive notation/scores, setlists, and single guide audio tracks. |
| **P-03** | Device Sharing & Logout Cleanup | **ENFORCED.** Multi-tier session isolation purges user-owned offline content on logout, revokes Object URLs, and sets an emergency tombstone key. |
| **P-04** | Server Canonical Authority | **PRESERVED.** Local deletion affects only client storage; server data is untouched. Server remains the sole source of truth. |
| **U-01** | Offline Grace Period | **RESOLVED (7 Days).** Set to 7 days (`MAX_OFFLINE_DAYS_GRACE_PERIOD = 7`). Content older than 7 days without server revalidation is flagged as stale. |
| **U-02** | Audio Download Grouping | **RESOLVED (Explicit Opt-In).** Audio tracks are downloaded individually or selectively with setlists (`options.includeAudio: false` by default). Multitrack stems remain strictly Phase 3C (unauthorized). |
| **U-03** | Per-File & Quota Limits | **RESOLVED (50MB Cap).** Single file cap of 50MB (`MAX_SINGLE_RESOURCE_SIZE_BYTES`). Storage quota alert and rejection at 85% capacity. |
| **U-04** | Target Browser Support | **RESOLVED.** Baseline: Chromium >= 100, Safari >= 15.4 (iOS / macOS), Firefox >= 100. |
| **U-05** | Logout Verification Failure | **RESOLVED (Double-Layer + Tombstone).** Volatile purge + IndexedDB delete + `bethesda_offline_purge_pending` localStorage tombstone to guard next user. |

---

## 4. File Inventory

### 4.1 Created Files (WP-04 Core & Testing)
```
frontend/
├── public/
│   ├── manifest.webmanifest                               # PWA Web App Manifest
│   └── sw.js                                              # Service Worker with App Shell precaching & API isolation
├── src/
│   ├── components/
│   │   └── offline/
│   │       ├── DownloadActionButton.tsx                   # Multi-state download & delete button
│   │       ├── OfflineInventoryModal.tsx                  # Complete offline inventory & audio player modal
│   │       ├── OfflineStatusBar.tsx                       # Status bar with connectivity indicator
│   │       └── index.ts                                   # Barrel export
│   └── core/
│       └── offline/
│           ├── __tests__/
│           │   ├── indexeddb-storage.test.ts              # Unit tests for storage engine & CRUD
│           │   ├── offline-manager.test.ts                # Unit tests for orchestration & read-only guard
│           │   ├── setlist-packager.test.ts               # Unit tests for setlist packaging & dependencies
│           │   └── session-isolation.test.ts              # Unit tests for logout purge & device sharing
│           ├── storage/
│           │   └── indexeddb-storage.ts                   # Strongly-typed IndexedDB storage wrapper
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
    └── WP04_SECURITY_AND_SESSION_ISOLATION_REPORT.md      # Security & session isolation report
```

### 4.2 Modified Files (Integration Seams)
1. `frontend/index.html`: Added PWA Web App Manifest link, Apple touch icons, and mobile viewport meta tags.
2. `frontend/src/main.tsx`: Added secure browser hook to register `/sw.js` on window load.
3. `frontend/src/App.tsx`: Wrapped component tree in `<OfflineProvider>`, rendered `<OfflineStatusBar />`.
4. `frontend/src/core/auth/auth-context.tsx`: Injected `offlineManager.purgeSessionData(currentUserId)` call in `logout()` lifecycle before tokens and user state are cleared.
5. `frontend/src/components/workspace/MusicalWorkspace.tsx`: Added offline fallback to load canonical song payload directly from IndexedDB when disconnected; wired `persistedSongId` to `SongHeader`.
6. `frontend/src/components/workspace/SongHeader.tsx`: Integrated `DownloadActionButton` for active song.
7. `frontend/src/components/workspace/DatabaseSongsModal.tsx`: Added offline fallback to query downloaded songs from IndexedDB; added `DownloadActionButton` per song row.
8. `frontend/src/components/workspace/SetlistsModal.tsx`: Added offline fallback to query downloaded setlists from IndexedDB; added `⚠️ Incompleto` badge for missing dependencies; added `DownloadActionButton` per setlist row.
9. `frontend/src/index.css`: Added responsive styles for status bar, download buttons, modal inventory, and audio player controls.

---

## 5. Security & Isolation Considerations
1. **Zero Credential Storage:** IndexedDB stores only musical domain data (`CanonicalMusicPayloadJSON`, `FrontendSetlistDetail`) and audio Blobs. Under no circumstances are JWT access tokens, refresh tokens, passwords, or session secrets stored locally.
2. **Device Sharing Boundary:** `purgeSessionData()` deletes all records associated with `ownerUserId`. A subsequent user logging in on the same browser cannot inspect or query the previous user's private songs or setlists.
3. **Cache API Isolation:** Authenticated API requests (`/api/v1/*`) are explicitly excluded from the Service Worker Cache API.
4. **Tombstone Resilience:** If browser storage encounters an unexpected I/O lock during logout, an emergency tombstone key (`bethesda_offline_purge_pending`) persists in `localStorage` to lock access until a clean purge completes.

---

## 6. Known Limitations & Target Browser Realities
1. **iOS Safari Background Audio:** WebKit on iOS terminates or suspends audio playback when a PWA is backgrounded or the screen is locked, unless native media session attributes are continually refreshed. Offline audio playback is verified for active in-app foreground sessions.
2. **Backend Audio Endpoints:** The existing Fastify backend does not currently have native audio streaming or HTTP Range header support. Offline audio operates using direct binary Blob storage in client-side IndexedDB.
3. **Multitracks & OMR:** Multitrack stem mixing and Optical Music Recognition (OMR) are strictly Phase 3C features and were not implemented.

---

## 7. Rollback Instructions
If rollback of WP-04 is required:
1. Revert modified files:
   ```bash
   git checkout -- frontend/index.html frontend/src/App.tsx frontend/src/main.tsx \
     frontend/src/core/auth/auth-context.tsx frontend/src/components/workspace/MusicalWorkspace.tsx \
     frontend/src/components/workspace/SongHeader.tsx frontend/src/components/workspace/DatabaseSongsModal.tsx \
     frontend/src/components/workspace/SetlistsModal.tsx frontend/src/index.css
   ```
2. Remove created files and directories:
   ```bash
   rm frontend/public/manifest.webmanifest frontend/public/sw.js
   rm -rf frontend/src/components/offline/ frontend/src/core/offline/ docs/wp04/
   ```
3. Re-run `npm run build` in `frontend/` to produce the clean original bundle.
