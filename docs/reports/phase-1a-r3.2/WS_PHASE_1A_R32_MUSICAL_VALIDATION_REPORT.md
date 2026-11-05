# WORSHIP STUDIO — PHASE 1A-R3.2 TECHNICAL REPORT
## STRICT MUSICAL NOTE VALIDATION & INTEGRITY GUARANTEE

**Project:** Bethesda Worship Studio  
**Repository:** https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R3.2  
**Deliverable ID:** WS-1A-R3.2-DOC-03  
**Date:** 2026-11-03  
**Status:** Completed & Verified  

---

## 1. EXECUTIVE SUMMARY

This report documents the architectural remediation and technical verification of finding **R3.2-03 (Strict Musical Note Validation & Zero Fabrication Guarantee)** executed in Phase 1A-R3.2.

Prior to this phase:
1. Note step validation in the OMR domain was susceptible to partial-string prefix acceptance (e.g. accepting `'CXYZ'`, `'F-invalid'`, or `'A123'` because the first character happened to be between A and G).
2. Notes with malformed or unresolvable glyphs posed a risk of being silently defaulted to `'C'` (or creating fabricated rest events) to satisfy parsers.
3. Accidentals could potentially be merged or overwritten if representations conflated the diatonic step with chromatic alterations.

Following Phase 1A-R3.2:
- Note steps are validated using an exact-match regular expression `^[A-G]$` (case-insensitive, normalized to uppercase `A-G`). Any prefix, suffix, numeric character, whitespace, or invalid glyph is rejected immediately.
- Diatonic steps are preserved cleanly, and chromatic alterations (e.g., sharps and flats) are strictly maintained in the `alter` property (e.g., `step: 'F', alter: 1` for F#4; `step: 'B', alter: -1` for Bb3).
- Unresolvable notes are tagged as `UNRESOLVED_NOTE_GLYPH` in `unrecognizedRegions`, and canonical commit is strictly blocked with a `ValidationError` until a human musician corrects or overrides the measure.

---

## 2. REGEX HARDENING & STEP PARSING (R3.2-03)

### 2.1 Problem Analysis
In computational musicology and MusicXML standards, a note's diatonic pitch step is defined strictly as one of the seven letters: `A`, `B`, `C`, `D`, `E`, `F`, `G`.
In JavaScript, naive string checks such as:
```typescript
// INSECURE / PERMISSIVE:
const firstChar = step[0]?.toUpperCase();
if (['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(firstChar)) { ... }
```
erroneously treat malformed strings like `'CXYZ'` or `'F-invalid'` as valid note `C` or `F`.

### 2.2 Exact-Match Regular Expression Implementation
In `backend/src/application/omr-service.ts`, `validateAndParseNoteStep` was refactored:

```typescript
const EXACT_NOTE_STEP_REGEX = /^[A-G]$/i;

function validateAndParseNoteStep(step: unknown): { isValid: boolean; normalizedStep?: NoteStep } {
  if (typeof step !== 'string') {
    return { isValid: false };
  }

  const trimmed = step.trim();
  // Exact match required: Must be exactly one character between A and G
  if (!EXACT_NOTE_STEP_REGEX.test(trimmed)) {
    return { isValid: false };
  }

  return {
    isValid: true,
    normalizedStep: trimmed.toUpperCase() as NoteStep,
  };
}
```

### 2.3 Strict Separation of Pitch Step and Chromatic Alteration
MusicXML and domain representation in Bethesda Worship Studio strictly isolate the pitch step from its alteration:
- Pitch Step: Diatonic base note (`'A'` through `'G'`).
- Alteration: Integer number of semitones (`-2` = double flat, `-1` = flat, `0` = natural, `1` = sharp, `2` = double sharp).

When an OMR scan identifies `F#4`:
- `step` is `'F'`
- `octave` is `4`
- `alter` is `1`

The validator rejects string accidentals embedded in `step` (such as `step: "F#"`) because `EXACT_NOTE_STEP_REGEX` strictly requires a single character from `[A-G]`. The route schema and domain parser ensure accidentals are cleanly parsed into the `alter` field.

---

## 3. ZERO NOTE FABRICATION & COMMIT GATING

### 3.1 Unresolvable Glyph Treatment
When the OMR engine encounters an ambiguous, blurry, or unrecognized note symbol:
1. The system **never** invents a fallback pitch (such as defaulting to `C4`).
2. The system **never** converts an unresolvable note into a silent rest.
3. The note is omitted from `notesDetected`, and an explicit diagnostic entry is added to `unrecognizedRegions`:
   ```json
   {
     "regionId": "region-meas-1-note-3",
     "measureNumber": 1,
     "issue": "UNRESOLVED_NOTE_GLYPH",
     "confidence": 0.22,
     "description": "El glifo de nota musical es ilegible o ambiguo; no se puede determinar la altura tonal sin intervención humana."
   }
   ```

### 3.2 Canonical Commit Gating
In `OmrService.commitCanonicalSong`:
```typescript
for (const measure of proposal.measures) {
  const hasUnresolvedNotes = (proposal.unrecognizedRegions || []).some(
    r => r.measureNumber === measure.measureNumber && r.issue === 'UNRESOLVED_NOTE_GLYPH'
  );
  if (hasUnresolvedNotes) {
    throw new ValidationError(
      `No se puede consolidar la partitura a versión canónica: el compás ${measure.measureNumber} contiene glifos de notas no resueltos ('UNRESOLVED_NOTE_GLYPH'). Requiere corrección humana previa.`
    );
  }
}
```

---

## 4. AUTOMATED TEST EVIDENCE

Tests executed in `backend/src/__tests__/omr-persistence-and-integrity.test.ts`:

| Test ID | Description | Input | Expected Output | Status |
| :--- | :--- | :--- | :--- | :--- |
| **19.1** | Flag UNRESOLVED_NOTE_GLYPH without defaulting empty step to C | `{ step: '' }` | `issue: 'UNRESOLVED_NOTE_GLYPH'` in `unrecognizedRegions` | **PASS** |
| **19.2** | Reject invalid note step letter (X) | `{ step: 'X' }` | `isValid: false`, flagged as unresolved | **PASS** |
| **19.3** | Reject note with numeric accidental but empty step | `{ step: '', alter: 1 }` | Rejected without becoming C# | **PASS** |
| **19.4** | Block canonical commit if UNRESOLVED_NOTE_GLYPH present | Proposal with unresolved glyph | `ValidationError` thrown, 0 songs committed | **PASS** |
| **19.5** | Accept all valid note letters A through G (upper and lowercase) | `'A'`, `'b'`, `'C'`, `'d'`, `'E'`, `'f'`, `'G'` | `isValid: true`, uppercase normalized | **PASS** |
| **19.6** | Strictly reject partial prefixes and suffixes | `'CXYZ'`, `'F-invalid'`, `'A123'`, `'X'` | `isValid: false` for all | **PASS** |
| **19.7** | Strictly reject empty, whitespace, null, numeric, unicode | `''`, `'   '`, `null`, `undefined`, `42`, `'🎵'` | `isValid: false` for all | **PASS** |
| **19.8** | Preserve valid notes with explicit alterations (`alter: 1`, `alter: -1`) | `F#4` (`step: 'F', alter: 1`), `Bb3` (`step: 'B', alter: -1`) | Preserved accurately with exact ticks and alter | **PASS** |

All tests passed with 100% success rate.

