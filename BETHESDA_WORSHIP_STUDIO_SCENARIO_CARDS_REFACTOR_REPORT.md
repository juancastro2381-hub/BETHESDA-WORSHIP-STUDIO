# BETHESDA WORSHIP STUDIO — SCENARIO CARDS NON-DESTRUCTIVE REFACTOR REPORT

## 1. Executive Summary
The four Scenario Cards (`SCENARIO_A`..`SCENARIO_D` in `ScenarioPresets`) were refactored from destructive workspace/song-replacement presets into **non-destructive, contextual viewing-mode previews** over the currently active song.

Previously, clicking any Scenario Card executed `applyPreset(presetId)`, which invoked `preset.canonicalSongFactory()` and overwrote `activeSong`, `persistedMeta`, `importedMeta`, and `preferredFormatRef.current` with hardcoded demo song fixtures (such as `"Sublime Gracia"`). Now, clicking a Scenario Card calls `previewScenario(presetId)`, preserving the active song, its canonical musical payload, and its metadata while temporarily applying the scenario's instrument/notation/capo/renderer preview configuration—with real per-song compatibility badges (`Compatible`, `Solo cifrado`, `Sin melodía`, `Parcial`, `No disponible`) and a one-click `Volver a mi vista original` restore action.

---

## 2. Pre-Flight Findings & Root Cause
- **Component & Data Locations:**
  - UI Component: `frontend/src/components/workspace/ScenarioPresets.tsx`
  - Preset Definitions: `frontend/src/core/workspace/presets.ts` (`GOLDEN_SCENARIO_PRESETS`)
  - Workspace Hook: `frontend/src/core/workspace/use-musical-workspace.ts` (`useMusicalWorkspace`)
  - State Transitions: `frontend/src/core/workspace/workspace-orchestrator.ts` (`transitionApplyPreset`, `transitionSelectInstrument`, `transitionSetPrimary`, `transitionToggleSecondary`, `transitionSetCapo`)
  - Workspace Container: `frontend/src/components/workspace/MusicalWorkspace.tsx`
  - Styling: `frontend/src/index.css`
- **Root Cause:**
  1. `MusicalWorkspace.tsx` wired `<ScenarioPresets onApplyPreset={applyPreset} />`.
  2. `useMusicalWorkspace.applyPreset(presetId)` unconditionally invoked `preset.canonicalSongFactory()`, overwriting `activeSong`, clearing `importedMeta(null)` and `persistedMeta(null)`, and resetting `preferredFormatRef.current = null`.
  3. Card subtitles/descriptions used demo-song wording (e.g., `"Canción en Sol Mayor"`, `"Tono de concierto Sol Mayor"`) without distinguishing preview controls from song selectors or showing compatibility with the currently loaded song.

---

## 3. Architecture & Technical Decisions
1. **Non-Destructive Preview State (`previewScenario` / `exitScenarioPreview`):**
   - Added `activeScenarioPreview: PresetScenarioId | null` and `savedStateBeforePreviewRef` in `useMusicalWorkspace`.
   - Clicking a Scenario Card calls `previewScenario(presetId)`:
     - If `activeScenarioPreview === presetId`, it exits the preview (`exitScenarioPreview()`) and restores the exact saved configuration.
     - Otherwise, if no preview is currently active, it snapshots `state` into `savedStateBeforePreviewRef.current`.
     - Applies only the scenario's viewing configuration (instrument, primary/secondary representations, capo, renderer preference) via `transitionSelectInstrument`, `transitionSetPrimary`, `transitionToggleSecondary`, and `transitionSetCapo` over the **existing** `activeSong`.
     - **Never** mutates `activeSong`, `persistedMeta`, `importedMeta`, or `preferredFormatRef.current`.
   - Changing songs (`selectSong`, `selectPersistedSong`) or manually changing instrument/reading format clears `activeScenarioPreview` and `savedStateBeforePreviewRef`.
2. **Backwards Compatibility for Existing Tests:**
   - Kept `GOLDEN_SCENARIO_PRESETS` technical IDs, `canonicalSongFactory`, `transitionApplyPreset`, and `applyPreset` intact so existing Phase 1G/1H/3A test suites (`musical-workspace.test.ts`, `real-ingestion-scenarios.test.ts`, `reading-format-selector.test.ts`) continue to pass without breaking contracts.
3. **Zero-Fabrication Compatibility Badges (`ScenarioPresets.tsx`):**
   - Evaluates `StandFormatCapabilityResolver.evaluateAll(activeSong, { ...instrumentConfig, capoFret })` for each scenario against the active song.
   - Displays honest compatibility pills (`Compatible`, `Solo cifrado`, `Sin melodía`, `Parcial`, `No disponible`) without fabricating melody notes, chords, or tablature.
   - Unavailable scenarios remain safely disabled/non-destructive rather than inventing content.
4. **Visual Distinction & Responsive Layout (`frontend/src/index.css`):**
   - Header (`Modos de Previsualización Contextual (no reemplaza la canción activa)`), dashed card borders (`border: 1px dashed`), `.scenario-preview-banner` with `Volver a mi vista original`, and light-mode contrast rules under `[data-theme="light"]`.
   - Desktop: 4-column grid; Tablet (`<= 1120px`): 2-column grid; Mobile (`<= 767px`): compact horizontal snap-scroll strip so the reading viewport remains uncluttered.

---

## 4. Files Modified / Added
- `frontend/src/core/workspace/presets.ts` — Updated `GOLDEN_SCENARIO_PRESETS` names, `VISTA PREVIA • ...` subtitles, and contextual descriptions.
- `frontend/src/core/workspace/use-musical-workspace.ts` — Added `activeScenarioPreview`, `savedStateBeforePreviewRef`, `previewScenario`, and `exitScenarioPreview`, clearing preview state on song/manual view changes.
- `frontend/src/components/workspace/ScenarioPresets.tsx` — Refactored cards to display compatibility badges against `activeSong`, `VISTA PREVIA` context header, and `.scenario-preview-banner` with restore button.
- `frontend/src/components/workspace/MusicalWorkspace.tsx` — Passed `activeSong`, `activeScenarioPreview`, `onPreviewScenario={previewScenario}`, and `onExitPreview={exitScenarioPreview}` to `<ScenarioPresets />`.
- `frontend/src/index.css` — Added dashed preview card styling, compatibility badge styles, preview banner styles, responsive tablet/mobile rules, and `[data-theme="light"]` contrast adaptations.
- `frontend/src/core/workspace/__tests__/scenario-cards-non-destructive.test.ts` — Added dedicated unit + React SSR verification suite.

---

## 5. Verification Results

### Static Analysis & Automated Unit / Integration Suites
- `npm --prefix frontend run typecheck` (`tsc --noEmit`): **PASSED** (0 errors, verified after final edit).
- `npx tsx --test "src/core/workspace/__tests__/scenario-cards-non-destructive.test.ts"` (after final edit): **2/2 passed** (non-destructive preview across Scenarios A–D, preservation of `activeSong`/`persistedMeta`/canonical content, restore on `exitScenarioPreview`, `VISTA PREVIA` labels).
- Earlier suite run prior to final `[data-theme="light"]` CSS-only addition (`task-22245` + regression run):
  - `autoscroll.test.ts`: **10/10 passed**
  - `musical-completeness-remediation.test.ts`: **4/4 passed**
  - `musical-workspace.test.ts`: **17/17 passed**
  - `reading-format-selector.test.ts`: **10/10 passed**
  - `stand-format-capabilities.test.ts`: **10/10 passed**
  - `real-ingestion-scenarios.test.ts`: **15/15 passed**
  - `phase2c-liturgical-and-stand.test.ts`: **11/11 passed**

### Manual Browser Validation Checklist
Interactive browser tests (desktop, tablet, mobile, light/dark toggle, click-through across active songs) were **not** executed via automated browser tools (`Playwright`/`Cypress` excluded by scope):
1. Desktop active-song preservation on Scenario A–D click: **PENDING MANUAL VALIDATION**
2. Banner `"Volver a mi vista original"` full config restoration: **PENDING MANUAL VALIDATION**
3. Chord-only / lyrics-only compatibility badge accuracy in live UI: **PENDING MANUAL VALIDATION**
4. Tablet (`<= 1120px`) 2-column grid layout: **PENDING MANUAL VALIDATION**
5. Mobile (`<= 767px`) horizontal snap-scroll strip without crowding music stand: **PENDING MANUAL VALIDATION**
6. Dark & Light theme contrast check on banner, badges, and dashed borders: **PENDING MANUAL VALIDATION**
7. Song switch clearing active preview banner cleanly: **PENDING MANUAL VALIDATION**

---

## 6. Known Limitations & Recommendations
- **Working Tree State:** `frontend/src/components/workspace/MusicalWorkspace.tsx` and `frontend/src/index.css` also contain uncommitted changes from prior unapproved-for-commit tasks (Autoscroll remediation, Floating Controls, Mobile Reading Layout). Coordinate staging before committing if separate commits per workstream are desired.
- **Recommendation:** Perform a quick manual smoke check in the browser across dark and light modes on desktop and mobile viewports to close out the 7 pending manual validation items above.
