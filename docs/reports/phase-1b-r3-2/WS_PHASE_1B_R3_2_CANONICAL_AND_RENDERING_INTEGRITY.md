# WORSHIP STUDIO — PHASE 1B-R3.2
## CANONICAL MODEL & RENDERING INTEGRITY TECHNICAL REPORT

**Document ID:** `WS_PHASE_1B_R3_2_CANONICAL_AND_RENDERING_INTEGRITY.md`  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Modules Affected:**  
- `frontend/src/core/canonical-model/chord-event.ts`
- `frontend/src/core/canonical-model/lyric-syllable.ts`
- `frontend/src/core/canonical-model/measure.ts`
- `frontend/src/core/canonical-model/section.ts`
- `frontend/src/core/canonical-model/timeline.ts`
- `frontend/src/core/canonical-model/validator.ts`
- `frontend/src/core/projection/derived-musical-view.ts`
- `frontend/src/core/rendering/adapters/leadsheet-dom-adapter.ts`
- `frontend/src/core/rendering/adapters/alphatab-adapter.ts`
**Execution Mode:** Controlled Engineering Remediation  
**Status:** COMPLETE — INTEGRITY CERTIFIED  

---

## 1. TRI-STATE TEMPORAL DOMAIN SEMANTICS

In Phase 1B-R3.2, Bethesda Worship Studio established a unified, mathematically formal **tri-state temporal semantics** across all core entities:

1. **Known / Resolved:**
   - Integer values `>= 0` for `startTick`, `tickOffset`.
   - Integer values `>= 1` for `durationTicks`, `totalDurationTicks`.
   - Occurs when time signature and note/rest values are explicitly declared in the musical score.
2. **Unknown / Unresolved (`null`):**
   - Explicit `null` value indicating that the temporal position or duration is not declared and cannot be derived from source evidence (e.g. unmetered ChordPro charts or unmetered empty measures).
   - `endTick` returns `null` safely without throwing.
3. **Invalid:**
   - Negative numbers, non-integers, `NaN`, `Infinity`, or malformed strings.
   - Strictly rejected during entity construction or validation.

---

## 2. CANONICAL ENTITY UPDATES

### 2.1 `ChordEvent`
- `startTick: number | null`
- `durationTicks?: number | null | undefined`
- `endTick`: returns `null` when `startTick === null` or `durationTicks === null`.
- Validates integer `>= 0` only when `startTick !== null`.
- `fromJSON`: deserializes `json.startTick ?? null`.

### 2.2 `LyricSyllable`
- `tickOffset: number | null`
- Validates integer `>= 0` only when `tickOffset !== null`.
- `chordAbove: Chord | null`: retains harmonic association directly without synthetic ticks.
- `fromJSON`: deserializes `json.tickOffset ?? null`.

### 2.3 `Measure`
- `startTick: number | null`
- `durationTicks: number | null`
- `endTick`: returns `null` when `startTick === null` or `durationTicks === null`.
- `containsTick(tick)`: returns `false` safely when start or end tick is `null`.
- `calculatedDuration`: returns `null` when `timeSignature === null`.

### 2.4 `Section`
- `startTick: number | null`
- `durationTicks: number | null`
- `endTick`: returns `null` when `startTick === null` or `durationTicks === null`.
- `containsTick(tick)`: returns `false` safely when start or end tick is `null`.

### 2.5 `Timeline`
- `totalDurationTicks: number | null`
- `totalDurationSeconds`: returns `null` when `totalDurationTicks === null` or when `tempoMap.isUnresolved`.
- `isUnmetered: boolean`: explicitly tracks absence of meter.

### 2.6 `CanonicalModelValidator`
- Measure continuity: validates `measure.startTick === expectedTick` only when both are resolved (`!== null`).
- Measure duration: validates against meter only when `measure.timeSignature` and `durationTicks` are resolved.
- Event and chord bounds: checks `chord.startTick >= measure.startTick && chord.startTick < measure.endTick` only when ticks are resolved.
- Lyric bounds: checks `lyric.tickOffset >= 0 && lyric.tickOffset < measure.durationTicks` only when ticks are resolved.
- Timeline duration match: checks `timeline.totalDurationTicks === expectedTick` only when resolved.
- Tri-state verification: Valid unmetered scores pass validation cleanly without errors.

---

## 3. PROJECTION & RENDERING INTEGRITY

### 3.1 `DerivedMusicalView`
- `DerivedChord.startTick: number | null`, `durationTicks?: number | null`.
- `DerivedLyric.tickOffset: number | null`.
- `DerivedMeasure.startTick: number | null`, `durationTicks: number | null`.
- Projection via `ProjectionService` maps canonical null ticks directly into derived entities without mutating the canonical source or injecting synthetic values.

### 3.2 `LeadSheetDOMAdapter`
- Aligns tokens using `chordAbove` when syllables have associated chords, regardless of tick presence.
- Maintains token order without NaN or failure during null arithmetic.
- When `timeSignature === null`, renders meter as `"—"` (em-dash), never fabricating a false `"4/4"` label.
- Guarantees that `totalMelodyNotes` remains strictly `0` for lead sheets without melody.

### 3.3 `AlphaTabAdapter`
- Handles measures with null chords safely, defaulting display beats without throwing or leaking nulls into AlphaTab's internal player data structure.

---

## 4. VERIFICATION MATRIX (SCENARIOS 26–33)

| Scenario | Description | Target | Result | Evidence |
|---|---|---|---|---|
| **Scenario 26** | JSON Serialization Round-Trip | Preserves null temporal positions and durations | PASS | `universal-ingestion-phase1b-r3-2.test.ts:566` |
| **Scenario 27** | Canonical Validator Tri-State | Does not reject unmetered measures or null ticks | PASS | `universal-ingestion-phase1b-r3-2.test.ts:646` |
| **Scenario 28** | LeadSheetDOMAdapter Rendering | Renders unmetered ChordPro displaying chords above words | PASS | `universal-ingestion-phase1b-r3-2.test.ts:699` |
| **Scenario 29** | ProjectionService Immutability | Preserves canonical nulls in DerivedMusicalView | PASS | `universal-ingestion-phase1b-r3-2.test.ts:730` |
| **Scenario 30** | Visual Meter Presentation | Displays "—" for unmetered score, NEVER "4/4" | PASS | `universal-ingestion-phase1b-r3-2.test.ts:786` |
| **Scenario 31** | MIDI Timestamp Mapping | Maps explicit MIDI timestamps to canonical ticks | PASS | `universal-ingestion-phase1b-r3-2.test.ts:814` |
| **Scenario 32** | MIDI Untempoed Ingestion | Preserves tempo as unresolved (no 120 BPM) | PASS | `universal-ingestion-phase1b-r3-2.test.ts:874` |
| **Scenario 33** | Multi-Track MIDI Polyphony | Preserves per-track polyphony without flattening | PASS | `universal-ingestion-phase1b-r3-2.test.ts:901` |

