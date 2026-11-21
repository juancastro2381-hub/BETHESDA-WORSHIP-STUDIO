# BETHESDA WORSHIP STUDIO — PHASE R2 WS-R2.0 PREREQUISITE CERTIFICATION REPORT

- **Certification Date:** `2026-11-21`
- **Repository / Branch:** `BETHESDA WORSHIP STUDIO` / `feature/phase-1a-core-foundation` (`origin/feature/phase-1a-core-foundation`, sync `0 0`)
- **Current HEAD SHA:** `83fbe26a7c019fbd8e58265256afa18a3065d259` (parent: R1 closure `2ebb0fd1c4b70780e740da60342e07e81a166cdd`)
- **Execution Mode:** Strictly read-only repository audit + non-destructive, isolated local verification ONLY (no source, schema, role DDL, dependency, `.gitignore`, or Git index changes were made; zero PostgreSQL suites were executed)
- **`WS-R2.0` Certification Verdict:** **`CONDITIONAL PASS — OWNER DECISIONS & ISOLATED PG CERTIFICATION REQUIRED`**

---

## 1. Exact Baseline Verification

- `git rev-parse --abbrev-ref HEAD`: `feature/phase-1a-core-foundation`
- `git rev-parse HEAD`: `83fbe26a7c019fbd8e58265256afa18a3065d259`
- Commit log chain verified intact:
  - `83fbe26a7c019fbd8e58265256afa18a3065d259` — `Informe Ejecutivo de Evaluación y Preparación para Fase R2` (`2026-11-21 15:28:32 -0500`) — `git show --stat` confirms **strictly 3 Phase R2 Markdown files (`795 insertions(+)`)**.
  - `2ebb0fd1c4b70780e740da60342e07e81a166cdd` — Formal Phase R1 closure (`2026-11-21 14:44:37 -0500`).
- Pre-report working tree: completely clean (`git status --porcelain=v1` and `git diff --stat` both empty).

---

## 2. Repository Integrity Verification

- Closed Phase R1 artifacts, migrations (`0000`–`0020`, `_journal.json`), security middlewares ([`auth-middleware.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/middlewares/auth-middleware.ts), [`rate-limiter.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/middlewares/rate-limiter.ts), route guards), and production build scripts remain identical to R1 closure `2ebb0fd1`.
- Tracked `.env*` inspection returned **only** `['.env.example', 'backend/.env.example']` (no real `.env` committed).
- Tracked non-`node_modules` `*/dist/*` artifacts returned `[]` (neither `backend/dist/` nor `frontend/dist/` is tracked).
- TypeScript static integrity passed cleanly on both packages (`npm --prefix backend run typecheck` exit `0`; `npm --prefix frontend run typecheck` exit `0`).

---

## 3. Pending Certification Suites Matrix (Section 6.1)

| Suite / File | Size & Cases | Dependencies & External Services | PG DB Required? | Destructive Behavior / Target DB Risk | Priv. Creds? | Temp Infra & Safe Isolation Strategy |
|---|---|---|---|---|---|---|
| **1. `backend/src/__tests__/audio-preservation-and-worker.test.ts`** | `4,055` lines (`~40` `it` tests across Criteria 1–23) | Node `tsx`, Drizzle `pg` pool (`db/index.ts`), [`PythonAudioWorkerBridge`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts), `workers/audio_worker/.venv` + `imageio-ffmpeg` | **YES** (`env.TEST_DATABASE_URL`, checks `areDatabaseTargetsEquivalent(TEST_DATABASE_URL, DATABASE_URL)` at `L206-240`) | Executes `DELETE FROM audit_logs`, `songs`, `users` (`L274,511,532,535`); writes audio files to `env.AUDIO_STORAGE_PATH` & `os.tmpdir()` (`L179,420,766,1070`). **Dangerous** if pointed at dev/prod DB; refuses equal URLs. | No superuser DDL needed for test SQL (`L945` is string test), **but** needs clean migrated test DB | Safe **ONLY** with dedicated disposable PG (`bethesda_worship_r2_cert_tmp`), `NODE_ENV=test`, isolated temp `AUDIO_STORAGE_PATH`, and `.venv` active (`PYTHON_BIN`) |
| **2. `backend/src/__tests__/conversion-worker-certification.test.ts`** | `3,270` lines (`5` `describe`, `105` tests across WS01–WS04) | Node `tsx`, `db` & `pool` (`db/index.ts`), `pg-boss` v12 (`ConversionWorker`), mocks `fs.promises.unlink` (`L3233-3253`) | **YES** (`db/index.ts` selects `TEST_DATABASE_URL` when `NODE_ENV=test`) | Creates `process.cwd()/storage/test-cert-r221` & `storage/non_existent_cert_dir_404` (`L55-59,3067-3072`) + cleans `rmSync`; runs `pg-boss` queues/jobs/leases in DB. Explained why `<repo>/storage/non_existent_cert_dir_404` leaked when run from root/interrupted. | No DBA DDL, **but** relies on `db` permissions for tables + `pgboss` schema creation | Safe **ONLY** with dedicated disposable PG (`NODE_ENV=test`), executing from temp/cleaned `storage` root so `<repo>/storage/` is cleaned afterwards |
| **3. `workers/audio_worker/tests/test_worker.py`** | `294` lines (`18` pytest cases) | Python `3.14.2`, `pytest 9.2.0`, `numpy`, `pydantic`, `imageio-ffmpeg` bundled FFmpeg | **NO** | **Non-destructive (`VERIFIED`):** uses pytest `tmp_path` exclusively (`L72,91,104,183,206,237,267`); zero DB, zero network, zero repo writes | **NO** | **Already safely executable in isolation** — executed live in this session: **`18/18` PASSED** (`21.71s`) |
| **4. `backend/src/__tests__/omr-persistence-and-integrity.test.ts`** | `2,916` lines (`68` tests; role test `20.1–20.12` at [`L2540-2693`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/omr-persistence-and-integrity.test.ts#L2540-L2693)) | Node `tsx`, Drizzle `db` + dedicated `pg.Pool` (`L2586`) | **YES** | **Critical Finding:** Tests `20.1–20.12` execute `CREATE/ALTER ROLE bethesda_app_test_runtime`, `GRANT`, `REVOKE`, `DELETE`/`TRUNCATE` probes, **AND hardcode database name `bethesda_worship_test`** (`L2556`, `L2586`) while test fixtures (`propId`/`userId`) insert into `TEST_DATABASE_URL`! | **YES — requires DBA/superuser privilege** on `db` pool to execute `CREATE ROLE` / `REVOKE` | **Currently BROKEN against disposable DBs** (`R2-F18` / `R2-F36`) until `L2556` & `L2586` dynamically read the target `TEST_DATABASE_URL` DB name |

---

## 4. Environment & Isolation Requirements for Pending Backend Suites

To certify Suites 1, 2, and 4 safely during `WS-R2.0` execution without touching persistent dev/test/prod data:
1. Provision a blank, disposable PostgreSQL database (`bethesda_worship_r2_cert_tmp`), separate from `bethesda_worship_dev` and `bethesda_worship_test`.
2. Export `NODE_ENV=test`, `TEST_DATABASE_URL` pointing strictly to `bethesda_worship_r2_cert_tmp`, `MIGRATION_DATABASE_URL` pointing strictly to `bethesda_worship_r2_cert_tmp`, and keep `DATABASE_URL` pointing elsewhere so `areDatabaseTargetsEquivalent()` fails safe if misconfigured.
3. Isolate `AUDIO_STORAGE_PATH` inside OS temp directory (`%TEMP%\bethesda_r2_cert_audio`) rather than mutating `<repo>/backend/storage/`.
4. Apply all 21 migrations via `npx tsx src/db/migrate.ts` against the disposable DB, execute suites sequentially (`--test-concurrency=1`), drop the disposable DB + temp runtime role afterwards, and remove temp storage folders.

---

## 5. Restricted PostgreSQL Role Certification Plan (Section 6.2)

### Independent Audit Findings on Current Provisioning & Runtime Checks
Inspection of [`backend/src/db/scripts/provision_app_runtime_role.sql`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/scripts/provision_app_runtime_role.sql#L1-L75) and [`backend/src/db/index.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/index.ts#L79-L93) confirmed **4 concrete blockers** (`R2-F18`):
1. **Hardcoded database name (`provision_app_runtime_role.sql:45`):** `GRANT CONNECT ON DATABASE bethesda_worship_dev TO bethesda_app_runtime;` fails when run against staging/production/disposable DBs.
2. **Incomplete table coverage (`L49-67`):** Grants privileges on only **10 of 21 public tables** (9 business tables + `omr_audit_history`), omitting **11 critical runtime tables** (`refresh_tokens`, `password_reset_tokens`, `user_invitations`, `audit_logs`, `song_sources`, `song_metadata`, `worship_services`, `setlists`, `setlist_items`, `user_view_preferences`, `cas_deletion_intents`) **plus** the entire `pgboss` queue schema (`pg-boss` v12 requires table creation or pre-provisioned DML in `pgboss`).
3. **Hardcoded test DB mismatch in [`omr-persistence-and-integrity.test.ts:2556,2586`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/omr-persistence-and-integrity.test.ts#L2556-L2586):** Explains why Phase R1 (`bethesda_worship_r1_gate_tmp`) could not certify `20.1–20.12` even aside from superuser context.
4. **Uncalled & partial runtime check (`db/index.ts:79-93`):** `assertNonSuperuserRuntimeRole()` has **zero callers** in `server.ts` or `app.ts`, and `L88` checks `if (currentRole && currentRole.rolsuper)` only — ignoring `rolcreaterole` and `rolcreatedb` even though `L83` explicitly queries them!

### Manual / Disposable-DB Certification Procedure (Do NOT Run Against Prod/Dev)
Once `WS-R2.0` remediation is authorized:
1. Parameterize `provision_app_runtime_role.sql` (target DB via `current_database()`, grant DML across all 21 public tables + pre-provisioned `pgboss` schema, keep `SELECT, INSERT` only on `omr_audit_history` and later `audit_logs`/`song_versions`).
2. Update `omr-persistence-and-integrity.test.ts:2556,2586` to derive target database and host/port dynamically from `TEST_DATABASE_URL`.
3. On disposable DB `bethesda_worship_r2_cert_tmp`, run migrations as DBA, execute parameterized provisioning script, run `omr-persistence-and-integrity.test.ts` (`68/68` expected), and perform a live server smoke boot with `NODE_ENV=production` + restricted `bethesda_app_runtime` connection verifying `/health` `200`, login, song fetch, conversion enqueue, and SQL `42501` rejection on direct `DELETE FROM omr_audit_history`.
4. Drop temporary role and disposable database upon completion.

---

## 6. Frontend Test Discrepancies Analysis (Section 6.3)

Live execution in this session reproduced both Node `v24.12.0` strip-types behavior (`npm --prefix frontend test`) and `tsx` runner behavior:

| Test File & Case | Node `v24.12.0` (`--experimental-strip-types`) | `tsx --test` (`backend/node_modules/.bin/tsx.cmd`) | Exact Diagnosis & Honest Classification |
|---|---|---|---|
| `src/core/workspace/__tests__/musical-completeness-remediation.test.ts` (`4` tests) | **FAIL** (top-level import of `AudioPlayerBar.tsx`: `ERR_UNKNOWN_FILE_EXTENSION ".tsx"`) | **4/4 PASS** (`26.19ms`) | **Environment / Runner Incompatibility (`VERIFIED`)** — Node `--experimental-strip-types` cannot transpile JSX in `.tsx` imports; code and assertions pass cleanly under `tsx`. |
| `src/core/workspace/__tests__/scenario-cards-non-destructive.test.ts` (`3` tests) | **FAIL** (imports `ScenarioPresets.tsx`, `MusicalControls.tsx`: `ERR_UNKNOWN_FILE_EXTENSION ".tsx"`) | **3/3 PASS** (`33.41ms`) | **Environment / Runner Incompatibility (`VERIFIED`)** — Same root cause; passes under `tsx`. |
| `src/core/autoscroll/__tests__/autoscroll.test.ts` (Case `#10` at `L337-340`) | **FAIL** on `#10` (`ERR_UNKNOWN_FILE_EXTENSION ".tsx"` importing `AutoscrollControl.tsx`; `#1–9` PASS) | `#10` **PASS** (`87.46ms`); `#8–9` failed when `cwd != frontend/` | **Dual Finding (`VERIFIED`):** (1) `#10` fails due to Node strip-types lack of `.tsx` JSX support; (2) `#8–9` (`L265, L326`) use relative `readFileSync('src/core/autoscroll/use-autoscroll.ts')` anchored to `process.cwd()` instead of `import.meta.url` — a **Test Configuration Fragility** when invoked from monorepo root. |
| `src/core/rendering/__tests__/browser-rendering-integration.test.ts` (Case `#8` at `L362-378`) | **FAIL** (`AssertionError: 0 !== 2`) | **FAIL** (`AssertionError: 0 !== 2`) | **Real Test-vs-Contract Drift (`VERIFIED`)** — Commit `b012879` intentionally changed `LeadSheetDomAdapter.convertViewToData` (`leadsheet-dom-adapter.ts:119,221`) to output `capo: 0` when `includeChords === false` (`LYRICS_ONLY`), while test `#8` still passes `'LYRICS'` without `'CHORDS'` on `lead_vocal` and asserts `capo === 2`. **Resolution rule:** update test #8 to assert `'CHORDS' + 'LYRICS'` (`capo === 2`) AND add a distinct regression test confirming `LYRICS_ONLY` preserves `capo === 0`. |

- **Critical Structural Test Gap Confirmed:** `0` automated test files exist under `frontend/src/components/` (`0/35` UI files directly DOM-tested), explaining why `VisualDocumentStand:313`, shortcut collisions, mobile bar overlap, and offline loop failures remained undetected.

---

## 7. Storage & Git Hygiene Inventory (Section 6.4)

| Category | Count / Tracked State | Exact Size on Disk | `.gitignore` Coverage | Observation |
|---|---|---|---|---|
| **Tracked `backend/node_modules/`** | **`7,367` files (TRACKED)** | **`103,805,806 bytes` (~99.0 MiB)** | Covered (`L11: backend/node_modules/`), but tracked prior to ignore | Includes **4 native Windows binaries** (`31,663,616 bytes` / 3× `esbuild.exe` + `argon2.win32-x64-msvc.node`) and **all `1,222` tracked `*/dist/*` entries**; breaks Linux/CI portability & bloats `.git` (`53,364,139 bytes`). |
| **Tracked `backend/storage/`** | **`223` files (TRACKED)** | `4,490,551 bytes` tracked / **`48,232,681 bytes` total on disk** | `backend/storage/{sources,audio,documents,outputs}/*` covered, yet `223` fixture binaries remain tracked | Mixes canonical committed test fixtures with local runtime test outputs. |
| **Root `/storage/` (Untracked residuals)** | Ignored cleanly (`0` tracked) | **`90,568 bytes`** (`audio: 21`, `documents: 1`, `sources: 18`, `non_existent_cert_dir_404: 0`, `test-symlink-outside: 1`) | Covered (`L35: /storage/`) | Leaked by tests run from repo root instead of `backend/` (confirmed at `conversion-worker-certification.test.ts:55,3067`). |
| **Tracked `.zip` Archives** | **`20` files (TRACKED)** | **`3,079,382 bytes` (~2.9 MiB)** | **Not ignored** | Legacy phase bundle zips in repo root & `docs/test-files/`. |
| **Tracked `.sha256` Files** | **`87` files (TRACKED)** | **`11,189 bytes`** | **Not ignored** | Artifact checksum sidecars. |
| **Python `.venv` (`workers/audio_worker/.venv`)** | Ignored (`0` tracked) | `197,456,900 bytes` | Covered (`L46: workers/**/.venv/`) | Properly excluded; healthy on disk. |
| **Tracked `.env*` & Build Outputs** | Only `.env.example` & `backend/.env.example`; `0` `backend/dist` / `frontend/dist` tracked | `backend/dist`: `1.91 MB`; `frontend/dist`: `3.98 MB` | Covered cleanly (`L2-7`, `L15-17`) | No secret `.env` or compiled dist leakage in Git index. |

---

## 8. Safe Non-Destructive Cleanup Recommendations (Owner Approval `POD-05` Required)

**Do NOT run without explicit Owner authorization.** Once authorized in `WS-R2.0`:
1. **Verify clean Git backup/tag marker** before touching Git index (NO history rewrite, NO `filter-repo`).
2. **Untrack cached `backend/node_modules/` safely (`--cached` preserves local working files):**
   ```powershell
   git rm -r --cached backend/node_modules
   ```
   - *Risk:* Any developer/CI pulling the commit must run `npm --prefix backend ci` before `dev`/`test`/`build`; keeps Git history intact (`53.4 MB` packfile untouched without destructive rewrite).
3. **Remove untracked test residuals outside repo root storage:**
   - Remove `<repo>/storage/non_existent_cert_dir_404`, `<repo>/storage/test-symlink-outside`, and relocate/verify any intentional files in `<repo>/storage/{audio,sources,documents}` vs `<repo>/backend/storage/`.
4. **Documented follow-up (`POD-05`):** Decide separately whether legacy `.zip` archives and `223` tracked `backend/storage/` fixture files should move to an explicit `fixtures/` folder or remain tracked for test reproducibility.

---

## 9. Strictly Differentiated Execution Ledger

| Check / Suite | Execution Status in This Assessment | Observed Exact Outcome | Notes |
|---|---|---|---|
| `npm --prefix backend run typecheck` | **Executed Live** | **PASS (`0` errors, `exit 0`)** | Current HEAD `83fbe26a` |
| `npm --prefix frontend run typecheck` | **Executed Live** | **PASS (`0` errors, `exit 0`)** | Current HEAD `83fbe26a` |
| `workers/audio_worker/.venv/Scripts/pytest.exe -p no:cacheprovider -v workers/audio_worker/tests/test_worker.py` | **Executed Live** | **PASS (`18/18` passed in `21.71s`, `0` skipped)** | Completely isolated (`tmp_path`) |
| `npm --prefix frontend test` (Node `v24.12.0 --experimental-strip-types`) | **Executed Live** | **FAIL (`624/628` passed, `4` failed, `0` skipped)** | 3 `.tsx` runner breaks + 1 real contract drift (`#8`) |
| `backend/node_modules/.bin/tsx.cmd --test` (4 failing frontend files) | **Executed Live** | **DIAGNOSED (`24/27` pass; `#8` fails `0!==2`, `autoscroll #8–9` fail repo-root CWD)** | Verified JSX fix + real bug in test `#8` + CWD bug |
| `omr-persistence-and-integrity.test.ts` (`68` tests / `20.1–20.12`) | **NOT Executed Here** *(Static Audited)* | Previously `67/68` in R1; verified `L2556,2586` hardcoded DB + superuser blocker | Requires isolated disposable PG + script fix |
| `audio-preservation-and-worker.test.ts` (`40` tests) | **NOT Executed Here** *(Static Audited)* | Never executed post-R1 | Requires isolated PG + isolated `AUDIO_STORAGE_PATH` |
| `conversion-worker-certification.test.ts` (`105` tests) | **NOT Executed Here** *(Static Audited)* | Never executed post-R1 | Requires isolated PG + temp `cwd` storage isolation |

---

## 10. Risks & 11. Blockers Preventing Immediate Full Certification

### Blockers
1. **Three Pending PG-Dependent Suites Unexecuted (`R2-F36`):** `audio-preservation-and-worker.test.ts` (40 tests), `conversion-worker-certification.test.ts` (105 tests), and `omr-persistence-and-integrity.test.ts` (68 tests) require authorized execution in an isolated disposable database.
2. **Broken Least-Privilege Role Script & OMR Test DB Hardcoding (`R2-F18`):** Cannot certify `bethesda_app_runtime` against current `provision_app_runtime_role.sql` (misses 11 tables + `pgboss`, hardcodes `bethesda_worship_dev`) or unmodified OMR test `20.1–20.12` (hardcodes `bethesda_worship_test`).
3. **Frontend Runner & Contract Alignment (`R2-F37`):** `frontend/package.json:9` lacks `tsx`, `autoscroll.test.ts` depends on `cwd=frontend/`, and `browser-rendering-integration.test.ts:362-378` #8 fails `0!==2`.
4. **Unresolved Strategic Decisions `POD-01`–`POD-05`:** Specifically `POD-05` blocks untracking `backend/node_modules/`.

### Risks
- Potential hidden compatibility errors in `pg-boss` v12 (`getWipData()` / `offWork`) or Python bridge ↔ R1 `AuthGuard` (`tokenVersion`) until the 145 tests in Suites 1 and 2 actually run against live PostgreSQL.

---

## 12. `WS-R2.0` Certification Verdict

**`CONDITIONAL PASS — OWNER DECISIONS & ISOLATED PG CERTIFICATION REQUIRED`**

`test_worker.py` (`18/18`), static TypeScript validation (`0` errors), and exact frontend discrepancy classification (`624/628` root causes) are **certified cleanly**; full `WS-R2.0` closure awaits Project Owner authorization to execute the small test-isolation fixes, run the 3 PostgreSQL suites against a disposable DB, validate `bethesda_app_runtime`, and apply approved repo cleanup (`POD-05`).
