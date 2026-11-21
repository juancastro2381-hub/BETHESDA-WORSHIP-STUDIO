# CC_07: IMPLEMENTATION ROADMAP
## BETHESDA WORSHIP STUDIO — CONVERSION CENTER TECHNICAL AUDIT

- **Project:** Bethesda Worship Studio
- **Document ID:** `CC-07-IMPLEMENTATION-ROADMAP`
- **Audit Date:** November 2026
- **Status:** Strategic Engineering Roadmap & Phased Execution Plan
- **Repository Branch:** `feature/phase-1a-core-foundation`
- **Base Commit:** `51fef932b082df82bd31d643983a271c155eb4e2`
- **Execution Mode:** Read-Only Engineering Planning

---

## 1. Roadmap Architecture & Phasing Principles

To deliver the **Bethesda Musical File Conversion Center** without endangering the architectural stability and zero-fabrication integrity established in Phases 1A and 1B, implementation must follow a strictly decoupled, incremental 5-milestone sequence:

```
  +-----------------------------------------------------------------------------------+
  | MILESTONE 1: FOUNDATIONAL OUTBOUND EXPORTERS (Phase 2A)                           |
  | Core serializers from CanonicalMusicPayload to MusicXML, MIDI, ChordPro, Lyrics   |
  +-----------------------------------------------------------------------------------+
                                            |
                                            v
  +-----------------------------------------------------------------------------------+
  | MILESTONE 2: CONVERSION CENTER UI HUB & SYNCHRONOUS API (Phase 2B)                |
  | Unified Drag & Drop, Target Format Grid, Zero-Fabrication Badges, Transpile API   |
  +-----------------------------------------------------------------------------------+
                                            |
                                            v
  +-----------------------------------------------------------------------------------+
  | MILESTONE 3: ASYNCHRONOUS WORKER QUEUE & STREAMING INFRASTRUCTURE (Phase 2C)      |
  | PostgreSQL pg-boss queue, Job Dispatcher, SSE Real-Time Progress, Concurrency Gate|
  +-----------------------------------------------------------------------------------+
                                            |
                                            v
  +-----------------------------------------------------------------------------------+
  | MILESTONE 4: AUDIO & VIDEO CONVERSION ENGINES (Phase 2D)                          |
  | Python ML Sidecar: Basic Pitch ONNX, Madmom Chords, Whisper.cpp Lyrics, FFmpeg   |
  +-----------------------------------------------------------------------------------+
                                            |
                                            v
  +-----------------------------------------------------------------------------------+
  | MILESTONE 5: OPTICAL MUSIC RECOGNITION PIPELINE (Phase 2E)                        |
  | Java Audiveris 5.3+ Sidecar: Headless OMR, Bounding Box Review, Catalog Commit   |
  +-----------------------------------------------------------------------------------+
```

---

## 2. Milestone Breakdown & Technical Specifications

### Milestone 1: Foundational Outbound Exporters (Phase 2A)
- **Objective:** Enable bidirectional musical serialization so that any `CanonicalMusicPayload` in memory can be saved into standard industry interchange files.
- **Key Deliverables:**
  1. `CanonicalToMusicXmlSerializer`: Deterministic serialization to standard MusicXML 4.0 XML with part definitions, measure divisions, pitch elements, durations, harmony tags, and lyrics.
  2. `CanonicalToMidiSerializer`: Conversion of canonical events into standard Type 1 MIDI binary chunks (`MThd`, `MTrk`), tick delta calculation, pitch and velocity mapping.
  3. `CanonicalToChordProSerializer`: Syllable-anchored chord placement emitting standard `{title}`, `{artist}`, `{key}`, `{time}` directives.
  4. `CanonicalToLyricsSerializer`: Extraction of sanitized text for video projection or congregational printing.
- **Test Strategy:** Automated bidirectional round-trip tests:
  - `MusicXML -> Ingest -> Canonical -> Export -> MusicXML` (Structural and pitch equivalence).
  - `MIDI -> Ingest -> Canonical -> Export -> MIDI` (Tick and note event verification).
  - `ChordPro -> Ingest -> Canonical -> Export -> ChordPro` (Deterministic equivalence).
- **Estimated Effort:** 2 Weeks (1 Sprint).

---

### Milestone 2: Conversion Center UI Hub & Synchronous API (Phase 2B)
- **Objective:** Provide a dedicated, intuitive web interface for drag-and-drop file ingestion, target format selection, and instant synchronous format conversions.
- **Key Deliverables:**
  1. Primary navigation link and route `/workspace/conversion-center`.
  2. `ConversionDropZone.tsx`: Universal drop zone with instant binary magic byte inspection.
  3. `FormatSelectorGrid.tsx`: Dynamic target matrix showing available vs. blocked formats with zero-fabrication badges.
  4. Synchronous Conversion API: `POST /api/v1/conversion/transpile` for instant structured transformations (MusicXML <-> MIDI <-> ChordPro).
  5. One-click direct downloads and *"Send to Digital Stand"* integration.
- **Zero-Fabrication Enforcement:** Hardcoded rejection of traditional sheet music output when the input is a chord-only cancionero or plain text file.
- **Estimated Effort:** 2 Weeks (1 Sprint).

---

### Milestone 3: Asynchronous Worker Queue & Streaming Infrastructure (Phase 2C)
- **Objective:** Establish resilient background job execution and real-time browser progress streaming for high-latency conversions.
- **Key Deliverables:**
  1. **pg-boss Queue Integration:** Setup queue schemas within PostgreSQL; implement `JobDispatcherService` and worker claim loops.
  2. **Streaming Endpoint:** `GET /api/v1/conversion/jobs/:jobId/stream` via Server-Sent Events (SSE) emitting progress percentage, active stage label, and completion payloads.
  3. **Real-Time UI Progress Card:** `ConversionProgressCard.tsx` with multi-step animated visual indicator and cancel action.
  4. **Multi-Tenant Concurrency Limiter:** Max 2 active background jobs per user; queuing of excess requests.
  5. **Automated Ephemeral Storage Cleaner:** Hourly cleanup of scratch files older than 24 hours.
- **Test Strategy:** Chaos testing: worker restarts mid-job, simulate database disconnection, test concurrency exhaustion and fair-share queue recovery.
- **Estimated Effort:** 2 Weeks (1 Sprint).

---

### Milestone 4: Audio & Video Conversion Engines (Phase 2D)
- **Objective:** Integrate self-hosted Music Information Retrieval (MIR) and audio transcoding engines to convert worship recordings into MIDI, chord progressions, and lyrics.
- **Key Deliverables:**
  1. **Containerized Python ML Sidecar (`bethesda-ml-worker`):**
     - FFmpeg for audio decoding and video audio-track extraction.
     - Spotify Basic Pitch (ONNX runtime) for polyphonic pitch transcription.
     - Madmom for harmonic chromagram calculation and chord estimation.
     - Whisper.cpp (C++ binary) for lyric transcription with word-level timestamps.
  2. **Side-by-Side Review Studio (`ConversionReviewStudio.tsx`):**
     - Waveform audio player synchronized with editable MIDI/ChordPro draft.
     - Confidence score visualizer per chord and measure.
  3. **Video URL Audio Extractor:** Secure processing of authorized worship video links.
- **Test Strategy:** Benchmark against 20 real Christian worship recordings (acoustic guitar, piano lead, full sanctuary band, solo vocal) verifying chord accuracy and note detection thresholds.
- **Estimated Effort:** 3 Weeks (1.5 Sprints).

---

### Milestone 5: Optical Music Recognition Pipeline (Phase 2E)
- **Objective:** Provide automated conversion of scanned physical sheet music and PDF scores into editable MusicXML and canonical songs.
- **Key Deliverables:**
  1. **Containerized Java OMR Sidecar (`bethesda-omr-worker`):**
     - Headless Audiveris v5.3+ engine packaged with Java 17 and Tesseract OCR.
     - Complete network isolation ensuring zero GPLv3 link contamination.
  2. **Visual Bounding-Box Review Interface:**
     - Split screen showing original scanned PDF on the left and interactive sheet music on the right.
     - Yellow bounding boxes over low-confidence measures requiring human confirmation.
  3. **Atomic Catalog Commit:** One-click approval and atomic transaction writing to `songs`, `song_versions`, and `omr_proposals`.
- **Test Strategy:** Test suite of 30 scanned scores ranging from clean engraving to vintage hymnbooks and mobile phone score photographs.
- **Estimated Effort:** 3 Weeks (1.5 Sprints).

---

## 3. High-Level Engineering Timeline & Gantt Schedule

```
  Sprint 1 (Weeks 1-2):   [=== M1: Outbound Exporters (MusicXML, MIDI, ChordPro) ===]
  Sprint 2 (Weeks 3-4):   [=== M2: Conversion Center UI Hub & Synchronous API  ===]
  Sprint 3 (Weeks 5-6):   [=== M3: pg-boss Queue & SSE Real-time Streaming     ===]
  Sprint 4-5 (Weeks 7-9): [====== M4: Audio & Video ML Sidecar (Basic Pitch/Whisper) ======]
  Sprint 6-7 (Weeks 10-12)[====== M5: Optical Music Recognition Sidecar (Audiveris)  ======]
```

Total Estimated Implementation Duration: **12 Weeks (6 Sprints)** across a 2-engineer squad.

---

## 4. Risk Matrix & Mitigation Strategies

| Risk Description | Severity | Probability | Architectural Mitigation Strategy |
| :--- | :---: | :---: | :--- |
| **GPLv3 Legal Contamination via Audiveris** | **HIGH** | Low | Package Audiveris exclusively inside a standalone Docker container. Expose only over an HTTP/JSON network boundary. Strictly forbid Java linking into Node.js. |
| **High Memory Usage on Modest VPS** | **HIGH** | Medium | Set hard cgroups memory limits (2GB for ML, 3GB for OMR). Configure pg-boss worker concurrency to execute heavy jobs strictly sequentially (concurrency = 1). |
| **MIR Inaccuracy on Full Band Audio** | **MEDIUM** | High | Never bypass human review. Audio transcription outputs are perpetually flagged with `isAiDraft: true`. Musical confidence slider lets users filter low-confidence ghost notes. |
| **User Confusion on Blocked Formats** | **MEDIUM** | Medium | Prominent zero-fabrication badges with educational tooltips explaining *why* notes cannot be created from plain chord lyrics. |
| **Slow Cold Starts for Containerized Models** | **LOW** | Medium | Keep ML worker container persistent with pre-warmed ONNX sessions. Whisper.cpp and Basic Pitch initialize in < 500ms on CPU. |

---

## 5. Definition of Done (DoD) for Conversion Center Release

1. **Zero-Fabrication Audit Passed:** No conversion path synthesizes missing musical data without explicit user input or AI draft labeling.
2. **Zero Uncommitted Git Drift:** All code, migrations, and docker configs committed with verified cryptographic signatures.
3. **Automated Test Coverage:** > 85% branch coverage on all serializers, parsers, and job dispatcher routines.
4. **Permanent Free Cost Verified:** Zero third-party metered API keys in environment configurations; system runs entirely within standard \$30/month VPS resources.
5. **Human Review Gate Functional:** OMR and audio transcription cannot write directly to canonical song catalog without passing through the interactive review interface.

