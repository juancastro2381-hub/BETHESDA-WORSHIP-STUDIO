# BETHESDA WORSHIP STUDIO — PHASE R1 SECURITY VALIDATION REPORT

**Date:** `2026-11-21`  
**Scope:** Automated Non-DB Security Suites, Fastify HTTP Guard Injections, Static Checks & Build Validation

---

## 1. Security Scenarios Validated (Executed & Passing)

| Scenario | Expected Behavior | Observed Result | Evidence Source |
|---|---|---|---|
| **Authentication & Brute-Force Lockout** | 5 wrong attempts set `accountStatus = 'LOCKED'` + 15m `lockoutUntil`; 6th attempt with **valid** password rejected (`AccountLockedError`) | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.2`) |
| **Lockout Bypass via Refresh Token** | Prior valid `refreshToken` rejected (`UnauthorizedError`) once account is `LOCKED` or `lockoutUntil > now` | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.2`) |
| **Lockout Expiration Recovery** | Once `lockoutUntil` expires, successful login restores `accountStatus = 'ACTIVE'` & resets `failedLoginAttempts = 0` | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.2`) |
| **Timing Attack Mitigation** | Unknown email evaluates syntactically valid Argon2id dummy hash | **PASS** (verified by code & test) | `auth-service.ts:79-82` |
| **JWT Signature & `alg=none` Rejection** | Only `HS256` accepted; tampered tokens, `alg=none`, `RS256`, expired tokens rejected | **PASS (7/7)** | `jwt-hs256-security.test.ts` |
| **JWT `tokenVersion` Invalidation** | `signAccessToken` emits `tokenVersion`; `incrementTokenVersion()` causes `AuthGuard.requireAuth` to reject old token with `401 Unauthorized` | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.3`) |
| **Suspended / Locked Account Blocking** | `SUSPENDED`/`LOCKED`/`PENDING_INVITATION` accounts fail `AuthGuard` with `403 Forbidden` even before JWT expiry | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.3`) |
| **Unauthenticated Conversion & Ingestion Block** | Anonymous requests to `/conversion/validate`, `/transpile`, `/jobs`, `/ingestion/upload`, `/written-notes`, `/video-url` return `401 Unauthorized` | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.4 & R1.5`) |
| **VIEWER Privilege Escalation Block** | `VIEWER` blocked (`403 Forbidden`) from `/ingestion/*`, `/conversion/transpile`, `/conversion/jobs`, `/conversion/jobs/:id/commit` | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.4 & R1.5`) |
| **MUSICIAN Catalog Publication Block** | `MUSICIAN` blocked (`403 Forbidden`) from `/ingestion/upload` and `/conversion/jobs/:id/commit` (`songs:create` restricted to `WORSHIP_LEADER`/`ADMIN`/`SUPER_ADMIN`) | **PASS** | `phase-r1-security-remediation.test.ts` (`R1.4 & R1.5`) |
| **Dual-Dimension Rate Limiting & Pruning** | Exceeding attempts blocks with `429` + `Retry-After`; expired buckets pruned over threshold | **PASS (4/4 + R1.5b)** | `rate-limiting-dual-dimension.test.ts`, `phase-r1-security-remediation.test.ts` |
| **Build & Deployment Artifacts** | `backend` compiles JS (`dist/backend/src/server.js`) + copies migrations; `frontend` Vite build succeeds | **PASS** | `npm --prefix backend run build`, `npm --prefix frontend run build` |

---

## 2. Static & DB-Dependent Checks Status
- **Verified Statically (Not Executed Against Live DB):**
  - Cross-song version IDOR check `version.songId !== params.songId -> 404` (`song.routes.ts:139-141`).
  - `Content-Disposition` filename quote/CR/LF stripping (`conversion.routes.ts:247,271`).
  - `DualRateLimiter` (`30 req/min/IP`) attached to `/auth/refresh`, `/auth/accept-invite`, `/auth/reset-password`, `/conversion/validate`, `/conversion/transpile`, `/conversion/jobs`.
- **Legacy DB Test Compatibility Note:** Existing integration tests in `backend/src/__tests__/conversion-api.test.ts` and `conversion-security.test.ts` were authored before R1 RBAC enforcement (testing `/validate`/`/transpile` without Bearer tokens and `/jobs/:id/commit` as `MUSICIAN`); they were intentionally **not** run against PostgreSQL during this DB-safe phase and will require updated `WORSHIP_LEADER`/`ADMIN` Bearer fixtures when executed in a disposable CI database.
