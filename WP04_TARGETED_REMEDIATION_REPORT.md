# Bethesda Worship Studio — WP-04 Targeted Remediation Report: PWA Offline
## Authorization and Evidence Integrity — No Commit / No Push / No Deployment

**Document Identifier:** `WP04_TARGETED_REMEDIATION_REPORT.md`  
**Version:** 1.0.0  
**Date:** 2026-10-18  
**Task Type:** Targeted audit, minimal corrective implementation, regression tests, and documentation reconciliation  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`  
**Branch:** `main`  
**Initial HEAD Commit SHA:** `6c31f5722c081062180b1c4ee6d40c8d5c6346cf`  
**Final HEAD Commit SHA:** `6c31f5722c081062180b1c4ee6d40c8d5c6346cf` *(Strictly Unchanged)*  
**Working-Tree Status:** Modified files strictly bounded to WP-04 codebase, tests, and documentation  
**Governance Scope:** WP-04 (PWA Offline) Authorized Only. Strictly No Git Commit, No Git Push, No Deployment, No Staging (`git add`), No WP-05, No Phase 3B, and No Phase 3C Work.  
**Formal Acceptance Notice:** WP-04 is NOT formally accepted until the project owner reviews this evidence and approves the remaining scope. Formal acceptance is exclusively reserved for the project owner.

---

## 1. Executive Summary

This report documents the targeted audit and corrective remediation of three specific defect findings (Findings A, B, and C) identified within the **WP-04 PWA Offline** subsystem of Bethesda Worship Studio.

Each finding was investigated against the active codebase, reproduced through architectural reasoning, and resolved using minimal, surgical corrections strictly within the WP-04 scope. All corrective implementations are accompanied by comprehensive regression tests, full test execution verification, typechecks, and production bundle validation.

| Finding | Topic | Audit Status | Resolution Status |
| :--- | :--- | :---: | :---: |
| **Finding A** | Revalidation timestamp consistency between payload and metadata stores | **CONFIRMED** | **REMEDIATED & VERIFIED** |
| **Finding B** | Session cleanup deleting `ownerUserId === null` records & tombstone trapping | **CONFIRMED** | **REMEDIATED & VERIFIED** |
| **Finding C** | Catalog pagination truncation, hardcoded versioning, & false revocation | **CONFIRMED** | **REMEDIATED & VERIFIED** |
| **Audio Gate** | Backend audio delivery path & authorization audit | **CONFIRMED BLOCKED** | **PRESERVED BLOCKED (Outcome C)** |

---

## 2. Baseline & Working-Tree Integrity

- **Target Branch:** `main`
- **Initial HEAD Commit:** `6c31f5722c081062180b1c4ee6d40c8d5c6346cf`
- **Final HEAD Commit:** `6c31f5722c081062180b1c4ee6d40c8d5c6346cf`
- **Git Commit Action:** **NONE** (No commit was created).
- **Git Push Action:** **NONE** (No push was performed).
- **Deployment Action:** **NONE** (No build was published or deployed).
- **Working Tree Initial Status:** Clean (0 modified files, 0 untracked files).
- **Working Tree Final Status:** Only files within WP-04 scope and documentation modified:
  - `frontend/src/core/offline/storage/indexeddb-storage.ts`
  - `frontend/src/core/offline/offline-manager.ts`
  - `frontend/src/core/offline/__tests__/indexeddb-storage.test.ts`
  - `frontend/src/core/offline/__tests__/offline-manager.test.ts`
  - `frontend/src/core/offline/__tests__/session-isolation.test.ts`
  - `docs/wp04/WP04_TARGETED_REMEDIATION_REPORT.md` (and root mirror)
  - `docs/wp04/WP04_CLOSURE_AUDIT_AND_REMEDIATION_REPORT.md` (and root mirror)

---

## 3. Targeted Audit Findings & Remediation

### 3.1 Finding A — Revalidation Timestamp Consistency

#### Concern Audited:
In `frontend/src/core/offline/offline-manager.ts`, `getAuthorizedSongPayload()` updated `lastValidatedAt` by calling `this.storage.saveMetadata(updatedMeta)`, but did not update the stored song payload in `STORES.SONG_PAYLOADS`. In `frontend/src/core/offline/storage/indexeddb-storage.ts`, `getSongPayload()` returned the raw record without synchronizing with `getMetadata(id)`. Consequently, subsequent offline reads retrieved stale embedded metadata and falsely rejected valid songs as expired immediately after successful online revalidation.

#### Audit Outcome:
**CONFIRMED.** Prior implementation persisted `updatedMeta` only to `STORES.METADATA`. `STORES.SONG_PAYLOADS` retained the expired `lastValidatedAt`, which caused subsequent offline reads to evaluate the stale timestamp.

#### Root Cause:
Bifurcated storage model between resource metadata and payload wrappers without a synchronization join on read or bidirectional persistence on revalidation.

#### Minimal Fix Implemented:
1. **Bidirectional Persistence:** In `getAuthorizedSongPayload()`, updated to call `await this.storage.saveSongPayload(updatedPayload)`. This persists the updated `lastValidatedAt` in both `STORES.METADATA` and `STORES.SONG_PAYLOADS`.
2. **Canonical Metadata Synchronization on Read:** In `BethesdaOfflineStorage`, updated `getSongPayload(id)`, `getSetlistPayload(id)`, and `getAudioRecord(id)` to query `this.getMetadata(id)` and overlay `latestMeta` onto the returned payload object.
3. **Transient Error Invariant:** Transient server/network failures reject with `UNAUTHORIZED_SESSION` without touching `lastValidatedAt` or extending the grace period.

#### Regression Tests Added:
- Enhanced Test 5 in `offline-manager.test.ts`:
  - Verified expired song revalidation updates timestamp in the canonical persisted representation by reading directly from storage (`await storage.getSongPayload(...)` and `await storage.getMetadata(...)`).
  - Verified subsequent offline read succeeds within the renewed 7-day grace period.
  - Verified offline read is rejected after the renewed grace period expires.
  - Verified HTTP 401/403 revokes access and purges resource from both storage stores.
  - Verified transient server error (500) does not refresh authorization or extend timestamp.

---

### 3.2 Finding B — Session Cleanup and `ownerUserId === null`

#### Concern Audited:
In `frontend/src/core/offline/storage/indexeddb-storage.ts`, `purgeUserData(userId)` purged items where `item.ownerUserId === userId || item.ownerUserId === null`. This deleted shared, public, or unowned resources whenever any identified user logged out. Additionally, `recoverPendingCleanupTombstone()` filtered remaining records with `m.ownerUserId === tombstonedUserId || m.ownerUserId === null`, trapping the tombstone permanently in `localStorage` whenever null-owned resources existed. Furthermore, `deleteResource(id)` aborted early if metadata was absent, leaving orphaned payloads in `song_payloads`.

#### Audit Outcome:
**CONFIRMED.** A per-user logout broadened into a global purge of null-owned items, and tombstone recovery was permanently stuck if public items existed.

#### Root Cause:
1. Overly broad ownership predicate in `purgeUserData`.
2. Incorrect inclusion of `ownerUserId === null` in the tombstone verification filter.
3. Early abort in `deleteResource(id)` if metadata record was missing.

#### Minimal Fix Implemented:
1. **Strict User Scope in `purgeUserData`:**
   Changed deletion condition to strictly `if (item.ownerUserId === userId)`. Resources with `ownerUserId === null` are strictly preserved during single-user logout.
2. **Strict Verification in `recoverPendingCleanupTombstone`:**
   Changed remaining check to `(m) => m.ownerUserId === tombstonedUserId`. Only records belonging to the tombstoned user block tombstone removal.
3. **Unconditional Orphan Payload Cleanup in `deleteResource`:**
   When metadata is missing, `deleteResource(id)` unconditionally calls `deleteSongPayload(id)`, `deleteSetlistPayload(id)`, and `deleteAudioRecord(id)` to prevent orphaned payloads.

#### Regression Tests Added:
- Updated Test 6 and added Test 8 in `indexeddb-storage.test.ts`:
  - Verified `purgeUserData('user_alice')` purges Alice's resource while strictly preserving Bob's resource AND unowned (`ownerUserId === null`) resources.
  - Verified `deleteResource('orphan_song')` deletes orphaned payloads across all stores even when metadata is absent.
- Added Test 7 in `session-isolation.test.ts`:
  - End-to-end multi-user isolation scenario with Alice, Bob, and unowned resources.
  - Verified Alice logout purges Alice data, preserves Bob data, and preserves unowned data.
  - Verified tombstone recovery cleans only Alice data, preserves Bob/unowned data, and clears tombstone.
  - Verified failure during cleanup preserves the tombstone in `localStorage`.

---

### 3.3 Finding C — Catalog Pagination, Version Detection, and False Revocation

#### Concern Audited:
In `frontend/src/core/offline/offline-manager.ts`, `checkForUpdates()` called `listSongs({ limit: 100 })` and classified any local song absent from the response as revoked (`FAILED`). Local songs beyond page 1 (> 100 items) were falsely revoked. Additionally, `serverMap.set(s.id, 1)` hardcoded version `1` instead of comparing real server version numbers.

#### Audit Outcome:
**CONFIRMED.** Single-page query truncated catalogs > 100 items, versions were not compared, and absence from a partial list was incorrectly treated as revocation.

#### Root Cause:
Lack of catalog pagination loop, hardcoded version dummy values, and lack of targeted check before declaring revocation.

#### Minimal Fix Implemented:
1. **Exhaustive Pagination:** Implemented `while (true)` loop with `{ limit: 100, offset }` until `offset >= page.total` or returned page is empty, setting `catalogIsComplete = true`.
2. **Real Version Number Comparison:** For songs present in `serverMap`, queries `apiClient.getSong(local.id)` and compares `serverSong.version.versionNumber > local.versionNumber`. If newer, marks `UPDATE_AVAILABLE`. If current or older, updates `lastValidatedAt` without marking failed.
3. **Targeted Verification Guard:** If `catalogIsComplete === true` and a local song is absent from the catalog, performs a targeted check `apiClient.getSong(local.id)`. Only marks `FAILED` with revoked status if the server returns explicit HTTP 404 (removed) or 401/403 (revoked).
4. **Transient Error Safety:** If catalog fetching is incomplete (`!catalogIsComplete`) or if network/server errors occur, local songs are NEVER marked revoked, and valid copies are preserved.

#### Regression Tests Added:
- Added Tests 10, 11, 12, 13 in `offline-manager.test.ts`:
  - Test 10: Song at index 120 (page 2 of 150 items) is paginated and NOT falsely revoked.
  - Test 11: Real newer server version (`versionNumber: 2` vs `1`) is detected and marked `UPDATE_AVAILABLE`.
  - Test 12: Genuine server removal (404 / 401 / 403) marks status `FAILED` and increments `revokedCount`.
  - Test 13: Incomplete catalog response or network error does not revoke local resources or extend authorization timestamp; previous valid local copy is preserved.

---

## 4. Audio Gate Status — Outcome C (Preserved Blocked)

An exhaustive audit of the backend and storage infrastructure re-confirmed:
- **Backend Models:** 0 audio models exist in `backend/src/domain/`.
- **Database Schema:** 0 audio tables or audio columns exist in Drizzle schema and PostgreSQL migrations.
- **Fastify Routes:** 0 audio delivery, streaming, or download endpoints exist in `backend/src/interfaces/http/routes/`.
- **Storage Providers:** No S3, Cloudflare R2, MinIO, or local static audio directories are configured.
- **UI State:** Audio download controls remain explicitly disabled (`🚫 Audio Bloqueado`) with informational notices in `OfflineStoragePanel.tsx`.

**Governance Decision:** Audio acceptance criteria remain strictly **`BLOCKED`** (Outcome C). No synthetic URLs or mocks are accepted as real product delivery paths. Backend audio delivery requires a separate, dedicated work package.

---

## 5. Verification Protocol & Execution Evidence

All verification checks were executed locally and captured with exact commands, working directories, and exit codes.

### 5.1 Verification Commands and Results

| # | Check | Working Directory | Command | Exit Code | Result | Summary |
| :-: | :--- | :--- | :--- | :-: | :---: | :--- |
| 1 | Focused WP-04 Offline Suite | `frontend` | `node --test --experimental-strip-types "src/core/offline/__tests__/*.test.ts"` | `0` | **PASS — AUTOMATED** | 31 tests passed across 4 suites (0 failed) |
| 2 | Frontend Full Test Suite | `frontend` | `npm test` | `0` | **PASS — AUTOMATED** | 312 tests passed across 49 suites (0 failed) |
| 3 | Frontend TypeScript Check | `frontend` | `npm run typecheck` | `0` | **PASS — AUTOMATED** | `tsc --noEmit` clean, 0 type errors |
| 4 | Frontend Production Build | `frontend` | `npm run build` | `0` | **PASS — AUTOMATED** | Vite v8.3.0 bundle built successfully in 1.56s |
| 5 | Backend TypeScript Check | `backend` | `npm run typecheck` | `0` | **PASS — AUTOMATED** | `tsc --noEmit` clean, 0 type errors |
| 6 | Backend Full Test Suite | `backend` | `npm test` | `0` | **PASS — AUTOMATED** | 221 tests passed across 53 suites (0 failed) |
| 7 | Scope Boundary & Diff Review | Root | `git diff --name-only` | `0` | **PASS — STATIC REVIEW** | Exactly 5 code/test files modified, all within WP-04 |

---

## 6. Updated Acceptance Matrix

*Permitted Status Vocabulary: `PASS — AUTOMATED`, `PASS — MANUAL`, `PASS — STATIC REVIEW`, `BLOCKED`, `NOT RUN`, `FAIL`.*

| ID | Criterion | Verification Type | Status | Evidence / Notes |
| :--- | :--- | :--- | :---: | :--- |
| **T-01** | PWA Shell & Service Worker Installation | Automated & Static | **PASS — AUTOMATED** | Manifest configured, precaching verified in build |
| **T-02** | Read-Only Offline Invariant | Automated | **PASS — AUTOMATED** | Invariant throws error on write attempts offline |
| **T-03** | IndexedDB Storage & Quota (85% Limit) | Automated | **PASS — AUTOMATED** | CRUD, quota estimation, and quota guard verified |
| **T-04** | Canonical Song Packaging & Integrity Checksum | Automated | **PASS — AUTOMATED** | Canonical validator and SHA-256 verified |
| **T-05** | Setlist Packaging & Dependency Tracking | Automated | **PASS — AUTOMATED** | Setlist packaging with missing song detection verified |
| **T-06** | 7-Day Grace Period Authorization Enforcement | Automated | **PASS — AUTOMATED** | 7-day cutoff and client clock skew protection verified |
| **T-07** | Finding A: Revalidation Timestamp Consistency | Automated | **PASS — AUTOMATED** | Storage read-back & subsequent offline reads verified |
| **T-08** | Finding B: Session Cleanup & Unowned Data Preservation | Automated | **PASS — AUTOMATED** | Strict user filtering, orphan payload cleanup, tombstone verified |
| **T-09** | Finding C: Catalog Pagination & Safe Revocation | Automated | **PASS — AUTOMATED** | Multi-page pagination, version comparison, 404 guard verified |
| **T-10** | Audio Download & Storage (Outcome C) | Static Review | **BLOCKED** | Blocked: No backend audio route or storage provider exists |
| **T-11** | Shared Device Protection & Tombstone Recovery | Automated | **PASS — AUTOMATED** | Boot-time recovery and lockup resilience verified |
| **T-12** | In-flight Download Abort on Logout | Automated | **PASS — AUTOMATED** | AbortController cancellation verified on logout |

---

## 7. Residual Risks & Technical Debt

1. **Audio Infrastructure Prerequisite (BLOCKED):** Offline audio playback and storage remain blocked until a dedicated work package implements audio file storage (S3/R2/MinIO), database models, authenticated streaming endpoints, and rights verification.
2. **Client-Side Clock Skew Protection:** A heuristic protects against backward clock tampering (> 5 minutes). Complete defense against advanced clock tampering would require an online challenge-response token from the server.
3. **Storage Quota Eviction:** Modern browsers may evict IndexedDB data under extreme storage pressure. The storage manager requests persistent storage when available (`navigator.storage.persist()`), but eviction remains subject to host OS policies.

---

## 8. Changed Files List

All modifications are strictly bounded to the authorized WP-04 scope:

```text
frontend/src/core/offline/storage/indexeddb-storage.ts  (Finding A, Finding B)
frontend/src/core/offline/offline-manager.ts            (Finding A, Finding C)
frontend/src/core/offline/__tests__/indexeddb-storage.test.ts  (Finding B regression tests)
frontend/src/core/offline/__tests__/offline-manager.test.ts    (Finding A & C regression tests)
frontend/src/core/offline/__tests__/session-isolation.test.ts  (Finding B regression tests)
docs/wp04/WP04_TARGETED_REMEDIATION_REPORT.md           (Deliverable report)
WP04_TARGETED_REMEDIATION_REPORT.md                     (Root mirror)
docs/wp04/WP04_CLOSURE_AUDIT_AND_REMEDIATION_REPORT.md  (Reconciled closure audit)
WP04_CLOSURE_AUDIT_AND_REMEDIATION_REPORT.md            (Root mirror)
```

---

## 9. Governance and Acceptance Declaration

1. **No Commit, No Push, No Deployment:**  
   In strict accordance with project owner instructions, **no Git commit was created, no code was pushed to any remote repository, and no deployment was triggered or executed.**
2. **Scope Boundaries:**  
   No work on WP-05 (Autoscroll & Pedal Sync), Phase 3B (Realtime Liturgical Flow), Phase 3C (Multitracks & OMR), or any other phase was initiated or performed.
3. **Formal Owner Acceptance Reserved:**  
   WP-04 is **not formally accepted** until the project owner reviews the evidence presented in this report and formally accepts the scope and remaining blockers. Formal acceptance authority remains solely with the project owner.
