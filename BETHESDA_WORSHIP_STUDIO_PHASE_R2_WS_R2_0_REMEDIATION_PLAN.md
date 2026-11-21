# BETHESDA WORSHIP STUDIO — WS-R2.0 CONTROLLED REMEDIATION PLAN

- **Date:** `2026-11-21`
- **Branch:** `feature/phase-1a-core-foundation` (`origin/feature/phase-1a-core-foundation`, sync `0 0`)
- **Verified HEAD SHA:** `d93534429039c0ad59da9c4fedd8e714f904eed9` (R1 closure: `2ebb0fd1c4b70780e740da60342e07e81a166cdd`)
- **Scope:** Narrowly scoped prerequisite fixes & isolated certification ONLY (`REM-01`–`REM-05` resolving `R2-F18`, `R2-F36`, `R2-F37`, `R2-F38`) — strictly **NO** edits to musical domain (`R2-F01`–`R2-F10`), business API routes, migrations `0000`–`0020`, or `WS-R2.1`–`WS-R2.6` features.
- **Methodology:** Evidence-based surgical remediation plan derived from `BLK-01`–`BLK-04` in [`BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_FINAL_CERTIFICATION_AND_BLOCKERS_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_FINAL_CERTIFICATION_AND_BLOCKERS_REPORT.md), with disposable DB isolation (`bethesda_worship_r2_cert_tmp`), zero test weakening, and manual acceptance matrix.
- **Recommendations & Required Approvals:** Recommend executing `REM-01`–`REM-03` + `REM-05` in isolated disposable DB validation (plus `REM-04` only if `POD-05` approves), gated strictly behind explicit Project Owner sign-off (`PROJECT OWNER REVIEW REQUIRED`).
- **Status:** **`PROPOSED — AWAITING EXPLICIT PROJECT OWNER AUTHORIZATION`** *(ZERO proposed code, SQL, package, or Git changes below have been applied yet.)*

---

## 1. Evidence & Implementation Boundaries

- **Verified Blockers Addressed Here:** `R2-F18` / `BLK-01`, `R2-F36` / `BLK-02`, `R2-F37` / `BLK-03`, `R2-F38` / `BLK-04`.
- **Strictly Out of Scope / Prohibited Without Separate Workstream Authorization:**
  - Zero edits to `frontend/src/core/{music-theory,canonical-model,projection,conversion,rendering,ingestion,tablature}` (`WS-R2.1` / `R2-F01`–`R2-F10`).
  - Zero new SQL migrations (`WS-R2.2` / `WS-R2.3`), zero RBAC/SMTP/S3/Redis architecture changes, zero UI component refactoring (`WS-R2.6`).
  - Zero operations against `bethesda_worship_dev`, `bethesda_worship_test`, or any production database.
  - Zero browser automation (`Playwright`, `Selenium`, `Cypress` excluded).

---

## 2. Proposed Controlled Work Packages (`REM-01` to `REM-05`)

### `REM-01`: Least-Privilege Runtime Role Provisioning & `pgboss` Startup Compatibility
- **Findings Resolved:** `R2-F18`, `BLK-01`.
- **Affected Files:**
  - [`backend/src/db/scripts/provision_app_runtime_role.sql`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/scripts/provision_app_runtime_role.sql)
  - [`backend/src/db/index.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/index.ts#L79-L93)
  - [`backend/src/server.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/server.ts#L18-L40)
  - [`backend/src/infrastructure/queue/conversion-queue.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/infrastructure/queue/conversion-queue.ts#L55-L98)
- **Affected Database Objects (Disposable Cert DB Only First):** Role `bethesda_app_runtime`, `SCHEMA public` (21 tables + sequences), `SCHEMA pgboss`.
- **Risk:** `PgBoss.start()` runs `CREATE SCHEMA/TABLE IF NOT EXISTS` by default unless `pgboss` schema is pre-initialized by migration/DBA step or `migrate: false` is configured; granting excess `CREATE` to runtime role would defeat least privilege.
- **Proposed SQL Remediation (For `provision_app_runtime_role.sql` — NOT Executed Yet):**
```sql
-- Dynamic current database connection (replaces hardcoded bethesda_worship_dev)
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bethesda_app_runtime', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO bethesda_app_runtime;

-- Complete 20 operational tables in public schema (excludes append-only omr_audit_history)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users, refresh_tokens, password_reset_tokens, user_invitations,
  audit_logs, songs, song_versions, song_sources, song_metadata,
  worship_services, setlists, setlist_items, user_view_preferences,
  audio_assets, multitrack_sessions, multitrack_tracks, background_jobs,
  cas_deletion_intents, omr_proposals, omr_proposal_measures
TO bethesda_app_runtime;

-- Strict append-only until WS-R2.2 adds DB immutability triggers on audit_logs & song_versions
REVOKE ALL ON TABLE omr_audit_history FROM PUBLIC, bethesda_app_runtime;
GRANT SELECT, INSERT ON TABLE omr_audit_history TO bethesda_app_runtime;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bethesda_app_runtime;

-- Pre-provisioned pg-boss queue schema (owned by DBA/migration role)
GRANT USAGE ON SCHEMA pgboss TO bethesda_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO bethesda_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO bethesda_app_runtime;
```
- **Proposed Code Patch Summary (NOT Applied Yet):**
  1. In `backend/src/db/index.ts:88`: expand `if (currentRole && (currentRole.rolsuper || currentRole.rolcreaterole || currentRole.rolcreatedb))` and invoke `await assertNonSuperuserRuntimeRole()` in `backend/src/server.ts` right after startup migrations check (before `app.listen`).
  2. In `backend/src/infrastructure/queue/conversion-queue.ts`: pass `migrate: false` to `new PgBoss(...)` when `process.env.PGBOSS_AUTO_MIGRATE === 'false'` (or initialize `PgBoss` schema from DBA migration step so `bethesda_app_runtime` never needs DDL).
- **Required Tests:** Controlled disposable-DB smoke boot as `bethesda_app_runtime` (`NODE_ENV=production`, `/api/v1/health -> 200`) + negative test confirming `assertNonSuperuserRuntimeRole()` throws when connected with elevated privilege.

---

### `REM-02`: Disposable-DB Portability & Execution of Pending Backend Certification Suites
- **Findings Resolved:** `R2-F18` (test part), `R2-F36`, `BLK-02`.
- **Affected Files:**
  - [`backend/src/__tests__/omr-persistence-and-integrity.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/omr-persistence-and-integrity.test.ts#L2540-L2693)
- **Affected Database Objects:** Ephemeral test database `bethesda_worship_r2_cert_tmp` and temporary test role `bethesda_app_test_runtime` (both created and cleanly dropped inside certification window).
- **Proposed Code Patch (`omr-persistence-and-integrity.test.ts:2540-2693` — NOT Applied Yet):**
```ts
// Derive database name & connection URL dynamically from active test connection string
const testDbUrl = new URL(env.TEST_DATABASE_URL || env.DATABASE_URL);
const targetDbName = testDbUrl.pathname.replace(/^\/+/, '');
const ephemeralTestPwd = crypto.randomBytes(16).toString('hex');

// Grant DML on current targetDbName (not hardcoded 'bethesda_worship_test')
// Construct runtimeUrl by cloning testDbUrl with username='bethesda_app_test_runtime', password=ephemeralTestPwd
// Always REVOKE / DROP OWNED / DROP ROLE cleanly in outer finally { ... }
```
- **Controlled Execution Prerequisites & Sequence (After Owner Approval):**
  1. Create fresh disposable database `bethesda_worship_r2_cert_tmp` (`CREATE DATABASE`).
  2. Set `NODE_ENV=test`, `TEST_DATABASE_URL` -> `bethesda_worship_r2_cert_tmp`, `MIGRATION_DATABASE_URL` -> `bethesda_worship_r2_cert_tmp`, keep `DATABASE_URL` separate, set `AUDIO_STORAGE_PATH` -> `%TEMP%\bethesda_r2_cert_audio`.
  3. Run `npx tsx src/db/migrate.ts` against `bethesda_worship_r2_cert_tmp`.
  4. Run individually from clean temp working folder (so `conversion-worker-certification` never litters `<repo>/storage/`):
     - `audio-preservation-and-worker.test.ts` (`40` cases)
     - `conversion-worker-certification.test.ts` (`105` cases)
     - `omr-persistence-and-integrity.test.ts` (`68` cases including `20.1–20.12`)
  5. Drop `bethesda_worship_r2_cert_tmp`, drop temporary test role, and delete `%TEMP%\bethesda_r2_cert_audio`.

---

### `REM-03`: Frontend Test Runner (`tsx`), CWD Path Hygiene & Test `#8` Contract Alignment
- **Findings Resolved:** `R2-F37`, `BLK-03`.
- **Affected Files:**
  - [`frontend/package.json`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/package.json#L9-L24)
  - [`frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/__tests__/autoscroll.test.ts#L261-L335)
  - [`frontend/src/core/rendering/__tests__/browser-rendering-integration.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/__tests__/browser-rendering-integration.test.ts#L362-L380)
- **Risk:** Modifying `frontend/package.json` `devDependencies` (`tsx`) updates workspace lockfile unless using shared root workspace binary; keep change minimal (`"tsx": "^4.19.3"` matching `backend/package.json`). Never delete/weaken assertions.
- **Proposed Patches (NOT Applied Yet):**
  1. `frontend/package.json`: `"test": "tsx --test \"src/core/**/__tests__/**/*.test.ts\""` (plus `tsx` devDependency `"^4.19.3"` matching `backend`).
  2. `autoscroll.test.ts:265,270,326`: replace `process.cwd()` lookups with `fileURLToPath(new URL('../use-autoscroll.ts', import.meta.url))` and `fileURLToPath(new URL('../../../components/workspace/AutoscrollControl.tsx', import.meta.url))`.
  3. `browser-rendering-integration.test.ts:362-380`:
     - Explicitly assert the `b012879` contract: `LYRICS`-only view (`includeChords === false`) yields `res.data.capo === 0` even if `capoFret: 2` is configured.
     - Test Capo 0 -> Capo 2 update on `acoustic_guitar` with `primaryRepresentation: 'CHORDS', secondaryRepresentations: ['LYRICS']` asserting `res1.data.capo === 0` and `res2.data.capo === 2`.
- **Required Validation:** Run `npm --prefix frontend test` from both `frontend/` and repo root (`exit 0`, `628+/628+` passing, `0` failed, `0` skipped) + `npm --prefix frontend run typecheck` (`0` errors).

---

### `REM-04`: Non-Destructive Git Index Hygiene & Storage Cleanup (`POD-05` Gated)
- **Findings Resolved:** `R2-F38`, `BLK-04`.
- **Affected Scope:** Git index (`backend/node_modules/` `7,367` tracked files / `103.8 MB` incl. 4 Windows `.exe`/`.node`), untracked `<repo>/storage/non_existent_cert_dir_404/` and `<repo>/storage/test-symlink-outside/`.
- **Risk:** Any developer pulling the untrack commit must execute `npm --prefix backend ci`; DO NOT run `git filter-repo` or rewrite history; DO NOT delete committed test fixtures (`223` `backend/storage/` / `20` `.zip`) unless reviewed individually.
- **Proposed Safe Sequence (ONLY After `POD-05` Option A1 Approval):**
  1. Record exact pre-cleanup tracked list in scratch backup log.
  2. `git rm -r --cached backend/node_modules` *(untracks from Git index while keeping working tree folder on disk)*.
  3. Clean strictly the verified leaked test artifacts `<repo>/storage/non_existent_cert_dir_404` & `<repo>/storage/test-symlink-outside`.
  4. Verify `npm --prefix backend ci` & `npm --prefix backend run typecheck` & `npm --prefix backend run build` cleanly regenerate binaries from lockfile.

---

### `REM-05`: Manual Acceptance Gate & Formal `WS-R2.0` Closure Documentation
No browser automation tools (`Playwright`, `Selenium`, `Cypress`). Final acceptance of `WS-R2.0` requires passing both automated checks above AND the manual verification matrix:

| Scenario | Preconditions | Steps | Expected Result | Failure Conditions | Evidence to Collect | Responsible Validator | Acceptance Criteria |
|---|---|---|---|---|---|---|---|
| **MV-0.1** Least-Privilege PostgreSQL Boot & Adversarial Trigger Test | `bethesda_worship_r2_cert_tmp` migrated + `REM-01` applied | Boot compiled `backend/dist` with `bethesda_app_runtime` (`NODE_ENV=production`); check `/api/v1/health`; attempt SQL `DELETE FROM omr_audit_history` as runtime role | Server boots & returns `200`; `pg-boss` initializes cleanly; `DELETE` rejected with PG `42501`/`55000`; `68/68` OMR test passes | `42501 permission denied` on business tables or `pgboss`; superuser boot not blocked | Boot log, `curl` `/health` output, PostgreSQL SQL error capture, `omr` test output | DBA / Security Engineer | `0` runtime table errors + `68/68` OMR pass |
| **MV-0.2** Certified Suite & Hygiene Verification | `REM-02`, `REM-03`, (`REM-04` if approved) applied | Run `audio-preservation` (40), `conversion-worker` (105), `test_worker.py` (18), `npm --prefix frontend test` (`629/629`), and verify `git ls-files` | `100%` tests passing (`0` failed, `0` skipped); persistent DBs untouched; zero stray `<repo>/storage/` test dirs created | Any failure, skipped test, or modification to `bethesda_worship_dev`/`test` | Full test logs, `git ls-files` counts, `git status` | QA Lead + Orchestrator | Clean reproducible baseline certified for `WS-R2.1` unlock |

---

## 3. Risks & Rollback Boundaries

- **Rollback Simplicity:** All `WS-R2.0` test/script changes are non-schema-breaking (`REM-01`–`REM-03` revert via standard `git checkout`/`revert`, disposable DB dropped cleanly after validation, `REM-04` index untrack preserves commit history).
- **Hard Stop Gate:** After `WS-R2.0` passes and emits a formal Closure Report, **execution MUST STOP** for explicit Project Owner sign-off before opening `WS-R2.1`.

---

## 4. Project Owner Authorization Block (Required Before Executing `WS-R2.0`)

`[ ] APPROVED — Authorize execution of WS-R2.0 (REM-01, REM-02, REM-03, REM-05; REM-04 subject to POD-05 decision) using disposable DB only. Keep WS-R2.1 through WS-R2.6 STOPPED.`  
`[ ] HOLD / REVISIONS REQUESTED:` \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
**Project Owner Signature / Date:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
