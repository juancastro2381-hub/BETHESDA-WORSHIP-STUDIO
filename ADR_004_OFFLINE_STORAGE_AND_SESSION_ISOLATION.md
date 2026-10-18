# Architectural Decision Record: ADR-004 — Offline Persistence, Audio Caching, and Session Isolation (WP-04)

**Status:** APPROVED (Audited & Reconciled within authorized WP-04 scope)  
**Date:** 2026-10-18  
**Scope:** Work Package 04 (WP-04) — PWA Offline  
**Authors:** Bethesda Worship Studio Architecture & Core Engineering  

---

## 1. Context and Problem Statement
Bethesda Worship Studio operates in worship sanctuaries, rehearsal spaces, and churches where network connectivity is intermittent, degraded, or entirely absent. Musicians and worship leaders require dependable, read-only access to songs, chord sheets, interactive notation/scores, and setlists during services and rehearsals.

At the same time, the system enforces multi-tenant liturgical boundaries and role-based access control. In church environments, mobile devices (e.g., shared ministry iPads, sanctuary tablets) are frequently handed off between different worship leaders and musicians. A naive offline caching solution risks leaking confidential or unreleased setlists, songs, and private arrangements to subsequent users of the same device.

Furthermore, Service Worker Cache API strategies that indiscriminately cache API responses (`/api/v1/*`) introduce critical security vulnerabilities:
- Stale authorizations remaining cached indefinitely.
- Token and header leakage in browser cache logs.
- Cross-user cache contamination on shared tablets.

---

## 2. Decision Drivers
1. **Strict Read-Only Guarantee:** Offline users must never be allowed to create or mutate canonical server data. No asynchronous mutation replay queue is permitted.
2. **Device Sharing & Session Isolation:** Logging out must guarantee that private offline material cannot be accessed by a subsequent user of the same device.
3. **Accurate Audio Infrastructure Reality:** Audio delivery must not be claimed as available when the backend lacks audio models, endpoints, and storage.
4. **App Shell vs. Domain Data Separation:** Static assets belong in the Service Worker Cache API; structured liturgical domain data belongs in IndexedDB under user-keyed storage.
5. **Deterministic Integrity:** Payloads must undergo canonical domain validation and cryptographic SHA-256 integrity verification before being marked as offline available.
6. **Enforced 7-Day Grace Period:** Stale material must be actively blocked from viewing or playback after 7 days without server revalidation.

---

## 3. Considered Options

### Option A: Cache API for Everything (Static Shell + Authenticated REST APIs)
- **Description:** Precache Vite bundles and use `Cache-First` or `Stale-While-Revalidate` service worker strategies for `/api/v1/songs/*` and `/api/v1/setlists/*`.
- **Pros:** Minimal client-side database code.
- **Cons:** **CRITICAL SECURITY RISK**. The Service Worker Cache API does not differentiate between authenticated user sessions without complex custom keying. If User A logs out and User B logs in on the same browser, User B's network requests would be intercepted by the Service Worker and served User A's cached HTTP responses. Purging the Cache API on logout is unreliable across background worker threads.

### Option B: LocalStorage / SessionStorage for Offline Data
- **Description:** Serialize all songs and setlists into `localStorage`.
- **Pros:** Synchronous API, simple integration.
- **Cons:** Strictly limited to 5MB storage quota. Complex JSON scores cannot fit. Blocking main thread on parsing large canonical scores.

### Option C: Two-Tier Storage Architecture (IndexedDB + App Shell Cache API + Boot Tombstone Recovery) — **SELECTED**
- **Tier 1 (Service Worker Cache API):** Strictly limited to immutable, unauthenticated static App Shell assets (`/`, `/index.html`, `/manifest.webmanifest`, CSS, JS bundles, icons). **Zero authenticated `/api/v1/*` endpoints are ever cached in Cache API**. Any API request made offline returns a controlled JSON HTTP 503 error.
- **Tier 2 (IndexedDB `bethesda_worship_studio_offline_db`):** Strongly typed local database with 4 isolated object stores (`offline_metadata`, `song_payloads`, `setlist_payloads`, `audio_blobs`). All records are explicitly tagged with `ownerUserId`.
- **Session Purge & Boot Tombstone:** On logout, `BethesdaOfflineManager.purgeSessionData(userId)` purges all stores, revokes in-memory Object URLs, and sets an atomic `bethesda_offline_purge_pending` tombstone in `localStorage` until storage verification confirms 0 lingering records. If an abnormal browser crash or lock occurs, `storage.init()` inspects this tombstone on next boot and resolves the pending purge.

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
- **U-01 (Offline Grace Period):** Fixed at **7 days** (`OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD = 7`). Evaluates `lastValidatedAt || downloadedAt` with clock skew protections. Stale content is actively blocked from view/playback offline, requiring online server revalidation.
- **U-02 (Audio Delivery Status):** Classified as **Outcome C (Blocked)**. The backend contains 0 audio models, tables, routes, or storage providers. Audio download buttons in the UI are disabled and marked blocked. Full audio delivery is blocked pending future backend audio infrastructure.
- **U-03 (Size & Quota Limits):** Single track max **50MB** (`OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES = 50 * 1024 * 1024`). Storage usage capped at 85% of browser quota via `assertStorageQuotaAvailable()`.
- **U-04 (Browser Compatibility):** Target baseline is Chromium >= 100, Safari >= 15.4 (iOS / macOS), and Firefox >= 100.
- **U-05 (Logout Verification Failure):** Double-layer protection with boot recovery. Volatile memory purge + IndexedDB delete + `localStorage` tombstone key (`bethesda_offline_purge_pending`). On subsequent app initialization, `storage.init()` inspects this tombstone and forces a wipe before granting access.

---

## 5. Consequences & Compliance
- **Positive:**
  - Zero cross-user or cross-tenant cache contamination.
  - Immune to stale authentication headers in Service Worker caches.
  - Safe, predictable offline atril operation for musicians.
  - Active blocking of unauthorized content after 7 days without server validation.
  - Full backward compatibility with existing Fastify backend and React workspace.
- **Negative / Trade-offs:**
  - Full audio playback is currently blocked pending backend audio models and streaming endpoints.
  - Initial download requires explicit user action (no silent pre-caching of the entire song catalog).
