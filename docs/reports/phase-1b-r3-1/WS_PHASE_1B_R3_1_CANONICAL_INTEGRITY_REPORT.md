# WORSHIP STUDIO — PHASE 1B-R3.1
## CANONICAL DOMAIN INTEGRITY & RENDERING ISOLATION REPORT

**Document ID:** `WS_PHASE_1B_R3_1_CANONICAL_INTEGRITY_REPORT.md`  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Base Commit:** `2277f311a11350df62d6e367262119d06dfec977`  
**Execution Timestamp:** 2026-11-07T12:42:30-05:00  
**Phase:** 1B-R3.1 — Final Musical Fidelity Remediation & Git Governance Verification  
**Implementation Agent:** Antigravity (Principal Software Engineer & Systems Architect)  

---

## 1. UNKNOWN VS. INVALID METADATA CONTRACT

In Bethesda Worship Studio, canonical representations maintain strict differentiation between:
1. **Known Verified Metadata:** Explicitly declared in the musical source (e.g. `{time: 3/4}`, `{key: D}`, `<sound tempo="110"/>`).
2. **Unknown / Unresolved Metadata:** Absent from the source (e.g. an unmetered lead sheet, a folk chant without tempo). Represented as `null` in canonical models (`timeSignature: null`, `keySignature: null`, empty `TempoMap.events`).
3. **Invalid / Corrupted Metadata:** Present in the source but syntactically or semantically malformed (e.g. `{time: 99/99}`, `<step>Z</step>`). Rejected from canonical models, resolved to `null`, and captured as actionable `WARNING` diagnostics with exact file/line/measure provenance.

### Tri-State Matrix:

| Domain Field | Known | Unknown (Missing) | Invalid (Malformed) |
| :--- | :--- | :--- | :--- |
| **`timeSignature`** | `TimeSignature(beats, beatType)` | `null` (`isUnmetered: true`) | `null` (`INVALID_TIME_SIGNATURE` warning) |
| **`keySignature`** | `KeySignatureReference(tonic, mode)` | `null` | `null` (`INVALID_KEY_SIGNATURE` warning) |
| **`tempoMap`** | `TempoMap([TempoEvent(...)])` | `TempoMap([])` (`isUnresolved: true`) | `TempoMap([])` (`UNRESOLVED_TEMPO` info) |
| **`timeline.totalDurationSeconds`** | `number` (seconds) | `null` | `null` |
| **`note.pitch`** | `Pitch(NoteName, octave)` | Rejected (diagnostic emitted) | Rejected (diagnostic emitted) |
| **`note.durationTicks`** | `number >= 1` | Rejected (diagnostic emitted) | Rejected (diagnostic emitted) |

---

## 2. NULL PRESERVATION & UNMETERED TIMELINE BEHAVIOR

### 2.1 Timeline Invariants
In [`timeline.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/canonical-model/timeline.ts):
```typescript
public get totalDurationSeconds(): number | null {
  if (this.tempoMap.isUnresolved) {
    return null;
  }
  return this.tempoMap.tickToSeconds(this.totalDurationTicks);
}
```
When tempo events are absent, `totalDurationSeconds` evaluates to `null`. It never fabricates an estimated duration using an assumed 120 BPM.

### 2.2 Measure Invariants
In [`measure.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/canonical-model/measure.ts):
```typescript
public readonly timeSignature: TimeSignature | null;
public readonly keySignature: KeySignatureReference | null;
```
Both properties are strictly typed as nullable. Initializing a measure with `timeSignature: null` and `keySignature: null` preserves genuine unmetered / unresolved state.

### 2.3 Validator Invariants
In [`validator.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/canonical-model/validator.ts):
```typescript
if (measure.timeSignature) {
  const expectedDuration = measure.timeSignature.calculateMeasureDurationTicks();
  if (measure.durationTicks !== expectedDuration) {
    errors.push({ code: 'MEASURE_DURATION_MISMATCH', ... });
  }
}
```
If `measure.timeSignature` is `null`, duration validation dynamically accommodates the measure's actual duration ticks without throwing duration mismatch errors.

---

## 3. SERIALIZATION & DESERIALIZATION FIDELITY

All unresolved metadata survives JSON round-trips without normalization or loss:

1. **`Measure.toJSON()` & `Measure.fromJSON()`:**
   - `timeSignature: null` serializes to `"timeSignature": null` and deserializes to `measure.timeSignature === null`.
   - `keySignature: null` serializes to `"keySignature": null` and deserializes to `measure.keySignature === null`.
2. **`Timeline.toJSON()` & `Timeline.fromJSON()`:**
   - `"isUnmetered": true` serializes only when `this.isUnmetered === true` and rehydrates accurately.
   - Unresolved `TempoMap` (`events: []`) serializes to `"events": []` and deserializes to `tempoMap.isUnresolved === true`.

---

## 4. RENDERING ADAPTER IMMUTABILITY & DISPLAY FALLBACKS

Rendering engines often require display conventions to render visual elements (e.g. staff clefs, measure bars). In Bethesda Worship Studio, presentation fallbacks are **one-way, read-only transformations** that **never write back to canonical data**:

1. **LeadSheet DOM Adapter ([`leadsheet-dom-adapter.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/adapters/leadsheet-dom-adapter.ts)):**
   - When `measure.timeSignature === null`, formats visual meter indicator as `'—'` (unmetered em-dash).
   - Preserves 0 melody notes without inventing rests or notes.
2. **AlphaTab Adapter ([`alphatab-adapter.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/adapters/alphatab-adapter.ts)):**
   - Uses temporary presentation string for AlphaTab rendering without altering the input `DerivedMusicalView`.
3. **OSMD Adapter ([`osmd-adapter.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/adapters/osmd-adapter.ts)):**
   - Converts `timeSignature` to OSMD format, using visual fallback for notation renderer while keeping canonical entities untouched.

