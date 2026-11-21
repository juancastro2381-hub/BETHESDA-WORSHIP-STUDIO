# WORSHIP STUDIO — PHASE 2A: KNOWN LIMITATIONS & PHASE BOUNDARIES
## Formally Deferred Capabilities, Technical Boundaries & Roadmap to Phase 2B

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** Phase 2A — Musical Conversion Center Foundation  
**Module:** Architectural Boundaries & Technical Limitations  
**Status:** Approved & Documented  
**Date:** 2026-11-07  

---

## 1. Explicit Phase 2A Scope Boundaries

Phase 2A delivers the complete foundational architecture for the Musical Conversion Center:
- Structured source ingestion (MusicXML, MIDI, ChordPro, Written Notes).
- Format capabilities evaluation and Zero-Fabrication gating.
- High-fidelity outbound serializers (MusicXML 4.0, SMF 1 MIDI, ChordPro, Lyrics TXT).
- Relational queue management in PostgreSQL (`background_jobs`).
- Complete seven-section UI/UX module integrated with the Digital Music Stand.

In strict adherence to the Product Owner executive directive, advanced signal processing, neural audio transcription, and optical recognition models were **explicitly excluded from Phase 2A** and scheduled for subsequent phases.

---

## 2. Formally Deferred Capabilities

### 2.1 Audio-to-Score & Audio-to-MIDI Transcription (Deferred to Phase 2B)
- **Deferred Engines:** Spotify Basic Pitch, Madmom beat/downbeat tracking, Whisper.cpp lyrics alignment, Demucs v4 source separation.
- **Reason for Deferral:** These engines require local machine learning runtimes (ONNX Runtime, PyTorch CPU, or WebAssembly SIMD) and specialized audio decoders. Incorporating them in Phase 2A would introduce heavy binary dependencies and premature complexity before the core canonical conversion pipeline was stabilized.
- **Current Behavior in Phase 2A:** When an audio or video file (`.mp3`, `.wav`, `.m4a`, `.mp4`) is selected, `FormatCapabilitiesEvaluator` detects the category as `AUDIO_RECORDING` or `VIDEO_REFERENCE`, marks all target formats as `DEFERRED_PHASE`, and displays the explanation:
  > *"La transcripción automática de audio a partitura (Basic Pitch / Demucs / Whisper.cpp) está diferida formalmente para Fase 2B con modelos locales sin servicios comerciales pagos."*

### 2.2 Optical Music Recognition (OMR) (Deferred to Phase 2B)
- **Deferred Engines:** Audiveris (Java-based open source OMR) and oemer (deep learning end-to-end OMR).
- **Reason for Deferral:** Optical recognition requires image pre-processing (binarization, staff line removal, connected components analysis, and neural glyph classification). To prevent hallucinated notes that would compromise liturgical integrity, OMR is deferred until local models can be executed with verifiable confidence thresholds.
- **Current Behavior in Phase 2A:** When a PDF score or image score (`.pdf`, `.png`, `.jpg`) is selected, targets are marked `DEFERRED_PHASE` with the explanation:
  > *"El reconocimiento óptico de partituras (OMR con Audiveris / oemer) está diferido para Fase 2B para garantizar precisión profesional sin alucinación de notas."*

### 2.3 Engraved Visual Score PDF Export (Deferred to Phase 2B)
- **Deferred Engine:** Headless Chromium / Puppeteer or server-side VexFlow node canvas for engraved vector PDF generation.
- **Current Behavior in Phase 2A:** Marked `DEFERRED_PHASE` in the format selector. Users are instructed to export to **MusicXML 4.0**, which can be opened and engraved in MuseScore, Dorico, Finale, or Sibelius with 100% vector typography fidelity.

### 2.4 Automatic Instrument Tablature Generation (Deferred to Phase 2B)
- **Deferred Engine:** Polyphonic guitar/bass string-fret assignment algorithms (dynamic programming for left-hand biomechanical efficiency).
- **Current Behavior in Phase 2A:** Marked `DEFERRED_PHASE` with clear explanatory notice.

---

## 3. Strict Non-Negotiable Constraint: Permanently Free Platform

Bethesda Worship Studio enforces an unconditional architectural rule:
- **ZERO commercial paid APIs:** No dependencies on OpenAI Whisper API, Google Cloud Speech, AWS Transcribe, or proprietary cloud OMR services.
- All future Phase 2B audio and visual transcription must run strictly via **open-source, self-hosted, local models** (e.g. Whisper.cpp, Basic Pitch ONNX, Demucs ONNX) to ensure the platform remains permanently free and accessible to worship ministries globally without recurring subscription fees.

