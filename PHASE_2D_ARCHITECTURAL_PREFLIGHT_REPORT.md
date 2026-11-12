# BETHESDA WORSHIP STUDIO
# PHASE 2D — STAGE ERGONOMICS & OFFLINE READINESS
## ARCHITECTURAL PREFLIGHT REPORT

**Project:** Bethesda Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Accepted Phase 2C Baseline Commit (`HEAD`):** `570902fa346e0b2d6a681d55e5348b8681a41b29`  
**Parent Commit (`HEAD~1`):** `654c5f52a115e0449c9037bd92560caeb9bcd91b`  
**Project Execution Designation:** Phase 2D — Stage Ergonomics & Resilient Offline Music Stand Experience  
**Master Roadmap Capability Reference:** Phase 3 — Stage Ergonomics & Offline-First Atril  
**Assignment Scope:** Architectural Preflight, Technical Audit & Governance Gate Only (Zero Production Code Changes)  
**Date:** November 12, 2026  
**Governance Gate Status:** `PREFLIGHT CONDITIONAL PASS — DECISIONS REQUIRED`  

---

## 1. Executive Summary & Phase Naming Reconciliation

### 1.1 Purpose of This Report
This document records the comprehensive architectural and technical preflight audit for **Phase 2D — Stage Ergonomics & Resilient Offline Music Stand Experience** of **Bethesda Worship Studio**. In accordance with Project Owner directives, this preflight inspects the actual repository state at the accepted Phase 2C baseline (`570902fa346e0b2d6a681d55e5348b8681a41b29`), inventories all existing implementations vs. remaining engineering gaps across workstreams `WS-2D-01` through `WS-2D-04`, evaluates security and data integrity invariants, establishes measurable performance budgets, and identifies explicit design decisions requiring Project Owner sign-off prior to production code modification.

### 1.2 Explicit Naming Reconciliation & Historical Traceability
To preserve complete historical traceability across project governance artifacts without altering or renumbering prior acceptance records:

| Governance Dimension | Official Designation | Authoritative Reference |
| :--- | :--- | :--- |
| **Project Execution Designation** | **Phase 2D — Stage Ergonomics & Offline Readiness** | Current Project Owner Authorization Directive |
| **Master Roadmap Capability Group** | **Phase 3 — Stage Ergonomics & Offline-First Atril** (`Workstreams 3.1 – 3.4`) | [`BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md#L298-L322) (§10, §11.2) |
| **Historical Partial Predecessors** | **WP-04 (PWA Offline Core)** & **WP-05 (Constant-Speed Autoscroll without Pedals)** | [`ADR_004_OFFLINE_STORAGE_AND_SESSION_ISOLATION.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/wp04/ADR_004_OFFLINE_STORAGE_AND_SESSION_ISOLATION.md), [`WP04_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/wp04/WP04_IMPLEMENTATION_REPORT.md) |
| **Preceding Closed Milestone** | **Phase 2C — Setlist Liturgical Management & Execution UI** | [`PHASE_2C_SETLIST_LITURGICAL_MANAGEMENT_AND_EXECUTION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_SETLIST_LITURGICAL_MANAGEMENT_AND_EXECUTION_REPORT.md) (`570902fa346e0b2d6a681d55e5348b8681a41b29`) |

No historical phase numbers (`Phase 0`, `Phase 1A–1H`, `Phase 2A`, `Phase 2B`, `Phase 2B.1`, `Phase 2B.2`, `Phase 2C`) or previous acceptance reports have been renumbered or altered.

---

## 2. Git Governance & Repository Preflight State

Before inspecting or authoring any documentation, the repository state was verified directly via Git CLI:

| Verification Check | Verified Value | Status |
| :--- | :--- | :---: |
| **Active Branch** | `feature/phase-1a-core-foundation` | `VERIFIED` |
| **Current `HEAD` Commit** | `570902fa346e0b2d6a681d55e5348b8681a41b29` | `VERIFIED` |
| **Accepted Phase 2C Baseline** | `570902fa346e0b2d6a681d55e5348b8681a41b29` | `EXACT MATCH` |
| **Parent Commit (`HEAD~1`)** | `654c5f52a115e0449c9037bd92560caeb9bcd91b` | `VERIFIED` |
| **Remote Tracking (`origin/feature/phase-1a-core-foundation`)** | `570902fa346e0b2d6a681d55e5348b8681a41b29` | `SYNCHRONIZED` |
| **Uncommitted Changes Before Preflight** | None (`git status --short` empty) | `CLEAN` |
| **Production Code / Schema / Dependency Changes** | `0` files modified | `PROTECTED` |
| **Authorized Preflight Deliverables** | `PHASE_2D_ARCHITECTURAL_PREFLIGHT_REPORT.md` (+ `docs/`), `PHASE_2D_IMPLEMENTATION_PLAN_AND_ACCEPTANCE_MATRIX.md` (+ `docs/`) | `DOCUMENTATION ONLY` |

---

## 3. Comprehensive Technical Audit of Current Repository

### 3.1 Existing PWA & Service Worker Architecture (`WS-2D-01`)

#### 3.1.1 Web App Manifest & HTML Entry Point
- **File:** [`frontend/public/manifest.webmanifest`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/public/manifest.webmanifest#L1-L27)
  - Declares `"name": "Bethesda Worship Studio"`, `"short_name": "WorshipStudio"`, `"start_url": "/"`, `"display": "standalone"`, `"orientation": "any"`, `"background_color": "#0f172a"`, `"theme_color": "#0f172a"`, `"lang": "es"`, and `192x192` / `512x512` maskable PNG icons (`/worship_studio_saxophone_emblem.png`).
- **File:** [`frontend/index.html`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/index.html#L1-L25)
  - Links `<link rel="manifest" href="/manifest.webmanifest" />`, `<link rel="apple-touch-icon" href="/worship_studio_saxophone_emblem.png" />`, `<meta name="theme-color" content="#0f172a" />`, and `<meta name="apple-mobile-web-app-capable" content="yes" />`.
- **File:** [`frontend/vite.config.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/vite.config.ts#L1-L19)
  - Uses `@vitejs/plugin-react` and proxies `/api` to `http://localhost:3000`. Does not use third-party workbox plugins; the Service Worker is maintained as an explicit, deterministic script in `frontend/public/sw.js`.

#### 3.1.2 Service Worker Implementation & Registration
- **File:** [`frontend/public/sw.js`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/public/sw.js#L1-L166)
  - **Cache Identifier:** `CACHE_NAME = 'bethesda-worship-studio-shell-v1'` (line 13).
  - **Install Precache (`STATIC_SHELL_ASSETS`, lines 15–31):** Precaches `['/', '/index.html', '/worship_studio_saxophone_emblem.png', '/manifest.webmanifest']` and immediately invokes `self.skipWaiting()`.
  - **Activate Cleanup (lines 34–46):** Deletes all caches where `name !== CACHE_NAME` and calls `self.clients.claim()`.
  - **Cache Eligibility Guard (`isCacheEligible`, lines 59–67):** Validates that `request`, `response`, and `url` exist, `url.protocol` is strictly `'http:'` or `'https:'` (preventing `chrome-extension:` / `blob:` / `data:` errors), `request.method === 'GET'`, `response.status === 200`, `response.type` is `'basic'` or `'cors'`, and `!url.pathname.startsWith('/api/')`.
  - **Safe Cache Write (`safelyPutInCache`, lines 74–87):** Wraps `cache.put()` in `try/catch`, stripping query parameters (`request.url.split('?')[0]`) on warning logs so invitation or reset tokens in query strings are never leaked to console logs.
  - **Strict REST API Security Invariant (lines 104–124):** Intercepts `/api/v1/*` requests as network-only; never reads from or writes to the Cache API. On network failure, returns a synthetic HTTP `503 Service Unavailable (Offline)` JSON response with `error.code = 'NETWORK_OFFLINE'`.
  - **Navigation Strategy (lines 127–145):** Network-first for `request.mode === 'navigate'`, updating `/index.html` in cache when online and falling back to `caches.match('/index.html')` or `caches.match('/')` when offline.
  - **Static Asset Strategy (lines 148–164):** Stale-While-Revalidate (`caches.match(request)` returned immediately if present, while fetching in background to update cache).
- **File:** [`frontend/src/main.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/main.tsx#L15-L32)
  - Registers `navigator.serviceWorker.register('/sw.js')` on `window` `load`.

#### 3.1.3 Identified Gaps in `WS-2D-01`
1. **`GAP-2D-01A` — Notation Font & Production Bundle Precaching:**
   - `STATIC_SHELL_ASSETS` in `sw.js` only precaches 4 root files (`/`, `/index.html`, `/worship_studio_saxophone_emblem.png`, `/manifest.webmanifest`).
   - While Stale-While-Revalidate caches JS/CSS/font assets as they are requested, if a musician installs the PWA online, downloads a setlist from `SetlistsModal` without opening a polyphonic score in `AlphaTabAdapter` (`@coderline/alphatab`) or `OsmdAdapter` (`opensheetmusicdisplay`), and then goes offline at the sanctuary, any lazy-loaded renderer chunks or musical notation fonts (such as AlphaTab's Bravura font glyphs) that were not yet fetched will fail to load offline.
   - Furthermore, `sw.js` needs an asset manifest / warm-up registration channel (`PRECACHE_ASSETS` message from the client after boot) so all compiled Vite entry chunks and notation font assets are deterministically cached on first online installation.
2. **`GAP-2D-01B` — Service Worker Update Lifecycle & Active Stage Protection:**
   - `sw.js` currently executes `self.skipWaiting()` unconditionally on `install` and `self.clients.claim()` on `activate`.
   - `main.tsx` has no listener for `updatefound`, `statechange`, or `controllerchange`, and no mechanism to defer Service Worker activation or page reload while a musician is actively executing an `ACTIVE` setlist or in `isMusicStandMode === true`.
3. **`GAP-2D-01C` — Offline Cold-Startup Authentication Degradation (`AuthProvider`):**
   - In [`frontend/src/core/auth/auth-context.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/auth/auth-context.tsx#L39-L88), `initSession()` calls `performSilentRefresh()`, which sends `POST /api/v1/auth/refresh`.
   - When the tablet starts or reloads **offline** (`navigator.onLine === false`), `POST /api/v1/auth/refresh` fails with HTTP 503 (`NETWORK_OFFLINE`). The `catch` block (lines 60–65) immediately sets `user = null` and `authStatus = 'UNAUTHENTICATED'`.
   - Because `user` becomes `null`:
     1. [`MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L475-L489) hides the **"📋 Repertorios de Culto (Setlists)"** button (`{user !== null && ...}`)!
     2. `OfflineContext` (`offline-context.tsx` line 82) queries `offlineManager.getInventory(undefined)` instead of scoping to the authenticated user's `user.id`.
   - **Required Architectural Solution:** Persist a strictly non-sensitive `OfflineSessionIdentity` record (containing only `{ userId, email, fullName, role, lastAuthenticatedAt }` — **zero JWT access tokens, zero refresh tokens, zero passwords**) validated against the 7-day offline grace period (`OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD`) and wiped unconditionally on `logout()` and tombstone recovery. When `performSilentRefresh()` fails specifically due to offline network state (`!navigator.onLine`) and a valid non-expired `OfflineSessionIdentity` exists, `AuthProvider` transitions to an explicit read-only authenticated offline session state so the musician can access their cached setlists and preferences offline.

---

### 3.2 Existing IndexedDB Offline Persistence Architecture (`WS-2D-02`)

#### 3.2.1 Storage Layer & Orchestrator Inventory
- **File:** [`frontend/src/core/offline/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/types.ts#L1-L186)
  - Defines `OfflineResourceStatus`, `OfflineResourceType` (`'SONG' | 'SETLIST' | 'AUDIO'`), `OfflineResourceMetadata`, `OfflineSongPayload`, `OfflineSetlistPayload`, `OfflineAudioRecord`, `OfflineStorageError`, and `OFFLINE_POLICIES` (`MAX_OFFLINE_DAYS_GRACE_PERIOD: 7`, `MAX_SINGLE_RESOURCE_SIZE_BYTES: 50MB`, `MAX_STORAGE_QUOTA_USAGE_RATIO: 0.85`, `CLEANUP_TOMBSTONE_KEY: 'bethesda_offline_purge_pending'`).
- **File:** [`frontend/src/core/offline/storage/indexeddb-storage.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/storage/indexeddb-storage.ts#L1-L583)
  - `BethesdaOfflineStorage` singleton managing IndexedDB `bethesda_worship_studio_offline_db` (`DB_VERSION = 1`).
  - Object Stores (`STORES`): `offline_metadata` (indexed by `resourceType`, `ownerUserId`, `status`), `song_payloads`, `setlist_payloads`, `audio_blobs`.
  - Includes deterministic in-memory `Map` fallback when `typeof indexedDB === 'undefined'` (enabling fast, deterministic Node.js unit tests).
  - Implements `recoverPendingCleanupTombstone()` on `init()` (lines 120–146), canonical metadata consistency on `getSongPayload`/`getSetlistPayload`/`getAudioRecord` (lines 276–282, 349–355, 430–436), orphan-free `deleteResource(id)` (lines 468–486), and user-isolated `purgeUserData(userId)` (lines 517–529).
- **File:** [`frontend/src/core/offline/offline-manager.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts#L1-L1053)
  - `BethesdaOfflineManager` singleton orchestrating:
    - `isOnline()` and `assertCanMutateServer()` (read-only offline invariant).
    - `assertStorageQuotaAvailable(projectedBytes)` (85% quota guard via `navigator.storage.estimate()`).
    - `downloadSong(songId, currentUserId)`: fetches `BackendSongResponse`, validates `CanonicalMusicPayload.fromJSON()` via `CanonicalModelValidator.validate()`, computes SHA-256 checksum (`computeSha256`), and persists `OfflineSongPayload`.
    - `downloadSetlist(setlistId, currentUserId, options)`: fetches `FrontendSetlistDetail`, iterates `SONG` items, downloads missing songs when `includeSongs: true`, computes `associatedSongIds` and `missingSongIds`, computes SHA-256 checksum, and saves `OfflineSetlistPayload`.
    - `isAuthorizationExpired(metadata)`: enforces 7-day grace period from `lastValidatedAt || downloadedAt` with 5-minute clock-tampering guard (`elapsedMs < -300000`).
    - `getAuthorizedSongPayload(songId)`: enforces `FAILED`/revoked check, 7-day offline expiry check, and online server revalidation (`getSong(songId)`).
    - `checkForUpdates()`: exhaustively paginates `apiClient.listSongs({ limit: 100, offset })`, compares `versionNumber`, updates `lastValidatedAt`, marks newer server versions `UPDATE_AVAILABLE`, and performs targeted `getSong(id)` verification for absent songs before purging on confirmed HTTP 401/403/404.
    - `purgeSessionData(userId)`: aborts active `AbortController` downloads, revokes audio Object URLs, writes `CLEANUP_TOMBSTONE_KEY`, purges user data, verifies 0 remaining user records (forcing `purgeAll()` if incomplete), and clears the tombstone.

#### 3.2.2 Identified Gaps in `WS-2D-02`
1. **`GAP-2D-02A` — `useSetlistExecution.loadSetlist` Has Zero Offline Fallback:**
   - In [`frontend/src/core/workspace/use-setlist-execution.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/use-setlist-execution.ts#L135-L152):
     ```typescript
     const detail = await apiClient.getSetlist(setlistId);
     ```
   - `loadSetlist(setlistId)` calls `apiClient.getSetlist(setlistId)` directly with **no fallback to `offlineManager` / `offlineStorage`**.
   - Consequently, even when a setlist and all its songs are downloaded in IndexedDB and listed in `SetlistsModal.tsx` while offline, clicking **"▶ Cargar en Atril"** invokes `onLoadSetlist(setlistId)` $\rightarrow$ `setlistExecution.loadSetlist(setlistId)` $\rightarrow$ `apiClient.getSetlist(setlistId)` $\rightarrow$ **HTTP 503 failure**! The setlist cannot be opened in the atril while offline!
2. **`GAP-2D-02B` — Missing `getAuthorizedSetlistPayload(setlistId)` & Setlist Revalidation in `BethesdaOfflineManager`:**
   - While `BethesdaOfflineManager` provides `getAuthorizedSongPayload(songId)` with SHA-256 integrity verification, 7-day grace period enforcement, and online revalidation, **there is no `getAuthorizedSetlistPayload(setlistId)` method**.
   - Furthermore, `checkForUpdates()` (lines 840–985) only checks `resourceType === 'SONG'` and never revalidates cached `SETLIST` records against `apiClient.getSetlist(id)` (e.g., to detect when a Worship Leader has reordered items, changed a `targetKey` or `targetBpm`, added a new song to the setlist, or when a setlist was deleted/revoked on the server).
3. **`GAP-2D-02C` — No Automatic Persistence of the Active Setlist or Execution Cursor Recovery:**
   - Currently, a setlist is only persisted in IndexedDB if the user manually clicks `DownloadActionButton` inside `SetlistsModal`.
   - When a musician loads a setlist into the atril (`loadSetlist`) or activates it (`activateCurrentSetlist`), the system does **not** automatically package and cache that active setlist and its associated canonical songs in IndexedDB.
   - Additionally, `useSetlistExecution` holds `loadedSetlist` and `currentIndex` purely in volatile React state. If a tablet browser tab is terminated by the OS or accidentally refreshed mid-service while offline, the musician returns to the default sample song instead of automatically restoring the active setlist at the exact `currentIndex`, `isMusicStandMode`, `isHighContrast`, and `zoomPercent`.
4. **`GAP-2D-02D` — Disconnected Action Callbacks in `OfflineStatusBar` / `OfflineInventoryModal`:**
   - In [`frontend/src/App.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/App.tsx#L43), `<OfflineStatusBar />` is rendered without passing `onSelectSong` or `onSelectSetlist`.
   - In [`OfflineInventoryModal.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/offline/OfflineInventoryModal.tsx#L342-L384), the **"📖 Abrir"** (song) and **"📋 Cargar"** (setlist) buttons are conditionally rendered only when `onSelectSong` / `onSelectSetlist` are defined, making it impossible to open a cached song or setlist directly from the Offline Inventory modal.
5. **`GAP-2D-02E` — N+1 Song Prefetcher in `MusicalWorkspace.tsx` Bypasses IndexedDB:**
   - In [`MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L274-L287), the N+1 prefetcher calls `client.getSong(nextSongId)` directly without checking `offlineManager.getAuthorizedSongPayload(nextSongId)` first, generating unnecessary 503 network errors when offline.
6. **`GAP-2D-02F` — Interrupted Write Atomicity & Quota Eviction Policy:**
   - In `IndexedDbStorage.saveSongPayload` and `saveSetlistPayload` (lines 235–254, 309–327), `saveMetadata` and `store.put(payload)` are executed in two separate IndexedDB transactions rather than a single atomic multi-store transaction (`db.transaction([STORES.METADATA, STORES.SONG_PAYLOADS], 'readwrite')`). If a write is interrupted between the two transactions, `offline_metadata` could record `AVAILABLE_OFFLINE` while the payload store is empty.
   - On storage quota pressure (`>= 85%`), `assertStorageQuotaAvailable` rejects new downloads, but there is no deterministic LRU eviction helper that can reclaim space from old non-active cached resources while strictly protecting the currently `ACTIVE` setlist and its dependency songs.

---

### 3.3 Existing Auto-Scroll Architecture (`WS-2D-03`)

#### 3.3.1 Current Implementation Inventory
- **Files:**
  - [`frontend/src/core/autoscroll/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/types.ts#L1-L40)
  - [`frontend/src/core/autoscroll/use-autoscroll.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/use-autoscroll.ts#L1-L292)
  - [`frontend/src/components/workspace/AutoscrollControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AutoscrollControl.tsx#L1-L145)
  - [`frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/__tests__/autoscroll.test.ts#L1-L292)
- **Current Capabilities:**
  - `requestAnimationFrame` loop (`scrollLoop`) advancing `container.scrollTop` at a constant pixel rate: `pixelsToAdvance = deltaSeconds * baseSpeed * speedRef.current` (`baseSpeed = 35 px/s`, `speed` $\in \{0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0\}$).
  - `resolveScrollTarget(element)` locates the scrollable viewport container (`.visual-document-viewport`, `.score-viewport-container`, `.workspace-viewport-area`, `[data-scrollable="true"]`).
  - Passive `wheel` and `touchstart` listeners pause scrolling temporarily during user interaction and resume after `manualScrollGracePeriodMs = 2000ms`.
  - `visibilitychange` listener pauses scrolling if `document.hidden` becomes `true`.
  - Automatically resets when `activeSong?.title` or `setlistExecution.currentIndex` changes (`MusicalWorkspace.tsx` lines 155–157).

#### 3.3.2 Identified Gaps in `WS-2D-03`
1. **`GAP-2D-03A` — Absence of BPM-Driven & Measure-Count Adaptive Velocity Calculation:**
   - `useAutoscroll` is currently 100% blind to musical timing. A fast 140 BPM 16-measure chorus and a slow 62 BPM 80-measure worship ballad both scroll at `35 px/s` at `1.0x`.
   - **Zero-Fabrication Adaptive Requirement:**
     - The canonical model ([`Timeline`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/canonical-model/timeline.ts#L18-L86) and [`TempoMap`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/canonical-model/tempo-map.ts#L47-L234)) already provides exact, non-fabricated temporal primitives:
       - `timeline.isUnmetered`: `true` when the score is unmeasured (e.g., unmeasured ASCII tablature from Phase 2B.2).
       - `timeline.totalDurationTicks`: `number | null` (exact tick duration at `480 TPQN`, or `null` when unmeasured).
       - `timeline.measureCount`: integer count of canonical measures.
       - `timeline.tempoMap`: `TempoMap` with `isUnresolved: boolean` and `tickToSeconds(targetTick, fallbackBpm)`.
     - Additionally, in a liturgical setlist (`FrontendSetlistItem`), the Worship Leader may specify `item.targetBpm`, or the song metadata may provide `song.defaultBpm`.
     - **Adaptive Velocity Formula (When Authoritative Timing Exists):**
       - Effective BPM resolution precedence:
         1. `setlistItem.targetBpm` (if $> 0$, liturgical service tempo override)
         2. `timeline.tempoMap` (if `!tempoMap.isUnresolved`)
         3. `persistedSongDefaultBpm` (if $> 0$)
       - Total performance duration $T_{\text{total}}$ in seconds:
         - If `timeline.isUnmetered === true` or `timeline.measureCount <= 0` or `isVisualDocument === true`: **Adaptive mode is unavailable** (`adaptiveEligibility: 'UNAVAILABLE'`).
         - Else if `setlistItem.targetBpm` is set and `timeline.totalDurationTicks !== null && timeline.totalDurationTicks > 0`:
           $$T_{\text{total}} = \frac{\text{totalDurationTicks} \times 60}{480 \times \text{targetBpm}}$$
         - Else if `!timeline.tempoMap.isUnresolved && timeline.totalDurationTicks !== null && timeline.totalDurationTicks > 0`:
           $$T_{\text{total}} = \text{timeline.totalDurationSeconds}$$
         - Else if `effectiveBpm !== null && effectiveBpm > 0` and `measures.length > 0`:
           $$T_{\text{total}} = \sum_{m=1}^{M} \left( m.\text{timeSignature.numerator} \times \frac{4}{m.\text{timeSignature.denominator}} \right) \times \frac{60}{\text{effectiveBpm}}$$
         - Else: **Adaptive mode is unavailable** (`adaptiveEligibility: 'UNAVAILABLE'`, reason: `'MISSING_TEMPO_AND_DURATION'`).
       - Adaptive base pixel velocity:
         $$v_{\text{adaptive}} = \frac{\text{maxScrollTop}}{T_{\text{total}}} \quad (\text{clamped to safe ergonomic bounds } [5\text{ px/s}, 250\text{ px/s}])$$
         with user speed multiplier (`0.5x`–`3.0x`) acting as fine-tuning around `1.0x = exact BPM tempo`.
       - **Strict Zero-Fabrication Fallback:** Whenever `adaptiveEligibility === 'UNAVAILABLE'`, the system **never fabricates 120 BPM or synthetic measure counts**. It falls back deterministically to `MANUAL` constant pixel speed (`35 px/s`) and displays an explicit diagnostic indicator in `AutoscrollControl`.
2. **`GAP-2D-03B` — Sub-Pixel Scroll Quantization on High-DPI / 120Hz Tablets:**
   - In [`use-autoscroll.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/use-autoscroll.ts#L114), `container.scrollTop += pixelsToAdvance` writes directly to the DOM property each frame without keeping a floating-point sub-pixel accumulator.
   - On 120Hz iPad Pro / Android tablets ($\Delta t \approx 8.33\text{ms}$) at low scroll velocities (e.g., $10\text{ px/s} \times 0.00833\text{s} = 0.083\text{px/frame}$), browsers that round `scrollTop` to integer or physical device pixels truncate `0.083` to `0`, freezing the scroll completely!
   - A floating-point accumulator (`virtualScrollTopRef`) that syncs with `container.scrollTop` on user manual scroll overrides is required.
3. **`GAP-2D-03C` — Dynamic Format Switching & `ResizeObserver` Recalibration:**
   - Switching reading formats (`SCORE` $\leftrightarrow$ `CHORD_SHEET` $\leftrightarrow$ `LYRICS` $\leftrightarrow$ `TAB`) or Stand Zoom (`zoomPercent`) dynamically alters `container.scrollHeight`. `useAutoscroll` must observe `ResizeObserver` on the resolved scroll container and preserve proportional progress (`progressPercentage`) when format or zoom changes mid-song.
4. **`GAP-2D-03D` — Accessibility & `prefers-reduced-motion` Support:**
   - `useAutoscroll` does not currently inspect `window.matchMedia('(prefers-reduced-motion: reduce)')`. When reduced motion is requested by the operating system, continuous smooth pixel scrolling should either step discretely by viewport fraction or display an explicit reduced-motion indicator allowing musician override.

---

### 3.4 Bluetooth Pedal & Hands-Free Stage Input Architecture (`WS-2D-04`)

#### 3.4.1 Current Implementation Inventory
- **Current Status:** **0% Implemented (`SPECIFIED / NOT IMPLEMENTED`)**.
- During historical Work Package 05 (`WP-05`), hardware pedal integration was explicitly excluded.
- **Critical Existing Regression Test Constraint:**
  - [`frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/__tests__/autoscroll.test.ts#L261-L291) (Test 8) reads the raw source files `src/core/autoscroll/use-autoscroll.ts` and `src/components/workspace/AutoscrollControl.tsx` and asserts that neither file contains the substrings `'pedal'`, `'bluetooth'`, or `'gamepad'`.
  - **Architectural Implication (Rule 9 Compliance):** To preserve `autoscroll.test.ts` Test 8 without modifying or weakening it, all Phase 2D pedal logic, types, hooks, and UI controls **must reside in a dedicated decoupled module (`frontend/src/core/pedals/` and `frontend/src/components/workspace/PedalControlBar.tsx`)** and communicate with `autoscroll` and `setlistExecution` via standard controller callbacks in `MusicalWorkspace.tsx`.

#### 3.4.2 Identified Defects & Gaps in `WS-2D-04`
1. **`GAP-2D-04A` — Active `Space` Key Collision Between `SetlistNavigationToolbar` and `AutoscrollControl`:**
   - In [`SetlistNavigationToolbar.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/SetlistNavigationToolbar.tsx#L101-L105):
     ```typescript
     if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !isOffSetlistSongActive)) {
       if (hasNext && !isLoading) {
         e.preventDefault();
         onGoToNext();
       }
     }
     ```
   - Simultaneously, in [`AutoscrollControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AutoscrollControl.tsx#L34-L37):
     ```typescript
     if (e.code === 'Space') {
       e.preventDefault();
       togglePlayPause();
     }
     ```
   - **Impact:** When a setlist is active in the atril, pressing `Space` on a keyboard or Bluetooth pedal fires **both** listeners in the same event loop—toggling autoscroll AND immediately advancing to the next song in the setlist!
2. **`GAP-2D-04B` — Premature Song Switching on `PageDown` / `PageUp` Multi-Page Scores:**
   - `SetlistNavigationToolbar.tsx` currently maps `PageDown` / `PageUp` and `ArrowRight` / `ArrowLeft` unconditionally to `onGoToNext()` / `onGoToPrevious()` (which changes the active setlist item).
   - If a musician is reading a 3-page score or chord sheet (`scrollTop < maxScrollTop`) and presses a Bluetooth foot pedal emitting `PageDown`, the app jumps to the **next song** instead of scrolling down to page 2 of the current score!
3. **`GAP-2D-04C` — Bluetooth Pedal Hardware Protocols & Browser API Reality:**
   - **How Commercial Stage Pedals Actually Work (AirTurn, PageFlip, Coda Stomp):**
     - **AirTurn (PEDpro, DUO 200/500, QUAD 200/500, BT200S):** Operates primarily in **Bluetooth HID Keyboard Profile** (Modes 2–6):
       - *Mode 2 (Standard Page Turner):* Pedal 1 (Left/Up) = `PageUp`, Pedal 2 (Right/Down) = `PageDown`, Pedal 3 = `ArrowUp`, Pedal 4 = `ArrowDown`.
       - *Mode 3 (Arrow Navigation):* Pedal 1 = `ArrowUp` or `ArrowLeft`, Pedal 2 = `ArrowDown` or `ArrowRight`, Pedal 3 = `Space`, Pedal 4 = `Enter`.
     - **PageFlip (Firefly, Butterfly, Cicada, Dragonfly):** Operates as a standard **Bluetooth HID Keyboard** with selectable hardware switches emitting `(PageUp, PageDown)`, `(ArrowUp, ArrowDown)`, `(ArrowLeft, ArrowRight)`, or `(Space, Enter)`.
     - **Coda Stomp:** Operates as a **Bluetooth HID Keyboard** emitting `PageUp`/`PageDown` or `ArrowLeft`/`ArrowRight` or `Space`.
     - **USB / Bluetooth Gamepad Foot Controllers:** Exposed via the W3C **Gamepad API** (`navigator.getGamepads()`, `gamepadconnected` / `gamepaddisconnected` window events, buttons `0`/`1` or D-Pad buttons `12`/`13`/`14`/`15`).
   - **Browser & OS Compatibility Constraints (Zero-Fabrication Hardware Honesty):**
     - **HID Keyboard Mode (`keydown` / `keyup`):** Supported across **100% of target browsers** (iPadOS/iOS Safari, Android Chrome, Windows/macOS Chrome, Edge, Firefox) with zero special browser permission prompts once paired at the OS Bluetooth settings level.
     - **W3C Gamepad API (`navigator.getGamepads()`):** Supported across Chromium, Firefox, and Safari >= 15.4 for controllers enumerating as standard HID gamepads.
     - **Web Bluetooth GATT API (`navigator.bluetooth`) & WebHID (`navigator.hid`):** **NOT supported on iOS / iPadOS Safari** (Apple WebKit explicitly excludes Web Bluetooth and WebHID). Therefore, relying on `navigator.bluetooth` would fail completely on iPads! The pedal subsystem must treat **HID Keyboard Profile (`KeyboardEvent`) + W3C Gamepad API (`Gamepad`)** as the primary, cross-platform stage drivers, and never claim universal raw BLE GATT compatibility without physical device verification.
4. **`GAP-2D-04D` — Missing Debouncing, Key-Repeat Suppression, and Local Override Guards:**
   - Mechanical and membrane foot switches exhibit contact bounce (`20ms–80ms`) and OS key-repeat (`KeyboardEvent.repeat === true` when a musician holds their foot on the switch).
   - Without strict suppression of `e.repeat === true` and a configurable debounce cooldown window (default `220ms`), holding or firmly pressing a foot pedal causes multiple rapid page turns or skips multiple songs in the setlist.
   - Furthermore, pedal events must be automatically suppressed when any modal dialog (`SetlistsModal`, `DatabaseSongsModal`, `OfflineInventoryModal`), text input (`INPUT`, `TEXTAREA`, `SELECT`, `isContentEditable`), or conversion editor is focused.

---

## 4. Architectural Immutability Compliance Matrix

Phase 2D must strictly preserve all nine architectural invariants established in Phases 1A through 2C:

| Rule # | Mandatory Immutability Rule | Phase 2D Architectural Compliance Mechanism | Status |
| :---: | :--- | :--- | :---: |
| **1** | **Preserve `CanonicalMusicPayload`** | IndexedDB (`song_payloads`) stores the exact immutable `CanonicalMusicPayloadJSON` snapshot validated by `CanonicalModelValidator.validate()`. Neither `WS-2D-02`, `WS-2D-03`, nor `WS-2D-04` alters any field or class of `CanonicalMusicPayload`. | `PRESERVED` |
| **2** | **Preserve `totalMelodyNotes === 0`** | ChordPro / Lead Sheet songs with `totalMelodyNotes === 0` remain untouched during offline caching, revalidation, and adaptive auto-scroll calculation. | `PRESERVED` |
| **3** | **Preserve `Instrument ≠ View` separation** | `ProjectionService`, `InstrumentRegistry`, and `DerivedMusicalView` remain completely decoupled from offline storage, auto-scroll, and pedal drivers. | `PRESERVED` |
| **4** | **Preserve Phase 2C setlist behavior and existing APIs** | Zero changes to backend REST routes (`/api/v1/setlists`, `/api/v1/worship-services`), database schemas, or `setlist-execution-orchestrator.ts` state transitions. Offline fallback in `useSetlistExecution` wraps `apiClient.getSetlist` transparently. | `PRESERVED` |
| **5** | **Preserve individual musician preference precedence** | `resolveEffectiveStandView()` in [`music-stand-controller.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/music-stand-controller.ts) (`USER_PREFERENCE` > `SETLIST_SUGGESTION` > `WORKSPACE_DEFAULT`) is preserved both online and offline (caching `UserViewPreferenceData` for read-only offline use). | `PRESERVED` |
| **6** | **Preserve Zero-Fabrication guarantees** | Adaptive auto-scroll (`WS-2D-03`) never invents BPM (`120 BPM`) or synthetic measure durations when `timeline.isUnmetered === true` or BPM metadata is absent; it falls back explicitly to manual speed mode with a diagnostic reason. | `PRESERVED` |
| **7** | **Preserve MIDI fail-closed validation** | `TemporalValidator` and `MidiExportGatekeeper` (Phase 2B.2) are untouched. Unmeasured and partially measured scores remain blocked from MIDI export offline and online. | `PRESERVED` |
| **8** | **Preserve PostgreSQL transaction & concurrency guarantees** | Zero backend database schema, repository, or transaction changes are needed for Phase 2D. Single-ACTIVE-setlist partial unique index and `FOR UPDATE` locking remain untouched. | `PRESERVED` |
| **9** | **Do not weaken, delete, skip or rewrite existing tests** | All `1,338` existing tests (`746` backend + `592` frontend, including `autoscroll.test.ts` Test 8) are preserved 100% intact. Pedal integration is isolated in `frontend/src/core/pedals/`. | `PRESERVED` |

---

## 5. Security, Privacy & Data Integrity Evaluation

| Security Dimension | Current Mechanism | Phase 2D Enhancement & Enforcement |
| :--- | :--- | :--- |
| **1. Protection of Locally Cached User Data** | `IndexedDbStorage` tags every record in `offline_metadata` with `ownerUserId`. `listMetadata(userId)` filters by `ownerUserId === userId \|\| ownerUserId === null`. | Extend `ownerUserId` tagging and verification to cached `UserViewPreferenceData` and `activeSetlistSessionState`. Enforce strict `ownerUserId` match in `getAuthorizedSongPayload` and `getAuthorizedSetlistPayload`. |
| **2. Session Expiration While Offline** | `OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD = 7` days (`604,800,000 ms`) from `lastValidatedAt \|\| downloadedAt` with 5-minute backward clock-tampering detection (`isAuthorizationExpired`). | Enforce the identical 7-day expiration policy on cached setlists (`getAuthorizedSetlistPayload`) and on the non-sensitive `OfflineSessionIdentity` record so offline access automatically expires after 7 days without server revalidation. |
| **3. Logout & Account Switching** | `AuthProvider.logout()` invokes `offlineManager.purgeSessionData(currentUserId)`, aborting active downloads, revoking Object URLs, writing `bethesda_offline_purge_pending` tombstone, deleting user records, and verifying cleanup. | Also purge `OfflineSessionIdentity`, cached user view preferences, and `activeSetlistSessionState` on `logout()` and when `login()` detects a different `user.id` than the previously cached offline identity. |
| **4. Cross-User & Cross-Session Isolation** | Service Worker (`sw.js`) never caches `/api/v1/*`. IndexedDB isolates records by `ownerUserId`. | Add automated cross-user isolation tests for `getAuthorizedSetlistPayload` and `activeSetlistSessionState` ensuring User B cannot load User A's cached active setlist. |
| **5. Sensitive Data Retention** | JWT access tokens live strictly in volatile JS memory (`token-manager.ts`); refresh tokens live in `HttpOnly` cookies. | **Zero credentials, JWTs, or refresh tokens are ever written to IndexedDB, Cache API, or `localStorage`**. `OfflineSessionIdentity` stores only public profile display fields (`userId`, `email`, `fullName`, `role`, `lastAuthenticatedAt`). |
| **6. Cache Invalidation After Permission Changes** | `checkForUpdates()` and `getAuthorizedSongPayload()` purge local song payloads and mark metadata `FAILED` upon receiving HTTP `401`, `403`, or `404` from the server. | Extend `checkForUpdates()` and `getAuthorizedSetlistPayload()` to revalidate cached setlists against `GET /api/v1/setlists/:id`, immediately purging the local setlist payload if the server returns `401`, `403`, or `404`. |
| **7. Safe Synchronization After Reconnection** | Offline mode is strictly **Read-Only** (`assertCanMutateServer()`). Zero offline mutation queues exist. | On `window` `online` event, trigger non-blocking background `checkForUpdates()` (revalidating both songs and setlists) without interrupting an active song render in the atril. |
| **8. Protection Against Stale or Unauthorized Setlist Data** | Songs compute SHA-256 over `canonicalPayload` and compare `versionNumber`. | Compute and verify SHA-256 checksum on `OfflineSetlistPayload` read-back (`getAuthorizedSetlistPayload`) and compare `setlistDetail.updatedAt` during online revalidation to flag `UPDATE_AVAILABLE` when setlist items or keys change on the server. |

---

## 6. Performance & Reliability Budgets vs. Verified Baseline Measurements

In strict adherence to the Zero-Fabrication policy, **verified baseline measurements** (collected from actual test executions on the repository) are separated from **proposed Phase 2D engineering targets** (to be validated during Phase 2D acceptance):

| Metric / Capability | Verified Baseline Measurement (Current Repo) | Proposed Phase 2D Engineering Target | Verification Method |
| :--- | :--- | :--- | :--- |
| **Automated Test Suite Execution (Offline + Autoscroll)** | **61 / 61 tests PASS in `524.36 ms`** (`autoscroll`: `6.91 ms`, `indexeddb-storage`: `12.50 ms`, `offline-manager`: `76.25 ms`, `sw-eligibility`: `15.80 ms`, `session-isolation`: `214.77 ms`, `setlist-packager`: `14.32 ms`) | 100% pass rate across all existing + new Phase 2D Node.js suites in `< 1,500 ms` | Automated (`node --test`) |
| **Full Consolidated Repository Test Baseline** | **1,338 / 1,338 tests PASS** (`746` backend + `592` frontend), `0` failures, `0` TS errors | 100% pass rate (`0` regressions) | Automated (`npm test` + `tsc --noEmit`) |
| **Initial Offline App Shell Startup (Cold Boot)** | *Not yet measured in standalone offline mode* | `< 1,200 ms` Time-to-Interactive from Service Worker Cache API | Manual DevTools Offline Audit |
| **Offline Setlist Loading Time (10-Song Setlist)** | *Currently fails offline (`GAP-2D-02A`)* | `< 150 ms` to load `FrontendSetlistDetail` + first song from IndexedDB | Automated benchmark + Manual UI check |
| **IndexedDB Read / Write Latency (Single Song Payload ~50KB)** | Memory fallback: `< 2 ms` (verified in `indexeddb-storage.test.ts`); Browser IDB: *unmeasured* | Read `< 25 ms`, Atomic Write + SHA-256 `< 80 ms` per song | Automated test + Manual DevTools timing |
| **Auto-Scroll Frame Pacing & Smoothness** | Logic simulator verified deterministic in `autoscroll.test.ts`; physical tablet FPS *unmeasured* | `60 FPS` (`16.6 ms` frame budget) / `120 FPS` (`8.3 ms` on ProMotion), zero sub-pixel stall at `>= 5 px/s`, `< 1%` dropped frames | Automated sub-pixel accumulator test + Manual Tablet Performance Profile |
| **Extended 60-Minute Operation Memory Footprint** | *Unmeasured on physical tablet* | Heap growth `< 15 MB` over 60 minutes of continuous setlist navigation & auto-scroll; `0` detached DOM trees or leaked `requestAnimationFrame` / `ObjectURL` handles | Manual 60-Minute Tablet Soak Test |
| **Battery Impact (60-Minute Offline Atril Session)** | *Unmeasured on physical tablet* | `< 12%` battery drain per 60 minutes at 50% screen brightness (achieved via SVG rendering, zero background polling when offline, and passive touch listeners) | Manual 60-Minute Tablet Soak Test |
| **Recovery After Browser Termination** | *Not implemented (`GAP-2D-02C`)* | `< 300 ms` automatic restoration of active setlist ID, item index, and stand settings (`isMusicStandMode`, `isHighContrast`, `zoomPercent`) on relaunch | Automated state restoration test + Manual UI test |
| **Recovery After Network Reconnection** | `online` event triggers `checkForUpdates()` | Non-blocking background revalidation within `< 3,000 ms` of reconnection with zero visual flicker or scroll interruption | Automated test + Manual UI test |

---

## 7. Explicit Unresolved Decisions Requiring Project Owner Sign-Off

Before production code is modified for Phase 2D, the following four architectural/product decisions are presented for Project Owner confirmation (with recommended defaults):

### Decision `DEC-2D-01`: Default Behavior of `PageDown` / `PageUp` and Pedal Forward/Backward in Active Setlist
- **Context:** Currently, `SetlistNavigationToolbar.tsx` binds `PageDown` / `PageUp` directly to `onGoToNext()` / `onGoToPrevious()` (which switches the entire song), colliding with multi-page score reading.
- **Options:**
  - **Option A (Recommended — Smart Stage Paging):** Pressing Forward (`PageDown` / Pedal Right) scrolls down by one viewport screen (`85%` of `clientHeight`) if the current score has remaining vertical scroll (`scrollTop < maxScrollTop - 4`); once at the bottom of the score (or on a `SERVICE_MOMENT` card), pressing Forward advances to the next setlist item (`onGoToNext()`). Users can also explicitly select `"Siempre cambiar canción"` or `"Solo desplazar página"` in Pedal Settings.
  - **Option B (Strict Mode Separation):** `PageDown` / `PageUp` only scrolls within the current song and never advances to the next setlist item; advancing setlist items requires `ArrowRight` / `ArrowLeft`.
- **Recommended Engineering Default:** **Option A (Smart Stage Paging with user-configurable override)**.

### Decision `DEC-2D-02`: Resolution of the `Space` Key Collision (`SetlistNavigationToolbar` vs. `AutoscrollControl`)
- **Context:** Both `SetlistNavigationToolbar.tsx` (line 101) and `AutoscrollControl.tsx` (line 34) currently listen for `Space` on `window`, causing a simultaneous song skip and autoscroll toggle.
- **Options:**
  - **Option A (Recommended — `Space` Controls Autoscroll Play/Pause):** Reserve `Space` exclusively for toggling Autoscroll Play/Pause when viewing a song (`isSong === true`), and use `ArrowRight` / `PageDown` (or Pedal Forward) for setlist navigation. On a `SERVICE_MOMENT` card (where autoscroll is hidden), `Space` advances to the next item.
  - **Option B (`Space` Advances Setlist):** Reserve `Space` for `onGoToNext()` and require a modifier key (`Shift + Space`) for Autoscroll Play/Pause.
- **Recommended Engineering Default:** **Option A (`Space` toggles Autoscroll Play/Pause on songs)**.

### Decision `DEC-2D-03`: Automatic Offline Caching Policy for Setlists
- **Context:** Currently, setlists are only cached when the user manually clicks `Guardar Offline`.
- **Options:**
  - **Option A (Recommended — Auto-Cache Active & Atril-Loaded Setlists):** Automatically cache in IndexedDB any setlist (and its associated canonical songs) when it is loaded into the Atril (`loadSetlist`) or marked `ACTIVE` (`EN CULTO`), while keeping manual `Guardar Offline` available for `PLANNING` setlists and retaining up to the 5 most recent setlists under the 85% storage quota guard.
  - **Option B (Manual Opt-In Only):** Never auto-cache; require the musician to manually click `Guardar Offline` on every setlist before going offline.
- **Recommended Engineering Default:** **Option A (Auto-Cache Active & Atril-Loaded Setlists)**.

### Decision `DEC-2D-04`: Offline Cold-Boot Session Continuity (`OfflineSessionIdentity`)
- **Context:** Because JWT access tokens are held strictly in volatile memory (Phase 2B invariant), reloading or cold-starting the PWA while offline causes `POST /api/v1/auth/refresh` to fail with HTTP 503, resetting `user` to `null` and hiding the Setlists UI.
- **Options:**
  - **Option A (Recommended — Non-Sensitive Offline Session Identity within 7-Day Grace Period):** Store a non-sensitive identity descriptor (`{ userId, email, fullName, role, lastAuthenticatedAt }` — **zero tokens or secrets**) in IndexedDB/localStorage upon authenticated login/refresh, valid only when `!navigator.onLine` and within the 7-day grace period, and purged immediately on `logout()` or tombstone recovery.
  - **Option B (Allow Unauthenticated Read-Only Access to Local Setlist Cache Offline):** Keep `user = null` on offline reload, but unhide the Setlists button when offline so cached setlists can be opened in read-only mode.
- **Recommended Engineering Default:** **Option A (Non-Sensitive Offline Session Identity within 7-Day Grace Period, preserving strict per-user `ownerUserId` isolation on shared church tablets)**.

---

## 8. Final Preflight Governance Gate Determination

$$\mathbf{PREFLIGHT\ CONDITIONAL\ PASS\ —\ DECISIONS\ REQUIRED}$$

- **Justification:**
  1. No architectural blockers prevent Phase 2D implementation; the canonical model (`CanonicalMusicPayload`), rendering adapters (`AlphaTabAdapter`, `OsmdAdapter`, `LeadSheetDomAdapter`), and Phase 2C setlist engine provide clean, modular extension seams.
  2. Foundational offline (`WP-04`) and constant-speed autoscroll (`WP-05`) modules already exist and pass `61 / 61` unit tests (`1,338 / 1,338` repository total).
  3. However, four concrete integration gaps (`GAP-2D-01C` offline cold-boot auth reset, `GAP-2D-02A` missing offline fallback in `useSetlistExecution.loadSetlist`, `GAP-2D-03A` BPM-adaptive velocity math, and `GAP-2D-04A` `Space` key collision + pedal subsystem) and four Project Owner policy confirmations (`DEC-2D-01` through `DEC-2D-04`) must be approved before modifying production code.
- **Mandatory Stop Rule:** Production implementation of `WS-2D-01` through `WS-2D-04` has **NOT** been started. Engineering awaits explicit Project Owner approval of the accompanying [`PHASE_2D_IMPLEMENTATION_PLAN_AND_ACCEPTANCE_MATRIX.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2D_IMPLEMENTATION_PLAN_AND_ACCEPTANCE_MATRIX.md) and decisions `DEC-2D-01` through `DEC-2D-04`.
