/**
 * @file reading-format-selector.test.ts
 * @description Suite de pruebas para los formatos de lectura del músico, persistencia de vista y navegación en el workspace (Fase 3A — WP-03 / Priority 1).
 *
 * Cobertura de Verificación:
 * 1. Finding A: Pruebas a nivel de componente real (ReadingFormatSelector) renderizado mediante react-dom/server (renderToStaticMarkup):
 *    - Canción con acordes pero sin letra: desactiva "Cifrado con Letra" con tooltip y badge de texto explicativo.
 *    - Canción con acordes y letra: habilita "Cifrado con Letra" sin disabled y permite selección.
 *    - Canción de solo silencios (0 notas): desactiva Partitura y Tablatura con badge explicativo (F-03).
 *    - Verificación de atributos ARIA y tooltips accesibles.
 *    - Callback y persistencia de preferencias (onSelectFormat y onSavePreference).
 * 2. Finding B: Pruebas de integración del ciclo de vida y navegación del Workspace:
 *    - Hook useMusicalWorkspace: montado y ejecutado en arnés React (renderToStaticMarkup) para verificar render inicial y contrato público de callbacks.
 *    - MusicalWorkspaceSession: ejercita la máquina de estados y el ciclo completo de navegación multi-paso a través de las funciones de transición puras compartidas 1:1 con el hook.
 *    - Carga de preferencia con STANDARD_NOTATION.
 *    - Canción con notas proyecta STANDARD_NOTATION.
 *    - Navegación a Lead Sheet (0 notas) aplica fallback seguro determinista a CHORDS + LYRICS (F-04).
 *    - Invariante estricto: la preferencia almacenada NUNCA es mutada ni sobrescrita por el fallback.
 *    - Navegación de vuelta a canción con notas restaura automáticamente STANDARD_NOTATION.
 *    - Proyección válida y no nula durante todas las transiciones (cero parpadeo o proyección en blanco).
 *    - Canción con acordes pero sin letra ni notas aplica fallback a "Cifrado Solo" (CHORDS sin LYRICS).
 * 3. Invariantes de dominio e inmutabilidad estricta de CanonicalMusicPayload.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { GOLDEN_SCENARIO_PRESETS } from '../presets.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Rest, Voice } from '../../canonical-model/musical-event.ts';
import {
  transitionSetPrimary,
  transitionToggleSecondary,
  orchestrateWorkspaceView,
  createInitialWorkspaceState,
  resolveEffectiveViewRepresentation,
  transitionSelectSong,
  transitionApplyUserPreference,
  transitionSetReadingFormat,
  MusicalWorkspaceSession,
} from '../workspace-orchestrator.ts';
import { useMusicalWorkspace } from '../use-musical-workspace.ts';
import {
  ReadingFormatSelector,
  computeFormatDefinitions,
  type ReadingFormatSelectorProps,
} from '../../../components/workspace/reading-format-selector-component.ts';
import type { UserViewPreferenceData } from '../../api/preference-types.ts';

describe('Reading Formats & Musician View Preferences Suite (Fase 3A — WP-03 / Priority 1)', () => {
  const instrumentRegistry = new InstrumentRegistry();

  // Helper para fabricar una canción Lead Sheet pura (CERO notas de melodía, solo acordes y letra)
  function createPureLeadSheetSong(): CanonicalMusicPayload {
    const base = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const measuresWithoutNotes = base.measures.map((m) => {
      return new Measure({
        number: m.number,
        timeSignature: m.timeSignature,
        keySignature: m.keySignature,
        startTick: m.startTick,
        durationTicks: m.durationTicks,
        voices: [], // CERO notas melódicas (Lead Sheet puro)
        chords: [...m.chords],
        lyrics: [...m.lyrics],
      });
    });

    return new CanonicalMusicPayload({
      title: 'Canción Lead Sheet Pura',
      timeline: base.timeline,
      measures: measuresWithoutNotes,
      sections: [...base.sections],
    });
  }

  // Helper para fabricar una canción instrumental pura (notas y acordes, CERO letra)
  function createInstrumentalSong(): CanonicalMusicPayload {
    const base = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const measuresWithoutLyrics = base.measures.map((m) => {
      return new Measure({
        number: m.number,
        timeSignature: m.timeSignature,
        keySignature: m.keySignature,
        startTick: m.startTick,
        durationTicks: m.durationTicks,
        voices: [...m.voices],
        chords: [...m.chords],
        lyrics: [], // CERO letra
      });
    });

    return new CanonicalMusicPayload({
      title: 'Preludio Instrumental',
      timeline: base.timeline,
      measures: measuresWithoutLyrics,
      sections: [...base.sections],
    });
  }

  // Helper para fabricar una canción con acordes pero sin letra ni notas (Cifrado puro)
  function createChordsOnlySong(): CanonicalMusicPayload {
    const base = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const measures = base.measures.map((m) => {
      return new Measure({
        number: m.number,
        timeSignature: m.timeSignature,
        keySignature: m.keySignature,
        startTick: m.startTick,
        durationTicks: m.durationTicks,
        voices: [], // CERO notas melódicas
        chords: [...m.chords],
        lyrics: [], // CERO letra
      });
    });

    return new CanonicalMusicPayload({
      title: 'Canción Cifrado Solo Sin Letra',
      timeline: base.timeline,
      measures,
      sections: [...base.sections],
    });
  }

  // Helper para fabricar una canción con silencios (Rest) pero CERO notas melódicas (F-03)
  function createRestsOnlySong(): CanonicalMusicPayload {
    const base = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const measuresWithRestsOnly = base.measures.map((m) => {
      const restEvents = [
        new Rest({
          id: `rest-${m.number}-1`,
          startTick: m.startTick,
          durationTicks: m.durationTicks,
          voice: 1,
          staff: 1,
        }),
      ];
      const voiceWithRests = new Voice(1, restEvents);

      return new Measure({
        number: m.number,
        timeSignature: m.timeSignature,
        keySignature: m.keySignature,
        startTick: m.startTick,
        durationTicks: m.durationTicks,
        voices: [voiceWithRests], // Silencios presentes, CERO notas
        chords: [...m.chords],
        lyrics: [...m.lyrics],
      });
    });

    return new CanonicalMusicPayload({
      title: 'Canción con Silencios Sin Notas',
      timeline: base.timeline,
      measures: measuresWithRestsOnly,
      sections: [...base.sections],
    });
  }

  // -------------------------------------------------------------------------
  // SECTION 1: Finding A — Real Selector Component Coverage (Rendered DOM & Props)
  // -------------------------------------------------------------------------

  it('A.1 should render ReadingFormatSelector and disable "Cifrado con Letra" when song has chords but NO lyrics', () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');
    const instrumentalSong = createInstrumentalSong(); // Tiene acordes, 0 letra

    let selectedPrimary: any = null;
    let selectedSecondary: any = null;

    const props: ReadingFormatSelectorProps = {
      song: instrumentalSong,
      instrumentProfile: guitarProfile,
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: [],
      userPreferences: null,
      isAuthenticated: false,
      onSelectFormat: (p, s) => {
        selectedPrimary = p;
        selectedSecondary = s;
      },
    };

    // Renderizar el componente real de React dentro de un harness para activar hooks SSR
    let capturedTree: any = null;
    function CaptureHarnessA1() {
      capturedTree = ReadingFormatSelector(props);
      return capturedTree;
    }
    const html = renderToStaticMarkup(React.createElement(CaptureHarnessA1));

    // Aserción en el marcado HTML real del componente
    assert.ok(html.includes('reading-format-selector-card'), 'Debe renderizar la tarjeta del selector');
    assert.ok(html.includes('Cifrado con Letra'), 'Debe incluir la opción Cifrado con Letra');
    assert.ok(
      html.includes('id="fmt-unavail-CHORD_CHART"'),
      'Debe incluir el elemento de badge de indisponibilidad para CHORD_CHART'
    );
    assert.ok(
      html.includes('La canción no contiene texto lírico para acompañar el cifrado.'),
      'Debe mostrar el mensaje accesible exacto de falta de letra'
    );

    // Inspeccionar la definición computada directamente por el componente
    const defs = computeFormatDefinitions(instrumentalSong, guitarProfile);
    const chordChartDef = defs.find((d) => d.id === 'CHORD_CHART');
    assert.ok(chordChartDef, 'Debe existir la definición CHORD_CHART');
    assert.equal(chordChartDef.isAvailable, false, 'CHORD_CHART debe estar marcado como no disponible');
    assert.equal(
      chordChartDef.unavailabilityReason,
      'La canción no contiene texto lírico para acompañar el cifrado.'
    );

    // Verificar que un click en un formato no disponible no dispara la acción
    const buttonsDiv = Array.isArray(capturedTree?.props?.children)
      ? capturedTree.props.children.find((c: any) => c?.props?.className === 'reading-format-buttons')
      : null;
    const buttons = buttonsDiv?.props?.children ?? [];
    const chordChartBtn = buttons.find((b: any) => b.key === 'CHORD_CHART');
    assert.ok(chordChartBtn, 'Debe existir el elemento del botón CHORD_CHART');
    assert.ok(chordChartBtn.props.disabled, 'El botón real debe tener el atributo disabled');
    chordChartBtn.props.onClick();
    assert.equal(selectedPrimary, null, 'No debe disparar onSelectFormat al estar deshabilitado');
  });

  it('A.2 should render ReadingFormatSelector and enable "Cifrado con Letra" when song has chords AND lyrics', () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');
    const leadSheetSong = createPureLeadSheetSong(); // Tiene acordes y letra, 0 notas

    let selectedPrimary: any = null;
    let selectedSecondary: any = null;

    const props: ReadingFormatSelectorProps = {
      song: leadSheetSong,
      instrumentProfile: guitarProfile,
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS', 'SECTION_MARKERS'],
      userPreferences: null,
      isAuthenticated: false,
      onSelectFormat: (p, s) => {
        selectedPrimary = p;
        selectedSecondary = s;
      },
    };

    let capturedTreeA2: any = null;
    function CaptureHarnessA2() {
      capturedTreeA2 = ReadingFormatSelector(props);
      return capturedTreeA2;
    }
    const html = renderToStaticMarkup(React.createElement(CaptureHarnessA2));

    // El botón debe estar activo y no deshabilitado
    assert.ok(html.includes('aria-checked="true"'), 'Debe marcar aria-checked="true" en la vista seleccionada');
    assert.ok(
      !html.includes('id="fmt-unavail-CHORD_CHART"'),
      'No debe contener badge de indisponibilidad para CHORD_CHART'
    );

    const defs = computeFormatDefinitions(leadSheetSong, guitarProfile);
    const chordChartDef = defs.find((d) => d.id === 'CHORD_CHART');
    assert.ok(chordChartDef);
    assert.equal(chordChartDef.isAvailable, true, 'CHORD_CHART debe estar disponible');
    assert.equal(chordChartDef.unavailabilityReason, '');

    // Simular click en el botón habilitado
    const buttonsDiv = Array.isArray(capturedTreeA2?.props?.children)
      ? capturedTreeA2.props.children.find((c: any) => c?.props?.className === 'reading-format-buttons')
      : null;
    const buttons = buttonsDiv?.props?.children ?? [];
    const chordChartBtn = buttons.find((b: any) => b.key === 'CHORD_CHART');
    assert.ok(chordChartBtn, 'Debe existir el botón CHORD_CHART');
    assert.equal(chordChartBtn.props.disabled, false, 'El botón no debe estar deshabilitado');
    chordChartBtn.props.onClick();
    assert.equal(selectedPrimary, 'CHORDS');
    assert.deepEqual(selectedSecondary, ['LYRICS', 'SECTION_MARKERS']);
  });

  it('A.3 should render ReadingFormatSelector and disable note-dependent formats for rests-only song (F-03)', () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');
    const restsOnlySong = createRestsOnlySong();

    const props: ReadingFormatSelectorProps = {
      song: restsOnlySong,
      instrumentProfile: guitarProfile,
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
      userPreferences: null,
      isAuthenticated: false,
      onSelectFormat: () => {},
    };

    const html = renderToStaticMarkup(React.createElement(ReadingFormatSelector, props));

    // Partitura y Tablatura deben estar deshabilitadas en el HTML real
    assert.ok(
      html.includes('id="fmt-unavail-STAFF_NOTATION"'),
      'Debe incluir badge de indisponibilidad para STAFF_NOTATION'
    );
    assert.ok(
      html.includes('La canción no contiene notas melódicas (Lead Sheet Puro).'),
      'Debe mostrar mensaje de falta de notas'
    );
    assert.ok(
      html.includes('id="fmt-unavail-TABLATURE"'),
      'Debe incluir badge de indisponibilidad para TABLATURE'
    );
    assert.ok(
      html.includes('Sin notas melódicas para calcular digitación en trastes.'),
      'Debe mostrar mensaje de tablatura sin notas'
    );

    const defs = computeFormatDefinitions(restsOnlySong, guitarProfile);
    const staffDef = defs.find((d) => d.id === 'STAFF_NOTATION')!;
    const tabDef = defs.find((d) => d.id === 'TABLATURE')!;

    assert.equal(staffDef.isAvailable, false);
    assert.equal(tabDef.isAvailable, false);
  });

  it('A.4 should render accurate ARIA attributes, semantic roles and tooltips', () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');
    const song = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();

    const props: ReadingFormatSelectorProps = {
      song,
      instrumentProfile: guitarProfile,
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: [],
      userPreferences: null,
      isAuthenticated: false,
      onSelectFormat: () => {},
    };

    const html = renderToStaticMarkup(React.createElement(ReadingFormatSelector, props));

    assert.ok(html.includes('role="radiogroup"'), 'El contenedor de botones debe tener role="radiogroup"');
    assert.ok(html.includes('aria-labelledby="reading-format-label"'), 'Debe enlazar con la etiqueta de encabezado');
    assert.ok(html.includes('role="radio"'), 'Cada formato debe ser role="radio"');
  });

  it('A.5 should render preference persistence button when authenticated and reflect saved match', async () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');
    const song = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();

    const storedPref: UserViewPreferenceData = {
      userId: 'usr-123',
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 0,
      clefOverride: null,
      preferFlats: false,
    };

    let saveCalledWith: any = null;
    const mockSave = async (prim: any, sec: any) => {
      saveCalledWith = { prim, sec };
    };

    // Caso 1: La vista actual NO coincide con la guardada -> botón activo "Guardar como Preferida"
    const propsMismatch: ReadingFormatSelectorProps = {
      song,
      instrumentProfile: guitarProfile,
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: [],
      userPreferences: storedPref,
      isAuthenticated: true,
      onSelectFormat: () => {},
      onSavePreference: mockSave,
    };

    const htmlMismatch = renderToStaticMarkup(React.createElement(ReadingFormatSelector, propsMismatch));
    assert.ok(htmlMismatch.includes('btn-save-preference'), 'Debe renderizar el botón de guardar');
    assert.ok(htmlMismatch.includes('Guardar como Preferida'), 'Debe indicar Guardar como Preferida');
    assert.ok(!htmlMismatch.includes('is-preferred'), 'No debe tener la clase is-preferred');

    // Caso 2: La vista actual COINCIDE con la guardada -> botón inactivo "Vista Preferida Guardada"
    const propsMatch: ReadingFormatSelectorProps = {
      song,
      instrumentProfile: guitarProfile,
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
      userPreferences: storedPref,
      isAuthenticated: true,
      onSelectFormat: () => {},
      onSavePreference: mockSave,
    };

    const htmlMatch = renderToStaticMarkup(React.createElement(ReadingFormatSelector, propsMatch));
    assert.ok(htmlMatch.includes('is-preferred'), 'Debe tener la clase is-preferred');
    assert.ok(htmlMatch.includes('Vista Preferida Guardada'), 'Debe indicar Vista Preferida Guardada');
    assert.ok(htmlMatch.includes('disabled=""'), 'Debe estar deshabilitado al ya estar guardado');
  });

  // -------------------------------------------------------------------------
  // SECTION 2: Finding B — Real Workspace Hook and Navigation Lifecycle Coverage
  // -------------------------------------------------------------------------

  it('B.1 should mount and execute useMusicalWorkspace hook via React test harness (initial render & API contract)', () => {
    // Harness de prueba que ejecuta el hook real useMusicalWorkspace en SSR
    let capturedResult: any = null;
    let capturedHook: any = null;

    function WorkspaceHarness() {
      const ws = useMusicalWorkspace();
      capturedResult = ws.viewResult;
      capturedHook = ws;
      return React.createElement(
        'div',
        { 'data-testid': 'workspace-harness' },
        ws.viewResult.state.primaryRepresentation
      );
    }

    const html = renderToStaticMarkup(React.createElement(WorkspaceHarness));
    assert.ok(html.includes('data-testid="workspace-harness"'), 'Debe montar el harness del hook');
    assert.ok(capturedResult !== null, 'El hook useMusicalWorkspace debe ejecutarse y producir viewResult');
    assert.ok(capturedResult.isProjectionValid, 'La proyección inicial debe ser válida');
    assert.ok(capturedResult.activeRendererId !== null, 'Debe asignar un renderizador inicial');

    // Verificar contrato de callbacks públicos expuestos por el hook en runtime
    assert.equal(typeof capturedHook.selectSong, 'function', 'El hook debe exponer selectSong');
    assert.equal(typeof capturedHook.applyUserPreference, 'function', 'El hook debe exponer applyUserPreference');
    assert.equal(typeof capturedHook.setReadingFormat, 'function', 'El hook debe exponer setReadingFormat');
    assert.equal(typeof capturedHook.selectInstrument, 'function', 'El hook debe exponer selectInstrument');
    assert.equal(typeof capturedHook.selectPersistedSong, 'function', 'El hook debe exponer selectPersistedSong');
    assert.equal(typeof capturedHook.importSong, 'function', 'El hook debe exponer importSong');
    assert.equal(typeof capturedHook.applyPreset, 'function', 'El hook debe exponer applyPreset');

    // Invocación segura de callbacks sin excepciones
    assert.doesNotThrow(() => {
      capturedHook.selectSong(GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory());
      capturedHook.setReadingFormat('CHORDS', ['LYRICS']);
    }, 'La invocación de callbacks del hook no debe lanzar errores');
  });

  it('B.2 should execute complete navigation lifecycle via MusicalWorkspaceSession (shared transition seam)', () => {
    // Escenario de navegación multi-paso ejecutado a través de MusicalWorkspaceSession,
    // la cual comparte 1:1 las funciones puras de transición con useMusicalWorkspace:
    // 1. Aplicar preferencia con STANDARD_NOTATION en guitarra acústica.
    // 2. Cargar canción con notas: verificar que la notación en pentagrama es la vista efectiva.
    // 3. Navegar a canción Lead Sheet con 0 notas pero con acordes y letra: verificar fallback a CHORDS con LYRICS.
    // 4. Verificar que la preferencia almacenada/solicitada permanece STANDARD_NOTATION (cero mutación silenciosa).
    // 5. Navegar de vuelta a la canción con notas: verificar restauración automática de STANDARD_NOTATION.
    // 6. Verificar que ninguna proyección intermedia sea nula o inválida.
    // 7. Navegar a canción con acordes pero sin letra ni notas: verificar que cae a "Cifrado Solo" (CHORDS), no "Cifrado con Letra".

    const session = new MusicalWorkspaceSession('SCENARIO_A');

    // Paso 1: Establecer preferencia guardada del usuario: STANDARD_NOTATION en guitarra
    const userPref: UserViewPreferenceData = {
      userId: 'usr-musician-lead',
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: [],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 0,
      clefOverride: null,
      preferFlats: false,
    };

    session.applyUserPreference(userPref);

    // Paso 2: Canción inicial con notas (Escenario A)
    const songWithNotes = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    session.selectSong(songWithNotes);

    const step2View = session.viewResult;
    assert.equal(step2View.isProjectionValid, true, 'Paso 2: La proyección debe ser válida');
    assert.equal(step2View.state.primaryRepresentation, 'STANDARD_NOTATION', 'Paso 2: Vista efectiva debe ser STANDARD_NOTATION');
    assert.ok(step2View.derivedView !== null, 'Paso 2: derivedView no debe ser nulo');

    // Paso 3: Navegar a Lead Sheet puro (0 notas, tiene acordes y letra)
    const leadSheetSong = createPureLeadSheetSong();
    session.selectSong(leadSheetSong);

    const step3View = session.viewResult;
    assert.equal(step3View.isProjectionValid, true, 'Paso 3: La proyección debe ser válida tras fallback');
    assert.equal(step3View.state.primaryRepresentation, 'CHORDS', 'Paso 3: Debe caer a CHORDS');
    assert.deepEqual(step3View.state.secondaryRepresentations, ['LYRICS', 'SECTION_MARKERS'], 'Paso 3: Debe incluir LYRICS');
    assert.equal(step3View.activeRendererId, 'LEADSHEET_DOM', 'Paso 3: Renderizador debe ser LEADSHEET_DOM');
    assert.ok(
      step3View.diagnostics.some((d) => d.code === 'VIEW_FALLBACK_APPLIED'),
      'Paso 3: Debe emitir diagnóstico VIEW_FALLBACK_APPLIED'
    );
    assert.ok(step3View.derivedView !== null, 'Paso 3: derivedView no debe ser nulo');

    // Paso 4: Verificar invariante de preservación de preferencia (F-04)
    assert.equal(
      session.preferredFormat?.primary,
      'STANDARD_NOTATION',
      'Paso 4: La preferencia solicitada NO debe ser sobrescrita por el fallback'
    );

    // Paso 5: Navegar de vuelta a la canción con notas
    session.selectSong(songWithNotes);

    const step5View = session.viewResult;
    assert.equal(step5View.isProjectionValid, true, 'Paso 5: La proyección debe ser válida al restaurar');
    assert.equal(
      step5View.state.primaryRepresentation,
      'STANDARD_NOTATION',
      'Paso 5: STANDARD_NOTATION debe ser restaurado automáticamente'
    );
    assert.ok(
      !step5View.diagnostics.some((d) => d.code === 'VIEW_FALLBACK_APPLIED'),
      'Paso 5: No debe haber diagnóstico de fallback en canción compatible'
    );
    assert.ok(step5View.derivedView !== null, 'Paso 5: derivedView no debe ser nulo');

    // Paso 7: Navegar a canción con acordes pero sin letra ni notas (Cifrado puro)
    const chordsOnlySong = createChordsOnlySong();
    session.selectSong(chordsOnlySong);

    const step7View = session.viewResult;
    assert.equal(step7View.isProjectionValid, true, 'Paso 7: Proyección de cifrado solo debe ser válida');
    assert.equal(step7View.state.primaryRepresentation, 'CHORDS', 'Paso 7: Debe caer a CHORDS');
    assert.deepEqual(
      step7View.state.secondaryRepresentations,
      ['SECTION_MARKERS'],
      'Paso 7: Debe usar Cifrado Solo (sin capa LYRICS)'
    );
    assert.ok(
      !step7View.state.secondaryRepresentations.includes('LYRICS'),
      'Paso 7: NO debe incluir LYRICS si la canción no contiene texto lírico'
    );
    assert.ok(step7View.derivedView !== null, 'Paso 7: derivedView no debe ser nulo');
  });

  // -------------------------------------------------------------------------
  // SECTION 3: Code and Domain Invariants (F-02, F-03, F-04, Immutability)
  // -------------------------------------------------------------------------

  it('C.1 should enforce invariant: format compatibility for full score (Guitar)', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');

    const totalNotes = fullSong.measures.reduce((acc, m) => acc + m.getAllNotes().length, 0);
    const totalChords = fullSong.measures.reduce((acc, m) => acc + m.chords.length, 0);
    const totalLyrics = fullSong.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

    assert.ok(totalNotes > 0, 'La canción completa debe tener notas');
    assert.ok(totalChords > 0, 'La canción completa debe tener acordes');
    assert.ok(totalLyrics > 0, 'La canción completa debe tener letra');

    const defs = computeFormatDefinitions(fullSong, guitarProfile);
    assert.equal(defs.find((d) => d.id === 'STAFF_NOTATION')?.isAvailable, true);
    assert.equal(defs.find((d) => d.id === 'CHORD_CHART')?.isAvailable, true);
    assert.equal(defs.find((d) => d.id === 'LYRICS_ONLY')?.isAvailable, true);
    assert.equal(defs.find((d) => d.id === 'TABLATURE')?.isAvailable, true);
  });

  it('C.2 should enforce invariant: Tablatura is disabled for non-string instruments regardless of song notes', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const piano = instrumentRegistry.getOrThrow('acoustic_piano');
    const altoSax = instrumentRegistry.getOrThrow('alto_sax');
    const vocal = instrumentRegistry.getOrThrow('lead_vocal');

    assert.equal(piano.tuning, undefined);
    assert.equal(altoSax.tuning, undefined);
    assert.equal(vocal.tuning, undefined);

    const pianoDefs = computeFormatDefinitions(fullSong, piano);
    const saxDefs = computeFormatDefinitions(fullSong, altoSax);
    const vocalDefs = computeFormatDefinitions(fullSong, vocal);

    assert.equal(pianoDefs.find((d) => d.id === 'TABLATURE')?.isAvailable, false);
    assert.equal(saxDefs.find((d) => d.id === 'TABLATURE')?.isAvailable, false);
    assert.equal(vocalDefs.find((d) => d.id === 'TABLATURE')?.isAvailable, false);
  });

  it('C.3 should guarantee strict immutability of CanonicalMusicPayload when switching reading views', () => {
    const originalSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const songSnapshot = JSON.stringify(originalSong.toJSON());
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');

    let state = createInitialWorkspaceState('SCENARIO_A');

    // 1. Cambiar a Cifrado
    state = transitionSetPrimary(state, 'CHORDS', guitarProfile);
    state = transitionToggleSecondary(state, 'LYRICS', guitarProfile);
    let viewResult = orchestrateWorkspaceView(originalSong, state, instrumentRegistry);
    assert.ok(viewResult.isProjectionValid);
    assert.equal(JSON.stringify(originalSong.toJSON()), songSnapshot, 'La canción canónica NO debe mutar');

    // 2. Cambiar a Tablatura
    state = transitionSetPrimary(state, 'TABLATURE', guitarProfile);
    viewResult = orchestrateWorkspaceView(originalSong, state, instrumentRegistry);
    assert.ok(viewResult.isProjectionValid);
    assert.equal(JSON.stringify(originalSong.toJSON()), songSnapshot, 'La canción canónica NO debe mutar');

    // 3. Cambiar a Pentagrama Estándar
    state = transitionSetPrimary(state, 'STANDARD_NOTATION', guitarProfile);
    viewResult = orchestrateWorkspaceView(originalSong, state, instrumentRegistry);
    assert.ok(viewResult.isProjectionValid);
    assert.equal(JSON.stringify(originalSong.toJSON()), songSnapshot, 'La canción canónica NO debe mutar');
  });
});
