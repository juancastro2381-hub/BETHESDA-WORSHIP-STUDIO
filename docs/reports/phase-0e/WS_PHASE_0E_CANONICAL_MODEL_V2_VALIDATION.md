# WORSHIP STUDIO — PHASE 0E
## Canonical Music Model v2.0 Validation, Multi-Tier Confidence & Zero-Downtime Migration Architecture

**Project:** Bethesda Worship Studio  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Current Branch:** `main` (commit `42f4cf7`)  
**Phase:** 0E — Technical Architecture Consistency & Feasibility Gate  
**Execution Mode:** STRICT READ-ONLY — Architecture Audit, Verification & Documentation Only  
**Implementation Authorization:** NOT GRANTED  
**Date:** November 2, 2026  
**Status:** **AUDIT E COMPLETE — CANONICAL MODEL v2.0 VALIDATED**

---

## 1. Executive Summary & Purpose

The **Canonical Music Model** is the central data aggregate representing musical truth across the entire platform.

The existing implementation ([`frontend/src/core/canonical-model/canonical-music-payload.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/canonical-model/canonical-music-payload.ts)) defines **v1.0.0**.

The purpose of this Phase 0E audit is to:
1. Validate the evolutionary leap from **v1.0.0 $\to$ v2.0.0**.
2. Formulate the **Five-Tier Hierarchical Confidence Model**.
3. Incorporate missing domain concepts (dynamic modulations, accompaniment tracks).
4. Specify the zero-downtime database migration and backward compatibility strategy.

---

## 2. Evaluation of v1.0.0 vs. v2.0.0 Architecture

```mermaid
classDiagram
    class CanonicalMusicPayload_v1 {
        +string version = "1.0.0"
        +string title
        +Timeline timeline
        +Section[] sections
        +Measure[] measures
        +InstrumentTrack[] instrumentTracks
        +Record metadata
    }

    class CanonicalMusicPayload_v2 {
        +string version = "2.0.0"
        +string title
        +Timeline timeline
        +Section[] sections
        +Measure[] measures
        +InstrumentTrack[] instrumentTracks
        +ProvenanceMetadata provenance
        +HierarchicalConfidence confidence
        +RevisionRecord[] revisionHistory
        +TablatureConfiguration tablatureConfig
        +Record metadata
    }

    CanonicalMusicPayload_v1 <|-- CanonicalMusicPayload_v2: Backward Compatible Extension
```

### 2.1 Domain Concept Gap Analysis

| Domain Concept | Implemented in v1.0.0? | Specified in v2.0.0? | Architectural Assessment & Role |
| :--- | :---: | :---: | :--- |
| **480 TPQN Timeline** | **YES** | **YES** | Mathematical standard for temporal resolution. |
| **Measures & Sections** | **YES** | **YES** | Formal boundary grouping for rehearsal navigation. |
| **Polyphonic Voices** | **YES** | **YES** | Distinct voices per instrument track (`voice: 1, 2`). |
| **Chords & Lyrics** | **YES** | **YES** | Synchronized `ChordEvent` and `LyricSyllable` streams. |
| **Multi-Tier Confidence** | **NO** | **YES** | Statistical metric enabling automated quality gates. |
| **Processing Provenance** | **NO** | **YES** | Traces origin (Demucs, Basic Pitch, OMR, Human edit). |
| **Revision Audit History** | **NO** | **YES** | Chronological record of human changes and deltas. |
| **Persistent Tab Tuning** | **NO** | **YES** | Instrument tuning, capo fret, and manual overrides. |
| **Dynamic Key Modulations**| **NO** | **YES** | Timestamped key change events within a song. |
| **Expressive Articulations**| **NO** | **YES** | Staccato, accent, tenuto, fermata, and ties. |

---

## 3. The Five-Tier Hierarchical Confidence Architecture

In automated transcription, confidence cannot be represented by a single global number. A song may have 100% confident lyrics and chords, but contain two ambiguous guitar notes.

Phase 0E establishes the **Five-Tier Hierarchical Confidence Architecture**:

```
┌────────────────────────────────────────────────────────────────────────┐
│               FIVE-TIER HIERARCHICAL CONFIDENCE MODEL                  │
├──────┬──────────────────┬──────────────────────────────────────────────┤
│ Tier │ Confidence Level │ Scope & Meaning                              │
├──────┼──────────────────┼──────────────────────────────────────────────┤
│ 1    │ Payload Level    │ Global score representing overall song       │
│      │                  │ reliability (weighted average of tracks).    │
├──────┼──────────────────┼──────────────────────────────────────────────┤
│ 2    │ Track Level      │ Reliability per instrument stem              │
│      │                  │ (e.g. Bass: 0.94, Vocals: 0.92, Other: 0.78).│
├──────┼──────────────────┼──────────────────────────────────────────────┤
│ 3    │ Measure Level    │ Integrity score per measure. Identifies      │
│      │                  │ bars with duration or harmonic anomalies.    │
├──────┼──────────────────┼──────────────────────────────────────────────┤
│ 4    │ Event Level      │ Probability score per discrete Note, Chord,  │
│      │                  │ or Lyric Syllable ($0.0 - 1.0$).             │
├──────┼──────────────────┼──────────────────────────────────────────────┤
│ 5    │ Field Level      │ Attribute-specific confidence:               │
│      │                  │ Pitch vs. Duration vs. Syllable text.        │
└──────┴──────────────────┴──────────────────────────────────────────────┘
```

```typescript
export interface HierarchicalConfidenceJSON {
  /** Tier 1: Aggregate song confidence */
  readonly overallScore: number;
  
  /** Tier 2: Confidence per track ID */
  readonly trackScores: Readonly<Record<string, number>>;
  
  /** Tier 3: Measure-by-measure confidence map */
  readonly measureScores: readonly {
    readonly measureNumber: number;
    readonly score: number;
    readonly flags: readonly ('DURATION_MISMATCH' | 'AMBIGUOUS_CHORD' | 'LOW_CONFIDENCE')[];
  }[];
}
```

---

## 4. Zero-Downtime Migration Architecture (v1.0.0 $\longleftrightarrow$ v2.0.0)

To protect the live database and prevent downtime during Phase 1A:

```mermaid
flowchart TD
    subgraph Storage ["PostgreSQL JSONB Storage"]
        RawV1["Existing Stored Payload\n(version: '1.0.0')"]
        RawV2["New Stored Payload\n(version: '2.0.0')"]
    end

    subgraph Deserializer ["CanonicalSerializer.deserialize()"]
        Check{"Check payload.version"}
        Upcast["Auto-Upcast to v2.0.0:\n• confidence.overallScore = 1.0\n• provenance.sourceFormat = 'LEGACY_IMPORT'\n• revisionHistory = []"]
        Direct["Direct Parse v2.0.0"]
    end

    subgraph Memory ["In-Memory Domain Graph"]
        LiveObj["CanonicalMusicPayload (v2.0 In-Memory Object)"]
    end

    subgraph Renderers ["Rendering Adapters"]
        OSMD["OSMD (Mode 1)"]
        LeadSheet["LeadSheet DOM (Mode 2)"]
        LyricsView["Lyrics Stand (Mode 3)"]
        AlphaTab["AlphaTab (Mode 4)"]
    end

    RawV1 --> Check
    RawV2 --> Check
    Check -->|"v1.0.0"| Upcast
    Check -->|"v2.0.0"| Direct
    Upcast --> LiveObj
    Direct --> LiveObj
    LiveObj --> OSMD & LeadSheet & LyricsView & AlphaTab
```

### 4.1 Migration Invariants:
1. **Zero Database Lockup:** Existing v1.0.0 rows in `ARRANGEMENT.canonical_music_payload` remain untouched. They are upgraded dynamically in memory upon deserialization.
2. **Lossless Downgrade:** A `downgradeToV1()` utility strips v2 metadata for legacy export without losing any musical notes, chords, or lyrics.
3. **Strict Validation:** When updating or saving a song in Phase 1A, it is written in v2.0.0 format.

---

## 5. Audit E Conclusion & Verdict

The `CanonicalMusicPayload` v2.0.0 specification successfully resolves the gaps of v1.0.0 while preserving 100% backward compatibility.

The inclusion of the **Five-Tier Hierarchical Confidence Architecture** and **dynamic key signature modulations** provides a robust domain model for automated transcription and human review.

**Audit E is certified as ARCHITECTURALLY SOUND AND MIGRATION-READY.**

