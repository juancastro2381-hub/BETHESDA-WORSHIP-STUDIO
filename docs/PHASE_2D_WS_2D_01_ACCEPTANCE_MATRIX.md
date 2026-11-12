# BETHESDA WORSHIP STUDIO — PHASE 2D — WS-2D-01
# ACCEPTANCE MATRIX — PWA HARDENING, OFFLINE COLD-BOOT & SECURE SESSION CONTINUITY

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Accepted Phase 2C Baseline:** `570902fa346e0b2d6a681d55e5348b8681a41b29`  
**Approved Phase 2D Preflight Commit:** `1d78ffcbaaba0b76d0c4c37dca4d12978b363d35`  
**Workstream:** `WS-2D-01`  
**Overall Gate Determination:** **CONDITIONAL PASS — MANUAL VALIDATION REQUIRED**

---

## 1. WS-2D-01 FUNCTIONAL & SECURITY ACCEPTANCE MATRIX

| Acceptance ID | Requirement Description | Verification Method | Evidence / Test Reference | Status |
| :--- | :--- | :--- | :--- | :--- |
| **`AC-2D-01.01`** | Upgrade Service Worker shell cache to `bethesda-worship-studio-shell-v2` and purge legacy caches (`v1`) on `activate`. | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 1 (`cleanupLegacyServiceWorkerCaches` & `public/sw.js` static inspection) | **PASS** |
| **`AC-2D-01.02`** | Bundle SMuFL notation font (`public/fonts/Bravura.woff2`) and pre-warm compiled JS/CSS bundles, notation fonts, and UI fonts via `PRECACHE_ASSETS`. | Automated Unit Test + Build Check | `pwa-lifecycle-and-offline-boot.test.ts` — Tests 1, 2, 7; `public/fonts/Bravura.woff2` (`313,348` bytes) | **PASS** |
| **`AC-2D-01.03`** | Strictly reject `/api/` endpoints, non-GET requests, and credentialed query parameters in `PRECACHE_ASSETS` and `isCacheEligible`. | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 3; `service-worker-cache-eligibility.test.ts` — Tests 4, 7, 9 | **PASS** |
| **`AC-2D-01.04`** | Reject unsupported schemes (`chrome-extension:`, `moz-extension:`, `file:`, `data:`, `blob:`, `about:`, `javascript:`) and untrusted origins in `PRECACHE_ASSETS`. | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 4; `service-worker-cache-eligibility.test.ts` — Tests 1, 2 | **PASS** |
| **`AC-2D-01.05`** | Handle non-200 HTTP responses, opaque/error responses, network failures, and cache quota failures safely without crashing. | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 5; `service-worker-cache-eligibility.test.ts` — Tests 5, 6, 8 | **PASS** |
| **`AC-2D-01.06`** | Defer Service Worker update activation (`SKIP_WAITING`) while `loadedSetlist?.status === 'ACTIVE'` or `isMusicStandMode === true`. | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 6 (`ServiceWorkerLifecycleManager.setStageProtectionState`) | **PASS** |
| **`AC-2D-01.07`** | Allow controlled, non-competing `SKIP_WAITING` update activation when neither `ACTIVE` setlist nor `isMusicStandMode` is active, and clean up listeners on `dispose()`. | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 7 (`requestSafeUpdateActivation`, `markUpdateApplied`, `dispose`) | **PASS** |
| **`AC-2D-01.08`** | Persist `OfflineSessionIdentity` containing **only** `{ userId, email, fullName, role, lastAuthenticatedAt }` after valid server authentication (`ACTIVE` & `!mustChangePassword`). | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 8 (`saveOfflineSessionIdentity`) | **PASS** |
| **`AC-2D-01.09`** | Categorically reject any attempt to store or restore access tokens, refresh tokens, passwords, cookies, secrets, JWT values, or extra schema fields in `OfflineSessionIdentity`. | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 9 (`validateOfflineSessionIdentityPayload` & `loadValidOfflineSessionIdentity`) | **PASS** |
| **`AC-2D-01.10`** | Restore offline cold boot / F5 reload within 7-day grace period in strict read-only mode (`isOfflineSession: true`, `isReadOnlyOffline: true`, `canManageUsers: false`, `token: null`), blocking all server mutations and never extending `lastAuthenticatedAt` (**Safeguards A, B, D**). | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 10 (`OfflineAuthLifecycleController.initializeSession` & `assertOnlineServerMutationAllowed`) | **PASS** |
| **`AC-2D-01.11`** | Reject expired `OfflineSessionIdentity` (`>= 7` days) and future-dated timestamps beyond 5-minute clock-skew tolerance (`300,000 ms`) (**Safeguard D**). | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 11 | **PASS** |
| **`AC-2D-01.12`** | Fail closed (`UNAUTHENTICATED`, `user: null`) on corrupted JSON, missing/invalid fields, invalid roles, or pending cleanup tombstone (`bethesda_offline_purge_pending`) (**Safeguard G**). | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 12 | **PASS** |
| **`AC-2D-01.13`** | Enforce shared-device isolation: when User B authenticates on a device with User A's offline identity/data, purge User A's private IndexedDB data and replace `OfflineSessionIdentity` (**Safeguard E**). | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 13; `session-isolation.test.ts` — Tests 1–7 | **PASS** |
| **`AC-2D-01.14`** | Guarantee offline `logout()` succeeds locally without network connectivity, clears `OfflineSessionIdentity`, purges private IndexedDB data, prevents stale async restoration via monotonic `epoch`, and distinguishes `{ localCleared: true, serverRevoked: false }` (**Safeguards E, F**). | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 14 | **PASS** |
| **`AC-2D-01.15`** | Revalidate session against the server on online reconnection (`reconcileOnReconnect`), never silently promote an offline identity on transient network failure, and immediately purge identity + private data on `401`/`403` server revocation (**Safeguard C**). | Automated Unit Test | `pwa-lifecycle-and-offline-boot.test.ts` — Test 15 | **PASS** |
| **`AC-2D-01.16`** | Zero regressions across all existing frontend test suites and strict TypeScript compilation (`tsc --noEmit` & `vite build`). | Automated CLI Execution | `607/607` tests passed across `86` suites; `tsc --noEmit` (`0` errors); `vite build` (`0` errors) | **PASS** |
| **`AC-2D-01.17`** | Physical tablet/mobile device validation (iPadOS Safari/PWA and Android Chrome/PWA) of live Service Worker install, airplane-mode cold boot (`F5`), and read-only badge UI. | Manual Physical Device Test | Section 6 Manual Validation Checklist in `PHASE_2D_WS_2D_01_IMPLEMENTATION_REPORT.md` | **PENDING MANUAL VALIDATION** |

---

## 2. SCOPE BOUNDARY COMPLIANCE MATRIX

| Boundary Rule | Verification | Status |
| :--- | :--- | :--- |
| Only `WS-2D-01` implemented (`WS-2D-02`, `WS-2D-03`, `WS-2D-04` untouched) | Verified via `git status` and `git diff` | **PASS** |
| No database schema or migration changes | Zero files modified in `backend/src/db/` | **PASS** |
| No backend authentication contract changes | Zero files modified in `backend/` | **PASS** |
| No new npm dependencies added | `frontend/package.json` and `package-lock.json` untouched | **PASS** |
| Root and `docs/` markdown deliverables byte-identical | Verified via SHA-256 hash comparison | **PASS** |
