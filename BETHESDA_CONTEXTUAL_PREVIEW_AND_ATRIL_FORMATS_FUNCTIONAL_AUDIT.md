# BETHESDA WORSHIP STUDIO — FUNCTIONAL AUDIT OF CONTEXTUAL PREVIEW MODES VS. ATRIL READING FORMATS

**Date:** `2026-11-20T08:08:00-05:00`  
**Scope:** Audit Only (no application code, database, or configuration changes)  
**Branch / HEAD:** `feature/phase-1a-core-foundation` @ `537f546508e7dfd8e9236c86aac567a6673543b9`

---

## 1. Executive Summary
The Musical Workspace currently exposes **two prominent card bars** (plus a third lower representation control row inside `MusicalControls`):
1. **Upper Bar — Contextual Preview Modes (`ScenarioPresets.tsx`):** Four macro-presets (`SCENARIO_A`..`SCENARIO_D` from `GOLDEN_SCENARIO_PRESETS`) originally built as Phase 1G regression demo presets and recently refactored (`537f546`) into temporary, non-destructive `previewScenario(presetId)` overlays over the active song.
2. **Lower Bar — Musician's Atril Reading Formats (`ReadingFormatSelector` / `reading-format-selector-component.ts`):** Four canonical reading formats (`STAFF_NOTATION`, `CHORD_CHART`, `LYRICS_ONLY`, `TABLATURE`) governed by `StandFormatCapabilityResolver` (Zero-Fabrication & Approval rules) and optionally persisted as `UserViewPreferenceData`.

**Core Finding:** Both areas mutate the **same** underlying `IWorkspaceState` (`useMusicalWorkspace`) and feed the **same** projection/rendering pipeline (`buildWorkspaceView` -> `ProjectionService` -> `OSMD` / `AlphaTab` / `LeadSheetDOM`). While their *intent* differs—**multi-axis temporary instrument+notation macro-preview** (upper) vs. **format-only persistent reading selection** (lower)—there is **significant functional overlap and UX duplication** (especially `Scenario D` vs. `Cifrado con Letra` and `Scenario B` vs. `Partitura`), alongside inconsistent gating (upper cards allow clicking `PARTIAL`/`UNAVAILABLE` scenarios with silent fallback, whereas lower cards strictly block unavailable formats).

Canonical song data (`CanonicalMusicPayload`) is **verified protected and immutable** across both areas.

---

## 2. Repository & Git State
- **Branch:** `feature/phase-1a-core-foundation`
- **HEAD SHA:** `537f546508e7dfd8e9236c86aac567a6673543b9` (`REFACTOR SCENARIO CARDS INTO NON-DESTRUCTIVE, CONTEXTUAL VIEWING MODES`)
- **Working Tree:** Clean prior to creating this audit report.

---

## 3. Files & Components Inspected
- `frontend/src/components/workspace/MusicalWorkspace.tsx` — Workspace orchestration, `<ScenarioPresets>`, `<MusicalControls>`, `<main ref={viewportRef}>`, `<MusicalScoreRenderer>`, `handleSavePreference`.
- `frontend/src/components/workspace/ScenarioPresets.tsx` — Upper 4 Contextual Preview cards, `evaluateScenarioSupport`, `.scenario-preview-banner`.
- `frontend/src/core/workspace/presets.ts` — `GOLDEN_SCENARIO_PRESETS` (`SCENARIO_A`..`SCENARIO_D`).
- `frontend/src/core/workspace/use-musical-workspace.ts` — `useMusicalWorkspace` hook (`previewScenario`, `exitScenarioPreview`, `setReadingFormat`, `selectInstrument`, `applyPreset`).
- `frontend/src/core/workspace/workspace-orchestrator.ts` — `transitionApplyPreset`, `transitionSelectInstrument`, `transitionSetPrimary`, `transitionSetCapo`, `transitionSetTransposition`, `resolveEffectiveViewRepresentation`.
- `frontend/src/components/workspace/MusicalControls.tsx` — Houses `<ReadingFormatSelector>`, `<InstrumentSelector>`, `<RepresentationSelector>`, `<CapoControl>`, `<TranspositionControl>`, `<ChordNotationControl>`.
- `frontend/src/components/workspace/reading-format-selector-component.ts` — `computeFormatDefinitions`, `ReadingFormatSelector` UI, availability/approval badges, preference persistence button, completion workflow trigger.

---

## 4. Functional Inventory — Contextual Preview Cards (Upper Section)

All 4 cards are rendered by `ScenarioPresets.tsx`, evaluate compatibility via `StandFormatCapabilityResolver.evaluateAll()`, and invoke `previewScenario(presetId)` in `useMusicalWorkspace.ts`.

| Card | Interaction & Handler | State & Persistence | Transformation Applied | Read-Only / Canonical Safety | Dismiss / Revert | Implementation Status |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Guitarra — Capo 2 + Cifrado + Tablatura** (`SCENARIO_A`) | Click calls `previewScenario('SCENARIO_A')` | Temporary `IWorkspaceState` + `activeScenarioPreview='SCENARIO_A'`. Never saved to DB or `preferredFormatRef`. | `instrument='acoustic_guitar'`, `primary='TABLATURE'`, `secondary=['CHORDS']`, `capoFret=2`, `transposition=0`, `forcedRenderer='ALPHATAB'`. | Read-only over `activeSong`. Never mutates notes, chords, lyrics, or canonical key. | Click card again or click **"Volver a mi vista original"** (`exitScenarioPreview()`). | **Truly implemented** via `ProjectionService` + `AlphaTab`. |
| **B. Partitura — Gran Pentagrama + Cifrado** (`SCENARIO_B`) | Click calls `previewScenario('SCENARIO_B')` | Temporary `IWorkspaceState` + `activeScenarioPreview='SCENARIO_B'`. Never persisted. | `instrument='acoustic_piano'`, `primary='GRAND_STAFF'`, `secondary=['CHORDS']`, `capoFret=0`, `forcedRenderer='OSMD'`. | Read-only over `activeSong`. `resolveEffectiveViewRepresentation` prevents note fabrication if `totalNotes === 0`. | Click card again or **"Volver a mi vista original"**. | **Truly implemented** via `ProjectionService` + `OSMD`. |
| **C. Saxofón Eb — Notación Transpuesta** (`SCENARIO_C`) | Click calls `previewScenario('SCENARIO_C')` | Temporary `IWorkspaceState` + `activeScenarioPreview='SCENARIO_C'`. Never persisted. | `instrument='alto_sax'` (`transpositionSemitones` from `InstrumentProfile`: Eb written `+9`), `primary='STANDARD_NOTATION'`, `secondary=['CHORDS']`, `forcedRenderer='OSMD'`. | Read-only over `activeSong`. Concert pitch canonical payload untouched; written transposition applied in projection. | Click card again or **"Volver a mi vista original"**. | **Truly implemented** via `InstrumentRegistry` + `ProjectionService` + `OSMD`. |
| **D. Lead Sheet — Cifrado + Letra** (`SCENARIO_D`) | Click calls `previewScenario('SCENARIO_D')` | Temporary `IWorkspaceState` + `activeScenarioPreview='SCENARIO_D'`. Never persisted. | `instrument='lead_vocal'`, `primary='CHORDS'`, `secondary=['LYRICS', 'SECTION_MARKERS']`, `capoFret=0`, `forcedRenderer='LEADSHEETDOM'`. | Read-only over `activeSong`. Zero melody fabrication (`totalMelodyNotes === 0` preserved). | Click card again or **"Volver a mi vista original"**. | **Truly implemented** via `LeadSheetDOM`. |

**Important Behavioral Finding:** Upper preview cards remain clickable even when `evaluateScenarioSupport()` reports `PARTIAL` or `UNAVAILABLE`; safety relies on `resolveEffectiveViewRepresentation()` falling back to supported content during projection rather than disabling the card button.

---

## 5. Functional Inventory — Atril Reading Formats (Lower Section)

Rendered by `ReadingFormatSelector` inside `MusicalControls.tsx`. Uses `computeFormatDefinitions(activeSong, instrumentProfile, { evaluationOptions: { songStatus, capoFret }, serverCapabilities })`.

| Format | Interaction & Handler | Rendering Component & Source | Required Canonical Content & Readiness | Persistence & Preferences | Independent of Preview Cards? |
| --- | --- | --- | --- | --- | --- |
| **Partitura** (`STAFF_NOTATION`) | Click calls `onSelectReadingFormat(staffRep, [])` -> `setReadingFormat` | `OSMD` via `MusicalScoreRenderer` (`GRAND_STAFF` if piano/grand-staff instrument, else `STANDARD_NOTATION`). | `hasNotes` (`getAllNotes().length > 0`), instrument supports staff, `STAFF_NOTATION` capability `isAvailable` (respects `songStatus`/approval). | Persistent in `preferredFormatRef`; saveable to DB via **Guardar Preferencia** (`UserViewPreferenceData`). | **Yes**, selecting it also clears any active scenario preview (`setActiveScenarioPreview(null)`). |
| **Cifrado con Letra** (`CHORD_CHART`) | Click calls `onSelectReadingFormat('CHORDS', ['LYRICS', 'SECTION_MARKERS'])` | `LeadSheetDOM` (or active renderer) via `MusicalScoreRenderer`. | `hasChords && hasLyrics`, instrument supports `CHORDS` & `LYRICS`, `CHORD_CHART` capability `isAvailable` (strictly disabled if lyrics missing). | Persistent in `preferredFormatRef` + optional DB save. | **Yes**, clears active scenario preview. |
| **Letra Sola** (`LYRICS_ONLY`) | Click calls `onSelectReadingFormat('LYRICS', ['SECTION_MARKERS'])` | `LeadSheetDOM` via `MusicalScoreRenderer`. | `hasLyrics`, instrument supports `LYRICS`, `LYRICS_ONLY` capability `isAvailable`. | Persistent in `preferredFormatRef` + optional DB save. | **Yes**, clears active scenario preview. |
| **Tablatura** (`TABLATURE`) | Click calls `onSelectReadingFormat('TABLATURE', [])` | `AlphaTab` via `MusicalScoreRenderer`. | `instrumentProfile.tuning !== undefined` (Guitar/Bass) AND `hasNotes`, `TABLATURE` capability `isAvailable`. | Persistent in `preferredFormatRef` + optional DB save. | **Yes**, clears active scenario preview. |

---

## 6. Functional Overlap Matrix

| Comparison | Classification | Implementation Evidence |
| --- | --- | --- |
| **Lead Sheet preview (`SCENARIO_D`) vs. Cifrado con Letra (`CHORD_CHART`)** | **FUNCTIONAL DUPLICATION** | Both set `primary='CHORDS'` and `secondary=['LYRICS', 'SECTION_MARKERS']` and render via `LeadSheetDOM`. Difference is only that `SCENARIO_D` switches instrument to `lead_vocal` (temporarily) and stays clickable on partial content, whereas `CHORD_CHART` keeps the current instrument and enforces strict missing-content blocking + completion modal. |
| **Grand Staff + Cifrado preview (`SCENARIO_B`) vs. Partitura (`STAFF_NOTATION`)** | **PARTIAL OVERLAP** | Both render `GRAND_STAFF` via `OSMD` when the instrument is Piano (`computeFormatDefinitions` even relabels `Partitura` to `Gran Pentagrama`). `SCENARIO_B` additionally forces `acoustic_piano` + `CHORDS` secondary overlay as a one-click macro. |
| **Capo 2 + Cifrado + Tablatura (`SCENARIO_A`) vs. Tablatura (`TABLATURE`)** | **PARTIAL OVERLAP** | Both project fretboard coordinates and render via `AlphaTab`. `SCENARIO_A` bundles `acoustic_guitar` + `capoFret=2` + `CHORDS` secondary + `ALPHATAB` temporarily; `TABLATURE` keeps the musician's chosen string instrument and current `CapoControl` fret. |
| **Saxofón Eb preview (`SCENARIO_C`) vs. Atril Reading Formats** | **DISTINCT FUNCTIONALITY** | None of the 4 Atril Reading Formats changes instrument or applies `+9` Eb transposition; `SCENARIO_C` acts as a macro shortcut for `InstrumentSelector` (`alto_sax`) + `STANDARD_NOTATION` + `CHORDS`. |
| **Manual `RepresentationSelector` (`MusicalControls`) vs. `ReadingFormatSelector`** | **UX & FUNCTIONAL DUPLICATION** | Both appear inside `MusicalControls` and call `setPrimaryRepresentation`/`toggleSecondaryRepresentation` vs. `setReadingFormat` on the exact same `primaryRepresentation`/`secondaryRepresentations` state, except `RepresentationSelector` bypasses the `ReadingFormatSelector` availability/completion UX. |

---

## 7. Canonical Song Safety Findings
- **Verified Safe:** `previewScenario`, `exitScenarioPreview`, `setReadingFormat`, `selectInstrument`, `setCapo`, and `setTransposition` only update `IWorkspaceState` (`use-musical-workspace.ts`) and read `activeSong` immutably through `ProjectionService`.
- **No Canonical Mutation:** `activeSong`, `persistedMeta`, `importedMeta`, song version history, lyrics, chords, measures, durations, and concert key are **never mutated** or saved back to the database by either area.
- **No Unintended Persistence:** `previewScenario` explicitly leaves `preferredFormatRef` and `UserViewPreferenceData` untouched. Only an explicit click on **Guardar Preferencia** triggers `handleSavePreference`.

---

## 8. Actual Implementation Status
- **All 4 Contextual Preview Cards:** Truly implemented (not placeholders), backed by `InstrumentRegistry`, `StandFormatCapabilityResolver`, `ProjectionService`, `OSMD`, `AlphaTab`, and `LeadSheetDOM`.
- **All 4 Atril Reading Formats:** Truly implemented with backend/local capability gating, approval status (`APPROVED`/`DRAFT`), Zero-Fabrication guards, completion workflow modal (`FormatCompletionWizardModal`), and user preference persistence.

---

## 9. UX Problems & User Confusion Risks
1. **Two competing card rows for viewing the same score:** A musician sees 4 large cards at the top (`Guitarra`, `Partitura`, `Saxofón Eb`, `Lead Sheet`) and 4 more cards right below (`Partitura`, `Cifrado con Letra`, `Letra Sola`, `Tablatura`)—two of which share the exact name **"Partitura"** and two of which are both **"Lead Sheet / Cifrado con Letra"**.
2. **Hardcoded Capo 2 & Eb assumptions in upper cards:** A guitarist wanting Capo 4 or a trumpeter in Bb sees hardcoded `Capo 2` and `Saxofón Eb` cards at the top of the screen while the real instrument/capo/transposition controls sit lower down.
3. **Inconsistent gating:** `Cifrado con Letra` is locked (`FALTA CONTENIDO`) on a chord-only song, while `Lead Sheet — Cifrado + Letra` above it remains clickable (`Parcial`).
4. **High vertical & cognitive density on tablet/mobile:** Having Song Catalog/Import bar + SongHeader + 4 Scenario Cards + 4 Reading Format Cards + `InstrumentSelector` + `RepresentationSelector` + `Capo`/`Transposition` + `RendererStatus` before the music stand pushes reading space down and confuses musicians who do not think in terms of "dev regression scenarios".

---

## 10. Recommended UX Architecture
**Recommendation: Option B — One Unified, Role-Separated Interface (Clean Atril First), removing the 4 top `ScenarioPresets` cards from the primary musician workspace (or moving them to an optional "Vistas Rápidas / Demostración" drawer/menu).**

1. **Primary Reading Format Bar (4 Canonical Formats):** Keep `ReadingFormatSelector` (`Partitura` / `Gran Pentagrama`, `Cifrado con Letra`, `Letra Sola`, `Tablatura`) as the **single source of truth** for *what* musical format is displayed, preserving its strict Zero-Fabrication gating, approval badges, completion wizard, and saved preference support.
2. **Unified Instrument & Adaptation Strip (Compact Toolbar):** Keep `InstrumentSelector`, `CapoControl`, `TranspositionControl`, and `ChordNotationControl` as **contextual non-destructive adaptations** of the active song for the musician's actual instrument—eliminating the hardcoded `Capo 2` / `Saxofón Eb` / `Lead Vocal` macro cards from the main reading flow.
3. **Consolidate `RepresentationSelector`:** Fold secondary layer toggles (e.g., `+ Acordes`, `+ Letra` overlay on Partitura/Tablatura) into compact toggle chips next to `ReadingFormatSelector` instead of a separate `RepresentationSelector` card duplicating primary/secondary controls.
4. **Preserve `GOLDEN_SCENARIO_PRESETS` in Core/Tests:** Keep `GOLDEN_SCENARIO_PRESETS` and `transitionApplyPreset` in `presets.ts` / `workspace-orchestrator.ts` for automated Phase 1G/1H regression tests, or surface them only behind a collapsed "Escenarios de Prueba / Vista Rápida" menu for admins/QA.

---

## 11. Proposed Future Implementation Phases (Pending Approval)
- **Phase 1 (UX Simplification):** Move `ScenarioPresets` into a collapsible QA/Quick-Preview popover (or remove from default musician view) while keeping `GOLDEN_SCENARIO_PRESETS` for unit/regression suites.
- **Phase 2 (Controls Consolidation):** Merge `RepresentationSelector` secondary overlays (e.g., showing chords over staff/tab) into compact toggle pills alongside `ReadingFormatSelector`.
- **Phase 3 (Mobile & Tablet Polish):** Compact the Instrument + Capo + Transposition strip into a single collapsible toolbar so the Music Stand occupies maximum vertical space on tablet and mobile.

---

## 12. Risks & Dependencies
- Removing `<ScenarioPresets>` from `MusicalWorkspace` affects `scenario-cards-non-destructive.test.ts` (which tests `ScenarioPresets` directly, so if moved to a collapsible drawer, the component and test remain valid; if removed from UI, update tests accordingly).
- `ReadingFormatSelector` tests (`reading-format-selector.test.ts`) and `stand-format-capabilities.test.ts` depend on `computeFormatDefinitions` and `StandFormatCapabilityResolver` contracts—do not alter their gating invariants.

---

## 13. Manual Validation Recommendations
Before approving any UX consolidation, manually verify in `localhost:5173`:
- Compare selecting `Scenario D` vs. `Cifrado con Letra` on both a complete MusicXML song and a ChordPro-only song.
- Compare selecting `Scenario B` vs. `Partitura` when `Piano Acústico` is selected.
- Observe vertical space above `<main>` on mobile (`375px`) and tablet (`768px`).

---

## 14. Final Audit Verdict
**`AUDIT COMPLETE — SIGNIFICANT UX OVERLAP & DUPLICATION CONFIRMED; CANONICAL DATA SAFE`**  
Both sections are genuinely implemented and **non-destructive** to canonical song data, but exposing `ScenarioPresets` alongside `ReadingFormatSelector` (and `RepresentationSelector`) creates redundant, partially overlapping controls for the same underlying `IWorkspaceState`. Consolidating around `ReadingFormatSelector` + unified Instrument/Capo/Transposition controls is strongly recommended once approved by the Product Owner.
