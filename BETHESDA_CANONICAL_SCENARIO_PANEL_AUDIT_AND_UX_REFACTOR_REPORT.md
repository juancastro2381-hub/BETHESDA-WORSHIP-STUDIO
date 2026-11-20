# BETHESDA WORSHIP STUDIO — CANONICAL SCENARIO PANEL AUDIT & UX REFACTOR REPORT

**Date:** `2026-11-20T11:01:50-05:00`  
**Branch / HEAD:** `feature/phase-1a-core-foundation` @ `12043f4`  
**Final Verdict:** `CONDITIONAL PASS` — Implementation and automated validations complete; manual browser verification pending.

---

## 1. Executive Summary
Audited the permanently visible **`CANCIÓN CANÓNICA ACTIVA`** bar (`SongSelector.tsx` + `WORKSPACE_SONG_CATALOG` in `presets.ts`) and separated it from the normal musician workflow by moving `<SongSelector />` into the existing collapsed-by-default QA/quick-view drawer (`<details className="quick-scenarios-drawer">`) below the Music Stand (`<main>`). All scenario data, fixtures, `SongSelector`, `ScenarioPresets`, and regression tests remain 100% intact.

---

## 2. Problem Description
In the upper `.catalog-and-import-bar` of `MusicalWorkspace.tsx`, musicians saw three internal Phase 1G synthetic song pills (`Sublime Gracia (Notación Completa — Sol Mayor)`, `Sublime Gracia (ChordPro — Solo Cifrado y Letra)`, and `Canción Vacía (Edge Case / Sin compases)`) permanently displayed next to real workflows (`Repertorios de Culto`, `Catálogo en Base de Datos`, `Centro de Conversión`, `Importar Archivo`).

---

## 3. Root Cause
`MusicalWorkspace.tsx` (lines `620–631`) rendered `<SongSelector />` unconditionally whenever `!isMusicStandMode`, without gating or placing it inside a secondary QA/developer container.

---

## 4. Component Architecture & Dependency Analysis
- **`frontend/src/components/workspace/SongSelector.tsx`:** Renders `.song-selector-container` with `CANCIÓN CANÓNICA ACTIVA:` and radio-group pills mapped from `WORKSPACE_SONG_CATALOG`.
- **`frontend/src/core/workspace/presets.ts`:** Exports `WORKSPACE_SONG_CATALOG` (`song_g_major_notes`, `song_g_major_chordpro`, `song_empty`) and `createEmptyCanonicalSong()`.
- **`frontend/src/core/workspace/__tests__/musical-workspace.test.ts`:** Imports `WORKSPACE_SONG_CATALOG` directly for Phase 1G unit testing.
- **`frontend/src/components/workspace/MusicalWorkspace.tsx`:** Imports `SongSelector` and wires `onSelectSong` to `selectSong(song)` (in-memory replacement of `activeSong`, clearing `importedMeta`/`persistedMeta` and active setlist song state if a setlist is loaded).
- **Existing Secondary Drawer:** `MusicalWorkspace.tsx` already contained `<details className="quick-scenarios-drawer">` below `</main>` for `ScenarioPresets`.

---

## 5. Purpose of Each Canonical Scenario (`WORKSPACE_SONG_CATALOG`)
1. **`Sublime Gracia (Notación Completa — Sol Mayor)` (`song_g_major_notes`):** Phase 1G full-notation fixture (`createCanonicalSongGMajorWithNotes`) for validating OSMD, AlphaTab, transposition, and capo calculations.
2. **`Sublime Gracia (ChordPro — Solo Cifrado y Letra)` (`song_g_major_chordpro`):** Phase 1G zero-melody Lead Sheet fixture (`createCanonicalSongGMajorChordsAndLyricsOnly`) for validating `totalMelodyNotes === 0` invariants and `CHORD_CHART` / `LYRICS_ONLY`.
3. **`Canción Vacía (Edge Case / Sin compases)` (`song_empty`):** Empty-timeline edge-case fixture (`createEmptyCanonicalSong`) for verifying graceful empty-state handling and strict format disabling.

---

## 6. Impact on the Normal Musician Workspace
- Exposed developer/QA terminology (`Edge Case / Sin compases`, `ChordPro`) permanently above the Music Stand.
- Clicking any pill replaced the musician's currently loaded song (`activeSong`) in-memory with a hardcoded fixture and triggered `notifyOffSetlistSongSelected` if a worship setlist was active.
- Consumed horizontal/vertical space in `.catalog-and-import-bar` ahead of real worship setlists and DB songs.

---

## 7. Proposed Architectural Solution
Reuse the existing collapsed-by-default `<details className="quick-scenarios-drawer">` below `</main>` in `MusicalWorkspace.tsx` to house `<SongSelector />` alongside `<ScenarioPresets />` under the clear label **"Vistas rápidas y canciones de prueba (QA / previsualización no destructiva)"**. This avoids deleting fixtures, avoids breaking `musical-workspace.test.ts`, and avoids introducing unnecessary auth/role complexity.

---

## 8. Implementation Details
- Removed `<SongSelector />` from `.catalog-and-import-bar` in `MusicalWorkspace.tsx` so the top bar contains only real musician tools (`Repertorios de Culto`, `Catálogo en Base de Datos`, `Centro de Conversión`, `Importar Archivo`).
- Placed `<SongSelector />` inside `.quick-scenarios-body` within `<details className="quick-scenarios-drawer">` below `</main>`, preserving its exact `onSelectSong` handler.
- Added `display: flex; flex-direction: column; gap: 0.85rem;` to `.quick-scenarios-body` in `frontend/src/index.css`.

---

## 9. Exact Files Modified
- `frontend/src/components/workspace/MusicalWorkspace.tsx`
- `frontend/src/index.css`
- Added report: `BETHESDA_CANONICAL_SCENARIO_PANEL_AUDIT_AND_UX_REFACTOR_REPORT.md`

---

## 10. Preservation Analysis
- **Preserved unchanged:** `SongSelector.tsx`, `presets.ts` (`WORKSPACE_SONG_CATALOG`, `GOLDEN_SCENARIO_PRESETS`), `MusicalControls.tsx`, `ScenarioPresets.tsx`, `use-musical-workspace.ts`, canonical song models, backend services, DB schemas, and all existing tests.

---

## 11. Validation Results (`2026-11-20T11:01:35-05:00`)
- **Static TypeScript Check (`npm --prefix frontend run typecheck` -> `tsc --noEmit`):** **PASSED (exit code `0`, 0 errors).**
- **Production Build (`npm --prefix frontend run build` -> `vite build`):** **PASSED (exit code `0`, 151 modules transformed in `802ms`; `dist/assets/index-BbXRKNf7.css` `140.31 kB`, `dist/assets/index-BImW1d01.js` `3,262.55 kB`).**

---

## 12. Tests Executed (`npx tsx --test`)
**51/51 passed across 6 suites (0 failed, 0 skipped, 0 todo):**
- `src/core/workspace/__tests__/musical-workspace.test.ts` (`17/17`, including Golden Scenarios A–D)
- `src/core/workspace/__tests__/phase2c-liturgical-and-stand.test.ts` (`11/11`)
- `src/core/workspace/__tests__/reading-format-selector.test.ts` (`10/10`)
- `src/core/workspace/__tests__/scenario-cards-non-destructive.test.ts` (`3/3`)
- `src/core/workspace/__tests__/stand-format-capabilities.test.ts` (`10/10`)

---

## 13. Tests Not Executed
- Automated browser tests (Playwright/Selenium/Cypress) — excluded by scope.
- Interactive manual browser inspection — pending execution by Project Owner.

---

## 14. Manual Validation Checklist
1. Open the Musical Workspace in a browser (`localhost:5173`) and confirm `CANCIÓN CANÓNICA ACTIVA` / `Canción Vacía (Edge Case / Sin compases)` is **not** visible in the top `.catalog-and-import-bar`.
2. Confirm `Repertorios de Culto (Setlists)`, `Catálogo en Base de Datos`, `Centro de Conversión`, and `Importar Archivo` work normally above the score.
3. Scroll below the Music Stand (`<main>`) and expand **`Vistas rápidas y canciones de prueba (QA / previsualización no destructiva)`**.
4. Confirm both `SongSelector` (`Sublime Gracia` full, `ChordPro`, `Canción Vacía`) and `ScenarioPresets` render cleanly inside the drawer and still switch fixtures/previews when needed for QA.
5. Check Dark & Light themes on desktop and mobile.

---

## 15. Remaining Risks
- Low visual risk: `.quick-scenarios-body` spacing between `<SongSelector />` and `<ScenarioPresets />` inside the expanded drawer should be visually checked in Light and Dark themes.

---

## 16. Final Verdict
**`CONDITIONAL PASS`** — Implementation complete and all static/unit/build validations pass (`typecheck` 0 errors, 51/51 tests, `vite build` clean); manual browser inspection pending.
