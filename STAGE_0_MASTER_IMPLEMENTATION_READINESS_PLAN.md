# BETHESDA WORSHIP STUDIO — STAGE 0 MASTER IMPLEMENTATION READINESS PLAN

- **Date & Timezone:** `2026-11-27` (`UTC-05:00`)
- **Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`
- **Authoritative Branch & HEAD SHA:** `main` @ `98919fe85d2c656076426d0a43a1222f9a752465`
- **Evidence References:** `MASTER_MULTI_AGENT_ARCHITECTURE_AND_EXECUTION_PLAN.md` (v1.2), `MASTER_AGENT_RESPONSIBILITY_AND_FILE_OWNERSHIP_MATRIX.md` (v1.2), `MASTER_DEPENDENCY_AND_INTEGRATION_GRAPH.md` (v1.2), `MASTER_TEST_AND_ACCEPTANCE_STRATEGY.md` (v1.2), `MASTER_RISK_AND_REGRESSION_REGISTER.md` (v1.2), and Stage 0 Reports from Agents `1`–`10`.
- **Execution Authorization Status:** **`NOT AUTHORIZED — ZERO workstreams (WS-R2.0 through WS-R2.6) have started. Stage 0 GATE 1 Project Owner Decisions Ratified (2026-11-27); GATE 2–GATE 8 strictly [ ] LOCKED.`**

---

## 1. Ten Non-Negotiable Musical Quality Principles (Validated Baseline on `main`)

*(Verified directly by Agent 2 against `frontend/src/core/` & `backend/src/` at HEAD `98919fe8`.)*

| # | Musical Quality Principle | Current State on `main` | Exact Verified Evidence & Defects Blocking Compliance |
|---|---|---|---|
| **1** | **480 TPQN exact integer tick math** | **Partial** *(Broken downstream)* | `CANONICAL_TPQN = 480` (`types.ts:11`) & `TimeSignature` (`time-signature.ts:55-64`) are exact; broken by hardcoded `1920`/`480`/`120` in `written-notes-adapter`, `musical-content-completion-service`, `tablature-calculator:35`, and renderers. |
| **2** | **`6/8` compound meter = 6 eighth-note beats / 2 dotted-quarter pulses (`1440` ticks)** | **Partial** *(Core exact; downstream broken)* | `TimeSignature.SIX_EIGHT` (`1440` ticks, `isCompound=true`, `beatDurationTicks=720`, `primaryBeatsPerMeasure=2`) is exact, but `musical-content-completion-service.ts` hardcodes `1920`, `chordpro-importer.ts:252` has `isCompound ? 2 : 2` tautology (`NF-30`), and MusicXML/AlphaTex generators omit `<dot/>`/`{d}` for `720`/`1440` ticks (`NF-30`). |
| **3** | **Exact Pitch & Enharmonic Integrity** | **FAIL (`MF-01`, `MF-08`)** | `Pitch.midiNumber` wraps `Cb4 -> 71`, `B#3 -> 48`; `ProjectionService:135-137` shifts octaves across `C/B`; `written-notes-adapter:210,250` drops double accidentals (`±2`). |
| **4** | **Harmonic / Chord Preservation** | **FAIL (`MF-02`, `MF-06`, `MF-09`)** | `Csus2 -> Csus4`, `Fadd9/Faug -> F`, `Cmaj9/Cm9/C9` mangled, `♯♭` & `add2`/`add4` unsupported, untransposed `chordAbove`, MusicXML `<kind text>` root duplication & missing `<bass>`. |
| **5** | **Rhythmic & Rest Preservation** | **FAIL (`MF-05`, `MF-09`, `MF-12`, `MF-16`)** | `ProjectionService` drops all `32` `Rest`s; OSMD/AlphaTab flatten V1+V2 into `6` beats in `4/4`; MusicXML export writes `8` beats (`96` re-import errors); MIDI double-offsets `61,440 -> 120,960`. |
| **6** | **Lyrics-to-Beat Anchoring** | **FAIL (`MF-06`, `MF-09`, `MF-14`, `MF-40`)** | Relative `tickOffset` compared raw vs absolute `startTick` in `LeadSheetDomAdapter`, `ChordProSerializer`, `OsmdAdapter:166`, `MusicXmlGenerator:175`, `AlphaTexGenerator:83`, `AlphaTabAdapter:241`; `MusicXmlSerializer:285-298` doubles lyrics `24 -> 48`. |
| **7** | **Rehearsal Sections & Repeat Integrity** | **FAIL (`MF-04`, `MF-07`, `MF-09`)** | Overlap check uses `<` not `<=`; completion drops `repeatStart`/`repeatEnd`/`repeatCount`/`endingNumber` & hardcodes `* 1920`; MusicXML omits `<rehearsal>` & `<barline>`. |
| **8** | **Capo & Transposition Without Canonical Mutation** | **Partial** *(Immutability PASS; Projection FAIL)* | `CanonicalMusicPayload` stays frozen, but `ProjectionService` skips `chordAbove` & Tab pitches, writes `tenor_sax` at `+2` instead of `+14`, reuses m.1 key on modulations, `LeadSheetDomAdapter:219` guesses Capo key from bar 1's first chord, and `MusicalWorkspace` clobbers setlist keys. |
| **9** | **Multi-Track, Multi-Voice & Piano Grand Staff Preservation** | **FAIL (`MF-05`, `MF-06`, `MF-09`, `MF-11`, `MF-12`)** | `ProjectionService` ignores `InstrumentTrack.voiceIds` & lacks Piano `GRAND_STAFF` Treble/Bass split; MusicXML serializer emits single `P1`; importer drops `parts[1..]`; MIDI collapses to ch 0. |
| **10** | **Zero Fabrication & Per-Format Approval Isolation** | **FAIL (`MF-06`, `MF-07`, `MF-08`, `NF-22`)** | Silent `C_MAJOR`/`4/4`/`120 BPM`/`'Sol Mayor'`/`0.1`/filler rests; `HUMAN_VERIFIED` pre-stamped pre-approval; 1-format `APPROVED` unlocks unreviewed `STAFF_NOTATION`/`TABLATURE`. |

---

## 2. Principal Musical Regression Anchor: *En Tu Presencia (Referencia Litúrgica)*

- **Authoritative Canonical Ground Truth (`frontend/src/core/canonical-model/fixtures/reference-song.ts:25-356`):**
  - **Meter & Key:** **`4/4`** (`TimeSignature.FOUR_FOUR`, `1920` ticks/bar at `480 TPQN`) *(NOTE: `reference-song.ts` is strictly `4/4` — a dedicated `6/8` compound-meter dotted-rhythm companion fixture is added so `6/8` is also certified end-to-end)*.
  - **Structure & Tempo:** `32` measures (`61,440` ticks total), **`G Major`** (`+1` `F#`), **`74 BPM`** (`810,811` µs/quarter), **`8` contiguous sections** (`1-4..29-32`), m.24 slash chord **`G/B`**.
  - **Polyphonic Content:** Voice 1 = `Half Note (960) + Half Rest (960)` (`1920`/bar); Voice 2 = `4 × Quarter Note (480)` (`1920`/bar) -> total **`160` notes + `32` rests**.
  - **Lyrics & Tracks:** **`24` `LyricSyllable`s** across bars `5–28` (`6` lyrical 4-bar sections × `4` bars; fixed from mistaken `20` citation); **`3` `InstrumentTrack`s** (`track_lead_vocal` `[1]`, `track_acoustic_guitar` `[2]`, `track_alto_sax` `[1]` `+9`).
- **Recommended 10-Stage Expansion + `6/8` Companion (`Agent 2`, `Agent 8`):**
  - Stages 1–8 (`MASTER_TEST_AND_ACCEPTANCE_STRATEGY.md:64-72`, corrected to `24` lyrics, `3` tracks, exact `61,440` MIDI Note-Off, per-track + aggregate `160` Note-On/Off, `AlphaTexImporter` parse proof, Piano Grand Staff Treble/Bass split) **PLUS Stage 9 (ChordPro round-trip)**, **Stage 10 (browser-safe `Buffer=undefined` ASCII Tab Capo 2)**, and a **`6/8` Dotted-Rhythm Companion Fixture (`1440` ticks/bar, `<dot/>` `720`/`1440`, `FF 58 04 06 03 18 08`)**.

---

## 3. Protected Shared Files (`25` Serialized Files) & Worktree Rules

- **Full Lock Registry (`#1`–`#25`):** Exact single-owner lock list (`#1`–`#13`, `#14a`/`#14b`, and Addendum `#15`–`#25`) is maintained in `MASTER_AGENT_RESPONSIBILITY_AND_FILE_OWNERSHIP_MATRIX.md` v1.1 Section 2.
- **External OneDrive-Safe Worktree Mandatory (`RR-14`):** ALL parallel implementation worktrees MUST live outside the OneDrive folder (`C:\dev\bws-wt\<track>`), created **only after** `REM-04` (`POD-05 A1` index cleanup) merges to `main`.
- **Automated Diff-Boundary Enforcement:** Every PR runs `git diff --name-only origin/main...HEAD` and fails automatically if it modifies any file outside that agent's exclusive writable scope or a concurrently locked protected file.

---

## 4. Dependency-Aware Workstream Readiness Matrix (`11` Execution Workstreams / Tracks)

*(Every workstream includes all **14 mandatory Stage 0 readiness fields**.)*

### 4.1 `WS-R2.0` (`REM-04`, `REM-01`, `REM-03`, `REM-02`) — Certification Baseline & Index Hygiene (`Stage 1`)
1. **Workstream ID:** `WS-R2.0` (`REM-04` -> `REM-01` || `REM-03` -> `REM-02`)
2. **Responsible Agent:** **Agent 10** (`REM-04`), **Agent 4** (`REM-01`), **Agent 8 + Agent 10** (`REM-03`), **Agent 8 + Agent 9** (`REM-02` verification)
3. **Exact Exclusive File Ownership:** `.gitignore`, `.gitattributes`, index paths `backend/node_modules/**` & `backend/storage/**` (`Agent 10`); `backend/src/db/scripts/provision_app_runtime_role.sql`, `backend/src/db/{index,migrate}.ts`, `backend/src/server.ts`, `backend/src/infrastructure/queue/conversion-queue.ts` (`Agent 4` + Agent 6 review on `conversion-queue.ts`); `frontend/package.json` (`tsx` devDep + test scripts), `frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`, `frontend/src/core/rendering/__tests__/browser-rendering-integration.test.ts`, `backend/src/__tests__/{omr-persistence-and-integrity,conversion-api}.test.ts` (`Agent 8`).
4. **Required Upstream Decisions:** Signed `GATE 1` (`POD-05 A` Git hygiene ruling & `POD-06` clean baseline); `GATE 2` signed; Docker daemon running or native PostgreSQL available.
5. **Entry Criteria:** Clean protected `main` post Stage 0 Docs PR #3; external backup copy of needed `backend/storage/` fixtures before `REM-04`.
6. **Technical Tasks:**
   - `REM-04`: Add root `.gitattributes` (`* text=auto eol=lf`), harden `.gitignore` (`backend/storage/**` keeping `.gitkeep`), `git rm -r --cached` tracked bloat (per signed `POD-05 A1`/`A1b`), verify `npm --prefix backend ci`.
   - `REM-01`: Fix `provision_app_runtime_role.sql` (`:'APP_RUNTIME_PASSWORD'` syntax via `SET LOCAL`, `current_database()`, all 21 tables, `pgboss` schema pre-grants, remove `DELETE` on `song_versions`), harden `migrate.ts` against `MIGRATION_DATABASE_URL` test leak (`NF-01`), enforce `assertNonSuperuserRuntimeRole()` in `server.ts`, support `PgBoss` `migrate: false` for runtime role.
   - `REM-03`: Add `"tsx"` to `frontend/package.json` `devDependencies` (`NF-15`), switch FE `test*` scripts to `tsx --test`, replace `process.cwd()` with `import.meta.url` in `autoscroll.test.ts`, fix `browser-rendering-integration.test.ts:368-380` test `#8` + add `LYRICS_ONLY` `capo === 0` test.
   - `REM-02`: Fix `omr-persistence:2556,2586` (dynamic URL/ephemeral password) and `conversion-api` (`runMigrations()`), execute full disposable `bethesda_worship_r2_cert_tmp` run (`48/48` BE + `629+/629+` FE + `18/18` Python `.venv`).
7. **Shared-File Conflicts:** `#4` (`server.ts`), `#7` (`frontend/package.json`), `#16` (`migrate.ts`), `#23` (`package.json`s) — serialized via `REM-04` first, then `REM-01`/`REM-03` parallel.
8. **Parallelizable Tasks:** `REM-01` (backend/SQL) and `REM-03` (frontend test runner) run in parallel immediately after `REM-04` merges.
9. **Tasks Requiring Sequential Integration:** `REM-04` MUST merge to `main` FIRST before `REM-01`/`REM-03` worktrees branch; `REM-02` runs after both `REM-01` & `REM-03` land.
10. **Regression Risks:** `RR-14` (OneDrive `.git/index` locks), `RR-15` (`git rm --cached` removing local `node_modules` until `npm ci`).
11. **Required Tests:** `npm --prefix backend ci && typecheck`, `npm --prefix frontend test` from root + `frontend/`, `18/18` Python `.venv` `pytest`, all `48/48` backend suites under non-superuser `bethesda_app_cert_runtime` on `bethesda_worship_r2_cert_tmp`.
12. **Acceptance Evidence:** `GATE 3` Certification Bundle showing `0` tracked `node_modules`, `0` skipped tests, `omr_audit_history` `42501`/`55000` proof, clean `DROP DATABASE`/`DROP ROLE`, unchanged primary DB row counts, clean `git status`.
13. **Rollback Strategy:** Zero history rewrite; single `git revert` on `REM-04`/`REM-01`/`REM-03` + `npm ci` (`package-lock.json` preserved).
14. **Exit Criteria:** Signed **`GATE 3`** verification by Agents 8 & 9.

---

### 4.2 `WS-R2.3-DDL` (`Stage 2A`) — Additive Migration `0021` & PG Error Mapper
1. **Workstream ID:** `WS-R2.3-DDL` (`Stage 2A`, serialized before `Stage 2B`)
2. **Responsible Agent:** **Agent 4** *(DDL requests integrated from Agents 5 & 6)*
3. **Exact Exclusive File Ownership:** `backend/src/db/{schema,index,migrate}.ts`, `backend/src/db/migrations/0021_*.sql`, `backend/src/db/migrations/meta/{_journal.json,0021_snapshot.json}`, `backend/src/db/scripts/provision_app_runtime_role.sql`, `backend/drizzle.config.ts`, `backend/src/db/pg-error-mapper.ts`, `backend/src/interfaces/http/error-handler.ts`, `backend/src/domain/errors.ts`, `backend/src/config/env.ts`, `backend/.env.example`.
4. **Required Upstream Decisions:** Signed **`GATE 3`** + **`GATE 4`** + **`POD-02`** (Multi-tenancy), **`POD-07`** (`ON DELETE RESTRICT` / Soft-Archive).
5. **Entry Criteria:** `100%` green `GATE 3` baseline; `0000`–`0020` & `_journal.json` `0..20` checksums snapshotted.
6. **Technical Tasks:** Append `0021_hardening_constraints_and_immutability.sql` (`idx: 21`, `when > 1794476002000`): dirty-row pre-reconciliation; `NOT VALID` + `VALIDATE CONSTRAINT` FKs/CHECKs (`songs.current_version_id`, `songs.status`, `song_versions.song_id ON DELETE RESTRICT`, `audit_logs.user_id ON DELETE RESTRICT`); deferrable `UNIQUE (setlist_id, sequence_order)`; partial unique `(song_id) WHERE is_current=true`; `UNIQUE (song_metadata.song_id)`; `LOWER(users.email)` unique index; align `0016` partial indexes in `schema.ts`; `BEFORE UPDATE OR DELETE` immutability triggers + `REVOKE` on `audit_logs` & `song_versions` (allowing controlled `is_current` transition); create **`visual_documents`** table (`22nd` public table) + grant DML in `provision_app_runtime_role.sql`; add `pg-error-mapper.ts`; batch all Stage 3 `env.ts` keys (`SMTP_*`, `TRUST_PROXY`, `PYTHON_WORKER_*`, `S3_*`, `AUTO_MIGRATE_ON_BOOT`, `ENABLE_EXPERIMENTAL_ROUTES`, `STORAGE_ROOT_DIR`) and document in `.env.example` (`NF-26`).
7. **Shared-File Conflicts:** `#1` (`schema.ts`), `#2` (`_journal.json`), `#5` (`env.ts`), `#16` (`migrate.ts`), `#17` (`.env.example`) — single-owner lock held exclusively by Agent 4.
8. **Parallelizable Tasks:** None during Stage 2A lock (strictly sequential lock PR).
9. **Tasks Requiring Sequential Integration:** Must merge to `main` cleanly BEFORE `WS-R2.5A` (`Stage 2B`) begins so migration/config changes never collide with path moves.
10. **Regression Risks:** `RR-02` (triggers breaking `is_current` or hard deletes), `RR-03` (dirty existing rows failing constraints), `RR-04` (rewriting `0000`–`0020`), `NF-03` (`conversion-api` teardown hit by `RESTRICT`).
11. **Required Tests:** Dual disposable-PG replay (fresh `0000`–`0021` + dirty-row seeded clone -> `0021` -> idempotent `rc=0`), byte-identical `0..20` `_journal.json` check, restricted-role `42501`/`55000` trigger checks, `PersistenceError` redaction & SQLSTATE `400/409` unit tests.
12. **Acceptance Evidence:** Clean dual replay logs, `_journal.json` diff check, `22` tables granted to `bethesda_app_cert_runtime`.
13. **Rollback Strategy:** Pre-cutover `pg_dump -Fc`; additive expand-only DDL preserves N-1 compatibility; down-SQL reverts only `0021` triggers/constraints/`visual_documents`.
14. **Exit Criteria:** `0021` & batched `env.ts` merged on `main`, verified on disposable PG.

---

### 4.3 `WS-R2.5A` (`Stage 2B`) — `@bethesda/music-core` Extraction & Compiled `dist/` Build Fix
1. **Workstream ID:** `WS-R2.5A` (`Stage 2B` — stop-the-world structural PR)
2. **Responsible Agent:** **Agent 1 + Agent 10** *(co-review: Agents 2, 3, 4)*
3. **Exact Exclusive File Ownership:** Root `package.json`, `packages/music-core/{package.json,tsconfig.json,src/**}`, `backend/{package.json,tsconfig.json,tsconfig.build.json}`, `frontend/{package.json,tsconfig.json}`, import rewrites across `30` (`15` prod + `13` test + `2` transitive) files, `backend/src/interfaces/http/schemas/user-preferences.schemas.ts`, Python/env compiled path resolution (`backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts`, `backend/src/config/env.ts` — path slice).
4. **Required Upstream Decisions:** **`GATE 4`** + **`OI-01`** (`POD-10` extraction timing) + **`POD-09`** (excluding dead `ingestion/conversion/*` & `omr-proposal-handler.ts`).
5. **Entry Criteria:** Stage 2A (`0021`) merged on `main`; all active Stage 3 branches paused.
6. **Technical Tasks:** Create root `npm workspaces` `package.json`; harmonize `typescript` (`^5.7.3` vs `^7.0.2`) & `@types/node` hoisting (`NF-27`); extract pure ESM core modules into `packages/music-core` with subpath `exports`, `declaration: true`, `rewriteRelativeImportExtensions: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`; move `stand-format-capabilities.ts` -> `capabilities/`; exclude dead 4th stack (`NF-22`); rewrite all `backend/src/**` & `frontend/src/**` imports to `@bethesda/music-core/*`; derive `user-preferences.schemas.ts:50-63` from `InstrumentRegistry`; set `"rootDir": "./src"` in `backend/tsconfig.build.json`, copy `src/db/migrations` -> `dist/db/migrations`, update `start`/`migrate:prod` scripts & `PYTHON_WORKER_*` path resolution; add CI check forbidding `../frontend/` imports in `backend/src`.
7. **Shared-File Conflicts:** `#5` (`env.ts`), `#6` (`backend/package.json`/`tsconfig.build.json`), `#7` (`frontend/package.json`), `#9` (`stand-format-capabilities.ts`), `#15` (`python-audio-worker-bridge.ts`), `#23` (root `package.json`/`tsconfig.json`), `#24` (`user-preferences.schemas.ts`), `#25` (barrels).
8. **Parallelizable Tasks:** None (stop-the-world structural move PR).
9. **Tasks Requiring Sequential Integration:** Must merge to `main` cleanly BEFORE parallel Stage 3 worktrees (`3A`, `3C`, `3D`, `3E-1`) fork.
10. **Regression Risks:** `RR-13` (`rootDir` collapse breaking `.env` & Python worker paths in `dist/`), `NF-27` (`TS 5.7` vs `TS 7.0` `.d.ts` or workspace hoisting failure).
11. **Required Tests:** `npm --workspace=@bethesda/music-core build && test`, `backend` & `frontend` `typecheck`, `vite build`, `backend build`, compiled `node dist/server.js` & `node dist/db/migrate.js` smoke boot inside a `"test"`-containing directory under `NODE_ENV=production`, `0` `../frontend/` grep check.
12. **Acceptance Evidence:** Clean `GATE 4` sign-off bundle proving compiled `dist/server.js` boots with `.env`, Python `PING`, and non-superuser runtime role.
13. **Rollback Strategy:** Atomic `git revert` of Stage 2B PR before any Stage 3 code lands.
14. **Exit Criteria:** **`GATE 4`** complete; `@bethesda/music-core` builds cleanly; Stage 3 worktrees unlocked cleanly.

---

### 4.4 `Track 3A` (`WS-R2.1` Part A) — Music Domain, Projection & Per-Format Approvals (`Stage 3`)
1. **Workstream ID:** `Track 3A` (`WS-R2.1` Domain Core)
2. **Responsible Agent:** **Agent 2**
3. **Exact Exclusive File Ownership:** `packages/music-core/src/music-theory/**`, `packages/music-core/src/canonical-model/**` *(excl. `midi-export-gatekeeper.ts` tie-in coords w/ Agent 3)*, `packages/music-core/src/projection/**`, `packages/music-core/src/capabilities/stand-format-capabilities.ts`, `packages/music-core/src/ingestion/provenance.ts`, `backend/src/domain/canonical-serializer.ts`, `backend/src/domain/ingestion/adapters/written-notes/written-notes-adapter.ts`, `backend/src/application/musical-content-completion-service.ts` (`#14b`).
4. **Required Upstream Decisions:** **`GATE 4`** + **`GATE 5`** + **`POD-03`** (per-format approval model).
5. **Entry Criteria:** `WS-R2.5A` merged on `main`.
6. **Technical Tasks:** Fix `Pitch.midiNumber` & projection octave wrap (`MF-01`); fix `Chord.parse`/`toString()` for `sus2`, `Fadd9/Faug`, `maj9/m9/C9`, `add2/4`, `♯♭`, write-reject garbage + read-compat warn (`MF-02`, `RR-01`); add `BB_TENOR_OFFSET = 14` (`MF-03`); fix `<=` section overlap, `ev.endTick <= measure.endTick`, `MIDI_PITCH_OUT_OF_RANGE`, wire `TemporalValidator` in `CanonicalSerializer` writes + warn legacy reads (`MF-04`); add `DerivedRest`/`rests` & `InstrumentTrack.voiceIds` filtering with trackless fallback (`MF-05`, `RR-07`); transpose `chordAbove` & Tab pitches, invalidate stale overrides, per-measure modulations, nullable unresolved keys, Piano `GRAND_STAFF` `< C4` split, `TablatureCalculator` `durationTicks = null` (`MF-06`); isolate `approvedFormats[]`, remove pre-approval `'HUMAN_VERIFIED'` & client `tablatureVerified` trust, preserve repeat/ending flags & real bar section ticks (`MF-07`); enforce Zero-Fabrication + double accidentals (`±2`) + SHA-256 & real timestamps in `provenance.ts` (`MF-08`).
7. **Shared-File Conflicts:** `#8` (`projection-service`, `derived-musical-view`), `#9` (`stand-format-capabilities.ts`), `#14b` (`musical-content-completion-service.ts`), `#18` (`temporal-validator.ts`).
8. **Parallelizable Tasks:** Can run concurrently with `Track 3C`, `Track 3D`, `Track 3E-1`.
9. **Tasks Requiring Sequential Integration:** **Must freeze `DerivedMusicalView` & `approvedFormats[]` interface contracts FIRST** before `Track 3B` (`Agent 3`) and `Track 3E-2` (`Agent 7`) finalize exporters/generators/renderers.
10. **Regression Risks:** `RR-01` (legacy JSONB payload breakage), `RR-07` (blanking golden scenarios lacking tracks), `RR-10` (`DRAFT` workflow break).
11. **Required Tests:** `30 keys × [-11..+11]` + `Cb4/B#3` + `tenor_sax (+14)`, `Chord` matrix + legacy JSONB snapshot read-compat, *En Tu Presencia* Stage 1–2 projections + Piano Grand Staff split, `3/4` & `6/8` section ticks, repeat flags, per-format isolation (`LYRICS` approved keeps `STAFF` blocked).
12. **Acceptance Evidence:** All `packages/music-core` domain & projection suites green (`0` regressions on `golden-scenarios`).
13. **Rollback Strategy:** Pure domain TS revert (preserve additive `approvedFormats[]` backward reader).
14. **Exit Criteria:** Interface freeze PR merged to `main`, unlocking `Track 3B` & `Track 3E-2`.

---

### 4.5 `Track 3B` (`WS-R2.1` Part B) — MusicXML, MIDI, ChordPro, Browser Tab & AlphaTex (`Stage 3`)
1. **Workstream ID:** `Track 3B` (`WS-R2.1` Formats & Exporters)
2. **Responsible Agent:** **Agent 3**
3. **Exact Exclusive File Ownership:** `packages/music-core/src/ingestion/{musicxml,xml,chordpro}/**`, `packages/music-core/src/ingestion/validation.ts`, `packages/music-core/src/tablature/**`, `packages/music-core/src/conversion/exporters/{musicxml,midi,chordpro,tablature}-serializer.ts`, `frontend/src/core/rendering/utils/{musicxml,alphatex}-generator.ts`, `packages/music-core/src/canonical-model/midi-export-gatekeeper.ts` (`#18`, co-review Agent 2), `backend/src/domain/ingestion/adapters/{musicxml,midi,chordpro}/*`.
4. **Required Upstream Decisions:** `Track 3A` `DerivedMusicalView` freeze + **`GATE 5`**.
5. **Entry Criteria:** `Track 3A` interface freeze merged.
6. **Technical Tasks:** Fix per-part/voice `<backup>`/`<forward>`/`<chord/>`/rests, suffix-only `<kind text>` + `<bass>`, tick-interleaved harmonies, `<dot/>` (`720`/`1440` ticks, `NF-30`), `<rehearsal>`, `<barline>`, `<staff>`/`<staves>`, `includeLyrics` flag (`NF-21`), bound-once lyrics (`24`, not `48`) in `MusicXmlGenerator` & `MusicXmlSerializer` (`MF-09`); map `'NATURAL_MINOR' -> 'minor'` (`MF-10`); import all parts, multi-`<tie>` `CONTINUE`, `<words>` lyrics, bounded `.mxl` ZIP unzip (`maxOutputLength`/zip-slip), scoped XXE regex across all 3 files (`MF-11`); fix `midi-serializer:261` absolute `startTick`, multi-track/channel + Program Change + ch 9 drums, merged tie chains, mid-song meta, Format 0 channel split (`MF-12`); assign deterministic `chordId` + implicit-rest allowance without weakening unmeasured `.tab`/ChordPro `BLOCKED_ZERO_FABRICATION` (`MF-13`, `RR-06`); fix ChordPro minor fifths, invalid-key `null`, `.cho`/colon-less directives, `capo`/`artist` metadata, multi-bar distribution, relative chord tick + `usedChordIds` (`MF-14`); replace `Buffer` with `TextEncoder`, `# Obra:`, muted `'x'`, `capoFret` tab export, `usedStringsAtTick`, chronological sort, 1-char rhythm header fix (`MF-15`); remove `0.1` AlphaTex fallback, add voice/chord/rest/`<dot>`/mid-song changes/normalized `lyr.tickOffset` (`MF-16`); fix `fixtures.ts:131,139,148` (`NF-19`) & `musicxml-serializer.test.ts:57` (`NF-20`).
7. **Shared-File Conflicts:** `#8` (reads frozen `DerivedMusicalView`), `#18` (`midi-export-gatekeeper.ts` / `temporal-validator.ts` co-review w/ Agent 2).
8. **Parallelizable Tasks:** Independent of `Track 3C` & `Track 3D`; runs after `3A` freeze alongside `3E-2`.
9. **Tasks Requiring Sequential Integration:** Synchronize `.mxl` ZIP capabilities with Agent 6 (`FormatCapabilities`) and AlphaTex/MusicXML generator contracts with Agent 7 (`3E-2`).
10. **Regression Risks:** `RR-06` (`MidiExportGatekeeper` accidentally allowing `.tab` fabrication), breaking bug-locking `musicxml-serializer.test.ts:57` (`NF-20`) & `fixtures.ts:131` (`NF-19`).
11. **Required Tests:** Close `BS-01`–`BS-04`; run `AlphaTexImporter` parser check (`BS-01`), full SMF binary parser (`61,440` exact, signed `FF 59`, multi-channel, ch 9, tie merge, tempoless), XXE + zip-bomb `.mxl`, `Buffer=undefined` `.tab` test, *En Tu Presencia* 10-stage suite + `6/8` dotted-rhythm suite.
12. **Acceptance Evidence:** **`GATE 5`** green proof (`0` `VALIDATION_ISSUE`s, `24` lyrics, `3` tracks, `8` sections, `61,440` exact MIDI ticks, `0` canonical mutations).
13. **Rollback Strategy:** Stateless codec PR reverts safely cleanly without DB changes.
14. **Exit Criteria:** Signed **`GATE 5`** musical acceptance.

---

### 4.6 `Track 3C` (`WS-R2.2` + `WS-R2.3-Logic`) — Security, Identity, RBAC, Documents & ACID Concurrency (`Stage 3`)
1. **Workstream ID:** `Track 3C` (`WS-R2.2` + `WS-R2.3-Logic`)
2. **Responsible Agent:** **Agent 5** (`Auth/RBAC/Docs/AppSec`) + **Agent 4** (`PG CRUD/TX/FOR UPDATE/Shutdown`)
3. **Exact Exclusive File Ownership:** Agent 5 (`auth/invitation/password-reset/token/audit/stream-ticket/document/realtime-session-manager` services, `password-reset/omr-proposal` repos, `auth/user/document/realtime/health` routes, `auth-middleware/rate-limiter`, `auth-types`, `audit-sanitizer`, `pdf-text-extractor/pdf-utils/document-storage-provider/source-storage-provider`, `app.ts`, bridge env allowlist slice `#15`); Agent 4 (`song/version/setlist/worship-service/refresh-token/user/background-job` repos, `song/setlist/worship-service/ingestion-persistence` services, `song.routes`, `song.schemas`, `server.ts`, `env.ts` trap fix, `user-preferences.schemas.ts`).
4. **Required Upstream Decisions:** **`GATE 4`** + **`GATE 6`** + **`POD-01`**, **`POD-02`**, **`POD-03`**, **`POD-04`**, **`POD-07`**, **`POD-08`**, **`POD-09`** (`ENABLE_EXPERIMENTAL_ROUTES`).
5. **Entry Criteria:** `0021` DDL (`visual_documents`, triggers, `RESTRICT`), batched `env.ts`, and `packages/music-core` live on `main`.
6. **Technical Tasks:**
   - **AppSec (`MF-24`–`MF-31`, `NF-04`–`NF-07`, `NF-13`, `NF-24`, `NF-25`):** Wire `IMailTransport` (`POD-04`), strip `invitationToken` from prod HTTP/logs; lock `/invite`/`/enable`/`/disable`/cross-role `SUPER_ADMIN`/`/change-initial-password` (`NF-05`); remove `GET /auth/refresh`, honor `REFRESH_TOKEN_EXPIRES_IN_DAYS`, strict `s/m/h/d` JWT TTL, constant Argon2id timing, logout (`POD-08`) + `clearCookie` attributes (`NF-06`) + ticket revocation; refresh `request.user.role = dbUser.role` in `auth-middleware` (`NF-04`), force `'DRAFT'` (`POD-03`), protect `/audio/recovery/reconcile` & `DELETE /audio/:id` & `omr_proposal` `SUPER_ADMIN` & realtime host role; replace `DocumentService` RAM `Map` w/ PG `visual_documents` + backfill + IDOR checks (`MF-28`) + fill `song_sources` columns (`NF-11`) & throw on delete error (`NF-13`); bound `zlib.inflateSync` (`4 MiB/16 MiB` caps on both PDF utils) & harden `resolveSafePath` (`MF-29`); allowlist Python worker env (`MF-30`); disable prod Swagger, add Pino `redact`, `TRUST_PROXY`, sanitized 503/500, SSE CORS/Helmet headers + `x-test-close` gating, ISO-safe `audit-sanitizer`, wire `@fastify/rate-limit` (`MF-31`, `C-01`); fail-closed `omr.routes.ts:204` (`NF-24`) & gate experimental R3+ routes (`NF-25`).
   - **ACID & Ops (`MF-20`–`MF-23`, `NF-02`):** Thread `tx` through `SongService`/`SongRepo`; add `FOR UPDATE` on `songs`/`setlists`/`SUPER_ADMIN`/refresh rotation/atomic `password-reset-repository.ts` (`NF-02`)/atomic login failure count; `WorshipService` transitions; expose `PATCH/status/DELETE /songs/:id` (`POD-03`/`POD-07`) + attribution + escaped filters + true `sourceFormat`; strict `--test` match in `env.ts` (`MF-22`); reorder `server.ts` shutdown (`app.close() -> worker.stop() -> queue.stop() -> pool.end()`) (`MF-23`).
7. **Shared-File Conflicts:** `#3` (`app.ts`), `#4` (`server.ts`), `#5` (`env.ts`), `#13` (`audio.routes.ts` RBAC patch submitted to Agent 6), `#15` (`python-audio-worker-bridge.ts` allowlist submitted to Agent 6), `#21` (`song-service`/`repo`).
8. **Parallelizable Tasks:** Disjoint from `Track 3A/3B` and `Track 3E-1`; Agent 4 repo methods & Agent 5 services pair cleanly inside Worktree `wt-3c`.
9. **Tasks Requiring Sequential Integration:** Finalize auth/song DTO contracts before Stage 4 `api-client.ts` consumes them; hand RBAC guard diffs for `audio.routes.ts` to `Track 3D`.
10. **Regression Risks:** `RR-02` (`RESTRICT` / teardown), `RR-09` (logout UX), `RR-10` (`DRAFT` workflow), `RR-11` (`visual_documents` backfill), `RR-12` (`TRUST_PROXY`), `RR-18` (RAM rate limits if multi-replica).
11. **Required Tests:** Full 5-role RBAC matrix, `403` document IDOR across restarts, multi-stream PDF bomb, Python env secret assertion, atomic `reset-password`/refresh/setlist `Promise.all` (`>=5–10` conns), `POST /auth/logout`, double-`SIGTERM` `pool.totalCount === 0`, SQLSTATE `400/409`, HTTP `omr` fail-closed `BS-06`.
12. **Acceptance Evidence:** Security + concurrency suites 100% green under non-superuser runtime role (`GATE 6`).
13. **Rollback Strategy:** Reversible forward commits; `TRUST_PROXY`, `ENABLE_EXPERIMENTAL_ROUTES`, and rate-limits tunable via env; retain `visual_documents` additive table & fail-closed security gates.
14. **Exit Criteria:** Track 3C verification green inside `GATE 6`.

---

### 4.7 `Track 3D` (`WS-R2.4`) — Audio Worker, `pg-boss` Queue, Conversion & Storage (`Stage 3`)
1. **Workstream ID:** `Track 3D` (`WS-R2.4`)
2. **Responsible Agent:** **Agent 6** *(coordinating S3/Docker backup scripts w/ Agent 10 & RBAC w/ Agent 5)*
3. **Exact Exclusive File Ownership:** `workers/audio_worker/{main,audio_inspector,audio_analyzer,signature_inspector}.py`, `backend/src/domain/audio/*`, `backend/src/domain/storage/storage-provider.ts`, `backend/src/domain/ingestion/adapters/{audio,visual-score,video}/*`, `backend/src/application/{audio,audio-transcription,universal-ingestion,conversion-job,conversion-worker,output-retention}-service*.ts`, `backend/src/infrastructure/queue/conversion-queue.ts`, `backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts` (`#15`), `backend/src/interfaces/http/routes/{audio,conversion,ingestion}.routes.ts`, `packages/music-core/src/conversion/{format-capabilities,conversion-engine}.ts`, `packages/music-core/src/ingestion/unified-importer.ts`, `docker-compose.yml` backup/volume slice (`with Agent 10`).
4. **Required Upstream Decisions:** **`GATE 4`** + **`GATE 6`** + **`POD-01`**, **`POD-03`**, **`POD-05 B`**, **`POD-09`**.
5. **Entry Criteria:** `0021`, `env.ts`, `pgboss` schema pre-grants, and `packages/music-core` on `main`.
6. **Technical Tasks:**
   - Move `POST /audio/:id/analyze` onto `pg-boss` (`202` + `concurrency: 1`), stream multipart via `@fastify/multipart`, switch Range `206` to O(range) metadata/cache, add SQL `WHERE`+pagination to `listDraftsBySongId`, fail closed in prod on missing `.venv` dependencies (`MF-33`).
   - Add WebM/EBML signature checks (`MF-34`), `.mp4` `isom`/`mp42` audio decision (`NF-08`), real Viterbi DP + chroma-novelty sections, **chunked `_median_filter_1d_axis` bounding RSS (`NF-12`!)**, `POD-05 B` FFmpeg compliance.
   - Preserve source metadata across `failJobFenced`/`recoverStaleJobs`, reset `attempts=0`/`errorCode=null` in `retryJob()`, add `deadLetter` & `singletonKey` (`MF-35`, `BS-05`), execute `tx`-bound `commitJobToCatalog` (`MF-20`).
   - Validate before CAS/DB write (or compensate + exclude failed rows from retry idempotency `201`), remove double disk write (`NF-09`), add RIFF/WEBP validation, align `FormatCapabilitiesEvaluator` 1:1 w/ `ConversionEngine`, clean `video-url-adapter` hash (`NF-10`) & `audio-adapter` flag (`MF-36`).
   - Fix `OutputRetentionService` (`errorDetails` select, accurate `dryRun` DB check, `runFullCycle` reconcilers, `pg-boss` cron), wire local signed URL download route or retire dead signer, expose Phase 2B.1 externalized conversion preview endpoint for `ConversionCenter` (`MF-37`, `MF-42`).
   - Fix all 4 `S3CompatibleStorageProvider` bugs (`Host` before signing, RFC-3986 + ASCII sort, `ContinuationToken` pagination + XML unescape, throw `StorageError` on non-404), unify storage factory per `POD-01`, add automated DB+storage backup/restore scripts (`MF-38`).
7. **Shared-File Conflicts:** `#6` (`@fastify/multipart`), `#13` (`audio.routes.ts` + Agent 5 RBAC), `#14a` (`conversion-worker`, `audio-transcription-service` + Agent 4 `tx`), `#15` (`python-audio-worker-bridge.ts` + Agents 5 & 10).
8. **Parallelizable Tasks:** Disjoint from `Track 3A/3B` and `Track 3E-1`; runs cleanly in `wt-3d`.
9. **Tasks Requiring Sequential Integration:** Finalize `202` audio polling & Phase 2B.1 conversion preview DTOs before Stage 4 integrates `api-client.ts` & `ConversionCenterWorkspace.tsx`.
10. **Regression Risks:** `RR-05` (S3 bug causing premature retention delete), `RR-16` (GPLv3 redistribution), `RR-17` (`202` audio contract migration), `NF-12` (`~1.26 GB` numpy median RAM spike).
11. **Required Tests:** `105` conversion worker + `BS-05` (`RETRIES_EXHAUSTED` + `LEASE_EXPIRED_MAX_ATTEMPTS` retry + DLQ), `40` audio tests + WebM/202/Range I/O/`WHERE` isolation, repeat invalid ingestion `400` (`0` orphans), `output-retention` `dryRun` accuracy, S3 HTTP mock (`publicBaseUrl`, `>1k` keys, `403`/`500`), executed backup/restore drill, `.venv` `pytest` incl. WebM + Viterbi + 7-min RAM check.
12. **Acceptance Evidence:** Worker/audio/retention/S3/backup certification evidence verified inside **`GATE 6`**.
13. **Rollback Strategy:** Runtime kill switches (`OUTPUT_RETENTION_ENABLED=false`, `STORAGE_BACKEND=local`), `analysisVersion` pin on Python drafts, forward PR reverts.
14. **Exit Criteria:** Signed **`GATE 6`** backend & operational acceptance.

---

### 4.8 `Track 3E-1` (`WS-R2.6` Standalone Part A) — SW, Offline Hooks, Modals A11y, Wake Lock, CSS & Onboarding UI (`Stage 3`)
1. **Workstream ID:** `Track 3E-1` (`WS-R2.6` Parallel UI Modules — split per `Conflict C-05`)
2. **Responsible Agent:** **Agent 7**
3. **Exact Exclusive File Ownership:** `frontend/public/sw.js` (`#20`), `frontend/src/core/offline/*`, `frontend/src/core/autoscroll/*`, `frontend/src/index.css` (`#22`), `frontend/src/components/{auth,admin,common,offline}/*`, `frontend/src/components/workspace/{VisualDocumentStand,AutoscrollControl,SetlistNavigationToolbar,FormatCompletionWizardModal,LoginModal,SongHeader}.*`, standalone hooks (`useWakeLock` `NF-14`, `useModalA11y`), onboarding UI screens.
4. **Required Upstream Decisions:** **`GATE 4`** + **`POD-04`** (onboarding flows) + **`POD-09`** (`DocumentConversionModal` disposition).
5. **Entry Criteria:** `WS-R2.5A` merged (`@bethesda/music-core` live).
6. **Technical Tasks:** Fix `sw.js` (`v3` precache `/manifest.webmanifest`, `503 Response` on SWR miss, prep for precache manifest `RR-08`, fix `sw-lifecycle-manager:27`); fix `use-autoscroll` callback-ref/DOM-node remount listener loss + `ResizeObserver`; build Screen Wake Lock hook `useWakeLock` (`NF-14`); fix `VisualDocumentStand:313` error state (no `"GRANDE ES TU FIDELIDAD"` leak), TIFF magic/ext detection, nested `<main>`, modifier-safe keys (`MF-41`); build centralized keyboard arbiter (`Scope` -> `Modal > Input > Stand/PDF > Autoscroll`, standard OS `PageUp/PageDown`/`Arrow` only — zero pedal APIs `C-03`); fix `index.css` (`<= 640px` mobile bar stacking, replace CSS `zoom` w/ `--stand-zoom-scale`, fix `.workspace-song-header` typo `NF-16`, fix light-theme inline colors `NF-17`, add `@media print` & `prefers-reduced-motion`, modal z-index `9990+`, shared `useModalA11y` Esc+focus-trap) (`MF-43`); build standalone `/accept-invite`, `/forgot-password`, `/reset-password` UI components (`MF-24`).
7. **Shared-File Conflicts:** `#20` (`sw.js` synced w/ Agent 10), `#22` (`index.css`), `#25` (`workspace/index.ts`).
8. **Parallelizable Tasks:** Completely parallel with `Track 3A`, `3C`, `3D`!
9. **Tasks Requiring Sequential Integration:** Defers touching `App.tsx`, `api-client.ts`, `MusicalWorkspace.tsx`, `ConversionCenterWorkspace.tsx`, and `vite.config.ts` until `Stage 4`.
10. **Regression Risks:** `RR-08` (SW cache drift), `RR-19` (zoom height vs autoscroll sync), `RR-20` (keyboard priority conflicts).
11. **Required Tests:** `sw.js` mock tests (`503` SWR + `/manifest.webmanifest`), `use-autoscroll` remount + static zero-pedal scan, Wake Lock fallback unit test, keyboard arbiter priority tests, `VisualDocumentStand` missing-doc/TIFF/landmark tests, modal `Escape`/focus-trap SSR tests.
12. **Acceptance Evidence:** Clean `frontend tsx --test` + `typecheck` in `wt-3e`.
13. **Rollback Strategy:** Commit-per-concern allows reverting CSS/WakeLock/Arbiter independently; bump `sw.js` `CACHE_NAME` (`v4`) if cache rollback needed.
14. **Exit Criteria:** Merged to `main` ahead of Stage 4 UI integration.

---

### 4.9 `Track 3E-2` (`WS-R2.6` Renderer Adapters Part B) — OSMD, AlphaTab & LeadSheetDOM Adapters (`Stage 3`)
1. **Workstream ID:** `Track 3E-2` (`WS-R2.6` Renderer Adapters — gated by `Track 3A` freeze per `Conflict C-05`)
2. **Responsible Agent:** **Agent 7** *(consuming frozen contracts from Agents 2 & 3)*
3. **Exact Exclusive File Ownership:** `frontend/src/core/rendering/{renderer-registry,renderer-contract}.ts`, `frontend/src/core/rendering/adapters/{osmd,alphatab,leadsheet-dom}-adapter.ts`, `frontend/src/core/rendering/react/use-music-renderer.ts`.
4. **Required Upstream Decisions:** `Track 3A` `DerivedMusicalView` interface freeze + **`GATE 5`**.
5. **Entry Criteria:** `Track 3A` (and `Track 3B` MusicXml/AlphaTex contract alignment) merged cleanly.
6. **Technical Tasks:** Prioritize `OSMD` over `ALPHATAB` for `STANDARD_NOTATION`/`GRAND_STAFF`/`PERCUSSION_NOTATION` (`MF-39`); update AlphaTab `settings.display.staveProfile` via `updateSettings()` on profile changes (`MF-39`); make OSMD/renderer `renderToContainer` async/await with cancellation token so errors transition React UI to `'ERROR'` + LeadSheet fallback CTA (`MF-39`); fix `AlphaTabAdapter:241` measure-relative lyric ticks; fix `LeadSheetDomAdapter` (prefer transposed `chordsData`, normalized `(c.startTick - measure.startTick) === lyr.tickOffset`, strip duplicate `-`, Capo `displayKey = transposeKey(concertKey, -capoFret)`) (`MF-40`).
7. **Shared-File Conflicts:** Reads frozen `#8` (`DerivedMusicalView` owned by Agent 2).
8. **Parallelizable Tasks:** Can run alongside `Track 3B` once `Track 3A` freezes `DerivedMusicalView`.
9. **Tasks Requiring Sequential Integration:** Must land before Stage 4 `MusicalWorkspace` / lazy renderer dynamic `import()` integration (`MF-44`).
10. **Regression Risks:** `RR-07` (`ProjectionService` mismatch), breaking `browser-rendering-integration.test.ts` or `BS-08` multi-bar Capo logic.
11. **Required Tests:** `selectBestRenderer(['STANDARD_NOTATION']) === 'OSMD'`, AlphaTab `updateSettings()` call test, mocked OSMD reject -> `'ERROR'` state, non-tonic bar-1 Capo multi-bar LeadSheet (`BS-08`), aligned `browser-rendering-integration.test.ts`.
12. **Acceptance Evidence:** Rendering unit suites + Stage 5 *En Tu Presencia* green.
13. **Rollback Strategy:** Revert adapter PR cleanly; preserve `Track 3A` domain fixes.
14. **Exit Criteria:** Merged ahead of Stage 4 integration.

---

### 4.10 `Stage 4` (`WS-R2.6-Integration`) — Sequential Monolith Wiring, Offline Open Loop & Auth UI Integration
1. **Workstream ID:** `WS-R2.6-Integration` (`Stage 4` Serialized Lock)
2. **Responsible Agent:** **Agent 7**
3. **Exact Exclusive File Ownership:** `frontend/src/App.tsx` (`#19`), `frontend/src/core/api/api-client.ts` (`#10`), `frontend/src/core/workspace/{use-musical-workspace,workspace-orchestrator,music-stand-controller,use-setlist-execution}.ts`, `frontend/src/core/workspace/reading-format-selector-component.ts`, `frontend/src/components/workspace/{MusicalWorkspace,SourceFileUploader,DatabaseSongsModal,OfflineInventoryModal}.tsx` (`#11`), `frontend/src/components/conversion/ConversionCenterWorkspace.tsx` (`#12`).
4. **Required Upstream Decisions:** **`GATE 5`**, **`GATE 6`**, **`GATE 7`** + `POD-03`, `POD-04`, `POD-09`.
5. **Entry Criteria:** Tracks `3A`, `3B`, `3C`, `3D`, `3E-1`, `3E-2` ALL merged cleanly on `main`.
6. **Technical Tasks:** Add `acceptInvite`/`requestPasswordReset`/`confirmPasswordReset`, async `202` audio job polling, Phase 2B.1 conversion preview hydration, Song CRUD/status methods to `api-client.ts` (`MF-21`, `MF-24`, `MF-33`, `MF-42`); wire `/accept-invite`, `/forgot-password`, `/reset-password` routes & `OfflineStatusBar` `onSelectSong`/`onSelectSetlist` callbacks in `App.tsx` (`MF-24`, `MF-44`); switch `DatabaseSongsModal` to `BethesdaApiClient.getInstance()` & preserve `null` key/BPM/meter (`MF-08`, `MF-44`); wire IndexedDB offline read-through open loop in `MusicalWorkspace` & `useSetlistExecution` (`MF-44`); hydrate `ConversionCenterWorkspace` Phase 2B.1 preview + `"Abrir en Atril"` + async `202` audio poll + case-insensitive `.toLowerCase()` binary allowlist + clean stale audio-player copy (`MF-42`, preserving `DiagnosticPanel` separation `C-09`); persist MusicXML/ChordPro in `SourceFileUploader`, fix TIFF MIME + `approve` UI workflow (`POD-03`); stabilize `useMusicalWorkspace` preference hydration so setlist/song transposition overrides are preserved, fix `reading-format-selector` dirty-tuple compare, map `GRAND_STAFF: 'SCORE'` in `music-stand-controller`, integrate solo Stand Action Strip + `--stand-zoom-scale` + keyboard arbiter + `useWakeLock` (`MF-42`, `MF-43`, `NF-14`); integrate dynamic `import()` / `React.lazy()` hooks for `OSMD`, `AlphaTab`, and `ConversionCenterWorkspace` (`MF-44`). *(Also clean `PDF`/`MusicXML` UI `'Sol Mayor'`/`'C Major'` fabrication defaults `MF-08`.)*
7. **Shared-File Conflicts:** `#10` (`api-client.ts`), `#11` (`MusicalWorkspace.tsx`), `#12` (`ConversionCenterWorkspace.tsx`), `#19` (`App.tsx`) — single-track serial lock.
8. **Parallelizable Tasks:** None (strictly sequential integration wave).
9. **Tasks Requiring Sequential Integration:** Synchronized lock-step landing with `WS-R2.5B` Vite chunking & `sw.js` `v3` precache manifest (`RR-08`).
10. **Regression Risks:** `RR-08` (offline dynamic chunk failures), `RR-17` (audio `202` mismatch), `RR-19` (zoom vs autoscroll drift), `RR-20` (shortcut precedence), `C-09` (preserve `DiagnosticPanel` out of Stand).
11. **Required Tests:** Case-insensitive binary classification, full dirty-tuple comparison, setlist-key preservation across pref loads, `GRAND_STAFF -> 'SCORE'`, IndexedDB offline open unit tests, full regression (`backend` + `frontend` + `Python`), Manual Matrix `M-01`–`M-07`.
12. **Acceptance Evidence:** Zero console errors & passing **`M-01`–`M-07`** Project Owner sign-off (`GATE 7`).
13. **Rollback Strategy:** Modular sub-PRs inside Stage 4 + `sw.js` `CACHE_NAME` bump (`v4`).
14. **Exit Criteria:** Stage 4 UI merged cleanly ahead of `WS-R2.5B` & `GATE 7`.

---

### 4.11 `WS-R2.5B` (`Stage 4` Release Packaging) — Vite `< 800 kB` Splitting, Worker `.venv` Lock, CI & Release Gate
1. **Workstream ID:** `WS-R2.5B` (`Stage 4` Build, CI & Release Prep — split per `Conflict C-04`)
2. **Responsible Agent:** **Agent 10** *(coordinating `sw.js` precache manifest w/ Agent 7 & backups w/ Agent 6)*
3. **Exact Exclusive File Ownership:** `frontend/vite.config.ts` (`#7`), `workers/audio_worker/{requirements.txt,requirements.lock}`, `docker-compose.yml`, `.github/workflows/**`, `README.md` (`#25`), release manifest / checksum scripts.
4. **Required Upstream Decisions:** **`GATE 7`**, **`POD-01`**, **`POD-05 B`**.
5. **Entry Criteria:** Stage 4 lazy imports (`OSMD`, `AlphaTab`, `ConversionCenterWorkspace`) & storage backup scripts in place.
6. **Technical Tasks:** Configure Vite `8.3.0` (Rolldown) chunk splitting (`vendor-osmd`, `vendor-alphatab`, `conversion-center`, verified asset paths `NF-06-FE`) keeping initial chunk **`< 800 kB`**, emit chunk precache manifest into `sw.js` `v3` (`RR-08`) + offline `DownloadForOffline` chunk warmup; generate hash-pinned `workers/audio_worker/requirements.lock` (`POD-05 B1/B2` notice); finalize `docker-compose.yml` storage volumes + backup healthchecks (`POD-01`); enable `.github/workflows` CI (`typecheck`, `build`, `bundle-budget`, `git-bloat-guard`, `tsx` tests, privacy scan); update stale `README.md` (`React 19`, `22` tables / `0021`, `@bethesda/music-core`, `ENABLE_EXPERIMENTAL_ROUTES`).
7. **Shared-File Conflicts:** `#7` (`vite.config.ts`), `#20` (`sw.js` precache sync), `#25` (`README.md`).
8. **Parallelizable Tasks:** `.venv` lock & CI workflows can prepare in parallel while Stage 4 UI settles; Vite `manualChunks` + `sw.js` sync lands atomically with/right after Stage 4.
9. **Tasks Requiring Sequential Integration:** Final `vite build` + `sw.js` precache verification + full `GATE 7` manual `M-01`–`M-07` + `GATE 8` soak telemetry & release tag `vX.Y.Z`.
10. **Regression Risks:** `RR-08` (Rolldown chunking breaks AlphaTab worker/Bravura fonts or offline precache), `RR-16` (GPLv3 compliance on container images).
11. **Required Tests:** `vite build` initial JS budget **`< 800 kB`**, AlphaTab worker/font asset integrity test, `sw.js` offline precache test, `0`-violation privacy/governance scan, full compiled `dist/server.js` soak telemetry (`15–30m`), Manual `M-01`–`M-07`.
12. **Acceptance Evidence:** Release Candidate manifest with SHA-256 build/migration checksums (`GATE 8`).
13. **Rollback Strategy:** Deploy N-1 immutable release build against expand-only DB; increment `sw.js` `CACHE_NAME`.
14. **Exit Criteria:** Signed **`GATE 7`** & **`GATE 8`** Project Owner Release Sign-Off.

---

## 5. Approved Architecture Baseline, Technical Follow-Ups & Version History

- **Approved Architectural Decisions (`2026-11-27` — Ratified for Future Gated Execution):**
  - `POD-01 Opt A+B Hybrid`: `1` API replica + persistent temp workspace + queued `pg-boss` audio (`concurrency: 1`) + fixed `S3CompatibleStorageProvider` + `OutputRetentionService` + automated `pg_dump`/object backup (`Track 3D` / `GATE 6`).
  - `POD-02 Opt A`: Single-church-per-DB instance documented in `0021`/ops docs; multi-tenant RLS deferred to `R3+` (`Stage 2A` / `GATE 4`).
  - `POD-03 Opt B`: `WORSHIP_LEADER` / `ADMIN` / `SUPER_ADMIN` review approvals, mandatory `'DRAFT'` on ingestion, per-format `approvedFormats[]` isolation (`Track 3A`+`3C`).
  - `POD-04 Opt C`: Transactional SMTP relay + full onboarding/recovery UI + `SUPER_ADMIN` break-glass fallback; suppress prod token leaks (`Track 3C`+`Stage 4`; SMTP provider selection tracked before staging/prod `GATE 6`).
  - `POD-05 Git A1 / FFmpeg B2`: Untrack `backend/node_modules/` & `backend/storage/*` (keeping verified backups + `.gitkeep`) in `REM-04` (`GATE 2`); replace bundled GPLv3 `imageio-ffmpeg` with external LGPLv2.1+ system `ffmpeg` binary (`Track 3D` / `GATE 6`).
  - `POD-06 Opt C`: Docs-only Stage 0 Governance PR `#3` + Category D `Option C` + `main` branch protection (`GATE 1` active).
  - `POD-07 Opt A`: Soft-archive primary model (`status = 'ARCHIVED'`) preserving `song_versions` `ON DELETE RESTRICT` + immutability triggers (`Stage 2A`+`Track 3C`).
  - `POD-08 Opt C`: Split logout (`Logout Current Session` via `jti`/refresh family revocation + `Logout All Devices` via `tokenVersion` bump) (`Track 3C` / `GATE 6`).
  - `POD-09`: Real OMR & unwired modules deferred to `R3+`, `ENABLE_EXPERIMENTAL_ROUTES=false` default in prod, retired `AudioPlayerBar` stale copy purged, dead duplicate `ingestion/conversion/*` excluded (`Stage 2B`/`Track 3C`/`Stage 4`).
  - `OI-01 Opt A`: Stage 2B `@bethesda/music-core` extraction sequenced before parallel Stage 3 tracks (`GATE 4`).
- **Execution Lock:** **`GATE 2` through `GATE 8` remain `100%` LOCKED / `NOT AUTHORIZED` (`[ ]`)**. Zero implementation (`WS-R2.0`–`WS-R2.6`) has begun.

### Version & Change History
- **v1.0** — `2026-11-27` (`UTC-05:00`) — Initial Stage 0 Master Implementation Readiness Plan detailing all `11` workstreams/tracks across `14` mandatory dimensions, `10` Musical Quality Principles, *En Tu Presencia* `4/4` ground truth + `6/8` companion plan, and `25` shared-file locks.
- **v1.1** — `2026-11-27` (`UTC-05:00`) — Recorded `2026-11-27` formal Project Owner decisions (`POD-01`–`POD-09`, `OI-01`) and downstream Stage 1–4 technical follow-up requirements while preserving strict **`NOT AUTHORIZED`** lock on **`GATE 2`–`GATE 8`** and all `WS-R2.0`–`WS-R2.6` workstreams.
