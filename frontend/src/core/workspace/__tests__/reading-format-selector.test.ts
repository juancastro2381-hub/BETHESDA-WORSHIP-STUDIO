/**
 * @file reading-format-selector.test.ts
 * @description Suite de pruebas para los formatos de lectura del músico y persistencia de vista (Fase 3A — WP-03 / Priority 1).
 *
 * Verifica:
 * 1. Detección precisa de formatos disponibles vs. no soportados según datos reales de la canción (CERO invención).
 * 2. Deshabilitación de Partitura y Tablatura cuando la canción es Lead Sheet Puro (0 notas).
 * 3. Deshabilitación de Tablatura para instrumentos que no son de cuerda afinada (Piano, Saxofón, Voz).
 * 4. Deshabilitación de Letra Sola cuando la canción no contiene texto lírico.
 * 5. Invariante no negociable: Inmutabilidad estricta del modelo canónico al alternar formatos.
 * 6. Orquestación y aplicación de preferencias persistidas en el workspace.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { GOLDEN_SCENARIO_PRESETS } from '../presets.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Rest, Voice } from '../../canonical-model/musical-event.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import { KeySignatureReference } from '../../canonical-model/key-signature-reference.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { Chord } from '../../music-theory/chord.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TempoMap, TempoEvent } from '../../canonical-model/tempo-map.ts';
import {
  transitionSetPrimary,
  transitionToggleSecondary,
  orchestrateWorkspaceView,
  createInitialWorkspaceState,
  resolveEffectiveViewRepresentation,
} from '../workspace-orchestrator.ts';
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

  it('1. should verify format compatibility for full score (Guitar): all 4 formats available', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');

    const totalNotes = fullSong.measures.reduce((acc, m) => acc + m.getAllNotes().length, 0);
    const totalChords = fullSong.measures.reduce((acc, m) => acc + m.chords.length, 0);
    const totalLyrics = fullSong.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

    assert.ok(totalNotes > 0, 'La canción completa debe tener notas');
    assert.ok(totalChords > 0, 'La canción completa debe tener acordes');
    assert.ok(totalLyrics > 0, 'La canción completa debe tener letra');

    // Partitura disponible
    assert.ok(guitarProfile.isRepresentationSupported('STANDARD_NOTATION'));
    // Cifrado con letra disponible (requiere acordes y letra, F-02)
    assert.ok(
      guitarProfile.isRepresentationSupported('CHORDS') &&
        guitarProfile.isRepresentationSupported('LYRICS') &&
        totalChords > 0 &&
        totalLyrics > 0
    );
    // Tablatura disponible (guitarra tiene afinación)
    assert.ok(guitarProfile.tuning !== undefined && guitarProfile.isRepresentationSupported('TABLATURE'));
  });

  it('2. should enforce invariant: Lead Sheet Puro disables Partitura and Tablatura with clear reasons', () => {
    const leadSheet = createPureLeadSheetSong();
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');

    const totalNotes = leadSheet.measures.reduce((acc, m) => acc + m.getAllNotes().length, 0);
    const totalChords = leadSheet.measures.reduce((acc, m) => acc + m.chords.length, 0);
    const totalLyrics = leadSheet.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

    assert.equal(totalNotes, 0, 'Lead Sheet Puro tiene exactamente 0 notas');
    assert.ok(totalChords > 0, 'Tiene acordes');
    assert.ok(totalLyrics > 0, 'Tiene letra');

    // Partitura debe estar no disponible por falta de notas en la fuente
    const staffAvailable = guitarProfile.isRepresentationSupported('STANDARD_NOTATION') && totalNotes > 0;
    assert.equal(staffAvailable, false);

    // Tablatura debe estar no disponible por falta de notas en la fuente
    const tabAvailable = guitarProfile.tuning !== undefined && totalNotes > 0;
    assert.equal(tabAvailable, false);

    // Cifrado con letra debe estar disponible (tiene tanto acordes como letra)
    const chordChartAvailable =
      guitarProfile.isRepresentationSupported('CHORDS') &&
      guitarProfile.isRepresentationSupported('LYRICS') &&
      totalChords > 0 &&
      totalLyrics > 0;
    assert.equal(chordChartAvailable, true);

    // Letra sola debe estar disponible
    const lyricsAvailable = guitarProfile.isRepresentationSupported('LYRICS') && totalLyrics > 0;
    assert.equal(lyricsAvailable, true);
  });

  it('3. should enforce invariant (F-02): chords without lyrics cannot select "Cifrado con Letra", chords with lyrics can', () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');

    // Canción instrumental: tiene acordes pero CERO letra
    const instrumentalSong = createInstrumentalSong();
    const instrumentalChords = instrumentalSong.measures.reduce((acc, m) => acc + m.chords.length, 0);
    const instrumentalLyrics = instrumentalSong.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

    assert.ok(instrumentalChords > 0, 'Canción instrumental tiene acordes');
    assert.equal(instrumentalLyrics, 0, 'Canción instrumental tiene 0 letra');

    // Contrato estricto F-02: "Cifrado con Letra" NO puede estar disponible si faltan letras
    const chordChartAvailableWithoutLyrics =
      guitarProfile.isRepresentationSupported('CHORDS') &&
      guitarProfile.isRepresentationSupported('LYRICS') &&
      instrumentalChords > 0 &&
      instrumentalLyrics > 0;
    assert.equal(chordChartAvailableWithoutLyrics, false, 'Cifrado con Letra debe estar deshabilitado sin letra');

    // Canción con letra y acordes: "Cifrado con Letra" DEBE estar disponible
    const songWithLyricsAndChords = createPureLeadSheetSong();
    const fullChords = songWithLyricsAndChords.measures.reduce((acc, m) => acc + m.chords.length, 0);
    const fullLyrics = songWithLyricsAndChords.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

    const chordChartAvailableWithLyrics =
      guitarProfile.isRepresentationSupported('CHORDS') &&
      guitarProfile.isRepresentationSupported('LYRICS') &&
      fullChords > 0 &&
      fullLyrics > 0;
    assert.equal(chordChartAvailableWithLyrics, true, 'Cifrado con Letra debe estar habilitado con acordes y letra');
  });

  it('4. should enforce invariant (F-03): rests must not count as notes, disabling note-dependent views', () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');
    const restsOnlySong = createRestsOnlySong();

    // Comprobar que existen eventos en las voces pero TODOS son silencios (Rest), 0 notas
    const totalEvents = restsOnlySong.measures.reduce(
      (acc, m) => acc + m.voices.reduce((vAcc, v) => vAcc + v.events.length, 0),
      0
    );
    const totalNotes = restsOnlySong.measures.reduce((acc, m) => acc + m.getAllNotes().length, 0);
    const totalRests = restsOnlySong.measures.reduce((acc, m) => acc + m.getAllRests().length, 0);

    assert.ok(totalEvents > 0, 'Existen eventos de silencio en la voz');
    assert.ok(totalRests > 0, 'Existen silencios reales en los compases');
    assert.equal(totalNotes, 0, 'Debe haber exactamente 0 notas melódicas (F-03)');

    // Partitura y Tablatura DEBEN estar deshabilitadas porque totalNotes === 0
    const staffAvailable = guitarProfile.isRepresentationSupported('STANDARD_NOTATION') && totalNotes > 0;
    const tabAvailable = guitarProfile.tuning !== undefined && totalNotes > 0;

    assert.equal(staffAvailable, false, 'Partitura no debe habilitarse con solo silencios');
    assert.equal(tabAvailable, false, 'Tablatura no debe habilitarse con solo silencios');
  });

  it('5. should enforce invariant: Tablatura is disabled for non-string instruments regardless of song notes', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const piano = instrumentRegistry.getOrThrow('acoustic_piano');
    const altoSax = instrumentRegistry.getOrThrow('alto_sax');
    const vocal = instrumentRegistry.getOrThrow('lead_vocal');

    // Ninguno de estos tiene afinación para tablatura
    assert.equal(piano.tuning, undefined);
    assert.equal(altoSax.tuning, undefined);
    assert.equal(vocal.tuning, undefined);

    assert.equal(piano.isRepresentationSupported('TABLATURE'), false);
    assert.equal(altoSax.isRepresentationSupported('TABLATURE'), false);
    assert.equal(vocal.isRepresentationSupported('TABLATURE'), false);
  });

  it('6. should enforce invariant: Instrumental song disables Lyrics-only format', () => {
    const instrumental = createInstrumentalSong();
    const vocal = instrumentRegistry.getOrThrow('lead_vocal');

    const totalLyrics = instrumental.measures.reduce((acc, m) => acc + m.lyrics.length, 0);
    assert.equal(totalLyrics, 0);

    const lyricsAvailable = vocal.isRepresentationSupported('LYRICS') && totalLyrics > 0;
    assert.equal(lyricsAvailable, false);
  });

  it('7. should safely fall back when saved reading view is unsupported by active song without mutating preference (F-04)', () => {
    const guitarProfile = instrumentRegistry.getOrThrow('acoustic_guitar');
    const leadSheetSong = createPureLeadSheetSong(); // 0 notas, tiene acordes y letra
    const fullScoreSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory(); // Tiene notas, acordes y letra

    // Simular que el usuario tiene guardada la preferencia de Partitura (STANDARD_NOTATION)
    const storedPref: UserViewPreferenceData = {
      userId: 'usr-musician-1',
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: [],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 0,
      clefOverride: null,
      preferFlats: false,
    };

    // A. Resolver vista efectiva para el Lead Sheet puro (0 notas)
    const effectiveLeadSheet = resolveEffectiveViewRepresentation(
      leadSheetSong,
      guitarProfile,
      storedPref.primaryRepresentation,
      storedPref.secondaryRepresentations
    );

    // Debe aplicar fallback seguro a CHORDS con LYRICS sin corromper la preferencia guardada
    assert.equal(effectiveLeadSheet.isFallbackApplied, true, 'Debe activar fallback seguro');
    assert.equal(effectiveLeadSheet.primaryRepresentation, 'CHORDS', 'Debe caer a Cifrado');
    assert.deepEqual(
      effectiveLeadSheet.secondaryRepresentations,
      ['LYRICS', 'SECTION_MARKERS'],
      'Debe incluir lírica como capa secundaria'
    );
    // Verificar que el objeto de preferencia original no fue mutado
    assert.equal(storedPref.primaryRepresentation, 'STANDARD_NOTATION');

    // B. Orquestar workspace con el Lead Sheet puro bajo la preferencia guardada
    let state = createInitialWorkspaceState('SCENARIO_A');
    state = {
      ...state,
      forcedRendererId: undefined,
      primaryRepresentation: storedPref.primaryRepresentation,
      secondaryRepresentations: [...storedPref.secondaryRepresentations],
    };

    const viewResultLeadSheet = orchestrateWorkspaceView(leadSheetSong, state, instrumentRegistry);
    assert.ok(viewResultLeadSheet.isProjectionValid, 'La proyección debe ser válida con fallback');
    assert.equal(viewResultLeadSheet.state.primaryRepresentation, 'CHORDS');
    assert.equal(viewResultLeadSheet.activeRendererId, 'LEADSHEET_DOM');
    assert.ok(viewResultLeadSheet.diagnostics.some((d) => d.code === 'VIEW_FALLBACK_APPLIED'));

    // C. Transición en repertorio: Volver a una canción compatible (con notas)
    // Debe restaurar la vista deseada (STANDARD_NOTATION) sin que la preferencia haya sido alterada
    const effectiveFullScore = resolveEffectiveViewRepresentation(
      fullScoreSong,
      guitarProfile,
      storedPref.primaryRepresentation,
      storedPref.secondaryRepresentations
    );

    assert.equal(effectiveFullScore.isFallbackApplied, false, 'No debe aplicar fallback en canción compatible');
    assert.equal(effectiveFullScore.primaryRepresentation, 'STANDARD_NOTATION', 'Restaura vista solicitada');

    const viewResultFullScore = orchestrateWorkspaceView(fullScoreSong, state, instrumentRegistry);
    assert.ok(viewResultFullScore.isProjectionValid);
    assert.equal(viewResultFullScore.state.primaryRepresentation, 'STANDARD_NOTATION');
  });

  it('8. should guarantee strict immutability of CanonicalMusicPayload when switching reading views', () => {
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

  it('9. should apply persisted user preference correctly and project with high fidelity', () => {
    const song = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const storedPref: UserViewPreferenceData = {
      userId: 'usr-musician-1',
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'LATIN',
      transpositionSemitones: 2,
      capoFret: 0,
      clefOverride: null,
      preferFlats: false,
    };

    const saxProfile = instrumentRegistry.getOrThrow(storedPref.instrumentId);
    let state = createInitialWorkspaceState('SCENARIO_A');

    // Simular aplicación de preferencias de usuario
    state = {
      ...state,
      selectedInstrumentId: saxProfile.id,
      primaryRepresentation: storedPref.primaryRepresentation,
      secondaryRepresentations: [...storedPref.secondaryRepresentations],
      chordNotationSystem: storedPref.chordNotationSystem,
      transpositionSemitones: storedPref.transpositionSemitones,
      capoFret: 0, // Saxofón no soporta capo
      activePresetId: 'CUSTOM',
    };

    const viewResult = orchestrateWorkspaceView(song, state, instrumentRegistry);
    assert.ok(viewResult.isProjectionValid);
    assert.equal(viewResult.instrumentProfile.id, 'alto_sax');
    assert.equal(viewResult.state.primaryRepresentation, 'STANDARD_NOTATION');
    assert.deepEqual(viewResult.state.secondaryRepresentations, ['CHORDS']);
    assert.equal(viewResult.state.chordNotationSystem, 'LATIN');
    assert.equal(viewResult.state.transpositionSemitones, 2);
  });
});
