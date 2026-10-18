# WP-04 Revocation Read-Path Audit & Minimal Remediation Report
**Bethesda Worship Studio — PWA Offline Subsystem (WP-04)**  
**Repository:** [https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO](https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO)  
**Target Branch:** `main`  
**Date:** 2026-10-18  
**Task Type:** Narrow Security Audit, Confirmed Defect Remediation, Regression Suite, and Evidence

---

## 1. Executive Conclusion
### **DEFECT CONFIRMED AND FIXED**

The security audit confirmed a critical authorization gap in the WP-04 offline read path:
1. **Unpurged Local Payload on Revocation/Removal:** When `BethesdaOfflineManager.checkForUpdates()` received an explicit HTTP 401/403 (revoked access) or HTTP 404 (resource removed from server), it marked the metadata record as `FAILED`, but **failed to delete the canonical payload from the `song_payloads` IndexedDB object store**.
2. **Bypass of FAILED Status in Read Path:** `BethesdaOfflineManager.getAuthorizedSongPayload(songId)` checked authorization validity solely via `this.isAuthorizationExpired(payload.metadata)`. If the cached resource had a timestamp within the approved 7-day grace period, the method completely bypassed the `FAILED` status check and returned the full canonical payload to the caller.
3. **UI / Atril Digital Exposure:** Neither `MusicalWorkspace.tsx` nor `DatabaseSongsModal.tsx` performed an independent check on metadata status; both relied on `getAuthorizedSongPayload()`. Consequently, revoked or removed songs were rendered and opened in the digital atril even after `checkForUpdates()` confirmed revocation. Additionally, `OfflineInventoryModal.tsx` left action buttons (`📖 Abrir`, `📋 Cargar`, `▶️ Reproducir`) enabled for `FAILED` items whose timestamp was within the 7-day window.

**Remediation:** The defect was resolved via a minimal, centralized WP-04 correction:
- In `offline-manager.ts`:
  - `checkForUpdates()` now calls `await this.storage.deleteSongPayload(local.id)` upon receiving 401, 403, or 404, marks metadata `FAILED`, and calls helper `updateSetlistsMissingSong(local.id)` to update dependent setlists.
  - `getAuthorizedSongPayload()` and `getAudioObjectUrl()` now explicitly inspect both metadata store and payload status, throwing `OfflineStorageError('UNAUTHORIZED_SESSION')` unconditionally if status is `FAILED`, regardless of timestamp freshness.
- In `OfflineInventoryModal.tsx`:
  - Action buttons (`Abrir`, `Cargar`, `Play`) are now disabled if `item.status === 'FAILED'`.
  - The UI displays a distinct `Revocado / Error` status badge with the revocation reason.

---

## 2. Baseline and Final HEAD SHAs
- **Baseline SHA Requested in Prompt:** `6c31f5722c081062180b1c4ee6d40c8d5c6346cf`
- **Observed Repository HEAD at Start of Task:** `4448a9ab8d19b17df46b351da60d671d37aae84b`
  - *Context:* The repository HEAD was at `4448a9ab8d19b17df46b351da60d671d37aae84b` on branch `main` as a result of the project owner committing the prior targeted remediation. In compliance with governance instructions, this discrepancy was halted and submitted to the project owner via interactive prompt. The owner explicitly instructed to proceed on current HEAD commit `4448a9ab8d19b17df46b351da60d671d37aae84b`.
- **Final Repository HEAD:** `4448a9ab8d19b17df46b351da60d671d37aae84b`
- **Confirmation:** The repository HEAD remained completely unchanged (`4448a9ab8d19b17df46b351da60d671d37aae84b`). **Zero git commits, zero git pushes, zero deployments, and zero staging (`git add`) were executed.**

---

## 3. Detailed Audit Questions & Source Path Analysis

### Question 1: When `checkForUpdates()` receives 401/403 for a song present in the catalog, does it mark the metadata FAILED, delete the local payload, or both?
- **File Reference:** [offline-manager.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts#L805-L835)
- **Before Fix:** Only marked metadata `FAILED`.
  ```ts
  // Code prior to remediation in checkForUpdates():
  } catch (err: any) {
    if (err?.statusCode === 401 || err?.statusCode === 403) {
      await this.storage.saveMetadata({
        ...local,
        status: 'FAILED',
        errorMessage: `Autorización revocada por el servidor (${err.statusCode}).`,
      });
      revokedCount++;
    }
  }
  ```
  The payload in IndexedDB `song_payloads` remained intact in storage.
- **After Fix:** Both deletes the local payload and marks metadata `FAILED`, plus flags dependent setlists:
  ```ts
  if (err?.statusCode === 401 || err?.statusCode === 403) {
    await this.storage.deleteSongPayload(local.id);
    await this.storage.saveMetadata({
      ...local,
      status: 'FAILED',
      errorMessage: `Autorización revocada por el servidor (${err.statusCode}).`,
    });
    await this.updateSetlistsMissingSong(local.id);
    revokedCount++;
  }
  ```

### Question 2: When a locally cached song is absent from the complete catalog and a targeted `getSong(id)` returns 404/401/403, what happens to metadata and payload?
- **File Reference:** [offline-manager.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts#L855-L885)
- **Before Fix:** When a local song was absent from the exhaustive catalog and `this.apiClient.getSong(local.id)` threw a 404, 401, or 403 error, the code only called `this.storage.saveMetadata({ ...local, status: 'FAILED', ... })`. The payload in `song_payloads` was left untouched.
- **After Fix:** Both deletes the local payload and marks metadata `FAILED`, plus flags dependent setlists:
  ```ts
  if (err?.statusCode === 404 || err?.statusCode === 401 || err?.statusCode === 403) {
    await this.storage.deleteSongPayload(local.id);
    await this.storage.saveMetadata({
      ...local,
      status: 'FAILED',
      errorMessage: `Autorización revocada o recurso retirado del servidor (${err.statusCode}).`,
    });
    await this.updateSetlistsMissingSong(local.id);
    revokedCount++;
  }
  ```

### Question 3: Can any ordinary read path return a payload after its metadata is FAILED? Does the renderer independently reject it?
- **File References:**
  - [offline-manager.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts#L670-L720) (`getAuthorizedSongPayload`)
  - [MusicalWorkspace.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L173-L205)
  - [DatabaseSongsModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/DatabaseSongsModal.tsx#L80-L95)
  - [OfflineInventoryModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/offline/OfflineInventoryModal.tsx#L320-L375)
- **Before Fix:**
  - **YES, ordinary read paths returned the payload.**
  - `getAuthorizedSongPayload(songId)` loaded the payload from storage and checked `this.isAuthorizationExpired(payload.metadata)`. It contained **no check** for `payload.metadata.status === 'FAILED'` or `meta.status === 'FAILED'`.
  - In `MusicalWorkspace.tsx` (lines 175-188):
    ```ts
    offlineManager.getAuthorizedSongPayload(songId).then((localPayload) => {
      if (localPayload) {
        const canonical = CanonicalMusicPayload.fromJSON(localPayload.canonicalPayload);
        selectPersistedSong(canonical, ...);
        return;
      }
      ...
    });
    ```
    The workspace renderer accepted whatever `localPayload` was returned and rendered the score. It had zero status validation.
  - In `DatabaseSongsModal.tsx` (lines 82-90):
    ```ts
    const localSong = await offlineManager.getAuthorizedSongPayload(songId);
    if (localSong) {
      const canonical = CanonicalMusicPayload.fromJSON(localSong.canonicalPayload);
      onSelectSong(canonical, ...);
      onClose();
      return;
    }
    ```
    Similarly rendered the revoked score directly.
  - In `OfflineInventoryModal.tsx`: buttons had `disabled={offlineManager.isAuthorizationExpired(item) && !isOnline}`, allowing users to click `📖 Abrir` on `FAILED` items whose timestamp was fresh.
- **After Fix:**
  - `getAuthorizedSongPayload()` actively checks both `storage.getMetadata(songId)` and `payload.metadata.status`. If status is `FAILED`, it throws `OfflineStorageError('UNAUTHORIZED_SESSION')`.
  - In addition, because `deleteSongPayload()` purges the record from `song_payloads`, `getSongPayload()` returns `null`.
  - `OfflineInventoryModal.tsx` disables action buttons when `item.status === 'FAILED'`.

### Question 4: Does `getAuthorizedSongPayload()` reject a FAILED status when the seven-day timestamp is still fresh, or does it only evaluate the timestamp?
- **File Reference:** [offline-manager.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts#L670-L690)
- **Before Fix:** It only evaluated the timestamp via `this.isAuthorizationExpired(payload.metadata)`. A fresh timestamp (< 7 days old) skipped the expiration branch and directly returned `payload`, completely ignoring that metadata had been set to `FAILED`.
- **After Fix:** It checks `meta.status === 'FAILED'` and `payload.metadata.status === 'FAILED'` BEFORE evaluating timestamp expiration:
  ```ts
  const meta = await this.storage.getMetadata(songId);
  if (meta && meta.status === 'FAILED') {
    throw new OfflineStorageError(
      'UNAUTHORIZED_SESSION',
      `El acceso a la canción '${meta.title}' fue revocado por el servidor o no está disponible.`
    );
  }

  const payload = await this.storage.getSongPayload(songId);
  if (!payload) return null;

  if (payload.metadata.status === 'FAILED') {
    throw new OfflineStorageError(
      'UNAUTHORIZED_SESSION',
      `El acceso a la canción '${payload.metadata.title}' fue revocado por el servidor o no está disponible.`
    );
  }
  ```

### Question 5: Could deleting a revoked song accidentally delete a different user's resource, a shared/unowned resource, or unrelated setlist dependencies?
- **Analysis:**
  - **Single-Resource Scoping:** `this.storage.deleteSongPayload(id)` targets strictly the primary key `id` (the song's unique UUID). It cannot match or delete any other record in `song_payloads` or `metadata`.
  - **Cross-User & Unowned Safety:** Songs belonging to Bob (`ownerUserId: 'user_bob'`) or unowned public domain hymns (`ownerUserId: null`) have distinct UUIDs. Deleting Alice's revoked song ID does not alter or purge Bob's records or unowned records. This was verified and proven in regression test 17.
  - **Setlist Integrity:** Revoking a song does NOT delete dependent setlists. Instead, `updateSetlistsMissingSong(songId)` queries setlists that list `songId` in their `associatedSongIds` and appends `songId` to `missingSongIds`. The setlist remains intact and available, but alerts the director that the repertoire is incomplete for offline execution.

### Question 6: What is the correct product/security behavior for explicit revocation versus temporary network failure, and is that behavior consistent across all read paths?
- **Product & Security Specification:**
  - **Explicit Revocation / Removal (HTTP 401, 403, 404):**
    - The server has affirmatively stated that access is denied or the content has been withdrawn.
    - Local cached payload MUST be deleted immediately from `song_payloads`.
    - Local metadata status MUST transition to `FAILED` with a descriptive error message.
    - Dependent setlists MUST have `missingSongIds` updated.
    - All read paths (`getAuthorizedSongPayload`, `getAudioObjectUrl`, digital atril, workspace, inventory modal) MUST reject reading/rendering the resource unconditionally (`UNAUTHORIZED_SESSION`).
  - **Temporary Network Failure / Server 5xx:**
    - The server could not be reached or experienced an internal error. This is NOT a revocation.
    - The local copy MUST remain intact with status `AVAILABLE_OFFLINE`.
    - The `lastValidatedAt` authorization timestamp MUST NOT be extended (preventing unauthorized prolongation of the 7-day grace period).
    - If the current timestamp is still within the 7-day grace period, the user may continue to read/render the content offline. If beyond 7 days, access is blocked until connectivity is restored.

---

## 4. Root Cause and Minimal Remediation

### Root Cause
1. `checkForUpdates()` in `offline-manager.ts` treated revocation as a metadata status change (`saveMetadata({ ...local, status: 'FAILED' })`) without invoking `storage.deleteSongPayload(local.id)` to purge the cached binary/score payload.
2. `getAuthorizedSongPayload()` in `offline-manager.ts` assumed any payload retrieved from storage was authorized as long as its timestamp was within 7 days, omitting a status guard against `FAILED` records.
3. `OfflineInventoryModal.tsx` evaluated button disabled states based only on `isAuthorizationExpired(item) && !isOnline`, omitting `item.status === 'FAILED'`.

### Minimal Remediation Implemented
1. **Helper Method `updateSetlistsMissingSong(songId)`:**
   Added to `offline-manager.ts` to locate cached setlists referencing `songId` and append it to `missingSongIds` upon revocation.
2. **Payload Purging in `checkForUpdates()`:**
   Updated catch blocks for 401/403 (catalog check) and 404/401/403 (targeted verification) to execute `await this.storage.deleteSongPayload(local.id)` and `await this.updateSetlistsMissingSong(local.id)`.
3. **Defense-in-Depth Status Guards in Read Paths:**
   - In `getAuthorizedSongPayload()`: Checks `storage.getMetadata(songId)` and `payload.metadata.status`. Throws `OfflineStorageError('UNAUTHORIZED_SESSION')` if status is `FAILED`.
   - In `getAudioObjectUrl()`: Checks `storage.getMetadata(audioId)` and `record.metadata.status`. Throws `OfflineStorageError('UNAUTHORIZED_SESSION')` if status is `FAILED`.
4. **UI Button Gating in `OfflineInventoryModal.tsx`:**
   Updated `disabled` condition for `AUDIO`, `SONG`, and `SETLIST` action buttons to include `item.status === 'FAILED' || ...`. Added a dedicated `Revocado / Error` badge in the item row.

---

## 5. Regression Tests Added

File: [offline-manager.test.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/__tests__/offline-manager.test.ts#L641-L984)

| Test # | Description & Invariants Proven |
| :--- | :--- |
| **Test 14** | **401/403 Revocation in `checkForUpdates()`:** Confirms that when the server returns 403 Forbidden for a catalog song, `song_payloads` cached record is deleted (`null`), metadata transitions to `FAILED`, `getAuthorizedSongPayload()` rejects with `UNAUTHORIZED_SESSION` even though `lastValidatedAt` is only 1 hour old (< 7 days), and dependent setlist has `missingSongIds` updated. |
| **Test 15** | **404 Removal in `checkForUpdates()`:** Confirms that when an absent song is targeted and server returns 404 Not Found, payload is purged from `song_payloads`, status becomes `FAILED`, and read path rejects access despite fresh timestamp. |
| **Test 16** | **FAILED Status Guard with Fresh Timestamp:** Confirms that if a song record has `status === 'FAILED'` and client is offline with a 1-hour-old timestamp, `getAuthorizedSongPayload()` rejects with `UNAUTHORIZED_SESSION` instead of serving the payload. |
| **Test 17** | **Cross-User & Unowned Isolation:** Confirms that revoking Alice's song does NOT delete Bob's song or unowned public domain songs (`ownerUserId === null`), preserving their payloads, metadata, and authorized read paths. |

---

## 6. Verification Protocol & Execution Results

All checks were executed in non-browser environments. Zero browser/E2E tests were run.

| Check | Working Directory | Command Executed | Exit Code | Outcome Summary |
| :--- | :--- | :--- | :--- | :--- |
| **WP-04 Offline Unit Tests** | `frontend/` | `node --test --experimental-strip-types "src/core/offline/__tests__/*.test.ts"` | **0** | **35 passed, 0 failed** across 4 test suites. |
| **Full Frontend Test Suite** | `frontend/` | `npm test` | **0** | **316 passed, 0 failed** across 49 test suites. |
| **Frontend TypeScript Check** | `frontend/` | `npm run typecheck` | **0** | `tsc --noEmit` exited cleanly with zero errors. |
| **Frontend Production Build** | `frontend/` | `npm run build` | **0** | Vite v8.3.0 bundle generated successfully in `dist/`. |
| **Git Diff Format Check** | Repository root | `git diff --check` | **0** | Clean, zero trailing whitespace or formatting defects. |
| **Changed Files Check** | Repository root | `git diff --name-only` | **0** | Exactly 3 files modified in working tree (all within WP-04). |
| **Git Status Check** | Repository root | `git status --short` | **0** | Zero staged files, zero untracked files outside WP-04. |

---

## 7. Files Changed and Scope Justification

| File Path | Scope Justification |
| :--- | :--- |
| [offline-manager.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts) | **WP-04 Core Engine:** Added `deleteSongPayload()` calls upon revocation/removal in `checkForUpdates()`, added helper `updateSetlistsMissingSong()`, and added status checks in `getAuthorizedSongPayload()` and `getAudioObjectUrl()`. |
| [OfflineInventoryModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/offline/OfflineInventoryModal.tsx) | **WP-04 UI Component:** Disabled action buttons (`Abrir`, `Cargar`, `Play`) for items in `FAILED` status and rendered `Revocado / Error` badge. |
| [offline-manager.test.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/__tests__/offline-manager.test.ts) | **WP-04 Test Suite:** Added regression tests 14, 15, 16, and 17 proving revocation purging, read-path guards, and cross-user isolation. |
| [WP04_REVOCATION_READ_PATH_AUDIT_REPORT.md](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/wp04/WP04_REVOCATION_READ_PATH_AUDIT_REPORT.md) | **WP-04 Documentation Deliverable:** Detailed evidence and findings report required by governance. |

---

## 8. Remaining Limitations & Unresolved Uncertainty
- **IndexedDB Metadata Tombstone on Revocation:** When a song is revoked, its binary payload is deleted from `song_payloads`, but its record in `metadata` is intentionally retained in status `FAILED` with an explanatory error message (`errorMessage`). This informs the user in the offline inventory that the item was revoked by the server rather than simply disappearing without reason. If the user desires to purge the metadata tombstone as well, they can use the `Eliminar` button in the UI.
- **Client Offline During Revocation:** If a client never connects to the internet, revocation events issued on the server cannot reach the client until either: (a) the client goes online and `checkForUpdates()` executes, or (b) the 7-day offline grace period expires and forces server revalidation. This is the intended and mathematically bounded property of the approved 7-day offline policy.

---

## 9. Mandatory Governance Statements
1. **Pending Project-Owner Acceptance:** WP-04 is **NOT formally accepted** by this report. Formal acceptance of WP-04 remains pending and can only be granted by the project owner.
2. **Audio Remains Blocked:** Audio functionality remains strictly blocked (Outcome C). No audio backend, download pipeline, or streaming playback infrastructure was added.
3. **No Deployment or Version Control Operations:** No git commits, no git pushes, no git staging (`git add`), and no deployments were executed during this task.
