# Architectural Decision Record: ADR-004 — Offline Persistence, Audio Caching, and Session Isolation (WP-04)

**Status:** APPROVED (Implemented within authorized WP-04 scope)  
**Date:** 2026-10-16  
**Scope:** Work Package 04 (WP-04) — PWA Offline  
**Authors:** Bethesda Worship Studio Architecture & Core Engineering  

---

## 1. Context and Problem Statement
Bethesda Worship Studio operates in worship sanctuaries, rehearsal spaces, and churches where network connectivity is intermittent, degraded, or entirely absent. Musicians and worship leaders require dependable, read-only access to songs, chord sheets, interactive notation/scores, setlists, and guide audio tracks during services and rehearsals.

At the same time, the system enforces multi-tenant liturgical boundaries and role-based access control. In church environments, mobile devices (e.g., shared ministry iPads, sanctuary tablets) are frequently handed off between different worship leaders and musicians. A naive offline caching solution risks leaking confidential or unreleased setlists, songs, and private arrangements to subsequent users of the same device.

Furthermore, Service Worker Cache API strategies that indiscriminately cache API responses (`/api/v1/*`) introduce critical security vulnerabilities:
- Stale authorizations remaining cached indefinitely.
- Token and header leakage in browser cache logs.
- Cross-user cache contamination on shared tablets.

## 2. Decision Drivers
1. **Strict Read-Only Guarantee:** Offline users must never be allowed to create or mutate canonical server data. No asynchronous mutation replay queue is permitted.
2. **Device Sharing & Session Isolation:** Logging out must guarantee that private offline material cannot be accessed by a subsequent user of the same device.
3. **Audio Support within Browser Realities:** Support single-track reference/guide audio offline without requiring server-side streaming infrastructure or violating copyright/DRM.
4. **App Shell vs. Domain Data Separation:** Static assets belong in the Service Worker Cache API; structured liturgical domain data and binary audio belong in IndexedDB under user-keyed storage.
5. **Deterministic Integrity:** Payloads must undergo canonical domain validation and cryptographic SHA-256 integrity verification before being marked as offline available.

---

## 3. Considered Options

### Option A: Cache API for Everything (Static Shell + Authenticated REST APIs)
- **Description:** Precache Vite bundles and use `Cache-First` or `Stale-While-Revalidate` service worker strategies for `/api/v1/songs/*` and `/api/v1/setlists/*`.
- **Pros:** Minimal client-side database code.
- **Cons:** **CRITICAL SECURITY RISK**. The Service Worker Cache API does not differentiate between authenticated user sessions without complex custom keying. If User A logs out and User B logs in on the same browser, User B's network requests would be intercepted by the Service Worker and served User A's cached HTTP responses. Purging the Cache API on logout is unreliable across background worker threads.

### Option B: LocalStorage / SessionStorage for Offline Data
- **Description:** Serialize all songs and setlists into `localStorage`.
- **Pros:** Synchronous API, simple integration.
- **Cons:** Strictly limited to 5MB storage quota. Audio Blobs and complex JSON scores cannot be stored. Blocking main thread on parsing large canonical scores.

### Option C: Two-Tier Storage Architecture (IndexedDB + App Shell Cache API + Purge Tombstone) — **SELECTED**
- **Tier 1 (Service Worker Cache API):** Strictly limited to immutable, unauthenticated static App Shell assets (`/`, `/index.html`, `/manifest.webmanifest`, CSS, JS bundles, icons). **Zero authenticated `/api/v1/*` endpoints are ever cached in Cache API**. Any API request made offline returns a controlled JSON HTTP 503 error.
- **Tier 2 (IndexedDB `bethesda_worship_studio_offline_db`):** Strongly typed local database with 4 isolated object stores (`offline_metadata`, `song_payloads`, `setlist_payloads`, `audio_blobs`). All records are explicitly tagged with `ownerUserId`.
- **Session Purge & Tombstone:** On logout, `BethesdaOfflineManager.purgeSessionData(userId)` purges all stores, revokes in-memory Object URLs, and sets an atomic `bethesda_offline_purge_pending` tombstone in `localStorage` until storage verification confirms 0 lingering records.

---

## 4. Decision Outcome: Chosen Architecture (Option C)

### 4.1 Storage Schema in IndexedDB
- **Database Name:** `bethesda_worship_studio_offline_db` (Version 1)
- **Stores:**
  1. `offline_metadata`: Key path `id`, indexes on `resourceType`, `ownerUserId`, `status`. Contains size, timestamps, version, SHA-256 hash, and dependency lists.
  2. `song_payloads`: Key path `id`. Stores `OfflineSongPayload` with complete `CanonicalMusicPayloadJSON`, default key, BPM, and time signature.
  3. `setlist_payloads`: Key path `id`. Stores `OfflineSetlistPayload` with full `FrontendSetlistDetail` and sequence items.
  4. `audio_blobs`: Key path `id`. Stores binary `Blob` and MIME type for offline HTML5 audio playback.

### 4.2 Service Worker Invariant
```javascript
// frontend/public/sw.js
// STRICT SECURITY INVARIANT: NEVER cache authenticated /api/v1/ endpoints
if (url.pathname.startsWith('/api/v1/')) {
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response(
        JSON.stringify({
          error: 'OFFLINE_UNAVAILABLE',
          message: 'Sin conexión con el servidor. Bethesda Worship Studio opera en modo offline de solo lectura.',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    })
  );
  return;
}
```

### 4.3 Policy Closures for Unresolved Decisions
- **U-01 (Offline Grace Period):** Fixed at **7 days** (`OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD = 7`). Content older than 7 days without server revalidation is flagged as stale.
- **U-02 (Audio Grouping):** Explicit opt-in. Audio tracks are downloaded individually or selectively with setlists (`options.includeAudio: false` by default). Multitrack stems remain strictly Phase 3C (unauthorized).
- **U-03 (Size & Quota Limits):** Single track max **50MB** (`OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES = 50 * 1024 * 1024`). Storage usage capped at 85% of browser quota.
- **U-04 (Browser Compatibility):** Target baseline is Chromium >= 100, Safari >= 15.4 (iOS / macOS), and Firefox >= 100.
- **U-05 (Logout Verification Failure):** Double-layer protection. Volatile memory purge + IndexedDB delete + `localStorage` tombstone key (`bethesda_offline_purge_pending`). Subsequent app initialization inspects this tombstone and blocks access until purge succeeds.

---

## 5. Consequences & Compliance
- **Positive:**
  - Zero cross-user or cross-tenant cache contamination.
  - Immune to stale authentication headers in Service Worker caches.
  - Safe, predictable offline atril operation for musicians.
  - Full backward compatibility with existing Fastify backend and React workspace.
- **Negative / Trade-offs:**
  - Background audio sync and Lock Screen MediaSession playback are limited on iOS Safari due to Apple WebKit PWA audio lifecycle restrictions.
  - Initial download requires explicit user action (no silent pre-caching of the entire 10,000-song catalog).
