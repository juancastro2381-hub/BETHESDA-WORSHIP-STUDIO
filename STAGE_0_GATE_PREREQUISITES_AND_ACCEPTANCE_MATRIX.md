# BETHESDA WORSHIP STUDIO — STAGE 0 GATE PREREQUISITES AND ACCEPTANCE MATRIX

- **Date & Timezone:** `2026-11-27` (`UTC-05:00`)
- **Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`
- **Authoritative Branch & HEAD SHA:** `main` @ `98919fe85d2c656076426d0a43a1222f9a752465`
- **Evidence References:** `MASTER_PROJECT_OWNER_DECISION_REGISTER.md` (v1.2 Section 3), `docs/governance/BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md:147-158`, `MASTER_TEST_AND_ACCEPTANCE_STRATEGY.md` (v1.2), Agents 4, 8, 9, and 10 Stage 0 reports, and Project Owner `2026-11-27` Formal Decision Ratification.
- **Approval Status:** `STAGE 0 GATE 1: PROJECT OWNER APPROVED (2026-11-27) | GATE 2–GATE 8: STRICTLY [ ] LOCKED / NOT AUTHORIZED`

---

## 1. Gate Taxonomy Reconciliation (`Program GATE 1–8` vs Legacy `WS-R2.0-SG1–8`)

Previously, `docs/governance/...WS_R2_0...md:147-158` used `GATE 1`–`GATE 8` as internal sub-gates exclusively inside `WS-R2.0`, while `MASTER_PROJECT_OWNER_DECISION_REGISTER.md:90-99` defined `GATE 1`–`GATE 8` across the full R2 program (`Stage 0 -> Production Release`). Per Conflict Resolution **`C-02`**, **Program-Level `GATE 1`–`GATE 8`** in this matrix are **solely authoritative**, and legacy `WS-R2.0` sub-gates are mapped explicitly as **`WS-R2.0-SG1`…`SG8`**:

| Legacy Reference (`WS_R2_0...md:147-158`) | Legacy Role | Authoritative Program Gate Mapping |
|---|---|---|
| **`WS-R2.0-SG1`** (`POD-01`–`POD-05` signed) & **`WS-R2.0-SG2`** (`REM-04` untrack) | `WS-R2.0` pre-work | Mapped to **`GATE 1`** (decisions) & **`GATE 2`** (`WS-R2.0` authorization incl. `REM-04`) |
| **`WS-R2.0-SG3`** (PG Preflight), **`SG4`** (`WS-R2.0` Role/Runner), **`SG5`** (`WS-R2.0` Testing), **`SG6`** (Audit), **`SG7`** (`WS-R2.0` Closure) | Internal `WS-R2.0` execution milestones | Mapped to internal checkpoints inside **`GATE 2` -> `GATE 3`** (`WS-R2.0` Isolation & Certification Gate) |
| **`WS-R2.0-SG8`** *(Historical label: "Unlock `WS-R2.1`")* | Exit of `WS-R2.0` | Corresponds to **`GATE 3` PASS**, enabling Project Owner review to authorize **`GATE 4`** (Stage 2 Structural DDL & `packages/music-core`) ahead of **`GATE 5`** (`WS-R2.1`) |

---

## 2. Program Execution Gate Prerequisites & Acceptance Matrix (`GATE 1` through `GATE 8`)

### `GATE 1` — Project Owner Decision Ratification (`POD-01`–`POD-09`, `OI-01`) & Stage 0 Doc/Git Hygiene
- **Scope Unlocked:** Promotion of sanitized Stage 0 / Governance / Master Plan docs via PR #3; `main` branch protection & governance record updates ONLY. *(Strictly ZERO source code, SQL, `.gitattributes`, or `WS-R2.0` implementation edits unlocked.)*
- **Prerequisite Decisions:** **`POD-01` (`Opt A+B Hybrid`), `POD-02` (`Opt A`), `POD-03` (`Opt B`), `POD-04` (`Opt C`), `POD-05` (`Git A1`, `FFmpeg B2`), `POD-06` (`PR #3 + Cat D Opt C`), `POD-07` (`Opt A`), `POD-08` (`Opt C`), `POD-09` (`Defer R3+ & Experimental Gate`)**, plus **`OI-01` (`Opt A`)** — ALL ratified `2026-11-27`.
- **Entry Criteria:** All `7` reconciled `MASTER_*.md` plans and `5` `STAGE_0_*.md` deliverables reviewed and approved by Project Owner.
- **Target Deliverables:**
  1. Recorded PO approvals across `STAGE_0_*` & `MASTER_*` governance records (`POD-01`–`POD-09` + `OI-01`).
  2. GitHub branch protection enabled/verified on `main` (Web UI: block force-push & deletion, require PR with `0` external approvals deadlock).
  3. Clean working tree (`auth-middleware.ts:23` whitespace diff resolved cleanly with zero `.gitattributes`/app changes; post-merge prune deferred cleanly until PR #3 merge).
  4. Docs-only PR #3 opened (`docs/stage-0-governance-and-master-plan -> main`) containing scrubbed `98919fe8`, scrubbed `14` `docs/` leaks, reconciled `"Phase 2B.1 NOT STARTED"` wording, Category D `Option C`, SHA-256 reconciliation report, and Stage 0/Master plans.
- **Mandatory Acceptance Evidence:** Privacy regex scan across all PR #3 `.md` files returns `0` emails, `0` local file URIs, `0` OS usernames; `git diff --name-only main...HEAD` has `0` app/SQL/config files; clean `git status` on tracked code; independent GATE 1 review pass; GitHub branch protection & PR #3 UI verification.
- **Verifier Agents:** Independent GATE 1 Auditor (`read-only`), Browser Subagent, Project Owner.
- **Residual Actions At GATE 1 Closure:** GitHub PR #3 merge and post-merge `main` sync / `origin/revert-1` prune remain reserved for explicit Project Owner merge action.
- **Owner Sign-Off:** `[x] Approved — Date: 2026-11-27` *(Status: `PROJECT OWNER APPROVED — STAGE 0 GATE 1 ONLY`)*

---

### `GATE 2` — Authorize `WS-R2.0` Controlled Certification Baseline Only (`REM-04`, `REM-01`, `REM-03`, `REM-02`)
- **Scope Unlocked:** Strictly `WS-R2.0` baseline tooling, `.gitignore`/`.gitattributes` + index cleanup (`REM-04`), least-privilege DB provisioning script (`REM-01`), frontend test runner/fixture alignment (`REM-03`), and isolated PG test execution (`REM-02`). **ZERO product feature/musical/UI edits.**
- **Prerequisite Decisions:** Signed `GATE 1` (specifically `POD-05` `A1/A2` for `REM-04` and `POD-06` merged).
- **Entry Criteria:** Clean protected `main` post-`GATE 1`; Docker daemon running OR native PostgreSQL server (`psql`/`pg_isready`/`createdb`) available locally (**hard workstation prerequisite for `REM-02` / `GATE 3`**).
- **Target Deliverables:**
  1. `PR-1` (`chore/ws-r2-0-pod05-index-hygiene`): `.gitattributes` (`* text=auto eol=lf`), hardened `.gitignore`, `git rm -r --cached` on `backend/node_modules/` (`7,367` files) + `backend/storage/*` (per signed `POD-05 A1` preserving `.gitkeep`s) — merges **FIRST**.
  2. `fix/ws-r2-0-runtime-role`: Fixed `provision_app_runtime_role.sql` (21 tables + `pgboss`), `migrate.ts` fail-closed `TEST_DATABASE_URL` isolation (`NF-01`), `assertNonSuperuserRuntimeRole()` wired in `server.ts`, `omr-persistence:2556,2586` & `conversion-api` `runMigrations()`.
  3. `fix/ws-r2-0-fe-runner`: `tsx` added to `frontend/package.json` `devDependencies` (`NF-15`), `npm --prefix frontend test` switched to `tsx --test`, `autoscroll.test.ts` `import.meta.url` CWD fix, and `browser-rendering-integration.test.ts:368-380` test `#8` fix + `LYRICS_ONLY` `capo === 0` invariant.
- **Mandatory Acceptance Evidence:** `git ls-files backend/node_modules` === `0`; `npm --prefix backend ci && npm --prefix backend run typecheck` passes cleanly; external worktrees verified under `C:\dev\bws-wt\`; zero unapproved production feature diffs.
- **Verifier Agents:** Agent 4, Agent 8, Agent 10, Agent 9 (`audit`).
- **Blocking Conditions Today:** `GATE 1` unsigned; Docker daemon stopped & native PG CLI tools absent on workstation (`TASK-23864` preflight).
- **Owner Sign-Off:** `[ ] Authorize WS-R2.0 Only — Date: ___________________` *(Status: `NOT AUTHORIZED`)*

---

### `GATE 3` — Isolated Disposable PostgreSQL & Core Test Certification Gate (`REM-02`)
- **Scope Unlocked:** Proof of 100% reproducible green test baseline before structural DDL/monorepo refactoring (`GATE 4`).
- **Prerequisite Decisions:** `GATE 2` deliverables merged/verified on clean baseline.
- **Entry Criteria:** `GATE 2` PRs (`REM-04`, `REM-01`, `REM-03`) complete; running Docker PostgreSQL container OR local PG instance; `$CERT_TMP` isolated temp dir (`STORAGE_ROOT_DIR`, `CWD`).
- **Target Deliverables & Mandatory Acceptance Evidence (Agent 8 §5B):**
  1. **Clean Index Proof:** `git ls-files backend/node_modules` === `0`; `backend/storage` contains `.gitkeep` only (`POD-05 A1`).
  2. **Frontend `tsx --test` 100% Pass:** `npm --prefix frontend test` passes `100%` (`629+/629+`, `0` fails, `0` skips) executed from BOTH repo root and `frontend/` CWD.
  3. **Python `.venv` 100% Pass:** `workers\audio_worker\.venv\Scripts\python.exe -m pytest workers/audio_worker/tests/test_worker.py -v` passes **`18/18`** (`0` skips).
  4. **Disposable PG `48/48` Backend Suites Pass:** Strictly targeting `bethesda_worship_r2_cert_tmp` (`SELECT current_database()` asserted; `NF-01` `MIGRATION_DATABASE_URL` guard active; sentinel fail-fast `DATABASE_URL`): replay `0000`–`0020`, provision `bethesda_app_cert_runtime` (`NOSUPERUSER NOCREATEDB NOCREATEROLE`), prove `omr_audit_history` immutability (`42501`/`55000`), verify `assertNonSuperuserRuntimeRole()` rejects superuser/DDL roles, pass **all `48/48` backend test suites** (`0` fails, `0` skips) connected as `bethesda_app_cert_runtime`, then cleanly `DROP DATABASE` + `DROP ROLE` (`pg_database`/`pg_roles === 0`), zero primary DB row-count delta, clean `git status`.
- **Verifier Agents:** Agent 8 (`certification lead`), Agent 4 (`DB`), Agent 9 (`audit`), Agent 10 (`reproducibility`).
- **Blocking Conditions Today:** Blocked by `GATE 2` + stopped Docker daemon / absent PG CLI.
- **Owner Sign-Off:** *(Verification Gate — verified by Agent 8 & Agent 9 before `GATE 4` submission; Status: `BLOCKED BY GATE 2`)*

---

### `GATE 4` — Authorize Stage 2 Structural Work (`WS-R2.3-DDL` Migration `0021` + `WS-R2.5A` `@bethesda/music-core`)
- **Scope Unlocked:** Sequential Stage 2A (`0021` schema hardening & `pg-error-mapper.ts` + batched `env.ts` keys) followed by Stage 2B stop-the-world extraction of `packages/music-core` + `backend/tsconfig.build.json` `dist/server.js` fix.
- **Prerequisite Decisions:** `GATE 3` green certification + signed **`POD-02`** (Multi-Tenancy scope in `0021`), **`POD-07`** (Song Deletion `ON DELETE RESTRICT` / Soft-Archive semantics in `0021`), and **`OI-01` / `POD-10`** (`packages/music-core` + TS `^5.7.3` vs `^7.0.2` alignment).
- **Entry Criteria:** `GATE 3` report signed by Agents 8 & 9; external worktrees paused during stop-the-world Stage 2B PR.
- **Target Deliverables & Mandatory Acceptance Evidence:**
  1. **Migration `0021` (`idx: 21`, `when > 1794476002000`):** Historical `0000`–`0020` SQL & `_journal.json` indices `0..20` byte-identical (`RR-04`). Disposable PG passes BOTH: (a) fresh `0000`–`0021` replay, and (b) dirty-row upgrade clone (`0000`–`0020` + seeded dirty rows -> `0021` -> idempotent `rc=0` re-run, `RR-03`). Runtime role test verifies `audit_logs` & `song_versions` `BEFORE UPDATE OR DELETE` immutability triggers (`42501`/`55000`) while `setCurrentVersion` still succeeds.
  2. **`@bethesda/music-core` & Compiled Boot (`WS-R2.5A`):** `0` imports matching `../frontend/` in `backend/src/**`; `stand-format-capabilities.ts` moved to `capabilities/`; `ingestion/conversion/*` & `omr-proposal-handler.ts` excluded; `tsc --noEmit` & `packages/music-core` build clean; `backend run build` produces `dist/server.js` & `dist/db/migrate.js`; smoke boot from path containing `"test"` (e.g., `/tmp/latest-smoke/`) under `NODE_ENV=production` preserves `env.NODE_ENV === 'production'`, loads `.env`, runs Python `PING`, returns `/documentation -> 404` & `/health -> 200` as `bethesda_app_cert_runtime` (`RR-13`).
- **Verifier Agents:** Agent 4 (`Stage 2A`), Agent 1 & Agent 10 (`Stage 2B`), Agent 8 & Agent 9.
- **Blocking Conditions Today:** Blocked by `GATE 3`, `POD-02`, `POD-07`, and `OI-01`.
- **Owner Sign-Off:** `[ ] Authorize Stage 2 — Date: ___________________` *(Status: `NOT AUTHORIZED`)*

---

### `GATE 5` — Authorize Stage 3 Track `3A -> 3B` (`WS-R2.1` Musical Domain, Projection, Exporters & Importers)
- **Scope Unlocked:** `Track 3A` (Agent 2 canonical domain, `ProjectionService` rests/voices/split/transposition/capo, Zero-Fabrication, per-format approvals) -> `DerivedMusicalView` freeze -> `Track 3B` (Agent 3 MusicXML, MIDI, ChordPro, browser `.tab`, `AlphaTexGenerator`).
- **Prerequisite Decisions:** `GATE 4` green + signed **`POD-03`** (`APPROVED` vs `DRAFT` lifecycle & per-format approval governance).
- **Entry Criteria:** `packages/music-core` & `0021` merged on `main`; isolated worktree(s) outside OneDrive; `Track 3A` freezes `DerivedMusicalView` & `stand-format-capabilities` before `Track 3B` & `Track 3E-2` consume them.
- **Target Deliverables & Mandatory Acceptance Evidence (Agent 8 §5B):**
  1. ***En Tu Presencia* 10-Stage E2E Suite (`en-tu-presencia-e2e-regression.test.ts`):** Stages 1–8 + Stage 9 (ChordPro round-trip) + Stage 10 (browser-safe `Buffer=undefined` ASCII Tab Capo 2), enforcing **`24` lyrics** (never `48`), **`3` `instrumentTracks`**, **`8` sections**, **exact `61,440` MIDI Note-Off**, `AlphaTexImporter` parse validation (`0` `0.1` fabrication, physical fret validity), Piano `GRAND_STAFF` Treble/Bass split, `0` `VALIDATION_ISSUE`s, and `0` canonical mutations across all stages.
  2. **`6/8` Compound Meter & Dotted-Rhythm Companion Fixture:** Proves `1440` ticks/bar, `720`/`1440` dotted notes (`<dot/>` in MusicXML, `{d}` in AlphaTex, `FF 58 04 06 03 18 08` in SMF, `1440` section ticks in completion service).
  3. **Closed Blind Spots (`BS-01`, `BS-02`, `BS-03`, `BS-04`, `BS-08`):** Real `MusicXmlGenerator`, `AlphaTexImporter`, full binary SMF parser (negative signed key bytes, multi-channel + ch 9 drums, 3-note tied merge, truly tempoless no-`FF 51`), legacy DB JSONB read-compatibility (`RR-01`), exhaustive `30 keys × [-11..+11]` + `Cb4/B#3` + `tenor_sax (+14)`, XXE + `.mxl` zip-bomb/zip-slip tests, and non-tonic bar-1 Capo tests.
- **Verifier Agents:** Agent 2, Agent 3, Agent 8, Agent 9.
- **Blocking Conditions Today:** Blocked by `GATE 4` & `POD-03`.
- **Owner Sign-Off:** `[ ] Authorize Stage 3 Music — Date: ___________________` *(Status: `NOT AUTHORIZED`)*

---

### `GATE 6` — Authorize Stage 3 Track `3C & 3D` (`WS-R2.2`, `WS-R2.3`, `WS-R2.4` Security, ACID, Audio Queue, Storage & Ops)
- **Scope Unlocked:** Parallel `Track 3C` (Agents 4+5 Security, Identity, SMTP, RBAC, Song CRUD, `DocumentService` PG ownership, ACID `FOR UPDATE`, `pool.end()` shutdown) and `Track 3D` (Agent 6 Python worker WebM/Viterbi/novelty, `pg-boss` async audio `202`, streaming multipart, O(range) Range reads, `retryJob`/DLQ, pre-validate ingestion, `OutputRetentionService`, unified storage/S3/backups).
- **Prerequisite Decisions:** `GATE 4` green + signed **`POD-01`**, **`POD-03`**, **`POD-04`**, **`POD-05 B`**, **`POD-07`**, **`POD-08`**, and **`POD-09`** (disposition on `ENABLE_EXPERIMENTAL_ROUTES=false` for unwired R3+ `/realtime/*`, `/multitrack/*`, `/omr/*`, `/ingestion/*` routes).
- **Entry Criteria:** `0021` DDL (`visual_documents`, triggers, FKs) + `env.ts` batched vars + `packages/music-core` live on `main`.
- **Target Deliverables & Mandatory Acceptance Evidence (Agent 8 §5B):**
  1. **Security & Identity (`WS-R2.2`):** Full 5-role cross-endpoint RBAC matrix; `403` cross-user `/documents/:key/*` IDOR across restarts (`MF-28`); multi-stream FlateDecode zip-bomb bounds on both PDF modules (`MF-29`); Python worker subprocess `os.environ` secret-free (`MF-30`); zero invite/reset tokens in prod HTTP/Pino logs (`MF-24`); fresh DB role check `request.user.role` (`NF-04`); `omr.routes.ts:204` fail-closed `enableTestFixture: false` (`BS-06`, `NF-24`); `TRUST_PROXY=false` & `x-test-close` production gate (`MF-31`).
  2. **ACID & Operational Lifecycle (`WS-R2.3`):** Parallel PG contention (`>= 5–10` concurrent connections) with `0` 500s / `0` orphans / `0` duplicate sequences / `1` active refresh rotation / `>= 1` active `SUPER_ADMIN` (`MF-20`); double-`SIGTERM` drains `pool.totalCount === 0` (`MF-23`); SQLSTATE `400/409` with `0` SQL strings in 500 JSON.
  3. **Audio, Queue & Storage (`WS-R2.4`):** Async `POST /audio/:id/analyze` (`202`) + O(range) `206` streaming + SQL `WHERE` `listDraftsBySongId` (`MF-33`); `.webm` TS+Python worker `pytest` (`MF-34`); `retryJob()` after both `RETRIES_EXHAUSTED` & `LEASE_EXPIRED_MAX_ATTEMPTS` (`BS-05`); double sequential invalid-upload `400` with `0` orphans (`MF-36`); `OutputRetentionService` `dryRun` accuracy (`MF-37`); loopback HTTP S3 SigV4 (`publicBaseUrl`, RFC-3986, `>1,000` keys `ContinuationToken`, `403`/`500 -> StorageError`) + **executed DB+storage backup/restore drill** (`MF-38`).
- **Verifier Agents:** Agent 4, Agent 5, Agent 6, Agent 8, Agent 9, Agent 10.
- **Blocking Conditions Today:** Blocked by `GATE 4`, `POD-01`, `POD-03`, `POD-04`, `POD-05`, `POD-07`, `POD-08`, `POD-09`.
- **Owner Sign-Off:** `[ ] Authorize Stage 3 BE/Ops — Date: ___________________` *(Status: `NOT AUTHORIZED`)*

---

### `GATE 7` — Authorize Stage 3E & Stage 4 (`WS-R2.6` + `WS-R2.5B`: UI Integration, Offline Loop, Bundle `< 800 kB`, Manual `M-01`–`M-07`)
- **Scope Unlocked:** Parallel `Track 3E-1` (SW, Offline hooks, A11y modals, Wake Lock `NF-14`, CSS mobile/print/reduced-motion, onboarding routes) -> `Track 3E-2` (OSMD/AlphaTab/LeadSheetDOM after `Track 3A` freeze) -> Stage 4 serial integration (`api-client.ts`, `MusicalWorkspace.tsx`, `ConversionCenterWorkspace.tsx`, `WS-R2.5B` Vite `< 800 kB` splitting, `.venv` `requirements.lock`, CI workflows).
- **Prerequisite Decisions:** `GATE 5` & `GATE 6` green; `POD-04` (onboarding UI scope); `POD-09` (orphaned module cleanup).
- **Entry Criteria:** `Track 3A`–`3D` APIs, `DerivedMusicalView`, and Phase 2B.1 preview endpoints stable on `main`.
- **Target Deliverables & Mandatory Acceptance Evidence (Agent 8 §5B):**
  1. `vite build` passes with initial JS entry chunk **`< 800 kB`** (`MF-44`); automated `sw.js` test verifies `/manifest.webmanifest` + lazy Vite renderer chunks precached (`RR-08`) and offline SWR miss returns `Response(503)`.
  2. Repo-wide static exclusion test confirms **ZERO** physical pedal device APIs (`bluetooth`/`hid`/`usb`/`getGamepads`/`pedal`) (`C-03`).
  3. Full automated regression suite (`frontend tsx --test`, `backend 48+` suites on disposable PG under non-superuser role, Python `.venv 18+`, `typecheck`, `build`, `dist/server.js` smoke) passes **100%**.
  4. **Project Owner / Human QA executes and signs ALL `7` Manual Cases `M-01`–`M-07`** on real Desktop Chrome/Firefox, `360–390px` mobile, and tablet in Airplane Mode (`MASTER_TEST_AND_ACCEPTANCE_STRATEGY.md` Section 6; **strictly ZERO Playwright/Selenium/Cypress**).
- **Verifier Agents:** Agent 7, Agent 8, Agent 9, Agent 10, Project Owner.
- **Blocking Conditions Today:** Blocked by `GATE 5` & `GATE 6`.
- **Owner Sign-Off:** `[ ] Authorize Stage 4 UI — Date: ___________________` *(Status: `NOT AUTHORIZED`)*

---

### `GATE 8` — Final Production Release Readiness & Separate `R3+` Unlock
- **Scope Unlocked:** Production deployment release tag `vX.Y.Z` (separate written authorization required afterwards to start any `R3+` deferred item).
- **Prerequisite Decisions:** `GATE 7` green + Owner manual sign-off (`M-01`–`M-07`) + `POD-05 B` GPLv3 redistribution check if containerized/packaged.
- **Entry Criteria:** Staging soak test ready.
- **Target Deliverables & Mandatory Acceptance Evidence:**
  1. **Staging Soak Telemetry (`15–30 min`):** Bounded Node & Python `.venv` worker RSS (verifying `NF-12` chunked median filter keeps RAM bounded on 7-min audio), zero `5xx` responses, clean `pg-boss` queue drain, zero orphaned files under `storage/*`.
  2. **Final Privacy & Config Gate:** `0` personal emails/local file URIs/OS usernames across tracked `.md`; `main` branch protection confirmed ON; `PROD` `.env` checklist verified (`NODE_ENV=production`, fail-closed SMTP, non-superuser DB runtime role, `enableTestFixture: false`).
  3. **Release Tag & Integrity Manifest:** Tagged `vX.Y.Z` on protected `main` with recorded SHA-256 checksums for built artifacts, `0000`–`0021` SQL migrations, and `requirements.lock`.
- **Verifier Agents:** Agent 9, Agent 10, Agent 8, Project Owner.
- **Blocking Conditions Today:** **`HARD STOP`** — blocked by `GATE 1`–`GATE 7`.
- **Owner Sign-Off:** `[ ] Production Release Sign-Off — Date: ___________________` *(Status: `HARD STOP / NOT AUTHORIZED`)*

---

## 3. Open Decisions, Execution Locks & Version History

- **Approved Foundation (`2026-11-27`):** `POD-01` (`Opt A+B Hybrid`), `POD-02` (`Opt A`), `POD-03` (`Opt B`), `POD-04` (`Opt C`), `POD-05` (`Git A1`, `FFmpeg B2`), `POD-06` (`PR #3` + `Cat D Opt C`), `POD-07` (`Opt A`), `POD-08` (`Opt C`), `POD-09` (`Defer R3+` + `ENABLE_EXPERIMENTAL_ROUTES=false`), and `OI-01` (`Opt A`) are formally approved under **`GATE 1` ONLY**. *(Pending downstream follow-up selections before execution gates: SMTP relay provider under `POD-04 Opt C` before `GATE 6`, and backup storage/offsite destination under `POD-01 Opt A+B Hybrid` before `GATE 6`.)*
- **Locked Execution Gates:** **`GATE 2` through `GATE 8` remain `100%` LOCKED / `NOT AUTHORIZED` (`[ ]`)**. `WS-R2.0` through `WS-R2.6` cannot start without separate explicit Project Owner authorization.

### Version & Change History
- **v1.0** — `2026-11-27` (`UTC-05:00`) — Initial Stage 0 Gate Prerequisites and Acceptance Matrix reconciling program gates `GATE 1`–`GATE 8` with legacy `WS-R2.0-SG1`–`SG8` sub-gates and embedding Agent 8/Agent 4/Agent 10 hardened acceptance criteria.
- **v1.1** — `2026-11-27` (`UTC-05:00`) — Recorded formal `2026-11-27` Project Owner approvals for `POD-01`–`POD-09`, `OI-01`, and **`STAGE 0 GATE 1 ONLY`** (`[x] Approved — Date: 2026-11-27`); kept `GATE 2`–`GATE 8` strictly `[ ]` LOCKED / `NOT AUTHORIZED`.
