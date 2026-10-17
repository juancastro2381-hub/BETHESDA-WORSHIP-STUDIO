# Bethesda Worship Studio — WP-04 Security & Session Isolation Report

**Document Identifier:** `WP04_SECURITY_AND_SESSION_ISOLATION_REPORT.md`  
**Version:** 1.0.0  
**Date:** 2026-10-16  
**Status:** COMPLETE & AUDITED  
**Governance Scope:** WP-04 Security, Privacy, and Session Lifecycle Isolation  

---

## 1. Threat Model & Device Sharing Context

Bethesda Worship Studio is deployed in church sanctuaries, rehearsal rooms, and mobile music ministries. In these environments, hardware devices—predominantly iPad tablets, Android slates, and shared desktop workstations—are frequently shared across different members of the worship team (e.g., service directors, lead vocalists, keyboardists, and guest musicians).

This operational reality poses severe security and privacy risks:
1. **Device Hand-Off Exposure:** If User A downloads unreleased arrangements, proprietary church setlists, or pastoral annotations, a subsequent User B picking up the same tablet must not be able to view, play, or extract User A's private material.
2. **Generic Service Worker Cache Poisoning:** If HTTP responses containing authorization headers or private user data are cached indiscriminately by a browser Service Worker, subsequent users or unauthenticated clients could be served those private responses directly from disk.
3. **Partial Storage & Incomplete Cleanup:** If a user logs out while a 50MB audio track or large canonical score is downloading, the partially downloaded data must not remain in an indeterminate, accessible state.
4. **Token Exfiltration:** Client-side persistence stores (IndexedDB, localStorage) must never store raw session secrets, passwords, or JWT refresh tokens alongside offline musical assets.

---

## 2. In-Depth Security Scenario Evaluations

### Scenario 1: Two Users Use the Same Device in Succession (T-11)
- **Threat:** User A (Worship Director) signs into an altar tablet, downloads a confidential Sunday setlist and audio stems. Later, User B (Guest Musician) logs in on the same browser.
- **Mitigation Architecture:**
  - Every downloaded resource in IndexedDB (`bethesda_worship_studio_offline_db`) has an explicit `ownerUserId` foreign-key tag.
  - The logout flow in `auth-context.tsx` invokes `offlineManager.purgeSessionData(currentUserId)` before clearing in-memory auth state and tokens.
  - `purgeSessionData()` systematically deletes all records matching `ownerUserId === currentUserId` from `offline_metadata`, `song_payloads`, `setlist_payloads`, and `audio_blobs`.
  - When User B logs in, `manager.getInventory(userB.id)` returns strictly empty results.
- **Automated Verification:** Verified by `session-isolation.test.ts` (Test 2: `should prevent subsequent user on same device from accessing previous user private data`).

### Scenario 2: Logout Occurs While a Download is in Progress (T-12)
- **Threat:** User initiates a 45MB audio download and immediately clicks Logout. The background fetch finishes, writing the private audio to IndexedDB after the session has nominally closed.
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
  - **Grace Period Policy (U-01):** The maximum offline grace period is strictly **7 days** (`OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD = 7`).
  - `offlineManager.isAuthorizationExpired(metadata)` checks whether `(Date.now() - downloadedAt) > 7 days`.
  - Once expired, the UI flags the resource as stale / expired and requires network reconnection to revalidate permissions against the server.
- **Automated Verification:** Verified by `offline-manager.test.ts` (Test 4: `should enforce 7-day grace period expiration policy`).

### Scenario 4: User Loses Connectivity After Server Permissions Change (T-14)
- **Threat:** An administrator downgrades a user's role from Worship Leader to Viewer while the user is offline.
- **Mitigation Architecture:**
  - When network connectivity returns, `useOffline` automatically triggers `checkForUpdates()`.
  - If the server returns HTTP 403 Forbidden on revalidation, the local cached copy is marked expired and purged from client storage.
  - Server-side RBAC remains authoritative: having an offline copy does not weaken server authorization.

### Scenario 5: Corrupt or Partially Stored Resources (T-15)
- **Threat:** A network glitch causes an incomplete or corrupted JSON payload to be returned by the server.
- **Mitigation Architecture:**
  - Before writing to IndexedDB, `downloadSong()` passes the payload through `CanonicalModelValidator.validate(canonical)`.
  - If validation fails, `OfflineStorageError('CORRUPTED_RESOURCE')` is raised.
  - The corrupted payload is never saved to `song_payloads`. The metadata status is set to `FAILED` with the exact validation error message.
- **Automated Verification:** Verified by `offline-manager.test.ts` (Test 3: `should reject corrupted/invalid canonical song and mark status as FAILED`).

### Scenario 6: Local Storage Quota Exceeded (T-07 / Decision U-03)
- **Threat:** Downloading numerous audio tracks exhausts browser disk storage, causing unexpected IndexedDB write aborts and corrupting other application stores.
- **Mitigation Architecture:**
  - **Pre-download Size Check:** Single files larger than 50MB (`OFFLINE_POLICIES.MAX_SINGLE_RESOURCE_SIZE_BYTES`) are immediately rejected.
  - **Quota Guard:** If browser storage quota exceeds 85% capacity (`MAX_STORAGE_QUOTA_USAGE_RATIO`), new downloads are prevented with a descriptive warning.
- **Automated Verification:** Verified by `offline-manager.test.ts` (Test 5: `should enforce 50MB single-track audio size quota`).

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

### Scenario 8: Storage Cleanup Fails Partially (Decision U-05)
- **Threat:** An abrupt browser process termination or storage lock during logout prevents IndexedDB from completing its deletion transaction.
- **Mitigation Architecture:**
  - **Tombstone Strategy (U-05):** Before executing the delete transactions, `purgeSessionData()` writes an atomic tombstone to `localStorage`:
    ```typescript
    localStorage.setItem(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY, userId);
    ```
  - After deleting records, the manager performs a post-deletion audit: `storage.listMetadata(userId)`.
  - Only if the audit confirms 0 lingering records for `userId` is the tombstone removed.
  - If cleanup fails or the browser crashed midway, the tombstone remains. On next startup, `BethesdaOfflineStorage.init()` detects the lingering tombstone, blocks access to the data, and completes the purge.
- **Automated Verification:** Verified by `session-isolation.test.ts` (Test 4: `should maintain tombstone in localStorage if cleanup fails unexpectedly`).

---

## 3. Data Protection & Privacy Auditing

### 3.1 Credential & Token Invariant
- **No Passwords or Tokens in Storage:** Neither access tokens, refresh tokens, nor user passwords are ever written to IndexedDB.
- **No Complete Signed URLs Persisted:** Audio tracks are persisted exclusively as raw binary `Blob` data inside IndexedDB. Temporary presigned URLs are discarded immediately after the download stream finishes.

### 3.2 Logging Cleanliness
- Console logging in `offline-manager.ts` and `indexeddb-storage.ts` logs only high-level status messages and IDs. Zero musical contents, chords, lyrics, tokens, or signed URLs are emitted to browser console logs.

---

## 4. Residual Risks & Environmental Mitigations

| Residual Risk | Severity | Environmental Factor | Implemented Mitigation |
| :--- | :---: | :--- | :--- |
| **Physical Device Extraction via DevTools** | Low | Attacker with physical unlocked access to device opening Chrome DevTools | All musical data is stored in standard IndexedDB. Physical device security (passcode, biometric lock, MDM profiles) remains required for high-security ministry devices. |
| **iOS WebKit Storage Eviction** | Medium | Safari aggressively evicting IndexedDB if device storage is critically low (< 1GB free) | Documented in `ADR_004`. Users are advised to verify available device storage before Sunday services. |
| **Tampering with Local Storage Tombstone** | Low | Malicious user opening DevTools and clearing localStorage | If localStorage is wiped, IndexedDB still requires the user's active authenticated session `ownerUserId` to index and read records. |
