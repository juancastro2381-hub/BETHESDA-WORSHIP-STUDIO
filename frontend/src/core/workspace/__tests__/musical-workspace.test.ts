/**
 * @file musical-workspace.test.ts
 * @description Suite de pruebas automatizadas para Fase 1G — Production Musical Workspace & View Orchestration.
 *
 * Cobertura requerida (Sección 13):
 * 1. Workspace state initialization.
 * 2. Instrument selection.
 * 3. Capability-driven representation filtering.
 * 4. Unsupported representation rejection.
 * 5. Capo state isolation.
 * 6. Transposition state isolation.
 * 7. Chord notation switching.
 * 8. Renderer selection through RendererRegistry.
 * 9. Multi-view isolation.
 * 10. CanonicalMusicPayload immutability.
 * 11. Zero invented melody notes.
 * 12. Error-state propagation.
 * 13. Renderer lifecycle preservation.
 * 14. Golden Scenario regression coverage (Scenarios A through D).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  createCanonicalSongGMajorChordsAndLyricsOnly,
  createCanonicalSongGMajorWithNotes,
} from '../../projection/fixtures/golden-scenarios.ts';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { RendererRegistry } from '../../rendering/renderer-registry.ts';
import {
  GOLDEN_SCENARIO_PRESETS,
  WORKSPACE_SONG_CATALOG,
  createEmptyCanonicalSong,
} from '../presets.ts';
import {
  createInitialWorkspaceState,
  instrumentSupportsCapo,
  orchestrateWorkspaceView,
  transitionApplyPreset,
  transitionSelectInstrument,
  transitionSetCapo,
  transitionSetChordNotation,
  transitionSetPrimary,
  transitionSetTransposition,
  transitionToggleSecondary,
} from '../workspace-orchestrator.ts';

describe('Phase 1G — Production Musical Workspace & View Orchestration Tests', () => {
  const instruments = new InstrumentRegistry();
  const renderers = new RendererRegistry();

  // =========================================================================
  // 1. Workspace State Initialization
  // =========================================================================
  it('1. should initialize workspace state with valid defaults based on Golden Scenario A', () => {
    const state = createInitialWorkspaceState('SCENARIO_A');
    assert.strictEqual(state.selectedInstrumentId, 'acoustic_guitar');
    assert.strictEqual(state.primaryRepresentation, 'TABLATURE');
    assert.deepStrictEqual(state.secondaryRepresentations, ['CHORDS']);
    assert.strictEqual(state.capoFret, 2);
    assert.strictEqual(state.transpositionSemitones, 0);
    assert.strictEqual(state.chordNotationSystem, 'STANDARD');
    assert.strictEqual(state.forcedRendererId, 'ALPHATAB');
    assert.strictEqual(state.activePresetId, 'SCENARIO_A');
  });

  // =========================================================================
  // 2. Instrument Selection & Available Instruments
  // =========================================================================
  it('2. should query available instruments from InstrumentRegistry without hardcoding rules', () => {
    const allInstruments = instruments.getAll();
    assert.ok(allInstruments.length >= 10, 'Must have at least 10 instruments registered');
    const guitar = instruments.getOrThrow('acoustic_guitar');
    const piano = instruments.getOrThrow('acoustic_piano');
    const sax = instruments.getOrThrow('alto_sax');
    const vocal = instruments.getOrThrow('lead_vocal');

    assert.strictEqual(guitar.family, 'GUITAR');
    assert.strictEqual(piano.family, 'KEYS');
    assert.strictEqual(sax.transpositionOffsetSemitones, 9); // Eb alto sax (+9)
    assert.strictEqual(vocal.family, 'VOCALS');
  });

  // =========================================================================
  // 3. Capability-Driven Representation Filtering
  // =========================================================================
  it('3. should automatically adapt representation when switching from Guitar to Piano', () => {
    // Current state: Guitar with TABLATURE
    const guitarState = createInitialWorkspaceState('SCENARIO_A');
    assert.strictEqual(guitarState.primaryRepresentation, 'TABLATURE');

    // Switch to Piano (Piano does NOT support TABLATURE)
    const pianoProfile = instruments.getOrThrow('acoustic_piano');
    assert.strictEqual(pianoProfile.isRepresentationSupported('TABLATURE'), false);

    const newState = transitionSelectInstrument(guitarState, pianoProfile);
    assert.strictEqual(newState.selectedInstrumentId, 'acoustic_piano');
    // Primary must be reassigned to a supported representation
    assert.ok(pianoProfile.isRepresentationSupported(newState.primaryRepresentation));
    assert.notStrictEqual(newState.primaryRepresentation, 'TABLATURE');
    // Secondary must not contain unsupported representations
    for (const sec of newState.secondaryRepresentations) {
      assert.ok(pianoProfile.isRepresentationSupported(sec));
    }
  });

  // =========================================================================
  // 4. Unsupported Representation Rejection
  // =========================================================================
  it('4. should reject setting an unsupported primary representation', () => {
    const pianoProfile = instruments.getOrThrow('acoustic_piano');
    const pianoState = createInitialWorkspaceState('SCENARIO_B');

    // Attempting to set TABLATURE on Piano
    const rejectedState = transitionSetPrimary(pianoState, 'TABLATURE', pianoProfile);
    assert.strictEqual(rejectedState.primaryRepresentation, pianoState.primaryRepresentation);
    assert.notStrictEqual(rejectedState.primaryRepresentation, 'TABLATURE');

    // Attempting to toggle PERCUSSION_NOTATION as secondary on Piano
    const toggledState = transitionToggleSecondary(pianoState, 'PERCUSSION_NOTATION', pianoProfile);
    assert.strictEqual(toggledState.secondaryRepresentations.includes('PERCUSSION_NOTATION'), false);
  });

  // =========================================================================
  // 5. Capo State Isolation
  // =========================================================================
  it('5. should maintain Capo isolation: Capo does not mutate concert key and resets on non-capo instruments', () => {
    const song = createCanonicalSongGMajorWithNotes();
    const guitarProfile = instruments.getOrThrow('acoustic_guitar');
    const pianoProfile = instruments.getOrThrow('acoustic_piano');

    // Verify instrument capo support helper
    assert.strictEqual(instrumentSupportsCapo(guitarProfile), true);
    assert.strictEqual(instrumentSupportsCapo(pianoProfile), false);

    // Initial guitar state with capo 2
    let state = createInitialWorkspaceState('SCENARIO_A');
    state = transitionSetCapo(state, 4, guitarProfile);
    assert.strictEqual(state.capoFret, 4);

    const resultWithCapo4 = orchestrateWorkspaceView(song, state, instruments, renderers);
    assert.strictEqual(resultWithCapo4.derivedView?.capoFret, 4);
    // Sounding concert key must remain G Major!
    assert.strictEqual(resultWithCapo4.derivedView?.concertKey.tonic.toString(), 'G');

    // Switching to piano must reset Capo to 0
    const statePiano = transitionSelectInstrument(state, pianoProfile);
    assert.strictEqual(statePiano.capoFret, 0);

    const resultPiano = orchestrateWorkspaceView(song, statePiano, instruments, renderers);
    assert.strictEqual(resultPiano.derivedView?.capoFret, 0);
  });

  // =========================================================================
  // 6. Transposition State Isolation
  // =========================================================================
  it('6. should maintain Transposition isolation: Semitone shifts update view without mutating CanonicalMusicPayload', () => {
    const song = createCanonicalSongGMajorWithNotes();
    const initialSongJson = JSON.stringify(song);

    let state = createInitialWorkspaceState('SCENARIO_A');
    // Transpose +2 semitones (G -> A)
    state = transitionSetTransposition(state, 2);
    assert.strictEqual(state.transpositionSemitones, 2);

    const result = orchestrateWorkspaceView(song, state, instruments, renderers);
    assert.ok(result.derivedView);
    // Sounding key shifted to A Major
    assert.strictEqual(result.derivedView.concertKey.tonic.toString(), 'A');
    // Canonical concert key in payload remains immutable
    assert.strictEqual(song.measures[0]?.keySignature.toMusicalKey().tonic.toString(), 'G');
    assert.strictEqual(JSON.stringify(song), initialSongJson);
  });

  // =========================================================================
  // 7. Chord Notation Switching
  // =========================================================================
  it('7. should switch chord notation system between STANDARD and LATIN correctly', () => {
    let state = createInitialWorkspaceState('SCENARIO_A');
    assert.strictEqual(state.chordNotationSystem, 'STANDARD');

    state = transitionSetChordNotation(state, 'LATIN');
    assert.strictEqual(state.chordNotationSystem, 'LATIN');

    const song = createCanonicalSongGMajorWithNotes();
    const result = orchestrateWorkspaceView(song, state, instruments, renderers);
    assert.strictEqual(result.viewPreference.chordNotationSystem, 'LATIN');
  });

  // =========================================================================
  // 8. Renderer Selection through RendererRegistry
  // =========================================================================
  it('8. should resolve correct renderer capability-driven and handle incompatible forced renderer gracefully', () => {
    const song = createCanonicalSongGMajorWithNotes();

    // Guitar with Tablature -> alphaTab
    const guitarState = createInitialWorkspaceState('SCENARIO_A');
    const resultGuitar = orchestrateWorkspaceView(song, guitarState, instruments, renderers);
    assert.strictEqual(resultGuitar.activeRendererId, 'ALPHATAB');

    // Piano with Grand Staff -> OSMD
    const pianoState = createInitialWorkspaceState('SCENARIO_B');
    const resultPiano = orchestrateWorkspaceView(song, pianoState, instruments, renderers);
    assert.strictEqual(resultPiano.activeRendererId, 'OSMD');

    // Vocal with Lyrics + Chords -> LeadSheetDOM
    const vocalState = createInitialWorkspaceState('SCENARIO_D');
    const resultVocal = orchestrateWorkspaceView(song, vocalState, instruments, renderers);
    assert.strictEqual(resultVocal.activeRendererId, 'LEADSHEET_DOM');

    // Incompatible forced renderer scenario:
    // Piano with Grand Staff forces 'ALPHATAB' (which cannot render GRAND_STAFF)
    const forcedIncompatibleState = {
      ...pianoState,
      forcedRendererId: 'ALPHATAB' as const,
    };
    const resultFallback = orchestrateWorkspaceView(song, forcedIncompatibleState, instruments, renderers);
    // Should warn and fallback safely to OSMD
    const forcedWarn = resultFallback.diagnostics.find((d) => d.code === 'FORCED_RENDERER_INCOMPATIBLE');
    assert.ok(forcedWarn, 'Should emit FORCED_RENDERER_INCOMPATIBLE diagnostic');
    assert.strictEqual(resultFallback.activeRendererId, 'OSMD');
  });


  // =========================================================================
  // 9. Multi-View Isolation
  // =========================================================================
  it('9. should preserve absolute isolation across multiple concurrent views of the exact same canonical song', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();

    const stateGuitar = createInitialWorkspaceState('SCENARIO_A');
    const statePiano = createInitialWorkspaceState('SCENARIO_B');
    const stateSax = createInitialWorkspaceState('SCENARIO_C');
    const stateVocal = createInitialWorkspaceState('SCENARIO_D');

    const resultGuitar = orchestrateWorkspaceView(canonicalSong, stateGuitar, instruments, renderers);
    const resultPiano = orchestrateWorkspaceView(canonicalSong, statePiano, instruments, renderers);
    const resultSax = orchestrateWorkspaceView(canonicalSong, stateSax, instruments, renderers);
    const resultVocal = orchestrateWorkspaceView(canonicalSong, stateVocal, instruments, renderers);

    // Verifying independent properties
    assert.strictEqual(resultGuitar.derivedView?.capoFret, 2);
    assert.strictEqual(resultPiano.derivedView?.capoFret, 0);
    assert.strictEqual(resultSax.derivedView?.capoFret, 0);
    assert.strictEqual(resultVocal.derivedView?.capoFret, 0);

    // Sax written pitch (+9 semitones -> E written key) vs Guitar (G key)
    assert.strictEqual(resultSax.derivedView?.writtenKey.tonic.toString(), 'E');
    assert.strictEqual(resultGuitar.derivedView?.writtenKey.tonic.toString(), 'G');

    // Piano grand staff (2 staves) vs Sax (1 staff)
    assert.strictEqual(resultPiano.instrumentProfile.staffCount, 2);
    assert.strictEqual(resultSax.instrumentProfile.staffCount, 1);
  });

  // =========================================================================
  // 10. CanonicalMusicPayload Immutability
  // =========================================================================
  it('10. should guarantee strict immutability of CanonicalMusicPayload through repeated workspace transitions', () => {
    const song = createCanonicalSongGMajorWithNotes();
    const deepCloneBefore = JSON.stringify(song);

    let state = createInitialWorkspaceState('SCENARIO_A');
    orchestrateWorkspaceView(song, state, instruments, renderers);

    // Apply diverse transformations
    state = transitionSetTransposition(state, 5);
    state = transitionSetCapo(state, 3, instruments.getOrThrow('acoustic_guitar'));
    state = transitionSetChordNotation(state, 'LATIN');
    orchestrateWorkspaceView(song, state, instruments, renderers);

    state = transitionSelectInstrument(state, instruments.getOrThrow('alto_sax'));
    orchestrateWorkspaceView(song, state, instruments, renderers);

    // After all transformations, canonical song must be strictly identical
    const deepCloneAfter = JSON.stringify(song);
    assert.strictEqual(deepCloneAfter, deepCloneBefore);
  });

  // =========================================================================
  // 11. Zero Invented Melody Notes Invariant
  // =========================================================================
  it('11. should preserve zero melody notes invariant (totalMelodyNotes === 0) for ChordPro songs without melody', () => {
    const chordProSong = createCanonicalSongGMajorChordsAndLyricsOnly();
    const stateVocal = createInitialWorkspaceState('SCENARIO_D');

    const result = orchestrateWorkspaceView(chordProSong, stateVocal, instruments, renderers);
    assert.ok(result.derivedView);

    // Count notes in derived view
    const allNotes = result.derivedView.getAllNotes();
    assert.strictEqual(allNotes.length, 0, 'Derived view must have strictly 0 notes');

    // Verify chords and lyrics exist
    const allChords = result.derivedView.getAllChords();
    const allLyrics = result.derivedView.getAllLyrics();
    assert.ok(allChords.length > 0, 'Chords must be present');
    assert.ok(allLyrics.length > 0, 'Lyrics must be present');
  });

  // =========================================================================
  // 12. Error and Empty State Propagation
  // =========================================================================
  it('12. should propagate structured warnings and handle empty songs gracefully', () => {
    const emptySong = createEmptyCanonicalSong();
    const state = createInitialWorkspaceState('SCENARIO_A');

    const result = orchestrateWorkspaceView(emptySong, state, instruments, renderers);
    assert.ok(result.diagnostics.length > 0);

    const emptyWarning = result.diagnostics.find((d) => d.code === 'EMPTY_SONG_NO_MEASURES');
    assert.ok(emptyWarning, 'Must surface EMPTY_SONG_NO_MEASURES diagnostic');
    assert.strictEqual(emptyWarning.severity, 'WARNING');
  });

  // =========================================================================
  // 13. Renderer Lifecycle Preservation
  // =========================================================================
  it('13. should verify renderer adapter lifecycle compatibility and status reporting', () => {
    for (const renderer of renderers.getAll()) {
      assert.strictEqual(renderer.status, 'UNINITIALIZED');
      assert.ok(renderer.capabilities.supportedRepresentations.length > 0);
    }
  });

  // =========================================================================
  // 14. Golden Scenarios Regression Coverage (Scenarios A through D)
  // =========================================================================
  describe('Golden Scenarios Regression Verification', () => {
    it('Scenario A: Guitar + Capo 2 + Chords + Tablature -> alphaTab', () => {
      const preset = GOLDEN_SCENARIO_PRESETS.SCENARIO_A;
      const song = preset.canonicalSongFactory();
      const state = transitionApplyPreset(preset);

      const result = orchestrateWorkspaceView(song, state, instruments, renderers);
      assert.strictEqual(result.instrumentProfile.id, 'acoustic_guitar');
      assert.strictEqual(result.state.capoFret, 2);
      assert.strictEqual(result.activeRendererId, 'ALPHATAB');
      assert.strictEqual(result.isProjectionValid, true);
      assert.strictEqual(result.derivedView?.capoFret, 2);
    });

    it('Scenario B: Piano + Grand Staff + Chords -> OSMD', () => {
      const preset = GOLDEN_SCENARIO_PRESETS.SCENARIO_B;
      const song = preset.canonicalSongFactory();
      const state = transitionApplyPreset(preset);

      const result = orchestrateWorkspaceView(song, state, instruments, renderers);
      assert.strictEqual(result.instrumentProfile.id, 'acoustic_piano');
      assert.strictEqual(result.instrumentProfile.staffCount, 2);
      assert.strictEqual(result.state.primaryRepresentation, 'GRAND_STAFF');
      assert.strictEqual(result.activeRendererId, 'OSMD');
      assert.strictEqual(result.isProjectionValid, true);
    });

    it('Scenario C: Alto Saxophone in Eb + Standard Notation -> OSMD', () => {
      const preset = GOLDEN_SCENARIO_PRESETS.SCENARIO_C;
      const song = preset.canonicalSongFactory();
      const state = transitionApplyPreset(preset);

      const result = orchestrateWorkspaceView(song, state, instruments, renderers);
      assert.strictEqual(result.instrumentProfile.id, 'alto_sax');
      assert.strictEqual(result.instrumentProfile.transpositionOffsetSemitones, 9);
      assert.strictEqual(result.activeRendererId, 'OSMD');
      assert.strictEqual(result.isProjectionValid, true);
      // Tono escrito: E Mayor (+9 semitonos sobre G Mayor)
      assert.strictEqual(result.derivedView?.writtenKey.tonic.toString(), 'E');
      assert.strictEqual(result.derivedView?.concertKey.tonic.toString(), 'G');
    });

    it('Scenario D: Lead Vocal + Lyrics + Chords from ChordPro -> LeadSheetDOM', () => {
      const preset = GOLDEN_SCENARIO_PRESETS.SCENARIO_D;
      const song = preset.canonicalSongFactory();
      const state = transitionApplyPreset(preset);

      const result = orchestrateWorkspaceView(song, state, instruments, renderers);
      assert.strictEqual(result.instrumentProfile.id, 'lead_vocal');
      assert.strictEqual(result.state.primaryRepresentation, 'LYRICS');
      assert.strictEqual(result.activeRendererId, 'LEADSHEET_DOM');
      assert.strictEqual(result.isProjectionValid, true);
      assert.strictEqual(result.derivedView?.getAllNotes().length, 0);
    });
  });
});
