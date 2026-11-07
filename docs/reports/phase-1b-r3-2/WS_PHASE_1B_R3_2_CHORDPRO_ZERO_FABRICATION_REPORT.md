# WORSHIP STUDIO — PHASE 1B-R3.2
## CHORDPRO ZERO-FABRICATION TECHNICAL REMEDIATION REPORT

**Document ID:** `WS_PHASE_1B_R3_2_CHORDPRO_ZERO_FABRICATION_REPORT.md`  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Module:** `frontend/src/core/ingestion/chordpro/chordpro-importer.ts`  
**Execution Mode:** Controlled Engineering Remediation  
**Status:** COMPLETE — ZERO FABRICATION CERTIFIED  

---

## 1. PROBLEM IDENTIFICATION

During the independent technical review of Phase 1B-R3.1, an inspection of `ChordProImporter` revealed that when the `{time}` directive is absent, the importer fell back to synthetic temporal calculations:
1. `chordSlotTicks = CANONICAL_TPQN;` (arbitrarily assuming quarter-note duration of 480 ticks per chord).
2. Synthetic lyric slot durations: `slotTicks = Math.floor(containerDuration / words.length);`
3. `containerDuration = Math.max(chords.length * chordSlotTicks, words.length * Math.floor(CANONICAL_TPQN / 2));`
4. Synthetic tick arithmetic: assigning `mTick + cIdx * chordSlot` to chords and `wIdx * lyricSlot` to syllables.

While well-intentioned for rudimentary layout, assigning invented tick positions to unmetered chord charts violates the fundamental core architectural invariant:
> **"Truth in source representation: The ingestion pipeline must never assign invented temporal information to musical events whose timing cannot be established from the source document."**

---

## 2. REMEDIATION IMPLEMENTED

### 2.1 Complete Elimination of Synthetic Formulas
All temporal calculation formulas in the unmetered branch of `frontend/src/core/ingestion/chordpro/chordpro-importer.ts` have been removed:
- Removed `chordSlotTicks = CANONICAL_TPQN;`
- Removed `slotTicks = Math.floor(containerDuration / words.length);`
- Removed `containerDuration = Math.max(...)`
- Removed tick offsets for unmetered syllables and chords.

### 2.2 Unmetered Chord Contract
When `{time}` is absent:
- `ChordEvent.startTick`: set strictly to `null`.
- `ChordEvent.durationTicks`: set strictly to `null`.
- Sequence order is preserved strictly through array order (`chords[0]`, `chords[1]`, etc.).

### 2.3 Unmetered Lyric Contract
When `{time}` is absent:
- `LyricSyllable.tickOffset`: set strictly to `null`.
- Sequence order is preserved strictly via `sequenceNumber: syllableSequence++`.
- Chord-to-lyric association is preserved via `chordAbove: Chord | null`, linking the chord placed immediately preceding or enclosing the syllable in the source ChordPro document (e.g. `[G]Sublime [C]gracia` -> `Sublime.chordAbove = G`, `gracia.chordAbove = C`).

### 2.4 Measure & Section Contract
When `{time}` is absent:
- `Measure.timeSignature`: set strictly to `null`.
- `Measure.startTick`: set strictly to `null`.
- `Measure.durationTicks`: set strictly to `null`.
- `Section.startTick`: set strictly to `null`.
- `Section.durationTicks`: set strictly to `null`.

### 2.5 Timeline Contract
- `Timeline.totalDurationTicks`: set strictly to `null`.
- `Timeline.totalDurationSeconds`: evaluates to `null`.
- `Timeline.isUnmetered`: set to `true`.

### 2.6 Diagnostics
When `{time}` is absent, `ChordProImporter` emits two explicit structured diagnostics:
1. `UNRESOLVED_TIME_SIGNATURE` (severity: `INFO`): Declares that no `{time}` directive exists.
2. `UNRESOLVED_TEMPORAL_STRUCTURE` (severity: `INFO`): Declares that temporal positions (ticks) and durations are preserved as unresolved (`null`) without fabricating synthetic values.

### 2.7 Metered ChordPro Preservation
When `{time}` is explicitly provided (e.g., `{time: 4/4}` or `{time: 3/4}`):
- 4/4 generates exact 1920-tick measures (`4 * 480`).
- 3/4 generates exact 1440-tick measures (`3 * 480`).
- `isUnmetered` is `false`.
- Chords and syllables receive valid, proportional ticks within declared measure bounds.

---

## 3. VERIFICATION MATRIX (SCENARIOS 1–11)

| Scenario | Description | Target | Result | Evidence |
|---|---|---|---|---|
| **Scenario 1** | Explicit 4/4 ChordPro | Measures: 1920 ticks each, isUnmetered: false | PASS | `universal-ingestion-phase1b-r3-2.test.ts:31` |
| **Scenario 2** | Explicit 3/4 ChordPro | Measures: 1440 ticks each, isUnmetered: false | PASS | `universal-ingestion-phase1b-r3-2.test.ts:50` |
| **Scenario 3** | Unmetered ChordPro | `timeSignature: null`, `startTick: null`, `durationTicks: null` | PASS | `universal-ingestion-phase1b-r3-2.test.ts:68` |
| **Scenario 4** | Unmetered Chords | `startTick: null`, `durationTicks: null`, zero 480-tick invention | PASS | `universal-ingestion-phase1b-r3-2.test.ts:90` |
| **Scenario 5** | Unresolved Key | `keySignature: null`, diagnostic `UNRESOLVED_KEY_SIGNATURE` | PASS | `universal-ingestion-phase1b-r3-2.test.ts:107` |
| **Scenario 6** | Unresolved Tempo | `tempoMap.isUnresolved: true`, diagnostic `UNRESOLVED_TEMPO` | PASS | `universal-ingestion-phase1b-r3-2.test.ts:119` |
| **Scenario 7** | Chords without lyrics | Exact chord order preserved, 0 notes, 0 lyrics | PASS | `universal-ingestion-phase1b-r3-2.test.ts:131` |
| **Scenario 8** | Lyrics without chords | Exact word order preserved, 0 notes, 0 chords | PASS | `universal-ingestion-phase1b-r3-2.test.ts:149` |
| **Scenario 9** | Chords & lyrics without timing | Chords null ticks, lyrics null ticks, chordAbove preserved | PASS | `universal-ingestion-phase1b-r3-2.test.ts:169` |
| **Scenario 10** | Empty ChordPro input | 0 notes, 0 chords, 0 lyrics, valid null-timed container | PASS | `universal-ingestion-phase1b-r3-2.test.ts:202` |
| **Scenario 11** | ChordPro Section Directives | Sections preserved with correct measure boundaries | PASS | `universal-ingestion-phase1b-r3-2.test.ts:219` |

