# BETHESDA WORSHIP STUDIO — STAGE 0 REPOSITORY AND CERTIFICATION BASELINE

- **Date & Timezone:** `2026-11-27` (`UTC-05:00`) *(live preflight verified `2026-11-26T17:55:30-05:00`, unchanged HEAD `2026-11-26T18:10:53-05:00`)*
- **Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git` *(visibility: public)*
- **Authoritative Branch & Sync:** `main` (`0` ahead / `0` behind `origin/main`)
- **Authoritative HEAD SHA:** `98919fe85d2c656076426d0a43a1222f9a752465` (`CATEGORY D INDEPENDENT TRACEABILITY MATRIX AUDIT AND PROMOTION READINESS REVIEW`)
- **HEAD Parent SHA:** `97d1546af599c75edaa0bfbbb7eba1d0be626635` (`Merge pull request #2`)
- **Evidence References:** Live Git/PowerShell preflight (`2026-11-26T17:55:30-05:00`), Live test suite runs (`2026-11-25`, identical HEAD `98919fe8`), `MASTER_TEST_AND_ACCEPTANCE_STRATEGY.md` (v1.2), `MASTER_FINDINGS_AND_ROOT_CAUSE_MATRIX.md` (v1.2), Agents 4, 6, 8, 9, and 10 Stage 0 reports, `docs/governance/BETHESDA_WORSHIP_STUDIO_GIT_WORKFLOW_STANDARD.md`, and Project Owner `2026-11-27` `GATE 1` Authorization.
- **Approval Status:** `STAGE 0 GATE 1: PROJECT OWNER APPROVED (2026-11-27) | STAGE 1 (WS-R2.0) – STAGE 4: STRICTLY [ ] LOCKED / NOT AUTHORIZED`

---

## 1. Live Repository Preflight Snapshot

| Inspection Dimension | Measured Value on `main` @ `98919fe8` | Classification |
|---|---|---|
| **Active branch / Remote sync** | `main` (`LOCAL_MAIN == ORIGIN_MAIN`, ahead `0` / behind `0`) | `STATICALLY VERIFIED` |
| **Commits after `98919fe8`** | `0` (`HEAD` parent is `97d1546af599c75edaa0bfbbb7eba1d0be626635`) | `STATICALLY VERIFIED` |
| **Other local branches** | `feature/phase-1a-core-foundation` (`efd1edc`, synced with `origin`); `docs/git-governance-and-post-reversal-recovery` (`dd6da38`, synced with `origin`) | `STATICALLY VERIFIED` |
| **Pre-existing dirty working-tree file** | `M backend/src/interfaces/http/middlewares/auth-middleware.ts` (`+1/-1`, line 23 `) {}` -> `) { }`, CRLF/LF warning emitted by Git; untouched) | `STATICALLY VERIFIED` |
| **Staged changes / Stashes** | `0` staged files / `0` stashes | `STATICALLY VERIFIED` |
| **Pre-existing untracked `.md` files (root)** | `8` files (`BETHESDA_WORSHIP_STUDIO_COMPREHENSIVE_PRODUCT_AND_FUNCTIONAL_AUDIT.md` + `7` `MASTER_*.md` plans); `13` total after creating the `5` `STAGE_0_*.md` deliverables | `STATICALLY VERIFIED` |
| **Ignored filesystem entries** | `183` ignored entries (local build/env/cache artifacts) | `STATICALLY VERIFIED` |
| **Total tracked files in Git index** | `8,894` tracked files | `STATICALLY VERIFIED` |

---

## 2. GitHub Governance, PR History & Branch Protection State

| Governance Check | Observed Evidence | Classification |
|---|---|---|
| **`gh` CLI availability** | `NOT_INSTALLED` on workstation | `STATICALLY VERIFIED` |
| **Unauthenticated GitHub REST API (`/repos`, `/branches/main`, `/pulls`)** | HTTP `403 Forbidden` returned on unauthenticated `Invoke-RestMethod` checks | `NOT VERIFIED` |
| **Live `main` branch protection rules** | Cannot be confirmed via `gh` or unauthenticated REST API (`403`) | **`NOT VERIFIED`** |
| **Direct-commit exposure indicator *(Inferred)*** | *Inferred from local Git DAG:* Commit `98919fe8` landed directly onto `main` after PR #2 merge `97d1546a` rather than via a merge commit, indicating PR-required branch protection was very likely absent at `2026-11-24T20:46:54-05:00` | `Inferred` *(requires Owner GitHub UI check)* |
| **PR #1 & PR #2 local Git commit lineage** | `97d1546a` (`Merge pull request #2`), parent `97ae7c60` (main) + `dd6da38c` (sanitized docs branch) present in local Git log | `STATICALLY VERIFIED` |

> **Governance Prerequisite Action (`POD-06` item 1):** Before `GATE 1` closure, the Project Owner must inspect/configure `main` Branch Protection directly in GitHub Web UI (block force pushes, block deletions, require pull request with `0` required external approvals so solo Owner is never deadlocked; defer required CI checks until Stage 4 workflow stability).

---

## 3. Pre-Existing Working-Tree Diff & Tracked Repository Bloat

### 3.1 Pre-Existing Dirty File (`backend/src/interfaces/http/middlewares/auth-middleware.ts`)
- **Diff:** Single whitespace-only line change (`+1/-1`) at constructor line 23 (`) {}` vs `) { }`) with Git LF/CRLF working-copy notice (`LF will be replaced by CRLF`).
- **Stage 0 Rule:** **Untouched.** Neither reverted nor staged in Stage 0; zero semantic or runtime effect (`Agent 5`, `Agent 10`). Scheduled for clean revert + `.gitattributes` onboarding under `POD-06` / `REM-04`.

### 3.2 Tracked Git Index Bloat Breakdown (`8,894` Total Tracked Files)

| Category | Tracked File Count | Impact / Risk | Remediation Reference |
|---|---:|---|---|
| `backend/node_modules/**` | **`7,367`** | ~103.8 MiB Windows binary (`esbuild.exe`, `.node`) & package bloat (`RR-14`, `RR-15`) | `MF-47` / `POD-05 A1` (`REM-04`) |
| `backend/storage/**` | **`223`** | Runtime audio/PDF fixtures tracked inside Git index; scope reconciliation needed vs legacy `WS-R2.0:126` | `MF-47` / `POD-05 A1` (`Conflict C-07`) |
| `frontend/node_modules/**` | **`0`** | Cleanly excluded by `.gitignore` | Clean |
| `backend/dist/**` | **`0`** | Cleanly excluded by `.gitignore` | Clean |
| Root `*.md` tracked | **`122`** | Legacy audit/report accumulation at repo root (incl. `5` from `98919fe8`) | `MF-46`, `MF-48` / `POD-05`, `POD-06` |
| Root `*.pdf` tracked | **`9`** | Tracked root PDFs (e.g., `BETHESDA_WORSHIP_STUDIO_COMPREHENSIVE_PRODUCT_AUDIT.pdf` 948 KB) | `POD-05` / `POD-06` hygiene |
| `docs/reports/**` | **`491`** | Historical phase evidence archive | Retain as historical record |
| All other source/config/test files | **`1,304`** *(excl. `node_modules` & `storage`)* | Core application, worker, migrations, tests, and active docs | Preserved |

---

## 4. Live Verification & Test Baseline (`2026-11-25`, Same HEAD `98919fe8`)

*(Strict classification discipline: zero categories are ever combined in a single cell.)*

| Check Command / Artifact | Observed Output | Executed / Passed / Failed | Strict Classification |
|---|---|---|---|
| `npm.cmd --prefix backend run typecheck` | Zero TypeScript errors | `1 / 1 / 0` | **`TESTED AND PASSED`** |
| `npm.cmd --prefix frontend run typecheck` | Zero TypeScript errors | `1 / 1 / 0` | **`TESTED AND PASSED`** |
| `npm.cmd --prefix frontend run build` (`vite build`) | Built in `1.07s` (`3,262.55 kB` monolithic JS warning) | `1 / 1 / 0` | **`TESTED AND PASSED`** |
| `workers\audio_worker\.venv\Scripts\python.exe -m pytest workers/audio_worker/tests/test_worker.py -v` | All worker tests green in `17.62s` | `18 / 18 / 0` | **`TESTED AND PASSED`** |
| `python -m pytest workers/audio_worker/tests/test_worker.py -v` *(system Python w/o `.venv`)* | `7` tests failed in `18.07s` (`4` fixture `real_mp3_via_ffmpeg` + `3` `ANALYZE_AUDIO` decode missing `imageio_ffmpeg`) | `18 / 11 / 7` | **`TESTED AND FAILED`** |
| `npm.cmd --prefix frontend test` (`node --test --experimental-strip-types`) | `4` failed (`9.74s`): `3` `.tsx`-importing suites unsupported by Node strip-types + `browser-rendering-integration.test.ts:378` (`0 !== 2`) | `628 / 624 / 4` | **`TESTED AND FAILED`** |
| `tsx --test` *(diagnostic on the `3` `.tsx`-importing FE files from `frontend/`)* | Passed cleanly in `0.95s`, isolating test `#8` (`0 !== 2`) as real defect; note `tsx` absent from `frontend/package.json` `devDependencies` (`NF-15`) | `17 / 17 / 0` | **`TESTED AND PASSED`** *(diagnostic)* |
| `9` pure non-DB backend suites (`tsx --test --test-concurrency=1`) | All pure/env-isolated unit suites passed in `5.97s` (`23` suites) | `109 / 109 / 0` | **`TESTED AND PASSED`** |
| In-memory `tsx` forensic trace on *En Tu Presencia* | Reproduced `6`-beat OSMD/AlphaTab, `0.1` AlphaTex, `8`-beat MusicXML export, `96` re-import errors, `48` vs `24` lyrics, `1` vs `8` sections, `1` vs `3` tracks | `6 / 1 / 5` | **`TESTED AND FAILED`** |
| Static codebase, SQL, migration, security & privacy audit (`MF-01`–`MF-48`, `NF-01`–`NF-30`) | Confirmed exact defect proofs across frontend, backend, SQL migrations, worker, and Git docs | Full codebase | **`STATICALLY VERIFIED`** *(with defects)* |
| `38` PostgreSQL-dependent backend suites + `storage-provider.test.ts` + `backend run build` | Not executed under Stage 0 read-only non-mutation baseline | `0` executed | **`NOT EXECUTED`** |
| Manual Chrome/Firefox/tablet/phone Airplane-Mode Music Stand checks (`M-01`–`M-07`) | Not executed under Stage 0 read-only non-mutation baseline | `0` checked | **`NOT VERIFIED`** |

---

## 5. Workstation Tooling Readiness (Prerequisites for `GATE 3`)

| Tool / Service | Live Preflight Result | Stage 0 Impact | `GATE 3` Impact |
|---|---|---|---|
| Node.js & `npm` | **FOUND** (`C:\Program Files\nodejs\node.exe`, `npm.ps1`) | Ready | Required (`frontend` needs `tsx` in `devDependencies` for `REM-03`) |
| Python `3.14` + `workers/audio_worker/.venv` | **FOUND** (`Python314`, `.venv` passes `18/18`) | Ready | Pin `requirements.lock` |
| Docker CLI (`29.9.2`) & Daemon | Client **FOUND**, Daemon **NOT RUNNING** (`dockerDesktopLinuxEngine` pipe absent) | **Non-blocking** for Stage 0 PO review | **Hard Prerequisite for `GATE 3`** unless local PG installed |
| Native `psql`, `pg_isready`, `createdb` | **NOT_FOUND** on `PATH` | **Non-blocking** for Stage 0 PO review | **Hard Prerequisite for `GATE 3`** (via Docker container `postgres` or native PG install) |

---

## 6. Hardened Disposable PostgreSQL Certification Safety Protocol (`GATE 3` & `GATE 4`)

Zero production or local development database data may ever be mutated during certification. Both `Agent 4` (`migrate.ts:25-29`) and `Agent 8` identified silent bypass vectors that **must be closed before `GATE 3`**:

1. **Close `MIGRATION_DATABASE_URL` Leak (`NF-01`):** In `backend/src/db/migrate.ts:25-29`, `MIGRATION_DATABASE_URL` currently overrides `TEST_DATABASE_URL` even when `NODE_ENV=test`. Patch `migrate.ts` + `db/index.ts:51-62` so test mode requires `!areDatabaseTargetsEquivalent(MIGRATION_DATABASE_URL, DATABASE_URL)` AND `areDatabaseTargetsEquivalent(MIGRATION_DATABASE_URL, TEST_DATABASE_URL)` (fail-closed).
2. **Guard Unset `.env` Inheritance:** Certification runner scripts MUST explicitly export:
   - `NODE_ENV=test`
   - `DATABASE_URL=postgresql://invalid_guard:invalid@127.0.0.1:1/bethesda_guard_never_connect` *(sentinel fail-fast URL that never connects)*
   - `TEST_DATABASE_URL=.../bethesda_worship_r2_cert_tmp`
   - `MIGRATION_DATABASE_URL=.../bethesda_worship_r2_cert_tmp`
   - `AUDIO_STORAGE_PATH=$CERT_TMP/audio`, `AUDIO_STARTUP_RECOVERY_ENABLED=false`, `AUDIO_STARTUP_PURGE_CONFIRMED_ORPHANS=false`, and ephemeral 32+ char secrets.
3. **Strict DB Whitelist + Live SQL Assert:** Validate target URL DB name strictly matches `/^bethesda_worship_r2_cert_tmp$/` AND run SQL `SELECT current_database()` asserting `'bethesda_worship_r2_cert_tmp'` before any schema DDL or test cleanup runs (reject `bethesda_worship_dev`, `bethesda_worship_test`, and production).
4. **Isolated `STORAGE_ROOT_DIR` & CWD:** Isolate all relative `storage/{sources,outputs,documents,test-pgboss-retry}` paths under `$CERT_TMP` so `git status` under `backend/storage/` remains 100% clean.
5. **Pre-Flight & Post-Teardown Primary Row-Count Guard:** Record read-only row counts on any running dev DB (`users`, `songs`, `setlists`, `audio_assets`, `omr_audit_history`) before execution and verify identical counts after teardown.
6. **Split `GATE 3` vs `GATE 4` Replay Protocol:**
   - **`GATE 3` (`WS-R2.0`):** Replay `0000`–`0020`, run `provision_app_runtime_role.sql` creating `bethesda_app_cert_runtime` (`NOSUPERUSER NOCREATEDB NOCREATEROLE`), verify `omr_audit_history` immutability (`42501`/`55000`) & pre-provisioned `pgboss` execution, run all `48/48` backend suites (after fixing `omr-persistence` hardcoded DB/password & `conversion-api` `runMigrations()`).
   - **`GATE 4` (`Stage 2A/2B`):** Run (i) clean `0000`–`0021` replay, (ii) seeded dirty-row upgrade clone (`0000`–`0020` + dirty rows -> `0021` -> idempotent re-run), (iii) `audit_logs` & `song_versions` immutability triggers, and (iv) compiled `node dist/db/migrate.js` + `node dist/server.js` smoke boot under `bethesda_app_cert_runtime`.
7. **Mandatory Teardown:** In `finally`, terminate connections, `DROP DATABASE IF EXISTS bethesda_worship_r2_cert_tmp`, `DROP ROLE IF EXISTS bethesda_app_cert_runtime`, remove `$CERT_TMP`, confirm `pg_database` / `pg_roles` === `0`, primary DB row counts unchanged, and `git status` clean.

---

## 7. Privacy, Custody & Documentary Integrity Disclosures (`98919fe8`, `docs/`, Category D)

1. **Direct Commit `98919fe8` Custody & Privacy Violations:**
   - `BETHESDA_WORSHIP_STUDIO_POST_RESTORE_PRE_MERGE_ACCEPTANCE_REPORT.md` line `28` explicitly records that the artifact remained *"sin confirmar ni empujar"*, yet it was committed directly to `main` (`98919fe8`), and line `80` exposes a personal author handle and email address in public prose.
   - `BETHESDA_WORSHIP_STUDIO_PR2_FINAL_INDEPENDENT_PRE_MERGE_AUDIT.md` line `211` similarly declares it was *"NO fue confirmado ni empujado"*, while lines `151` and `183` expose the local workstation OS username in public prose.
2. **Category D Root Matrix Privacy & Freshness State:**
   - `BETHESDA_WORSHIP_STUDIO_PHASE_R2_UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md` on `main` contains **`61`** local file URIs exposing workstation directories and OS username (`L11–14` [4], `L20` [1], `L31–67` [54], `L108` [2]) and still cites stale `feature/phase-1a-core-foundation` @ `d9353442` (`L4–5`).
3. **`14` Pre-Existing Path Leaks Across `docs/` *(not `13`)*:**
   - `docs/WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.md:105` (`1` local file URI)
   - `docs/reports/PHASE_3B_REALTIME_LITURGICAL_FLOW_IMPLEMENTATION_REPORT.md:34,40,46,49,59,63,64,66,68,81,108` (`9` local file URIs + `2` raw Windows paths = `11`)
   - `docs/reports/PHASE_3C_MULTITRACKS_OMR_IMPLEMENTATION_REPORT.md:76,105` (`2` raw Windows paths)
4. **Public Git History Disclosure:** Forward-only documentation sanitization PRs remove personal strings from `HEAD` only; historical commits (`2730ed6..98919fe8`) remain publicly visible in Git history unless the Project Owner explicitly authorizes a separate GitHub history rewrite + contributor notice (`POD-06`).
5. **Stale `"Phase 2B.1 NOT STARTED"` Wording:** Multiple `docs/governance/` and `98919fe8` docs claim Phase 2B.1 is unstarted/unauthorized despite PR #1 already merging `storage-provider.ts`, `output-retention-service.ts`, and `cas_deletion_intents` onto `main` — scheduled for documentary reconciliation under `POD-06`.

---

## 8. Stage 0 Change-Control Rationale (Why ZERO Commits or Pushes Occurred)

Per Section 11 of the Stage 0 mandate, a commit/push is allowed *only if the repository is clean enough to do so safely without overwriting pre-existing changes*, and `docs/governance/BETHESDA_WORSHIP_STUDIO_GIT_WORKFLOW_STANDARD.md` enforces strict branch-and-PR governance (`:14-15,24-37,43-46,57,64`):

1. **`main` Is Checked Out Directly:** Committing directly to `main` violates `GIT_WORKFLOW_STANDARD.md:14-15` (and PR #2 post-mortem rules).
2. **Pre-Existing Dirty Working Tree (`HARD STOP` Triggered):** `auth-middleware.ts` has an unstaged modification (`M`, `+1/-1` at `:23`) alongside `8` pre-existing untracked `.md` audit/master documents. `GIT_WORKFLOW_STANDARD.md:24-37` mandates **HARD STOP** against branch switching, resetting, staging, committing, or pushing in a dirty working tree without explicit Project Owner sign-off.
3. **`POD-06` Pending Signature:** Working-tree cleanup, privacy scrubbing, Category D disposition, and `main` branch protection all await Owner approval inside `POD-06` (`GATE 1`).
4. **Agent 10 Release Engineering Ruling:** **HOLD — ZERO COMMITS, ZERO PUSHES, ZERO WORKING-TREE MUTATIONS.** All `5` `STAGE_0_*.md` files and reconciled `MASTER_*.md` plans remain safely untracked in the local workspace until `GATE 1` (`POD-06`) is signed.

### Exact Post-`GATE 1` Promotion Workflow (Authorized Once Owner Signs `POD-06`)
1. Configure `main` Branch Protection in GitHub Web UI (block force-push/deletion, require PR, `0` approvals deadlock guard).
2. Verify `git diff -- backend/src/interfaces/http/middlewares/auth-middleware.ts` is whitespace-only at line 23 (`:48`) and reset it cleanly (`git checkout -- backend/src/interfaces/http/middlewares/auth-middleware.ts`), leaving untracked docs intact. *(Defer adding `.gitattributes` `* text=auto eol=lf` to Stage 1 `REM-04` per Conflict `C-06` so Stage 0 remains 100% docs-only.)*
3. Branch cleanly: `git checkout -b docs/stage-0-governance-and-master-plan main`.
4. Execute `POD-06` privacy remediation (`98919fe8` + `14` `docs/` leaks + Phase 2B.1 status note), Category D Option C, and master/Stage 0 doc placement (`docs/governance/` or indexed structure per Owner preference).
5. Run Agent 9 privacy regex verification (`0` emails, local file URIs, OS usernames) + `git diff --check`, stage explicit paths only, commit, push, and merge via GitHub PR #3.
6. Run post-merge cleanup (`git checkout main && git pull --ff-only`, `git fetch --prune origin`, and retire historical `feature/phase-1a-core-foundation` & `docs/git-governance-and-post-reversal-recovery` per `GIT_WORKFLOW_STANDARD.md:74-79`).

---

## 9. Governance Approvals, GATE 1 Execution Record & Version History

- **Formal Project Owner Approvals (`2026-11-27` — `GATE 1` ONLY):**
  - `POD-01` (`Option A+B Hybrid`), `POD-02` (`Option A`), `POD-03` (`Option B`), `POD-04` (`Option C`), `POD-05` (`Git A1`, `FFmpeg B2`), `POD-06` (`Approve Stage 0 Governance PR #3` + `Category D Option C`), `POD-07` (`Option A`), `POD-08` (`Option C`), `POD-09` (`Defer R3+` + `ENABLE_EXPERIMENTAL_ROUTES=false`), and `OI-01` (`Option A`).
  - **GATE 1 Hygiene Actions Executed on Branch `docs/stage-0-governance-and-master-plan`:**
    1. Verified `auth-middleware.ts:23` pre-existing modification was whitespace-only (`) {}` -> `) { }`) and restored exact `main` LF bytes (`5,351` B, SHA-256 `DD0CB68E0B82CE587C4B8131FA30FF5CB95B88259DD5E1341DDBFD9DEEDCC959`) with zero `.gitattributes` or source code edits.
    2. Executed privacy sanitization across `98919fe8` reports and `14` `docs/` leaks, Category D `Option C`, and `Phase 2B.1` documentary reconciliation while preserving all pre-sanitization SHA-256 digests in `docs/governance/BETHESDA_WORSHIP_STUDIO_GATE_1_PRIVACY_AND_SHA256_RECONCILIATION_REPORT.md`.
    3. Staged and prepared docs-only PR `#3` (`docs/stage-0-governance-and-master-plan -> main`) without committing application/SQL/test/config files or merging PR `#3`.
- **Remaining Locked Gates:** **`GATE 2` through `GATE 8`** (`WS-R2.0` through `WS-R2.6`) remain **`100%` LOCKED / `NOT AUTHORIZED` (`[ ]`)**.

### Version & Change History
- **v1.0** — `2026-11-27` (`UTC-05:00`) — Initial Stage 0 Repository and Certification Baseline created under strict read-only repository change control (`main` @ `98919fe85d2c656076426d0a43a1222f9a752465`).
- **v1.1** — `2026-11-27` (`UTC-05:00`) — Recorded formal `2026-11-27` Project Owner approvals (`POD-01`–`POD-09`, `OI-01`, `GATE 1`) and documented clean `auth-middleware.ts:23` LF restoration on branch `docs/stage-0-governance-and-master-plan` (`WS-R2.0+` / `GATE 2`–`GATE 8` remain locked `[ ]`).
