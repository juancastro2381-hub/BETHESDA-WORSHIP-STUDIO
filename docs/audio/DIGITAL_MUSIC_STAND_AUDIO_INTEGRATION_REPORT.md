# BETHESDA WORSHIP STUDIO
# DIGITAL MUSIC STAND AUDIO INTEGRATION REPORT
## Gate 5 — Song Association Remediation, Version Switching & Reading Format Governance

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Workstream:** Gate 5 — Digital Music Stand Integration  
**Core Components:**  
- [`frontend/src/components/workspace/MusicalWorkspace.tsx`](../../frontend/src/components/workspace/MusicalWorkspace.tsx)  
- [`frontend/src/components/workspace/SongHeader.tsx`](../../frontend/src/components/workspace/SongHeader.tsx)  
- [`frontend/src/components/workspace/AudioPlayerBar.tsx`](../../frontend/src/components/workspace/AudioPlayerBar.tsx)  
- [`frontend/src/components/conversion/ConversionCenterWorkspace.tsx`](../../frontend/src/components/conversion/ConversionCenterWorkspace.tsx)

---

## 1. Root Cause & Remediation of the Observed Song Association Discrepancy (Sections 2, 3.D & 9)

### 1.1 Observed Issue Before Remediation
1. Preserving `El Señor Esta en Este Lugar.mp3` associated the recording with `WORSHIP_TEST_CMB_AZUL-DIVIDIDO` (the first item in `client.listSongs()`).
2. Clicking `"🎵 Abrir Canción en el Atril Digital"` called `onClose()`, which closed the Conversion Center modal without loading the target song into `MusicalWorkspace`, leaving the Digital Music Stand on its initial hardcoded demo fixture `"Sublime Gracia (Golden G Major)"` (2 measures) with `persistedMeta = null` (hiding `AudioPlayerBar`).

### 1.2 Remediation Applied
1. **Explicit Song Association & Dedicated Draft Song Creation (`ConversionCenterWorkspace.tsx` + `POST /api/v1/audio/songs/draft`):**
   - When an audio file is selected, `ConversionCenterWorkspace` checks whether an existing catalog song matches the normalized audio title; if not, it defaults to `✨ Crear nueva canción en catálogo: «{audioTitle}»` (`__CREATE_NEW_SONG__`) while allowing explicit selection of any existing catalog song.
   - When `__CREATE_NEW_SONG__` is active, preservation creates a dedicated `DRAFT` catalog song entry with that exact title (`0` fabricated measures) before uploading the audio asset.
2. **Authoritative Song & Version Loading in the Digital Music Stand (`MusicalWorkspace.tsx`):**
   - Added `handleOpenPersistedSongInStand(songId, { audioId, versionId })` in `MusicalWorkspace.tsx`, wired to `ConversionCenterWorkspace` (`onOpenPersistedSongInStand`) and `DatabaseSongsModal`.
   - Clicking `"🎵 Abrir «{songTitle}» en el Atril Digital"` fetches `client.getSong(songId)` and `client.listSongVersions(songId)`, hydrates the exact `CanonicalMusicPayload` of the target version, calls `selectPersistedSong()`, populates `persistedSongVersions`, and activates `AudioPlayerBar` with `songId={songRes.song.id}`.
   - The Atril **never** falls back to `"Sublime Gracia (Golden G Major)"` when opening a preserved or transcribed song.

---

## 2. Reading Format Selection & Provenance Display in the Atril (Section 9)

1. **Header Provenance & Version Selector (`SongHeader.tsx`):**
   - Clearly displays:
     - **Song Title** (`#active-song-title`)
     - **Version Selector Dropdown** (`#stand-version-select`) when multiple versions exist (e.g., original canonical score `v1` vs approved audio transcription `v2`), allowing instant non-destructive switching
     - **Approval Status Badge** (`✅ APROBADO` vs `⚠️ DRAFT / AUDIO_PRESERVED`)
     - **Active Reading Format Badge** (`📖 Formato: Partitura | Cifrado con Letra | Cifrado Armónico | Letra Sola | Tablatura`)
     - **Associated Audio Badge** (`🎧 Audio: {filename} (Transcripción Aprobada)`)
2. **Reading Formats Governed by Actual Content (`ReadingFormatSelector` & `workspace-orchestrator.ts`):**
   - `Partitura` (`STAFF_NOTATION`): Enabled when verified melodic notes exist (`hasNotes`).
   - `Cifrado con Letra` (`CHORD_CHART`): Enabled when chords and verified lyrics exist (`hasChords && hasLyrics`); when only chords exist (`hasChords && !hasLyrics`), `workspace-orchestrator.ts` projects `CHORDS` (`Cifrado Armónico`) via `LeadSheetDOM`.
   - `Letra Sola` (`LYRICS_ONLY`): Enabled when verified lyrics exist (`hasLyrics`).
   - `Tablatura` (`TABLATURE`): Enabled only for stringed instruments (`Guitarra` / `Bajo`) when verified melodic notes exist (`hasNotes`).
   - Unavailable formats display their exact musical explanation (`🚫 ...`) and never render an unrelated score.
