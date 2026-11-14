# BETHESDA WORSHIP STUDIO
# AUDIO ROADMAP & ACCEPTANCE MATRIX
## Scope 1C — Sequential Implementation Plan & Governance Gates

**Document Version:** 1.0.0  
**Directive:** Scope 1C (Sequential Implementation \| Local Python Processing \| Human Review Required)  
**Date:** November 2026  
**Status:** GATE 1 COMPLETED — PENDING PROJECT OWNER SIGN-OFF  
**Branch:** `feature/phase-1a-core-foundation`  
**Accepted Baseline Commit:** `35e959d05a7fccd5e6d0558ad80da2730996f7c1`

---

## 1. Master Scope 1C Implementation Roadmap

The Scope 1C directive authorizes the implementation of local audio processing capabilities for Bethesda Worship Studio across three strictly sequential workstreams:

```
+-----------------------------------------------------------------------------------+
| WS-AUDIO-01: INGESTION, INTEGRITY & PRESERVATION FOUNDATION                       |
| Status: COMPLETED & VERIFIED                                                      |
| - Fail-closed multi-format binary inspection (MP3, WAV, FLAC, OGG, M4A, AAC)      |
| - Cryptographic SHA-256 checksum & download tamper detection                      |
| - Local Python 3 audio worker with static FFmpeg bindings (stdin/stdout IPC)      |
| - Durable local storage & catalog song linkage                                    |
| - Stage music stand playback via AudioPlayerBar                                   |
| - Anti-IDOR ownership isolation & real-time active user checks                    |
| - Zero Fabrication Invariant (no fake chord/score generation)                     |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
                      [ MANDATORY ACCEPTANCE GATE 1 ]
                      * Formal Project Owner Sign-Off Required
                      * Code & Regression Test Acceptance
                                         │
                                         ▼  (GATED — DO NOT PROCEED)
+-----------------------------------------------------------------------------------+
| WS-AUDIO-02: HARMONIC ANALYSIS & CHORDPRO LEAD SHEET DRAFTS                       |
| Status: GATED / BLOCKED PENDING GATE 1 ACCEPTANCE                                 |
| - Offline tempo/BPM estimation and meter tracking                                 |
| - Tonal center and key signature estimation                                       |
| - Time-aligned chord recognition (major, minor, 7th, suspensions)                 |
| - Generation of editable ChordPro lead sheet DRAFTS                               |
| - Mandatory human review and correction interface before saving to catalog       |
| - Strict preservation of canonical repertoire (zero auto-overwrite)               |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
                      [ MANDATORY ACCEPTANCE GATE 2 ]
                      * Formal Project Owner Sign-Off Required
                      * Harmonic Accuracy & Review Workflow Verification
                                         │
                                         ▼  (GATED — DO NOT PROCEED)
+-----------------------------------------------------------------------------------+
| WS-AUDIO-03: POLYPHONIC PITCH EXTRACTION & MUSICAL SCORE DRAFTS                   |
| Status: GATED / BLOCKED PENDING GATE 2 ACCEPTANCE                                 |
| - Local neural / DSP polyphonic note transcription                                |
| - Quantization, voice-leading, and MusicXML / LilyPond generation                 |
| - Draft score review workbench with side-by-side audio playback                   |
| - Final human approval barrier before publishing to church music stand            |
+-----------------------------------------------------------------------------------+
```

---

## 2. Gate 1 Acceptance Matrix (WS-AUDIO-01)

| Requirement Code | Requirement Description | Verification Mechanism | Acceptance Criteria | Gate 1 Status |
| :--- | :--- | :--- | :--- | :--- |
| **G1-REQ-01** | **Multi-Format Container Validation** | `audio-signature-validator.ts` & `signature_inspector.py` | Detects MP3 (ID3v2 & raw sync frames), WAV, FLAC, OGG, M4A (`ftyp`), and AAC. | **PASS** |
| **G1-REQ-02** | **Fail-Closed Protection** | Automated tests in `audio-infrastructure.test.ts` & `audio-preservation-and-worker.test.ts` | Disguised text/HTML/binaries renamed to `.mp3` are strictly rejected with 400. | **PASS** |
| **G1-REQ-03** | **SHA-256 Hashing at Ingestion** | `AudioService.saveAudio` | Cryptographic SHA-256 digest calculated and persisted in `song_audio_assets`. | **PASS** |
| **G1-REQ-04** | **Cryptographic Tamper Detection** | `AudioService.downloadAudio` | Stored file SHA-256 re-verified on download; modified file triggers 500 `IntegrityError`. | **PASS** |
| **G1-REQ-05** | **Zero Cloud Leakage** | Architectural audit of `workers/audio_worker/` | Zero HTTP client dependencies, zero outbound network sockets, 100% offline local runtime. | **PASS** |
| **G1-REQ-06** | **Local Python Subprocess IPC** | `PythonAudioWorkerBridge.ts` & `main.py` | Stdin/stdout single-line JSON IPC protocol v1 with health check (`PING`) and bounded timeout. | **PASS** |
| **G1-REQ-07** | **Static FFmpeg Bundling** | `imageio-ffmpeg` in Python venv | Telemetry extraction and PCM decode verification without system PATH dependency. | **PASS** |
| **G1-REQ-08** | **Stage Music Stand Integration** | `ConversionCenterWorkspace.tsx` & `AudioPlayerBar.tsx` | Reference recordings can be linked to songs and played with range streaming in music stand. | **PASS** |
| **G1-REQ-09** | **Anti-IDOR Deletion Protection** | `DELETE /api/v1/audio/:id` route guard | Non-privileged musicians cannot delete audio assets uploaded by other users (403). | **PASS** |
| **G1-REQ-10** | **Real-Time Active User Check** | `authGuard.requirePermission(..., true)` | Revoked or deactivated users are blocked from streaming audio in real-time. | **PASS** |
| **G1-REQ-11** | **Zero Fabrication Invariant** | `AudioIngestionAdapter` | Returns `null` for `canonicalPayload`, `defaultKey`, `defaultBpm`, and `timeSignature`. | **PASS** |
| **G1-REQ-12** | **Regression Safety** | Backend and frontend full test suites | 0 regressions across existing CAS, OMR, Setlists, Auth, and Stage PWA modules. | **PASS** |

---

## 3. Scope Gate Invariants & Governance Rules

1. **Strict Sequential Execution**:
   - Implementation of **WS-AUDIO-02** is forbidden until the Project Owner reviews and accepts Gate 1.
   - Implementation of **WS-AUDIO-03** is forbidden until the Project Owner reviews and accepts Gate 2.
2. **Canonical Song Protection**:
   - Audio files are stored as separate source assets/attachments.
   - Canonical songs are never overwritten or altered automatically by any audio process.
3. **Mandatory Human Review**:
   - All future chord charts or lead sheets produced by WS-AUDIO-02 must be classified as `DRAFT_REQUIRES_HUMAN_REVIEW`.
   - The system shall never publish an audio-derived chord chart to the live music stand without explicit human approval.
4. **Local Hardware Sustainability**:
   - Worker processes must respect machine resource boundaries, terminating gracefully and leaving no orphaned processes or disk leaks.

---

## 4. Workstream 2 (WS-AUDIO-02) Advance Requirements

Upon Gate 1 sign-off, WS-AUDIO-02 will implement:
- **Harmonic Analysis Engine**:
  - Python-based harmonic estimation (chroma feature extraction, chord template matching).
  - Beat tracking and tempo estimation (BPM and meter detection).
  - Key detection (major/minor tonic estimation).
- **ChordPro Draft Generator**:
  - Serializing detected chords into valid ChordPro format: `[C] [G] [Am] [F]`.
  - Associating time-aligned chords with rehearsal segments.
- **Human Correction Workbench**:
  - Side-by-side editor showing detected chords against playback position.
  - Ability for worship leader to edit, transpose, and verify before saving to song catalog.

---

## 5. Gate 1 Formal Status Declaration

**Current Status:** **GATE 1 READY FOR PROJECT OWNER REVIEW (PASS)**  
All WS-AUDIO-01 deliverables, tests, documentation, and safeguards have been implemented and verified. The development team is halted at Gate 1 awaiting explicit authorization before initiating WS-AUDIO-02.
