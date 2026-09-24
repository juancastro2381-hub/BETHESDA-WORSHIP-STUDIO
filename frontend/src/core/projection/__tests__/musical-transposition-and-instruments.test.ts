/**
 * @file musical-transposition-and-instruments.test.ts
 * @description Pruebas unitarias de transposición musical analítica, preservación
 * de tono de concierto, enarmonía y proyección para instrumentos transpositores (Bb, Eb, F).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentProfile, InstrumentRegistry } from '../instrument-profile.ts';
import { ProjectionService } from '../projection-service.ts';
import { ViewPreference } from '../view-preference.ts';
import { createCanonicalSongGMajorWithNotes } from '../fixtures/golden-scenarios.ts';
import { Chord } from '../../music-theory/chord.ts';
import { TranspositionEngine, TransposingInstrumentEngine } from '../../music-theory/transposition.ts';
import { MusicalKey } from '../../music-theory/musical-key.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';

describe('Musical Transposition and Transposing Instruments Tests', () => {
  const registry = new InstrumentRegistry();

  it('1. should preserve concert pitch in canonical source while calculating written pitch', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const altoSax = registry.getOrThrow('alto_sax'); // Eb (+9 semitones)

    const pref = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const result = ProjectionService.project(canonicalSong, altoSax, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // La tonalidad de concierto de la vista debe ser G Mayor
    assert.strictEqual(result.view.concertKey.tonic.toString(), 'G');
    assert.strictEqual(result.view.concertKey.mode, 'MAJOR');

    // La tonalidad escrita del saxofón alto debe ser E Mayor (+9 semitones)
    assert.strictEqual(result.view.writtenKey.tonic.toString(), 'E');
    assert.strictEqual(result.view.writtenKey.mode, 'MAJOR');

    // La primera nota canónica es G4; la nota escrita proyectada debe ser E5
    const firstNote = result.view.getAllNotes()[0]!;
    assert.strictEqual(firstNote.canonicalPitch.toString(), 'G4');
    assert.strictEqual(firstNote.writtenPitch.toString(), 'E5');

    // El objeto canónico no debe haber mutado
    const originalMeasure1Notes = canonicalSong.measures[0]!.getAllNotes();
    assert.strictEqual(originalMeasure1Notes[0]!.pitch.toString(), 'G4');
  });

  it('2. should transpose C Major -> D Major correctly (all diatonic chords and notes)', () => {
    const chordC = Chord.parse('C');
    const chordAm = Chord.parse('Am');
    const chordF = Chord.parse('F');
    const chordG = Chord.parse('G');

    const targetKeyD = MusicalKey.D_MAJOR;

    const transposedC = TranspositionEngine.transposeChord(chordC, 2, targetKeyD);
    const transposedAm = TranspositionEngine.transposeChord(chordAm, 2, targetKeyD);
    const transposedF = TranspositionEngine.transposeChord(chordF, 2, targetKeyD);
    const transposedG = TranspositionEngine.transposeChord(chordG, 2, targetKeyD);

    assert.strictEqual(transposedC.toString('STANDARD'), 'D');
    assert.strictEqual(transposedAm.toString('STANDARD'), 'Bm');
    assert.strictEqual(transposedF.toString('STANDARD'), 'G');
    assert.strictEqual(transposedG.toString('STANDARD'), 'A');

    // Comprobación de que no se hace por reemplazo de texto primitivo
    assert.strictEqual(transposedC.root.toString(), 'D');
    assert.strictEqual(transposedAm.root.toString(), 'B');
    assert.strictEqual(transposedF.root.toString(), 'G');
    assert.strictEqual(transposedG.root.toString(), 'A');
  });

  it('3. should transpose chords preserving quality, extensions and alterations', () => {
    const chordCmaj7 = Chord.parse('Cmaj7');
    const chordC7b9 = Chord.parse('C7(b9)');
    const chordCm7 = Chord.parse('Cm7');

    const keyD = MusicalKey.D_MAJOR;

    const transposedMaj7 = TranspositionEngine.transposeChord(chordCmaj7, 2, keyD);
    const transposed7b9 = TranspositionEngine.transposeChord(chordC7b9, 2, keyD);
    const transposedM7 = TranspositionEngine.transposeChord(chordCm7, 2, keyD);

    assert.strictEqual(transposedMaj7.toString('STANDARD'), 'Dmaj7');
    assert.strictEqual(transposed7b9.toString('STANDARD'), 'D7(b9)');
    assert.strictEqual(transposedM7.toString('STANDARD'), 'Dm7');
  });

  it('4. should transpose slash chords preserving bass note and inversion', () => {
    const chordDFsharp = Chord.parse('D/F#');
    const chordHalfDim = Chord.parse('C#m7(b5)/G');

    // Transponer D/F# por +2 semitones -> E/G#
    const transposed1 = TranspositionEngine.transposeChord(chordDFsharp, 2);
    assert.strictEqual(transposed1.root.toString(), 'E');
    assert.strictEqual(transposed1.bass?.toString(), 'G#');
    assert.strictEqual(transposed1.toString('STANDARD'), 'E/G#');

    // Transponer C#m7(b5)/G por +2 semitones -> D#m7(b5)/A
    const transposed2 = TranspositionEngine.transposeChord(chordHalfDim, 2);
    assert.strictEqual(transposed2.root.toString(), 'D#');
    assert.strictEqual(transposed2.bass?.toString(), 'A');
    assert.strictEqual(transposed2.toString('STANDARD'), 'D#m7(b5)/A');
  });

  it('5. should enforce correct enharmonic spelling according to target key', () => {
    // En F Mayor, la 4ª de C es F, pero la nota enarmónica 10 debe ser Bb, no A#
    const noteBb = TranspositionEngine.transposeNote(NoteName.parse('C'), 10, MusicalKey.F_MAJOR);
    assert.strictEqual(noteBb.toString(), 'Bb');
    assert.notStrictEqual(noteBb.toString(), 'A#');

    // En G Mayor, la 7ª mayor es F#, nunca Gb
    const noteFsharp = TranspositionEngine.transposeNote(NoteName.parse('G'), 11, MusicalKey.G_MAJOR);
    assert.strictEqual(noteFsharp.toString(), 'F#');
    assert.notStrictEqual(noteFsharp.toString(), 'Gb');
  });

  it('6. should project Bb instruments accurately (+2 semitones written pitch)', () => {
    const trumpet = registry.getOrThrow('trumpet');
    assert.strictEqual(trumpet.transpositionOffsetSemitones, TransposingInstrumentEngine.BB_OFFSET);

    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const pref = new ViewPreference({
      instrumentId: 'trumpet',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const result = ProjectionService.project(canonicalSong, trumpet, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // Concierto: G Mayor -> Trompeta Bb escrita: A Mayor (G + 2 = A)
    assert.strictEqual(result.view.writtenKey.tonic.toString(), 'A');
    assert.strictEqual(result.view.writtenKey.mode, 'MAJOR');

    // Primer acorde concierto G -> escrito A
    const firstChord = result.view.getAllChords()[0]!;
    assert.strictEqual(firstChord.canonicalChord.toString('STANDARD'), 'G');
    assert.strictEqual(firstChord.writtenChord.toString('STANDARD'), 'A');

    // Primer compás notas: G4 -> A4
    const firstNote = result.view.getAllNotes()[0]!;
    assert.strictEqual(firstNote.canonicalPitch.toString(), 'G4');
    assert.strictEqual(firstNote.writtenPitch.toString(), 'A4');
  });

  it('7. should project Eb instruments accurately (+9 semitones written pitch)', () => {
    const altoSax = registry.getOrThrow('alto_sax');
    assert.strictEqual(altoSax.transpositionOffsetSemitones, TransposingInstrumentEngine.EB_OFFSET);

    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const pref = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const result = ProjectionService.project(canonicalSong, altoSax, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // Concierto: G Mayor -> Saxo Alto Eb escrito: E Mayor (G + 9 = E)
    assert.strictEqual(result.view.writtenKey.tonic.toString(), 'E');
    assert.strictEqual(result.view.writtenKey.mode, 'MAJOR');

    // Concierto Em -> Escrito C#m (Em + 9 = C#m)
    const secondChord = result.view.getAllChords()[1]!;
    assert.strictEqual(secondChord.canonicalChord.toString('STANDARD'), 'Em');
    assert.strictEqual(secondChord.writtenChord.toString('STANDARD'), 'C#m');
  });

  it('8. should project F instruments accurately (+7 semitones written pitch)', () => {
    // Registrar instrumento en F (Corno Francés)
    const frenchHorn = new InstrumentProfile({
      id: 'french_horn',
      name: 'Corno Francés en F',
      family: 'BRASS',
      transpositionOffsetSemitones: TransposingInstrumentEngine.F_OFFSET, // +7
      clef: 'TREBLE',
      supportedRepresentations: ['STANDARD_NOTATION', 'CHORDS'],
      defaultRepresentations: ['STANDARD_NOTATION'],
    });

    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const pref = new ViewPreference({
      instrumentId: 'french_horn',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const result = ProjectionService.project(canonicalSong, frenchHorn, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // Concierto: G Mayor -> Corno en F escrito: D Mayor (G + 7 = D)
    assert.strictEqual(result.view.writtenKey.tonic.toString(), 'D');
    assert.strictEqual(result.view.writtenKey.mode, 'MAJOR');

    // Concierto G4 -> Escrito D5 (67 + 7 = 74 = D5)
    const firstNote = result.view.getAllNotes()[0]!;
    assert.strictEqual(firstNote.canonicalPitch.toString(), 'G4');
    assert.strictEqual(firstNote.writtenPitch.toString(), 'D5');
  });
});
