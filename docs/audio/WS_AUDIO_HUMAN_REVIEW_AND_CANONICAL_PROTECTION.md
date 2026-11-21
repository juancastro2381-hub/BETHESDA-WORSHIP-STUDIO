# BETHESDA WORSHIP STUDIO
# WS-AUDIO — HUMAN REVIEW & CANONICAL CONTENT PROTECTION REPORT
## Gate 4 — Mandatory Human Review Workflow, Versioning Guarantees & Audit Trail

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Workstream:** Gate 4 — Human Review & Canonical Content Protection  
**Core Components:**  
- [`backend/src/application/audio-transcription-service.ts`](../../backend/src/application/audio-transcription-service.ts)  
- [`backend/src/interfaces/http/routes/audio.routes.ts`](../../backend/src/interfaces/http/routes/audio.routes.ts)  
- [`frontend/src/components/conversion/ConversionCenterWorkspace.tsx`](../../frontend/src/components/conversion/ConversionCenterWorkspace.tsx)

---

## 1. Mandatory Human Review Gate (Section 7)

Every audio-derived musical output enters PostgreSQL (`omr_proposals` + `omr_proposal_measures` + `omr_audit_history`) in state `DRAFT_READY` or `REVIEW_REQUIRED` (`reviewStatus = 'PENDING_REVIEW'`, `isAiDraft = true`).

### 1.1 Human Review Capabilities in `ConversionCenterWorkspace.tsx`
1. **Original Audio Playback:** Streamed directly from the immutable preserved asset via ticketed HTTP 206 Range streaming (`<audio controls>`).
2. **10-Stage DSP Analysis Summary:** Displays detected Key, BPM, Meter, confidence percentages, epistemic classifications (`DETECTED`, `ESTIMATED`, `AMBIGUOUS`, `UNSUPPORTED`), and polyphony/salience assessment.
3. **Time-Aligned Chord Timeline:** Interactive measure/beat timeline displaying recognized chords, timestamps (`startTimeSec`), and confidence.
4. **Target Format Preview & Instrument Selection:** Allows switching between `GUITAR` (6-string), `BASS` (4-string), `PIANO`, and `VOCAL`, and previewing/downloading `CHORD_PRO`, `MUSIC_XML`, `MIDI`, `TABLATURE`, and `LYRICS_ONLY` (or inspecting the exact `NOT_GENERATABLE` reason).
5. **Interactive Proposal Editing (`PATCH /api/v1/audio/:id/drafts/:proposalId`):** Allows editing Title, Key, BPM, Time Signature, Verified Lyrics, and proposed ChordPro content, recalculating `CanonicalMusicPayload` and all target formats while logging `UPDATE_MEASURE` in `omr_audit_history` and `AUDIO_DRAFT_UPDATED` in `audit_logs`.
6. **Review Decisions (`POST /api/v1/audio/:id/drafts/:proposalId/review` & `/approve`):**
   - **Approve & Publish (`/approve`):** Creates a new `song_versions` version (`versionNumber = latest + 1`) and transitions state to `APPROVED` (`COMMITTED`).
   - **Request Correction (`CORRECTION_REQUESTED`):** Keeps the draft in `REVIEW_REQUIRED` (`PENDING_REVIEW`) and records reviewer notes in `omr_audit_history`.
   - **Reject (`REJECTED`):** Transitions the draft to `REJECTED` (`CANCELLED` job) while leaving the canonical song and its existing versions 100% untouched.

---

## 2. Canonical Content Protection Invariants (Section 8)

1. **Zero Automatic Overwrite:** Uploading, analyzing, or editing an audio draft never modifies `songs` or `song_versions`.
2. **Non-Destructive Version Creation on Approval:** Approving a draft inserts a new row in `song_versions` (`v2`, `v3`, etc.); all historical canonical versions remain stored in `song_versions` and selectable in the Digital Music Stand.
3. **Cross-Song Association Guard:** `AudioTranscriptionService.getDraftById()` and `approveAndPublishDraft()` reject any attempt to access or approve a draft across mismatched `audioId` or `songId` boundaries (`ValidationError` HTTP 400).
4. **RBAC Enforcement:** Only `WORSHIP_LEADER`, `ADMIN`, and `SUPER_ADMIN` (`songs:update_draft`) can review or approve drafts; `MUSICIAN` and `VIEWER` are blocked with HTTP `403 Forbidden`.
5. **Complete Approval Audit Record:** Every approval records `approvedByUserId`, `approvedAt`, `sourceAudioAssetId`, `sourceAudioSha256`, `analysisVersion`, `transcriptionVersion`, `approvedSongVersionId`, `approvedVersionNumber`, and `changesMadeDuringReview` in both `omr_audit_history` (`COMMIT_TO_SONG`) and `audit_logs` (`AUDIO_DRAFT_APPROVED_AND_PUBLISHED`).
