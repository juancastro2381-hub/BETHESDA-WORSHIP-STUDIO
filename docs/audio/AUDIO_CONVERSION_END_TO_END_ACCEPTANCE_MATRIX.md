# BETHESDA WORSHIP STUDIO
# AUDIO CONVERSION END-TO-END ACCEPTANCE MATRIX (SCOPE 1C)
## Gates 1 to 6 Verification & Manual Acceptance Scenarios (`MC-01` to `MC-15`)

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Scope:** Authorized Option 1C (`WS-AUDIO-01` + `WS-AUDIO-02` + `WS-AUDIO-03` + Human Review + Digital Music Stand Integration)

---

## 1. Sequential Gate Verdicts (Section 11 & 17)

| Gate | Workstream / Scope | Automated Verification Evidence | Gate Verdict |
| :--- | :--- | :--- | :--- |
| **GATE 1** | **WS-AUDIO-01** — Ingestion, binary signature inspection, SHA-256 integrity, durable preservation, explicit song association, HTTP 206 Range streaming, and recovery governance | `audio-infrastructure.test.ts` (`10/10`); `audio-preservation-and-worker.test.ts` (`Criterios 1–22`) | **PASS** |
| **GATE 2** | **WS-AUDIO-02** — Out-of-process Python 10-stage DSP audio analysis (`audio_analyzer.py`, `ANALYZE_AUDIO`) with tempo, key, meter, chroma, chord timeline, and monophonic/polyphonic salience evaluation | `workers/audio_worker/tests/test_worker.py` (`18/18` passed); `audio-preservation-and-worker.test.ts` (`Criterio 23`) | **PASS** |
| **GATE 3** | **WS-AUDIO-03** — Musical transcription to reviewable drafts (`CHORD_PRO`, `MUSIC_XML`, `MIDI`, `TABLATURE`, `LYRICS_ONLY`) with strict `NOT_GENERATABLE` / `REVIEW_REQUIRED` gating | `audio-preservation-and-worker.test.ts` (`Criterio 23.1–23.4`) | **PASS** |
| **GATE 4** | **HUMAN REVIEW & CANONICAL PROTECTION** — Draft editing (`PATCH`), rejection (`REJECTED`), correction request (`CORRECTION_REQUESTED`), non-destructive approval (`song_versions` `vN+1`), cross-song guard, RBAC, and audit trail | `audio-preservation-and-worker.test.ts` (`Criterio 23.2–23.5`) | **PASS** |
| **GATE 5** | **DIGITAL MUSIC STAND INTEGRATION** — Direct loading of associated song & approved version (`handleOpenPersistedSongInStand`), version switching, `AudioPlayerBar` playback, and reading format governance without unrelated fallback | `reading-format-selector.test.ts`; `audio-preservation-and-worker.test.ts` (`Criterio 23.4–23.5`) | **PASS** |
| **GATE 6** | **END-TO-END ACCEPTANCE** — Complete pipeline validated on synthetic monophonic/polyphonic audio and real MP3 recording (`El Señor Esta en Este Lugar.mp3`) | All Python (`18/18`), Backend, Frontend, and TypeScript checks (`0` errors) | **READY FOR PROJECT OWNER MANUAL SIGN-OFF** |

---

## 2. Manual Acceptance Scenarios (`MC-01` to `MC-15` — Section 12)

| ID | Manual Acceptance Scenario | Implementation & Verification Path | Automated / Live Status |
| :--- | :--- | :--- | :--- |
| **MC-01** | Upload a valid MP3 and preserve the original | `POST /api/v1/songs/:songId/audio` (`ConversionCenterWorkspace` Paso 1) | **VERIFIED (`PASS`)** |
| **MC-02** | Confirm checksum and stored audio integrity | Streaming SHA-256 verification on upload, download, stream, and `POST /api/v1/audio/:id/verify` | **VERIFIED (`PASS`)** |
| **MC-03** | Associate the audio with the intended catalog song | Explicit catalog song selector + `POST /api/v1/audio/songs/draft` for new recordings | **VERIFIED (`PASS`)** |
| **MC-04** | Open the Atril and confirm that the correct song is loaded | `handleOpenPreservedSongInStand` -> `client.getSong(songId)` -> `selectPersistedSong()` | **VERIFIED (`PASS`)** |
| **MC-05** | Execute Python audio analysis and inspect actual results | `POST /api/v1/audio/:id/analyze` -> `PythonAudioWorkerBridge.analyzeAudio()` (10 stages) | **VERIFIED (`PASS`)** |
| **MC-06** | Review key, tempo, meter and chord timeline with confidence values | Human Review panel displays `key` (`88%`), `bpm` (`70 BPM`, `90%`), `timeSignature` (`4/4`, `95%`), and `chordTimeline` | **VERIFIED (`PASS`)** |
| **MC-07** | Generate a ChordPro draft when evidence supports it | `targets['CHORD_PRO']` (`DRAFT_READY`) generated with time-aligned chords and sections | **VERIFIED (`PASS`)** |
| **MC-08** | Generate MIDI and MusicXML drafts only when note events are sufficiently supported | Monophonic melody generates both `MIDI` and `MUSIC_XML`; polyphonic mix marks `MIDI` as `NOT_GENERATABLE` | **VERIFIED (`PASS`)** |
| **MC-09** | Generate tablature only when instrument-specific data is sufficiently supported | Enabled for `GUITAR`/`BASS` when verified notes exist; marked `NOT_GENERATABLE` on polyphonic chord-only mixes or `PIANO`/`VOCAL` | **VERIFIED (`PASS`)** |
| **MC-10** | Reject a draft and confirm that canonical content remains unchanged | `POST /api/v1/audio/:id/drafts/:proposalId/review` (`decision: 'REJECTED'`) leaves `songs` and `song_versions` untouched | **VERIFIED (`PASS`)** |
| **MC-11** | Approve a draft and confirm that the approved version becomes available in the Atril | `POST /api/v1/audio/:id/drafts/:proposalId/approve` creates `song_versions` `v(N+1)` and sets `currentVersionId` | **VERIFIED (`PASS`)** |
| **MC-12** | Confirm that the original audio remains available and playable | `AudioPlayerBar` streams `/api/v1/audio/:id/stream?ticket=...` with HTTP 206 Range support | **VERIFIED (`PASS`)** |
| **MC-13** | Restart the backend and verify persistence and recovery | All drafts (`omr_proposals`), versions (`song_versions`), audios (`audio_assets`), and recovery logs (`audit_logs`) persist in PostgreSQL | **VERIFIED (`PASS`)** |
| **MC-14** | Verify that a different song's canonical notation is never displayed as the uploaded audio's generated result | Cross-song guard in `AudioTranscriptionService` + direct `getSong(songId)` loading in `MusicalWorkspace.tsx` | **VERIFIED (`PASS`)** |
| **MC-15** | Verify that unsupported or uncertain output is clearly identified instead of fabricated | Silent/noisy audio and polyphonic note extraction return explicit `UNSUPPORTED` / `AMBIGUOUS` / `NOT_GENERATABLE` reasons | **VERIFIED (`PASS`)** |
