# BETHESDA WORSHIP STUDIO — PROJECT OWNER STRATEGIC DECISIONS (`POD-01` TO `POD-05`)

- **Date:** `2026-11-21`
- **Repository / Branch:** `BETHESDA WORSHIP STUDIO` / `feature/phase-1a-core-foundation`
- **Baseline HEAD SHA:** `83fbe26a7c019fbd8e58265256afa18a3065d259` (parent: R1 closure `2ebb0fd1c4b70780e740da60342e07e81a166cdd`)
- **Governance Rule:** **NO decision below has been implemented or silently chosen.** Project Owner sign-off is required before authorizing the blocked Phase R2 workstreams.

---

## Summary Decision Table

| ID | Strategic Decision Topic | Primary Blocked Workstream(s) | Recommended Professional Option |
|---|---|---|---|
| **POD-01** | Hosting, Storage & Runtime Topology (`VPS` vs `Ephemeral PaaS / Multi-Replica`, `S3`, `Redis`) | `WS-R2.4` (and `R3+` Redis boundary) | **Option B** (Stateless single API+worker node + Managed PG + **S3/R2 Storage** + Async Audio Queue) if deploying on free PaaS; **Option A** if persistent NVMe VPS |
| **POD-02** | Multi-Tenancy Scope (`Single-Church` vs `community_id + RLS`) | `WS-R2.3` vs `R3+` | **Option A** — Single-church scope in Phase R2; defer 21-table `community_id` + PostgreSQL RLS to `R3+` |
| **POD-03** | Song Approval Hierarchy & `songs:approve` Policy | `WS-R2.1`, `WS-R2.2` | **Option B** — Explicit `DRAFT -> REVIEW -> APPROVED` gate where `WORSHIP_LEADER`, `ADMIN`, and `SUPER_ADMIN` can approve reviewed songs, **never** automated on upload/AI/OMR |
| **POD-04** | Transactional SMTP / Onboarding & Password Recovery | `WS-R2.2`, `WS-R2.6` | **Option A** — Free-tier transactional SMTP provider + zero `invitationToken` in HTTP JSON responses |
| **POD-05** | Git Hygiene Cleanup & `imageio-ffmpeg` GPLv3 Licensing | `WS-R2.0`, `WS-R2.5` | **Option A** — Safe `git rm -r --cached backend/node_modules/` + residual cleanup + keep GPLv3 FFmpeg isolated as internal server subprocess (obtain formal legal check before external distribution) |

---

## `POD-01` — Hosting, Storage Architecture, Audio Processing & Resilience Topology

### Decision Question
What production hosting topology and persistence layer should Phase R2 target: a **single persistent VPS** (Option A), an **ephemeral/cloud PaaS single-replica with S3-compatible object storage** (Option B), or **multi-replica autoscaling with Redis + S3 + separate worker containers** (Option C)?

### Current Verified Repository State
- All 4 storage providers (`sources`, `outputs`, `audio`, `documents`) write exclusively to local disk relative to `process.cwd()` ([`storage-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/storage/storage-provider.ts), [`audio/storage-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/audio/storage-provider.ts), [`document-storage-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/documents/document-storage-provider.ts), [`source-storage-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/ingestion/source-storage-provider.ts)).
- `S3CompatibleStorageProvider` (`storage-provider.ts:633-1062`) is unwired dead code with 4 verified bugs (`listKeys()` truncation at 1,000, swallowed HTTP 403/500, post-signing SigV4 `publicBaseUrl` corruption, outputs-only interface).
- `OutputRetentionService` is never scheduled; 7 critical runtime state stores live in RAM (`DualRateLimiter`, `StreamTicketService`, `RealtimeSessionManager`, `AudioService`, `DocumentService`, `MultitrackService`, `OmrService`); `REDIS_URL` in `env.ts:62` is unused; `POST /audio/:id/analyze` spawns Python/FFmpeg synchronously inside the API container (~250 MB peak heap).

### Options Analyzed
- **Option A — Single Persistent VPS (Docker + Persistent Disk Volume + Local NVMe):** Unified disk storage directory + `OutputRetentionService` + automated `pg_dump` & offsite volume sync; keep `1` API+worker container + bounded Python DSP worker queue; defer Redis.
- **Option B — Ephemeral / Free-Tier Cloud PaaS + S3-Compatible Object Storage (1 API+Worker Container, Managed PG + Cloudflare R2/B2):** Unify all 4 storage providers behind fixed `S3CompatibleStorageProvider`; move `DocumentService` metadata to PG; queue Python DSP within memory budget (e.g., 512 MB–1 GB) with streaming multipart; run 1 replica so Redis isn't immediately required.
- **Option C — Full Multi-Replica Cloud Architecture (S3 + Redis + Dedicated Worker Container):** Externalize rate-limiters, stream tickets, realtime SSE pub/sub to Redis (`env.REDIS_URL`), split `ConversionWorker` & Python audio worker into independent worker deployment, and require S3.

### Comparison Matrix
| Aspect | Option A (Persistent VPS) | Option B (Single-Node PaaS + S3/R2) | Option C (Multi-Replica + Redis + S3) |
|---|---|---|---|
| **Pros** | Lowest R2 complexity & cost (\$5–12/mo); fast local Range reads; zero S3 egress latency | Survives ephemeral PaaS redeploys; generous free object tier (R2 10 GB free); unified durable backups | True zero-downtime rolling deploys, horizontal scaling, isolated CPU worker pods |
| **Cons** | Disk capacity fixed; requires OS backup/cron maintenance & single-point-of-failure downtime during deploys | Needs S3/R2 creds & presigned/proxied audio Range reads + fixes across all 4 storage interfaces | Highest R2 effort (`+XL`), added Redis service cost & complexity, delays musical/UX fixes |
| **Risks** | Disk exhaustion or missed host backup loses binaries if unmonitored | Audio DSP `~250 MB` RAM spikes on tiny <=512 MB PaaS tiers unless strictly queued/capped (`1` concurrent job) | Multi-instance race complexity across `ConversionWorker` & `OutputRetentionService` |
| **Cost & Ops** | Low fixed cost; manual VPS patching | Zero/very low cost (free PaaS + R2 + Neon/Supabase PG) | Medium monthly cost (API + Worker + Redis + Managed PG + S3) |
| **Security & Scalability** | Strong within 1 node once `OutputRetention` + disk quotas active | Durable media & easy later step to Option C (S3 already abstracted) | Best multi-node isolation & DDoS rate-limit consistency |

### Recommended Professional Option
**Option B** if deploying on Render/Railway/Fly/serverless PaaS (because local disk is wiped on deploy), **or Option A** if running a dedicated church VPS with persistent SSD and offsite snapshots. **Defer Option C (`Redis`) to `R3+`** unless immediate multi-replica scaling is an explicit launch goal.

### Impact on Workstreams
Defines exact `WS-R2.4` scope (`local` vs `S3CompatibleStorageProvider` across 4 domains, backup/restore script target, and Redis deferral boundary in `WS-R2.3`/`R3+`).

### Project Owner Decision (`POD-01`)
`[ ] Option A (Single Persistent VPS)`   `[ ] Option B (Single-Node Cloud PaaS + S3/R2)`   `[ ] Option C (Multi-Replica + Redis + S3)`  
**Approved By / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

## `POD-02` — Multi-Tenancy & Church Isolation Scope

### Decision Question
Should Phase R2 maintain a **single-church/community catalog model** (Option A) or introduce **`community_id` tenant isolation and PostgreSQL Row-Level Security (RLS) across all 21 tables** during Phase R2 (Option B)?

### Current Verified Repository State
- `20/21` PostgreSQL tables (`users`, `songs`, `song_versions`, `setlists`, `worship_services`, `audio_assets`, `omr_proposals`, etc.) have **zero `tenant_id` or `community_id` columns** and **zero RLS policies**.
- `background_jobs.tenant_id` (`schema.ts:837`) hardcodes `'bethesda-default'`.
- `idx_setlists_single_active` (`0003_setlists.sql:1`) enforces **1 active setlist across the entire PostgreSQL database**.
- Any `WORSHIP_LEADER` can view/modify any setlist or song in the database (shared ministry workspace).

### Options Analyzed
- **Option A — Explicit Single-Church Scope in R2 (Defer Multi-Tenancy to `R3+`):** Enforce object ownership/RBAC inside one church congregation; document single-tenant PostgreSQL DB boundary cleanly (`1` DB per congregation if multiple churches self-host).
- **Option B — Full Multi-Tenant `community_id` + PostgreSQL RLS in Phase R2:** Add `communities` table, `community_id` FK across 21 tables, per-community `idx_setlists_single_active`, JWT tenant claims, repository query scopes, and PG RLS policies during R2.

### Comparison Matrix
| Aspect | Option A (Single-Church R2 / Defer to `R3+`) | Option B (Multi-Tenant `community_id` + RLS in R2) |
|---|---|---|
| **Pros** | Keeps Phase R2 focused on musical correctness, security, ACID & UX without rewriting every table/repository/48 test suites | Allows multiple independent churches to share one multi-tenant SaaS PostgreSQL database |
| **Cons** | Multiple independent congregations cannot share 1 PG schema safely | Massive invasive schema + JWT + API + test overhaul (`XL+` scope); delays critical R2 musical/offline/governance fixes significantly |
| **Risks** | Accidentally onboarding 2 separate churches onto 1 DB would mix setlists/songs | High regression risk in every Drizzle repository if tenant filter missed |
| **Cost & Arch** | Zero DB migration overhead; separate DB per church works for small count | Shared SaaS DB lowers multi-church hosting cost at `R3+` SaaS scale |

### Recommended Professional Option
**Option A (Single-Church in Phase R2; Defer Multi-Tenancy to `R3+`).**

### Impact on Workstreams
If Option A is approved, `R2-F17` stays cleanly documented as `DEFERRED TO R3+`. If Option B is selected, a dedicated schema/RLS subphase must insert before `WS-R2.3` and re-plan all repository tests.

### Project Owner Decision (`POD-02`)
`[ ] Option A (Single-Church in R2 — Recommended)`   `[ ] Option B (Implement community_id + RLS in R2)`  
**Approved By / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

## `POD-03` — Song Approval Governance Policy (`songs:approve`)

### Decision Question
Which roles (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`) may transition a song or version to **`APPROVED`** in the authoritative catalog, resolving the direct contradiction between `auth-types.ts` and backend services?

### Current Verified Repository State
- `ROLE_PERMISSIONS` ([`auth-types.ts:98-113`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/auth-types.ts#L98-L113)) grants `songs:approve` and `songs:archive` **ONLY to `ADMIN` and `SUPER_ADMIN`**, omitting `WORSHIP_LEADER` and `MUSICIAN`.
- Yet `omr-service.ts:382`, `musical-content-completion-service.ts:437`, and `audio-transcription-service.ts:977` hardcode `['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN']`.
- Meanwhile `CreateSongBodySchema` (`song.schemas.ts:34`), `DocumentService` (`:216,320`), `UniversalIngestionService` (`:447`), and `IngestionPersistenceService` (`:66`) allow `WORSHIP_LEADER` (`songs:create`) to bypass review into `status: 'APPROVED'`, and `MUSICIAN` (`songs:update_draft`) can swap live versions on already-`APPROVED` songs (`song.routes.ts:99-161`).

### Options Analyzed
- **Option A — Strict Dual-Approval (`ADMIN` / `SUPER_ADMIN` Only):** `WORSHIP_LEADER` and `MUSICIAN` create/edit `DRAFT` / `PENDING_REVIEW` content only; strictly `ADMIN`/`SUPER_ADMIN` execute `songs:approve` & `songs:archive` across all pipelines (including OMR, Completion, Audio Drafts, and Catalog endpoints).
- **Option B — Empowered Ministry Director (`WORSHIP_LEADER` + `ADMIN` + `SUPER_ADMIN` Can Approve After Review):** Add `songs:approve` to `WORSHIP_LEADER` in `auth-types.ts` so worship directors can approve OMR/Audio/Completion/Manual drafts after human review; **strictly prohibit `MUSICIAN` and `VIEWER` from approving or modifying `APPROVED` active versions**, and **strictly enforce `status: 'DRAFT'` on all uploads/imports/AI runs** (never auto-approve).

### Comparison Matrix
| Aspect | Option A (`ADMIN`/`SUPER_ADMIN` Only) | Option B (`WORSHIP_LEADER` + `ADMIN` + `SUPER_ADMIN`, Always Post-Review) |
|---|---|---|
| **Pros** | Strictest separation of duties between creator and approver | Matches real church worship ministry workflow (worship director verifies chord charts/tabs/lyrics) and matches existing OMR/Audio/Completion UI design |
| **Cons** | Bottlenecks daily Sunday song prep on IT/sysadmin users (`ADMIN`) | A worship leader approving their own manual upload reduces two-person separation |
| **Risks** | Admins often lack musical literacy to judge sheet music/tabs, encouraging rubber-stamping | Lower security risk *if* `DRAFT`-on-ingest + immutable audit log + per-format review checks are strictly enforced |
| **Musical & Audit Security** | High governance separation | **Mandatory invariant preserved in both:** Zero upload, OMR, PDF parse, or AI audio analysis can enter `APPROVED` without an explicit audited human review action |

### Recommended Professional Option
**Option B** — align `auth-types.ts` and all HTTP/domain routes so `WORSHIP_LEADER` + `ADMIN` + `SUPER_ADMIN` hold `songs:approve` **strictly via explicit review endpoints**, while removing `status: 'APPROVED'` mass assignment, blocking auto-approval on all ingestion/document/conversion paths, locking `APPROVED` songs against unreviewed `MUSICIAN` overwrites, and recording immutable `audit_logs` on every approval/archive.

### Impact on Workstreams
Locks RBAC assertions across `WS-R2.1` (Completion/Audio/OMR review gates) and `WS-R2.2` (`POST /songs`, `/versions`, `PUT /songs/:id/approve`, `auth-types.ts`).

### Project Owner Decision (`POD-03`)
`[ ] Option A (ADMIN / SUPER_ADMIN Only)`   `[ ] Option B (WORSHIP_LEADER + ADMIN / SUPER_ADMIN Post-Review — Recommended)`  
**Approved By / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

## `POD-04` — Transactional SMTP Onboarding & Password Recovery Architecture

### Decision Question
How should user invitations and self-service password resets deliver single-use secret tokens in Phase R2 without leaking plaintext tokens over HTTP JSON responses?

### Current Verified Repository State
- `invitation-service.ts:109-116,163-170` sets `deliveryStatus: 'UNCONFIGURED_MOCK'` in all environments.
- `user.routes.ts:121,156` exposes plaintext `invitationToken: result.rawInvitationToken` inside HTTP JSON even when `NODE_ENV=production` (exposing tokens to browser history, proxies, and allowing admin account takeover before invite acceptance).
- `password-reset-service.ts:49-76` discards reset tokens in production (`auth.routes.ts:190`), making forgot-password non-functional.
- `App.tsx` lacks `/accept-invite` and `/forgot-password`/`/reset-password` UI routing (`R2-F12`, `R2-F33`).

### Options Analyzed
- **Option A — Transactional Email Provider / SMTP (`nodemailer` + Resend / Brevo / Postmark / Church SMTP) + Zero JSON Token Exposure:** Integrate configurable `SMTP_*` / provider adapter; send invite/reset links strictly via email; persist only SHA-256 token hashes in DB with short TTL (e.g., 48h invite / 30m reset, invalidated on resend or reuse); strip `invitationToken` from production API JSON; enforce per-IP + per-account rate limits and indistinguishable 200 anti-enumeration on `forgot-password`.
- **Option B — Zero-SMTP Out-of-Band Admin One-Time Copy Link + Admin-Assisted Password Reset:** Suppress JSON token reuse across sessions via ephemeral 1-time display or admin-triggered temporary password (`MUST_CHANGE_PASSWORD`), deferring SMTP to `R3+`.

### Comparison Matrix
| Aspect | Option A (Transactional Email / SMTP Integration) | Option B (Admin One-Time Manual Link / Reset) |
|---|---|---|
| **Pros** | Eliminates token exposure to admins/proxies; enables real self-service password recovery & `/accept-invite` onboarding; high privacy/security | Zero external email service setup/DNS (`SPF`/`DKIM`) needed during MVP |
| **Cons** | Requires Owner SMTP credentials/verified sending domain (`SPF`/`DKIM`) and `nodemailer` dependency addition | Self-service `forgot-password` remains unavailable; admins share secret onboarding links via WhatsApp/chat (interception risk) |
| **Cost & Monitoring** | Free tier available on Resend (3,000 emails/mo) / Brevo / church Google Workspace SMTP; requires delivery failure logging | Zero email cost, higher manual support burden for Worship Admins |
| **Security** | Industry-standard cryptographic token delivery with anti-enumeration & rate-limiting | Weakens separation between Admin and end-user initial credential |

### Recommended Professional Option
**Option A (Configurable SMTP Provider via `nodemailer`)** with fail-closed behavior if unconfigured in production, hashed token storage (`SHA-256`), single-use atomic DB consumption, strict rate limits, and zero secret tokens in HTTP responses or Pino logs. *(If SMTP credentials are not yet ready at `WS-R2.2` start, implement the `EmailDeliveryProvider` interface + `NODE_ENV !== 'production'` dev preview cleanly while keeping production blocked until credentials are provisioned.)*

### Impact on Workstreams
Directly shapes `WS-R2.2` (SMTP dependency approval, `user.routes.ts`, `auth.routes.ts`, `invitation-service.ts`, `password-reset-service.ts`) and `WS-R2.6` (`/accept-invite` & `/reset-password` UI).

### Project Owner Decision (`POD-04`)
`[ ] Option A (SMTP Transactional Email — Recommended)`   `[ ] Option B (Admin Manual Onboarding Only, Defer SMTP to R3+)`  
**Preferred SMTP Provider (if Option A):** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
**Approved By / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

## `POD-05` — Git Repository Hygiene (`backend/node_modules/`, Storage Artifacts) & `imageio-ffmpeg` GPLv3 Licensing

### Decision Question
1. Does Project Owner authorize safe Git index untracking of `backend/node_modules/` (`7,367` files / `103.8 MB` incl. Windows `.exe`/`.node` binaries) and cleanup of stray root `storage/` test artifacts in `WS-R2.0`?
2. Confirm operational licensing stance on `imageio-ffmpeg` (bundled GPLv3 FFmpeg binary in `workers/audio_worker/.venv`).

### Current Verified Repository State
- `git ls-files` tracks `7,367` files under `backend/node_modules/` (`103,805,806` bytes, including `31.7 MB` of Windows-only `esbuild.exe` and `argon2.win32-x64-msvc.node`), `223` files under `backend/storage/`, and `20` `.zip` archives (`3.1 MB`), even though `.gitignore` lists `backend/node_modules/`.
- Root `storage/` (gitignored) retains test residuals `non_existent_cert_dir_404/` and `test-symlink-outside/` from previous test runs.
- [`workers/audio_worker/requirements.txt`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/workers/audio_worker/requirements.txt) depends on `imageio-ffmpeg>=0.6.0,<1.0.0`, which bundles an external GPLv3-licensed `ffmpeg` binary invoked over subprocess IPC by [`audio_analyzer.py`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/workers/audio_worker/audio_analyzer.py) / [`audio_inspector.py`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/workers/audio_worker/audio_inspector.py).

### Options Analyzed
#### Part A — Git Index & Residual Cleanup
- **Option A1 (Safe Index Untrack Only — Recommended):** Execute `git rm -r --cached backend/node_modules` (keeps local working files intact, preserves Git commit history with zero `filter-repo`/force-push), delete untracked test residuals in `<repo>/storage/`, and verify `npm ci` reproducibility before touching `WS-R2.5`. Also inventory the `20` `.zip` / `223` storage files cleanly (separating intentional test fixtures into `fixtures/` in a later step if desired).
- **Option A2 (Leave Tracked):** Keep `7,367` `backend/node_modules/` files tracked in Git.

#### Part B — `imageio-ffmpeg` GPLv3 Consideration *(Technical Risk Guidance — Not Formal Legal Counsel)*
- Invoking standalone `ffmpeg` as a separate OS process via pipes (`subprocess` + stdin/stdout IPC) in a **purely server-side SaaS / church internal server** generally does *not* trigger source-distribution obligations under GPLv3 (unlike AGPLv3 or linking FFmpeg C libraries in-process).
- **However**, if Bethesda Worship Studio ever **distributes** packaged Docker images, Electron desktop apps, or `.zip` server bundles containing both proprietary application code and `imageio-ffmpeg`'s GPLv3 FFmpeg binary — or ships commercial distributions — GPLv3 distribution rules apply (or require substituting an LGPL-only system FFmpeg build without `--enable-gpl` / libx264).
- **Option B1 (Server-Side Isolated Subprocess + Formal Pre-Distribution Legal Review — Recommended for R2):** Retain `imageio-ffmpeg` strictly in isolated server-side Python worker for non-distributed SaaS/church server; block any binary/image redistribution until legal counsel approves or swaps to an LGPL `ffmpeg` build.
- **Option B2 (Replace Immediately in R2):** Remove `imageio-ffmpeg` in favor of system-installed LGPL-only `ffmpeg` binary.

### Comparison Matrix
| Aspect | Option A1 + B1 (Safe Untrack + Server Subprocess Review — Recommended) | Option A2 (No Cleanup) / B2 (Immediate FFmpeg Swap) |
|---|---|---|
| **Pros** | Eliminates Windows `.exe` lock-in, prepares clean `packages/music-core` workspace in `WS-R2.5`, shrinks working tree/PR diffs dramatically without rewriting history; preserves tested 18/18 Python DSP pipeline | A2 requires zero collaborator `npm ci`; B2 removes any future GPLv3 binary question |
| **Cons** | Future environments/CI must run `npm --prefix backend ci`; distributing bundles requires LGPL switch later | A2 breaks Linux/macOS native installs (`argon2`/`esbuild` win32 blobs) & bloats every `npm`/workspace change; B2 adds setup friction on Windows dev environments |
| **Risks** | Must ensure `npm --prefix backend ci` succeeds cleanly from lockfile immediately after untracking | Retaining tracked `node_modules` causes severe noise during `WS-R2.5` npm workspaces |

### Impact on Workstreams
`Option A1` unlocks clean `WS-R2.0` closure and prevents 7,367-file index friction in `WS-R2.5` (`packages/music-core`).

### Project Owner Decision (`POD-05`)
- **Git Index Hygiene:** `[ ] Option A1 (Authorize git rm -r --cached backend/node_modules + stray root storage cleanup — Recommended)`   `[ ] Option A2 (Keep tracked)`
- **GPLv3 / FFmpeg Policy:** `[ ] Option B1 (Server-Side Subprocess Only; Formal Review Before Any Distribution — Recommended)`   `[ ] Option B2 (Replace with System LGPL FFmpeg in R2)`  
**Approved By / Date / Notes:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
