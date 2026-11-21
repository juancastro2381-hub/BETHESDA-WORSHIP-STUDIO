# WORSHIP STUDIO — PHASE 1A-R3.1 REPORT
## MUSICAL INTEGRITY, NOTE STEP VALIDATION & ZERO-FABRICATION GUARANTEE

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R3.1 — Final Defect Closure & Hardening  
**Target:** Remediations R3.1-03 & R3.1-06  
**Date:** 2026-11-03  
**Status:** IMPLEMENTED & VERIFIED  

---

## 1. EXECUTIVE SUMMARY

The foundational mandate of Bethesda Worship Studio is zero musical fabrication. Under no circumstance may unrecognized, ambiguous, or damaged musical glyphs be coerced into synthetic musical content (such as defaulting missing pitches to 'C' or substituting rests for unrecognized notes).

In previous iterations, two fallback expressions remained in `backend/src/application/omr-service.ts`:
- In `processUpload()`: `step: (n.step[0] ?? 'C').toUpperCase()`
- In `convertToCanonicalMeasures()`: `step: (n.step[0] ?? 'C').toUpperCase()`

This allowed empty or invalid step strings (such as `""`, `"X"`, `"1"`) to be silently coerced into middle 'C' or transposed notes.

In Phase 1A-R3.1, remediation R3.1-03 and R3.1-06 decisively eliminated this behavior:
- Created the strict validator `validateAndParseNoteStep(step: unknown): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | null`.
- If a note step is missing, empty, or not in `[A-G]`, it is **NEVER** coerced into 'C' or any other note.
- The note is rejected, the measure is tagged with `UNRESOLVED_NOTE_GLYPH:${rawStep}`, and the proposal is placed into human review.
- Any proposal containing unresolved musical flags is strictly blocked from committing to the canonical catalog with `ValidationError`.

---

## 2. STRICT NOTE STEP VALIDATION & PARSING (R3.1-03)

### 2.1 Validator Implementation
In `backend/src/application/omr-service.ts`:

```typescript
function validateAndParseNoteStep(
  step: unknown
): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | null {
  if (typeof step !== 'string') return null;
  const trimmed = step.trim().toUpperCase();
  if (!trimmed || trimmed.length === 0) return null;
  const firstChar = trimmed[0];
  if (['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(firstChar)) {
    return firstChar as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  }
  return null;
}
```

### 2.2 Processing & Canonical Conversion Pipeline
In both `processUpload` and `convertToCanonicalMeasures`:
```typescript
const parsedStep = validateAndParseNoteStep(n.step);
if (!parsedStep) {
  measureFlags.push(`UNRESOLVED_NOTE_GLYPH:${String(n.step ?? '')}`);
  hasUnresolvedGlyph = true;
  continue; // NO SE AGREGA NINGUNA NOTA FABRICADA
}
```

If `hasUnresolvedGlyph` is true:
- The note is omitted from canonical score output.
- The measure flags record the exact unresolvable glyph.
- The proposal `overallConfidence` is penalized.
- Canonical commit is blocked until a human musician inspects and corrects the measure via `PATCH /proposals/:id/measures/:measureNumber`.

### 2.3 Blocking Canonical Commit on Unresolved Flags
In `commitToCanonicalSong()`:
```typescript
for (const m of proposal.measures) {
  const unresolvedFlags = (m.flags ?? []).filter(
    (f) =>
      f.startsWith('UNRESOLVED_NOTE_GLYPH') ||
      f.startsWith('UNRESOLVED_TIME_SIGNATURE') ||
      f.startsWith('UNRESOLVED_KEY_SIGNATURE') ||
      f.startsWith('UNRESOLVED_MEASURE_CONTENT') ||
      f.startsWith('INCOMPLETE_MEASURE_DURATION') ||
      f.startsWith('CORRUPT_GLYPH') ||
      f === 'LOW_CONFIDENCE'
  );
  if (unresolvedFlags.length > 0) {
    throw new ValidationError(
      `No se puede comprometer al catálogo canónico: el compás ${m.measureNumber} contiene contenido musical no resuelto (${unresolvedFlags.join(', ')}). Debe ser revisado y corregido por un músico humano antes de la importación.`
    );
  }
}
```

---

## 3. FULL PIPELINE MUSICAL INTEGRITY INVARIANTS (R3.1-06)

Bethesda Worship Studio upholds the following comprehensive musical invariants across the pipeline:

| Dimension | Architectural Invariant | Verification Guard |
|:---|:---|:---|
| **Meters & Metric Grid** | 3/4 = 1440 ticks; 6/8 = compound meter with 720-tick primary beats. Never defaults to 4/4 (1920 ticks). | Block commit if meter is missing or unverified without explicit override. |
| **Tonality & Key Signatures** | Key signatures faithfully map fifths (e.g. Eb Major = 3 flats). Never defaults to C Major (0 alterations). | Block commit if key signature is missing or unverified without explicit override. |
| **Pitch & Accidentals** | Explicit accidentals (F#4, Bb3) are preserved in pitch, octave, and alter. Corrupt pitch glyphs flag `UNRESOLVED_NOTE_GLYPH`. | Rejection of fabricated pitches; accidentals with missing note letters blocked. |
| **Rests & Measure Completeness** | Explicit rests recognized by OMR (`isRest: true`) are preserved. Empty measures with no notes/rests are rejected. Incomplete measure duration flags `INCOMPLETE_MEASURE_DURATION`. | Block commit if measure duration does not sum to expected meter ticks. |
| **Chords & Harmony** | Unparsed chord symbols are preserved verbatim and flagged for human review; never swallowed. | Flagged chords recorded in measure annotations. |
| **Rhythmics & Ornaments** | Dotted notes (1.5x) and triplets (2/3x) mapped to exact tick counts. Unrecognized durations throw `ValidationError`. | Zero duration guessing. |
| **Lyrics & Syllables** | Syllables are distributed along notes and beats; never stacked at tick 0. | Beat-synchronized tick assignment. |
| **Confidence Scoring** | Any measure with overall confidence < 0.70 is automatically tagged `LOW_CONFIDENCE`. | Requires human musician review before canonical commit. |

---

## 4. AUTOMATED TEST EVIDENCE

Tests in `backend/src/__tests__/omr-persistence-and-integrity.test.ts` thoroughly validate the musical invariants:

| Test ID | Verified Musical Behavior | Result | Status |
|:---|:---|:---|:---:|
| **19.1** | Empty note step (`step: ""`) flags `UNRESOLVED_NOTE_GLYPH` and does NOT default to C | Flag added, notesDetected empty | **PASS** |
| **19.2** | Invalid note step letter (`step: "X"`) flags `UNRESOLVED_NOTE_GLYPH:X` | Flag added, zero fabricated notes | **PASS** |
| **19.3** | Note with accidental (`alter: 1`) but empty step (`step: ""`) does NOT become C# | Flag added, no note generated | **PASS** |
| **19.4** | Canonical commit blocked for proposal containing `UNRESOLVED_NOTE_GLYPH` | `ValidationError` thrown with descriptive message | **PASS** |
| **2.1** | Preservation of 3/4 metric (1440 ticks) without defaulting to 4/4 (1920 ticks) | Metric duration exactly 1440 ticks | **PASS** |
| **2.2** | Preservation of 6/8 compound metric with 720-tick primary beats | Primary beats at 0 and 720 ticks | **PASS** |
| **2.3** | Block commit when time signature is unknown without override | `ValidationError` thrown | **PASS** |
| **2.4** | Block commit when BPM is unknown without override | `ValidationError` thrown | **PASS** |
| **3.1** | Preservation of Eb Major (3 flats) without defaulting to 0 | Key signature unaltered | **PASS** |
| **3.2** | Block commit when key signature is unknown without override | `ValidationError` thrown | **PASS** |
| **4.1** | Preservation of explicit alterations (F#4, Bb3) | Pitch, octave, and alteration verified | **PASS** |
| **4.2** | Flag unresolvable note glyphs instead of creating fake rests | Flags added, no fake rests created | **PASS** |
| **5.1** | Preservation of unparsed chords without swallowing errors | Unparsed chord flagged | **PASS** |
| **6.1** | Exact tick mapping for dotted notes and triplets | Tick calculations mathematically exact | **PASS** |
| **6.2** | Reject unknown note duration with `ValidationError` | `ValidationError` thrown | **PASS** |
| **7.1** | Reject commit on empty measure (`notesDetected: []`) | `ValidationError` thrown | **PASS** |
| **7.2** | Preserve explicit full-measure rest when `isRest: true` | Explicit rest persisted | **PASS** |
| **7.3** | Preserve partial rest and note sequence in order | Sequence order and ticks verified | **PASS** |
| **7.4** | Reject commit when measure duration is incomplete | `ValidationError` thrown | **PASS** |
| **8.1** | Distribute lyric syllables along notes/beats (not stacked at tick 0) | Distinct tick timestamps verified | **PASS** |
| **9.1** | Measures with confidence < 0.70 tagged `LOW_CONFIDENCE` | Flag automatically assigned | **PASS** |

### Execution Excerpt:
```text
  ✔ 19.1: should flag UNRESOLVED_NOTE_GLYPH and NOT default empty step to C (R3.1-03) (5.2339ms)
  ✔ 19.2: should reject invalid note step letter (X) without defaulting to C (R3.1-03) (3.0838ms)
  ✔ 19.3: should reject note with numeric accidental but empty step without becoming C# (R3.1-03) (3.4571ms)
  ✔ 19.4: should block canonical commit for proposal containing UNRESOLVED_NOTE_GLYPH (R3.1-03) (9.5926ms)
```

---

## 5. CONCLUSION

Remediations R3.1-03 and R3.1-06 are completely implemented and verified. The codebase provides an uncompromising guarantee of musical fidelity: unknown musical glyphs are flagged for human review and never fabricated.

