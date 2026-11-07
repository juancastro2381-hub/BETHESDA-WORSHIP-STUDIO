# WS_PHASE_2A_PREFLIGHT_AND_ARCHITECTURE
## BETHESDA WORSHIP STUDIO — PHASE 2A: MUSICAL CONVERSION CENTER FOUNDATION

- **Project:** Bethesda Worship Studio
- **Document ID:** `WS-PHASE-2A-PREFLIGHT-AND-ARCHITECTURE`
- **Execution Date:** November 2026
- **Status:** Approved Preflight Audit & Architectural Baseline
- **Repository Branch:** `feature/phase-1a-core-foundation`
- **Base Commit:** `0db7978a72358630d7781a3f54beb0f187deb4e1`
- **Authorization:** Product Owner Authorization for Phase 2A Only
- **Git Directives:** Strictly uncommitted local changes; Zero commits / pushes / merges / rebases.

---

## 1. Preflight Verification & Repository State

Prior to introducing any new application code, an exhaustive inspection of the working tree, dependencies, build processes, and test suites was conducted.

### 1.1. Git Environment & Commit Verification
- **Active Working Branch:** `feature/phase-1a-core-foundation`
- **Remote Synchronization:** Synchronized with `origin/feature/phase-1a-core-foundation`
- **Current HEAD Commit:** `0db7978a72358630d7781a3f54beb0f187deb4e1`
- **Commit Message:** `TECHNICAL AUDIT & ARCHITECTURAL SPECIFICATION: MUSICAL FILE CONVERSION CENTER`
- **Working Tree Cleanliness:** Verified completely clean prior to preflight fixes.

### 1.2. Baseline Automated Test Verification
Both backend and frontend test suites were executed in full:
1. **Backend Test Suite:**
   - Command: `npm --prefix backend run test`
   - Test files: 32 suites covering Auth, Argon2id, Session Tokens, Ingestion (1B, 1B-R, 1B-R2, 1B-R3), OMR, Audio, Setlists, Multitracks, Preferences.
   - Results: **510 tests executed, 510 passed, 0 failed, 0 cancelled, 0 skipped**.
2. **Frontend Test Suite:**
   - Command: `npm --prefix frontend run test`
   - Test files: 25 suites covering Music Theory, Canonical Model, Projections, Ingestion, Renderers, Navigation, View Preferences, Setlists.
   - Results: **481 tests executed, 481 passed, 0 failed, 0 cancelled, 0 skipped**.
3. **Total Verified Baseline:** **991 automated tests passing.**

### 1.3. Baseline Typecheck & Discrepancy Correction
Executing `tsc --noEmit` uncovered 5 TypeScript compiler errors in `frontend/src/core/ingestion/__tests__/universal-ingestion-phase1b-r3-2.test.ts`:
- Lines 716 and 803: `renderer.render(view, { width: 800, height: 600 })` passed an unsupported second argument. Corrected to `renderer.render(view)`.
- Lines 837, 936, and 950: `new Pitch('C', 4)` passed a raw string instead of a `NoteName` instance. Corrected to `new Pitch(NoteName.C, 4)`.
- **Post-Fix Verification:** Both `npm --prefix backend run typecheck` and `npm --prefix frontend run typecheck` pass with **zero errors**.
- **Production Builds:** Both `npm --prefix frontend run build` (Vite) and `npm --prefix backend run build` (tsc) compile cleanly.

---

## 2. Background Job Architecture Evaluation (Section 4.1)

In accordance with Executive Decision 4.1, PostgreSQL-native job queueing was evaluated:

### 2.1. Existing Database & Connection Pool Lifecycle
- PostgreSQL Version: **16.x**
- Connection Pool: `pg.Pool` in `backend/src/db/index.ts` (max: 20 connections, idleTimeout: 30000ms, connectionTimeout: 5000ms).
- Node.js Runtime: **v24.12.0**
- Test Database Semantic Isolation: Strict invariant in `backend/src/db/index.ts` enforces `TEST_DATABASE_URL` is distinct from `DATABASE_URL` to prevent test-to-production pollution.

### 2.2. pg-boss Compatibility & Invariant Assessment
- `pg-boss` (v12.38.1) was evaluated and dry-run verified. It requires `pg: ^8.23.1`, which was integrated into `backend/package.json`.
- **Schema Management:** `pg-boss` uses its own internal schema (`pgboss.*`), ensuring complete isolation from application tables (`songs`, `song_versions`, `song_sources`, `background_jobs`).
- **Transactional & State Invariant:**
  Application-level job tracking, user ownership, and audit trails remain in `background_jobs`. The `ConversionJobManager` integrates PostgreSQL transaction safety so that job submission, source file SHA-256 recording in `song_sources`, and queue registration occur atomically.
- **Graceful Shutdown & Process Recovery:**
  Workers listening to conversion tasks register `SIGTERM` and `SIGINT` handlers. Any task interrupted by server restart transitions safely from `PROCESSING` to `QUEUED` or `FAILED` with retry semantics, preserving the original file in `song_sources`.

---

## 3. Phase 2A Architecture & Component Decomposition

Phase 2A implements the **Structured Conversion Foundation** of the Musical Conversion Center:

```
                                  [ Input Musical File ]
                                            |
                                            v
                         +-------------------------------------+
                         |      Universal Ingestion Layer      |
                         |  (Magic Bytes, SHA-256, Validation) |
                         +-------------------------------------+
                                            |
                                            v
                         +-------------------------------------+
                         |        CanonicalMusicPayload        |
                         |  (Universal Musical Representation) |
                         +-------------------------------------+
                                            |
         +--------------------+-------------+------------+--------------------+
         |                    |                          |                    |
         v                    v                          v                    v
+------------------+ +------------------+      +------------------+ +------------------+
| MusicXML         | | MIDI             |      | ChordPro         | | Lyrics Only      |
| Serializer       | | Serializer       |      | Serializer       | | Serializer       |
| (.musicxml)      | | (.mid Type 1)    |      | (.chordpro)      | | (.txt)           |
+------------------+ +------------------+      +------------------+ +------------------+
```

### 3.1. Foundational Outbound Exporters
1. **`CanonicalToMusicXmlSerializer` (`frontend/src/core/conversion/exporters/musicxml-serializer.ts`):**
   - Serializes `CanonicalMusicPayload` into well-formed MusicXML 4.0 (`score-partwise`).
   - Translates 480 TPQN ticks into measure `<duration>` units relative to `<divisions>`.
   - Preserves notes, pitches (`step`, `alter`, `octave`), rests, voices, ties, chord annotations (`<harmony>`), lyrics (`<lyric>`), measure boundaries, key signatures, and time signatures.
   - Enforces zero fabrication: does not invent missing keys, tempos, or meters.
2. **`CanonicalToMidiSerializer` (`frontend/src/core/conversion/exporters/midi-serializer.ts`):**
   - Generates binary Standard MIDI Files (SMF Format 1, 480 PPQ).
   - Track 0: Conductor track (Title, Set Tempo meta event if known, Time Signature meta event if known, End of Track).
   - Track 1..N: Instrument voice tracks with delta-time NoteOn/NoteOff events.
   - Validates polyphonic timing and rejects unmetered or zero-note payloads with clear diagnostics.
3. **`CanonicalToChordProSerializer` (`frontend/src/core/conversion/exporters/chordpro-serializer.ts`):**
   - Formats lyrics with bracketed chord placement: `[G]Sub[D]lime [Em]gra[C]cia...`
   - Preserves directives: `{title}`, `{artist}`, `{key}`, `{tempo}`, `{time}` only when known.
   - Emits section delimiters: `{start_of_verse}`, `{end_of_verse}`, `{start_of_chorus}`, `{end_of_chorus}`.
4. **`CanonicalToLyricsSerializer` (`frontend/src/core/conversion/exporters/lyrics-serializer.ts`):**
   - Strips all chord symbols, staves, and notation metadata to produce clean lyrical text for church projections.
   - Preserves section markers: `[Verso 1]`, `[Coro]`, `[Puente]`.
5. **Engraved PDF Evaluation:**
   - In accordance with Section 6.4, server-side engraved PDF requires Verovio or headless OSMD. Because no server-side engraving binary is present in this phase, it is formally documented as deferred in `WS_PHASE_2A_KNOWN_LIMITATIONS.md`.

### 3.2. Conversion Center Service & API Gateway
- **Service Layer (`backend/src/application/conversion-job-service.ts`):**
  - Handles job lifecycle: creation, deduplication by SHA-256 and target format, execution, retry, cancellation, result retrieval.
  - Preserves source files immutably in `song_sources`.
- **HTTP REST Routes (`backend/src/interfaces/http/routes/conversion.routes.ts`):**
  - `POST /api/v1/conversion/jobs`: Create and enqueue a conversion job.
  - `GET /api/v1/conversion/jobs`: List conversion jobs for authenticated user.
  - `GET /api/v1/conversion/jobs/:jobId`: Query specific job status.
  - `POST /api/v1/conversion/jobs/:jobId/retry`: Safe retry of failed job.
  - `POST /api/v1/conversion/jobs/:jobId/cancel`: Cancellation of pending job.
  - `GET /api/v1/conversion/jobs/:jobId/download`: Download converted artifact.
  - `POST /api/v1/conversion/jobs/:jobId/commit`: Commit converted canonical result into song catalog.
  - `POST /api/v1/conversion/transpile`: Synchronous conversion for immediate in-browser processing.
  - `POST /api/v1/conversion/validate`: Capability analysis and format compatibility inspection.

### 3.3. User Interface: Centro de Conversión Musical
- **Location:** Dedicated navigation view in Bethesda Worship Studio (`frontend/src/components/conversion/ConversionCenterWorkspace.tsx`).
- **Main Workflow Sections:**
  1. *Workspace & Dropzone:* File drag-and-drop, format detection, size validation, remove file.
  2. *Source Format Classification:* Transparent capability categorization; deferred formats marked as "Disponible en una fase de procesamiento posterior".
  3. *Target Format Selector:* Dynamic matrix showing available vs. blocked formats with zero-fabrication badges.
  4. *Format-Specific Options:* Transposition, quantization, chord formatting options with real functional effects.
  5. *Processing Queue:* Real-time tracking of jobs with status (`QUEUED`, `PROCESSING`, `REVIEW_REQUIRED`, `COMPLETED`, `FAILED`, `CANCELLED`).
  6. *Human Review Stage:* Inspection of converted metadata, key, meter, tempo, chords, notes, and diagnostics.
  7. *Export & Digital Music Stand Integration:* Download converted file, save to catalog, and open directly in Digital Music Stand in the chosen reading format (Partitura, Cifrado con Letra, Letra Sola, Tablatura).

---

## 4. Verification Checklist Before Implementation

- [x] Working branch is `feature/phase-1a-core-foundation`.
- [x] Zero Git commits, pushes, merges, or rebases executed.
- [x] Baseline test suites pass (510 backend + 481 frontend = 991 tests).
- [x] All 5 TypeScript compiler errors in existing test files resolved; `typecheck` is 100% green.
- [x] `pg-boss` dependencies audited and verified.
- [x] Outbound converter specifications mathematically defined without data invention.

