/**
 * @file capo-and-tablature.test.ts
 * @description Pruebas para la proyección de Cejilla (Capo) y Tablatura de Guitarra/Bajo,
 * validando la independencia estricta entre cejilla física y transposición musical tonal.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../instrument-profile.ts';
import { ProjectionService } from '../projection-service.ts';
import { TablatureCalculator } from '../tablature-calculator.ts';
import { ViewPreference } from '../view-preference.ts';
import { createCanonicalSongGMajorWithNotes } from '../fixtures/golden-scenarios.ts';
import { Pitch } from '../../music-theory/pitch.ts';

describe('Capo and Tablature Projection Tests', () => {
  const registry = new InstrumentRegistry();

  it('9. should project Capo correctly (Concert G Major with Capo 2 -> F fingering shapes)', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = registry.getOrThrow('acoustic_guitar');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['TABLATURE'],
      capoFret: 2,
    });

    const result = ProjectionService.project(canonicalSong, guitar, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // Tono de concierto debe permanecer inalterado en G Mayor
    assert.strictEqual(result.view.concertKey.tonic.toString(), 'G');
    assert.strictEqual(result.view.capoFret, 2);

    const chords = result.view.getAllChords();
    // Primer acorde canónico: G
    const firstChord = chords[0]!;
    assert.strictEqual(firstChord.canonicalChord.toString('STANDARD'), 'G');
    // Digitación con Capo 2: F (Fingering Chord)
    assert.strictEqual(firstChord.fingeringChord.toString('STANDARD'), 'F');
    // Visualización en atril: F
    assert.strictEqual(firstChord.displayString, 'F');
    // Sonido real: G
    assert.strictEqual(firstChord.soundingDisplayString, 'G');

    // Segundo acorde canónico: Em
    const secondChord = chords[1]!;
    assert.strictEqual(secondChord.canonicalChord.toString('STANDARD'), 'Em');
    // Digitación con Capo 2: Dm
    assert.strictEqual(secondChord.fingeringChord.toString('STANDARD'), 'Dm');
    assert.strictEqual(secondChord.displayString, 'Dm');
    assert.strictEqual(secondChord.soundingDisplayString, 'Em');
  });

  it('10. should validate strict independence between Capo and Musical Transposition', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = registry.getOrThrow('acoustic_guitar');

    // Escenario 1: Solo transposición (+2 semitonos, sin capo)
    // Canción sube de G Mayor a A Mayor para toda la banda
    const prefTranspOnly = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      transpositionSemitones: 2,
      capoFret: 0,
    });
    const res1 = ProjectionService.project(canonicalSong, guitar, prefTranspOnly);
    assert.ok(res1.view);
    assert.strictEqual(res1.view.concertKey.tonic.toString(), 'A'); // Tonalidad sonante cambia
    assert.strictEqual(res1.view.getAllChords()[0]!.displayString, 'A');
    assert.strictEqual(res1.view.getAllChords()[0]!.soundingDisplayString, 'A');

    // Escenario 2: Solo capo (Capo 2, transposición 0)
    // Tonalidad sonante de concierto se mantiene en G Mayor para la banda, guitarrista digita en F
    const prefCapoOnly = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      transpositionSemitones: 0,
      capoFret: 2,
    });
    const res2 = ProjectionService.project(canonicalSong, guitar, prefCapoOnly);
    assert.ok(res2.view);
    assert.strictEqual(res2.view.concertKey.tonic.toString(), 'G'); // Tonalidad sonante NO cambia
    assert.strictEqual(res2.view.getAllChords()[0]!.displayString, 'F');
    assert.strictEqual(res2.view.getAllChords()[0]!.soundingDisplayString, 'G');

    // Escenario 3: Ambos activos (Canción transpuesta a A Mayor, guitarrista pone Capo 2)
    // Sonando: A Mayor. Con Capo 2: digita en G
    const prefBoth = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      transpositionSemitones: 2,
      capoFret: 2,
    });
    const res3 = ProjectionService.project(canonicalSong, guitar, prefBoth);
    assert.ok(res3.view);
    assert.strictEqual(res3.view.concertKey.tonic.toString(), 'A');
    assert.strictEqual(res3.view.getAllChords()[0]!.displayString, 'G'); // A - 2 = G
    assert.strictEqual(res3.view.getAllChords()[0]!.soundingDisplayString, 'A');
  });

  it('11. should project Guitar standard notation view with treble clef', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = registry.getOrThrow('acoustic_guitar');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const result = ProjectionService.project(canonicalSong, guitar, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    const m1 = result.view.measures[0]!;
    assert.deepStrictEqual(m1.clefs, ['TREBLE']);
    assert.strictEqual(m1.notes.length, 3);
    assert.strictEqual(m1.notes[0]!.canonicalPitch.toString(), 'G4');
  });

  it('12. should project Guitar tablature view with correct string and fret coordinates', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = registry.getOrThrow('acoustic_guitar');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['STANDARD_NOTATION'],
    });

    const result = ProjectionService.project(canonicalSong, guitar, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    const tabPositions = result.view.getAllTabPositions();
    assert.strictEqual(tabPositions.length, 5); // 3 notas compás 1 + 2 notas compás 2

    // Primera nota: G4 (MIDI 67)
    // Afinación estándar:
    // Cuerda 1 (E4 = 64) -> Traste 3 (67 - 64 = 3)
    const posG4 = tabPositions[0]!;
    assert.strictEqual(posG4.canonicalPitch.toString(), 'G4');
    assert.strictEqual(posG4.stringNumber, 1);
    assert.strictEqual(posG4.fret, 3);

    // Segunda nota: B4 (MIDI 71)
    // Cuerda 1 (E4 = 64) -> Traste 7 (71 - 64 = 7)
    const posB4 = tabPositions[1]!;
    assert.strictEqual(posB4.canonicalPitch.toString(), 'B4');
    assert.strictEqual(posB4.stringNumber, 1);
    assert.strictEqual(posB4.fret, 7);

    // Tercera nota: E4 (MIDI 64)
    // Cuerda 1 (E4 = 64) -> Traste 0 (al aire)
    const posE4 = tabPositions[2]!;
    assert.strictEqual(posE4.canonicalPitch.toString(), 'E4');
    assert.strictEqual(posE4.stringNumber, 1);
    assert.strictEqual(posE4.fret, 0);
  });

  it('13. should project Guitar chords + lyrics without rendering tablature or staff', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = registry.getOrThrow('acoustic_guitar');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
    });

    const result = ProjectionService.project(canonicalSong, guitar, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    assert.ok(result.view.getAllChords().length > 0);
    assert.ok(result.view.getAllLyrics().length > 0);
    // Tablatura no solicitada -> lista de posiciones vacía
    assert.strictEqual(result.view.getAllTabPositions().length, 0);
  });

  it('16. should project Bass notation with Bass clef', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const bass = registry.getOrThrow('bass');

    const pref = new ViewPreference({
      instrumentId: 'bass',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const result = ProjectionService.project(canonicalSong, bass, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    const m1 = result.view.measures[0]!;
    assert.deepStrictEqual(m1.clefs, ['BASS']);
  });

  it('17. should project Bass tablature across 4 strings (E1, A1, D2, G2)', () => {
    const bass = registry.getOrThrow('bass');
    assert.ok(bass.tuning);

    // Probar notas típicas de bajo en afinación estándar
    // E1 (MIDI 28) -> Cuerda 4 (E1), Traste 0
    const posE1 = TablatureCalculator.calculatePosition(Pitch.parse('E1'), bass.tuning);
    assert.ok(posE1);
    assert.strictEqual(posE1.stringNumber, 4);
    assert.strictEqual(posE1.fret, 0);

    // A1 (MIDI 33) -> Cuerda 3 (A1), Traste 0
    const posA1 = TablatureCalculator.calculatePosition(Pitch.parse('A1'), bass.tuning);
    assert.ok(posA1);
    assert.strictEqual(posA1.stringNumber, 3);
    assert.strictEqual(posA1.fret, 0);

    // C2 (MIDI 36) -> Cuerda 3 (A1 = 33), Traste 3
    const posC2 = TablatureCalculator.calculatePosition(Pitch.parse('C2'), bass.tuning);
    assert.ok(posC2);
    assert.strictEqual(posC2.stringNumber, 3);
    assert.strictEqual(posC2.fret, 3);

    // G2 (MIDI 43) -> Cuerda 1 (G2), Traste 0
    const posG2 = TablatureCalculator.calculatePosition(Pitch.parse('G2'), bass.tuning);
    assert.ok(posG2);
    assert.strictEqual(posG2.stringNumber, 1);
    assert.strictEqual(posG2.fret, 0);
  });
});
