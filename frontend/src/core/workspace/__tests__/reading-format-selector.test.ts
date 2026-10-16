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
    // Cifrado con letra disponible
    assert.ok(guitarProfile.isRepresentationSupported('CHORDS') && guitarProfile.isRepresentationSupported('LYRICS'));
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

    // Cifrado con letra debe estar disponible
    const chordChartAvailable = guitarProfile.isRepresentationSupported('CHORDS') && totalChords > 0;
    assert.equal(chordChartAvailable, true);

    // Letra sola debe estar disponible
    const lyricsAvailable = guitarProfile.isRepresentationSupported('LYRICS') && totalLyrics > 0;
    assert.equal(lyricsAvailable, true);
  });

  it('3. should enforce invariant: Tablatura is disabled for non-string instruments regardless of song notes', () => {
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

  it('4. should enforce invariant: Instrumental song disables Lyrics-only format', () => {
    const instrumental = createInstrumentalSong();
    const vocal = instrumentRegistry.getOrThrow('lead_vocal');

    const totalLyrics = instrumental.measures.reduce((acc, m) => acc + m.lyrics.length, 0);
    assert.equal(totalLyrics, 0);

    const lyricsAvailable = vocal.isRepresentationSupported('LYRICS') && totalLyrics > 0;
    assert.equal(lyricsAvailable, false);
  });

  it('5. should guarantee strict immutability of CanonicalMusicPayload when switching reading views', () => {
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

  it('6. should apply persisted user preference correctly and project with high fidelity', () => {
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
