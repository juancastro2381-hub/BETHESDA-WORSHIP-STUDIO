# BETHESDA WORSHIP STUDIO — MASTER PROJECT OWNER DECISION REGISTER

- **Date:** `2026-11-27` (`UTC-05:00`)
- **Authoritative Baseline:** `main` @ `98919fe85d2c656076426d0a43a1222f9a752465`
- **Governance Rule:** Formal Project Owner (`2026-11-27`) approvals are recorded below for **`POD-01`–`POD-09`**, **`OI-01`**, and **`STAGE 0 GATE 1 ONLY`** (supporting Stage 0 governance/privacy PR #3, Category D Option C, and `main` branch protection). **`GATE 2` through `GATE 8`** and all implementation workstreams (**`WS-R2.0` through `WS-R2.6`** and `R3+`) remain **strictly `[ ]` LOCKED / `NOT AUTHORIZED`** until explicit per-gate Project Owner authorization.

---

## 1. Strategic Architecture & Infrastructure Decisions (`POD-01` through `POD-05`)

*(Consolidated directly from `docs/governance/BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md` and enriched with Master Audit evidence `MF-01`–`MF-48`.)*

### `POD-01` — Hosting, Persistent Storage & Backups (`MF-37`, `MF-38`, `RR-05`, `RR-18`)
- **Problem:** `S3CompatibleStorageProvider` is unwired and has 4 verified bugs (post-sign `publicBaseUrl` host mismatch -> `403`, non-RFC-3986 encoding, 1,000-key `listKeys` truncation, silent `false` on HTTP 403/500 in `exists`/`delete`); `OutputRetentionService` has 0 production callers; `docker-compose.yml` lacks storage volumes and automated DB/storage backups.
- **Options:**
  - **Option A — Persistent Single-Node VPS:** Docker + persistent SSD volume + unified `STORAGE_ROOT_DIR`, queued `pg-boss` audio DSP (`concurrency: 1`), `OutputRetentionService` scheduled cleanup, and automated `pg_dump` + offsite snapshot backups. (`1` API replica enforced.)
  - **Option B — Single-Node PaaS + Managed PostgreSQL + Unified S3/R2 Object Storage:** Repair all 4 S3 bugs and unify `sources`, `outputs`, `audio`, and `documents` onto private S3/Cloudflare R2 buckets so ephemeral PaaS redeploys preserve user data (`1` API replica enforced until Redis).
  - **Option C — Multi-Replica Cloud Architecture:** Load-balanced API + dedicated Worker container + Managed PostgreSQL + S3/R2 + Redis (`env.REDIS_URL` for `DualRateLimiter`, `StreamTicketService`, `RealtimeSessionManager`).
  - **Option A+B Hybrid — Persistent Single-Node API + Queued Local DSP + Fixed Unified S3/R2 Storage (Approved):** Retain `1` API replica with persistent local/SSD temp workspace and queued `pg-boss` audio DSP (`concurrency: 1`), AND repair all 4 `S3CompatibleStorageProvider` bugs plus `OutputRetentionService` + automated `pg_dump`/object backup so R2 deployments can use unified private S3/R2 without ephemeral data loss.
- **Owner Approval Field:** `[ ] Option A`  `[ ] Option B`  `[ ] Option C`  `[x] Option A+B Hybrid` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

### `POD-02` — Multi-Tenancy Architecture (`MF-32`, `SEC-TEN-01`)
- **Problem:** `docs/05_DATA_ARCHITECTURE_AND_API.md` specifies `organization_id` + PostgreSQL RLS, but zero `community_id`/`organization_id` columns or RLS policies exist across 21 tables (`idx_setlists_single_active` is DB-global; `background_jobs.tenant_id` is hardcoded `'bethesda-default'`).
- **Options:**
  - **Option A — Single-Church DB Instance for Phase R2 (Recommended for R2 velocity):** Explicitly document single-congregation-per-DB deployment boundary (never co-mingle congregations in one DB) and defer multi-tenant `community_id` + PostgreSQL RLS across 21+ tables + 48+ test suites to `R3+`.
  - **Option B — Immediate Multi-Church SaaS RLS in Phase R2:** Implement `organizations` table, `organization_id` FKs, per-community active setlist, JWT tenant claims, and PostgreSQL RLS policies across all tables during R2 (`XL+` schedule impact).
- **Owner Approval Field:** `[x] Option A`  `[ ] Option B` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

### `POD-03` — Governance of `APPROVED` Songs & Draft Lifecycle (`MF-07`, `MF-21`, `MF-27`, `RR-10`)
- **Problem:** `POST /songs` accepts `status: 'APPROVED'` behind `songs:create` only; imports/documents/conversions auto-approve without human review; `MUSICIAN` can create/activate versions on `APPROVED`/`ARCHIVED` songs; single-format completion approval leaks global `APPROVED` status across unreviewed `STAFF_NOTATION`/`TABLATURE`; Song `PATCH`/`status`/`DELETE` HTTP routes are missing.
- **Options:**
  - **Option A — Strict Admin-Only Approval:** Restrict `songs:approve` strictly to `ADMIN` & `SUPER_ADMIN` everywhere (blocking `WORSHIP_LEADER` from final catalog/completion approvals); force `'DRAFT'` on all uploads/imports/AI outputs.
  - **Option B — Ministry-Aligned Human Review (Recommended & Approved):** Authorize `WORSHIP_LEADER`, `ADMIN`, and `SUPER_ADMIN` to explicitly review & approve (`songs:approve`), enforce mandatory `'DRAFT'` on every creation/import/upload/AI output, isolate per-format approvals (`approvedFormats[]`), and block `MUSICIAN`/`VIEWER` from mutating `APPROVED`/`ARCHIVED` active versions.
- **Owner Approval Field:** `[ ] Option A`  `[x] Option B` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

### `POD-04` — Transactional SMTP Onboarding & Account Recovery (`MF-24`, `MF-25`, `SEC-IAM-01`)
- **Problem:** Zero SMTP/mailer exists (`UNCONFIGURED_MOCK`); `POST /users/invite` and `/resend-invite` leak plaintext `invitationToken` in production HTTP JSON; `/auth/forgot-password` cannot deliver tokens in production; `/accept-invite`, `/forgot-password`, and `/reset-password` do not exist in the frontend.
- **Options:**
  - **Option A — Transactional SMTP Provider + Complete Onboarding UI (Recommended):** Configure SMTP (`nodemailer` + transactional relay), strip `invitationToken` cleanly from HTTP JSON and logs, enable atomic single-use email tokens, and build `/accept-invite`, `/forgot-password`, and `/reset-password` UI flows.
  - **Option B — No SMTP in R2 (Out-of-Band Temporary Password Flow):** Remove `invitationToken` HTTP exposure and disable self-service email reset; admins issue one-time passwords via `MUST_CHANGE_PASSWORD` out-of-band.
  - **Option C — SMTP Primary + `SUPER_ADMIN` Break-Glass Fallback (Approved):** Wire transactional SMTP (`nodemailer` + `/accept-invite`, `/forgot-password`, `/reset-password`) and suppress tokens in prod HTTP/logs, paired with a documented audited `SUPER_ADMIN` out-of-band temporary-password reset fallback when SMTP is unavailable. *(Follow-up: confirm SMTP provider prior to staging/production deploy in `WS-R2.2` / `GATE 6`.)*
- **Owner Approval Field:** `[ ] Option A`  `[ ] Option B`  `[x] Option C` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

### `POD-05` — Git Index Bloat Hygiene & `imageio-ffmpeg` GPLv3 Licensing (`MF-34`, `MF-47`, `RR-15`, `RR-16`)
- **Problem:** Git index tracks `7,367` files in `backend/node_modules/` (`103.8 MiB`) and `223` files in `backend/storage/`. Separately, `workers/audio_worker/requirements.txt` pins `imageio-ffmpeg` bundling a static **GPLv3** FFmpeg binary invoked via isolated OS subprocess.
- **Options:**
  - **Git A1 (Recommended & Approved):** Harden `.gitignore` (`backend/storage/**`) and run forward-only `git rm -r --cached` (no history rewrite; keeps local files & verified backups + `.gitkeep`) + verify `npm ci`.
  - **Git A2:** Keep `backend/node_modules/` and `backend/storage/` tracked in Git.
  - **FFmpeg B1 (Recommended for private server deploys):** Maintain `imageio-ffmpeg` strictly server-side behind out-of-process IPC (keeping `.venv/` untracked) with formal GPLv3 compliance review before any container/installer redistribution.
  - **FFmpeg B2 (Approved):** Replace `imageio-ffmpeg` with an external LGPLv2.1+ / user-installed `ffmpeg` system binary (`Track 3D` follow-up: document OS binary requirement in `README.md`, `docker-compose.yml`, and `python-audio-worker-bridge` preflight).
- **Owner Approval Field:** **Git:** `[x] A1` `[ ] A2` | **FFmpeg:** `[ ] B1` `[x] B2` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

---

## 2. Operational, Governance & Product Scope Decisions (`POD-06` through `POD-09`, plus `OI-01`)

### `POD-06` — Governance Closure, Public Privacy Leaks & Dirty Working Tree (`MF-48`)
- **Items Authorized Under `GATE 1` (`PR #3` ONLY):**
  1. Enable GitHub branch protection on `main` (block force-push/deletion, require PR integration, solo-owner friendly without 2nd-reviewer deadlock).
  2. Execute one controlled Stage 0 Governance PR (`#3`, `docs/stage-0-governance-and-master-plan`) scrubbing: (a) `98919fe8` personal email/username exposures (`BETHESDA_WORSHIP_STUDIO_POST_RESTORE_PRE_MERGE_ACCEPTANCE_REPORT.md:80`, `BETHESDA_WORSHIP_STUDIO_PR2_FINAL_INDEPENDENT_PRE_MERGE_AUDIT.md:151,183`), (b) `14` pre-existing local file URIs / raw Windows paths in `docs/WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.md:105` (1), `docs/reports/PHASE_3B_REALTIME_LITURGICAL_FLOW_IMPLEMENTATION_REPORT.md` (11), and `docs/reports/PHASE_3C_MULTITRACKS_OMR_IMPLEMENTATION_REPORT.md` (2), and (c) reconciling the stale `"Phase 2B.1 NOT STARTED"` wording across `docs/governance/` and `98919fe8` reports while preserving all pre-sanitization SHA-256 checksums.
  3. **Category D Disposition** (`BETHESDA_WORSHIP_STUDIO_PHASE_R2_UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md`): `[ ] Option A` (verbatim `feature` blob) | `[ ] Option B` (keep `main`, discard `+2/-1` delta) | `[x] Option C` (sanitized PR updating `765a6312`, fixing `docs/governance/` L11 path, converting `61` local file links to repo-relative links + preserving `e2ccebc1` / `f6c03cc0` SHA-256 history — **Approved**).
  4. Resolve live working-tree line 23 whitespace diff on `backend/src/interfaces/http/middlewares/auth-middleware.ts` cleanly (`0` source edits, deferring `.gitattributes` to Stage 1 `REM-04` per Conflict `C-06`); defer `git fetch --prune origin` and historical retirement of `feature/phase-1a-core-foundation` / `docs/git-governance-and-post-reversal-recovery` until after PR `#3` is merged by Project Owner. *(Historical commit rewrite remains excluded unless separately authorized.)*
- **Owner Approval Field:** `[x] Approve Stage 0 Governance PR (#3)`  `[ ] Hold` — **Category D:** `[ ] Opt A` `[ ] Opt B` `[x] Opt C` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

### `POD-07` — Song Deletion Semantics vs. Immutable `song_versions` (`MF-18`, `MF-21`, `RR-02`)
- **Problem:** Fixing `song_versions.song_id` from `ON DELETE CASCADE` to `ON DELETE RESTRICT` + adding immutability triggers preserves audit/version history, which makes hard-deleting any song with versions fail cleanly with `409 Conflict` (`23503`).
- **Options:**
  - **Option A — Soft-Archive Primary Model (Recommended & Approved):** Map `DELETE /api/v1/songs/:songId` (or dedicated archive flow) to `status = 'ARCHIVED'` for any song with versions/setlist/OMR/audio references, reserving hard delete strictly for empty unused `DRAFT` records (or keep `songs` permanent once versioned).
  - **Option B — Physical Purge Under `SUPER_ADMIN` Controlled Cascade:** Require multi-table archival export + explicit force purge workflow deleting physical audio/versions together.
- **Owner Approval Field:** `[x] Option A`  `[ ] Option B` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

### `POD-08` — Logout Session Invalidation Scope (`MF-26`, `RR-09`)
- **Problem:** `POST /api/v1/auth/logout` currently leaves active access JWTs (up to 15 min) and stream tickets valid; bumping `users.tokenVersion` revokes them immediately across **all** devices logged in as that user.
- **Options:**
  - **Option A — Immediate Account-Wide `tokenVersion` + Stream Ticket Revocation on Logout:** Single click on Logout immediately revokes all active JWTs and stream tickets for that user across all tabs/devices.
  - **Option B — Per-Session `jti` Denylist + Scoped Refresh Family Revocation:** Revoke only the current browser session's refresh family and access token `jti`, leaving other devices unaffected.
  - **Option C — Split Logout (`Logout Current Session` vs `Logout All Devices`, Approved):** Normal logout revokes the active session's refresh family and active access/stream tokens (`jti` / session-scoped) so a standby stage tablet stays live, paired with an explicit `Logout All Devices` endpoint bumping `users.tokenVersion`.
- **Owner Approval Field:** `[ ] Option A`  `[ ] Option B`  `[x] Option C` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

### `POD-09` — Deferred Product Features & Orphaned Modules Disposition (`MF-34`, `MF-42`, `MF-46`, `R2-F30`)
- **Approved Scope Classification (`2026-11-27`):**
  1. **PDF/Image Real OMR Engine (`R2-F30` / `FM-15`):** `[x] Confirm Deferral to R3+` *(surface honest heuristic limits UI in `WS-R2.6`)*.
  2. **Retired `AudioPlayerBar.tsx` (`FM-53`):** `[x] Keep Retired & Purge Stale UI Copy ("reproductor superior")`.
  3. **Orphaned UI/Backend Modules (`Realtime 3B`, `Multitracks 3C`, `DocumentConversionModal`, `/ingestion/*`, `/omr/*`, `WS-2D-02..04`, `ENGRAVED_PDF`, dead duplicate `ingestion/conversion/*`):** `[x] Defer Wiring to R3+ & Clean Dead References` *(enforce `ENABLE_EXPERIMENTAL_ROUTES=false` fail-closed default in prod and exclude dead duplicate `ingestion/conversion/*` during `Stage 2B` extraction)*.
- **Owner Approval Field:** **Status:** `PROJECT OWNER APPROVED` — **Confirmed / Date:** `Project Owner — 2026-11-27`

### `OI-01` (Candidate `POD-10`) — Stage 2B `@bethesda/music-core` Extraction Timing & TypeScript Alignment (`NF-27`)
- **Approved Decision:** `[x] Option A — Execute Stage 2B packages/music-core Extraction BEFORE Parallel Stage 3 Tracks` (`GATE 4`), harmonizing `typescript` (`^5.7.3` vs `^7.0.2`) and `@types/node` workspace hoisting under clean compiled `dist/` boot checks.
- **Owner Approval Field:** `[x] Option A` — **Status:** `PROJECT OWNER APPROVED` — **Signed / Date:** `Project Owner — 2026-11-27`

---

## 3. Formal Execution Gate Sign-Off Matrix (`GATE 1` through `GATE 8`)

> **Gate Taxonomy Note:** `GATE 1`–`GATE 8` below are the authoritative **program-level** execution gates. The `GATE 1`–`GATE 8` identifiers in `docs/governance/BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md:147-158` represent legacy internal sub-gates of `WS-R2.0` only (referred to as `WS-R2.0-SG1`…`SG8` across Stage 0 planning; see `STAGE_0_GATE_PREREQUISITES_AND_ACCEPTANCE_MATRIX.md`).
>
> **`GATE 1` is AUTHORIZED (`2026-11-27`) for Stage 0 governance record updates, privacy/Category D PR `#3` preparation, and `main` branch protection verification.** **`GATE 2` through `GATE 8` remain STRICTLY LOCKED / `NOT AUTHORIZED` (`0` application/SQL edits allowed).**

| Gate | Scope Unlocked Upon Signature | Entry Prerequisites | Target Deliverables / Exit Proof | Authorization Status | Owner Sign-Off |
|---|---|---|---|---|---|
| **`GATE 1`** | **Decision Ratification (`POD-01`–`POD-09`, `OI-01`) + Stage 0 Doc/Git Hygiene (`PR #3` Only)** | Master Planning Docs & Stage 0 Dossier delivered | Approved `POD-01`–`POD-09` + `OI-01`; scrubbed `98919fe8` + `14` `docs/` leaks; Cat D Option C; clean `auth-middleware.ts`; `main` branch protection + PR `#3` open | **`PROJECT OWNER APPROVED — GATE 1 ONLY`** | `[x] Approved` — Date: `2026-11-27` |
| **`GATE 2`** | **Authorize `WS-R2.0` Controlled Certification Baseline Only (`REM-01`, `REM-02`, `REM-03`, `REM-04`)** | `GATE 1` closed (PR `#3` merged + `main` protected) | Least-privilege SQL role, fixed FE `tsx --test` runner, untracked `node_modules` & `storage/*` (`A1`), `.gitattributes`, `0` source feature changes | **`NOT AUTHORIZED`** | `[ ] Authorize WS-R2.0 Only` — Date: \_\_\_\_\_ |
| **`GATE 3`** | **Isolated PG & Core Test Execution Gate (`REM-02`)** | `GATE 2` deliverables on branch | `48/48` backend PG suites (disposable `bethesda_worship_r2_cert_tmp` under non-superuser role), `629+/629+` FE `tsx`, `18/18` Python `.venv`, temp DB dropped | **`BLOCKED BY GATE 2`** | *(Verified by Agent 8 & Agent 9)* |
| **`GATE 4`** | **Authorize Stage 2 Structural Work (`0021` DDL Migration + `packages/music-core` Extraction)** | `GATE 3` green baseline + approved `POD-02`, `POD-07`, `OI-01` | Clean `0000`–`0021` DB replay, zero `../frontend/` imports in `backend/src`, compiled `dist/server.js` & `dist/db/migrate.js` boot check | **`NOT AUTHORIZED`** | `[ ] Authorize Stage 2` — Date: \_\_\_\_\_ |
| **`GATE 5`** | **Authorize Stage 3 Track 3A & 3B (`WS-R2.1`: Musical, Projection, Rendering Generators & Exporters)** | `GATE 4` + approved `POD-03` | *En Tu Presencia* 10-stage E2E regression green, lossless MusicXML/MIDI round-trips, zero `0.1`/fabrication defaults | **`NOT AUTHORIZED`** | `[ ] Authorize Stage 3 Music` — Date: \_\_\_\_\_ |
| **`GATE 6`** | **Authorize Stage 3 Track 3C & 3D (`WS-R2.2`, `R2.3`, `R2.4`: Security, RBAC, CRUD, Queue, Storage)** | `GATE 4` + approved `POD-01`, `POD-03`, `POD-04`, `POD-05 B2`, `POD-07`, `POD-08`, `POD-09` | Zero P0 security findings, ACID contention suites green, queued audio DSP (`202`), retryable jobs, retention & verified backup/restore drill | **`NOT AUTHORIZED`** | `[ ] Authorize Stage 3 BE/Ops` — Date: \_\_\_\_\_ |
| **`GATE 7`** | **Authorize Stage 3E & Stage 4 (`WS-R2.6` Stage UX, Offline Loop, Bundle `<800 kB`, Manual Acceptance `M-01`–`M-07`)** | `GATE 5` & `GATE 6` green | Vite split `< 800 kB`, offline cold-boot open working, keyboard arbiter/mobile layout green, Project Owner completes manual matrix `M-01`–`M-07` | **`NOT AUTHORIZED`** | `[ ] Authorize Stage 4 UI` — Date: \_\_\_\_\_ |
| **`GATE 8`** | **Production Release Readiness / `R3+` Unlock** | `GATE 7` PASS + Owner manual sign-off (`M-01`–`M-07`) + 15–30m soak telemetry | Final Release Candidate tagged `vX.Y.Z` with SHA-256 checksums; `R3+` roadmap separately authorized | **`HARD STOP / NOT AUTHORIZED`** | `[ ] Release Sign-Off` — Date: \_\_\_\_\_ |

---

## Version & Change History

- **v1.0** — `2026-11-26` (`UTC-05:00`) — Initial Master Project Owner Decision Register (`POD-01`–`POD-09`, `GATE 1`–`GATE 8`).
- **v1.1** — `2026-11-27` (`UTC-05:00`) — Stage 0 evidence-backed reconciliation:
  - Corrected `POD-06` item 2(b) count of pre-existing leaks across `docs/` from `13` to **`14`** (`1` in governance audit + `11` in Phase 3B report + `2` in Phase 3C report, verified by Agent 9 §1.3 & §4.4).
  - Added mandatory `POD-07` prerequisite to **`GATE 4`** entry criteria because migration `0021` implements `song_versions` `ON DELETE RESTRICT` + immutability triggers (evidence: Agent 4 §2, Agent 10 §5.2).
  - Added Gate Taxonomy Note clarifying program-level `GATE 1`–`GATE 8` vs legacy `WS-R2.0-SG1`…`SG8` sub-gates (Conflict `C-02`, Agent 9 §1.2) and updated `GATE 5` reference to 10-stage *En Tu Presencia* suite. All approval checkboxes remain `[ ]` unsigned.
- **v1.2** — `2026-11-27` (`UTC-05:00`) — Recorded formal Project Owner approvals for `STAGE 0 GATE 1 ONLY`: `POD-01 A+B Hybrid`, `POD-02 Opt A`, `POD-03 Opt B`, `POD-04 Opt C`, `POD-05 Git A1 / FFmpeg B2`, `POD-06 Stage 0 PR #3 + Category D Opt C`, `POD-07 Opt A`, `POD-08 Opt C`, `POD-09 R3+ Deferral & Experimental Route Gate`, and `OI-01 Opt A`. `GATE 2`–`GATE 8` and `WS-R2.0`–`WS-R2.6` remain strictly `[ ]` LOCKED / `NOT AUTHORIZED`. Also removed raw local-link token string from `POD-06` item 3 for public doc hygiene.
