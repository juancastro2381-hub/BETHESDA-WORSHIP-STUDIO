# BETHESDA WORSHIP STUDIO
# AUDIO ROADMAP & ACCEPTANCE MATRIX
## Scope 1C — Sequential Implementation Plan & Governance Gates

**Document Version:** 2.0.0  
**Directive:** Scope 1C (Sequential Implementation | Local Python Processing | Human Review Required)  
**Gate 1 Status:** **CONDITIONAL PASS** *(Automated/Technical Controls Verified; 10 Manual Checklist Items `PENDING` Project Owner Execution)*  
**Branch:** `feature/phase-1a-core-foundation`  

---

## 1. Master Scope 1C Implementation Roadmap

```
+-----------------------------------------------------------------------------------+
| WS-AUDIO-01: INGESTION, INTEGRITY & PRESERVATION FOUNDATION                       |
| Status: TECHNICAL REMEDIATION COMPLETE — GATE 1 CONDITIONAL PASS                  |
| - Fail-closed binary validation (MP3 w/ & w/o ID3, WAV, FLAC, OGG, M4A, AAC, WebM)|
| - Pre-stream & download SHA-256 integrity on single open FileHandle               |
| - Atomic .tmp -> datasync -> rename -> chmod 0o444 storage + orphan rollback      |
| - Consistency reconciliation (AudioService.reconcileStorageConsistency)           |
| - Real-time user verification & stream ticket revocation on ?ticket= and Bearer   |
| - Anti-IDOR delete authorization & zero canonical musical fabrication             |
| - Local Python 3 worker integrated into AudioService (upload & POST /audio/:id/verify)|
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
                      [ MANDATORY ACCEPTANCE GATE 1 ]
                      * Technical & Automated Controls: PASS
                      * Prod Storage Volume Durability: NOT PRODUCTION VERIFIED
                      * Manual Checklist (10 Scenarios): PENDING PROJECT OWNER
                                         │
                                         ▼  (GATED — DO NOT PROCEED)
+-----------------------------------------------------------------------------------+
| WS-AUDIO-02: HARMONIC ANALYSIS & CHORDPRO LEAD SHEET DRAFTS                       |
| Status: GATED / UNIMPLEMENTED PENDING GATE 1 CLOSURE                              |
| - Offline tempo/BPM, meter & key estimation                                       |
| - Time-aligned chord recognition & editable ChordPro drafts                       |
| - Mandatory human review before saving/publishing                                 |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
                      [ MANDATORY ACCEPTANCE GATE 2 ]
                                         │
                                         ▼  (GATED — DO NOT PROCEED)
+-----------------------------------------------------------------------------------+
| WS-AUDIO-03: POLYPHONIC PITCH EXTRACTION & MUSICAL SCORE DRAFTS                   |
| Status: GATED / UNIMPLEMENTED PENDING GATE 2 CLOSURE                              |
| - Offline polyphonic pitch / note extraction & draft MusicXML/MIDI/tab            |
| - Mandatory human review gate                                                     |
+-----------------------------------------------------------------------------------+
```

---

## 2. Gate 1 Acceptance Matrix Summary (WS-AUDIO-01)

Detailed line-by-line traceability appears in [`docs/audio/WS_AUDIO_01_GATE_1_FINAL_ACCEPTANCE_MATRIX.md`](./WS_AUDIO_01_GATE_1_FINAL_ACCEPTANCE_MATRIX.md).

| Code | Requirement | Verification Mechanism | Status |
| :--- | :--- | :--- | :--- |
| **G1-REQ-01** | Multi-format container detection (MP3 w/ & w/o ID3, WAV, FLAC, OGG, M4A, AAC) | `audio-signature-validator.ts`, `signature_inspector.py`, `test_worker.py` | **PASS** |
| **G1-REQ-02** | Fail-closed protection against spoofed/corrupt payloads | `audio-infrastructure.test.ts`, `audio-preservation-and-worker.test.ts` | **PASS** |
| **G1-REQ-03** | Atomic ingestion, SHA-256 persistence (`audio_assets.checksum_sha256`), `0o444` read-only file & orphan rollback | `LocalFileSystemAudioStorageProvider.save()`, `AudioService.uploadAudio()` | **PASS** |
| **G1-REQ-04** | Pre-stream & download SHA-256 integrity (`400 VALIDATION_ERROR` on tampering, `404 NOT_FOUND` if missing) | `LocalFileSystemAudioStorageProvider.getStream()`, Tests #8, #12, #13, #14 | **PASS** |
| **G1-REQ-05** | Storage consistency audit & reconciliation | `AudioService.reconcileStorageConsistency()`, Test #16 | **PASS** |
| **G1-REQ-06** | Production persistent volume durability | Audited `docker-compose.yml` (dev Postgres only; no prod storage volume manifest) | **NOT PRODUCTION VERIFIED** |
| **G1-REQ-07** | Real-time active user verification & immediate stream ticket revocation | `verifyActiveAuthorizedStreamUser()`, `revokeTicketsForUser()`, Test #15 | **PASS** |
| **G1-REQ-08** | Anti-IDOR deletion protection (`403`) & zero canonical fabrication (`null` musical fields) | `audio.routes.ts`, `AudioIngestionAdapter`, Tests #5, #9 | **PASS** |
| **G1-REQ-09** | Integrated offline Python worker (`verifyWithWorker` & `/audio/:id/verify`), memory bounds & `AbortSignal` | `PythonAudioWorkerBridge`, `workers/audio_worker/`, `test_worker.py` (15), Test #17 | **PASS** |
| **G1-REQ-10** | Open-source & bundled static FFmpeg GPLv3 license review | `requirements.txt` & Remediation Report §3 | **PASS (WITH DISTRIBUTION NOTICE)** |
| **G1-REQ-11** | Full regression safety across backend & frontend | Backend typecheck (`0`), Frontend typecheck (`0`), `41` audio/conv, `60` doc/omr, `610` frontend | **PASS** |
| **G1-REQ-12** | 10-procedure manual E2E verification (`MC-01`..`MC-10`) | [`WS_AUDIO_01_MANUAL_ACCEPTANCE_CHECKLIST.md`](./WS_AUDIO_01_MANUAL_ACCEPTANCE_CHECKLIST.md) | **PENDING PROJECT OWNER MANUAL EXECUTION** |

---

## 3. Governance & Sequential Boundary

1. **Strict Gate Enforcement**: WS-AUDIO-02 and WS-AUDIO-03 remain unimplemented and must NOT begin until the Project Owner executes `WS_AUDIO_01_MANUAL_ACCEPTANCE_CHECKLIST.md` and approves Gate 1.
2. **Canonical Music Protection**: Human-authored songs remain isolated from raw audio files and experimental drafts.
3. **Human Review Mandate**: All future WS-AUDIO-02/03 transcription outputs must enter review states (`DRAFT_REQUIRES_HUMAN_REVIEW`) before catalog approval.
