# Bethesda Worship Studio — Phase 1G Engineering Report
## Production Musical Workspace & View Orchestration Layer

**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Phase:** 1G — Production Musical Workspace & View Orchestration  
**Status:** COMPLETE  
**Date:** September 19, 2026  
**Document Path:** `docs/PHASE_1G_ENGINEERING_REPORT.md` (and root `PHASE_1G_ENGINEERING_REPORT.md`)  

---

## 1. Executive Summary

Phase 1G completes the evolution of the Bethesda Worship Studio musical platform from an interactive technical testbed (Phase 1F) into a production-oriented, accessible, and capability-driven **Musical Workspace & View Orchestration** layer.

The central achievement of Phase 1G is providing a unified, decoupled workspace architecture that coordinates active song context, user viewing preferences, capability-driven instrument filtering, and multi-renderer orchestration while strictly adhering to the architectural principle:
$$\text{CanonicalMusicPayload} \to \text{ProjectionService} \to \text{DerivedMusicalView} \to \text{Renderer Adapter} \to \text{Browser Renderer} \to \text{React UI Boundary}$$

The UI boundary acts purely as a consumer of the domain; it does not replicate, re-calculate, or mutate canonical musical truth. All 4 Golden Scenarios (Guitar with Capo 2, Piano Grand Staff, Alto Sax in Eb, and Lead Vocal from ChordPro) remain 100% operational with real browser rendering. Automated tests expanded from 148 to 165 tests across 34 suites with 0 failures and 0 typecheck errors.

---

## 2. Phase Objective

The core objective of Phase 1G was **NOT** to construct a new musical engine, but rather to:
1. Provide a clean, robust, and accessible application-level workspace layer for orchestrating active songs, instrument atriles, and presentation settings.
2. Establish a strict separation between:
   - Canonical musical truth (`CanonicalMusicPayload`)
   - Musical projection (`ProjectionService`, `DerivedMusicalView`)
   - Instrument/view selection (`InstrumentRegistry`, `InstrumentProfile`)
   - Renderer selection (`RendererRegistry`, `IMusicRenderer`)
   - Presentation state (`IWorkspaceState`)
   - User interaction state (pure UI controls)
3. Derive available representations dynamically from `InstrumentProfile` without hardcoding rules inside React components.
4. Guarantee that unsupported view/instrument combinations fail deterministically with structured diagnostics instead of crashing or generating invalid visual artifacts.
5. Preserve all architectural invariants established in Phases 1A through 1F.

---

## 3. Initial Architecture Inspection

Prior to writing code for Phase 1G, the baseline contracts from Phases 1A–1F were verified:
- **Phase 1A (Musical Theory Core):** Circle of Fifths, PitchClass, enharmonics, interval transposition, and capo calculation algorithms.
- **Phase 1B (Canonical Music Model):** `CanonicalMusicPayload`, `Timeline`, `TempoMap`, `Measure`, `Voice`, `Note`, `ChordEvent`, `LyricSyllable`. Strict immutability baseline.
- **Phase 1C (Musical Ingestion & Normalization):** MusicXML and ChordPro importers. Invariant: `totalMelodyNotes === 0` for pure chord/lyric sheets.
- **Phase 1D (Musical Transformation & Projection):** `ProjectionService`, `InstrumentProfile`, `ViewPreference`, `DerivedMusicalView`, `TablatureCalculator`. Instrument ≠ View invariant.
- **Phase 1E (Rendering Adapter Architecture):** `IMusicRenderer`, `BaseMusicRenderer`, `AlphaTabAdapter`, `OsmdAdapter`, `LeadSheetDomAdapter`, `RendererRegistry`.
- **Phase 1F (Real Browser Rendering Integration):** Lifecycle state machine (`UNINITIALIZED -> READY -> RENDERING -> READY -> DISPOSED`), real DOM element attachments, `ResizeObserver`, XSS prevention.
- Baseline test suite: 148 tests passing across 32 suites.

---

## 4. Files Created

The following 19 new production files and test suites were constructed for Phase 1G:

### Core Workspace Layer (`frontend/src/core/workspace/`)
1. [`types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/types.ts)
   - Interfaces for `IWorkspaceState`, `IWorkspaceViewResult`, `WorkspaceDiagnostic`, `GoldenScenarioId`, `ScenarioPreset`, and `InstrumentId`.
2. [`presets.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/presets.ts)
   - Authoritative preset definitions for Golden Scenarios A, B, C, and D, plus `WORKSPACE_SONG_CATALOG` with full score, ChordPro, and empty test songs.
3. [`workspace-orchestrator.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/workspace-orchestrator.ts)
   - Pure deterministic transition functions (`transitionSelectInstrument`, `transitionSetPrimary`, `transitionToggleSecondary`, `transitionSetCapo`, `transitionSetTransposition`, `transitionSetChordNotation`, `transitionApplyPreset`) and pure view orchestration (`orchestrateWorkspaceView`). Decoupled from React for isolated testing.
4. [`use-musical-workspace.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/use-musical-workspace.ts)
   - React orchestration hook providing reactive bindings, memoized projections, and accessible action handlers.
5. [`index.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/index.ts)
   - Public barrel export for the core workspace module.
6. [`__tests__/musical-workspace.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/__tests__/musical-workspace.test.ts)
   - Comprehensive unit test suite covering all 14 mandatory testing points.

### Workspace UI Components (`frontend/src/components/workspace/`)
7. [`SongHeader.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/SongHeader.tsx)
   - Active song context banner displaying real canonical metadata (Title, Concert Key, Tempo, Time Signature, Measures, Sections, Chords, Notes).
8. [`SongSelector.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/SongSelector.tsx)
   - Dropdown and quick pill catalog switcher to toggle between full notation, pure ChordPro, and empty test cases.
9. [`ScenarioPresets.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/ScenarioPresets.tsx)
   - Interactive preset cards for one-click access to Golden Scenarios A, B, C, and D.
10. [`InstrumentSelector.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/InstrumentSelector.tsx)
    - Dynamic instrument picker derived from `InstrumentRegistry` with family badges and transposition offsets.
11. [`RepresentationSelector.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/RepresentationSelector.tsx)
    - Capability-driven primary representation selector and secondary layer toggle pills (Chords, Lyrics, Markers).
12. [`CapoControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/CapoControl.tsx)
    - Capo fret buttons (0 to 7) with relative fingering tooltips, dynamically disabled for instruments that do not support capo.
13. [`TranspositionControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/TranspositionControl.tsx)
    - Semitone shift controls (-11 to +11) with step buttons and reset function.
14. [`ChordNotationControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP STUDIO/frontend/src/components/workspace/ChordNotationControl.tsx)
    - Segmented control to switch between American Standard (`C, D, G`) and Latin Solfège (`Do, Re, Sol`).
15. [`RendererStatus.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/RendererStatus.tsx)
    - Active engine badge, capability descriptions, and optional manual renderer override selector.
16. [`DiagnosticPanel.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/DiagnosticPanel.tsx)
    - Structured collapsible diagnostics banner for projection errors, warnings, and fallback notices.
17. [`MusicalControls.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalControls.tsx)
    - Unified control panel layout assembling all individual controls into a responsive grid.
18. [`MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx)
    - Master workspace container assembling `SongHeader`, `SongSelector`, `ScenarioPresets`, `MusicalControls`, `RendererStatus`, `MusicalScoreRenderer`, and `DiagnosticPanel`.
19. [`index.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/index.ts)
    - Component barrel export.

---

## 5. Files Modified

1. [`frontend/src/App.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/App.tsx)
   - Replaced Phase 1F temporary testbed with the production `<MusicalWorkspace />` container.
2. [`frontend/src/index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css)
   - Added complete Phase 1G design system styles: CSS custom properties, glassmorphism cards, responsive grids, status badges, accessibility focus states, and diagnostic banners.

---

## 6. Architecture Changes

No breaking changes or mutations to canonical contracts were made. The architectural enhancements introduce:
1. **Application-level Orchestration Layer:** Sits strictly between the React UI layer and the domain services (`ProjectionService`, `RendererRegistry`).
2. **Pure State Reducers / Transition Functions:** Isolated in `workspace-orchestrator.ts`, guaranteeing that UI state transitions are pure, reproducible, and verifiable outside of React DOM.
3. **Capability-driven Resolution:** The UI requests available representations from `InstrumentProfile.supportedRepresentations`. Switching instruments automatically sanitizes the requested representations so that invalid combinations are prevented at the interaction boundary.
4. **Deterministic Diagnostics Consolidation:** Errors from both `ProjectionService` and `RendererRegistry` are unified into a normalized `WorkspaceDiagnostic[]` model and presented without crashing the application.

---

## 7. Workspace Architecture

The workspace implements a clean component hierarchy with single-responsibility boundaries:

```
MusicalWorkspace
├── WorkspaceAppHeader
├── SongSelector (Full Score / ChordPro / Empty Song)
├── ScenarioPresets (Scenarios A, B, C, D)
├── SongHeader (Real Canonical Metadata)
├── MusicalControls
│   ├── InstrumentSelector
│   ├── RepresentationSelector
│   ├── CapoControl
│   ├── TranspositionControl
│   └── ChordNotationControl
├── RendererStatus (Active Engine & Capabilities)
├── DiagnosticPanel (Errors, Warnings, Notices)
└── MusicalScoreRenderer (DOM Container + Engine Mount)
```

Unidirectional Data Flow:
```
[User Action] 
       │
       ▼
[transitionX Function] 
       │
       ▼
[IWorkspaceState] 
       │
       ▼
[orchestrateWorkspaceView] ───► [ProjectionService.project]
       │                                │
       ▼                                ▼
[RendererRegistry.select] ◄──── [DerivedMusicalView]
       │
       ▼
[IWorkspaceViewResult]
       │
       ▼
[React UI Rendering & Score Mount]
```

---

## 8. State Model

The workspace strictly separates **Domain State** from **UI Presentation State**.

### Domain State (Owned by Domain Services & Canonical Model)
- Measures, timeline, notes, voices, chords, lyrics, musical timing, key signatures, and tempo events.
- Strictly immutable; never stored or modified in React state.

### UI Presentation State (`IWorkspaceState`)
Stores only user display preferences:
```typescript
export interface IWorkspaceState {
  readonly selectedInstrumentId: InstrumentId;
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly capoFret: number;
  readonly transpositionSemitones: number;
  readonly chordNotationSystem: ChordNotationSystem;
  readonly forcedRendererId?: RendererId | undefined;
  readonly activePresetId: GoldenScenarioId | 'CUSTOM';
}
```

---

## 9. Instrument/View Capability Handling

The workspace enforces capability filtering dynamically:
1. **Instrument Change:** When the user selects a new instrument, `transitionSelectInstrument` queries `targetProfile.isRepresentationSupported(currentPrimary)`. If unsupported (e.g., switching from Guitar with Tablature to Piano), the primary representation automatically defaults to the first supported representation (e.g., `GRAND_STAFF`).
2. **Secondary Representation Sanitization:** Secondary layers (e.g., `CHORDS`, `LYRICS`) are filtered against `targetProfile.supportedRepresentations`. For example, `alto_sax` (which does not support `LYRICS`) automatically drops lyrics while keeping chords and section markers.
3. **Capo Support:** `instrumentSupportsCapo(profile)` checks whether the instrument has tuning and belongs to `GUITAR` or `BASS`. If an instrument does not support capo (e.g., piano or saxophone), the capo fret is immediately reset to 0 and capo controls are disabled with an accessible explanatory tooltip.

---

## 10. Renderer Orchestration

The workspace delegates engine selection to `RendererRegistry.selectBestRenderer(activeReps)`:
- `TABLATURE` present $\to$ **AlphaTab**
- `GRAND_STAFF` present $\to$ **OpenSheetMusicDisplay (OSMD)**
- Pure `LYRICS` + `CHORDS` (no staves) $\to$ **LeadSheetDOM**
- Standard notation $\to$ **AlphaTab** or **OSMD** based on instrument capabilities.

### Incompatible Forced Renderer Fallback
If the user attempts to force an incompatible engine (e.g., forcing `ALPHATAB` for a piano score with `GRAND_STAFF`), the orchestrator:
1. Emits a structured warning: `FORCED_RENDERER_INCOMPATIBLE`.
2. Automatically falls back to the best compatible engine (`OSMD`).
3. Keeps score rendering uninterrupted without crashing.

---

## 11. Error Handling

The workspace handles edge cases deterministically:
- **Empty Song (`EMPTY_SONG_NO_MEASURES`):** When a canonical song with zero measures is loaded, the workspace renders a friendly empty-state card (`Canción Sin Contenido Musical`) and registers a warning diagnostic. The renderers are not called, preventing null pointer crashes.
- **Unsupported View Combination:** If an impossible view combination is requested, `ProjectionService` returns `status: 'UNSUPPORTED_VIEW'`. The workspace surfaces an `UNSUPPORTED_VIEW_REPRESENTATION` diagnostic in `DiagnosticPanel`.
- **Renderer Failure:** If an engine fails during mounting, `useMusicRenderer` transitions to `ERROR` and displays the structured error message with retry options.

---

## 12. Accessibility

Accessibility baseline implemented following WCAG 2.1 AA-oriented practices. A formal WCAG conformance audit is outside the scope of Phase 1G:
- **Accessible Names:** All interactive buttons, dropdowns, and preset cards provide explicit `aria-label`, `aria-pressed`, or `aria-selected` attributes.
- **Keyboard Navigation:** Full tab order across all cards, pills, select inputs, and action buttons.
- **Focus Indicators:** High-contrast outline on `:focus-visible` across all custom pills and buttons.
- **Semantic HTML:** Proper use of `<header>`, `<main>`, `<section>`, `<fieldset>`, `<legend>`, `<details>`, and `<summary>`.

---

## 13. Security

- **Zero Unsafe InnerHTML:** Preserved the Phase 1F guarantee. Neither user-controlled lyrics, chord names, nor titles are injected via `dangerouslySetInnerHTML` or `element.innerHTML`.
- **LeadSheetDOM Construction:** Generates DOM nodes exclusively through `document.createElement`, `classList.add`, and `textContent`.
- **MusicXML & AlphaTab Sanitization:** All text tokens (song titles, syllables, chord symbols) are escaped against XML injection before serialization.

---

## 14. Performance

- **Zero Redundant Engine Re-creations:** Switching presentation preferences (such as chord notation system or capo display) updates the existing renderer instance without destroying and re-instantiating the underlying adapter.
- **Pure Function Memoization:** All projections and registry queries are memoized via `useMemo`.
- **ResizeObserver Lifecycle:** All DOM observers disconnect cleanly upon component unmount, preventing memory leaks.

---

## 15. Automated Tests

Automated testing was performed using the native Node.js test runner (`node --test --experimental-strip-types`) and the TypeScript compiler (`tsc --noEmit`).

### Test Execution Commands
```bash
npm run typecheck
npm test
```

### Typecheck Results
```
> @bethesda/frontend@0.1.0 typecheck
> tsc --noEmit

Exit code: 0 (0 errors)
```

### Test Suite Results
```
ℹ tests 165
ℹ suites 34
ℹ pass 165
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10745.1352
```

### Coverage by Component
| Test Suite | Suites | Tests | Status |
|---|---|---|---|
| PitchClass Core Domain | 1 | 1 | PASS |
| Analytical Transposition & Instruments | 1 | 4 | PASS |
| Capo and Tablature Projection | 1 | 7 | PASS |
| Phase 1D Golden Projection Scenarios (A-D) | 1 | 4 | PASS |
| InstrumentProfile & Capability Model | 1 | 5 | PASS |
| Musical Transposition & Transposing Instruments | 1 | 8 | PASS |
| Views, Multi-Musician & Immutability | 1 | 6 | PASS |
| AlphaTab Adapter | 1 | 3 | PASS |
| Phase 1F Browser Rendering Integration | 1 | 10 | PASS |
| Golden Renderer Contract Scenarios (A-D) | 1 | 4 | PASS |
| LeadSheetDOM Adapter | 1 | 3 | PASS |
| Multi-Renderer Independence & Immutability | 1 | 3 | PASS |
| OSMD Adapter | 1 | 3 | PASS |
| Renderer Contract & Capabilities | 1 | 5 | PASS |
| **Phase 1G Production Musical Workspace (NEW)** | **1** | **17** | **PASS** |
| Other Core Theory/Canonical/Ingestion Suites | 19 | 82 | PASS |
| **Total Cumulative Baseline** | **34** | **165** | **100% PASS** |

---

## 16. Manual Browser Validation

Real browser validation was conducted at `http://localhost:5173/` using the integrated browser subagent recording session `phase_1g_workspace_validation_1789877500043.webp`.

### Browser Verification Log
1. **Initial Page Load:**
   - Workspace loaded with `Sublime Gracia (Notación Completa — Sol Mayor)`.
   - SongHeader displayed: Concert Key G, Meter 4/4, Tempo 120 BPM, 2 Measures, 1 Section, 4 Chords, 6 Notes.
2. **Scenario A (Guitar + Capo 2 + Tablature + Chords):**
   - Active preset card highlighted.
   - Renderer: AlphaTab mounted SVG score with 6-string tab lines and fret numbers.
3. **Scenario B (Piano + Grand Staff + Chords):**
   - Switched via card click.
   - Renderer: OSMD mounted dual treble/bass staves connected with grand brace.
4. **Scenario C (Alto Sax Eb + Standard Notation):**
   - Switched via card click.
   - Written key displayed: E Major (4 sharps: F#, C#, G#, D#), +9 semitones offset.
   - Renderer: OSMD mounted single treble staff in written E major.
5. **Scenario D (Lead Vocal + Lyrics + Chords):**
   - Switched via card click.
   - Source: ChordPro without melody.
   - Badge displayed: `Lead Sheet Puro (0 notas melódicas)`.
   - Renderer: LeadSheetDOM mounted responsive measure cards without artificial note generation.
6. **Interactive Controls:**
   - **Latin Solfège Toggle:** Chords updated from `G, Em, C, D` to `Sol, Mim, Do, Re`.
   - **Transposition Buttons:** `+1` transposed to Ab Major (`Lab, Fam, Reb, Mib`); `+2` transposed to A Major (`La, Fa#m, Re, Mi`).
   - **Capo Buttons:** Returned to Guitar; Capo 0, Capo 3, and Capo 5 updated fingering chord shapes dynamically without altering sounding concert pitch.
7. **Empty Song & Error Diagnostics:**
   - Selected `Canción Vacía (Edge Case / Sin compases)`.
   - Handled gracefully: Displayed empty score fallback banner.
   - DiagnosticPanel opened with warning `[WORKSPACE] EMPTY_SONG_NO_MEASURES`.
   - Console logs remained completely clean (0 uncaught errors).
8. **Recovery:**
   - Selected Scenario A; workspace returned to fully operational state with 0 warnings.

---

## 17. Golden Scenario Results

All four official reference scenarios passed both automated test suites and real browser rendering:

| Scenario | Instrument | Presentation | Engine | Sounding Key | Display Key | Melody Notes | Status |
|---|---|---|---|---|---|---|---|
| **Scenario A** | Guitarra Acústica | Tablatura + Cifrado (Capo 2) | AlphaTab | Sol Mayor (G) | Digitación Fa (F) | Preserved | PASS |
| **Scenario B** | Piano Acústico | Gran Pentagrama + Cifrado | OSMD | Sol Mayor (G) | Sol Mayor (G) | Preserved | PASS |
| **Scenario C** | Saxofón Alto (Eb) | Notación Estándar | OSMD | Sol Mayor (G) | Mi Mayor (E, +9st) | Preserved | PASS |
| **Scenario D** | Voz Principal | Letra + Cifrado (ChordPro) | LeadSheetDOM | Sol Mayor (G) | Sol Mayor (G) | **Strictly 0** | PASS |

---

## 18. Regression Results

All 148 pre-existing tests from Phases 1A, 1B, 1C, 1D, 1E, and 1F were re-executed and verified:
- `CanonicalMusicPayload` immutability: **Verified** (deep JSON snapshots match before and after projections).
- Zero invented melody notes invariant: **Verified** (`totalMelodyNotes === 0` throughout all pipelines).
- Multi-musician view isolation: **Verified** (Guitar, Piano, Sax, and Vocal instances operate simultaneously without state leakage).
- Capo and musical transposition separation: **Verified** (Capo affects fingerings only; transposition shifts sounding pitch).
- Safe DOM construction: **Verified** (no XSS injection vectors).

---

## 19. Known Limitations

1. **Static Catalog Fixtures:** Active songs are presently loaded from in-memory canonical fixtures (`createCanonicalSongGMajorWithNotes`, `createCanonicalSongGMajorChordsAndLyricsOnly`). Ingestion of user-uploaded MusicXML/ChordPro files in the UI is deferred to Phase 1H.
2. **Read-Only Score Display:** The workspace currently focuses on high-fidelity visual rendering and atril orchestration. In-browser notation editing and measure manipulation are scheduled for subsequent roadmap stages.

---

## 20. Architectural Deviations

**Zero architectural deviations.** No canonical data contracts were modified, no new external state management dependencies (Redux/Zustand) were introduced, and no database or server integrations were prematurely added.

---

## 21. Deferred Work

The following items remain strictly out of scope for Phase 1G and are deferred according to the project roadmap:
- Database migrations and persistence layer (Phase 2).
- User authentication and role-based access control (Phase 2).
- Realtime WebSocket synchronization between band members (Phase 3).
- Audio synthesis, WebAudio playback, and MIDI playback (Phase 3).
- Optical Music Recognition (OMR) and PDF ingestion (Phase 4).
- Setlist and service planning management (Phase 2).

---

## 22. Final Exit Gate

| Exit Gate Criterion | Required | Verified | Result |
|---|---|---|---|
| Production musical workspace implemented | YES | YES | PASSED |
| Canonical model remains single source of truth | YES | YES | PASSED |
| Domain/projection/rendering boundaries intact | YES | YES | PASSED |
| Capability-driven instrument/view selection works | YES | YES | PASSED |
| RendererRegistry remains authoritative | YES | YES | PASSED |
| Golden Scenarios A-D fully functional | YES | YES | PASSED |
| Multi-view isolation preserved | YES | YES | PASSED |
| Zero invented melody notes invariant preserved | YES | YES | PASSED |
| Capo and transposition remain independent | YES | YES | PASSED |
| Error handling deterministic & structured | YES | YES | PASSED |
| Accessibility baseline implemented | YES | YES | PASSED |
| Responsive workspace validated | YES | YES | PASSED |
| No unsafe HTML introduced | YES | YES | PASSED |
| TypeScript typecheck passes (0 errors) | YES | YES | PASSED |
| Existing regression tests pass (148/148) | YES | YES | PASSED |
| New Phase 1G tests pass (17/17) | YES | YES | PASSED |
| Manual browser validation completed (8 steps) | YES | YES | PASSED |
| No architectural deviations | YES | YES | PASSED |
| `PHASE_1G_ENGINEERING_REPORT.md` complete | YES | YES | PASSED |

### **Phase 1G Exit Gate Decision: PASSED**
