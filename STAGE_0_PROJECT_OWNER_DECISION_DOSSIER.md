# BETHESDA WORSHIP STUDIO — STAGE 0 PROJECT OWNER DECISION DOSSIER

- **Date & Timezone:** `2026-11-27` (`UTC-05:00`) *(Project Owner Formal Approvals recorded `2026-11-27`)*
- **Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`
- **Authoritative Branch & HEAD SHA:** `docs/stage-0-governance-and-master-plan` branched from `main` @ `98919fe85d2c656076426d0a43a1222f9a752465`
- **Evidence References:** `MASTER_PROJECT_OWNER_DECISION_REGISTER.md` (v1.3), `MASTER_FINDINGS_AND_ROOT_CAUSE_MATRIX.md` (v1.2), `MASTER_RISK_AND_REGRESSION_REGISTER.md` (v1.2), `docs/governance/BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md`, Stage 0 Specialist & Independent Challenge Reports (`Agents 1, 4, 5, 6, 9, 10`), live PR `#3`, and active Ruleset `#28275963`.
- **Approval Status:** **`PROJECT OWNER APPROVED — 2026-11-27` (`POD-01` through `POD-09` and `OI-01` formally approved; `GATE 1: PASS` verified — PR `#3` OPEN at `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO/pull/3`, Ruleset `#28275963` ACTIVE; `GATE 2`–`GATE 8` remain `[ ]` LOCKED / `NOT AUTHORIZED`)**

---

## 1. POD Dependency & Gate Impact Matrix

| POD ID | Decision Domain | Directly Coupled PODs | Gated Execution Gates | Affected Workstreams / Tracks |
|---|---|---|---|---|
| **`POD-01`** | Hosting, Persistent Storage & Backups | Enables `POD-05 B` packaging limits; drives Redis vs single-replica (`RR-18`) | `GATE 1`, `GATE 6`, `GATE 8` | `WS-R2.4` (`Track 3D`), `WS-R2.5B`, `WS-R2.2` rate-limit store |
| **`POD-02`** | Multi-Tenancy Architecture (`MF-32`) | Shapes `0021` schema & `idx_setlists_single_active` | **`GATE 1` -> `GATE 4`** | `WS-R2.3-DDL` (`Stage 2A`), `WS-R2.2` (`Track 3C`) |
| **`POD-03`** | Governance of `APPROVED` Songs & Draft Lifecycle | Interacts with `POD-07` (`ARCHIVED` vs `DRAFT` delete/edit) | **`GATE 1` -> `GATE 5`, `GATE 6`** | `WS-R2.1` (`Track 3A`), `WS-R2.2`/`R2.3` (`Track 3C`), `WS-R2.4` (`Track 3D`), `WS-R2.6` (`Stage 4`) |
| **`POD-04`** | Transactional SMTP Onboarding & Account Recovery | Paired with `POD-08` session invalidation & `AccountStatus` transitions | **`GATE 1` -> `GATE 6`, `GATE 7`** | `WS-R2.2` (`Track 3C`), `WS-R2.6` (`Track 3E-1`, `Stage 4`) |
| **`POD-05`** | Git Index Bloat Hygiene (`A`) & `imageio-ffmpeg` GPLv3 (`B`) | `A1` is prerequisite for clean external worktrees (`RR-14`); `B1/B2` depends on `POD-01` container redistribution | **`GATE 1` -> `GATE 2` (`REM-04`), `GATE 6`, `GATE 8`** | `WS-R2.0` (`REM-04`), `WS-R2.4` (`Track 3D`), `WS-R2.5B` |
| **`POD-06`** | Governance Closure, Privacy Leaks, Category D & Dirty Tree | Must land in Stage 0 Docs PR #3 before `WS-R2.0` (`REM-04`) | **`GATE 1` -> `GATE 2`** | Stage 0 Governance PR #3 -> `WS-R2.0` |
| **`POD-07`** | Song Deletion Semantics vs Immutable `song_versions` | Paired directly with `0021` `ON DELETE RESTRICT` + triggers (`RR-02`) and `POD-03` | **`GATE 1` -> `GATE 4`**, `GATE 6` | `WS-R2.3-DDL` (`Stage 2A`), `WS-R2.3-Logic` (`Track 3C`), `WS-R2.6` (`Stage 4`) |
| **`POD-08`** | Logout Session Invalidation Scope | Paired with `StreamTicketService` & `POD-04` multi-device worship-stand UX (`RR-09`) | **`GATE 1` -> `GATE 6`** | `WS-R2.2` (`Track 3C`) |
| **`POD-09`** | Deferred Features & Orphaned/Dead Modules | Governs experimental route exposure (`MF-27`, `MF-36`) & `packages/music-core` exclusions | **`GATE 1` -> `GATE 4` (`2B`), `GATE 6`, `GATE 7`** | `WS-R2.5A` (`Stage 2B`), `WS-R2.2`/`R2.4`, `WS-R2.6` |
| **`OI-01`** | *(Open Item — Candidate `POD-10`)* `@bethesda/music-core` Extraction & TS `5.7`/`7.0` Alignment | Interacts with `POD-09` exclusion list & `REM-04` worktrees | **`GATE 1` -> `GATE 4` (`Stage 2B`)** | `WS-R2.5A` (`Stage 2B`), `Track 3A`–`3D` |

---

## 2. Detailed Decision Analysis (`POD-01` through `POD-09`)

*(Every decision includes all 12 mandatory evaluation dimensions. Recommendations are **advisory only — not selected**.)*

### `POD-01` — Hosting Topology, Persistent Storage & Backups
1. **Problem:** Local file storage volumes are absent in `docker-compose.yml:1-29`; `S3CompatibleStorageProvider` is unwired and contains 4 confirmed bugs (`403 SignatureDoesNotMatch` via post-sign `publicBaseUrl`, non-RFC-3986 encoding + `localeCompare`, `1,000`-key pagination truncation, silent `false` on HTTP `403/500`); `OutputRetentionService` has `0` production callers; zero automated DB or storage backups exist; in-memory `DualRateLimiter`/`StreamTicketService`/`RealtimeSessionManager` forbid multi-replica scaling without Redis.
2. **Evidence:** `MF-37`, `MF-38`, `MF-31`, `RR-05`, `RR-18`, `docker-compose.yml:1-29`, `backend/src/domain/storage/storage-provider.ts:633-1062`.
3. **Options:**
   - **Option A — Persistent Single-Node VPS:** Docker + persistent SSD volume + unified `STORAGE_ROOT_DIR`, `pg-boss` queued audio (`concurrency: 1`), `OutputRetentionService`, automated `pg_dump` + offsite snapshots (`1` API replica enforced).
   - **Option B — PaaS + Managed PG + S3/R2 Object Storage:** Fix all 4 S3 bugs and route `sources`/`outputs`/`audio`/`documents` to private S3/Cloudflare R2 buckets (`1` API replica enforced).
   - **Option C — Multi-Replica Cloud:** Balanced API + dedicated Worker + Managed PG + S3/R2 + Redis (`env.REDIS_URL`).
   - **Option A+B Hybrid *(Additional Alternative per Agent 9 §2)*:** Persistent VPS (API + Worker + PostgreSQL) paired with private S3/R2 exclusively for immutable binary objects and offsite encrypted backups.
4. **Recommended Option *(Advisory Only — Not Selected)*:** **Option A** (or **Option A+B Hybrid** for offsite durability without PaaS free-tier OOM exposure).
5. **Technical Consequences:** Determines `backend/src/domain/storage/` wiring, `docker-compose.yml` volume/Redis services, backup/restore drill scope, and `MF-31` distributed rate-limiter store.
6. **Risks:** Choosing Option B on `$0–7/mo` free PaaS nodes risks OOM/timeouts during `pg-boss` continuous polling + Python STFT/HPSS (`NF-12`); running `OutputRetentionService` before fixing S3 HTTP `403/500` causes silent orphan corruption or live object loss (`RR-05`); scaling `>1` replica without Redis causes split rate-limits & `401` ticket failures (`RR-18`).
7. **Irreversible Traps:** Deleting local outputs via retention or losing ephemeral PaaS local disks before offsite backups/S3 parity are verified causes **irreversible user file loss**.
8. **Additional Alternatives Identified:** Option A+B Hybrid (single persistent VPS compute + S3/R2 offsite immutable backup/blob durability).
9. **Dependencies on Other PODs:** Drives `POD-05 B1` vs `B2` (whether container images get redistributed externally).
10. **Gates Unlocked:** `GATE 1`, `GATE 6`, `GATE 8`.
11. **Workstreams Affected:** `WS-R2.4` (`Track 3D`), `WS-R2.2` (`Track 3C`), `WS-R2.5B` (`Stage 4`).
12. **Owner Approval Field:** `[ ] Option A`  `[ ] Option B`  `[ ] Option C`  `[x] Option A+B Hybrid` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-02` — Multi-Tenancy Architecture & Isolation Boundary
1. **Problem:** `docs/05_DATA_ARCHITECTURE_AND_API.md:264-275` claims `organization_id` + PostgreSQL RLS, while `backend/src/db/schema.ts:132-1015` has zero tenant columns/FKs/RLS (`idx_setlists_single_active` is DB-global; `background_jobs.tenant_id:837` is hardcoded `'bethesda-default'`).
2. **Evidence:** `MF-32`, `SEC-TEN-01`, `schema.ts:433-435,837`, `auth-types.ts:219-227`. *(Master doc note: `MASTER_MULTI_AGENT_ARCHITECTURE:147` inversion fixed to match Option A = defer RLS.)*
3. **Options:**
   - **Option A — Single-Church DB Instance for R2:** Enforce explicit single-congregation-per-DB invariant (`SINGLE_TENANT_MODE` contract), remove misleading RLS claims from Doc 05, and defer multi-tenant `community_id` + PG RLS to `R3+`.
   - **Option B — Immediate Multi-Church SaaS RLS in R2:** Add `organizations` table, `organization_id` FKs across all 22 tables, per-org active setlists, JWT org claims, and PostgreSQL RLS policies across 48+ backend test suites now.
4. **Recommended Option *(Approved — `2026-11-27`)*:** **Option A** for R2 velocity and reliability.
5. **Technical Consequences:** Directly sets migration `0021` schema complexity (`21->22` tables vs full RLS rewrite across every repository and test suite).
6. **Risks:** Co-mingling two churches inside one un-partitioned DB under Option A guarantees cross-church data leakage; attempting Option B in R2 blows up timeline (`XL+`) and requires auditing every raw query, `pg-boss` worker context, and offline cache key.
7. **Irreversible Traps:** Allowing multiple congregations into one database without `organization_id` creates non-trivial manual data disentanglement later.
8. **Additional Alternatives Identified:** Explicit single-tenant config assertion at boot + pre-documented `R3+` additive migration path.
9. **Dependencies on Other PODs:** Blocks `GATE 4` (`0021` DDL freeze) and shapes `POD-07` / `MF-17`.
10. **Gates Unlocked:** `GATE 1`, `GATE 4`.
11. **Workstreams Affected:** `WS-R2.3-DDL` (`Stage 2A`), `WS-R2.2` (`Track 3C`), all backend tests.
12. **Owner Approval Field:** `[x] Option A`  `[ ] Option B` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-03` — Governance of `APPROVED` Songs & Draft Lifecycle
1. **Problem:** `POST /songs` lets any `songs:create` user set `status: 'APPROVED'`; document/universal ingestion/audio/conversion workflows auto-approve without human review; `MUSICIAN` can mutate versions of `APPROVED` songs; single-format completion approval leaks global `APPROVED` status across unreviewed `STAFF_NOTATION` & `TABLATURE`; Song `PATCH`/`status`/`DELETE` HTTP endpoints are missing.
2. **Evidence:** `MF-07`, `MF-21`, `MF-27`, `RR-10`, `NF-07`, `song.schemas.ts:34`, `stand-format-capabilities.ts:105-112,255-258`, `musical-content-completion-service.ts:1261`.
3. **Options:**
   - **Option A — Strict Admin-Only Approval:** Only `ADMIN` & `SUPER_ADMIN` hold `songs:approve`; `WORSHIP_LEADER` cannot approve; all uploads/imports/AI drafts force `'DRAFT'`.
   - **Option B — Ministry-Aligned Human Review:** Authorize `WORSHIP_LEADER`, `ADMIN`, and `SUPER_ADMIN` for explicit `songs:approve`; force `'DRAFT'` on all creations/uploads/imports/AI drafts; isolate per-format `approvedFormats[]`; lock `APPROVED`/`ARCHIVED` active versions from `MUSICIAN`/`VIEWER`.
4. **Recommended Option *(Approved — `2026-11-27`)*:** **Option B**, paired with clear UI `"Borrrador — Requiere aprobación"` feedback & 1-click approve button for leaders (`RR-10`).
5. **Technical Consequences:** Locks RBAC matrix (`auth-types.ts`, `song.routes.ts:231`, `audio.routes.ts:918,947`, `omr.routes.ts:264`), `StandFormatCapabilityResolver` (`approvedFormats[]`), and Stage 4 UI workflow.
6. **Risks:** Forcing `'DRAFT'` without shipping clean Stage 4 approval UI blocks Sunday rehearsal workflows (`RR-10`); Option B allows `WORSHIP_LEADER` self-approval (`songs:create` + `songs:approve`) unless dual-actor review is required.
7. **Irreversible Traps:** Retroactively revoking previously auto-approved legacy catalog songs without an idempotent backfill of `approvedFormats[]` could suddenly hide church repertoire during Sunday service.
8. **Additional Alternatives Identified:** Option B with optional dual-review flag (creator `!==` approver for `ADMIN` audit policy) — verify if ministry allows leader self-approval.
9. **Dependencies on Other PODs:** Tightly coupled to `POD-07` (`ARCHIVED` transition rules) & `POD-09` (document conversion routes).
10. **Gates Unlocked:** `GATE 1`, `GATE 5`, `GATE 6`.
11. **Workstreams Affected:** `WS-R2.1` (`Track 3A`), `WS-R2.2`/`R2.3` (`Track 3C`), `WS-R2.4` (`Track 3D`), `WS-R2.6` (`Stage 4`).
12. **Owner Approval Field:** `[ ] Option A`  `[x] Option B` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-04` — Transactional SMTP Onboarding & Account Recovery
1. **Problem:** Zero SMTP transport exists (`UNCONFIGURED_MOCK`); `POST /users/invite` and `/resend-invite` leak raw plaintext `invitationToken` in production JSON; `/auth/forgot-password` cannot deliver tokens in production; `/accept-invite`, `/forgot-password`, and `/reset-password` do not exist in frontend UI.
2. **Evidence:** `MF-24`, `MF-25`, `SEC-IAM-01`, `invitation-service.ts:109-170`, `user.routes.ts:121,156`, `password-reset-service.ts:49-76`.
3. **Options:**
   - **Option A — Transactional SMTP Provider + Full Onboarding UI:** Wire `nodemailer` + verified SMTP relay (`Resend`/`Brevo`/SMTP host), strip tokens from HTTP JSON & Pino logs, fail closed at prod boot if SMTP unset, build `/accept-invite`, `/forgot-password`, `/reset-password`.
   - **Option B — Out-of-Band Temporary Password Flow (No SMTP in R2):** Strip JSON token exposure, disable self-service email reset in R2, admins issue temporary password with `MUST_CHANGE_PASSWORD`.
   - **Option C — SMTP Primary + `SUPER_ADMIN` Break-Glass Fallback *(Additional Alternative per Agent 9 §2)*:** SMTP when domain `SPF`/`DKIM`/`DMARC` is configured, OR controlled admin-only break-glass 15-min single-display one-time link (never in logs/normal JSON) if church lacks custom DNS domain.
4. **Approved Selection (`2026-11-27`):** **Option C — SMTP Primary + `SUPER_ADMIN` Break-Glass Fallback** *(Implementation follow-up: confirm exact SMTP relay vendor & DNS `SPF`/`DKIM`/`DMARC` readiness before Track 3C).*
5. **Technical Consequences:** Governs `backend/package.json` (`nodemailer`), `env.ts` SMTP validation, `api-client.ts` & `App.tsx` routes, and rollback behavior on SMTP failure mid-invite.
6. **Risks:** Shipping Option A without verified `SPF`/`DKIM`/`DMARC` locks out new user onboarding; non-atomic invite DB commit before SMTP failure strands `PENDING_INVITATION` accounts.
7. **Irreversible Traps:** None at DB level, provided tokens never enter production HTTP responses or immutable logs.
8. **Additional Alternatives Identified:** Option C (conditional `SUPER_ADMIN` out-of-band break-glass onboarding if SMTP domain is absent).
9. **Dependencies on Other PODs:** Coordinates with `POD-08` session invalidation and `NF-05` (`/change-initial-password` rate limit & status gate).
10. **Gates Unlocked:** `GATE 1`, `GATE 6`, `GATE 7`.
11. **Workstreams Affected:** `WS-R2.2` (`Track 3C`), `WS-R2.6` (`Track 3E-1`, `Stage 4`).
12. **Owner Approval Field:** `[ ] Option A`  `[ ] Option B`  `[x] Option C (Provider / DNS follow-up in Track 3C)` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-05` — Git Index Bloat Hygiene (`A`) & `imageio-ffmpeg` GPLv3 Licensing (`B`)
1. **Problem:** Git tracks `7,367` files in `backend/node_modules/` (`103.8 MiB`) and `223` files in `backend/storage/`. Separately, `workers/audio_worker/requirements.txt` bundles **GPLv3** `imageio-ffmpeg` invoked as a Python worker subprocess.
2. **Evidence:** `MF-47`, `MF-34`, `RR-14`, `RR-15`, `RR-16`, `TASK-23864` preflight (`TOTAL_TRACKED=8,894`).
3. **Options:**
   - **Git Scope Conflict Note (`Conflict C-07`):** Master docs propose untracking BOTH `backend/node_modules/` (`7,367`) AND `backend/storage/*` (`223`), whereas legacy `docs/governance/...WS_R2_0...md:84,126` instructed keeping `223` `backend/storage/` files untouched. Explicit Project Owner confirmation is required:
     - **Git A1:** Harden `.gitignore` (`backend/storage/**` preserving `.gitkeep`s) + forward-only `git rm -r --cached` for **both** `backend/node_modules/` and `backend/storage/*` (preserving local files + backing up test fixtures).
     - **Git A1b *(Strict `WS-R2.0:126` Variant)*:** Untrack `backend/node_modules/` (`7,367`) only; audit & retain curated `backend/storage/` fixtures.
     - **Git A2:** Keep both tracked in Git.
   - **FFmpeg Licensing (`B`):**
     - **FFmpeg B1 (Private server deploys only):** Keep `.venv` `imageio-ffmpeg` strictly server-side behind out-of-process IPC + compliance notices (no `.venv` in Git).
     - **FFmpeg B2 (Zero GPLv3 redistribution risk):** Support/prefer external LGPLv2.1+ system `ffmpeg` binary (`shutil.which("ffmpeg")` / `FFMPEG_PATH` override).
4. **Approved Selection (`2026-11-27`):** **Git A1 + FFmpeg B2** *(Follow-up: verify external/local backup of `backend/storage/` fixture files before running `REM-04` and confirm host LGPLv2.1+ `ffmpeg` installation in Track 3D / `WS-R2.5B`).*
5. **Technical Consequences:** Gate-unlocks external OneDrive-free worktrees (`C:\dev\bws-wt\`) cleanly (`RR-14`) and determines container/worker build rules (`WS-R2.5B`).
6. **Risks:** Pulling `A1` deletes local untracked `node_modules/` until `npm ci` runs (`RR-15`); shipping Docker/VM images containing `imageio-ffmpeg` GPLv3 wheels triggers copyleft distribution obligations (`RR-16`); forward-only `git rm --cached` leaves historical `103.8 MiB` packfile in `.git` history permanently unless a separate history rewrite is authorized.
7. **Irreversible Traps:** Untracking `223` `backend/storage/` files without backing up fixture references used by tests/seed scripts could break dev workflows; public container distribution of `B1` creates GPLv3 compliance liability.
8. **Additional Alternatives Identified:** **Git A1b** (untrack `node_modules` only per `WS-R2.0:126` while preserving/relocating storage fixtures to `fixtures/`).
9. **Dependencies on Other PODs:** `POD-06` merges before `REM-04` (`A1`); `POD-01` (`Option A+B` containers) aligns cleanly with `FFmpeg B2`.
10. **Gates Unlocked:** `GATE 1`, `GATE 2` (`REM-04`), `GATE 6`, `GATE 8`.
11. **Workstreams Affected:** `WS-R2.0` (`REM-04`), `WS-R2.4` (`Track 3D`), `WS-R2.5B` (`Stage 4`).
12. **Owner Approval Field:** **Git:** `[x] A1` `[ ] A1b` `[ ] A2` | **FFmpeg:** `[ ] B1` `[x] B2` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-06` — Governance Closure, Public Privacy Leaks, Category D & Dirty Working Tree
1. **Problem:** Commit `98919fe8` pushed 2 reports with custody contradictions (`L28`, `L211`), raw email/author (`POST_RESTORE:80`), and OS username (`PR2_AUDIT:151,183`); Category D root matrix has `61` local file URIs & stale branch `d9353442`; `docs/` holds **`14`** pre-existing local path leaks (`1 + 11 + 2`); `7` governance docs falsely state `"Phase 2B.1 NOT STARTED"`; `auth-middleware.ts:23` holds pre-existing whitespace diff on dirty `main`; `origin/revert-1` is stale; `main` branch protection is `NOT VERIFIED`.
2. **Evidence:** `MF-48`, `NF-28`, Agent 9 §4, Agent 10 §1 & §4, `STAGE_0_REPOSITORY_AND_CERTIFICATION_BASELINE.md` §2/§3/§7/§8.
3. **Options:**
   - **Governance PR Scope:** `[x] Approve Stage 0 Governance PR #3` (enable `main` protection, revert `auth-middleware.ts:23` whitespace diff cleanly, scrub `98919fe8` + `14` `docs/` leaks + Phase 2B.1 status wording, keep `.gitattributes` renormalization deferred to Stage 1 `REM-04` per Conflict `C-06`) vs `[ ] Hold`.
   - **Category D Disposition (`BETHESDA_WORSHIP_STUDIO_PHASE_R2_UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md`):**
     - **Option A:** Promote verbatim `feature/phase-1a-core-foundation` blob (`f6c03cc0`). *(Retains `62` local file URIs!)*
     - **Option B:** Keep current `main` matrix untouched and discard `+2/-1` `feature` delta. *(Retains `61` local file URIs!)*
     - **Option C (Approved — `2026-11-27`):** Publish a clean, sanitized PR updating `765a6312`, fixing broken `docs/governance/` line-11 relative path, converting all `61`/`62` local file URIs to repo-relative links, and recording a dated SHA-256 reconciliation addendum preserving the `2026-11-21` original digest auditably.
4. **Approved Selection (`2026-11-27`):** **Approve Stage 0 Governance PR #3 + Category D Option C** (with `.gitattributes` deferred to Stage 1 `REM-04`).
5. **Technical Consequences:** Unblocks protected `main` and creates the clean PR-based branch baseline required by `WS-R2.0`.
6. **Risks:** Bundling `.gitattributes` (`* text=auto eol=lf`) in Stage 0 would touch CRLF code files inside a doc-only PR (`Conflict C-06`); Category D Option C changes file SHA-256 vs the `2026-11-21` baseline (mitigated by preserving an explicit checksum addendum); forward-only sanitization leaves `2730ed6..98919fe8` visible in public Git history.
7. **Irreversible Traps:** Rewriting public Git history (`filter-repo` + `--force`) is irreversible and NOT authorized; retiring `feature/phase-1a-core-foundation` before Category D closure would lose branch context unless closed via Option C first.
8. **Additional Alternatives Identified:** Explicit Project Owner decision later on whether a separate historical BFG/filter-repo scrub of `2730ed6..98919fe8` is ever warranted vs keeping append-only forward history.
9. **Dependencies on Other PODs:** Gates `GATE 1` -> `POD-05 A1` (`REM-04`) -> all Stage 2–4 worktrees.
10. **Gates Unlocked:** `GATE 1`, `GATE 2`.
11. **Workstreams Affected:** Stage 0 Governance PR #3 -> `WS-R2.0`.
12. **Owner Approval Field:** `[x] Approve Stage 0 Governance PR` `[ ] Hold` | **Category D:** `[ ] Opt A` `[ ] Opt B` `[x] Opt C` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-07` — Song Deletion Semantics vs Immutable `song_versions`
1. **Problem:** Remediation `MF-18` switches `song_versions.song_id` from `ON DELETE CASCADE` to `ON DELETE RESTRICT` + DB immutability triggers (`0021`), causing physical hard-delete on any versioned song to fail with PG `23503` (`409 Conflict`).
2. **Evidence:** `MF-18`, `MF-21`, `RR-02`, `NF-03`, `backend/src/db/schema.ts:234-253,298-300`, `0000_normal_randall_flagg.sql:55`.
3. **Options:**
   - **Option A — Soft-Archive Primary Model:** Map `DELETE /api/v1/songs/:songId` (and dedicated archive action) to `status = 'ARCHIVED'` whenever versions/setlists/OMR/audio references exist; permit physical hard-delete strictly on empty unreferenced `DRAFT` songs (plus clarify CCLI/legal physical blob purge path for mistaken copyrighted uploads).
   - **Option B — Controlled `SUPER_ADMIN` Physical Purge Cascade:** Build an audited multi-table export + hard purge workflow removing DB version/audio history together.
4. **Approved Selection (`2026-11-27`):** **Option A — Soft-Archive Primary Model**.
5. **Technical Consequences:** Mandatory prerequisite for **`GATE 4`** (`0021` `ON DELETE RESTRICT` + triggers) and `NF-03` test teardown updates.
6. **Risks:** Without deciding `POD-07` before `0021`, `DELETE /songs/:id` (`MF-21`) and `conversion-api.test.ts:60` teardown conflict cleanly with `23503` (`RR-02`).
7. **Irreversible Traps:** Option B physical cascade irreversibly destroys liturgical score revision & attribution history (`MF-18`).
8. **Additional Alternatives Identified:** Option A + `SUPER_ADMIN`-only copyright-takedown tombstone (`status = 'ARCHIVED'` + physical binary removal recorded in immutable `audit_logs`).
9. **Dependencies on Other PODs:** Direct prerequisite for **`GATE 4`** (`0021`), paired with `POD-03` status governance.
10. **Gates Unlocked:** `GATE 1`, **`GATE 4`**, `GATE 6`.
11. **Workstreams Affected:** `WS-R2.3-DDL` (`Stage 2A`), `WS-R2.3-Logic` (`Track 3C`), `WS-R2.6` (`Stage 4`).
12. **Owner Approval Field:** `[x] Option A`  `[ ] Option B` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-08` — Logout Session Invalidation Scope
1. **Problem:** `POST /api/v1/auth/logout` leaves active access JWTs (`<= 15m`) and stream tickets valid (`auth-service.ts:294-315`), while immediately bumping `users.tokenVersion` revokes **every** active device logged into that user account (`RR-09`).
2. **Evidence:** `MF-26`, `RR-09`, `NF-06`, `auth.routes.ts:141,150,163`, `stream-ticket-service.ts:27-36`.
3. **Options:**
   - **Option A — Immediate Account-Wide `tokenVersion` + Stream Ticket Revocation on Logout:** Clicking Logout invalidates all active tabs/devices sharing that account immediately.
   - **Option B — Per-Session `jti` Denylist + Scoped Refresh Family Revocation:** Revokes only the current browser session's refresh token family + access JWT `jti`, leaving other devices (e.g., stage tablet) unaffected.
   - **Option C — Split Logout *(Additional Alternative per Agent 9 §2)*:** Standard `POST /auth/logout` revokes only the active session's refresh family & short-lived `jti` (protecting live stage tablets from accidental backstage logouts), while an explicit `POST /auth/logout-all` (`"Cerrar sesión en todos los dispositivos"`) increments `tokenVersion` + revokes all stream tickets.
4. **Approved Selection (`2026-11-27`):** **Option C — Split Logout** *(note: `jti` store remains single-replica unless Redis or PG-backed table added in Track 3C/3D)*.
5. **Technical Consequences:** Determines `auth-service.ts` logout DB writes, `StreamTicketService` invalidation hooks, and `clearCookie` symmetry (`NF-06`).
6. **Risks:** Under Option A, a worship leader logging out on an office laptop mid-service kicks the stage tablet off the stand (`Agent 9 §2`). Under Option B/C, in-memory `jti` denylist limits API scaling to `1` replica unless backed by PG/Redis (`POD-01`).
7. **Irreversible Traps:** None — both are reversible code/session-table strategies without destructive schema impact.
8. **Additional Alternatives Identified:** **Option C — Split Logout** (`logout` per-session + `logout-all` account-wide `tokenVersion` bump).
9. **Dependencies on Other PODs:** Interacts with `POD-01` (Redis if multi-replica `jti` denylist) & `POD-04` (password reset / account disable ALWAYS revoke account-wide via `tokenVersion` regardless of `POD-08`).
10. **Gates Unlocked:** `GATE 1`, `GATE 6`.
11. **Workstreams Affected:** `WS-R2.2` (`Track 3C`).
12. **Owner Approval Field:** `[ ] Option A`  `[ ] Option B`  `[x] Option C` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

### `POD-09` — Deferred Features, Experimental Route Exposure & Dead/Orphaned Modules Disposition
1. **Problem:** Unmounted/incomplete UI & backend modules create security attack surface (`NF-25`: live `/realtime/*`, `/multitrack/*`, `/omr/*`, `/ingestion/*` routes in `app.ts:141-145`; `NF-24`: `omr.routes.ts:204` test fixture toggle), zero-fabrication violations (`omr-proposal-handler.ts:50-52`, `NF-22` `pdf-chord-extractor.ts:203`), duplicate dead conversion stack (`ingestion/conversion/*`), and misleading UI copy (`AudioPlayerBar` retired copy in `OfflineInventoryModal.tsx:195`).
2. **Evidence:** `MF-34`, `MF-42`, `MF-46`, `NF-18`, `NF-22`, `NF-24`, `NF-25`, `NF-29`, `Agent 1 §3B`, `Agent 9 §2`.
3. **Core vs. Deferred (`R3+`) vs. Dead/Orphaned Classification:**

| Classification | Exact Scope / Modules / Routes | Approved Disposition (`2026-11-27`) |
|---|---|---|
| **Core Production (Active R2 Scope)** | `@bethesda/music-core` (`music-theory`, `canonical-model`, `tablature`, core `ingestion`, `conversion`, `projection`, `capabilities`), FE Stand (`OSMD`, `AlphaTab`, `LeadSheetDOM`, `VisualDocumentStand`), `Offline`, `Autoscroll`, `Auth`/`Users`/`Songs`/`Setlists`/`WorshipServices`/`Audio`/`Conversion`/`Documents` (Visual Stand), Python `audio_worker` | Keep, harden, test, and certify in R2 (`WS-R2.0`–`WS-R2.6`). |
| **Deferred to `R3+` (Valid Infrastructure, Experimental/Unwired UI)** | Real PDF/Image OMR engine (`R2-F30` / `FM-15`), `ENGRAVED_PDF`, binary `.mp4` video ingestion (`NF-08`), multi-tenancy (`POD-02 A`), Redis clustering, `/api/v1/realtime/*`, `/api/v1/multitrack/*`, `/api/v1/omr/*`, `/api/v1/ingestion/*`, `frontend/src/core/realtime/*` | **Defer UI activation to `R3+`**; gate experimental backend routes behind **`ENABLE_EXPERIMENTAL_ROUTES=false`** in production while keeping RBAC/security/immutability patches applied. |
| **Dead / Orphaned (Quarantine or Remove)** | Duplicate 4th conversion stack `frontend/src/core/ingestion/conversion/{chord-sheet-converter,format-evaluator,pdf-chord-extractor}.ts` (`NF-22`); unmounted `DocumentConversionModal.tsx` (`NF-18`); unmounted `omr-proposal-handler.ts`; stale `AudioPlayerBar` UI copy (`FM-53`); unused `@fastify/jwt` dep (`MF-46`); mis-cited `RealtimeLiturgicalBadge` / `core/multitracks/` verification (`NF-29`) | **Exclude from `@bethesda/music-core`**, remove dead `@fastify/jwt` & stale audio-player copy, quarantine/delete confirmed dead files after `NF-29` verification. |

4. **Approved Selection (`2026-11-27`):** **Defer Real OMR & Experimental Features to R3+ per Approved Classification Table Above** *(Follow-up: confirm `/documents/:key/{analyze,convert-song}` retention for active `VisualDocumentStand` / PDF song import before Stage 4 cleanup).*
5. **Technical Consequences:** Shrinks `packages/music-core` scope cleanly (`Stage 2B`), eliminates reachable unmounted OMR/ingestion DoS surface (`NF-25`), and removes contradictory `"reproductor superior"` UI text.
6. **Risks:** Leaving `/realtime/*`, `/multitrack/*`, `/omr/*`, `/ingestion/*` unconditionally live in `app.ts:141-145` keeps `25 MiB` body limits & dormant attack surfaces exposed even when UI hides them (`Agent 9 §2`).
7. **Irreversible Traps:** Deleting `/documents/:key/analyze` without checking `VisualDocumentStand`'s active preview workflow (`ConversionCenter` / PDF Song import) would break document-based song creation.
8. **Additional Alternatives Identified:** Explicit `ENABLE_EXPERIMENTAL_ROUTES` boolean in `env.ts` (`true` only in test/R3 opt-in; `false` by default in prod) so existing backend integration suites continue running while production stays hardened.
9. **Dependencies on Other PODs:** Feeds directly into `OI-01` (`packages/music-core` exact module boundary).
10. **Gates Unlocked:** `GATE 1`, `GATE 4` (`Stage 2B`), `GATE 6`, `GATE 7`.
11. **Workstreams Affected:** `WS-R2.5A` (`Stage 2B`), `WS-R2.2`/`R2.4` (`Track 3C/3D`), `WS-R2.6` (`Track 3E/Stage 4`).
12. **Owner Approval Field:**
    - Real OMR Engine (`R2-F30`): `[x] Defer to R3+` `[ ] Scope Now`
    - `AudioPlayerBar`: `[x] Keep Retired & Purge Stale Copy` `[ ] Restore Audible Playback`
    - Orphaned/Experimental Routes (`ENABLE_EXPERIMENTAL_ROUTES=false` in prod) & Dead Stack Cleanup: `[x] Defer & Quarantine/Remove` `[ ] Prioritize Specific Module: __________`
    - **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

## 3. Open Item Formalized (`OI-01` — Candidate `POD-10`)

- **`OI-01` — Shared `packages/music-core` Extraction Timing & TypeScript Alignment (`MF-46`, `RR-13`, `NF-27`):**
  1. **Option A (Stage 2B Stop-the-World Extraction Before Stage 3):** Extract `@bethesda/music-core` via root `npm workspaces` (harmonizing `typescript` `^5.7.3` vs `^7.0.2` / `@types/node` hoisting, setting `rootDir: "./src"` in `backend/tsconfig.build.json`, fixing `.env` & Python paths, emitting clean `dist/server.js`) **before** parallel Stage 3 tracks begin (`GATE 4`).
  2. **Option B (Defer Extraction to Post-Stage 3):** Fix P0 musical & security defects on current cross-imported layout first.
- **Owner Approval Field (`OI-01`):** `[x] Option A (Stage 2B — GATE 4)`  `[ ] Option B (Defer)` — **Status:** **`PROJECT OWNER APPROVED`** — **Signed / Date:** `Project Owner Written Authorization / 2026-11-27`

---

## 4. Open Implementation Follow-Up Tasks & Version History

- **Remaining Implementation-Specific Follow-Up Tasks (Tracked Explicitly, Not Pre-Decided):**
  1. Confirm specific S3/R2 storage provider & bucket/KMS configuration (`POD-01 A+B`).
  2. Confirm specific SMTP relay provider & verify custom domain `SPF`/`DKIM`/`DMARC` records (`POD-04 C`).
  3. Confirm external/off-git backup of `backend/storage/` test fixtures before `REM-04` (`POD-05 A1`).
  4. Verify target host/container system LGPLv2.1+ `ffmpeg` installation & packaging (`POD-05 B2`).
  5. Confirm Docker daemon startup or local PostgreSQL server availability prior to authorizing `GATE 2` / `GATE 3`.
  6. Keep `GATE 2` through `GATE 8` and workstreams `WS-R2.0`–`WS-R2.6` strictly **NOT AUTHORIZED** until explicit `GATE 2` approval.

### Version & Change History
- **v1.0** — `2026-11-27` (`UTC-05:00`) — Initial Stage 0 Project Owner Decision Dossier covering all `12` required dimensions per POD, interaction matrix, Category D 3 options, `POD-09` Core/Deferred/Dead split, and Open Item `OI-01`.
- **v1.1** — `2026-11-27` (`UTC-05:00`) — Recorded formal `PROJECT OWNER APPROVED` selections (`[x]`) for `POD-01` through `POD-09` and `OI-01` under `GATE 1` (`2026-11-27`), added explicit implementation follow-up task list without fabricating provider choices, and kept `GATE 2`–`GATE 8` locked.
- **v1.2** — `2026-11-27` (`UTC-05:00`) — Recorded independent **`GATE 1: PASS`** verification: Pull Request `#3` (`https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO/pull/3`) verified OPEN/unmerged and GitHub Ruleset `#28275963` (`BETHESDA - Protect Main`) verified active on `main`. `GATE 2`–`GATE 8` remain strictly locked / `NOT AUTHORIZED`.
