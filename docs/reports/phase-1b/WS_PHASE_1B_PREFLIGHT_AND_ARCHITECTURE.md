# WORSHIP STUDIO — PHASE 1B TECHNICAL REPORT
## MANDATORY PRE-FLIGHT AUDIT & UNIVERSAL INGESTION ARCHITECTURE SPECIFICATION

**Project:** Bethesda Worship Studio  
**Repository:** https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Previous Phase:** Phase 1A-R3.2 — Final Technical Defect Closure  
**Authorized Phase:** Phase 1B — Universal Music Ingestion, Canonical Music Pipeline & Multi-Format Conversion  
**Execution Mode:** Controlled Engineering Implementation  
**Deliverable ID:** WS-1B-DOC-01  
**Date:** 2026-11-05  
**Status:** Completed & Pre-Flight Verified  

---

## 1. PRE-FLIGHT ENVIRONMENT & GIT AUDIT

Prior to modifying any application file for Phase 1B, an exhaustive inspection of the working environment and repository state was executed:

| Property | Inspected State | Verification Command & Result |
| :--- | :--- | :--- |
| **Git Working Branch** | `feature/phase-1a-core-foundation` | `git status` -> `On branch feature/phase-1a-core-foundation` |
| **Upstream Tracking** | In sync with origin | `Your branch is up to date with 'origin/feature/phase-1a-core-foundation'` |
| **Baseline Commit** | `a2dd18f` | `a2dd18f PHASE 1A-R3.2 INFORME TÉCNICO DE CIERRE DE DEFECTOS Y READINESS GATE PARA CERTIFICACIÓN INDEPENDIENTE` |
| **Working Tree State** | Clean at start | `nothing to commit, working tree clean` |
| **Git Write Governance** | **ZERO COMMITS / ZERO PUSHES** | All Phase 1B modifications remain uncommitted and local |
| **Node.js Environment** | v24.12.0 (x64 Windows) | Verified native test runner and Fastify 5.2.1 runtime |
| **PostgreSQL Database** | PostgreSQL 18.0 (localhost:5432) | Live connection verified (`bethesda_worship_dev`) |
| **TypeScript Compiler** | TypeScript 5.7.3 (`tsc --noEmit`) | Backend (0 errors), Frontend (0 errors) |
| **Existing Test Baseline** | **578+ passing tests** | Frontend (426 tests pass), Backend (152+ tests pass across Phase 1A, 2A, 2B, 2C, 3A, 3C) |

---

## 2. CAPABILITY STATUS AUDIT (HONEST AS-IS CLASSIFICATION)

Per Section 2 of the Master Directive, we strictly distinguish between:
1. **Working Production Implementation:** Fully functioning code, tested with real inputs.
2. **Partially Implemented Capability:** Working subcomponents or text-based features, but missing full vertical integration.
3. **Adapter / Interface without Real Provider:** Contract exists, but underlying recognition engine is a stub or unconfigured.
4. **Test Mock:** Fixture or synthetic generator used solely in unit tests.
5. **Documented Future Capability:** Architectural concept not yet written in code.

### 2.1 Audit Classification Matrix

| Source Category | Code Location | As-Is Classification | Description & Technical Boundary |
| :--- | :--- | :--- | :--- |
| **MusicXML 4.0** | `frontend/src/core/ingestion/musicxml/musicxml-importer.ts`, `frontend/src/core/ingestion/xml/xml-parser.ts` | **Working Production Implementation** | Custom pure TypeScript XML parser protected against XXE and entity expansion. Parses `score-partwise` and `score-timewise`, tracks, parts, notes, accidentals, durations, ties, lyrics. Converts to `CanonicalMusicPayload`. Tested with round-trip fidelity. |
| **ChordPro** | `frontend/src/core/ingestion/chordpro/chordpro-importer.ts` | **Working Production Implementation** | Complete directives parser (`{title}`, `{artist}`, `{key}`, `{tempo}`, `{time}`, `{soc}/{eoc}`), chord brackets `[G]`, syllable alignment, transposition logic. Converts to `CanonicalMusicPayload` with 0 fake melody notes. |
| **MIDI (SMF)** | *None* | **Missing (Phase 1B Priority)** | No parser or adapter currently exists. SMF format 0 and 1 parser must be implemented in pure TypeScript to extract tracks, note on/off, velocities, tempos, and time signatures into `CanonicalMusicPayload`. |
| **Written Musical Notes** | *Partial in frontend UI and OMR measure PATCH* | **Partially Implemented (Phase 1B Priority)** | `updateMeasure` allows measure editing, but no dedicated universal API endpoint exists for musicians to submit structured sequences of notes, octaves, durations, accidentals, chords, and lyrics. |
| **PDF Scores** | `backend/src/application/document-service.ts`, `backend/src/domain/documents/pdf-text-extractor.ts` | **Partially Implemented (Ingestion & Text Only)** | Validates `%PDF-` signature, SHA-256 calculation, secure storage, and extracts chords/lyrics from vector/text-layer PDFs. Optical Music Recognition (OMR) on scanned PDFs is NOT operational (stub only). |
| **Image Scores (PNG, JPEG, TIFF)** | `backend/src/domain/documents/`, `backend/src/domain/omr/` | **Ingestion & Validation Only (OMR Stub)** | Validates magic bytes, file size (15MB), computes SHA-256, stores securely. `StandardOmrProvider` returns explicit `OMR_ENGINE_NOT_CONFIGURED` with 0 fake notes when real engine is absent. |
| **Audio Files (MP3, WAV, etc.)** | `backend/src/application/audio-service.ts`, `backend/src/repositories/multitrack-repository.ts` | **Ingestion & Storage Only** | Uploads, validates magic bytes, computes SHA-256, streams with range requests, and manages stems in multitrack sessions. Audio-to-MIDI, pitch extraction, and automatic chord recognition are NOT implemented. |
| **Video URLs** | *None* | **Missing (Phase 1B Priority)** | No URL validation, whitelist filtering, or SSRF protection exists. Must be implemented in Phase 1B with strict security guards. |

---

## 3. UNIVERSAL INGESTION ARCHITECTURE DESIGN (WORKSTREAM A)

### 3.1 Architectural Principles
1. **Centralized Ingestion Orchestration:** A single service entry point (`UniversalIngestionService`) orchestrates source identification, validation, storage, adapter execution, canonical serialization, and audit trail creation.
2. **Provider-Based Adapter Pattern:** Every source format implements a standardized interface (`IIngestionAdapter`) registering its capabilities and format support.
3. **Immutability & Zero Fabrication:** Unknown or unresolvable musical information is NEVER defaulted to arbitrary values (e.g. defaulting empty notes to C or missing meter to 4/4). Unstructured sources without a real recognition engine return explicit honest statuses (`RECOGNITION_UNAVAILABLE` or `RECOGNITION_PENDING`).
4. **Idempotent Ingestion:** The source file's SHA-256 hash combined with the authenticated user ID uniquely identifies the source. Duplicate uploads return the existing processing record or song version safely without redundant database churn.
5. **Durable Persistence & Auditability:** Every ingestion request is tracked in PostgreSQL with start time, completion time, status, diagnostics, and actor attribution.

### 3.2 Ingestion Pipeline Flow

```
[Raw Musical Source] (File Buffer, String, or Video URL)
        │
        ▼
┌────────────────────────────────────────────────────────┐
│ 1. Pre-Ingestion Security & Boundary Validation       │
│    - Size verification (<= 15 MiB binary, 25 MiB HTTP)│
│    - Binary Magic Byte verification (PDF, PNG, TIFF,  │
│      JPEG, MIDI, Audio)                               │
│    - SHA-256 Hash Calculation                         │
│    - Filename sanitization & Path Traversal prevention│
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ 2. Source Preservation (Local Storage Provider)        │
│    - Stored at `storage/sources/<hash>.<ext>`          │
│    - Read-only immutable source archive                │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ 3. Adapter Resolution & Execution                     │
│    - IIngestionAdapter.canHandle(input)               │
│    ├── MusicXmlIngestionAdapter                       │
│    ├── MidiIngestionAdapter                           │
│    ├── ChordProIngestionAdapter                       │
│    ├── WrittenNotesIngestionAdapter                   │
│    ├── VisualScoreIngestionAdapter (PDF/Image)        │
│    ├── AudioIngestionAdapter                          │
│    └── VideoUrlIngestionAdapter (SSRF Guarded)        │
└───────────────────────┬────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
[Structured Formats]            [Unstructured / Recognition]
(MusicXML, MIDI, ChordPro,      (PDF, Images, Audio, Video)
 Written Notes)                         │
        │                               ▼
        ▼                        ┌──────────────────────────────┐
┌───────────────────────────┐    │ Recognition Engine Check     │
│ Canonical Normalization   │    │ - If Real Engine Present:    │
│ - 480 TPQN Timeline       │    │   Process & Return Proposal  │
│ - Exact Measures & Notes  │    │ - If Real Engine Absent:     │
│ - Preserved Voices & Tracks    │   Return RECOGNITION_        │
│ - Zero Guessing/Defaulting│    │   UNAVAILABLE with 0 notes   │
└───────────────┬───────────┘    └──────────────┬───────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. Relational Persistence & Audit Trail (PostgreSQL)          │
│    - Song & SongVersion (Canonical Payload JSONB)             │
│    - SongSource (Raw content & Importer Provenance)           │
│    - BackgroundJob (Status & Diagnostics tracking)            │
│    - AuditLog (Immutable session actor stamping)              │
└───────────────────────────────────────────────────────────────┘
```

---

## 4. DETAILED SPECIFICATION FOR STRUCTURED FORMATS (WORKSTREAM B)

### 4.1 B1. MusicXML 4.0 Adapter
- **Parser Security:** Custom non-recursive `XmlParser` preventing XML External Entity (XXE) attacks, entity expansion bombs (Billion Laughs), and arbitrary file disclosure.
- **Musical Extraction:**
  - `work-title`, `movement-title`, `creator` (composer/artist).
  - Parts from `score-partwise` -> mapped to `InstrumentTrack` with unique IDs and voice assignments.
  - Measures -> time signatures (`attributes/time`), key signatures (`attributes/key`), tempo directives (`direction/sound@tempo`).
  - Notes -> pitch step (`step`), octave (`octave`), accidental (`alter`), duration (`duration` mapped from `divisions` to 480 TPQN), tie status (`tie@type`), articulation, velocity (dynamics).
  - Explicit rests (`rest`) mapped to canonical `Rest` instances.
  - Lyrics (`lyric/text`, `syllabic`) mapped to canonical `LyricSyllable`.
- **Validation:** Strict rejection of malformed XML or documents with 0 valid measures.

### 4.2 B2. Standard MIDI File (SMF) Parser & Adapter
- **Header Parsing (`MThd`):** Validates 4-byte chunk identifier `MThd` (`0x4D 0x54 0x68 0x64`), chunk size 6, format 0 (single-track) and format 1 (multi-track synchronous), and division (TPQN).
- **Track Parsing (`MTrk`):** Validates 4-byte identifier `MTrk` (`0x4D 0x54 0x72 0x6B`), chunk length, and parses variable-length quantity (VLQ) delta times.
- **Event Handling:**
  - Channel events: Note On (`0x90`, velocity > 0), Note Off (`0x80` or `0x90` with velocity 0), Program Change (`0xC0` for instrument assignment), Pitch Bend, Control Change. Running status is fully supported.
  - Meta events: Set Tempo (`0x51` -> 3-byte microseconds per quarter note -> BPM = $60,000,000 / \text{tempo}$), Time Signature (`0x58` -> numerator/denominator), Track Name (`0x03`).
- **Canonical Conversion:**
  - Converts MIDI ticks to canonical 480 TPQN: $\text{canonicalTick} = \text{round}(\text{midiTick} \times 480 / \text{midiDivision})$.
  - Groups note-on and note-off events to calculate exact `durationTicks`.
  - Maps MIDI pitch numbers ($0..127$) to note names and octaves: $\text{octave} = \lfloor \text{pitch} / 12 \rfloor - 1$, $\text{pitchClass} = \text{pitch} \pmod{12}$.
  - Builds measures based on detected time signature and tempo map.
  - **Zero Fabrication:** If key signature or lyrics are absent, they are left empty/undefined.

### 4.3 B3. ChordPro Adapter
- **Directive Handling:** Parses `{title: ...}`, `{artist: ...}`, `{key: ...}`, `{tempo: ...}`, `{time: ...}`, `{soc}`, `{eoc}`, `{sov}`, `{eov}`, `{c: ...}`.
- **Chord and Lyric Alignment:** Interleaves chords `[C#m]` with text syllables while preserving exact tick positioning within 480 TPQN measures.
- **Transposition:** Computes musical transposition deltas preserving harmonic relationships.
- **Zero Fabrication:** Produces 0 melody notes (stamped explicitly in version metadata: `totalNotes: 0`).

### 4.4 B4. Written Musical Notes Adapter
- **Musician-Friendly Schema:** Structured JSON endpoint allowing manual entry of:
  - Time signature (`numerator`, `denominator`).
  - Key signature (`key`: e.g. `'G'`, `'Bb'`, `'F#'`).
  - Tempo (`bpm`: e.g. `120`).
  - Measures array, each containing:
    - Notes: `step` (`A-G`), `alter` (`-2..2`), `octave` (`0..9`), `duration` (`'whole'`, `'half'`, `'quarter'`, `'eighth'`, `'16th'`, `'32nd'`), `isRest` (`boolean`), optional `velocity`.
    - Chords: `root` (`A-G`), `alter`, `quality` (`'maj'`, `'m'`, `'7'`, `'sus4'`, etc.), `startTick`.
    - Lyrics: `text`, `startTick`.
- **Validation:** Validates measure durations against time signature ticks, enforces strict pitch boundaries, and commits directly to `CanonicalMusicPayload`.

---

## 5. RECOGNITION BOUNDARIES (WORKSTREAMS C & D)

### 5.1 PDF and Image Score Ingestion (Workstream C)
- PDF, PNG, JPEG, TIFF files are validated by magic bytes and SHA-256.
- Text-layer PDFs are parsed with `PdfTextExtractor` to detect chord sheets and song sections.
- When optical score recognition is required:
  - If a certified OMR engine (e.g. Audiveris CLI) is installed and active, an OMR proposal job is initiated.
  - If no certified OMR engine is present, the system returns `RECOGNITION_ENGINE_UNAVAILABLE` with 0 fake measures and 0 fake notes, archiving the source safely for future recognition.

### 5.2 Audio and Video Ingestion (Workstream D)
- Audio files (MP3, WAV, M4A, FLAC, AAC) are validated by magic byte headers and stored in `storage/audio/`. Basic duration and technical properties are captured.
- Video URLs are validated against a strict platform whitelist (e.g. `youtube.com`, `youtu.be`, `vimeo.com`).
- **SSRF Prevention:** Hostnames resolving to private or loopback IP ranges (`127.0.0.1`, `localhost`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`) are immediately rejected with `ValidationError`.
- Audio transcription and video audio extraction are registered as pending or unsupported provider states without fabricating transcriptions.

---

## 6. LICENSING & DEPENDENCY ASSESSMENT

No external dependencies are introduced for MIDI, XML, or ChordPro parsing. All parsers are implemented natively in pure TypeScript under Bethesda Worship Studio's permissive Apache-2.0 / MIT compatible project license, ensuring:
- Zero AGPL viral licensing obligations.
- Zero external native binaries or runtime security risks.
- 100% deterministic, testable behavior across all platforms.

