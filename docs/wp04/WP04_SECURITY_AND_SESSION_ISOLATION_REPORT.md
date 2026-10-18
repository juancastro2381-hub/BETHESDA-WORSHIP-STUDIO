# Bethesda Worship Studio — WP-04 Security & Session Isolation Report

**Document Identifier:** `WP04_SECURITY_AND_SESSION_ISOLATION_REPORT.md`  
**Version:** 1.1.0 (Audited & Reconciled)  
**Date:** 2026-10-18  
**Status:** WP-04 CORE COMPLETE — AUDIO BLOCKED  
**Governance Scope:** WP-04 Security, Privacy, and Session Lifecycle Isolation  

---

## 1. Threat Model & Device Sharing Context

Bethesda Worship Studio is deployed in church sanctuaries, rehearsal rooms, and mobile music ministries. In these environments, hardware devices—predominantly iPad tablets, Android slates, and shared desktop workstations—are frequently shared across different members of the worship team (e.g., service directors, lead vocalists, keyboardists, and guest musicians).

This operational reality poses severe security and privacy risks:
1. **Device Hand-Off Exposure:** If User A downloads unreleased arrangements, proprietary church setlists, or pastoral annotations, a subsequent User B picking up the same tablet must not be able to view, play, or extract User A's private material.
2. **Generic Service Worker Cache Poisoning:** If HTTP responses containing authorization headers or private user data are cached indiscriminately by a browser Service Worker, subsequent users or unauthenticated clients could be served those private responses directly from disk.
3. **Partial Storage & Incomplete Cleanup:** If a user logs out while a resource is downloading, the partially downloaded data must not remain in an indeterminate, accessible state.
4. **Token Exfiltration:** Client-side persistence stores (IndexedDB, localStorage) must never store raw session secrets, passwords, or JWT refresh tokens alongside offline musical assets.
5. **Offline Credential Expiry:** Stale offline content must be actively blocked from being viewed or played once the owner-approved grace period expires without online revalidation.

---

## 2. In-Depth Security Scenario Evaluations

### Scenario 1: Two Users Use the Same Device in Succession (T-11)
- **Threat:** User A (Worship Director) signs into an altar tablet, downloads a confidential Sunday setlist. Later, User B (Guest Musician) logs in on the same browser.
- **Mitigation Architecture:**
  - Every downloaded resource in IndexedDB (`bethesda_worship_studio_offline_db`) has an explicit `ownerUserId` foreign-key tag.
  - The logout flow in `auth-context.tsx` invokes `offlineManager.purgeSessionData(currentUserId)` before clearing in-memory auth state and tokens.
  - `purgeSessionData()` systematically deletes all records matching `ownerUserId === currentUserId` or orphan records from `offline_metadata`, `song_payloads`, `setlist_payloads`, and `audio_blobs`.
  - When User B logs in, `manager.getInventory(userB.id)` returns strictly empty results.
- **Automated Verification:** Verified by `session-isolation.test.ts` (Test 2: `should prevent subsequent user on same device from accessing previous user private data`).

### Scenario 2: Logout Occurs While a Download is in Progress (T-12)
- **Threat:** User initiates a download and immediately clicks Logout. The background fetch finishes, writing private data to IndexedDB after the session has nominally closed.
- **Mitigation Architecture:**
  - `BethesdaOfflineManager` maintains an internal map of active `AbortController` instances (`activeAbortControllers`).
  - Upon invoking `purgeSessionData()`, step 1 immediately iterates and aborts every in-flight controller:
    ```typescript
    for (const [id, controller] of this.activeAbortControllers) {
      controller.abort();
    }
    this.activeAbortControllers.clear();
    this.activeProgress.clear();
    ```
  - The fetch stream terminates immediately. The download promise rejects with an abort signal, and no payload or metadata is committed to IndexedDB.
- **Automated Verification:** Verified by `session-isolation.test.ts` (Test 3: `should abort active downloads when logout occurs during download`).

### Scenario 3: Session Expires While Offline (T-13 / Decision U-01)
- **Threat:** A user goes offline for an extended period (e.g., weeks or months) with cached church material while their server access has been revoked or their church account deactivated.
- **Mitigation Architecture:**
  - **Grace Period Policy (U-01):** The maximum offline grace period is strictly **7 days** without server revalidation (`OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD = 7`).
  - **Timestamp Semantics:** Evaluates `lastValidatedAt || downloadedAt`, guaranteeing that the timer resets only upon successful online server revalidation.
  - **Clock Skew Protection:** Detects if the device clock was turned back or jumped forward (> 5 minutes difference) and treats authorization as expired.
  - **Active Content Blocking:** Content is actively blocked from rendering or playback via `offlineManager.getAuthorizedSongPayload(songId)` and `getAudioObjectUrl(audioId)` when offline, throwing `OfflineStorageError('UNAUTHORIZED_SESSION')`. In the UI, stale items display `Expirado (7 días)` and disable opening buttons.
- **Automated Verification:** Verified by `offline-manager.test.ts` (Tests 4 and 5).

### Scenario 4: User Loses Connectivity After Server Permissions Change (T-14)
- **Threat:** An administrator downgrades a user's role from Worship Leader to Viewer while the user is offline.
- **Mitigation Architecture:**
  - When network connectivity returns, `useOffline` triggers `checkForUpdates()`.
  - Individual song loads invoke `getAuthorizedSongPayload()` which revalidates against `GET /api/v1/songs/:id`.
  - If the server returns HTTP 401 Unauthorized or HTTP 403 Forbidden on revalidation, the local cached copy is immediately purged from client storage.
  - Server-side RBAC remains authoritative: having an offline copy does not weaken server authorization.
- **Automated Verification:** Verified by `offline-manager.test.ts` (Test 5 Subtest C).

### Scenario 5: Corrupt or Partially Stored Resources (T-15)
- **Threat:** A network glitch causes an incomplete or corrupted JSON payload or an HTML error page to be returned by the server.
- **Mitigation Architecture:**
  - Before writing to IndexedDB, `downloadSong()` passes the payload through `CanonicalModelValidator.validate(canonical)`.
  - For audio tracks, `downloadAudio()` verifies that `content-type` starts with `audio/`, rejects 0-byte blobs, and enforces the 50MB single-resource cap.
  - If validation fails, `OfflineStorageError('CORRUPTED_RESOURCE')` is raised.
  - Corrupted data is never saved to payload stores. The metadata status is set to `FAILED` with descriptive error details.
- **Automated Verification:** Verified by `offline-manager.test.ts` (Tests 3 and 7).

### Scenario 6: Local Storage Quota Exceeded (T-07 / Decision U-03)
- **Threat:** Downloading numerous assets exhausts browser disk storage, causing unexpected IndexedDB write aborts and corrupting other application stores.
- **Mitigation Architecture:**
  - **Pre-download Size Check:** Single files larger than 50MB (`OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES`) are immediately rejected.
  - **Quota Guard:** `assertStorageQuotaAvailable()` queries `navigator.storage.estimate()`. If projected usage exceeds 85% capacity (`MAX_STORAGE_QUOTA_USAGE_RATIO = 0.85`), new downloads are rejected with `STORAGE_QUOTA_EXCEEDED`.
- **Automated Verification:** Verified by `offline-manager.test.ts` (Tests 6 and 8).

### Scenario 7: Generic Service Worker Cache Poisoning (T-16)
- **Threat:** A standard PWA service worker with `stale-while-revalidate` or `cache-first` captures `/api/v1/users/me`, `/api/v1/songs`, or signed URLs in the browser Cache API.
- **Mitigation Architecture:**
  - `frontend/public/sw.js` strictly isolates routes:
    ```javascript
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
  - Authenticated API responses are **never written to the Cache API**.
  - No authorization tokens (`Bearer ...`) or user profiles are ever cached in Service Worker storage.
- **Verification:** Verified by Static Code Review of `frontend/public/sw.js`.

### Scenario 8: Storage Cleanup Fails Partially (Decision U-05)
- **Threat:** An abrupt browser process termination or storage lock during logout prevents IndexedDB from completing its deletion transaction.
- **Mitigation Architecture:**
  - **Tombstone Strategy (U-05):** Before executing the delete transactions, `purgeSessionData()` writes an atomic tombstone to `localStorage`:
    ```typescript
    localStorage.setItem(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY, userId);
    ```
  - After deleting records, the manager performs a post-deletion audit: `storage.listMetadata(userId)`.
  - Only if the audit confirms 0 lingering records for `userId` is the tombstone removed.
  - **Boot Recovery:** `BethesdaOfflineStorage.init()` invokes `recoverPendingCleanupTombstone()`. On next application startup, if the tombstone key exists, storage immediately executes a preventive wipe of that user's data and verifies zero remnants before removing the tombstone.
- **Automated Verification:** Verified by `session-isolation.test.ts` (Tests 4 and 6).

---

## 3. Data Protection & Privacy Auditing

### 3.1 Credential & Token Invariant
- **No Passwords or Tokens in Storage:** Neither access tokens, refresh tokens, nor user passwords are ever written to IndexedDB.
- **No Complete Signed URLs Persisted:** Audio blobs are persisted exclusively as raw binary `Blob` data inside IndexedDB. Temporary presigned URLs are discarded immediately after the download stream finishes.

### 3.2 Logging Cleanliness
- Console logging in `offline-manager.ts` and `indexeddb-storage.ts` logs only high-level status messages and IDs. Zero musical contents, chords, lyrics, tokens, or signed URLs are emitted to browser console logs.

---

## 4. Residual Risks & Environmental Mitigations

| Residual Risk | Severity | Environmental Factor | Implemented Mitigation |
| :--- | :---: | :--- | :--- |
| **Physical Forensic Extraction** | Low | Attacker with physical unlocked access to hardware disk examining raw SQLite/LevelDB files | Standard browser storage APIs (IndexedDB, localStorage) do not guarantee physical/forensic erasure beyond logical deletion. Hardware device encryption (BitLocker, FileVault, iOS Data Protection) and biometric passcode policies provide the physical security layer. |
| **iOS WebKit Storage Eviction** | Medium | Safari aggressively evicting IndexedDB if device storage is critically low (< 1GB free) | Documented in `ADR_004`. Users are advised to verify available device storage before Sunday services. |
| **Missing Backend Audio Infrastructure** | High (Operational) | Users expecting audio tracks when backend lacks audio support | Audio Outcome C confirmed: Audio downloads explicitly disabled in UI; T-05 and T-06 classified as BLOCKED. |
