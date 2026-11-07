# WORSHIP STUDIO — PHASE 2A: CONVERSION ENGINE IMPLEMENTATION REPORT
## Universal Transpilation Engine, Outbound Serializers & Format Capabilities

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** Phase 2A — Musical Conversion Center Foundation  
**Module:** Conversion Engine & Exporters (`frontend/src/core/conversion/`)  
**Status:** Completed & Certified  
**Date:** 2026-11-07  

---

## 1. Architectural Overview

The Bethesda Worship Studio Conversion Engine operates under the **Hub-and-Spoke Canonical Architecture**:
1. All inbound musical sources (MusicXML, MIDI, ChordPro, Written Notes) are parsed into the unified **`CanonicalMusicPayload`** aggregation root.
2. Format capabilities are validated against the source structure and payload content via **`FormatCapabilitiesEvaluator`**.
3. Target outputs are generated deterministically by dedicated outbound serializers without intermediate heuristic corruption.

---

## 2. Outbound Serializers Specification

### 2.1 CanonicalToMusicXmlSerializer (`musicxml-serializer.ts`)
- **Specification:** MusicXML 4.0 Partwise XML (`<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN">`).
- **Temporal Division:** Strict 480 TPQN (`<divisions>480</divisions>`). 1 quarter note = 480 divisions.
- **Pitch & Accidental Encoding:** Exact extraction of `<step>` (A-G), `<alter>` (-2 to +2), and `<octave>` (-2 to 10).
- **Duration & Rests:** Emits exact `<duration>` ticks and standard note types (`whole`, `half`, `quarter`, `eighth`, `16th`, `32nd`).
- **Ties & Polyphony:** Mapped to `<tie type="start|stop"/>` and `<notations><tied type="start|stop"/></notations>`. Polyphonic voices mapped to `<voice>1..N</voice>`.
- **Harmonies & Lyrics:** Mapped to `<harmony><root><root-step/><root-alter/></root><kind/></harmony>` and `<lyric><syllabic/><text/></lyric>`.
- **Zero-Fabrication Contract:** Compases without key signatures omit `<key>`. Compases without time signatures omit `<time>`. If notes are absent (e.g. ChordPro lead sheet), warning diagnostic `MUSICXML_NO_MELODIC_NOTES` is emitted and structural lead sheet compases with harmony/lyrics are generated without invented notes.

### 2.2 CanonicalToMidiSerializer (`midi-serializer.ts`)
- **Specification:** Standard MIDI File (SMF Format 1, multi-track synchronous, 480 ticks per quarter note).
- **Track 0 (Conductor Track):**
  - Track Name Meta Event (`0xFF 0x03`): Work title.
  - Set Tempo Meta Event (`0xFF 0x51 0x03`): Extracted from `timeline.tempoMap` or metadata. If unresolved/null, the event is completely omitted (Zero-Fabrication).
  - Time Signature Meta Event (`0xFF 0x58 0x04`): Emitted only if explicitly present.
  - Key Signature Meta Event (`0xFF 0x59 0x02`): Emitted with sharps/flats (-7 to +7) and mode (0 for major, 1 for minor) only if explicitly present.
  - End of Track Meta Event (`0x00 0xFF 0x2F 0x00`).
- **Track 1..N (Musical Tracks):**
  - Sorts events chronologically across measures: at identical ticks, NoteOff (`0x80`) is processed before NoteOn (`0x90`) to prevent clipped or hanging notes.
  - Encodes delta-times using standard Variable-Length Quantity (VLQ).
  - Velocity clamped safely to `1..127`.
- **Zero-Fabrication Contract:** If `CanonicalMusicPayload` contains 0 melodic notes (e.g. from chord-only lead sheet), serialization is **strictly rejected** (`success: false`) with diagnostic `CANNOT_EXPORT_MIDI_WITHOUT_NOTES`. Zero synthetic notes or chords are fabricated.

### 2.3 CanonicalToChordProSerializer (`chordpro-serializer.ts`)
- **Specification:** Standard ChordPro notation (`.cho` / `.chordpro`).
- **Directives:** `{title}`, `{artist}`, `{key}`, `{tempo}`, `{time}`, `{capo}`. Directives are emitted ONLY if declared in the canonical document.
- **Section Directives:** Mapped cleanly to `{start_of_verse: Name}` / `{end_of_verse}`, `{start_of_chorus: Name}` / `{end_of_chorus}`, `{start_of_bridge: Name}` / `{end_of_bridge}`.
- **Chord-Over-Lyric Interleaving:** Interleaves chords and lyrics using measure tick offsets into bracketed notation (`[G]Sub[D]lime [Em]gracia del Señor`).
- **Zero-Fabrication Contract:** If no chords exist, preserves lyrics and structure without emitting fake chords, logging diagnostic `CHORDPRO_NO_CHORDS`.

### 2.4 CanonicalToLyricsSerializer (`lyrics-serializer.ts`)
- **Specification:** Pure clean plain text (`.txt`) for worship singers and leaders.
- **Structure:** Title header, artist credit, and bracketed section markers (`[Verso 1]`, `[Coro]`, `[Puente]`).
- **Formatting:** Assembles words cleanly from hyphenated/non-hyphenated syllables, removes all chords, XML tags, and durations.
- **Zero-Fabrication Contract:** If document has zero lyrics (instrumental score), serialization is **strictly rejected** (`success: false`) with diagnostic `LYRICS_NO_VOCAL_CONTENT`.

---

## 3. Format Capabilities Evaluator (`format-capabilities.ts`)

Determines viable vs blocked conversions:
1. **Magic Bytes Inspection:**
   - MIDI: `MThd` (`0x4D 0x54 0x68 0x64`).
   - PDF: `%PDF` (`0x25 0x50 0x44 0x46`).
   - XML: `<?xml` with `<score-partwise>` or `<score-timewise>`.
   - ChordPro: Directives `{title:`, `{key:`, or bracket chords `[A-G]`.
2. **Phase Gating:**
   - Audio/Video sources: Marked `DEFERRED_PHASE` (deferred to Phase 2B for local Basic Pitch / Demucs / Whisper.cpp).
   - PDF/Image sources: Marked `DEFERRED_PHASE` (deferred to Phase 2B for local Audiveris / oemer OMR).
   - Engraved PDF target: Marked `DEFERRED_PHASE` with guidance to export MusicXML for notation engraving.
   - Tablature target: Marked `DEFERRED_PHASE` for polyphonic fingering engine.
3. **Dynamic Refinement:**
   - Evaluates active payload: if notes are 0, MIDI target is marked `BLOCKED_ZERO_FABRICATION`. If lyrics are 0, Lyrics target is marked `BLOCKED_ZERO_FABRICATION`.

---

## 4. Verification Evidence

- 21/21 Unit tests passed in `frontend/src/core/conversion/__tests__/`.
- Roundtrip verified: Generated MIDI files parse back into `backend/src/domain/ingestion/adapters/midi/midi-parser.ts` with exact format, division (480), track counts, and pitch arrays.

