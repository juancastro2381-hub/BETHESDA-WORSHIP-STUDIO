# BETHESDA WORSHIP STUDIO
# AUDIO-TO-MUSIC CONVERSION, DIGITAL MUSIC STAND INTEGRATION & HUMAN REVIEW ARCHITECTURE
## Scope 1C — Pre-Implementation Forensic Audit & End-to-End Architecture Specification

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Baseline Commit:** `bb6cb3c343d55b6459729472ff8a35ac8eee40f3`  
**Authorized Scope:** Option 1C (`WS-AUDIO-01` + `WS-AUDIO-02` + `WS-AUDIO-03` + Mandatory Human Review + Digital Music Stand Integration)

---

## 1. Mandatory Pre-Implementation Forensic Audit (Section 3)

### 1.1 Git & Working Tree Preflight (Section 3.A)
- **Active Branch:** `feature/phase-1a-core-foundation`
- **Local `HEAD` & Remote `origin/feature/phase-1a-core-foundation`:** `bb6cb3c343d55b6459729472ff8a35ac8eee40f3`
- **Working Tree Status:** Clean (`git status -s` empty prior to implementation).

### 1.2 Trace of the Exact Manual Test MP3 & Database State (Section 3.C)
Forensic inspection of PostgreSQL (`audio_assets`, `songs`, `song_versions`) and `backend/storage/audio/` identified the exact recording uploaded by the Project Owner:

| Attribute | Recorded Value |
| :--- | :--- |
| **`audio_assets.id`** | `a294b5b5-214d-4966-b9e0-d2205e53ca40` |
| **`audio_assets.song_id`** | `53057f4b-d323-4da3-af04-76a4bd103a6f` (`WORSHIP_TEST_CMB_AZUL-DIVIDIDO`) |
| **`title` / `filename`** | `El Señor Esta en Este Lugar` / `El Señor Esta en Este Lugar.mp3` |
| **`storage_path`** | `4762e3ee-1edd-42e9-84b9-e9c9fbfa2270.mp3` |
| **`file_size_bytes`** | `8,532,773` bytes (`8.14 MiB`) |
| **`checksum_sha256`** | `df8a0a15ea5b59911c409dc90618758b84df290dbbedec65fa1c2ad0444c2887` |
| **Container & Stream Telemetry** | `MP3` (`ID3v2` 138 bytes), `44,100 Hz`, Stereo (`2` channels), `192 kbps`, `13,610` MPEG frames, `355,527 ms` (`5m 55.5s`), `pcmDecodeVerified: true` (`imageio-ffmpeg`) |

### 1.3 Root-Cause Analysis of the Song Association & Digital Music Stand Discrepancy (Section 3.D)
**Observed Problem:**
1. Preservation succeeded and displayed destination song `WORSHIP_TEST_CMB_AZUL-DIVIDIDO`.
2. Clicking `"🎵 Abrir Canción en el Atril Digital"` opened `"Sublime Gracia (Golden G Major)"` with only 2 measures.

**Confirmed Root Causes:**
1. **Unwired Navigation Handler in `ConversionCenterWorkspace.tsx` (Line 1143):**
   - The button `"🎵 Abrir Canción en el Atril Digital"` was bound to `onClick={onClose}`, which only executed `setShowConversionCenter(false)` in `MusicalWorkspace.tsx` (line 609).
   - It never invoked `client.getSong(selectedSongId)` or `selectPersistedSong()` to load the target song into `MusicalWorkspace`.
2. **Stale Initial Preset in `use-musical-workspace.ts` (Lines 83–88):**
   - `useMusicalWorkspace()` initializes `activeSong` to `GOLDEN_SCENARIO_PRESETS['SCENARIO_A'].canonicalSongFactory()`, which is the 2-measure in-memory fixture `"Sublime Gracia (Golden G Major)"` with `persistedMeta = null`.
   - When `ConversionCenterWorkspace` closed without loading the target catalog song, `MusicalWorkspace` simply revealed the untouched initial preset `"Sublime Gracia (Golden G Major)"`.
   - Furthermore, because `persistedMeta?.songId` was `undefined` on that preset, `AudioPlayerBar` (`MusicalWorkspace.tsx:647`) received `songId={undefined}` and rendered nothing (`return null`).
3. **Implicit Default Dropdown Selection in `ConversionCenterWorkspace.tsx` (Lines 177–179):**
   - On mount, `ConversionCenterWorkspace` fetched `client.listSongs({ limit: 50 })` (ordered by `updated_at DESC`) and automatically set `selectedSongId = songs[0].id` (`WORSHIP_TEST_CMB_AZUL-DIVIDIDO`), without auto-matching the uploaded filename against catalog titles or offering an explicit `"Crear nueva canción en borrador desde este audio"` option.

### 1.4 Inventory of Existing vs Missing Components (Section 3.B & 3.E)

| Subsystem | Existing Implementation Status | Missing / Required for Scope 1C |
| :--- | :--- | :--- |
| **WS-AUDIO-01 (Ingestion, Integrity & Streaming)** | **COMPLETE:** `audio-signature-validator.ts`, `LocalFileSystemAudioStorageProvider`, `AudioService`, `StreamTicketService`, `AudioPlayerBar.tsx`, startup/admin recovery. | Explicit song association verification, prevention of silent auto-association to unrelated songs, and option to create a dedicated catalog song or associate with an existing song. |
| **WS-AUDIO-02 (Python Audio Analysis)** | **PARTIAL (Inspection Only):** `workers/audio_worker/main.py` and `audio_inspector.py` implement `PING` and `INSPECT_AND_VERIFY_AUDIO` (container headers, SHA-256, FFmpeg PCM decode probe). | **MISSING:** `ANALYZE_AUDIO` command and `audio_analyzer.py` implementing the 10 sequential DSP stages: stereo/mono inspection, resampling, HPSS/preprocessing, tempo/beat tracking with confidence, Krumhansl-Kessler/Temperley key estimation with confidence, meter estimation, beat-synchronous chroma, chord recognition & timeline alignment, and pitch/polyphony confidence analysis. |
| **WS-AUDIO-03 (Musical Transcription)** | **PARTIAL (Serializers Exist):** `CanonicalToChordProSerializer`, `CanonicalToMidiSerializer` (`MidiExportGatekeeper`), `CanonicalToMusicXmlSerializer`, `CanonicalToTablatureSerializer`, `CanonicalToLyricsSerializer`. | **MISSING:** Audio-analysis-to-`CanonicalMusicPayload` draft builder and multi-format transcription orchestrator that produces verified `CHORD_PRO`, `MUSIC_XML`, `MIDI` (only when note events & timing are supported), `TABLATURE` (only for Guitar/Bass when note events are supported), and `LYRICS_ONLY` (only when verified lyrics are provided), marking unsupported targets as `NOT_GENERATABLE` or `REVIEW_REQUIRED`. |
| **Human Review & Canonical Protection** | **PARTIAL (OMR Review Exists):** `omr_proposals`, `omr_proposal_measures`, `omr_audit_history`, and `song_versions` exist in PostgreSQL. | **MISSING:** Audio draft review lifecycle (`DRAFT_READY` / `REVIEW_REQUIRED` -> `APPROVED` / `REJECTED`), interactive review UI in `ConversionCenterWorkspace.tsx` (audio player, analysis telemetry, chord timeline, editable ChordPro/metadata/lyrics, format previews, approve/reject/request-correction actions), and non-destructive version creation on approval. |
| **Digital Music Stand Integration** | **PARTIAL:** `MusicalWorkspace.tsx` renders `MusicalScoreRenderer`, `VisualDocumentStand`, and `AudioPlayerBar`. | **DEFECTIVE / INCOMPLETE:** Fix `"Abrir Canción en el Atril Digital"` to load the exact song + version + audio asset; update `computeFormatDefinitions()` so chord lead sheets (`hasChords`) can be read in `Cifrado con Letra` and `Partitura` (harmonic lead sheet); add version selector and provenance/approval badges in `SongHeader.tsx`. |

---

## 2. End-to-End Architecture & Sequential State Machine

### 2.1 Audio Processing & Governance States (Section 10)
The system enforces backend-derived status transitions:
1. `AUDIO_PRESERVED`: Original binary audio verified (SHA-256) and stored immutably in `audio_assets`.
2. `ANALYSIS_QUEUED`: Analysis job registered in `background_jobs` (`job_type = 'AUDIO_TRANSCRIPTION'`).
3. `ANALYSIS_RUNNING`: Local Python worker (`workers/audio_worker/main.py`) executing the 10-stage DSP pipeline (`ANALYZE_AUDIO`).
4. `ANALYSIS_COMPLETED` / `ANALYSIS_PARTIAL`: Harmonic, tempo, key, meter, and pitch/polyphony analysis persisted with per-feature confidence and `DETECTED` / `ESTIMATED` / `AMBIGUOUS` / `UNSUPPORTED` classifications.
5. `TRANSCRIPTION_RUNNING`: Building `CanonicalMusicPayload` draft and evaluating target format eligibility (`CHORD_PRO`, `MUSIC_XML`, `MIDI`, `TABLATURE`, `LYRICS_ONLY`).
6. `DRAFT_READY` / `REVIEW_REQUIRED`: Draft proposal persisted in `omr_proposals` (`review_status = 'PENDING_REVIEW'`, `is_ai_draft = true`) awaiting mandatory human review.
7. `APPROVED`: Human reviewer approved the draft; a new immutable `song_versions` record is created on the target song (preserving all prior canonical versions) and audited in `omr_audit_history` + `audit_logs`.
8. `REJECTED`: Human reviewer rejected the draft; draft is marked `REJECTED` and canonical song remains untouched.
9. `FAILED`: Processing failed; actionable diagnostic message recorded.

### 2.2 Canonical Content Protection Invariant (Section 8)
- Audio preservation (`WS-AUDIO-01`) only inserts into `audio_assets`.
- Audio analysis and transcription (`WS-AUDIO-02` & `WS-AUDIO-03`) store drafts in `omr_proposals.raw_payload` and `omr_proposal_measures` linked to `audio_assets.id` and `songs.id`.
- Existing `songs` and `song_versions` rows are **never modified** during upload, analysis, transcription, or draft editing.
- Only an explicit human approval (`POST /api/v1/audio/:id/drafts/:proposalId/approve` by `WORSHIP_LEADER`, `ADMIN`, or `SUPER_ADMIN`) creates a **new** `song_versions` row (`version_number = latest + 1`), keeping previous versions intact and selectable in the Digital Music Stand.
