# WORSHIP STUDIO — PHASE 1A-R3.2 TECHNICAL REPORT
## SAFE PATCH SEMANTICS FOR MUSICAL MEASURE EDITING & DATA INTEGRITY

**Project:** Bethesda Worship Studio  
**Repository:** https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R3.2  
**Deliverable ID:** WS-1A-R3.2-DOC-04  
**Date:** 2026-11-03  
**Status:** Completed & Verified  

---

## 1. EXECUTIVE SUMMARY

This report documents the architectural remediation and technical verification of finding **R3.2-04 (Safe PATCH Semantics for Musical Measure Editing)** executed in Phase 1A-R3.2.

Prior to this phase:
1. The route `PATCH /api/v1/omr/proposals/:proposalId/measures/:measureNumber` utilized permissive `z.any()` schema definitions for musical elements (`notesDetected`, `chordsDetected`, `lyricsDetected`).
2. Schema defaults such as `.default([])` for chords and lyrics caused unintended data loss: any PATCH request modifying only a note would unintentionally wipe out existing chords and lyrics because the missing fields defaulted to empty arrays.
3. The confidence parameter defaulted to `.default(1)`, artificially boosting measure confidence to 100% on minor edits even if the musical data remained partially dubious.
4. Measure edits were not recording structured `previousValue` and `newValue` snapshots in `omr_audit_history`.

Following Phase 1A-R3.2:
- Strict Zod validation schemas (`NoteDetectedSchema`, `ChordDetectedSchema`, `LyricDetectedSchema`) validate all musical properties with boundary enforcement.
- Destructive `.default([])` and `.default(1)` fallbacks are completely removed from the request schema.
- True RFC-compliant PATCH semantics are implemented: omitted fields in the request body are preserved exactly from the persisted measure.
- Measure confidence is preserved unless explicitly updated.
- Every measure modification atomically records a granular diff in `omr_audit_history` capturing `previousValue` and `newValue`.

---

## 2. STRICT SCHEMA DEFINITIONS & ROUTE HARDENING

In `backend/src/interfaces/http/routes/omr.routes.ts`:

### 2.1 Domain Element Schemas
```typescript
const NoteDetectedSchema = z.object({
  step: z.string().min(1).max(2).regex(/^[A-G]$/i, 'Nota musical debe ser una letra de A a G'),
  octave: z.number().int().min(0).max(9),
  alter: z.number().int().min(-2).max(2).optional(),
  durationTicks: z.number().int().positive('La duración en ticks debe ser positiva'),
  type: z.enum(['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th']),
  isRest: z.boolean().optional(),
  startTick: z.number().int().min(0),
  voice: z.number().int().positive().optional(),
  staff: z.number().int().positive().optional(),
});

const ChordDetectedSchema = z.object({
  root: z.string().min(1).max(2).regex(/^[A-G][#b]?$/i, 'Tónica debe ser A-G con alteración opcional'),
  quality: z.string().min(1).max(30),
  bass: z.string().regex(/^[A-G][#b]?$/i).optional(),
  startTick: z.number().int().min(0),
});

const LyricDetectedSchema = z.object({
  text: z.string().min(1),
  syllabic: z.enum(['single', 'begin', 'middle', 'end']).optional(),
  startTick: z.number().int().min(0),
});
```

### 2.2 PATCH Request Body Schema (Defaults Removed)
```typescript
const PatchMeasureBodySchema = z.object({
  notesDetected: z.array(NoteDetectedSchema).optional(),
  chordsDetected: z.array(ChordDetectedSchema).optional(),
  lyricsDetected: z.array(LyricDetectedSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
```

Notice that none of these fields use `.default(...)`. If the client omits `chordsDetected`, it is received as `undefined`, signaling to the repository layer that existing chords must not be modified.

---

## 3. ATOMIC REPOSITORY PATCH & AUDIT LOGGING

In `backend/src/repositories/omr-proposal-repository.ts`, `updateMeasure` implements atomic differential update and audit recording:

```typescript
async updateMeasure(
  proposalId: string,
  measure: Partial<OmrMeasureProposal> & { measureNumber: number },
  requestingUser: AuthenticatedUser
): Promise<OmrMeasureProposal> {
  return await this.db.transaction(async (tx) => {
    // 1. Fetch current persisted measure
    const [existing] = await tx
      .select()
      .from(omrMeasures)
      .where(and(eq(omrMeasures.proposalId, proposalId), eq(omrMeasures.measureNumber, measure.measureNumber)));

    if (!existing) {
      throw new NotFoundError(`Compás ${measure.measureNumber} no encontrado en propuesta ${proposalId}`);
    }

    const previousValue = {
      measureNumber: existing.measureNumber,
      notesDetected: existing.notesDetected,
      chordsDetected: existing.chordsDetected,
      lyricsDetected: existing.lyricsDetected,
      confidence: existing.confidence,
    };

    // 2. Safe merge: Omitted fields preserve existing values
    const mergedNotes = measure.notesDetected !== undefined ? measure.notesDetected : existing.notesDetected;
    const mergedChords = measure.chordsDetected !== undefined ? measure.chordsDetected : existing.chordsDetected;
    const mergedLyrics = measure.lyricsDetected !== undefined ? measure.lyricsDetected : existing.lyricsDetected;
    const mergedConfidence = measure.confidence !== undefined ? measure.confidence : existing.confidence;

    // 3. Persist update
    await tx
      .update(omrMeasures)
      .set({
        notesDetected: mergedNotes,
        chordsDetected: mergedChords,
        lyricsDetected: mergedLyrics,
        confidence: mergedConfidence,
      })
      .where(and(eq(omrMeasures.proposalId, proposalId), eq(omrMeasures.measureNumber, measure.measureNumber)));

    const newValue = {
      measureNumber: measure.measureNumber,
      notesDetected: mergedNotes,
      chordsDetected: mergedChords,
      lyricsDetected: mergedLyrics,
      confidence: mergedConfidence,
    };

    // 4. Record granular audit diff
    await tx.insert(omrAuditHistory).values({
      id: crypto.randomUUID(),
      proposalId,
      userId: requestingUser.id,
      action: 'UPDATE_MEASURE',
      measureNumber: measure.measureNumber,
      previousValue: JSON.stringify(previousValue),
      newValue: JSON.stringify(newValue),
      metadata: JSON.stringify({ updatedFields: Object.keys(measure).filter(k => k !== 'measureNumber') }),
      createdAt: new Date(),
    });

    return {
      measureNumber: existing.measureNumber,
      timeSignature: existing.timeSignature,
      keySignature: existing.keySignature,
      notesDetected: mergedNotes as NoteDetected[],
      chordsDetected: mergedChords as ChordDetected[],
      lyricsDetected: mergedLyrics as LyricDetected[],
      confidence: mergedConfidence,
    };
  });
}
```

---

## 4. AUTOMATED TEST EVIDENCE

Tests executed in `backend/src/__tests__/omr-persistence-and-integrity.test.ts` (Section 21):

| Test ID | Description | PATCH Payload | Verification | Status |
| :--- | :--- | :--- | :--- | :--- |
| **21.1** | Preserve notes, chords, lyrics when PATCH specifies only measureNumber | `{}` | All notes, chords, lyrics, and confidence unchanged | **PASS** |
| **21.2** | Preserve chords and lyrics when PATCH updates only notes | `{ notesDetected: [G4] }` | Notes updated to G4; chords (`Cmaj`) and lyrics (`"A-le"`) preserved | **PASS** |
| **21.3** | Preserve previous confidence and do not artificially inflate to 1 | `{ notesDetected: [A4] }` (omitting confidence) | Confidence preserved at initial `0.65`, not inflated to `1.0` | **PASS** |
| **21.4** | Record detailed previousValue and newValue in omr_audit_history on PATCH | `{ chordsDetected: [Am] }` | `previousValue.chordsDetected[0].root == 'C'`, `newValue.chordsDetected[0].root == 'Am'`, action `'UPDATE_MEASURE'` | **PASS** |
| **21.5** | Throw NotFoundError when updating non-existent measure number | `measureNumber: 999` | Handled cleanly with `NotFoundError` (HTTP 404) | **PASS** |

All tests passed with 100% success rate.

