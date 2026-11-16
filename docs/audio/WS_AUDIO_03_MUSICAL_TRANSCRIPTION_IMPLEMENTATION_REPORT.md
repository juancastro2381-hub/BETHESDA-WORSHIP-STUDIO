# BETHESDA WORSHIP STUDIO
# WS-AUDIO-03 — MUSICAL TRANSCRIPTION IMPLEMENTATION REPORT
## Verified Draft Generation for ChordPro, MusicXML 4.0, MIDI, Tablature & Lyrics

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Workstream:** `WS-AUDIO-03` (Gate 3)  
**Core Service:** [`backend/src/application/audio-transcription-service.ts`](../../backend/src/application/audio-transcription-service.ts)  
**Transcription Version:** `ws-audio-03-v1.0`

---

## 1. Executive Summary

`WS-AUDIO-03` transforms verified `WS-AUDIO-02` acoustic analysis outputs into structured, reviewable musical drafts (`CanonicalMusicPayload` + per-target serialized artifacts) while enforcing the **Zero-Fabrication Invariant** across all 5 output formats (`CHORD_PRO`, `MUSIC_XML`, `MIDI`, `TABLATURE`, and `LYRICS_ONLY`).

Every generated output is persisted in PostgreSQL (`omr_proposals`, `omr_proposal_measures`, `omr_audit_history`) with `isAiDraft: true` and `reviewStatus: 'PENDING_REVIEW'` (`workflowState: 'DRAFT_READY' | 'REVIEW_REQUIRED'`).

---

## 2. Target Format Eligibility & Generation Rules (Section 6)

| Target Format | Generation Condition | Serializer / Gatekeeper | When Evidence Is Insufficient |
| :--- | :--- | :--- | :--- |
| **A. ChordPro / Lead Sheet (`CHORD_PRO`)** | `totalChordsDetected > 0` or verified lyrics provided. Includes `{title}`, `{key}`, `{tempo}`, `{time}`, provenance/confidence comments, section markers (`{start_of_verse}`, `{start_of_chorus}`), and measure-aligned chords. | `CanonicalToChordProSerializer.serialize()` | Marked `NOT_GENERATABLE` (`generatable: false`, `content: null`) with explanation when recording is silent/non-harmonic. |
| **B. MusicXML 4.0 (`MUSIC_XML`)** | `totalChordsDetected > 0` or `totalNotesDetected > 0`. Preserves `divisions=480`, `<key>`, `<time>`, `<direction><sound tempo="..."/></direction>`, `<harmony>` chord symbols, and verified `<note>` / `<rest>` events. Validated structurally (`<?xml`, `<score-partwise version="4.0">`, `<measure`). | `CanonicalToMusicXmlSerializer.serialize()` | Marked `NOT_GENERATABLE` when neither chords nor notes are supported; marked `REVIEW_REQUIRED` when generated as a harmonic lead sheet without melodic notes. |
| **C. Standard MIDI File (`MIDI`)** | **Strictly requires** `totalNotesDetected > 0` **AND** `MidiExportGatekeeper.isEligible(payload).eligible === true` (complete onset timing, positive durations, MIDI pitch `0..127`). | `MidiExportGatekeeper` + `CanonicalToMidiSerializer.serialize()` | Marked `NOT_GENERATABLE` (`generatable: false`, `content: null`) for polyphonic full-band mixes or chord-only lead sheets. Never invents notes or timing. |
| **D. Tablature (`TABLATURE`)** | **Strictly requires** `totalNotesDetected > 0` **AND** a supported stringed instrument (`GUITAR` 6-string or `BASS` 4-string) with playable fretboard positions calculated via `TablatureCalculator`. | `CanonicalToTablatureSerializer.serialize()` | Marked `NOT_GENERATABLE` (`generatable: false`, `content: null`) when `totalNotesDetected === 0` or when `PIANO` / `VOCAL` is selected. Never fabricates guitar/bass fret positions from chord symbols alone. |
| **E. Lyrics Only (`LYRICS_ONLY`)** | Requires explicit verified lyrics supplied or confirmed by a human reviewer (`verifiedLyrics` non-empty). | `CanonicalToLyricsSerializer.serialize()` | Marked `REVIEW_REQUIRED` (`generatable: false`, `content: null`) by default with explanation that the acoustic DSP engine does not fabricate vocal lyrics. |

---

## 3. REST API Contracts (`backend/src/interfaces/http/routes/audio.routes.ts`)

1. **`POST /api/v1/audio/:id/analyze`** (`songs:create`):
   - Runs `WS-AUDIO-02` + `WS-AUDIO-03`, creates `background_jobs` (`AUDIO_TRANSCRIPTION`) and `omr_proposals` (`PENDING_REVIEW`), and returns `201 Created` with `AudioDraftProposalDTO`.
2. **`GET /api/v1/audio/:id/drafts`** & **`GET /api/v1/songs/:songId/audio-drafts`** (`songs:read`):
   - Lists all audio-derived drafts for an audio asset or catalog song.
3. **`GET /api/v1/audio/:id/drafts/:proposalId/export/:format`** (`songs:read`):
   - Exports a specific target artifact (`CHORD_PRO`, `MUSIC_XML`, `MIDI`, `TABLATURE`, `LYRICS_ONLY`) when `generatable === true`, or returns `400 VALIDATION_ERROR` with the exact musical blocking reason when `NOT_GENERATABLE`.

---

## 4. Persisted Output Verification on Real Recording (`El Señor Esta en Este Lugar.mp3`)

Verified directly against persisted `omr_proposals` row `a99f9a24-65f9-46d9-bb46-eb2f5b85e622` (`audio_assets.id = 098bf5d6-67d2-4442-91b6-b7e36b1c8d11`, `song_id = d8f1d90f-0ec4-4053-b29f-1e73ccddb618`):

| Target Format | Persisted Status | Generatable | Verified Content & Structural Validation | Epistemic Limitation |
| :--- | :--- | :---: | :--- | :--- |
| **`CHORD_PRO`** | `DRAFT_READY` | `true` (`63.1%`) | `1,610` chars; `{title}`, `{key: Em}`, `{tempo: 70}`, `{time: 4/4}`, confidence comments, `13` sections, `168` bracketed chord markers, `0` fabricated lyrics (`chordProHasLyrics: false`). | Uncertain chords (`102` `ESTIMATED`, `1` `AMBIGUOUS`) flagged in timeline UI with confidence % and alternatives. |
| **`MUSIC_XML`** | `REVIEW_REQUIRED` | `true` (`63.1%`) | `28,411` chars; valid XML parsed by `xml.etree.ElementTree` (`<score-partwise version="4.0">`, `1` part, `104` `<measure>`, `168` `<harmony>`, `0` `<pitch>`, `0` `<rest>`). | Structural harmonic lead-sheet MusicXML only; explicitly distinguished in UI from a traditional melodic staff score. |
| **`MIDI`** | `NOT_GENERATABLE` | `false` (`0%`) | `content: null` (`0` bytes). | Full-band polyphonic mix (`polyphonyIndex = 0.748`, `monophonicSalience = 0.520`, `totalNotesDetected = 0`); blocked by Zero Fabrication. |
| **`TABLATURE`** | `NOT_GENERATABLE` | `false` (`0%`) | `content: null` (`0` bytes). | No verified instrument-specific melodic/bass note events; fret positions are never invented from chord names. |
| **`LYRICS_ONLY`** | `REVIEW_REQUIRED` | `false` (`0%`) | `content: null` (`0` bytes). | Audio DSP never invents vocal lyrics; enabled once reviewer supplies verified lyrics in Human Review. |

---

## 5. Post-Implementation UI Capability Consistency Fix

`FormatCapabilitiesEvaluator.getAudioWorkflowCapabilities()` (`frontend/src/core/conversion/format-capabilities.ts`) was added and integrated into both **Section B (Detection & Capabilities)** and **Section C (Target Format)** of `ConversionCenterWorkspace.tsx`, eliminating legacy `PLANNED_PHASE_2B` / `DEFERRED_PHASE` labels on audio recordings and projecting truthful states (`IMPLEMENTED`, `AUDIO_PRESERVED`, `ANALYSIS_RUNNING`, `DRAFT_READY`, `REVIEW_REQUIRED`, `APPROVED`, `NOT_GENERATABLE`, `FAILED`), along with automatic rehydration of preserved audio assets and proposals across page reloads.
