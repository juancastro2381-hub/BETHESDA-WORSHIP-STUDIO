# WORSHIP STUDIO — PHASE 1B-R
## MIDI INGESTION, PARSING ROBUSTNESS & NON-DESTRUCTIVE QUANTIZATION REPORT

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R — Remediation Only  
**Workstream:** Workstream C — MIDI Robustness & Quantization  
**Author:** Antigravity (Music Information Retrieval & Software Architecture)  
**Date:** 2026-11-05  

---

## 1. EXECUTIVE SUMMARY

The Phase 1B implementation of the Standard MIDI File (SMF) parser and adapter contained several critical defects that compromised musical fidelity:
1. **Note Duration Truncation:** Notes sustaining across measure boundaries were clamped to the end of the measure via `Math.min(duration, maxAllowedDuration)`, destroying legatos and ties.
2. **Arbitrary 15-Tick Floor:** Notes shorter than 15 ticks were artificially stretched to 15 ticks (`Math.max(15, ticks)`).
3. **Arbitrary Quarter Note Fabrication:** Unmatched `Note-On` events at the end of a track were assigned an arbitrary duration of 480 ticks (1 quarter note).
4. **Running Status Corruption:** Meta-events and SysEx messages did not cancel the running status byte, leading to state desynchronization.
5. **Unbounded VLQ Reads:** Variable-length quantities could loop indefinitely or overflow on corrupt input.

All five defects have been completely remediated and verified with automated regression tests.

---

## 2. DETAILED REMEDIATION ANALYSIS

### 2.1 Non-Destructive Measure Crossing via Tied Notes (Zero Truncation)
- **Previous Defect:** A whole note (1920 ticks in 4/4) starting on beat 3 (tick 960) was truncated to 960 ticks to avoid crossing the measure boundary at tick 1920.
- **Remediation:** In `backend/src/domain/ingestion/adapters/midi/midi-adapter.ts`, notes crossing measure boundaries are dynamically partitioned into tied segments:
  - Compás 1 segment: tick 960..1920 (960 ticks), `tie: 'START'`.
  - Compás 2 segment: tick 1920..3360 (1440 ticks), `tie: 'STOP'`.
  - If a note crosses three or more measures, intermediate segments receive `tie: 'CONTINUE'`.
- **Mathematical Invariant:**
  $$\sum_{i=1}^{N} \text{segmentDuration}_{i} \equiv \text{originalDurationTicks}$$
  Zero ticks are truncated or lost.

### 2.2 Removal of the Arbitrary 15-Tick Floor
- **Previous Defect:** `Math.max(15, canonicalTicks)` distorted 32nd notes, 64th notes, grace notes, and flam strokes.
- **Remediation:** Changed to `Math.max(1, canonicalTicks)`. A 1-tick note in 480 TPQN is accurately preserved as duration 1. Verified by test `C1.2`.

### 2.3 Handling of Unclosed Note-On at End of Track
- **Previous Defect:** If a MIDI track reached End-Of-Track (`0xFF 0x2F 0x00`) with an active unreleased `Note-On`, the parser fabricated an arbitrary quarter note (`480 ticks`).
- **Remediation:** In `MidiParser.parse()`, any unclosed `Note-On` event is bounded strictly to the actual remaining ticks between the note's start tick and the track's final tick (`trackEndTick - noteStartTick`). The event is tagged with diagnostic code `UNMATCHED_NOTE_ON`. Verified by test `C1.3`.

### 2.4 Handling of Unmatched Note-Off Messages
- If a `Note-Off` or `Note-On (velocity = 0)` occurs without an active `Note-On` on that channel/pitch, the parser safely logs diagnostic `UNMATCHED_NOTE_OFF` and continues processing without throwing an uncaught exception or corrupting the polyphonic stack.

### 2.5 Strict Running Status Lifecycle
- **MIDI Specification Rule:** Channel voice messages (`0x80` through `0xEF`) set the running status. Meta-events (`0xFF`) and System Exclusive messages (`0xF0`, `0xF7`) **cancel** running status immediately.
- **Remediation:** In `MidiParser.parse()`:
  ```typescript
  if ((statusByte & 0x80) !== 0) {
    if (statusByte >= 0x80 && statusByte <= 0xef) {
      lastStatusByte = statusByte;
    } else {
      // Meta-events (0xFF) and SysEx (0xF0, 0xF7) reset running status
      lastStatusByte = 0;
    }
  } else {
    if (lastStatusByte === 0) {
      throw new ValidationError(`Running status MIDI inválido en offset ${offset}: no hay status previo.`);
    }
    statusByte = lastStatusByte;
  }
  ```
  Verified by test `C1.4`.

### 2.6 Bounded Variable-Length Quantity (VLQ) Reads
- **MIDI Specification Rule:** A VLQ represents at most a 28-bit unsigned integer using up to 4 bytes.
- **Remediation:** In `MidiParser.readVlq()`, a loop counter `byteCount` is maintained. If `byteCount > 4`, parsing aborts immediately with a `ValidationError`:
  ```typescript
  if (byteCount > 4) {
    throw new ValidationError(
      `Desbordamiento de VLQ en offset ${offset}: una cantidad de longitud variable MIDI no puede exceder 4 bytes (28 bits).`
    );
  }
  ```
  Verified by test `C1.5`.

---

## 3. MULTI-TEMPO & DYNAMIC TIME SIGNATURE ADAPTATION

`MidiAdapter` constructs an accurate `Timeline` and `TempoMap`:
1. **Dynamic Measure Allocation:** Measure boundaries are computed based on explicit `TimeSignatureEvent` entries across the timeline. If the time signature changes from 4/4 to 3/4 at measure 9, subsequent measures are generated with 1440 ticks instead of 1920 ticks.
2. **Multi-Tempo Preservation:** Multiple `TempoEvent` occurrences are registered in the `TempoMap` in strictly ascending tick order.
3. **Instrument Track Identification:** Program change numbers (`0xCn`) and MIDI channels (Channel 9 / 10 for drums/percussion) map tracks to their canonical `InstrumentFamily` (`KEYS`, `GUITAR`, `BASS`, `DRUMS`, `VOCALS`, `STRINGS`, `BRASS`, `WOODWINDS`, `OTHER`).

