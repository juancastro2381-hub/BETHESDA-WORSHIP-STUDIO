# BETHESDA WORSHIP STUDIO — PROJECT OWNER DECISION ANALYSIS (`POD-01` TO `POD-05`)

- **Date:** `2026-11-21`
- **Branch:** `feature/phase-1a-core-foundation` (`origin/feature/phase-1a-core-foundation`, sync `0 0`)
- **Verified HEAD SHA:** `d93534429039c0ad59da9c4fedd8e714f904eed9` (R1 closure: `2ebb0fd1c4b70780e740da60342e07e81a166cdd`)
- **Scope:** Objective technical, security, operational, cost, and roadmap analysis of strategic Project Owner decisions `POD-01`–`POD-05` **WITHOUT implementing or silently selecting any option**.
- **Methodology:** Independent verification of source files (`schema.ts`, `storage-provider.ts`, `auth-types.ts`, `invitation-service.ts`, `password-reset-service.ts`, `requirements.txt`, `.gitignore`) and repository telemetry (`git ls-files`, filesystem footprints).
- **Evidence, Key Findings, Risks & Recommendations Summary:** Source inspection verified storage ephemerality, single-church schema bounds, `songs:approve` RBAC conflicts, unconfigured SMTP/JSON token exposure, `7,367` tracked `backend/node_modules/` binaries, and GPLv3 `imageio-ffmpeg` isolation; recommended options below mitigate architectural, security, operational, and licensing risks without silently approving any choice.
- **Explicit Implementation Boundaries & Required Approvals:** Zero code, schema, dependency, provider, or Git cleanup changes performed; explicit written Project Owner approvals (`POD-01`–`POD-05`) are required prior to authorizing blocked `WS-R2.x` implementation gates (`PROJECT OWNER REVIEW REQUIRED`).
- **Status:** **`PENDING PROJECT OWNER DECISION — ZERO OPTIONS APPROVED OR APPLIED`**

---

## 1. Strategic Overview & Blocking Map

| Decision ID | Topic | Blocks `WS-R2.0`? | Blocks Later Workstream(s) | Current Status |
|---|---|---|---|---|
| **`POD-01`** | Hosting & Storage Architecture (`VPS` vs `PaaS+S3` vs `Multi-Replica+Redis`) | No | **`WS-R2.4`** (and `WS-R2.3` / `R3+` Redis boundary) | `AWAITING OWNER DECISION` |
| **`POD-02`** | Multi-Tenancy (`Single-Church R2` vs `community_id + RLS`) | No | **`WS-R2.3`** vs **`R3+`** boundary | `AWAITING OWNER DECISION` |
| **`POD-03`** | Governance & Authorization of `APPROVED` Songs (`songs:approve`) | No | **`WS-R2.1`**, **`WS-R2.2`** | `AWAITING OWNER DECISION` |
| **`POD-04`** | SMTP Onboarding & Password Recovery Architecture | No | **`WS-R2.2`**, **`WS-R2.6`** | `AWAITING OWNER DECISION` |
| **`POD-05`** | Git Hygiene Cleanup (`backend/node_modules`) & GPLv3 `imageio-ffmpeg` Policy | **Partial (`REM-04`)** | **`WS-R2.0` cleanup**, **`WS-R2.5`** | `AWAITING OWNER DECISION` |

---

## 2. Detailed Independent Analysis (`POD-01` to `POD-05`, All 15 Section 6 Fields)

---

### `POD-01`: Hosting and Storage Architecture
1. **Decision ID:** `POD-01`
2. **Exact Architectural Problem:** All 4 storage providers (`sources`, `outputs`, `audio`, `documents`) hardcode or resolve local disk directories relative to `process.cwd()`, [`S3CompatibleStorageProvider`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/storage/storage-provider.ts#L633-L1062) is unreferenced dead code with 4 bugs (outputs-only, `listKeys()` 1,000 truncation, swallowed errors, broken SigV4 `publicBaseUrl`), `OutputRetentionService` never runs, `7` state maps live in single-process RAM (`DualRateLimiter`, `StreamTicketService`, `RealtimeSessionManager`, etc.), `REDIS_URL` (`env.ts:62`) is unused, and `POST /audio/:id/analyze` synchronously consumes ~250 MB heap per Python+FFmpeg subprocess.
3. **Available Options:**
   - **Option A — Single Persistent VPS (Docker + SSD Volume + Scheduled Retention + Local PG + Automated Backups):** Keep single API+worker node with unified `STORAGE_ROOT_DIR`, queued audio DSP (`concurrency: 1`), `OutputRetentionService`, and offsite `pg_dump` + volume backups; defer S3 and Redis.
   - **Option B — Single-Node Cloud PaaS + Managed PG + S3/R2 Object Storage:** Unify all 4 storage domains behind repaired `S3CompatibleStorageProvider` (so container redeploys on Render/Railway/Fly never wipe assets), keep 1 API+worker node with strictly bounded queued DSP (no Redis needed yet), and schedule `OutputRetentionService`.
   - **Option C — Multi-Replica Cloud Architecture (+ Redis + Dedicated Worker Node + S3):** Externalize rate-limiters, stream tickets, and SSE pub/sub into Redis (`REDIS_URL`), split `ConversionWorker` & Python audio analysis into separate worker instances, and use S3 across all 4 domains.
4. **Recommended Option *(Recommendation ONLY — Not Approved)*:** **Option B** (if deploying on free/ephemeral PaaS platforms) or **Option A** (if deploying on a persistent church VPS with SSD snapshots). Avoid **Option C** in R2 unless horizontal >1 replica scaling is a strict launch requirement.
5. **Technical Rationale:** Bethesda Worship Studio serves a congregation on a non-commercial budget; ephemeral PaaS wipes local disk on every deploy (destroying uploaded audio/PDFs), making Option B's R2/S3 layer essential there, whereas a single persistent VPS makes Option A simpler with minimal latency.
6. **Advantages:** Option A: lowest dev complexity & fastest local audio seek; Option B: zero redeploy data loss & cheap/free object tiers (e.g., Cloudflare R2 10 GB free); Option C: horizontal HA & zero-downtime rolling deploys.
7. **Disadvantages:** Option A: vertical capacity limit & manual host backup upkeep; Option B: requires S3 integration across 4 providers (not just `outputs`) + bucket ops; Option C: `XL` refactor cost, extra Redis infra & cross-node worker coordination.
8. **Security Implications:** S3 signed URLs / SigV4 require proper host validation & IAM bucket scoping; single-node in-memory rate limits/tickets are safe only if strictly capped at 1 API replica.
9. **Operational Implications:** Dictates `docker-compose` / container specs, backup scripts (`pg_dump` + object versioning/local tar), and container RAM limits (`>= 1 GB` recommended for Python DSP).
10. **Estimated Complexity:** Option A: `M`; Option B: `L`; Option C: `XL`.
11. **Cost Implications:** Option A: ~\$5–12/mo VPS; Option B: \$0–7/mo free PaaS + R2 free tier (`10 GB`); Option C: \$25–60+/mo (managed PG + Redis + multiple containers + S3).
12. **Consequences of Postponing:** Cannot implement durable `WS-R2.4` storage architecture, retention schedule, or backup runbooks safely.
13. **Blocks `WS-R2.0`?** **NO.**
14. **Blocks Later Workstreams?** **YES — Directly blocks `WS-R2.4`** (and clarifies Redis scope in `WS-R2.3` vs `R3+`).
15. **Explicit Project Owner Approval Field:**
    `[ ] Option A (Persistent VPS)`   `[ ] Option B (Single PaaS + S3/R2)`   `[ ] Option C (Multi-Replica + Redis + S3)`  
    **Signed / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

### `POD-02`: Multi-Tenancy Architecture
1. **Decision ID:** `POD-02`
2. **Exact Architectural Problem:** `20` of `21` PostgreSQL tables in [`schema.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/schema.ts) contain zero `community_id`/`tenant_id` or RLS policies (`background_jobs.tenant_id` at `L837` hardcodes `'bethesda-default'`), and `idx_setlists_single_active` (`0003:1`) allows strictly 1 active setlist across the entire database.
3. **Available Options:**
   - **Option A — Single-Church Architecture in Phase R2 (Defer `community_id` + RLS to `R3+`):** Treat one DB instance as one worship ministry; multiple churches run separate instances/DBs if needed.
   - **Option B — Multi-Church Architecture (`community_id` + PostgreSQL RLS + Per-Community Active Setlist) Inside Phase R2:** Redesign all 21 tables, repositories, JWT tenant context, and 48 backend tests during R2.
4. **Recommended Option *(Recommendation ONLY — Not Approved)*:** **Option A — Single-Church in R2; defer multi-tenancy to `R3+`.**
5. **Technical Rationale:** Implementing leak-proof multi-tenant RLS across 21 tables, repositories, and storage key prefixes touches nearly every query in the repo and would severely delay fixing urgent musical corruption (`R2-F01`–`R2-F10`) and security (`R2-F11`–`R2-F16`).
6. **Advantages:** Option A minimizes regression risk and keeps R2 deliverable cleanly; Option B unlocks multi-church shared hosting immediately.
7. **Disadvantages:** Option A cannot host two separate churches in one database; Option B adds `XL+` migration, testing, and tenant-isolation complexity right now.
8. **Security Implications:** Under Option A, administrators must never share one DB across untrusted congregations; under Option B, missing a single `community_id` predicate causes severe cross-church IDOR.
9. **Operational Implications:** Option A supports 1 DB/church easily; Option B reduces per-church infra overhead only at SaaS multi-church scale.
10. **Estimated Complexity:** Option A: `XS` (documentation/assertion); Option B: `XL`.
11. **Cost Implications:** Option A: `\$0` dev overhead (free DB per church or single ministry DB); Option B: higher engineering/QA cycle.
12. **Consequences of Postponing:** `WS-R2.3` migration design remains uncertain whether to alter `idx_setlists_single_active` and FK tables for `community_id`.
13. **Blocks `WS-R2.0`?** **NO.**
14. **Blocks Later Workstreams?** **YES — Directly gates `WS-R2.3` schema scope and `R3+` roadmap.**
15. **Explicit Project Owner Approval Field:**
    `[ ] Option A (Single-Church in R2 — Defer RLS to R3+)`   `[ ] Option B (Multi-Tenant community_id + RLS in R2)`  
    **Signed / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

### `POD-03`: Governance and Authorization of Songs With Status `APPROVED`
1. **Decision ID:** `POD-03`
2. **Exact Architectural Problem:** Direct contradiction across RBAC policy ([`auth-types.ts:98-113`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/auth-types.ts#L98-L113) grants `songs:approve` only to `ADMIN`/`SUPER_ADMIN`), hardcoded service checks (`omr-service.ts:382`, `completion:437`, `audio-transcription:977` allow `WORSHIP_LEADER`), open mass-assignment (`POST /songs` `song.schemas.ts:34` accepts `'APPROVED'`), 4 auto-approving ingestion/document endpoints, and `MUSICIAN` being able to publish live versions onto `APPROVED` songs (`song.routes.ts:99-161`).
3. **Available Options:**
   - **Option A — Strictly `ADMIN` & `SUPER_ADMIN` Approve (`WORSHIP_LEADER` Drafts Only):** Restrict `songs:approve` strictly to `ADMIN`/`SUPER_ADMIN` everywhere (including OMR, Completion, Audio Drafts), forcing all uploads/imports to `DRAFT`/`PENDING_REVIEW`.
   - **Option B — `WORSHIP_LEADER`, `ADMIN`, and `SUPER_ADMIN` Can Approve Strictly After Audited Human Review:** Grant `songs:approve` cleanly to `WORSHIP_LEADER` + `ADMIN` + `SUPER_ADMIN` inside `auth-types.ts` via dedicated approval endpoints, **while forbidding auto-approval on all uploads/AI/OMR/conversion paths (`status: 'DRAFT'` forced)** and **blocking `MUSICIAN` / `VIEWER` from altering active versions of `APPROVED` songs** (creating a draft version requiring review instead).
4. **Recommended Option *(Recommendation ONLY — Not Approved)*:** **Option B** (aligned with real worship-team hierarchy while guaranteeing zero unreviewed auto-approval).
5. **Technical Rationale:** Worship Leaders—not technical sysadmins—carry musical authority to verify keys, chords, tabs, and lyrics before Sunday worship; removing unreviewed bypasses preserves safety without creating administrative bottlenecks.
6. **Advantages:** Option A enforces strict creator/approver separation; Option B matches musical expertise & existing OMR/Audio UI intent while closing every bypass.
7. **Disadvantages:** Option A stalls worship rehearsal prep if admins are unavailable or non-musicians; Option B allows a `WORSHIP_LEADER` to self-approve their own manually reviewed upload via an explicit review click.
8. **Security Implications:** Both options MUST close `POST /songs` mass-assignment, remove hardcoded `'APPROVED'` in `DocumentService`/`UniversalIngestionService`/`IngestionPersistenceService`, enforce `MUSICIAN` draft isolation on `APPROVED` songs, and append immutable `audit_logs`.
9. **Operational Implications:** Requires dedicated UI/HTTP review state (`DRAFT -> PENDING_REVIEW -> APPROVED -> ARCHIVED`) for imported songs in `WS-R2.1`/`WS-R2.2`.
10. **Estimated Complexity:** `M` (either option).
11. **Cost Implications:** `\$0`.
12. **Consequences of Postponing:** Unverified uploads/AI drafts keep bypassing review into the live digital music stand (`R2-F11`).
13. **Blocks `WS-R2.0`?** **NO.**
14. **Blocks Later Workstreams?** **YES — Directly blocks `WS-R2.1` and `WS-R2.2`.**
15. **Explicit Project Owner Approval Field:**
    `[ ] Option A (ADMIN / SUPER_ADMIN Only)`   `[ ] Option B (WORSHIP_LEADER + ADMIN + SUPER_ADMIN Post-Review Only)`  
    **Signed / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

### `POD-04`: SMTP Onboarding and Password Recovery
1. **Decision ID:** `POD-04`
2. **Exact Architectural Problem:** [`invitation-service.ts:113,167`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/invitation-service.ts#L113-L167) uses `UNCONFIGURED_MOCK`; [`user.routes.ts:121,156`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/user.routes.ts#L121-L156) leaks plaintext `invitationToken` in HTTP JSON responses even in production; [`password-reset-service.ts:49-76`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/password-reset-service.ts#L49-L76) silently drops reset tokens in prod; `forgot-password` lacks per-account throttling; `/accept-invite` UI routing is missing (`App.tsx`).
3. **Available Options:**
   - **Option A — Transactional SMTP Provider (`nodemailer` + Resend / Brevo / Postmark / Church SMTP) + Zero JSON Tokens:** Integrate SMTP email delivery with SHA-256 hashed tokens in DB, strict expiration (48h invite / 30m reset), single-use consumption, resend cooldown/rate limits, anti-enumeration 200 responses, delivery health/failure telemetry, and zero plaintext tokens in HTTP JSON/logs.
   - **Option B — Manual Out-of-Band One-Time Onboarding (No SMTP Server):** Remove `invitationToken` from persistent JSON/resend logs via temporary admin password (`MUST_CHANGE_PASSWORD`) or manual out-of-band link generation and defer self-service email recovery to `R3+`.
4. **Recommended Option *(Recommendation ONLY — Not Approved)*:** **Option A** (using a free-tier transactional provider like Resend 3,000/mo or verified SMTP relay).
5. **Technical Rationale:** Production authentication without email recovery leaves locked-out users permanently stuck or forces admins to manually handle secret tokens (violating least-privilege separation).
6. **Advantages:** Option A gives standard self-service recovery and eliminates token interception in admin HTTP traffic; Option B avoids DNS (`SPF`/`DKIM`) setup right away.
7. **Disadvantages:** Option A requires Owner domain/DNS `SPF`/`DKIM` setup & adding `nodemailer`; Option B keeps self-service password reset broken in production.
8. **Security Implications:** Protects invite/reset secrets, mitigates email bombing via IP+account rate limits, and blocks `SUSPENDED`/`LOCKED` reactivation via `/invite` & `PENDING_INVITATION` activation via `/enable`.
9. **Operational Implications:** Requires configuring SMTP env vars securely (outside Git) and monitoring delivery errors without logging tokens.
10. **Estimated Complexity:** Option A: `M`–`L`; Option B: `S` (leaves recovery incomplete).
11. **Cost Implications:** Option A: `\$0` within free tiers (Resend/Brevo) or church Google Workspace relay; Option B: `\$0`.
12. **Consequences of Postponing:** Cannot fix `R2-F12` HTTP token exposure or `/accept-invite` / `/forgot-password` onboarding architecture cleanly.
13. **Blocks `WS-R2.0`?** **NO.**
14. **Blocks Later Workstreams?** **YES — Directly blocks `WS-R2.2` and `WS-R2.6`.**
15. **Explicit Project Owner Approval Field:**
    `[ ] Option A (SMTP Provider Integration — Specify: _______________)`   `[ ] Option B (No SMTP in R2 — Admin Temp Onboarding Only)`  
    **Signed / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

### `POD-05`: Git Repository Hygiene and GPLv3 / `imageio-ffmpeg` Licensing
1. **Decision ID:** `POD-05`
2. **Exact Architectural Problem:**
   - **Git Hygiene:** `git ls-files` currently tracks **`7,367` files in `backend/node_modules/` (`103.8 MiB`)** including `4` Windows native binaries (`31.7 MiB`), plus `223` tracked files in `backend/storage/`, `20` `.zip` files (`3.1 MiB`), and `87` `.sha256` files, while `<repo>/storage/` holds untracked test residuals (`non_existent_cert_dir_404`, `test-symlink-outside`).
   - **FFmpeg License Clarifications:** The repository uses **`imageio-ffmpeg>=0.6.0,<1.0.0`** in [`workers/audio_worker/requirements.txt`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/workers/audio_worker/requirements.txt#L14-L17) (not `imagemagick-ffmpeg`). Its Python wrapper is BSD-2-Clause, **but the bundled prebuilt FFmpeg executable is GPLv3 (`--enable-gpl --enable-version3`)**, invoked strictly as an isolated OS subprocess via stdin/stdout JSON+PCM pipes.
3. **Available Options:**
   - **Git Option A1 (Safe Index Untrack — No History Rewrite):** Execute `git rm -r --cached backend/node_modules` (preserving local disk dependencies), delete stray root `/storage/` test residuals, and inventory/separate genuine fixtures from tracked storage artifacts cleanly later.
   - **Git Option A2 (Keep Tracked):** Leave `7,367` `backend/node_modules/` files tracked in Git.
   - **GPLv3 Option B1 (Server-Side Isolated Subprocess + Formal Pre-Distribution Review):** Keep `imageio-ffmpeg` isolated as a separate OS process on internal/SaaS servers ONLY; prohibit redistributing `.venv`/images containing GPLv3 `ffmpeg` without full GPLv3 source compliance or swapping to LGPL-only `ffmpeg`.
   - **GPLv3 Option B2 (Replace `imageio-ffmpeg` With System LGPL `ffmpeg` During R2):** Remove `imageio-ffmpeg` from `requirements.txt` and rely on host-installed LGPL FFmpeg.
4. **Recommended Option *(Recommendation ONLY — Not Approved)*:** **Git Option A1 + GPLv3 Option B1** *(technical governance guidance, not formal legal counsel)*.
5. **Technical Rationale:** Tracking platform-specific Windows `esbuild.exe` and `argon2.node` binaries in Git breaks Linux CI/deployments and creates massive diff noise when extracting `packages/music-core` (`WS-R2.5`). Meanwhile, keeping GPLv3 FFmpeg strictly server-side behind process isolation avoids distribution triggers while preserving the certified 18/18 Python DSP pipeline unless/until desktop/container redistribution occurs.
6. **Advantages:** Option A1 removes 7,367 noisy tracked files cleanly without rewriting history; Option B1 avoids breaking Windows dev audio setup while preventing accidental binary redistribution.
7. **Disadvantages:** Option A1 requires running `npm --prefix backend ci` cleanly on new clones/CI; Option B1 requires explicit license compliance discipline if distributing downloadable bundles/Docker images externally later.
8. **Security Implications:** Untracking `node_modules` ensures `npm ci` validates exact `package-lock.json` integrity hashes on target OSes rather than running pre-committed Windows binaries.
9. **Operational Implications:** Cleans repository tooling speed and prepares `npm workspaces` (`WS-R2.5`).
10. **Estimated Complexity:** Option A1 + B1: `S`; Option B2: `M`.
11. **Cost Implications:** `\$0`.
12. **Consequences of Postponing:** `WS-R2.0` index hygiene cannot execute (`REM-04`), and `WS-R2.5` workspace packaging risks painful 7,367-file Git conflicts.
13. **Blocks `WS-R2.0`?** **YES — Partially blocks `REM-04` cleanup inside `WS-R2.0`.** *(Certification tests `REM-01`–`REM-03` can proceed even before `REM-04` if approved separately.)*
14. **Blocks Later Workstreams?** **YES — Blocks `WS-R2.5` clean workspace refactor.**
15. **Explicit Project Owner Approval Field:**
    - **Git Cleanup:** `[ ] Option A1 (Safe Index Untrack + Test Residual Cleanup)`   `[ ] Option A2 (Keep Tracked)`
    - **FFmpeg License:** `[ ] Option B1 (Server-Only Subprocess; Pre-Dist Review)`   `[ ] Option B2 (Swap to System LGPL FFmpeg in R2)`  
    **Signed / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
