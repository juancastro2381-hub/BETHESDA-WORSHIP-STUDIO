# WORSHIP STUDIO — PHASE 1A OMR MUSICAL INTEGRITY REPORT
## Forensic Remediation of the Ten OMR Ingestion Code Defects

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Primary Target:** `backend/src/application/omr-service.ts`  
**Standard TPQN:** 480 Ticks Per Quarter Note (Canonical Music Model)  
**Date:** November 2026  

---

## 1. Context and Problem Statement

During the Phase 0 and Phase 0A-0E architecture audits, an exhaustive inspection of `backend/src/application/omr-service.ts` revealed that while the high-level OMR application service enforced human review gating (`isAiDraft: true`), its underlying canonical conversion function (`convertProposalToCanonical`) harbored ten severe musical integrity defects.

These defects introduced silent note substitutions, destroyed non-4/4 time signatures, forced all scores into C Major regardless of their detected key, erased sharps and flats, collapsed all lyric syllables onto tick 0, swallowed harmonic recognition errors, and hardcoded 480-tick fallback durations for complex rhythmic figures.

In Phase 1A, all ten defects have been comprehensively remediated. This report provides mathematical proofs, before-and-after code diffs, and verification evidence for each defect.

---

## 2. Forensic Analysis and Remediation of the Ten Code Defects

### Defect 1: Hardcoded 4/4 Time Signature & Measure Duration

- **Defective Code:**
  ```typescript
  const timeSig = TimeSignature.FOUR_FOUR;
  const measureDurationTicks = timeSig.calculateMeasureDurationTicks(); // Always 1920 ticks
  ```
- **Musical Impact:** Scores composed in waltz time ($3/4$), compound duple ($6/8$), cut time ($2/2$), or march time ($2/4$) were violently distorted. In a $3/4$ piece, measures should be $1440$ ticks:
  $$\text{Ticks}_{3/4} = \frac{3 \times (480 \times 4)}{4} = 1440 \text{ ticks}$$
  Hardcoding $1920$ ticks created a $480$-tick drift per measure, desynchronizing playback, chords, and visual cursor tracking.
- **Remediated Implementation:**
  ```typescript
  // Initial proposal metric resolution
  let currentTimeSig = TimeSignature.FOUR_FOUR;
  if (proposal.detectedTimeSignature) {
    try {
      currentTimeSig = TimeSignature.parse(proposal.detectedTimeSignature);
    } catch {
      currentTimeSig = TimeSignature.FOUR_FOUR;
    }
  }
  // Inside measure loop: measure-level metric variation support
  if (mProp.timeSignature) {
    try {
      currentTimeSig = TimeSignature.parse(mProp.timeSignature);
    } catch {
      mProp.flags = mProp.flags ?? [];
      mProp.flags.push('UNRESOLVED_TIME_SIGNATURE');
    }
  }
  const measureDurationTicks = currentTimeSig.calculateMeasureDurationTicks();
  ```
- **Verification Evidence:** Test `2.1` verified a $3/4$ score yields exactly $1440$ ticks per measure. Test `2.2` verified a $6/8$ score yields $1440$ ticks with compound primary beats of $720$ ticks.

---

### Defect 2: Hardcoded KeySignature(0) / Erasure of Tonal Identity

- **Defective Code:**
  ```typescript
  const rawKey = (proposal.detectedKey || 'C').toUpperCase();
  const noteNameKey = (NoteName as any)[rawKey] ?? NoteName.C;
  const keySigRef = new KeySignatureReference(
    noteNameKey,
    'MAJOR',
    new KeySignature(0) // ALWAYS 0 accidentals (Do Mayor / La menor)!
  );
  ```
- **Musical Impact:** Even when the OMR engine correctly identified a key signature such as G Major ($+1$ sharp: F#) or Eb Major ($-3$ flats: Bb, Eb, Ab), the code forced `KeySignature(0)`. This stripped the circle-of-fifths accidental context required for proper enharmonic rendering and transposition.
- **Remediated Implementation:**
  ```typescript
  const keyCandidate = keyOverride || proposal.detectedKey || 'C';
  let currentKeySigRef: KeySignatureReference;
  try {
    const parsedKey = MusicalKey.parse(keyCandidate);
    currentKeySigRef = KeySignatureReference.fromMusicalKey(parsedKey);
  } catch {
    currentKeySigRef = new KeySignatureReference(NoteName.C, 'MAJOR', new KeySignature(0));
  }
  // Dynamic measure-level key change support
  if (mProp.keySignature) {
    try {
      const parsedKey = MusicalKey.parse(mProp.keySignature);
      currentKeySigRef = KeySignatureReference.fromMusicalKey(parsedKey);
    } catch {
      mProp.flags = mProp.flags ?? [];
      mProp.flags.push('UNRESOLVED_KEY_SIGNATURE');
    }
  }
  ```
- **Verification Evidence:** Test `3.1` confirmed that a proposal in Eb Major produces a `KeySignature` with `accidentalCount: -3`, preserving the three flats rather than forcing 0.

---

### Defect 3: Silent Fallback of Note Steps to NoteName.C (Musical Fabrication)

- **Defective Code:**
  ```typescript
  const stepName = (NoteName as any)[n.step.toUpperCase()] ?? NoteName.C;
  ```
- **Musical Impact:** Any unrecognized glyph, ink smudge, or unparseable note step was secretly transformed into Middle C. This violated the cardinal Bethesda Worship Studio principle: **ZERO musical fabrication**.
- **Remediated Implementation:**
  ```typescript
  let noteName: NoteName;
  try {
    if (typeof n.alter === 'number') {
      const acc = Accidental.fromSemitones(n.alter);
      const letter = (n.step[0] ?? 'C').toUpperCase() as BaseNoteLetter;
      noteName = new NoteName(letter, acc);
    } else {
      noteName = NoteName.parse(n.step);
    }
  } catch {
    mProp.flags = mProp.flags ?? [];
    mProp.flags.push(`UNRESOLVED_NOTE_GLYPH:${n.step}`);
    continue; // Omit damaged glyph; NEVER invent an artificial C note
  }
  ```
- **Verification Evidence:** Test `4.2` confirmed that corrupted glyphs (`'CORRUPT_GLYPH_#?'`) generate an `UNRESOLVED_NOTE_GLYPH` measure flag and are omitted, yielding exactly 1 valid note instead of fabricating an artificial C.

---

### Defect 4: Erasure of Note Alterations (Sharps and Flats)

- **Defective Code:**
  ```typescript
  const stepName = (NoteName as any)[n.step.toUpperCase()] ?? NoteName.C;
  const pitch = new Pitch(stepName, n.octave);
  ```
- **Musical Impact:** Ignored `n.alter` completely and failed to parse alterations in `n.step` (e.g. `'F#'`, `'Bb'`). An F#4 was rendered as F4 (MIDI 65 instead of MIDI 66); a Bb3 was rendered as B3 (MIDI 59 instead of MIDI 58), causing extreme auditory dissonance.
- **Remediated Implementation:**
  Uses `Accidental.fromSemitones(n.alter)` when numerical alterations are provided, or `NoteName.parse(n.step)` which handles accidentals directly.
- **Verification Evidence:** Test `4.1` verified that F#4 is stored with `pitch.noteName: 'F#'`, `octave: 4` (MIDI 66), and Bb3 is stored with `pitch.noteName: 'Bb'`, `octave: 3` (MIDI 58).

---

### Defect 5: Swallowed Chord Parsing Errors with Empty Catch Block

- **Defective Code:**
  ```typescript
  try {
    const parsed = Chord.parse(c.chord);
    const beatOffset = Math.max(0, (c.beat - 1) * 480);
    // ...
  } catch {
    // Ignorar cifrado ilegible  <-- SILENT EMPTY CATCH
  }
  ```
- **Musical Impact:** When the OMR engine encountered an ambiguous chord symbol (e.g. `C#m7(b5)`, `Dsus4/G`), the failure was silently dropped without flagging the measure or alerting the musician reviewer.
- **Remediated Implementation:**
  ```typescript
  try {
    const parsed = Chord.parse(c.chord);
    const beatOffset = Math.max(0, (c.beat - 1) * currentTimeSig.beatDurationTicks);
    chords.push(new ChordEvent({ ... }));
  } catch (err) {
    mProp.flags = mProp.flags ?? [];
    mProp.flags.push(`UNPARSED_CHORD:${c.chord}`);
  }
  ```
- **Verification Evidence:** Test `5.1` proved that unparseable chord strings are preserved in the measure's diagnostic flags (`UNPARSED_CHORD:ILEGIBLE_???/13b9#`) and captured in audit logs.

---

### Defect 6: Note Duration Fallback to 480 Ticks (Quarter Note)

- **Defective Code:**
  ```typescript
  let durationTicks = 480;
  if (n.duration === 'whole') durationTicks = 1920;
  else if (n.duration === 'half') durationTicks = 960;
  else if (n.duration === 'eighth') durationTicks = 240;
  else if (n.duration === 'sixteenth') durationTicks = 120;
  ```
- **Musical Impact:** Dotted notes (dotted-half = 1440t, dotted-quarter = 720t, dotted-eighth = 360t) and triplets (triplet-quarter = 320t, triplet-eighth = 160t) defaulted to 480 ticks. In a measure with a dotted-half and a quarter note, the measure received $480 + 480 = 960$ ticks instead of $1440 + 480 = 1920$ ticks!
- **Remediated Implementation:**
  Integrated helper `parseDurationTicks()` supporting standard notes (`whole`, `half`, `quarter`, `eighth`, `sixteenth`, `32nd`, `64th`), dotted variants (`dotted-whole` = 2880, `dotted-half` = 1440, `dotted-quarter` = 720, `dotted-eighth` = 360, `dotted-sixteenth` = 180), and tuplets (`triplet-half` = 640, `triplet-quarter` = 320, `triplet-eighth` = 160, `triplet-sixteenth` = 80).
- **Verification Evidence:** Test `6.1` verified exact tick durations for dotted-half ($1440$), dotted-quarter ($720$), and triplet-quarters ($320$).

---

### Defect 7: Empty Measure Rests Hardcoded to 1920 Ticks

- **Defective Code:**
  ```typescript
  const voice = notes.length > 0
    ? new Voice(1, notes)
    : new Voice(1, [
        new Rest({
          id: `omr_rest_${measureNum}`,
          startTick: measureStartTick,
          durationTicks: measureDurationTicks, // which was hardcoded 1920
          voice: 1,
          staff: 1,
        }),
      ]);
  ```
- **Musical Impact:** In a $3/4$ measure ($1440$ ticks) or $2/4$ measure ($960$ ticks) without notes, the rest was set to $1920$ ticks, overflowing the measure boundaries.
- **Remediated Implementation:**
  Rest durations now strictly inherit the dynamically calculated `measureDurationTicks` of the measure's active time signature.
- **Verification Evidence:** Test `7.1` confirmed that an empty measure in $2/4$ receives a rest with exactly $960$ ticks.

---

### Defect 8: All Lyric Syllables Stacked at Tick Offset 0

- **Defective Code:**
  ```typescript
  for (const l of mProp.lyricsDetected) {
    lyrics.push(
      new LyricSyllable({
        id: `omr_syl_${measureNum}_${syllableSeq}`,
        text: l.text,
        measureNumber: measureNum,
        tickOffset: 0, // <-- ALL SYLLABLES STACKED AT TICK 0!
        sequenceNumber: syllableSeq++,
        isHyphenated: l.text.endsWith('-'),
      })
    );
  }
  ```
- **Musical Impact:** All lyric syllables in a measure rendered simultaneously at tick 0, colliding on screen and rendering digital music stand lyric visualization completely unreadable.
- **Remediated Implementation:**
  ```typescript
  let syllableOffset = 0;
  if (typeof l.tickOffset === 'number') {
    syllableOffset = l.tickOffset;
  } else if (typeof l.beat === 'number') {
    syllableOffset = Math.max(0, (l.beat - 1) * currentTimeSig.beatDurationTicks);
  } else if (notes.length > 0 && lIdx < notes.length) {
    // Align with corresponding melodic note
    syllableOffset = notes[lIdx]!.startTick - measureStartTick;
  } else {
    // Proportional distribution across measure duration
    syllableOffset = Math.round((lIdx / lyricCount) * measureDurationTicks);
  }
  ```
- **Verification Evidence:** Test `8.1` verified four syllables aligned with four quarter notes at offsets $0$, $480$, $960$, and $1440$ ticks.

---

### Defect 9: Absence of Low Confidence Measure Gating

- **Defective Code:**
  Proposals with measures possessing confidence $< 0.70$ were treated identically to high-confidence proposals with no visual warnings.
- **Remediated Implementation:**
  During `processUpload()`, all measures with `measureConfidence < 0.70` automatically receive the `'LOW_CONFIDENCE'` flag in `flags`, preventing automatic approval without explicit musician review.
- **Verification Evidence:** Test `9.1` confirmed that a measure with confidence $0.58$ is tagged with `'LOW_CONFIDENCE'`.

---

### Defect 10: Missing Zod Input Schema Validation

- **Defective Code:**
  `processUpload()` accepted any untyped input structure with zero validation on file size boundaries or MIME format integrity.
- **Remediated Implementation:**
  Introduced `OmrRecognitionInputSchema` enforcing non-empty filenames, valid MIME types, and file size constraints ($> 0$ bytes, $\le 25\text{ MB}$), throwing structured `ValidationError` on violations.
- **Verification Evidence:** Test `10.1` verified that 0-byte files or malformed inputs are cleanly rejected with `ValidationError`.

