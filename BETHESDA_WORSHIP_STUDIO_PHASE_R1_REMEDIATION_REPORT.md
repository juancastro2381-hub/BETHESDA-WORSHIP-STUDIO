# BETHESDA WORSHIP STUDIO — PHASE R1 (P0) REMEDIATION REPORT

**Date:** `2026-11-21`  
**Branch / HEAD:** `feature/phase-1a-core-foundation` @ `315f7d1ef5fc48f7cd1238a1e811af53fb31f227`  
**Final Verdict:** **`CONDITIONAL PASS`** — All code fixes, TypeScript checks, production builds (backend JS emission + frontend Vite bundle), and in-memory security unit tests pass cleanly; owner-controlled live PostgreSQL migration execution and DB-backed integration runs remain pending.

---

## 1. Executive Summary
Executed Phase R1 (P0) remediation targeting the critical migration, authentication, authorization, conversion endpoint security, and backend build/deployment gaps identified in the comprehensive audit (`315f7d1`):
- **R1.1 (Migrations):** Restored missing idempotent migrations `0018_cas_deletion_state_machine` and `0019_cas_deletion_retained_state` into `backend/src/db/migrations/meta/_journal.json` (`idx: 19, 20`) safely after `0020` so both fresh installs and existing databases migrate without table-missing failures in `ConversionWorker`.
- **R1.2 (Login Lockout):** Fixed `DrizzleUserRepository.recordFailedLogin()` and `AuthService.login()`/`refresh()` so 5 failed attempts transition `ACTIVE -> LOCKED` in PostgreSQL, enforce lockout even against valid passwords or prior refresh tokens, recover cleanly when `lockoutUntil` expires, and use a syntactically valid dummy Argon2id hash for unknown-email timing defense.
- **R1.3 (`tokenVersion` & Account Revocation):** Added `tokenVersion` claim to `JwtTokenPayload` / `JwtTokenService.signAccessToken()`, passed authoritative `user.tokenVersion` from `AuthService`, and enforced real-time `tokenVersion` and account status/lockout verification in `AuthGuard.requireAuth` and `AuthGuard.requirePermission(..., true)`.
- **R1.4 & R1.5 (RBAC, Conversion/Ingestion Security & Anti-IDOR):**
  - Enforced DB-verified RBAC guards on all 6 `/api/v1/ingestion/*` endpoints (`songs:create` / `songs:read`) and all 9 `/api/v1/conversion/*` endpoints (`songs:read`, `songs:update_draft`, `songs:create` on catalog commit), eliminating unauthenticated 25 MiB `/conversion/validate` & `/transpile` DoS and blocking `VIEWER`/`MUSICIAN` privilege escalation.
  - Added `conversionRateLimiter` (30 req/min/IP), `authRecoveryRateLimiter` (30 req/min/IP on `/refresh`, `/accept-invite`, `/reset-password`), expired-bucket pruning in `DualRateLimiter`, explicit text/decoded payload byte limits (`rawText <= 5 MiB` chars, `<= 15 MiB` decoded), `Content-Disposition` filename sanitization, and cross-song version IDOR verification in `GET /api/v1/songs/:songId/versions/:versionId`.
- **R1.6 & R1.7 (Backend Build & Shared Core Resolution):**
  - Independent verification confirmed `OutputRetentionService` and `S3CompatibleStorageProvider` already reside inside `backend/src/` (not `frontend/src/core/`). What `backend/src/` imports from `frontend/src/core/` are pure isomorphic musical domain modules (`canonical-model`, `music-theory`, `ingestion`, `conversion`, `projection`, `stand-format-capabilities`, `canonical-metadata-projection`).
  - Added `backend/tsconfig.build.json` (`noEmit: false`, `rewriteRelativeImportExtensions: true`, `outDir: "./dist"`) and updated `backend/package.json` `build` & `start` scripts (`node dist/backend/src/server.js`, copying `src/db/migrations` into `dist/backend/src/db/migrations`), producing a verified runnable ESM JS bundle without destabilizing frontend imports or canonical data.

---

## 2. Files Modified / Added
- `backend/src/db/migrations/meta/_journal.json`
- `backend/src/repositories/user-repository.ts`
- `backend/src/domain/auth-types.ts`
- `backend/src/application/token-service.ts`
- `backend/src/application/auth-service.ts`
- `backend/src/interfaces/http/middlewares/auth-middleware.ts`
- `backend/src/interfaces/http/middlewares/rate-limiter.ts`
- `backend/src/interfaces/http/routes/auth.routes.ts`
- `backend/src/interfaces/http/routes/ingestion.routes.ts`
- `backend/src/interfaces/http/routes/conversion.routes.ts`
- `backend/src/interfaces/http/routes/song.routes.ts`
- `backend/tsconfig.build.json` *(new)*
- `backend/package.json`
- `backend/src/__tests__/phase-r1-security-remediation.test.ts` *(new pure-memory test suite)*

---

## 3. Security Policy & Implications
- **Lockout Policy:** After `5` consecutive invalid logins on an `ACTIVE` account, `accountStatus` transitions to `'LOCKED'` and `lockoutUntil = now + 15 minutes`. Valid credentials, wrong credentials, and refresh-token rotation all reject (`AccountLockedError` / `UnauthorizedError`) while locked. Successful login after `lockoutUntil` expires atomically restores `'ACTIVE'`, clears `lockoutUntil`, and resets `failedLoginAttempts = 0`.
- **Compatibility Impact on Legacy Conversion Tests:** Because `/api/v1/conversion/validate` and `/api/v1/conversion/transpile` now require authentication + RBAC (`songs:read` / `songs:update_draft`) and `/conversion/jobs/:jobId/commit` requires `songs:create` (`WORSHIP_LEADER`/`ADMIN`/`SUPER_ADMIN`), existing DB-backed test files written under the prior open model (`conversion-api.test.ts` and `conversion-security.test.ts`) will require authenticated `WORSHIP_LEADER`/`ADMIN` test users if run against a test database.
- **Architectural Boundary Note on Shared Packages (R1.7):** `tsconfig.build.json` compiles the cross-referenced isomorphic `frontend/src/core/` modules directly into `backend/dist/frontend/src/core/` cleanly with zero duplication. Extracting a formal npm workspace `@bethesda/music-core` package remains an optional clean-up task only if separate Docker container build contexts per package are needed later.

---

## 4. Tests Executed vs. Not Executed

### Executed & Passing (`0` Errors / `0` Failures)
- **TypeScript (`tsc --noEmit`):** Frontend (`0` errors), Backend (`0` errors).
- **Backend Production Build (`npm --prefix backend run build`):** Exit `0`; verified `backend/dist/backend/src/server.js`, `backend/dist/backend/src/db/migrations/0018_cas_deletion_state_machine.sql`, and native Node ESM execution (`DIST_ESM_OK tokenVersion=4`).
- **Frontend Production Build (`npm --prefix frontend run build`):** Exit `0` (`vite build`, `151` modules in `2.48s`).
- **Backend Security & Domain Suites (`npx tsx --test`, 7 suites, 0 DB mutation):** **`63/63` passed across `15` suites**:
  - `phase-r1-security-remediation.test.ts` (all R1.1–R1.5 assertions passing)
  - `argon2-hasher.test.ts` (`7/7`)
  - `audit-sanitizer.test.ts` (`3/3`)
  - `canonical-serializer.test.ts` (`3/3`)
  - `jwt-hs256-security.test.ts` (`7/7`)
  - `rate-limiting-dual-dimension.test.ts` (`4/4`)
  - `setlist-domain-and-schemas.test.ts` (`32/32`)
- **Frontend Affected Shared-Core Suites (`npx tsx --test`, 4 files):** **`40/40` passed across `5` suites** (`format-capabilities`, `musical-workspace`, `scenario-cards-non-destructive`, `stand-format-capabilities`).

### Not Executed (Policy / Infrastructure Boundary)
- Live PostgreSQL migration (`npm --prefix backend run migrate`) and DB-dependent integration suites (`conversion-api.test.ts`, `conversion-security.test.ts`, `auth-flow-and-cookies.test.ts`, etc.) — **NOT EXECUTED** to strictly avoid altering live/local DB state without Project Owner migration authorization.
- Automated browser tests (Playwright/Selenium/Cypress) — excluded by scope.

---

## 5. Remaining Risks & Owner-Controlled Migration Procedure
1. **Live DB Migration Procedure (Owner-Controlled):** Before starting the backend against an existing or fresh PostgreSQL instance, run a backup and execute `npm --prefix backend run migrate` (with `MIGRATION_DATABASE_URL`) so `_journal.json` applies idempotent `0018` and `0019` cleanly.
2. **Audit Remaining Lower-Priority Routes (Outside R1):** Note `document.routes.ts` (`verifyDatabaseRole: false`) and legacy `CreateSongBodySchema` direct `APPROVED` creation belong to subsequent hardening/catalog lifecycle work (Phase R4).

---

## 6. Final Verdict
**`CONDITIONAL PASS`** — All Phase R1 code, security, build, and non-DB test gates are complete and green; final confirmation of live PostgreSQL migration execution and DB integration tests rests with the Project Owner in a disposable test DB environment.
