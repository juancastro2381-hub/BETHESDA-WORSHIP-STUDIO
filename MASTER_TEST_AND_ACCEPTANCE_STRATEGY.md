# BETHESDA WORSHIP STUDIO — MASTER TEST AND ACCEPTANCE STRATEGY

- **Date:** `2026-11-26` (`UTC-05:00`)
- **Baseline:** `main` @ `98919fe85d2c656076426d0a43a1222f9a752465`
- **Hard Testing Rules:** Real reproducible evidence only; **zero Playwright, Selenium, Cypress, or browser automation**; never weaken, delete, skip, or mock away failing assertions to achieve green runs.

---

## 1. Live Verified Baseline & Classification Distinction (`2026-11-25`)

| Check | Result | Executed / Pass / Fail | Classification |
|---|---|---|---|
| `npm.cmd --prefix backend run typecheck` (`tsc --noEmit`) | PASS | `1 / 1 / 0` | **`TESTED AND PASSED`** |
| `npm.cmd --prefix frontend run typecheck` (`tsc --noEmit`) | PASS | `1 / 1 / 0` | **`TESTED AND PASSED`** |
| `npm.cmd --prefix frontend run build` (`vite build`) | PASS (`1.07s`, `3,262.55 kB` JS warning) | `1 / 1 / 0` | **`TESTED AND PASSED`** |
| `workers\audio_worker\.venv\Scripts\python.exe -m pytest workers/audio_worker/tests/test_worker.py -v` | PASS (`17.62s`) | `18 / 18 / 0` | **`TESTED AND PASSED`** |
| `python -m pytest workers/audio_worker/tests/test_worker.py -v` *(system Python w/o `.venv`)* | FAIL (`18.07s`, missing `imageio_ffmpeg`/decode) | `18 / 11 / 7` | **`TESTED AND FAILED`** |
| `npm.cmd --prefix frontend test` (`node --test --experimental-strip-types`) | FAIL (`9.74s`: `3` `.tsx` + `browser-rendering-integration.test.ts:378` `0!==2`) | `628 / 624 / 4` | **`TESTED AND FAILED`** |
| `tsx --test` *(diagnostic on 3 `.tsx`-importing FE files from `frontend/` — note: diagnostic partial run stands as `TESTED AND PASSED` for those `17` cases)* | PASS (`0.95s`, isolating `#8` `0!==2` as real defect) | `17 / 17 / 0` | **`TESTED AND PASSED`** *(diagnostic)* |
| `9` pure non-DB backend suites (`tsx --test --test-concurrency=1`) | PASS (`5.97s`, `23` suites) | `109 / 109 / 0` | **`TESTED AND PASSED`** |
| In-memory `tsx` forensic trace on *En Tu Presencia* | Confirmed 6-beat OSMD/AlphaTab, `0.1`, 8-beat XML, `96` RT errors | `6` assertions / `5` fails | **`TESTED AND FAILED`** |
| Static SQL migration, `_journal.json`, `provision_app_runtime_role.sql` & Git/config inspection | Confirmed defects (`0020` order, role syntax/11 tables, `7,367` `node_modules`, privacy leaks) | Full repo | **`STATICALLY VERIFIED`** *(with defects)* |
| **`38` PG-dependent backend suites + `storage-provider.test.ts` + `backend build`** | Not run (read-only audit rules; zero disposable PG/FS mutation) | `0` executed | **`NOT EXECUTED`** |
| **Manual browser, mobile & physical music-stand acceptance (`M-01`–`M-07`)** | Not checked (read-only audit rules; human verification reserved for `GATE 7`) | `0` checked | **`NOT VERIFIED`** |

---

## 2. Suite Classification & Test Runner Alignment (`WS-R2.0` `REM-02` / `REM-03`)

### 2.1 Backend Test Taxonomy (`backend/src/__tests__/`, `48` files)
1. **Tier A — Pure Non-DB / Zero-`env.ts` (`6` files, plus FS-isolated `storage-provider.test.ts`):** `audit-sanitizer`, `canonical-serializer`, `rate-limiting-dual-dimension`, `setlist-domain-and-schemas`, `setlist-service`, and `storage-provider` (temp FS only; relocate temp output to OS temp dir during CI/audit). Runnable offline in `<2s`.
2. **Tier B — Env-Only (`4` files, zero live PG SQL):** `argon2-hasher`, `jwt-hs256-security`, `database-isolation`, `phase-r1-security-remediation`. Currently import `env.ts` / lazy `Pool` and require `.env` + `TEST_DATABASE_URL !== DATABASE_URL`. *(Goal: decouple pure crypto/token unit tests from `env.ts` or provide fail-closed config fixtures.)*
3. **Tier C — PostgreSQL-Dependent (`38` files, incl. `conversion-worker-certification` `105`, `omr-persistence` `68`, `audio-preservation` `40`, `api-routes`, `auth-flow`, `setlist-concurrency`, `cas-concurrency`, `output-retention`, `universal-ingestion-*`):** Run exclusively inside the Disposable PG Certification Protocol (Section 5).
   - **Pre-Certification Fixes Required (`REM-01`/`REM-02`):**
     - Add idempotent `runMigrations()` in `conversion-api.test.ts` `before()` so it can execute standalone on a clean DB.
     - Refactor `omr-persistence-and-integrity.test.ts:2546-2693` to read target DB/host/port dynamically from `env.TEST_DATABASE_URL` and generate ephemeral password via `crypto.randomBytes(16).toString('hex')` instead of hardcoded `bethesda_worship_test` and static password literal.

### 2.2 Frontend Runner Fixes (`frontend/package.json` & `78` files — `REM-03`)
1. Switch `"test"` and `"test:*"` in `frontend/package.json:9-14` from `node --test --experimental-strip-types` to `tsx --test` (matching `backend/package.json:14`) so `.tsx`-importing component suites run cleanly without weakening any React SSR assertions.
2. Replace `process.cwd()` in `frontend/src/core/autoscroll/__tests__/autoscroll.test.ts:266,270,327` with `fileURLToPath(new URL(..., import.meta.url))` so tests pass from both repo root and `frontend/`.
3. Fix `browser-rendering-integration.test.ts:362-380` test `#8`: project `acoustic_guitar` (`primaryRepresentation: 'CHORDS', secondaryRepresentations: ['LYRICS']`) for Capo `0 -> 2` **AND** add an explicit assertion proving `LYRICS_ONLY` preserves `capo === 0`.
4. Add startup validation in Python bridge tests asserting `.venv` resolution (`workers/audio_worker/.venv/Scripts/python.exe`) and explicit production fail-closed behavior if `pydantic` / `numpy` / `imageio_ffmpeg` are missing.

---

## 3. Eight Critical Test Blind Spots to Close (`BS-01`–`BS-08`)

| Blind Spot ID | Current Gap | Mandatory New / Strengthened Automated Tests |
|---|---|---|
| **BS-01** | OSMD/AlphaTab Node tests inspect shadow DTOs (`OsmdScoreData`/`AlphaTabScoreData`); **`0` tests on `MusicXmlGenerator`** or `!isTabRequested` `AlphaTexGenerator`. | Add `musicxml-generator.test.ts` and expand `alphatex-generator.test.ts` validating `XmlParser` output, `<backup>`, explicit rests, `<bass>`, `<mode>minor</mode>`, mid-song clefs, and zero `0.1` fabrication. |
| **BS-02** | `midi-serializer.test.ts` checks `MThd` header bytes only (`buffer[0..17]`) and tests zero-tempo on a fixture that *has* `TempoEvent(0,100)`. | Build a full binary SMF parser in test helper; verify exact `FF 51/58/59` meta-events, balanced Note-On/Off ticks across bars `1..32` (catching `120,960` double-offset), and no tie re-triggers. |
| **BS-03** | `musicxml-serializer.test.ts` tests G Major single-voice string substrings with zero re-import. | Add multi-voice, minor-key (`Am`/`Em`), slash-chord, unbound lyric, and section-marker (`<rehearsal>`) round-trip assertions through `MusicXmlImporter`. |
| **BS-04** | `round-trip-integrity.test.ts` tests `Ingestion -> PG JSONB -> Projection` only. | Extend round-trip certification to cover `Canonical -> MusicXML/MIDI/ChordPro Export -> Re-Import -> Semantic Parity Diff`. |
| **BS-05** | `conversion-pgboss-retry.test.ts` never invokes `ConversionJobService.retryJob()` after a failed job. | Add real E2E `failJobFenced` -> `ConversionJobService.retryJob()` -> `POST /conversion/jobs/:id/retry` test asserting preserved `storageKey`/`checksumSha256`, `attempts === 0`, cleared `errorCode`, and retry completion. |
| **BS-06** | `omr-e2e-auth-provenance.test.ts` triggers `NODE_ENV=test` stub `"Gracia Sublime Es"` (`omr.routes.ts:204`). | Add explicit fail-closed OMR test with `enableTestFixture: false` asserting honest `measures: []`, `overallConfidence: 0`, and zero fabricated notes. |
| **BS-07** | `omr-persistence` hardcodes DB/password; `provision_app_runtime_role.sql` misses 11 tables + `pgboss`; `assertNonSuperuserRuntimeRole` untested against real boot. | Run real `psql` provisioning on disposable DB, connect as `bethesda_app_runtime`, pass all `68/68` OMR + API smoke + `assertNonSuperuserRuntimeRole()` negative superuser check. |
| **BS-08** | `leadsheet-dom-adapter.test.ts` uses fixtures omitting `chordAbove` & never tests transposed/capo multi-bar alignment. | Add multi-measure transposition/Capo tests using fixtures *with* `chordAbove` (`En Tu Presencia` m.5–28) proving single transposed chords, bar 2+ alignment, and zero `--`. |

---

## 4. *En Tu Presencia (Referencia Litúrgica)* 8-Stage E2E Regression Suite

Target file: `frontend/src/core/conversion/__tests__/en-tu-presencia-e2e-regression.test.ts` (testing `createReferenceSongFixture()` + derived E minor / D minor variant, with zero generator/serializer mocks):

1. **Stage 1 — Canonical & Gatekeeper Invariants:** Freeze/snapshot canonical JSON before & after every stage (`0` mutations); `TemporalValidator.validate()` passes all 5 dimensions; `MidiExportGatekeeper.isEligible() === true`.
2. **Stage 2 — Multi-Instrument Projections:** Guitar Capo 2 (`TABLATURE+CHORDS` -> fingering `F`/`F/A`, concert `G`, valid frets); Piano (`GRAND_STAFF` -> Treble V1 & Bass V2); Alto Sax (`STANDARD_NOTATION` -> `E Major` 4♯, written `E5`); Lead Vocal (`LYRICS+CHORDS` `+2` -> `A Major` / `La`, m.24 `A/C#` / `La/Do#`); Lead Vocal (`LYRICS` only -> `includeChords: false`, `capo: 0`); every track preserves `1920` ticks/bar (`4` beats, rests intact).
3. **Stage 3 — `MusicXmlGenerator.generate()` (Direct):** Well-formed `XmlParser`, 32 bars, `<divisions>480</divisions>`, `<sound tempo="74"/>`, `<backup>` between voices, sum per voice `=== 1920` ticks, minor variant emits `<mode>minor</mode>`, m.24 has `<root-step>G</root-step><bass><bass-step>B</bass-step></bass>`.
4. **Stage 4 — `AlphaTexGenerator.generate()` (Direct):** `\title`, `\tempo 74`, `\capo 2`, `\tuning`, 32 bars, exact `4.0` beats per bar per voice, single `{txt "G"}` at beat 1 (no duplicates), zero fabricated `0.1` coordinates.
5. **Stage 5 — `LeadSheetDomAdapter.render()`:** 8 sections, 32 bars, `24` syllables; transposed `+2` / Capo 2 shows ONLY `A`/`F` (zero stale `G` from `chordAbove`, zero duplicates, zero `pre--`/`Dig--`); `textContent`-only XSS safety & `dispose()` cleanup.
6. **Stage 6 — `CanonicalToMusicXmlSerializer.serialize()`:** Well-formed XML, 32 bars, `<backup>` per voice, `<mode>minor</mode>` on minor variant, m.24 `<bass-step>B</bass-step>`, `<rehearsal>` 8 sections, `24` `<lyric>` elements (never doubled `48`), `kind/@text` suffix-only (no `GG`).
7. **Stage 7 — `MusicXmlImporter.import(exportedXml)`:** `0` `VALIDATION_ISSUE` errors, `32` bars, `61,440` ticks, `74 BPM`, tonic+mode exact (incl. minor variant), `3` `instrumentTracks` preserved (`track_lead_vocal`, `track_acoustic_guitar`, `track_alto_sax` `+9`), `160` notes + `32` rests, `32` chords (`G/B`), `24` lyrics (never doubled `48`), `8` sections preserved, `TemporalValidator.isValid === true`.
8. **Stage 8 — `CanonicalToMidiSerializer.serialize()` (Full SMF Binary Decoder):** Format 1, `480` TPQN, Track 0 tempo `810811` µs, time sig `[4,2,24,8]`, key sig `[1,0]` (and signed `0xFF, 0x01` for D minor), per-track and aggregate `160` Note-On & `160` Note-Off (`V1=32`, `V2=128`), first Note-On at `0`, **last Note-Off at exactly `61,440`**, exact pitch/duration fidelity across bars `1`, `16`, `24`, `32`.
*(Recommended Companion Additions — see `STAGE_0_MASTER_IMPLEMENTATION_READINESS_PLAN.md`: extend with Stage 9 ChordPro & Stage 10 browser-safe ASCII Tab round-trips, plus a dedicated `6/8` dotted-rhythm companion fixture [`1440` ticks/bar, dotted-quarter `<dot/>` `720` ticks, `FF 58 04 06 03 18 08`] since `reference-song.ts` is strictly `4/4`.)*

---

## 5. Disposable PostgreSQL Certification Safety Protocol

1. **Strict Target Whitelist:** Execute ONLY when target database name in `TEST_DATABASE_URL` equals `bethesda_worship_r2_cert_tmp` AND `areDatabaseTargetsEquivalent(TEST_DATABASE_URL, DATABASE_URL) === false` (`backend/src/db/index.ts:21-62`). Reject `bethesda_worship_dev`, `bethesda_worship_test`, and production targets.
2. **Pre-Flight Row-Count Guard:** Capture read-only row counts (`users`, `songs`, `setlists`, `audio_assets`, `omr_audit_history`) on primary dev/target DB before starting; re-verify identical counts at teardown.
3. **Isolated Storage & CWD:** Set `AUDIO_STORAGE_PATH` and working storage paths (`storage/sources`, `storage/outputs`, `storage/documents`) inside OS temp `$CERT_TMP`, with `AUDIO_STARTUP_RECOVERY_ENABLED=false` and ephemeral 32+ char secrets so zero files touch the repo tree.
4. **Migration Replay & Least-Privilege Role Test:** **`GATE 3` (`WS-R2.0`)** creates `bethesda_worship_r2_cert_tmp`, replays `0000`–`0020` cleanly (`TEST_DATABASE_URL`/`MIGRATION_DATABASE_URL` guarded by `NF-01`), provisions `bethesda_app_cert_runtime` (`NOSUPERUSER NOCREATEDB NOCREATEROLE`), verifies `omr_audit_history` immutability (`42501`/`55000`), and verifies `pgboss` runtime enqueue/consume without DDL privileges; **`GATE 4` (`Stage 2A`)** replays both a fresh `0000`–`0021` clean pass and a dirty-row upgrade clone (`0000`–`0020` + dirty rows -> `0021` -> idempotent re-run) plus `audit_logs` & `song_versions` immutability triggers.
5. **Sequential Suite Execution:** Run Frontend (`tsx --test`), Python `.venv` (`pytest`), Typechecks/Builds, and all `48+` Backend suites sequentially under `TEST_DATABASE_URL` as `bethesda_app_cert_runtime`.
6. **Mandatory Teardown Verification:** In `finally`: terminate connections, `DROP DATABASE IF EXISTS bethesda_worship_r2_cert_tmp`, `DROP ROLE IF EXISTS bethesda_app_cert_runtime`, delete `$CERT_TMP`, confirm catalog counts `=== 0`, primary DB row counts unchanged, and `git status` clean.

---

## 6. Manual Browser, Mobile & Physical Music-Stand Acceptance Matrix (`M-01`–`M-07`)

*(Strictly ZERO Playwright, Selenium, or Cypress. Human-verified by Project Owner / QA on real devices prior to `GATE 7`.)*

| ID | Device / Surface | Scenario | Objective Acceptance Criteria |
|---|---|---|---|
| **M-01** | Desktop Chrome & Firefox (1280×800+) | Open *En Tu Presencia* in Piano Grand Staff & Alto Sax (`STANDARD_NOTATION`) & Guitar `STANDARD_NOTATION`. Zoom 80%–160%. | Crisp OSMD SVG engraving (never AlphaTab `0.1`), 4 beats/bar across 32 bars, Bass + Treble populated for Piano, Alto Sax `E Major` (4♯), `G/B` at m.24, zero console errors. |
| **M-02** | Desktop + Tablet (10" iPad / Android) | Switch Guitar `STANDARD_NOTATION` <-> `TABLATURE` + Capo 2, plus Transpose `+2`. | AlphaTab updates `staveProfile` dynamically, Capo 2 fingering (`F`, `F/A`), Tab frets shift up `+2` when transposed, 4 beats/bar, zero `0.1` fabrication. |
| **M-03** | Mobile (`360–390px` portrait) & Tablet | Open `CHORD_CHART` & `LYRICS_ONLY` on multi-bar song with `chordAbove`, transpose `+2`, switch Light/Dark/High-Contrast, test `Ctrl+P` print. | Zero horizontal overflow, Measure 2+ chords aligned, single transposed chord (no duplicates, no `--`), bottom Autoscroll & Setlist bars do NOT overlap, readable print layout. |
| **M-04** | Physical Music Stand (iPad Safari / Android Chrome) | Use solo `Modo Atril` + Autoscroll (`0.5x`–`3.0x`) on score & PDF; test `VisualDocumentStand` `.tif` & missing doc; test `Space`/`Arrow`/`Ctrl+R/F/C` & modals. | Autoscroll scrolls internal stand cleanly; `Space` & `Arrow` never collide or trigger unintentionally; `Ctrl+R/F/C` work normally; missing non-sample doc shows error UI (never `"GRANDE ES TU FIDELIDAD"`); all modals close on `Esc` & trap focus; zero pedal permission prompts. |
| **M-05** | Concurrent Multi-Device (`Leader` + `Musician`) | Start live session as leader, attempt control as `MUSICIAN` or demoted host, inspect Network SSE & headers. | Unauthorized/demoted control returns `403`; single-use `?ticket=` works once (`2nd` returns `401`); SSE includes CORS headers; canonical PG song unchanged. |
| **M-06** | Tablet / Mobile PWA (Airplane Mode) | Download setlist & song while online (`/manifest.webmanifest` cached `200`, `0` 404s); enable **Airplane Mode**, cold-reload app, open cached setlist & song from UI. | Cold reload boots offline cleanly; cached songs & setlists open directly from Offline Inventory & Setlist without 503 failure; mutations blocked read-only; SW defers updates during live stage mode. |
| **M-07** | Desktop Auth Onboarding & Conversion Center | Walk `/accept-invite`, `/forgot-password`, `/reset-password` (SMTP per `POD-04`), MusicXML/MIDI/ChordPro/`.tab`/`.mp3`/`.webm` Conversion Center, preview & "Abrir en Atril", retry failed job. | Zero plaintext invite tokens in browser Network tab; Phase 2B.1 preview renders text & opens in Stand; MIDI export plays at `74 BPM` (~104s, 0 silent bars); minor MusicXML round-trips minor; browser `.tab` parses cleanly; failed job retries cleanly; OMR stays fail-closed (`0` fabricated notes). |

---

## Version & Change History

- **v1.0** — `2026-11-26` (`UTC-05:00`) — Initial Master Test and Acceptance Strategy.
- **v1.1** — `2026-11-27` (`UTC-05:00`) — Stage 0 evidence-backed reconciliation:
  - Separated combined `NOT EXECUTED / NOT VERIFIED` row (`L23`) into distinct `NOT EXECUTED` (`38` PG suites + `storage-provider.test.ts` + `backend build`) and `NOT VERIFIED` (manual `M-01`–`M-07`) rows; clarified diagnostic partial `tsx --test` `17/17` row (`L19`) stands as `TESTED AND PASSED` (evidence: Agent 8 §4).
  - Corrected *En Tu Presencia* lyric counts in Stages 5, 6, and 7 from `20` to **`24`** matching `reference-song.ts:59-114`, added explicit `3` `instrumentTracks` check to Stage 7, updated Stage 8 MIDI to exact `61,440` + per-track/aggregate `160` Note-On/Off, and added companion note for Stage 9/10 + `6/8` dotted-rhythm fixture (evidence: Agent 2 §3–§4, Agent 3 §4, Agent 8 §2, Agent 9 §1.1).
  - Split Section 5 item 4 disposable PG replay explicitly between `GATE 3` (`0000`–`0020`) and `GATE 4` (`0000`–`0021` + dirty-row upgrade clone) (evidence: Agent 8 §3 item 5).
- **v1.2** — `2026-11-27` (`UTC-05:00`) — Stage 0 `GATE 1` PO ratification update:
  - Reflected `2026-11-27` Project Owner approvals for `POD-04 Opt C` (SMTP + break-glass `SUPER_ADMIN` test coverage in `M-07`/`Track 3C`), `POD-05 Git A1 / FFmpeg B2` (clean `npm ci` + external LGPLv2.1+ system `ffmpeg` test parity in `GATE 3`/`Track 3D`), `POD-08 Opt C` (Split Logout session tests in `M-05`/`Track 3C`), and `POD-09` (`ENABLE_EXPERIMENTAL_ROUTES=false` fail-closed route tests).
  - **Execution Lock Preserved:** **`GATE 2`–`GATE 8`** remain strictly locked / `NOT AUTHORIZED`; `WS-R2.0` (`REM-01`–`REM-04`) execution has not started.
