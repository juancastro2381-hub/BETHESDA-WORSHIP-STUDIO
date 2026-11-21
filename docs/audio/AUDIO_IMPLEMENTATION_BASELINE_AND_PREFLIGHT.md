# BETHESDA WORSHIP STUDIO
# AUDIO CONVERSION IMPLEMENTATION BASELINE & PRE-FLIGHT REPORT

- **Document Path:** `docs/audio/AUDIO_IMPLEMENTATION_BASELINE_AND_PREFLIGHT.md`
- **Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`
- **Branch:** `feature/phase-1a-core-foundation`
- **Verified Local & Remote Baseline Commit (`HEAD`):** `35e959d05a7fccd5e6d0558ad80da2730996f7c1`
- **Previous Code Commit (`HEAD~1`):** `bdae9ebd3494442b8d5ad6f36103ec5fc0107117`
- **Date:** `2026-11-13`
- **Authorized Scope:** Option 1C (`WS-AUDIO-01` $\rightarrow$ `WS-AUDIO-02` $\rightarrow$ `WS-AUDIO-03`, Sequential Execution with Mandatory Gates)
- **Current Stage Authorization:** Pre-Flight + `WS-AUDIO-01` Only

---

## 1. REPOSITORY, BRANCH, WORKING TREE & COMMIT VERIFICATION

### 1.1 Git State Inspection
Executed prior to any source code modification:
- **Active Branch:** `feature/phase-1a-core-foundation` tracking `origin/feature/phase-1a-core-foundation`.
- **Local `HEAD` (`git rev-parse HEAD`):** `35e959d05a7fccd5e6d0558ad80da2730996f7c1`
- **Remote `HEAD` (`git ls-remote origin refs/heads/feature/phase-1a-core-foundation`):** `35e959d05a7fccd5e6d0558ad80da2730996f7c1`
- **Working Tree (`git status -s`):**
  - `M docs/MUSICAL_CONVERSION_CENTER_MP3_FORENSIC_AUDIT.md` (contains a single trailing newline added at EOF when opened in the editor; zero application code modifications).

### 1.2 Forensic Audit Commit Verification (`35e959d05a7fccd5e6d0558ad80da2730996f7c1` vs `35e959d05a7fccd5e6d0558ad80a27309967fc1`)
- The directive requested verification of whether commit string `35e959d05a7fccd5e6d0558ad80a27309967fc1` exists locally and remotely.
- **Forensic Finding:** The string `35e959d05a7fccd5e6d0558ad80a27309967fc1` is 38 hexadecimal characters long (a 2-character transcription omission of `d` at position 28 and `f` at position 37).
- The actual 40-character SHA-1 commit in both the local repository (`HEAD`) and the remote branch (`origin/feature/phase-1a-core-foundation`) is:
  `35e959d05a7fccd5e6d0558ad80da2730996f7c1` (`docs(audit): add forensic functional audit and implementation readiness report for MP3 conversion in Musical Conversion Center`).
- The document `docs/MUSICAL_CONVERSION_CENTER_MP3_FORENSIC_AUDIT.md` (472 lines) is present and verified.

---

## 2. SOURCE CODE COMPARISON & DISCREPANCIES AGAINST THE FORENSIC AUDIT

Direct inspection of the production source code at commit `35e959d05a7fccd5e6d0558ad80da2730996f7c1` confirmed the core conclusions of `docs/MUSICAL_CONVERSION_CENTER_MP3_FORENSIC_AUDIT.md` while uncovering **six critical technical discrepancies/omissions** that must be addressed in `WS-AUDIO-01`:

| # | Area | Audit Report Statement | Actual Code Reality & Newly Uncovered Discrepancies | Impact on `WS-AUDIO-01` |
| :---: | :--- | :--- | :--- | :--- |
| **D-1** | **Frontend Magic-Byte Detection (`format-capabilities.ts:80-118`)** | Audit stated `detectSourceCategory` checks `ID3`, `RIFF`, `OggS`, `fLaC`, and `ftyp`, missing only raw MPEG frame sync. | **Discrepancy:** `FormatCapabilitiesEvaluator.detectSourceCategory` (`frontend/src/core/conversion/format-capabilities.ts:80-118`) does **NOT** check `ftyp` (M4A/MP4) or ADTS AAC sync at all! Binary `.m4a` and `.aac` files contain null bytes (`isBufferBinary === true`) and fall into line 115 (`return 'UNKNOWN_UNSUPPORTED'`). Furthermore, its `ID3` check (`content[0] === 0x49 && content[1] === 0x44 && content[2] === 0x33`) only inspects the first 3 ASCII bytes without validating the 10-byte ID3v2 header structure (version `< 0xFF`, synchsafe size bytes `< 0x80`) or subsequent MPEG audio frames. | Must implement comprehensive binary signature & frame header validation for MP3 (with and without ID3, validating MPEG version, layer, bitrate index, and sample rate bits), WAV, FLAC, OGG, and M4A/AAC. |
| **D-2** | **Extension-Only Fallback in `detectSourceCategory` (`format-capabilities.ts:221-230`)** | Audit noted `.mp3` matches at line 222 when bytes are not yet loaded. | **Discrepancy:** If a text file (e.g., plain ASCII text with no null bytes, so `isBufferBinary === false`) is renamed to `fake.mp3`, execution bypasses line 115, fails the text-format checks in lines 128–187, and hits line 222 (`if (lowerName.endsWith('.mp3')) return 'AUDIO_RECORDING'`), falsely classifying non-audio text as `AUDIO_RECORDING` solely by extension. | When content (`Uint8Array` or non-empty `string`) is supplied, `detectSourceCategory` must **never** classify content as `AUDIO_RECORDING` by extension fallback; audio classification must require validated binary signatures. |
| **D-3** | **Backend `AudioIngestionAdapter` Missing OGG Support (`audio-adapter.ts:60-109`)** | Audit listed `AudioIngestionAdapter` as supporting `.mp3/.wav/.ogg/.flac/.m4a`. | **Discrepancy:** While `AudioIngestionAdapter.canHandle()` (`backend/src/domain/ingestion/adapters/audio/audio-adapter.ts:41`) includes `.ogg`, `detectAudioFormatFromBytes()` (lines 60–109) and `detectMimeType()` (lines 47–54) only implement `WAV`, `MP3`, `FLAC`, and `M4A`. Uploading a valid `.ogg` (`OggS`) file to `POST /api/v1/ingestion/upload` throws `ValidationError` at line 106! | Must unify backend and frontend audio signature validators so `MP3` (ID3 + raw MPEG frame sync), `WAV`, `FLAC`, `OGG` (`OggS`), and `M4A/AAC` (`ftyp`/ADTS) are consistently validated across all entrypoints. |
| **D-4** | **Ingestion Upload Size Limit Mismatch (`ingestion.routes.ts:41, 175` & `source-storage-provider.ts:68`)** | Audit stated max audio upload size is capped at `50 MB`. | **Discrepancy:** While `AudioService` (`audio-service.ts:150`) and `app.ts` (`bodyLimit: 52428800`) allow `50 MB`, `POST /api/v1/ingestion/upload` (`ingestion.routes.ts:41, 175`) and `LocalFileSystemSourceStorageProvider` (`source-storage-provider.ts:68`) hardcode `MAX_OMR_FILE_SIZE_BYTES` (`15 MiB` = `15,728,640` bytes)! Any MP3 or WAV between `15 MiB` and `50 MB` uploaded via `/api/v1/ingestion/upload` or `ConversionJobService` is rejected. | Must configure audio-aware size limits (`50 MB` max for audio sources) and validate both compressed size and decoded stream bounds. |
| **D-5** | **Cross-User Authorization & Checksum Verification Gap in `AudioService` (`audio.routes.ts` & `audio-service.ts`)** | Audit noted `ConversionJobService` and `UniversalIngestionService` enforce anti-IDOR ownership checks. | **Discrepancy:** In `backend/src/interfaces/http/routes/audio.routes.ts` (lines 79–229), `GET /api/v1/audio/:id`, `GET /api/v1/audio/:id/download`, `POST /api/v1/audio/:id/ticket`, `GET /api/v1/audio/:id/stream`, and `DELETE /api/v1/audio/:id` only check role permission (`songs:read` or `songs:update_draft`) without checking resource ownership (`uploadedByUserId` / song ownership) when a user attempts to access or delete another user's private uploaded audio! Furthermore, `AudioService.downloadAudio()` (`audio-service.ts:353-364`) does not re-verify `SHA-256` on retrieval (unlike `UniversalIngestionService.getSourceFile()`). | Must enforce strict ownership/authorization checks and cryptographic `SHA-256` verification on retrieval across audio endpoints, and support streaming preserved audio sources in the Digital Music Stand. |
| **D-6** | **Multiple Binary-to-UTF8 Corruptions (`TextDecoder`)** | Audit identified `ConversionWorker.processJob` line 1368. | **Complete Inventory:** `git grep TextDecoder` revealed **four** places where binary file bytes can be decoded as UTF-8 text: (1) `backend/src/application/conversion-worker.ts:1368`, (2) `backend/src/application/conversion-job-service.ts:224`, (3) `frontend/src/components/conversion/ConversionCenterWorkspace.tsx:359`, and (4) `frontend/src/components/conversion/ConversionCenterWorkspace.tsx:484`. Furthermore, `ConversionEngine.convertSource` (`frontend/src/core/conversion/conversion-engine.ts:38`) only accepts `source: string` instead of `string | Uint8Array`. | Must refactor `ConversionEngine.convertSource`, `ConversionJobService`, `ConversionWorker`, and `ConversionCenterWorkspace` so binary sources (`Uint8Array` / `Buffer`) are never passed through `new TextDecoder('utf-8')`. |

---

## 3. ROADMAP RECONCILIATION & PHASE LABEL ALIGNMENT

### 3.1 Historical Phase Evolution vs. Legacy `PLANNED_PHASE_2B` Labels
1. **Master Roadmap (`BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md`):**
   - **Phase 1A / 1B:** Core Canonical Model, Universal Ingestion & Persistence.
   - **Phase 2A:** Musical Conversion Center & Symbolic Transpilation (`MusicXML`, `MIDI`, `ChordPro`, `Lyrics`).
   - **Phase 2B:** Authentication, Authorization & RBAC Security Foundation (`PHASE_2B_ENGINEERING_REPORT.md`).
   - **Phase 2B.1:** CAS Storage Externalization, PostgreSQL Advisory Locks & TOAST Pruning (`PHASE_2B1_STORAGE_IMPLEMENTATION_AND_ACCEPTANCE_REPORT.md`).
   - **Phase 2B.2:** ASCII Tablature Conversion Engine & 5-Factor Temporal Validator (`PHASE_2B2_ASCII_TAB_CONVERSION_AND_ACCEPTANCE_REPORT.md`).
   - **Phase 2C:** Setlist Liturgical Management & Execution UI (`PHASE_2C_FORMAL_CLOSURE_REPORT.md`).
   - **Phase 2D:** Stage Ergonomics & Offline-First Atril (`WS-2D-01` completed at commit `bdae9ebd3494442b8d5ad6f36103ec5fc0107117`).
   - **Audio Conversion Track (Scope 1C — Authorized Sequential Workstreams):**
     - **`WS-AUDIO-01` (Current Stage 1):** Audio Ingestion, Binary Integrity, Durable Preservation, Atril Playback & Local Python Worker Foundation.
     - **`WS-AUDIO-02` (Stage 2 — Gate 1 Prerequisite):** Local Harmonic Analysis (BPM, Key, Meter, Time-Aligned Chords with Confidence) & Editable `ChordPro` Lead Sheet Drafts.
     - **`WS-AUDIO-03` (Stage 3 — Gate 2 Prerequisite):** Local Polyphonic Pitch Extraction & Quantized `MIDI`, `MusicXML`, and `TABLATURE` Drafts with Mandatory Human Review (`isAiDraft = true`, `reviewStatus = REVIEW_REQUIRED`).

### 3.2 UI Status & Capability State Reconciliation
In `WS-AUDIO-01`:
- The misleading static health indicator `Motor de Cola: pg-boss Activo` in `ConversionCenterWorkspace.tsx` must be replaced with honest, real-time capability status reporting that distinguishes between:
  - **Symbolic Queue (`pg-boss`):** Active for symbolic conversions (`MusicXML`, `MIDI`, `ChordPro`, `Lyrics`, `Tablature`).
  - **Audio Preservation & Playback (`WS-AUDIO-01`):** Operational now—allows authenticated upload, cryptographic `SHA-256` verification, durable backend storage, and immediate playback in the Digital Music Stand (`AudioPlayerBar` / inline player).
  - **Audio Transcription Pipeline (`WS-AUDIO-02` / `WS-AUDIO-03`):** Marked honestly as **Deferred / Planned (`WS-AUDIO-02` / `WS-AUDIO-03`)** until their respective gates are implemented and passed. Conversion buttons for audio-to-notation targets remain disabled in Stage 1 (`WS-AUDIO-01`), while the **Preserve & Play in Digital Music Stand** workflow and **Audio Integrity / Python Worker Verification Job** are enabled and verified.

---

## 4. INVENTORY OF RELEVANT FILES, SYMBOLS, FUNCTIONS & CONSTRAINTS

### 4.1 Frontend Symbols & Files
- `frontend/src/core/conversion/types.ts`: `ConversionSourceCategory`, `ConversionTargetFormat`, `CapabilityState`, `FormatCapabilityInfo`, `SourceCapabilitySummary`.
- `frontend/src/core/conversion/format-capabilities.ts`: `FormatCapabilitiesEvaluator.detectSourceCategory()`, `FormatCapabilitiesEvaluator.inspectAudioSignature()`, `FormatCapabilitiesEvaluator.getSourceCapabilitySummary()`, `FormatCapabilitiesEvaluator.getFormatCapabilities()`.
- `frontend/src/core/conversion/conversion-engine.ts`: `ConversionEngine.convertSource(source: string | Uint8Array, filename: string, options: ConversionOptions)`.
- `frontend/src/components/conversion/ConversionCenterWorkspace.tsx`: `processUploadedFile()`, `handlePreserveAudioSource()`, `handleStartConversion()`, health bar, durable preservation status panel, and direct Atril playback integration.
- `frontend/src/components/workspace/AudioPlayerBar.tsx`: `AudioPlayerBar` (supports playing song audio assets and preserved audio sources via authenticated HTTP 206 streaming or offline IndexedDB).
- `frontend/src/core/api/api-client.ts`: `BethesdaApiClient` methods for audio upload, source preservation, streaming tickets, and audio job status polling.

### 4.2 Backend Symbols & Files
- `backend/src/domain/audio/audio-signature-validator.ts` (New shared validator): Strict binary magic-byte and frame header inspection for `MP3` (with ID3v2 and raw MPEG-1/2/2.5 Layer I/II/III sync), `WAV` (`RIFF/WAVE` + `fmt ` chunk validation), `FLAC` (`fLaC` + STREAMINFO metadata block), `OGG` (`OggS` capture pattern), and `M4A/AAC` (`ftyp` ISO BMFF major/compatible brands + ADTS frame sync).
- `backend/src/domain/ingestion/adapters/audio/audio-adapter.ts`: `AudioIngestionAdapter.detectAudioFormatFromBytes()`, `ingest()`.
- `backend/src/application/audio-service.ts`: `AudioService.uploadAudio()`, `streamAudio()`, `downloadAudio()`, `deleteAudio()`, `validateAudioMagicBytes()`.
- `backend/src/interfaces/http/routes/audio.routes.ts`: `/api/v1/songs/:songId/audio`, `/api/v1/audio/:id`, `/api/v1/audio/:id/download`, `/api/v1/audio/:id/ticket`, `/api/v1/audio/:id/stream`, `DELETE /api/v1/audio/:id`.
- `backend/src/interfaces/http/routes/ingestion.routes.ts` & `backend/src/application/universal-ingestion-service.ts`: `/api/v1/ingestion/upload`, `/api/v1/ingestion/sources/:sourceId`, `/api/v1/ingestion/sources/:sourceId/file`, `/api/v1/ingestion/sources/:sourceId/stream`, `/api/v1/ingestion/sources/:sourceId/ticket`.
- `backend/src/application/conversion-job-service.ts` & `backend/src/application/conversion-worker.ts`: Binary-safe `Uint8Array`/`Buffer` handling, elimination of `new TextDecoder('utf-8').decode(sourceBuffer)` on binary sources, and `pg-boss` orchestration for the Python audio worker.
- `backend/src/infrastructure/queue/conversion-queue.ts`: Authoritative `pg-boss` queue orchestration.
- `backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts` & `workers/audio_worker/`: Isolated local Python worker with versioned JSON-RPC / stdio & file-descriptor contract, strict timeout, heartbeat reporting, and zero external network calls.

---

## 5. LOCAL PYTHON WORKER RUNTIME & ENVIRONMENT PRE-FLIGHT

### 5.1 Host Runtime Inspection
Verified on the local workstation prior to implementation:
- **Python Runtime:** `Python 3.14.2` (`C:\Users\juanc\AppData\Local\Programs\Python\Python314\python.exe`)
- **Package Manager:** `pip 25.3`
- **Pre-installed Relevant Packages:** `numpy 2.4.1`, `pydantic 2.12.5`, `pytest 9.0.2`
- **System `ffmpeg` Binary on PATH:** Not pre-installed on system `PATH` (`where.exe ffmpeg` returned not found).

### 5.2 Architectural Impact for `WS-AUDIO-01`
1. Because system `ffmpeg` is not pre-installed on `PATH`, the local Python audio-processing foundation must evaluate and document self-contained, permissive-licensed decoding options (`miniaudio` / `soundfile` / `pyav` / `imageio-ffmpeg` or pure-Python/C-extension decoders for MP3/WAV/FLAC/OGG) so the worker operates reliably out-of-the-box without requiring manual OS-level PATH configuration.
2. In `WS-AUDIO-01`, the Python worker foundation (`workers/audio_worker/`) will implement the versioned `v1` protocol (`PING`, `INSPECT_AND_VERIFY_AUDIO`), validating binary integrity, computing cryptographic `SHA-256`, parsing container headers/frames (MP3 ID3v2 + MPEG frame sync, WAV PCM headers, FLAC STREAMINFO, OGG pages, M4A atoms), extracting exact deterministic container metrics (`sampleRateHz`, `channels`, `durationSeconds`, `frameCount`, `bitrateKbps`), and writing derivative metadata without modifying the original source audio.

