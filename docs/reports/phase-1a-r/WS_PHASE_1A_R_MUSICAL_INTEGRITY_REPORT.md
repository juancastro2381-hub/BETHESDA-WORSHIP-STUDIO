# WORSHIP STUDIO — PHASE 1A-R
# MUSICAL INTEGRITY REPORT: ZERO-FABRICATION & SYMBOLIC PRECISION

**Project:** Bethesda Worship Studio  
**Phase:** 1A-R — Controlled Remediation & Independent Certification Readiness  
**Domain:** Music Information Retrieval (MIR) & Optical Music Recognition (OMR) Symbolic Engine  
**Execution Date:** 2026-11-02  
**Status:** FULLY RECONCILED & ENFORCED  

---

## 1. THE ZERO-FABRICATION PHILOSOPHY IN SACRED & CONTEMPORARY MUSIC

In worship music platforms, musical transcription errors have direct, disruptive consequences:
1. **Key Fabrication (e.g. Silent Fallback to C Major):**
   - If a song originally in F# Major or Eb Major is silently imported as C Major, vocal leaders will find vocal lines pitched completely outside congregationally accessible tessituras (e.g., Soprano reaching unsingable intervals or Baritone bottoming out).
   - In live team settings, musicians attempting to play from an erroneous C Major chart while the worship team is in Eb Major produces immediate acoustic dissonance.
2. **Meter Fabrication (e.g. Silent Fallback to 4/4):**
   - A 6/8 ballad or a 3/4 communion hymn forced into 4/4 results in broken metric subdivision, misaligned downbeats, and barline corruption.
3. **Tempo Fabrication (e.g. Silent Fallback to 120 BPM):**
   - A reflective prayer song at 62 BPM forced to 120 BPM doubles playback speed and click tracks, rendering backing tracks unusable.
4. **Duration Guessing (e.g. Defaulting Unknown Tokens to Quarter Notes / 480 Ticks):**
   - Rhythmic syncopation, dotted rhythms, and triplets become distorted, ruining lead sheet synchronization.

**Rule of Zero Fabrication:**
> *WORSHIP STUDIO must never invent, assume, or fabricate musical parameters that cannot be resolved with certainty from the musical source or from explicit, validated human input.*

---

## 2. METRIC SUBDIVISION & TIME SIGNATURE PRECISION

### 2.1 Standard vs Compound Metrics
Musical time signatures define the subdivision of ticks per measure (at 480 PPQ / Parts Per Quarter Note):

$$\text{Quarter Note Duration} = 480 \text{ ticks}$$

- **Simple Triple Meter (3/4):**
  $$\text{Measure Duration} = 3 \times 480 = 1440 \text{ ticks}$$
  Subdivided into 3 quarter beats of 480 ticks each.
- **Compound Duple Meter (6/8):**
  $$\text{Measure Duration} = 6 \times \left(\frac{480}{2}\right) = 1440 \text{ ticks}$$
  Subdivided into 2 primary dotted-quarter beats of 720 ticks each:
  $$\text{Beat 1} = [0, 720), \quad \text{Beat 2} = [720, 1440)$$
- **Simple Quadruple Meter (4/4):**
  $$\text{Measure Duration} = 4 \times 480 = 1920 \text{ ticks}$$

### 2.2 Verification in Code
In [`backend/src/application/omr-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/omr-service.ts#L400-L425), time signatures are parsed directly into explicit `TimeSignature` domain instances:
- For `6/8`: `numerator = 6`, `denominator = 8`, `beatDurationTicks = 720` (dotted quarter).
- For `3/4`: `numerator = 3`, `denominator = 4`, `beatDurationTicks = 480`.
- In [`omr-persistence-and-integrity.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/omr-persistence-and-integrity.test.ts#L265-L355):
  - Test 2.1 validates 3/4 produces exactly 1440 ticks.
  - Test 2.2 validates 6/8 produces 1440 ticks with 720-tick primary beats.

### 2.3 Strict Rejection of Unresolved Time Signatures
If an OMR scan cannot detect a time signature and the human reviewer provides no override:
- **Phase 1A Behavior:** Fell back to `4/4` silently.
- **Phase 1A-R Behavior:** Rejects commit with:
  `ValidationError: No se puede comprometer al catálogo canónico: Métrica de compás no resuelta en la partitura. Especifique una anulación explícita.` (Verified in Test 2.3).

---

## 3. TONALITY & KEY SIGNATURE RESOLUTION

### 3.1 Circle of Fifths Representation
Key signatures in WORSHIP STUDIO are parsed into canonical Circle-of-Fifths fifths count:
- `C Major / A Minor`: 0 fifths
- `G Major / E Minor`: +1 fifth (F#)
- `D Major / B Minor`: +2 fifths (F#, C#)
- `F Major / D Minor`: -1 fifth (Bb)
- `Eb Major / C Minor`: -3 fifths (Bb, Eb, Ab)

### 3.2 Pitch Alteration Preservation
- Natural notes: `alter = 0`
- Sharps: `alter = 1` (e.g. F#4)
- Flats: `alter = -1` (e.g. Bb3)
- Double sharps / flats: `alter = ±2`

The domain serializer encodes pitch accurately as `NoteName(letter, accidental)` with exact octave numbers (e.g. F#4 = octave 4, alter 1). Unresolvable note glyphs (smudges, blur) are **never** replaced with note C; they are omitted from notes and flagged in `unrecognizedRegions` (Verified in Tests 4.1 & 4.2).

### 3.3 Strict Rejection of Unresolved Key
If key is absent:
- **Phase 1A Behavior:** Defaulted to `C Major`.
- **Phase 1A-R Behavior:** Rejects commit with:
  `ValidationError: No se puede comprometer al catálogo canónico: Tonalidad musical no resuelta en la partitura. Especifique una anulación explícita.` (Verified in Test 3.2).

---

## 4. TEMPO (BPM) GOVERNANCE

Tempo dictates audio-to-score synchronization, metronome clicks, and digital music stand autoscroll:
- Minimum valid tempo: 30 BPM
- Maximum valid tempo: 300 BPM
- If tempo cannot be detected from tempo markings (e.g. "Allegro", "Quarter = 72"):
  - **Phase 1A Behavior:** Defaulted to `120 BPM`.
  - **Phase 1A-R Behavior:** Rejects commit with:
    `ValidationError: No se puede comprometer al catálogo canónico: Tempo (BPM) no resuelto en la partitura. Especifique una anulación explícita.` (Verified in Test 2.4).

---

## 5. RHYTHMIC DURATION & CHORD PARSING INTEGRITY

### 5.1 Exact Tick Conversion Table (PPQ = 480)
| Figure Token | Base Ticks | Dotted (* 1.5) | Triplet (* 2/3) |
| :--- | :--- | :--- | :--- |
| `whole` | 1920 | 2880 | 1280 |
| `half` | 960 | 1440 | 640 |
| `quarter` | 480 | 720 | 320 |
| `eighth` | 240 | 360 | 160 |
| `16th` | 120 | 180 | 80 |
| `32nd` | 60 | 90 | 40 |

### 5.2 Zero Duration Guessing
In `OmrService.parseDurationTicks`:
If a token is unrecognized (e.g. `corrupt-duration-token`):
- **Phase 1A Behavior:** Returned 480 ticks.
- **Phase 1A-R Behavior:** Throws `ValidationError: Duración de nota no reconocida: corrupt-duration-token` (Verified in Test 6.2).

### 5.3 Non-Destructive Chord Flagging
When an OMR scan identifies chord symbols that fail standard jazz/lead-sheet grammar (e.g. `ILEGIBLE_???/13b9#`):
- In `OmrService.processUpload`: Evaluates chords; if `Chord.parse` throws, the measure is immediately flagged with `UNPARSED_CHORD:<rawText>`.
- The raw chord text is preserved in `omr_proposal_measures.chords_detected` for human manual editing in the UI.
- No silent fallback or empty `catch {}` block is permitted.

---

## 6. LYRIC SYLLABLE ALIGNMENT & EMPTY MEASURE REST FILLING

- **Lyric Syllable Alignment:**
  Instead of stacking all syllables at tick 0 (which causes lyric overlapping in digital music stands), syllables are aligned across recognized notes or beat offsets:
  $$\text{Syllable Tick} = \text{Measure Start} + \text{Note Offset}$$
  Verified in Test 8.1.
- **Empty Measure Rest Filling:**
  If an OMR scan recognizes an empty measure (e.g. 2 bars of rest before verse), the system inserts an explicit `REST` event covering the exact measure duration (e.g. 960 ticks in 2/4 meter), preventing duration collapse. Verified in Test 7.1.

---

## 7. HUMAN-IN-THE-LOOP MANDATE

No AI-generated draft may bypass human review:
1. Every proposal is initialized with `reviewStatus = 'PENDING_REVIEW'`.
2. Any measure with confidence $< 0.70$ is tagged `LOW_CONFIDENCE`.
3. Canonical commit requires explicit status `'APPROVED_FOR_IMPORT'`.
4. Overrides for title, key, time signature, and BPM are validated using Zod (`CommitToSongOverridesSchema`).

---
*End of Phase 1A-R Musical Integrity Report.*

