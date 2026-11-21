# CC_01: CURRENT CAPABILITIES INVENTORY
## BETHESDA WORSHIP STUDIO — CONVERSION CENTER TECHNICAL AUDIT

- **Project:** Bethesda Worship Studio
- **Document ID:** `CC-01-CAPABILITIES-INVENTORY`
- **Audit Date:** November 2026
- **Status:** Complete Technical Audit & Inventory
- **Repository Branch:** `feature/phase-1a-core-foundation`
- **Base Commit:** `51fef932b082df82bd31d643983a271c155eb4e2`
- **Execution Mode:** Read-Only Audit & Gap Analysis

---

## 1. Executive Summary

This inventory provides an exhaustive, evidence-based technical analysis of all musical file ingestion, parsing, conversion, rendering, and export capabilities currently present in the Bethesda Worship Studio codebase.

The audit reveals a clear architectural pattern:
1. **Structured Ingestion & Canonical Normalization (MusicXML & ChordPro):** Highly developed, rigorously tested, fully deterministic, and compliant with zero-fabrication principles.
2. **Raw File Ingestion & Immutable Storage (Phase 1B-R):** File preservation in `song_sources` with SHA-256 verification and magic byte validation is implemented for Audio, Video URLs, MIDI, and PDF/Images.
3. **Document Ingestion (PDF & Images):** Split into two distinct mechanisms:
   - *Visual Document Stand:* PDF and image rendering for digital music stand display without extracting notes.
   - *Chord-over-Text Heuristic Parser:* Deterministic regex and coordinate-based extraction of text chords for lyrics/chord sheets (e.g. CMB cancioneros).
4. **General Musical Conversion Center & Outbound Exporters:** **Currently non-existent**. There is no unified Conversion Center interface, no Canonical-to-MusicXML serializer, no Canonical-to-MIDI serializer, no real Optical Music Recognition (OMR) engine, and no Audio-to-MIDI transcription engine.

---

## 2. Ingestion & Conversion Capabilities Matrix

The following classification reflects the exact state of the codebase:
- **FUNCTIONAL:** Fully implemented, verified with automated tests, integrated into the core pipeline.
- **PARTIAL:** Implemented for specific scenarios or with severe domain boundaries (e.g., text-only PDF extraction).
- **MOCKED / STUBBED:** Architectural interfaces, database schemas, and API contracts exist, but execution engine returns mock data or unavailable status.
- **NON-EXISTENT:** Zero code or implementation exists.

| Capability / Flow | Implementation Status | Primary Files & Components | Description / Evidence |
| :--- | :--- | :--- | :--- |
| **MusicXML Ingestion** | **FUNCTIONAL** | `frontend/src/core/ingestion/musicxml/musicxml-importer.ts`<br>`backend/src/domain/ingestion/adapters/musicxml/musicxml-adapter.ts` | Complete deterministic MusicXML 4.0 parser. Normalizes durations to 480 TPQN, multi-voice cursor tracking, zero-fabrication of pitches/octaves/tempos, unmetered measure support. |
| **ChordPro Ingestion** | **FUNCTIONAL** | `frontend/src/core/ingestion/chordpro/chordpro-importer.ts`<br>`backend/src/domain/ingestion/adapters/chordpro/chordpro-adapter.ts` | Complete deterministic ChordPro parser. Preserves unmetered measures, associates chords with syllables, enforces zero temporal fabrication. |
| **MIDI Ingestion** | **PARTIAL** | `backend/src/domain/ingestion/adapters/midi/midi-adapter.ts`<br>`backend/src/domain/ingestion/adapters/midi/midi-parser.ts` | Backend MIDI binary parser parses tracks, header, PPQ, NoteOn/NoteOff, Pitch, Velocity. Converts to CanonicalMusicPayload when note events exist. Missing frontend ingestion UI integration. |
| **Direct Written Notes Ingestion** | **FUNCTIONAL** | `backend/src/domain/ingestion/adapters/written-notes/written-notes-adapter.ts`<br>`backend/src/interfaces/http/routes/ingestion.routes.ts` | Validates structured JSON input (`measures`, `notes`, `chords`, `lyrics`) and constructs valid `CanonicalMusicPayload`. Tested in integration test suites. |
| **Visual PDF Score Ingestion (Display Only)** | **FUNCTIONAL** | `frontend/src/components/workspace/VisualDocumentStand.tsx`<br>`backend/src/domain/ingestion/adapters/visual-score/visual-score-adapter.ts`<br>`backend/src/application/document-service.ts` | Validates `%PDF-` magic bytes, stores original file in `song_sources`, generates stream ticket, and renders pages as vector/raster in `VisualDocumentStand`. Notes are not parsed. |
| **Visual Image Score Ingestion (Display Only)** | **FUNCTIONAL** | `frontend/src/components/workspace/VisualDocumentStand.tsx`<br>`backend/src/domain/ingestion/adapters/visual-score/visual-score-adapter.ts` | Validates PNG, JPEG, TIFF magic bytes, stores original image, renders in visual stand. Staves and notes are not extracted. |
| **PDF Text / Chord-over-Text Extraction** | **PARTIAL** | `backend/src/domain/documents/pdf-text-extractor.ts`<br>`frontend/src/core/ingestion/conversion/pdf-chord-extractor.ts`<br>`frontend/src/core/ingestion/conversion/chord-sheet-converter.ts` | Extracts FlateDecode text streams, detects chords via regex (`[A-G][b#]?...`), splits two-column cancioneros (e.g. CMB AZUL), converts to ChordPro. **Does not extract sheet music notes or staves.** |
| **Optical Music Recognition (OMR) Engine** | **MOCKED / STUBBED** | `backend/src/domain/omr/omr-provider.ts`<br>`backend/src/application/omr-service.ts`<br>`backend/src/interfaces/http/routes/omr.routes.ts` | Complete PostgreSQL review schema (`omr_proposals`, `omr_proposal_measures`, `omr_audit_history`) and REST API exist. However, `StandardOmrProvider` returns a hardcoded mock ("Gracia Sublime Es") in tests, or returns 0 measures and `RECOGNITION_UNAVAILABLE` when `REAL_OMR_ENGINE_CONFIGURED` is false. No Audiveris/Calamari/ML engine is wired up. |
| **Audio File Ingestion (Storage & Streaming)** | **FUNCTIONAL** | `backend/src/domain/ingestion/adapters/audio/audio-adapter.ts`<br>`backend/src/application/audio-service.ts`<br>`backend/src/interfaces/http/routes/audio.routes.ts` | Validates magic bytes (WAV RIFF/WAVE, MP3 ID3/sync, FLAC, M4A ftyp), stores file immutably with SHA-256 in `song_sources`. Supports audio playback and multitrack stem routing. |
| **Audio-to-Score / Audio-to-MIDI Transcription** | **NON-EXISTENT** | `backend/src/domain/ingestion/adapters/audio/audio-adapter.ts:141-155` | Explicitly marked as `RECOGNITION_UNAVAILABLE` with `canonicalPayload: null`. No pitch detection, polyphonic transcription, or onset detection engine installed. |
| **Audio Chord Recognition** | **NON-EXISTENT** | None | No audio chromagram, NNLS chroma, or ML chord extraction engine exists. |
| **Audio Stem Separation** | **NON-EXISTENT** | `backend/src/db/schema.ts:85` | Enum `STEM_SEPARATION` exists in `job_type`, but no Demucs/Spleeter integration or processing worker exists. |
| **Video URL Ingestion** | **PARTIAL** | `backend/src/domain/ingestion/adapters/video/video-url-adapter.ts` | Strict SSRF validation (blocks localhost, 127.0.0.1, private CIDRs, 169.254.169.254), domain whitelist (YouTube, Vimeo). Preserves URL reference. **Does not extract audio or convert video.** |
| **Direct Video File Ingestion (MP4/MKV)** | **NON-EXISTENT** | None | Direct video file uploads are not supported; no FFmpeg extraction pipeline. |
| **Canonical -> MusicXML Exporter** | **NON-EXISTENT** | None | No serializer exists to convert `CanonicalMusicPayload` back to valid MusicXML 4.0 XML. |
| **Canonical -> MIDI Exporter** | **NON-EXISTENT** | None | No serializer exists to generate `.mid` binary tracks from `CanonicalMusicPayload`. |
| **Canonical -> ChordPro Exporter** | **PARTIAL** | `frontend/src/core/ingestion/conversion/chord-sheet-converter.ts` | Helper function formats text chords into ChordPro directives, but no generic domain serializer exists to export any `CanonicalMusicPayload` to ChordPro. |
| **Canonical -> Engraved PDF Exporter** | **NON-EXISTENT** | None | Only browser CSS `@media print` styling exists. No server-side or headless engraving engine (e.g. headless OSMD, Cairo, or Verovio) produces printable PDF scores. |
| **Conversion Center UI Hub** | **NON-EXISTENT** | `frontend/src/components/workspace/DocumentConversionModal.tsx` | Only a modal specialized in chord-sheet PDF parsing exists. No dedicated Conversion Center page, matrix view, or batch processing hub. |
| **Asynchronous Job Worker Daemon** | **MOCKED / STUBBED** | `backend/src/repositories/background-job-repository.ts`<br>`backend/src/db/schema.ts:765-785` | `background_jobs` table and CRUD repository exist. However, there is no daemon runner, queue processor, or Redis/BullMQ/pg-boss worker actively polling and executing tasks in the background. |

---

## 3. Deep Component Analysis

### 3.1. Frontend Ingestion Architecture

#### `frontend/src/core/ingestion/unified-importer.ts`
- **Role:** Central entry point for frontend structured ingestion.
- **Active Importers:** `MusicXmlImporter` and `ChordProImporter`.
- **Limitation:** Only inspects textual strings. If binary PDF or audio is supplied, it immediately fails with `UNSUPPORTED_FORMAT`.
- **Zero-Fabrication Contract:** Guarantees that no missing musical parameters (keys, tempos, meters) are synthesized during import.

#### `frontend/src/core/ingestion/conversion/`
- `pdf-chord-extractor.ts`: Implements pure-TypeScript regex pattern matching for chord symbols (`isChordToken`, `isChordLine`) and ASCII tablature lines (`isTabLine`). Used to parse song blocks from raw text.
- `chord-sheet-converter.ts`: Converts parsed text lines into ChordPro syntax and attempts to create a `CanonicalMusicPayload` when unmetered lyrics and chords are present. Contains a hardcoded dictionary of standard guitar chord voicings (`GUITAR_CHORD_VOICINGS`).
- `format-evaluator.ts`: Assesses which of 4 display formats (`SHEET_MUSIC`, `CHORDS_WITH_LYRICS`, `LYRICS_ONLY`, `TABLATURE`) can be rendered from an input. Crucially, lines 78-87 enforce:
  ```typescript
  // format-evaluator.ts:78-87
  return {
    format: 'SHEET_MUSIC',
    title: 'Partitura Tradicional',
    status: 'BLOCKED_INSUFFICIENT_DATA',
    isSelectable: false,
    badgeText: 'No Disponible en Origen',
    explanation: 'El documento de origen es un cancionero de texto con cifrado armónico...',
    missingDataNotice: 'Para generar una partitura tradicional de forma fidedigna y sin inventar notas ficticias, importe un archivo MusicXML formal o una partitura escaneada con pentagramas legibles aprobada mediante OMR.'
  };
  ```
  This is strict zero-fabrication enforcement: when a user uploads a text PDF, sheet music is explicitly blocked rather than generating fake notes.

#### `frontend/src/components/workspace/DocumentConversionModal.tsx`
- **Role:** Interactive modal triggered when a visual document is imported.
- **Workflow:** Calls backend `client.analyzeDocument(storageKey)`. If the document contains chord-over-text lines, it lets the user verify title, artist, key, and raw text, then converts it to ChordPro.
- **Limitation:** In lines 157-159, it hardcodes `hasStavesAndNotes: false` because there is no optical music recognition engine available to inspect sheet music staves.
- **Fallback behavior:** Lines 110-117 and 122-125 contain hardcoded fallback sample text ("GRANDE ES TU FIDELIDAD") if the backend storage key is missing or an error occurs during analysis.

### 3.2. Backend Ingestion & Document Architecture

#### `backend/src/application/universal-ingestion-service.ts`
- **Role:** Authoritative server-side ingestion orchestrator implemented in Phase 1B-R.
- **Storage-First Policy:** In lines 280-286, every incoming input is physically preserved in storage and registered in `song_sources` with its SHA-256 digest *before* any adapter parsing occurs.
- **Multi-Tenant Idempotency:** Lines 297-315 enforce strict scoping:
  ```typescript
  and(eq(songSources.userId, user.id), eq(songSources.checksumSha256, sourceHash))
  ```
  This guarantees zero cross-tenant IDOR leakage while eliminating duplicate processing for the same user.
- **Honest Adapter Delegation:** Lines 346-358 handle adapters that produce no canonical payload (e.g. Audio, Video, VisualScore):
  ```typescript
  return {
    status: 'SOURCE_PRESERVED',
    sourceType: adapter.sourceType,
    sourceHash,
    canonicalPayload: null, // CERO FABRICATED SCORE
    ...
  };
  ```

#### `backend/src/domain/omr/omr-provider.ts` & `omr-service.ts`
- **Role:** Optical Music Recognition domain abstraction and proposal management.
- **Reality:**
  - `StandardOmrProvider` checks file magic bytes (`validateOmrFileSignature`) for PDF, PNG, JPEG, TIFF.
  - When `options.realEngineProvider` is supplied, it delegates to that function.
  - When `options.enableTestFixture` is true, it returns a hardcoded 2-measure proposal ("Gracia Sublime Es", confidence 0.875).
  - When running in production without a real engine (lines 214-241), it returns:
    ```typescript
    return {
      proposalId,
      sourceFilename: input.filename,
      sourceHash: hash,
      detectedTitle: null,
      detectedKey: null,
      detectedBpm: null,
      overallConfidence: 0.0,
      isAiDraft: true,
      reviewStatus: 'PENDING_REVIEW',
      measures: [], // Cero notas inventadas
      unrecognizedRegions: [{ page: 1, reason: reasonMessage }],
      createdAt: new Date().toISOString()
    };
    ```
- **Auditing & Human Review:** The review workflow (`approve`, `reject`, `patchMeasure`, `commitToSong`) in `OmrService` is fully functional and backed by PostgreSQL tables `omr_proposals`, `omr_proposal_measures`, and `omr_audit_history`. What is missing is the engine that generates the initial detection.

#### `backend/src/domain/ingestion/adapters/audio/audio-adapter.ts`
- **Magic Byte Validation:** Lines 60-109 inspect binary headers:
  - WAV: `RIFF....WAVE`
  - MP3: `ID3` or sync frame `0xFF 0xFB/F3/F2/FA`
  - FLAC: `fLaC`
  - M4A: `ftyp`
- **Zero Fabrication:** Lines 141-168 verify `process.env.AUDIO_TRANSCRIPTION_ENGINE_CONFIGURED`. Because this engine does not exist, it marks the ingestion as `RECOGNITION_UNAVAILABLE` and sets `canonicalPayload: null`, `defaultKey: null`, `defaultBpm: null`, `timeSignature: null`.

#### `backend/src/domain/ingestion/adapters/video/video-url-adapter.ts`
- **Security:** Lines 51-100 validate URL format, enforce HTTPS, and strictly block loopback, local subnets, link-local metadata addresses (`169.254.169.254`), and non-whitelisted domains (only `youtube.com`, `youtu.be`, `vimeo.com` are permitted).
- **Zero Fabrication:** Stores the video reference in `song_sources` with a JSON descriptor. Does not attempt to download, scrape, or transcribe audio.

---

## 4. Key Gaps Identified

1. **No Outbound Exporters:** The platform can read MusicXML and ChordPro, but it cannot write them back out from `CanonicalMusicPayload`. A user who edits a song in Bethesda Worship Studio cannot export it to standard MusicXML or MIDI.
2. **Missing Real Engines:**
   - No OMR engine (Audiveris, Calamari, or OMR deep learning models).
   - No Audio-to-MIDI / Pitch tracking engine (Basic Pitch, Omnizart).
   - No Audio chord recognition engine.
   - No Audio stem separation engine.
   - No Video-to-audio extraction worker (FFmpeg).
3. **No General-Purpose Conversion Center UI:** The UI only has import buttons in the catalog and the song workspace. There is no central "Conversion Center" screen where a user can drag and drop any file, see what it can be converted into, select target formats, monitor background progress, review side-by-side results, and download converted files.
4. **No Active Background Worker Queue Runner:** While the `background_jobs` table exists in PostgreSQL, there is no worker daemon processing jobs asynchronously. All current operations run synchronously within the HTTP request/response cycle.

---

## 5. Architectural Verification & Evidence

All findings above are grounded directly in the verified codebase at commit `51fef932b082df82bd31d643983a271c155eb4e2`.
- Zero uncommitted code changes exist.
- Zero mock engines masquerade as production implementations.
- Zero musical fabrication was detected in any ingestion adapter.

