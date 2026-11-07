# WORSHIP STUDIO — PHASE 2A: UI/UX IMPLEMENTATION REPORT
## Conversion Center User Interface, Component Architecture & Stand Integration

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** Phase 2A — Musical Conversion Center Foundation  
**Module:** User Experience & Frontend Interface (`frontend/src/components/conversion/`)  
**Status:** Completed & Certified  
**Date:** 2026-11-07  

---

## 1. Executive Summary

Phase 2A delivers a complete, professional, first-class Musical Conversion Center within Bethesda Worship Studio. Previously, users could only import files through an isolated modal into an immediate view. With Phase 2A, authenticated and guest musicians have a dedicated conversion workspace that supports multi-source file detection, format compatibility evaluation, transposition, zero-fabrication gating, real-time job status tracking, human-in-the-loop review, direct multi-format export, and one-click integration into the Digital Music Stand.

---

## 2. Navigation Architecture & Workspace Integration

### 2.1 First-Class Navigation Destination
The Conversion Center is integrated as a primary workspace mode alongside the Digital Music Stand, accessible via:
1. **Primary Workspace Toolbar:** Dedicated toggle button `#btn-toggle-conversion-center` in `.catalog-and-import-bar`.
2. **Dedicated Workspace Rendering:** When activated, `ConversionCenterWorkspace` renders in the main application viewport, occupying full screen width and providing a focused, distraction-free environment.
3. **Seamless Digital Music Stand Hand-Off:** From the conversion review panel, a single click on `"🎵 Abrir en Atril Digital"` directly hydrates `CanonicalMusicPayload` into the interactive digital stand and transitions the workspace to live rehearsal/service view.

---

## 3. Detailed Seven-Section UI Specification

The Conversion Center interface is organized into seven distinct, cohesive operational sections:

### Section A: Conversion Workspace (`.section-upload`)
- **Drag & Drop Zone (`.dropzone`):** Interactive area supporting drag-over visual feedback, file drop, and native file browser triggering.
- **Accepted Formats:** Structured MusicXML (`.musicxml`, `.xml`, `.mxl`), MIDI (`.mid`, `.midi`), ChordPro (`.cho`, `.crd`, `.pro`), Visual scores (`.pdf`, `.png`, `.jpg`), and Audio recordings (`.mp3`, `.wav`, `.m4a`).
- **File Details Card (`.selected-file-card`):** Displays file icon, filename, human-readable file size (B, KB, MB), MIME type, and a removal button to reset the selection cleanly.

### Section B: Source Format & Capabilities Detection (`.section-capabilities`)
- **Automatic Detection:** Uses magic bytes inspection and content heuristics to identify the source category (`STRUCTURED_MUSICXML`, `STRUCTURED_MIDI`, `STRUCTURED_CHORDPRO`, `PDF_SCORE`, `IMAGE_SCORE`, `AUDIO_RECORDING`, `WRITTEN_NOTES`).
- **Visual Status Badges:**
  - `NATIVO` (Emerald / `#10b981`): Format matches or translates natively without data alteration.
  - `CONVERTIBLE` (Blue / `#3b82f6`): Deterministic conversion supported with complete data preservation.
  - `BORRADOR IA` (Amber / `#f59e0b`): Heuristic or draft conversion requiring musician review.
  - `BLOQUEADO (Cero Fabricación)` (Rose / `#ef4444`): Conversion mathematically impossible without inventing data (e.g. MIDI melody from chord sheet).
  - `DIFERIDO (Fase 2B)` (Slate / `#94a3af`): Advanced capabilities deferred to Phase 2B (Audio transcription, OMR).

### Section C: Target Format Selector (`.section-targets`)
- **Interactive Grid Cards:**
  - `MusicXML 4.0 (.musicxml)`
  - `Standard MIDI File (.mid)`
  - `ChordPro / Cifrado (.cho)`
  - `Solo Letra (.txt)`
  - `Partitura Grabada PDF (.pdf)` (Disabled with explanatory badge "Diferido Fase 2B")
  - `Tablatura (.tab)` (Disabled with explanatory badge "Diferido Fase 2B")
- **Zero-Fabrication Gating:** Disabled cards clearly present a warning box explaining why the conversion is blocked or deferred.

### Section D: Conversion Options Panel (`.section-options`)
- **Harmonic Transposition Stepper:** Incremental semitone shift (`-11` to `+11`) with reset control and verbal interval display.
- **Key Override Input:** Optional root key override (e.g. `G`, `Em`, `Bb`, `F#`).
- **BPM Override Input:** Numeric tempo specification (30 to 300 BPM).
- **Time Signature Override Input:** Structured meter override (e.g. `4/4`, `6/8`, `3/4`).
- **Execution Button (`.btn-execute-conversion`):** Prominent gold action button triggering conversion with loading spinner.

### Section E: Processing & Progress Queue (`.section-queue`)
- **Real-Time Status Indicator:** Displays status pill (`PROCESANDO`, `COMPLETADO`, `REVISIÓN REQUERIDA`, `FALLIDO`).
- **Animated Progress Bar:** Visual progress tracking from 0% to 100%.
- **Error Alerts:** Contextual error boxes with exact diagnostics and remediation advice.

### Section F: Conversion Review (Human-in-the-Loop) (`.section-review`)
- **Human Review Banner:** Explicit amber banner when warnings exist: `"Borrador de Conversión: Requiere validación humana"`.
- **Diagnostic Panel Box:** Collapsible list of structured diagnostics (`[INFO]`, `[WARNING]`, `[ERROR]`) with error codes and descriptions.
- **Interactive Output Preview:**
  - For Text/ChordPro/Lyrics/MusicXML: Syntax-styled code viewer with truncated notice for long files.
  - For MIDI: Specialized binary summary card showing track count, file size, format (Type 1), and resolution (480 TPQN).

### Section G: Export & Digital Music Stand Integration (`.section-actions`)
- **Descargar Archivo:** Direct native browser download with sanitized filename and valid MIME type.
- **Guardar en Catálogo:** Commits the song to the Bethesda PostgreSQL database via `client.importAndPersist()`.
- **Abrir en Atril Digital:** Immediate transition to the digital stand with full interactive score rendering.

---

## 4. Accessibility & Design Token Compliance

- **Dual-Theme Support:** Fully adheres to Bethesda Worship Studio design tokens (`--bg-surface`, `--bg-card`, `--gold-primary`, `--cyan-accent`, `--border-subtle`, `--text-primary`).
- **WCAG 2.1 AA Compliance:** High contrast text ratios, minimum 44x44px touch targets on buttons, explicit `aria-label`, `role="region"`, `role="radio"`, and `role="progressbar"` attributes.
- **Keyboard Navigation:** Full tab index support for file dropzone, format selection cards, and form steppers.

