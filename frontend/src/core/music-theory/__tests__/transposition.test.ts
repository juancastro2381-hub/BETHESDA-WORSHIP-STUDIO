import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Chord } from '../chord.ts';
import { MusicalKey } from '../musical-key.ts';
import { NoteName } from '../note-name.ts';
import {
  TranspositionEngine,
  TransposingInstrumentEngine,
} from '../transposition.ts';

describe('Analytical Transposition and Transposing Instrument Tests', () => {
  it('should transpose single notes accurately across edge cases', () => {
    // G -> A (+2 semitones)
    const gPlus2 = TranspositionEngine.transposeNote(NoteName.G, 2, MusicalKey.A_MAJOR);
    assert.strictEqual(gPlus2.toString(), 'A');

    // G -> F (-2 semitones)
    const gMinus2 = TranspositionEngine.transposeNote(NoteName.G, -2, MusicalKey.F_MAJOR);
    assert.strictEqual(gMinus2.toString(), 'F');

    // Bb -> Eb (+5 semitones)
    const bbPlus5 = TranspositionEngine.transposeNote(NoteName.BB, 5, MusicalKey.EB_MAJOR);
    assert.strictEqual(bbPlus5.toString(), 'Eb');

    // C -> B (-1 semitone)
    const cMinus1 = TranspositionEngine.transposeNote(NoteName.C, -1, MusicalKey.B_MAJOR);
    assert.strictEqual(cMinus1.toString(), 'B');

    // B -> C (+1 semitone)
    const bPlus1 = TranspositionEngine.transposeNote(NoteName.B, 1, MusicalKey.C_MAJOR);
    assert.strictEqual(bPlus1.toString(), 'C');
  });

  it('should transpose chords preserving qualities and alterations', () => {
    // D/F# transpuesta +2 semitones (a Mi Mayor) -> E/G#
    const dOverFs = Chord.parse('D/F#');
    const transposedE = TranspositionEngine.transposeChord(dOverFs, 2, MusicalKey.E_MAJOR);
    assert.strictEqual(transposedE.root.toString(), 'E');
    assert.strictEqual(transposedE.bass?.toString(), 'G#');
    assert.strictEqual(transposedE.toString(), 'E/G#');

    // C#m7(b5)/G transpuesta +1 semitone (a Re) -> Dm7(b5)/Ab
    const complex = Chord.parse('C#m7(b5)/G');
    const transposedD = TranspositionEngine.transposeChord(complex, 1, MusicalKey.D_MINOR);
    assert.strictEqual(transposedD.root.toString(), 'D');
    assert.strictEqual(transposedD.quality, 'HALF_DIMINISHED_7');
    assert.strictEqual(transposedD.bass?.toString(), 'Ab');
  });

  it('should transpose full MusicalKeys along the Circle of Fifths', () => {
    // G Major (+2) -> A Major
    const aMajor = TranspositionEngine.transposeKey(MusicalKey.G_MAJOR, 2);
    assert.strictEqual(aMajor.equals(MusicalKey.A_MAJOR), true);

    // G Major (-2) -> F Major
    const fMajor = TranspositionEngine.transposeKey(MusicalKey.G_MAJOR, -2);
    assert.strictEqual(fMajor.equals(MusicalKey.F_MAJOR), true);

    // Bb Major (+5) -> Eb Major
    const ebMajor = TranspositionEngine.transposeKey(MusicalKey.BB_MAJOR, 5);
    assert.strictEqual(ebMajor.equals(MusicalKey.EB_MAJOR), true);
  });

  it('should support transposing instruments (Bb, Eb, F) with exact written pitches', () => {
    // 1. Instrumento en Sib (Bb: offset +2 semitonos escritos)
    // Cuando la banda toca Do de concierto (C), el saxo tenor lee Re escrito (D)
    const writtenTenorC = TransposingInstrumentEngine.toWrittenPitch(
      NoteName.C,
      TransposingInstrumentEngine.BB_OFFSET,
      MusicalKey.D_MAJOR
    );
    assert.strictEqual(writtenTenorC.toString(), 'D');

    // Cuando la banda toca Sol de concierto (G), el saxo tenor lee La escrito (A)
    const writtenTenorG = TransposingInstrumentEngine.toWrittenPitch(
      NoteName.G,
      TransposingInstrumentEngine.BB_OFFSET,
      MusicalKey.A_MAJOR
    );
    assert.strictEqual(writtenTenorG.toString(), 'A');

    // 2. Instrumento en Mib (Eb: offset +9 semitonos escritos)
    // Cuando la banda toca Do de concierto (C), el saxo alto lee La escrito (A)
    const writtenAltoC = TransposingInstrumentEngine.toWrittenPitch(
      NoteName.C,
      TransposingInstrumentEngine.EB_OFFSET,
      MusicalKey.A_MAJOR
    );
    assert.strictEqual(writtenAltoC.toString(), 'A');

    // Cuando la banda toca Sol de concierto (G), el saxo alto lee Mi escrito (E)
    const writtenAltoG = TransposingInstrumentEngine.toWrittenPitch(
      NoteName.G,
      TransposingInstrumentEngine.EB_OFFSET,
      MusicalKey.E_MAJOR
    );
    assert.strictEqual(writtenAltoG.toString(), 'E');

    // 3. Instrumento en Fa (F: offset +7 semitonos escritos)
    // Cuando la banda toca Do de concierto (C), el corno lee Sol escrito (G)
    const writtenHornC = TransposingInstrumentEngine.toWrittenPitch(
      NoteName.C,
      TransposingInstrumentEngine.F_OFFSET,
      MusicalKey.G_MAJOR
    );
    assert.strictEqual(writtenHornC.toString(), 'G');

    // Comprobar la operación inversa (de escrito a tono de concierto real)
    const concertFromTenor = TransposingInstrumentEngine.toConcertPitch(
      NoteName.D,
      TransposingInstrumentEngine.BB_OFFSET,
      MusicalKey.C_MAJOR
    );
    assert.strictEqual(concertFromTenor.toString(), 'C');
  });
});
