# WORSHIP STUDIO — PHASE 1B-R
## MUSICAL INTEGRITY & METADATA FIDELITY REPORT

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R — Remediation Only  
**Workstream:** Workstream B — Musical Metadata Integrity  
**Author:** Antigravity (Music Information Retrieval & Software Architecture)  
**Date:** 2026-11-05  

---

## 1. NON-NEGOTIABLE CORE PRINCIPLE: ZERO MUSICAL GUESSING

In Phase 1B, default values were inadvertently injected when sources omitted essential musical metadata (e.g., defaulting to Key `'C'`, Meter `'4/4'`, or Tempo `120 BPM`). In liturgical and professional music applications, this fabrication is unacceptable:
1. If a worship leader imports a chord chart in G major without an explicit `{key}` tag, assuming C major corrupts transposition algorithms.
2. If a MIDI file omits tempo (Meta 0x51), assuming 120 BPM creates a false expectation when played back in rehearsal.
3. If an audio or visual score cannot be transcribed by an active AI engine, generating an empty score with 0 measures and 4/4 meter misleads musicians into believing a score was successfully imported.

**Phase 1B-R Invariant:**
> Musical integrity has priority over producing an apparently complete score. When metadata is undeclared in the source, it must remain strictly `null`, accompanied by explicit diagnostic codes for human verification.

---

## 2. METADATA STATUS ACROSS INGESTION ADAPTERS

The following table documents how undeclared musical parameters are handled in Phase 1B-R compared to Phase 1B:

| Ingestion Channel | Missing Metadata | Phase 1B (Defective) | Phase 1B-R (Remediated) | Diagnostics Generated | Ingestion Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MIDI** | Tempo (0x51 missing) | Defaulted to `120` | `defaultBpm: null` | `MISSING_TEMPO` | `PARTIALLY_CONVERTED` |
| **MIDI** | Time Signature (0x58 missing) | Defaulted to `'4/4'` | `timeSignature: null` | `MISSING_TIME_SIGNATURE` | `PARTIALLY_CONVERTED` |
| **MIDI** | Key Signature (0x59 missing) | Defaulted to `'C'` | `defaultKey: null` | `MISSING_KEY_SIGNATURE` | `PARTIALLY_CONVERTED` |
| **MusicXML** | `<key>` absent | Defaulted to `'C'` | `defaultKey: null` | `MISSING_KEY_SIGNATURE` | `PARTIALLY_CONVERTED` |
| **MusicXML** | `<time>` absent | Defaulted to `'4/4'` | `timeSignature: null` | `MISSING_TIME_SIGNATURE` | `PARTIALLY_CONVERTED` |
| **MusicXML** | `<sound tempo>` absent | Defaulted to `120` | `defaultBpm: null` | `MISSING_TEMPO` | `PARTIALLY_CONVERTED` |
| **ChordPro** | `{key}` absent | Defaulted to `'C'` | `defaultKey: null` | `MISSING_KEY_SIGNATURE` | `PARTIALLY_CONVERTED` |
| **ChordPro** | `{time}` absent | Defaulted to `'4/4'` | `timeSignature: null` | `MISSING_TIME_SIGNATURE` | `PARTIALLY_CONVERTED` |
| **ChordPro** | `{tempo}` absent | Defaulted to `120` | `defaultBpm: null` | `MISSING_TEMPO` | `PARTIALLY_CONVERTED` |
| **Written Notes** | `keySignature` absent | Defaulted to `'C'` | `defaultKey: null` | `MISSING_KEY_SIGNATURE` | `PARTIALLY_CONVERTED` |
| **Audio File** | Note recognition | Fabricated 0 notes | `canonicalPayload: null` | `RECOGNITION_UNAVAILABLE` | `RECOGNITION_UNAVAILABLE` |
| **Visual Score** | OMR recognition | Fabricated 0 notes | `canonicalPayload: null` | `RECOGNITION_UNAVAILABLE` | `RECOGNITION_UNAVAILABLE` |
| **Video URL** | Transcription | Fabricated 0 notes | `canonicalPayload: null` | `VIDEO_URL_REGISTERED` | `REGISTERED` |

---

## 3. STATUS TAXONOMY & TRANSITIONS

In `backend/src/domain/ingestion/types.ts`, `IngestionStatus` explicitly discriminates between levels of conversion fidelity:

```typescript
export type IngestionStatus =
  | 'IMPORTED'
  | 'PARSED'
  | 'SOURCE_PRESERVED'
  | 'REGISTERED'
  | 'RECOGNITION_PENDING'
  | 'RECOGNITION_UNAVAILABLE'
  | 'PARTIALLY_CONVERTED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'PENDING_REVIEW'
  | 'CONVERTED'
  | 'FAILED';
```

- **`CONVERTED`:** Complete conversion. Musical notes, time signature, key signature, and tempo were fully declared and resolved into `CanonicalMusicPayload`.
- **`PARTIALLY_CONVERTED`:** Musical notes and measures were successfully extracted, but one or more structural attributes (key, meter, tempo) were absent in the source. Canonical version is persisted with `null` fields awaiting human review.
- **`REGISTERED`:** The source was registered as an external resource (e.g. YouTube/Vimeo video link). No score is created.
- **`SOURCE_PRESERVED`:** The raw file or document is securely preserved in storage and indexed in `song_sources`, without generating an empty or fictitious score.
- **`RECOGNITION_UNAVAILABLE`:** Honest status returned when an unconfigured inference capability (OMR or audio pitch tracking) is requested.

---

## 4. LEADSHEET INVARIANT: ZERO FAKE MELODY NOTES

For chord charts and lyrics-with-chords formats (e.g. ChordPro):
- The model treats chord charts strictly as harmonic guides (Lead Sheets).
- **Invariant:** `totalNotes === 0`.
- Under no circumstance does the parser inject arbitrary C4 quarter notes or rests to populate voices.
- Chords are anchored to lyrical syllables via character offsets and mapped to canonical `ChordEvent` instances with precise measure boundaries.

---

## 5. USER METADATA OVERRIDE HANDLING

When a user or client application provides explicit musical metadata during ingestion (e.g., specifying `keySignature: 'F#m'`, `timeSignature: { numerator: 3, denominator: 4 }`, or `tempoBpm: 84`):
1. The explicit declaration takes precedence over source omission.
2. An informative diagnostic `USER_METADATA_OVERRIDE` or `EXPLICIT_METADATA_SUPPLIED` is attached.
3. The resulting song achieves `CONVERTED` status without triggering missing metadata warnings.

