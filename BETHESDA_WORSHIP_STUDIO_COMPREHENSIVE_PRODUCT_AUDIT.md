# BETHESDA WORSHIP STUDIO — COMPREHENSIVE PRODUCT, FUNCTIONAL, UX, ARCHITECTURE & IMPLEMENTATION AUDIT

**Audit Date:** `2026-11-20`  
**Repository Branch / HEAD:** `feature/phase-1a-core-foundation` @ `ceb28aae4ba4c49f55d7ddecfaf71853a3310886`  
**Scope:** End-to-end repository audit (`frontend/`, `backend/`, `workers/audio_worker/`, `docs/`)  
**Audit Verdict:** **`PASS — Comprehensive audit completed with sufficient repository evidence.`**

---

## 1. Executive Summary
**Bethesda Worship Studio** is an ambitious liturgical music workstation built around an immutable `CanonicalMusicPayload` model (480 TPQN), strict Zero-Fabrication musical safeguards, human-reviewed draft-to-version approval gates (`DRAFT` -> `APPROVED`), worship setlist orchestration, offline PWA read-only caching, and a local DSP audio transcription assistant (`Scope 1C`).

While its **musical theory core, PostgreSQL song/version provenance, and human approval architecture are genuinely engineered**, the product currently sits at **Pre-Release / Beta Engineering Maturity**, blocked from reliable church-wide live deployment by:
1. **Critical Notation & Projection Defects:** Standard notation on non-Grand-Staff instruments routes to `AlphaTab` emitting open-string `0.1` for every note (`alphatex-generator.ts:102-105`), ChordPro transposition duplicates untransposed inline chords (`projection-service.ts:220`, `leadsheet-dom-adapter.ts:140-170`), tablature ignores transposition (`projection-service.ts:227-266`), ASCII Tab client validation crashes in browsers on `Buffer.byteLength` (`ascii-tab-parser.ts:130`), and `VisualDocumentStand` displays a hardcoded SVG (`"GRANDE ES TU FIDELIDAD"`) on failed image loads (`VisualDocumentStand.tsx:313`).
2. **Broken Offline & Solo-Stand UX Loops:** Musicians can cache songs and setlists to IndexedDB, but opening offline songs (`MusicalWorkspace.tsx:702-703`), loading offline setlists (`use-setlist-execution.ts:135-152`), and opening items from `OfflineInventoryModal` (`App.tsx:43`) fail or hit network HTTP 503. Solo musicians lack Music Stand Mode, Zoom, and High Contrast (`MusicalWorkspace.tsx:569-600`).
3. **Stale Audio Playback Promises & Missing Export/Print/Share:** Audio playback was intentionally retired (`AudioPlayerBar.tsx` returns `null`), yet empty-song UI still directs users to `"el reproductor superior"` (`MusicalWorkspace.tsx:869-912`). Print (`@media print`), engraved PDF export (`ENGRAVED_PDF_DEFERRED_PHASE`), song sharing, and `/accept-invite` UI routing do not exist.
4. **Critical Backend & Security Defects:** `_journal.json` omits migrations `0018` and `0019` (fresh DBs fail on `cas_deletion_intents`), DB login lockout (`user-repository.ts:176-187`) never sets `accountStatus='LOCKED'`, `/api/v1/ingestion/*` and `/api/v1/conversion/jobs*` lack RBAC checks (`VIEWER` can upload/commit songs), `/conversion/validate` & `/transpile` accept 25 MiB unauthenticated unthrottled payloads, and `backend/tsconfig.json` has `"noEmit": true` preventing `npm start`.

---

## 2. Audit Scope
- **Included:** All production files in `frontend/src/` and `frontend/public/`, `backend/src/` (109 HTTP endpoints across 14 Fastify route plugins, 21 PostgreSQL tables across Drizzle schema & migrations `0000`–`0020`), `workers/audio_worker/`, and architecture/vision docs in `docs/`.
- **Excluded (Strict Read-Only Policy):** Zero source edits, zero DB writes/migrations, zero dependency edits, zero browser automation (`Playwright`/`Selenium`/`Cypress`), and zero DB-mutating backend integration runs.

---

## 3. Methodology
1. **Structural Mapping:** Enumerated all files in `frontend/src/`, `backend/`, `workers/audio_worker/`, and `docs/`.
2. **Line-Level Static Verification:** Inspected entry points, components, hooks, state orchestrators, music-theory/projection/rendering pipelines, API client, Fastify routes, Drizzle schema/migrations, Python DSP stages, and dead/orphaned code candidates.
3. **Non-Browser Automated Validations:** Executed TypeScript compilers (`frontend` and `backend`), full frontend unit test suite (`npx tsx --test`), stateless backend security/domain suites (`npx tsx --test`), Python audio worker tests (`pytest`), and Vite production build.
4. **Honest Status Taxonomy:** Classified every feature exclusively using: `VERIFIED COMPLETE`, `IMPLEMENTED — VALIDATION PENDING`, `IMPLEMENTED WITH DEFECTS`, `PARTIALLY IMPLEMENTED`, `UI ONLY`, `NOT IMPLEMENTED`, `NOT APPLICABLE`.

---

## 4. Repository & Architecture Overview

```mermaid
flowchart TB
  subgraph Client["React 19 + Vite SPA (frontend/src/)"]
    UI["MusicalWorkspace / MusicalControls / SetlistsModal / ConversionCenter"]
    Core["CanonicalMusicPayload + MusicTheory + ProjectionService"]
    Renderers["AlphaTab SVG | OSMD SVG | LeadSheetDOM | VisualDocumentStand"]
    Offline["OfflineManager (IndexedDB) + Service Worker (sw.js)"]
    UI --> Core --> Renderers
    UI --> Offline
  end

  subgraph API["Fastify 5 Backend (backend/src/) - 109 Routes"]
    Auth["Auth / Argon2id / HS256 JWT / Refresh Rotation"]
    Songs["Songs / Versions / Completion / Stand Capabilities"]
    Worship["Setlists / Worship Services / Realtime SSE / Multitrack"]
    Pipelines["Audio Scope 1C / Documents / OMR Stub / Universal Ingestion"]
    Worker["ConversionWorker (pg-boss queue: music-conversion)"]
  end

  subgraph Data["Persistence & Local Workers"]
    PG[("PostgreSQL 16 (21 Tables, Drizzle ORM)")]
    FS["Local Storage (audio 0o444, sources, documents, outputs CAS)"]
    PyWorker["Python Audio Worker (workers/audio_worker - FFmpeg + NumPy DSP)"]
  end

  UI -->|"REST + SSE + Tickets"| API
  API --> PG
  API --> FS
  Worker --> PG
  Worker --> FS
  Pipelines -->|"JSON Lines stdin/stdout (-X utf8)"| PyWorker
```

---

## 5. Complete Product Inventory
- **Shell & Identity (`frontend/src/App.tsx`, `components/auth/`, `components/admin/`, `components/theme/`):** Single-screen header, Light/Dark theme toggle, Login modal with `MUST_CHANGE_PASSWORD` challenge, `UserManagementModal` (CRUD, role updates, suspend/reactivate, invite links).
- **Digital Music Stand & Workspace (`components/workspace/`):** `MusicalWorkspace`, `SongHeader`, `MusicalControls`, `ReadingFormatSelector`, `InstrumentSelector`, `CapoControl`, `TranspositionControl`, `ChordNotationControl`, `RendererStatus`, `AutoscrollControl`, `VisualDocumentStand`, `ServiceMomentCard`, `SetlistNavigationToolbar`, plus collapsed QA drawer (`<details className="quick-scenarios-drawer">`) holding `SongSelector` (`WORKSPACE_SONG_CATALOG`) & `ScenarioPresets` (`GOLDEN_SCENARIO_PRESETS`).
- **Library, Ingestion & Completion:** `DatabaseSongsModal`, `SourceFileUploader`, `SetlistsModal`, `SetlistDetailEditor`, `FormatCompletionWizardModal`, `ConversionCenterWorkspace`, `DiagnosticPanel`.
- **Offline / PWA (`public/sw.js`, `core/offline/`, `components/offline/`):** 7-day read-only offline identity snapshot, IndexedDB `BethesdaOfflineDB`, `OfflineStatusBar`, `DownloadActionButton`, `OfflineInventoryModal`.
- **Core Musical Engines (`frontend/src/core/`):** `music-theory`, `canonical-model`, `ingestion` (`MusicXML`, `ChordPro`, `AsciiTab`, visual passthrough), `conversion` (`FormatCapabilitiesEvaluator`, `ConversionEngine`, 5 serializers), `projection` (12 instrument profiles, `TablatureCalculator`), `rendering` (`AlphaTabAdapter`, `OsmdAdapter`, `LeadSheetDomAdapter`).
- **Backend & Audio Worker (`backend/src/`, `workers/audio_worker/`):** Auth/RBAC, User Preferences, Song Versioning & Provenance, Stand Capabilities & Completion Proposals, Audio Preservation (`chmod 0o444`) & 10-stage NumPy DSP Worker, OMR Proposal/Audit-History framework, PDF Text Extractor, Conversion Queue (`pg-boss`), Setlists/Services, In-Memory SSE Realtime, Multitrack session CRUD.
- **Orphaned / Unused Modules Identified:** `AudioPlayerBar.tsx`, `DocumentConversionModal.tsx`, `RepresentationSelector.tsx`, `RealtimeLiturgicalBadge.tsx` + `core/realtime/`, `core/multitracks/`, `omr-proposal-handler.ts`, `OutputRetentionService` (unwired), `S3CompatibleStorageProvider` (unwired).

---

## 6. Functionality-by-Functionality Analysis

### 6.1 Digital Music Stand Core (Formats, Instruments & Adaptations)

| Field | Atril Reading Formats (`Partitura`, `Cifrado con Letra`, `Letra Sola`, `Tablatura`) | Instrument, Capo, Transposition & Chord Notation (`STANDARD` / `LATIN`) |
|---|---|---|
| **Functionality** | Selecting reading view gated by real canonical content | Adapting key, capo fingering, chord system & instrument profile live |
| **Module** | `frontend/src/components/workspace/reading-format-selector-component.ts`, `core/workspace/stand-format-capabilities.ts` | `MusicalControls.tsx`, `InstrumentSelector.tsx`, `CapoControl.tsx`, `TranspositionControl.tsx`, `ChordNotationControl.tsx` |
| **Purpose** | Prevents showing broken/invented scores; guides musicians to complete missing content | Lets guitarists, pianists, bassists, winds & singers read the same canonical song in their comfortable key/notation |
| **Intended User** | Musicians, singers, worship leaders | Instrumentalists & singers |
| **User Benefit** | Honest readiness badges (`APROBADO`, `DISPONIBLE`, `FALTA CONTENIDO`) and 1-click completion wizard | Zero manual re-writing of chord sheets when singer changes key or guitarist puts a capo on fret 2 |
| **How to Use** | Click one of the 4 format cards above the stand; if locked, click **Completar contenido**; if logged in, click **Guardar Mis Preferencias** | Pick instrument (`InstrumentSelector`) -> adjust `Cejilla (Capo)` (string instruments only), `-1/+1 st` band transposition, and `Americano`/`Latino` chords |
| **Input** | Loaded `CanonicalMusicPayload` + active `InstrumentProfile` + `songStatus` | Instrument ID, capo fret `0–12`, semitones `-11..+11`, notation system |
| **Output** | Projected musical score/lead sheet/lyrics/tab + optional saved `UserViewPreferenceData` | Non-destructive `DerivedMusicalView` leaving canonical concert key intact |
| **Dependencies** | `StandFormatCapabilityResolver`, `ProjectionService`, `/users/me/preferences` | `InstrumentRegistry`, `TranspositionEngine`, `CapoCalculator`, `TablatureCalculator` |
| **Implementation Status** | **IMPLEMENTED WITH DEFECTS** (`GRAND_STAFF` omitted in `music-stand-controller.ts`; `STAFF_NOTATION` routes to `AlphaTab` `0.1` bug) | **IMPLEMENTED WITH DEFECTS** (ChordPro `chordAbove` untransposed, Tablature ignores transposition, `InstrumentSelector` Bass/Drum pills broken) |
| **Functional Validation** | `reading-format-selector.test.ts` (10/10), `stand-format-capabilities.test.ts` (10/10), `phase2c-liturgical-and-stand.test.ts` (11/11) pass; UI manual pending | `musical-workspace.test.ts` (17/17) passes; `browser-rendering-integration.test.ts:362` fails 1 test; defects caught by inspection |
| **UX Assessment** | Clear 4-card layout; needs in-app tooltips explaining `Americano vs Latino` and saving behavior | Clean consolidated toolbar after UX-Unification-1; missing Bass/Drums quick pills hurt discoverability |
| **Limitations** | Cannot print or export directly from this panel; solo users cannot toggle Zoom/Music Stand Mode | No percussion rendering handler in `resolveEffectiveViewRepresentation`; chord symbol parser misreads `sus2`/`Fadd9`/`Cmaj9` |
| **Risks** | Musicians switching to `Partitura` on winds/guitar see corrupted `0.1` frets in AlphaTab | Musicians transposing a ChordPro or Tablature song see conflicting/untransposed chords or frets in live rehearsal |
| **Recommendation** | **Fix** `RendererRegistry` default renderer priority for staff notation & add `GRAND_STAFF` to setlist pref mapping | **Fix** ChordPro `chordAbove` & Tablature transposition in `ProjectionService`, fix `InstrumentSelector` IDs & `Chord.parse` bugs |
| **Evidence** | `reading-format-selector-component.ts:140-280`, `stand-format-capabilities.ts`, `music-stand-controller.ts:109-114` | `alphatex-generator.ts:102-105`, `projection-service.ts:220-266`, `InstrumentSelector.tsx:45-54`, `chord.ts:149-272` |

### 6.2 Score Rendering, Visual Document Stand & Autoscroll

| Field | Notation Renderers (`OSMD`, `AlphaTab`, `LeadSheetDOM`) | Visual Document Stand (PDF / Image) & Autoscroll |
|---|---|---|
| **Functionality** | Client-side SVG/DOM score engraving | Displays preserved PDFs/images and scrolls reading area hands-free |
| **Module** | `core/rendering/adapters/osmd-adapter.ts`, `alphatab-adapter.ts`, `leadsheet-dom-adapter.ts` | `VisualDocumentStand.tsx`, `AutoscrollControl.tsx`, `core/autoscroll/use-autoscroll.ts` |
| **Purpose** | Converts `DerivedMusicalView` into readable notation, fretboard tab, or chord+lyric cards | Lets teams use scanned PDFs/charts when no digital score exists and read hands-free without foot pedals |
| **Intended User** | All performing musicians | Instrumentalists/vocalists reading long charts on tablets/laptops |
| **User Benefit** | Dynamic zoom, transposition & capo directly inside crisp browser notation | Isolated scroll viewport (`<main ref={viewportRef}>`) keeps controls stationary; 6 speed presets (`0.5x–3x`) |
| **How to Use** | Automatically chosen by `RendererRegistry` (and inspectable/overridable in `RendererStatus`) | Open a visual song; use `Autoscroll` (**Reanudar / Pausar / Detener / Inicio** + speed pills) floating at bottom of stand |
| **Input** | `DerivedMusicalView` -> generated MusicXML / AlphaTex / DOM cards | Authorized Blob URL (`/documents/:storageKey/file`) or local upload; viewport height & scroll target |
| **Output** | Interactive SVG or accessible card layout inside `<main>` | Smooth `requestAnimationFrame` scroll progress `0%–100%` |
| **Dependencies** | `opensheetmusicdisplay`, `@coderline/alphatab` | `BethesdaApiClient.fetchVisualDocumentBlob`, isolated `<main data-scrollable="true">` |
| **Implementation Status** | **IMPLEMENTED WITH DEFECTS** (`AlphaTex` `0.1` bug, dropped rests, stale `staveProfile`, swallowed OSMD async errors, invalid `<mode>natural_minor</mode>`) | **IMPLEMENTED WITH DEFECTS** (`VisualDocumentStand:313` fabricated SVG fallback; global `Space`/`Arrow` collision; CSS `zoom` stacking) |
| **Functional Validation** | Verified statically + unit tests pass; live SVG rendering in browser requires manual validation | `autoscroll.test.ts` (10/10) passes; keyboard collisions & SVG fallback proven statically |
| **UX Assessment** | `RendererStatus` exposes developer names (`AlphaTab`, `OSMD`, `LeadSheetDOM`) confusing non-tech users | Floating Autoscroll UI is musician-friendly, but `Space` jumping songs during setlists breaks live use |
| **Limitations** | No Bravura `fontDirectory` config in `AlphaTabAdapter`; no multi-measure rests; no `@media print` | No PDF download button for non-TIFF documents; `TIFF` cannot render inline in most browsers |
| **Risks** | Wrong visual output (fabricated `"GRANDE ES TU FIDELIDAD"` on broken image load, `0.1` frets, shifted rhythms) | Accidental song skip on stage when pressing `Space` to pause scrolling or `ArrowRight` to flip a PDF page |
| **Recommendation** | **Fix** `MusicXmlGenerator`, `AlphaTexGenerator`, `AlphaTabAdapter` `staveProfile`, `OsmdAdapter` async error propagation | **Fix** `VisualDocumentStand:313` error state, guard `AutoscrollControl` listeners by visibility/focus, deduplicate keyboard shortcuts |
| **Evidence** | `alphatex-generator.ts:102-105`, `osmd-adapter.ts:261-279`, `derived-musical-view.ts:162-197`, `musicxml-generator.ts:21,91,149` | `VisualDocumentStand.tsx:310-313,442,483`, `AutoscrollControl.tsx:31-52`, `SetlistNavigationToolbar.tsx:96-116` |

### 6.3 Song Catalog, Import, Format Completion & Conversion Center

| Field | Catalog, Uploader & Format Completion Wizard | Conversion Center & Audio Scope 1C Assisted Transcription |
|---|---|---|
| **Functionality** | Searching DB songs, importing `.musicxml`/`.cho`/`.pdf`/images, and completing missing formats | Converting files between formats, preserving audio (`.mp3`/`.wav`/etc.), running Python DSP analysis, and human review/approval |
| **Module** | `DatabaseSongsModal.tsx`, `SourceFileUploader.tsx`, `FormatCompletionWizardModal.tsx`, `musical-content-completion-service.ts` | `ConversionCenterWorkspace.tsx`, `conversion-worker.ts`, `audio-service.ts`, `audio-transcription-service.ts`, `workers/audio_worker/` |
| **Purpose** | Brings external files into the church library cleanly without inventing missing data | Extracts chords/BPM/key/monophonic melody from reference audio into a reviewable draft & exports deterministic formats |
| **Intended User** | Worship leaders, music coordinators, admins | Music coordinators, worship leaders, technical church operators |
| **User Benefit** | Upgrades chord-only songs with verified lyrics/notes/tab step-by-step with version provenance | Safely stores original master audio (`0o444` + SHA-256) and generates starter ChordPro/MusicXML drafts for human editing |
| **How to Use** | Click **Catálogo en Base de Datos** or **Importar Archivo**; if a format lacks content, click **Completar** to upload/paste missing source & submit for approval | Open **Centro de Conversión** -> pick source file (text score or audio) -> either run deterministic conversion/job download OR upload audio -> **Analizar Audio** -> edit ChordPro/lyrics -> **Aprobar** |
| **Input** | MusicXML, ChordPro, Lyrics text, ASCII Tab, MIDI (server), PDF/Images | Text/MIDI sources (Conversion) OR MP3/WAV/FLAC/OGG/M4A/WEBM up to 50 MiB (Audio Scope 1C) |
| **Output** | Immutable `song_versions` + `song_sources` + completion proposal in `omr_proposals` | Deterministic export files (`.musicxml`, `.cho`, `.mid`, `.tab`, `.txt`) or human-approved `song_versions` v(N+1) |
| **Dependencies** | PostgreSQL, `LocalFileSystemSourceStorageProvider`, `StandFormatCapabilityResolver` | PostgreSQL, `pg-boss`, Python `.venv` (`numpy`, `pydantic`, `imageio-ffmpeg`), `AudioStorageProvider` |
| **Implementation Status** | **IMPLEMENTED WITH DEFECTS** (`Buffer.byteLength` browser crash on `.tab`; 24-note silent cap in fret override; DB modal hardcodes `APPROVED` on save) | **PARTIALLY IMPLEMENTED / IMPLEMENTED WITH DEFECTS** (`.mxl`/`.aac` corrupted as text; fake green API health indicator; `0018`/`0019` missing from `_journal.json`; missing RBAC; no ASR lyrics; no polyphonic notes; `ENGRAVED_PDF` deferred) |
| **Functional Validation** | `real-ingestion-scenarios.test.ts` (15/15), `musical-completeness-remediation.test.ts` (4/4), Python `test_worker.py` (18/18 via `.venv`) | Verified via code + `format-capabilities.test.ts` (10/10); DB conversion integration suites not run in this audit |
| **UX Assessment** | `FormatCompletionWizardModal` lacks Esc/backdrop close; broken 37-byte sample PDF button | Heavily overloaded with developer jargon (`Scope 1C`, `pg-boss Activo`, `Gate 4`, `SMF 1`); advertises deleted audio playback |
| **Limitations** | Missing HTTP endpoints for `DELETE /songs/:id`, `PATCH /songs/:id`, and song archive/status changes | Audio worker uses NumPy DSP only (no AI/Whisper lyrics, fixed 4/8-bar synthetic sections); OMR engine is stubbed (`StandardOmrProvider`) |
| **Risks** | Unprivileged `VIEWER` can call `/ingestion/*` & `/conversion/jobs*` directly via API; `DocumentService` auto-approves `C/120/4/4` drafts | Fresh DB installs crash on async `ConversionWorker` jobs; global `python` lacks `imageio-ffmpeg` causing worker decode failures |
| **Recommendation** | **Fix** browser `TextEncoder` replacement for `Buffer`, paginate fret override >24 notes, enforce RBAC & proper `DRAFT` defaults | **Fix** `_journal.json` (`0018`/`0019`), add RBAC & auth to conversion/ingestion routes, strip fake health badge & playback text |
| **Evidence** | `ascii-tab-parser.ts:130`, `FormatCompletionWizardModal.tsx:979-1002`, `DatabaseSongsModal.tsx:151,207`, `SourceFileUploader.tsx:269` | `ConversionCenterWorkspace.tsx:346,909,1282,1466`, `workers/audio_worker/audio_analyzer.py`, `meta/_journal.json`, `conversion.routes.ts` |

### 6.4 Setlists, Worship Services, Live Sync, Offline/PWA & Auth/Admin

| Field | Setlists, Worship Services & Live Sync | Offline / PWA & Auth / User Management |
|---|---|---|
| **Functionality** | Ordering songs + liturgical moments (`SERVICE_MOMENT`), service planning, per-song key/BPM/instrument overrides, live director SSE sync | Offline caching (`IndexedDB` + `sw.js`), 7-day read-only offline identity, Argon2id/JWT login, admin user CRUD |
| **Module** | `SetlistsModal.tsx`, `SetlistDetailEditor.tsx`, `SetlistNavigationToolbar.tsx`, `ServiceMomentCard.tsx`, `use-setlist-execution.ts`, `setlist.routes.ts`, `worship-service.routes.ts`, `realtime.routes.ts` | `OfflineStatusBar.tsx`, `OfflineInventoryModal.tsx`, `DownloadActionButton.tsx`, `core/offline/`, `LoginModal.tsx`, `UserManagementModal.tsx`, `auth.routes.ts`, `user.routes.ts` |
| **Purpose** | Coordinates worship team repertoire transitions, tempo/key overrides, and rehearsal/service flow | Allows church use without internet and secures team roles (`SUPER_ADMIN` -> `VIEWER`) |
| **Intended User** | Worship leaders, pastors/directors, entire team | All church team members (offline); Admins/`SUPER_ADMIN` (user admin) |
| **User Benefit** | Prevents worship leaders losing track of service flow, key shifts (`Δ semitones`), or liturgical transitions | Zero dependency on cloud token storage (`tokenManager` volatile memory); offline cache indicator |
| **How to Use** | Login -> **Repertorios de Culto** -> create/select setlist -> add songs & service moments -> **Cargar en Atril** -> navigate via `SetlistNavigationToolbar` | Click **Guardar Offline** on song/setlist to download locally; click **Inventario Offline** to inspect/purge; Admins use **Gestión de Usuarios** in top-right badge |
| **Input** | Setlist title/date/items (`SONG`/`SERVICE_MOMENT`), target keys/BPM/transitions | User session, song/setlist payloads, invite email/role |
| **Output** | Ordered setlist execution toolbar with automatic delta transposition | IndexedDB cached items (`BethesdaOfflineDB`), JWT + HttpOnly refresh cookie, invite link |
| **Dependencies** | Postgres `setlists`/`setlist_items`/`worship_services`, single-instance RAM SSE manager | Browser `IndexedDB`, Service Worker `/sw.js`, Argon2id, `token-service.ts` |
| **Implementation Status** | **IMPLEMENTED — VALIDATION PENDING** (UI & API solid; Live SSE `core/realtime/` is **ORPHANED / DISCONNECTED** from `MusicalWorkspace`) | **IMPLEMENTED WITH DEFECTS** (Offline song/setlist opening broken; `sw.js` caches missing `/manifest.json`; `/accept-invite` UI missing; DB lockout & `tokenVersion` broken) |
| **Functional Validation** | `useSetlistExecution` (18/18), `SetlistsModal` (10/10), `setlist-domain-and-schemas` (30/30) pass; DB integration suites not executed | `auth-lifecycle-and-admin` (12/12), `token-manager` (4/4), `jwt-hs256` (7/7), `rbac-permission-guards` (6/6) pass |
| **UX Assessment** | Rich workflows; `SetlistNavigationToolbar` shortcut collisions with Autoscroll/VisualStand need resolution | Offline status promises "audios" and shows dead "Audit Result C" tab; broken invite URL traps newly invited musicians without SMTP or web route |
| **Limitations** | Live sync SSE has zero frontend wiring in `MusicalWorkspace` (in-memory only, single server instance) | Read-only offline by design (`ADR_004`), no offline edits/queue; no SMTP server configured |
| **Risks** | Two worship leaders cannot sync real-time measure/song changes because UI never mounts `useRealtimeFlow` | Account brute-force lockout does nothing for `ACTIVE` users; suspended users retain JWT access for 15 min on stateless routes |
| **Recommendation** | **Preserve** setlist CRUD/execution; wire or explicitly defer SSE UI (`RealtimeLiturgicalBadge`) cleanly | **Fix immediately** (`P0`): account lockout, `tokenVersion` enforcement, `/accept-invite` route, offline IndexedDB open fallbacks, `sw.js` manifest URL |
| **Evidence** | `SetlistsModal.tsx`, `use-setlist-execution.ts:135-152`, `realtime.routes.ts`, `core/realtime/` (0 app usages) | `App.tsx:43`, `OfflineInventoryModal.tsx:181-295`, `UserManagementModal.tsx:177,202`, `user-repository.ts:176-187`, `auth-service.ts:96` |

### 6.5 Internal QA / Development Tools & Unused / Stubbed Modules
- **`SongSelector.tsx` & `ScenarioPresets.tsx` (Status: `VERIFIED COMPLETE` for QA):** Safely moved in `ceb28aa` into `<details className="quick-scenarios-drawer">` below `<main>`. Uses `previewScenario` / `exitScenarioPreview` cleanly without mutating canonical data. Should optionally be gated behind `import.meta.env.DEV` or admin flag before public production launch.
- **`DiagnosticPanel.tsx` (`IMPLEMENTED WITH DEFECTS` — misplaced docstring):** Moved from `MusicalWorkspace` to bottom of `ConversionCenterWorkspace` (`2964`), though its docstrings still reference the old workspace mount.
- **`core/multitracks/` + `multitrack.routes.ts` (`PARTIALLY IMPLEMENTED` — Backend CRUD Only):** Backend CRUD works over uploaded `audio_assets`, while `frontend/src/core/multitracks/` has zero Web Audio mixer or React UI connected.

---

## 7. End-to-End User Workflow Analysis

### A. Song Ingestion
- **Verdict:** **Partially Implemented & Fragmented.**
- Structured MusicXML and ChordPro import cleanly client-side via `IngestionService` and server-side via `POST /songs/import` (`musicxml`/`chordpro`), preserving raw sources in `storage/sources`. Visual documents (`.pdf`/images) upload to `storage/documents`, **but** `POST /documents/import-song` and `convert-song` auto-mark songs `APPROVED` with fabricated `'C'` / `120` / `'4/4'` defaults, `StandardOmrProvider` is stubbed (`measures: []`), `AsciiTab` fails client-side (`Buffer` crash), `UniversalIngestionService` + `AudioIngestionAdapter` are disconnected from `PythonAudioWorkerBridge` (and double-write files), and `ConversionCenterWorkspace` corrupts `.mxl`/`.aac` as UTF-8 text.

### B. Song Preparation
- **Verdict:** **Implemented with Musical Correctness Defects.**
- `MusicalWorkspace` + `MusicalControls` + `StandFormatCapabilityResolver` clearly enforce what can be shown (`Partitura`, `Cifrado con Letra`, `Letra Sola`, `Tablatura`), hide `CapoControl` cleanly on non-string instruments, and guide missing formats through `FormatCompletionWizardModal`. However, transposition breaks on ChordPro inline chords and Tablature frets, and standard notation on non-piano instruments triggers the `AlphaTex` `0.1` rendering bug.

### C. Musician Workspace
- **Verdict:** **Coherent After Recent UX Unification, With Key Interaction Bugs.**
- Recent refactors (`537f546`, `12043f4`, `ceb28aa`) removed duplicate scenario cards and QA song pills from the top bar so `ReadingFormatSelector` and `.unified-adaptation-toolbar` are now clean and Atril-first. Remaining issues: broken Bass/Drum quick pills, empty-song message promising a nonexistent audio player, and developer jargon inside `ConversionCenterWorkspace` & `OfflineInventoryModal`.

### D. Song Reading & Atril Experience
- **Verdict:** **Partially Implemented / Stage-Risked.**
- Strengths: Dedicated isolated `<main ref={viewportRef}>` autoscroll viewport (`0.5x–3x`), `ServiceMomentCard` liturgical transitions, `SetlistNavigationToolbar` key/BPM deltas (`Δ semitones`). Critical stage blockers: Solo musicians lack **Modo Atril**, **Zoom**, and **Alto Contraste**; `Space` and `Arrow` keys collide across Autoscroll, PDF pages, and Setlists; `Offline` downloaded songs/setlists fail to load when network is actually down!

### E. Song Export & Reuse
- **Verdict:** **Partially Implemented / Low Discoverability.**
- Real file exports (`.musicxml`, `.cho`, `.mid`, `.tab`, `.txt`) exist **only** inside `ConversionCenterWorkspace`, suffer serializer bugs (ChordPro chord duplication, MusicXML chord piling / `<mode>natural_minor</mode>`), and **no export, download, print (`@media print` / `window.print`), `ENGRAVED_PDF`, or share-link workflow exists in the Atril Digital**. Visual PDF/PNG/JPG documents lack a download button.

### F. Failure & Recovery Workflows
- **Verdict:** **Strong in Backend Audio, Weak in UI Offline/Async Health.**
- File validation rejects XXE, >5 MiB text, >15 MiB documents, >50 MiB audio, wrong magic bytes, and zero-melody MIDI exports cleanly. Audio upload/delete split-brain has audit-log startup recovery. Conversely, `ConversionCenterWorkspace` displays hardcoded fake green API/queue health, `OsmdAdapter` swallows async load failures after returning `success: true`, and `VisualDocumentStand` silently substitutes `"GRANDE ES TU FIDELIDAD"` if image loading fails.

---

## 8. UX & Product Usability Audit (Non-Technical Musician Perspective)

| # | Problem | Impact on Musician | Evidence | Recommended Solution | Priority |
|---|---|---|---|---|---|
| 1 | Phantom `"reproductor superior"` & playback promises on empty/audio songs | Musician hunts across screen for Play button that was removed | `MusicalWorkspace.tsx:869-912`, `ConversionCenterWorkspace.tsx:1466`, `format-capabilities.ts:350,508` | Replace empty-state copy with accurate message ("Audio guardado como referencia para transcripción; completa letra/acordes abajo") and remove playback claims | **CRITICAL** |
| 2 | Offline downloaded songs & setlists cannot be opened offline | Stage panic: downloads appear in list/modal but fail to open without Wi-Fi | `App.tsx:43`, `OfflineInventoryModal.tsx:273`, `MusicalWorkspace.tsx:702`, `use-setlist-execution.ts:135` | Pass `onSelectSong`/`onSelectSetlist` to `OfflineStatusBar`; honor IndexedDB payload in `MusicalWorkspace` and `useSetlistExecution` | **CRITICAL** |
| 3 | `Space` / `Arrow` shortcut collisions & hidden global hijacking | Pressing `Space` to pause Autoscroll abruptly skips to the next song mid-worship | `AutoscrollControl.tsx:31-52`, `SetlistNavigationToolbar.tsx:96-116`, `VisualDocumentStand.tsx:287-305` | Scope `AutoscrollControl` listeners by `isVisible` + open-modal check; assign distinct shortcuts (e.g., `Shift+Arrow` or Page/Next separation) | **HIGH** |
| 4 | Solo musicians cannot access Modo Atril, Alto Contraste, or Zoom | Musicians practicing alone get cluttered screen and fixed text size | `MusicalWorkspace.tsx:569-600` (`SetlistNavigationToolbar` only) | Expose `Modo Atril`, `Alto Contraste`, and `Zoom` controls in a shared stand header bar even without an active setlist | **HIGH** |
| 5 | Broken `/accept-invite` flow & no client router | Invited team members receive a dead link and cannot set their password | `UserManagementModal.tsx:177,202`, `App.tsx` (no router) | Add `/accept-invite` token handling in `App.tsx` (query param detection + `AcceptInviteModal`) | **HIGH** |
| 6 | Misleading `"Descargar"` (`DownloadActionButton`) vs real Export + Zero Print | Musicians think `"Descargar"` saves a PDF/ChordPro file to their device, or look for Print button | `SongHeader.tsx`, `DownloadActionButton.tsx`, 0 `@media print` | Rename offline button to **"Guardar sin conexión"** and add **"Imprimir / Exportar"** menu in SongHeader | **MEDIUM** |
| 7 | Developer jargon across Conversion Center, Offline Modal & RendererStatus | Non-technical church musicians see `"pg-boss"`, `"Scope 1C"`, `"Resultado C de auditoría"`, `"OSMD"` | `ConversionCenterWorkspace.tsx:1282-1466`, `OfflineInventoryModal.tsx:181-201`, `RendererStatus.tsx` | Replace internal dev jargon with plain Spanish musical descriptions; gate developer details behind QA toggle | **MEDIUM** |
| 8 | Broken Bass & Drums quick-access pills | Bassists/drummers think their instruments are unsupported until opening `<select>` | `InstrumentSelector.tsx:45-54` vs `instrument-profile.ts:200,261` | Fix IDs `'electric_bass'` -> `'bass'` and `'drum_kit'` -> `'drums'` | **MEDIUM** |

---

## 9. Functional Coherence & Integration Audit

```mermaid
flowchart LR
  subgraph WorkingPaths["Connected End-to-End Paths"]
    S1["SongHeader / DB / Uploader"] --> WS["MusicalWorkspace State"]
    WS --> SFC["StandFormatCapabilityResolver"]
    WS --> Proj["ProjectionService"]
    Proj --> Render["OSMD / AlphaTab / LeadSheetDOM"]
    Conv["ConversionCenterWorkspace"] -->|"POST /conversion/jobs"| PgBoss["pg-boss + ConversionWorker"]
    Audio["Audio Preservation + /analyze"] --> Py["Python DSP Worker"]
  end

  subgraph BrokenOrOrphaned["Broken Links & Orphaned Islands"]
    Inv["UserManagementModal (/accept-invite link)"] -. "No router in App.tsx" .-> DeadRoute["404 / Ignored URL"]
    Off["OfflineInventoryModal / OfflineStatusBar"] -. "Missing onSelectSong/Setlist props" .-> WS
    DBOff["DatabaseSongsModal Offline"] -. "Discarded by handleOpenPersistedSongInStand" .-> Net503["503 Network Failure"]
    RT["RealtimeLiturgicalBadge + core/realtime"] -. "0 imports, calls :3000" .-> SSE["backend /realtime/sessions (Working API)"]
    MT["MultitrackEngine + multitrack.routes"] -. "0 UI components" .-> NoUI["Unreachable from UI"]
    OMR["StandardOmrProvider"] -. "Empty outside NODE_ENV=test" .-> NoOMR["No Real OMR"]
  end
```

---

## 10. Musical Domain & Data Integrity Audit
- **What Holds Strong (Verified Architecture):**
  - `CanonicalMusicPayload` immutability across all `useMusicalWorkspace` transitions (`previewScenario`, `setReadingFormat`, `capo`, `transposition`, `chordNotation`), validated by deep-freeze/reference tests.
  - Strict `MidiExportGatekeeper` blocking fabricated timing/MIDI output on ChordPro or unmeasured songs.
  - Immutable `song_versions` history + `song_sources` raw checksum provenance + `omr_audit_history` PostgreSQL trigger `trg_omr_audit_immutability` (`ON DELETE RESTRICT`, zero bypass).
  - Immutable `0o444` audio preservation with atomic write and pre-stream single-FD SHA-256 verification.
  - Honest polyphony handling in Python Audio Worker (`polyphony_index > 0.42` yields `0` invented notes) and explicit human-edit vs AI-estimate attribution (`HUMAN_VERIFIED` vs `DETECTED`/`ESTIMATED`/`AMBIGUOUS`).
- **Active Integrity Risks Requiring Remediation:**
  1. `VisualDocumentStand.tsx:313` substitutes `"GRANDE ES TU FIDELIDAD"` SVG when an uploaded image document fails to resolve (`CRITICAL` content misrepresentation).
  2. `AlphaTexGenerator` substitutes open `E4` (`0.1`) for every note in standard notation mode (`alphatex-generator.ts:102-105`).
  3. `ProjectionService` drops rests (`derived-musical-view.ts:162-197`), ignores transposition in tablature frets (`projection-service.ts:227-266`), leaves `ChordPro` inline `chordAbove` untransposed (`projection-service.ts:220`), and collapses mid-song key modulations (`projection-service.ts:119-121`).
  4. `DocumentService` auto-creates `APPROVED` songs with fabricated `'C'` / `120` / `'4/4'` (`document-service.ts`), bypassing human review gates; `UniversalIngestionService` similarly auto-approves ingested files; `CreateSongBodySchema` allows `WORSHIP_LEADER` to bypass `DRAFT -> APPROVED`.
  5. `Chord.parse` misparses `sus2`, corrupts `Fadd9`/`Faug`, drops `maj9`/`m9` extensions (`chord.ts`), and `ChordProImporter` assigns major key fifths to minor keys (`chordpro-importer.ts:539-569`).

---

## 11. Technical Architecture & Engineering Audit
- **Backend Build & Packaging:** `backend/tsconfig.json` (`"noEmit": true`, `"allowImportingTsExtensions": true`) means `npm run build` outputs nothing and `npm start` fails; 15 backend prod modules reach across into `../../../frontend/src/core/...`. Extracting a shared workspace package (`@bethesda/music-core`) and fixing TS build emission is essential for clean deployment.
- **Database Governance & Migrations:** `backend/src/db/migrations/meta/_journal.json` omits `0018_cas_deletion_state_machine.sql` and `0019_cas_deletion_retained_state.sql`, breaking fresh deployments. `provision_app_runtime_role.sql` misses 11 active tables and `pgboss`, and `assertNonSuperuserRuntimeRole()` (`backend/src/db/index.ts:79`) is never called. No multi-tenancy or PostgreSQL RLS exists despite `docs/05`/`docs/06` requirements.
- **Security Hardening Gaps:** Broken DB lockout (`user-repository.ts:176-187`), un-enforced `tokenVersion` (`token-service.ts`), missing RBAC on `/api/v1/ingestion/*` & `/api/v1/conversion/jobs*`, unauthenticated 25 MiB `/conversion/validate` & `/transpile`, unbounded in-memory `DualRateLimiter` omitted from refresh/reset/accept-invite, non-transactional refresh rotation + mutating `GET /auth/refresh`, dummy Argon2 timing oracle, cross-song version IDOR, Swagger exposed in prod.
- **Observability & Repo Hygiene:** **223 binary files** (`~142` audio, `48` sources, `32` docs, `1` output) are tracked inside Git under `backend/storage/`; `OutputRetentionService` and `S3CompatibleStorageProvider` are implemented & tested yet completely unwired; no OpenTelemetry / `/metrics` telemetry; no automated DB backup/retention cron.
- **Python Audio Worker Portability & Licensing:** Works cleanly (`18/18` tests pass) under `workers/audio_worker/.venv`, fails without `imageio_ffmpeg` on global Python. `imageio-ffmpeg` bundles a static **GPLv3 FFmpeg binary** (needs legal/license check before distributing packaged builds, or rely on system LGPL FFmpeg).

---

## 12. Functional Completeness Matrix (Summary)
*(Full itemized 60+ row matrix maintained in **`BETHESDA_WORSHIP_STUDIO_FUNCTIONAL_INVENTORY.md`**.)*

| Area | Verified Complete | Implemented (Val. Pending) | Implemented w/ Defects | Partially Implemented | UI Only | Not Implemented |
|---|---|---|---|---|---|---|
| Core Theory, Canonical Model & Projection | 4 | — | 5 | — | — | — |
| Musical Workspace, Formats & Rendering | 4 | 1 | 9 | 2 | — | 3 |
| Ingestion, Conversion & Completion | 1 | — | 6 | 3 | 1 | 1 |
| Audio Scope 1C & Python DSP Worker | 2 | 1 | 1 | 2 | — | 1 |
| Setlists, Worship Services & Live Sync | 2 | 2 | 1 | 1 | — | 1 |
| Offline / PWA, Auth, Admin & Security | 2 | — | 6 | 1 | — | 3 |
| Infrastructure, Export, Print & Sharing | — | — | 2 | 2 | — | 5 |

---

## 13. Critical Findings (Ranked P0 / P1 / P2)
- **P0 — Security & DB Deployment Blockers:**
  1. Missing `0018` & `0019` in `_journal.json` crashes async conversion jobs on fresh DBs.
  2. Broken DB login lockout (`accountStatus` never set to `'LOCKED'`).
  3. Missing RBAC on `/ingestion/*` & `/conversion/jobs*` (`VIEWER` can ingest & commit `APPROVED` songs).
  4. Unauthenticated 25 MiB CPU/memory DoS on `/conversion/validate` & `/conversion/transpile`.
- **P0 — Musical Integrity & Core Musician Blockers:**
  5. `AlphaTexGenerator` renders all standard-notation notes as `0.1` (`alphatex-generator.ts:102-105`).
  6. Transposition & Capo broken in ChordPro Lead Sheet (`chordAbove`) and Tablature (`projection-service.ts:220-266`).
  7. Client ASCII Tab crash (`Buffer.byteLength` in browser, `ascii-tab-parser.ts:130`).
  8. `VisualDocumentStand.tsx:313` displays hardcoded `"GRANDE ES TU FIDELIDAD"` on image load failure.
  9. Broken Offline Song & Setlist loading (`MusicalWorkspace.tsx:702`, `use-setlist-execution.ts:135`, `App.tsx:43`).
- **P1 — High UX, Auth & Engineering Defects:**
  10. Phantom `"reproductor superior"` message in empty-song UI (`MusicalWorkspace.tsx:869-912`).
  11. `Space` & `Arrow` keyboard collisions across `AutoscrollControl`, `SetlistNavigationToolbar`, and `VisualDocumentStand`.
  12. Solo musicians lack Modo Atril, Alto Contraste, and Zoom (`MusicalWorkspace.tsx:569-600`).
  13. Broken `/accept-invite` invite workflow (no client route in `App.tsx`) + `tokenVersion` never checked in JWT + broken backend `npm run build` (`noEmit: true`).
  14. Music theory (`sus2`, `Fadd9`, `Cmaj9`, `Cb4`/`B#3`), minor key (`ChordProImporter`), dropped rests, and `MusicXML`/`ChordPro` serializer bugs.
- **P2 — Medium Maintainability & Feature Gaps:**
  15. No `Print` (`@media print` / `window.print`), no `ENGRAVED_PDF`, no `SongHeader` direct export, no sharing links, broken Bass/Drum quick pills, `GRAND_STAFF` omitted from setlist preference map, fake green health pill in `ConversionCenterWorkspace`, 223 binary files committed in `backend/storage/`, outdated `docs/` & `USER_GUIDE_ES.md`.

---

## 14. Gap Analysis
- **Previously Approved Objectives Currently Deficient:**
  - True multi-instrument live reading across all 4 formats without distortion (`0.1` AlphaTex, Tablature/ChordPro transposition, dropped rests, `sus2`/`Fadd9` chords).
  - Working Offline-First church stand (`ADR_004`) — caching works, *re-opening offline does not*.
  - Complete role-aware team onboarding (`/accept-invite`, enforced DB lockout, `tokenVersion` revocation, RBAC on ingestion/conversion).
  - Clean separation of zero-playback policy from UI messaging (`reproductor superior` lingering copy).
- **New Architectural Recommendations:**
  - Extract shared isomorphic package `@bethesda/music-core` + enable real compiled `backend/dist/` build.
  - Consolidate Print (`@media print`) + direct Song Catalog Export from Atril Digital before heavy headless Chromium `ENGRAVED_PDF`.
- **Optional Future Enhancements (Post-Stabilization):**
  - Wire existing `RealtimeLiturgicalBadge` / `core/realtime/` (fixing `:3000` port -> `/api` relative + Redis Pub/Sub if scaled beyond 1 server).
  - Real OMR engine integration (Audiveris/OEMR), ML polyphonic AMT / Whisper lyrics ASR, and `MultitrackEngine` Web Audio UI.

---

## 15. Product Maturity Assessment (Qualitative Evidence-Based Ratings)

| Dimension | Rating | Evidence |
|---|---|---|
| **Domain Data Integrity Architecture** | **Strong (with localized leaks)** | Immutable `CanonicalMusicPayload`, `song_versions`, `0o444` audio SHA-256, `trg_omr_audit_immutability`, vs. localized leaks in `VisualDocumentStand:313`, `DocumentService`, and `ProjectionService`. |
| **Backend Core & Security Posture** | **Moderate / Needs Hardening** | Strong Argon2id + HS256 JWT + token-family replay detection + RBAC engine, undercut by 4 critical/high route & lockout gaps + broken `noEmit` build. |
| **Frontend Musical Correctness** | **Fragile / Needs Targeted Fixes** | Rich theory & projection suite (`632/633` tests pass), yet critical gaps in `AlphaTex`, ChordPro transposition, Tablature transposition, dropped rests, and `Buffer` crash exist in untested paths. |
| **UX & Non-Technical Clarity** | **Developing / Mixed** | Top workspace recently cleaned up nicely (`ReadingFormatSelector` + `.unified-adaptation-toolbar`), while Conversion Center, Offline modal, shortcuts, and phantom audio text confuse non-tech musicians. |
| **Rehearsal Readiness** | **Conditional (Desktop Online Guitar/LeadSheet Only)** | Guitar Capo / Vocal Lead Sheet / Piano Grand Staff on desktop work after careful setup; Winds/Tab transpose/Offline/Conversion Center carry high friction. |
| **Live Worship Service Performance Readiness** | **Not Yet Ready** | Blocked by broken offline opening, `Space`/`Arrow` live-service skip collisions, missing Solo Modo Atril/Zoom, and standard notation `0.1` bug. |

---

## 16. Risks
- **Live Stage Failure Risk (HIGH):** Offline cache creates false confidence before a service when Wi-Fi drops and downloaded songs/setlists fail to load; pressing `Space` skips songs.
- **Security Compromise / Privilege Escalation Risk (HIGH):** Disabled lockout + missing RBAC on `/ingestion` & `/conversion/jobs` + unauthenticated 25 MiB `/conversion/transpile`.
- **Deployment & Ops Risk (HIGH):** Missing `0018`/`0019` migrations in `_journal.json`, `noEmit: true` backend build, 223 binary files bloating Git, GPLv3 `imageio-ffmpeg` bundle licensing review needed.
- **Documentation Drift Risk (MEDIUM):** Legacy docs (`docs/user-guide/BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md`, `MASTER_ROADMAP.md`) describe non-existent audio playback UI and wrong stack details.

---

## 17. Phased Implementation Roadmap (Pending Product Owner Approval)

| Phase | Name & Objective | Functional Scope & Deficiencies Addressed | Dependencies | Musician Benefit | Tech Risk | Priority | Acceptance Criteria |
|---|---|---|---|---|---|---|---|
| **Phase R1** | **Security, DB Migrations & Build Stabilization** | Fix `_journal.json` (`0018`/`0019`), fix `recordFailedLogin` lockout, enforce `tokenVersion`, add RBAC on `/ingestion` & `/conversion/jobs`, auth/throttle `/conversion/validate` & `/transpile`, fix `Cross-Song IDOR`, fix `DocumentService` auto-approve defaults, fix `backend/tsconfig.json` `build` & extract `@bethesda/music-core` | Drizzle migrator, AuthGuard | Protects church library & enables clean server deployment | Medium | **P0 (Immediate)** | Fresh DB runs all migrations `0000–0020`, lockout & RBAC integration tests pass, `backend` builds JS cleanly |
| **Phase R2** | **Musical Projection & Rendering Accuracy** | Fix `AlphaTex` `0.1` / `RendererRegistry` priority for staff notation, transpose `chordAbove` in `ProjectionService` & fix ChordPro tick mismatch, pass transposed `writtenPitch` to `TablatureCalculator`, fix `Buffer` browser crash in `ascii-tab-parser`, preserve rests, fix `Chord.parse` (`sus2`, `Fadd9`, `maj9`), fix minor keys in `ChordProImporter`, fix `VisualDocumentStand:313` fallback & serializers | `core/music-theory`, `core/projection`, `core/rendering` | Guitarists, bassists, winds & singers see mathematically accurate notes, frets & chords in every key | Medium | **P0 (Immediate)** | Fix `browser-rendering-integration.test.ts`, add regression tests for transpose/ChordPro/Tab/`Buffer`/`sus2`, 100% pass |
| **Phase R3** | **Offline Rescue & Live Atril UX Polish** | Wire IndexedDB fallbacks in `MusicalWorkspace`, `useSetlistExecution`, `App.tsx` -> `OfflineInventoryModal`; fix `sw.js` `/manifest.webmanifest`; expose Solo `Modo Atril`/`Zoom`/`Alto Contraste`; fix `Space`/`Arrow` shortcut collisions; fix `InstrumentSelector` Bass/Drums pills; add `GRAND_STAFF` to `music-stand-controller`; remove phantom `"reproductor superior"` copy & fake health badges | `OfflineManager`, `SetlistNavigationToolbar`, `AutoscrollControl` | Reliable offline rehearsals/services with zero accidental song skips and full solo stand controls | Low–Med | **P1 (High)** | Tested offline airplane-mode load of songs & setlists, keyboard shortcut isolation verified manually |
| **Phase R4** | **Onboarding, Print/Export & Admin Completion** | Add `/accept-invite` UI flow + SMTP adapter (or clean manual invite UX), add `@media print` / `window.print` + direct Song Export menu in `SongHeader` + visual PDF/image download button, expose `PATCH/DELETE /songs/:id` & song status endpoints, rename `DownloadActionButton` to `"Guardar sin conexión"`, clean developer jargon from UI, remove dead/orphaned files | `App.tsx`, `SongHeader.tsx`, `UserManagementModal.tsx` | Invited musicians self-onboard seamlessly; teams can print charts & export directly from the music stand | Low | **P1/P2** | Print preview renders clean scores/lead sheets; invited user completes onboarding via browser link |
| **Phase R5** | **Server Hygiene & Advanced Roadmap (Optional)** | Remove tracked `backend/storage/` binaries (clean history only with explicit PO sign-off), wire `OutputRetentionService` & `S3CompatibleStorageProvider`, complete `ENGRAVED_PDF` (headless Chromium/VexFlow), wire or formally defer `Realtime` SSE (`core/realtime`) & `Multitracks` UI, integrate real OMR / ML AMT if desired | Infra / Workers | Scalable multi-church deployment, PDF printing packets, and live leader-team sync | High | **P2 / Future** | Product Owner ADR & staging sign-off |

---

## 18. Audit Limitations
- **Database Integration Suites Not Executed:** 41 Postgres-dependent backend test files were intentionally skipped to comply with strict read-only preservation of local/production databases.
- **No Browser Automation or Live UI Click-Through:** Dynamic browser rendering of OSMD/AlphaTab SVG canvases, print CSS, and live IndexedDB Airplane Mode flows remain for manual validation (checklist in Section 14 of `BETHESDA_WORSHIP_STUDIO_FUNCTIONAL_INVENTORY.md` / below).
- **Static Checks Executed on `ceb28aa`:**
  - `npm --prefix frontend run typecheck` (`tsc --noEmit`): `0` errors.
  - `npm --prefix backend run typecheck` (`tsc --noEmit`): `0` errors.
  - `frontend` core tests (`npx tsx --test "src/core/**/__tests__/**/*.test.ts"`): `632/633` passed (`1` fail: `browser-rendering-integration.test.ts:362:3`).
  - `backend` stateless security/domain tests (6 suites): `58/58` passed.
  - `workers/audio_worker/.venv/Scripts/python.exe -m pytest`: `18/18` passed (`30.52s`); global `python` fails `7/18` (`No module named 'imageio_ffmpeg'`).

---

## 19. Final Verdict
**`PASS — Comprehensive audit completed with sufficient repository evidence.`**  
All modules across frontend, backend, database migrations, Python audio worker, and documentation have been audited with file-and-line precision, zero unauthorized code changes, and clear prioritized remediation phases ready for Product Owner review.
