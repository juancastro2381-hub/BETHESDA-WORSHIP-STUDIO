import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Interval } from '../interval.ts';
import { NoteName } from '../note-name.ts';

describe('Interval Engine Tests', () => {
  it('should distinguish chromatic semitones from diatonic steps', () => {
    // Tercera Menor (m3): 3 semitonos, 2 pasos diatónicos (ej. C a Eb)
    const m3 = Interval.MINOR_THIRD;
    assert.strictEqual(m3.semitones, 3);
    assert.strictEqual(m3.diatonicSteps, 2);
    assert.strictEqual(m3.quality, 'MINOR');
    assert.strictEqual(m3.number, 3);

    // Segunda Aumentada (A2): 3 semitonos, 1 paso diatónico (ej. C a D#)
    const a2 = Interval.AUGMENTED_SECOND;
    assert.strictEqual(a2.semitones, 3);
    assert.strictEqual(a2.diatonicSteps, 1);
    assert.strictEqual(a2.quality, 'AUGMENTED');
    assert.strictEqual(a2.number, 2);

    // Deben tener la misma cantidad de semitonos pero distinta distancia diatónica
    assert.strictEqual(m3.semitones, a2.semitones);
    assert.notStrictEqual(m3.diatonicSteps, a2.diatonicSteps);
    assert.strictEqual(m3.equals(a2), false);
  });

  it('should correctly evaluate all canonical intervals', () => {
    assert.strictEqual(Interval.UNISON.semitones, 0);
    assert.strictEqual(Interval.MINOR_SECOND.semitones, 1);
    assert.strictEqual(Interval.MAJOR_SECOND.semitones, 2);
    assert.strictEqual(Interval.MINOR_THIRD.semitones, 3);
    assert.strictEqual(Interval.MAJOR_THIRD.semitones, 4);
    assert.strictEqual(Interval.PERFECT_FOURTH.semitones, 5);
    assert.strictEqual(Interval.TRITONE.semitones, 6);
    assert.strictEqual(Interval.DIMINISHED_FIFTH.semitones, 6);
    assert.strictEqual(Interval.PERFECT_FIFTH.semitones, 7);
    assert.strictEqual(Interval.MINOR_SIXTH.semitones, 8);
    assert.strictEqual(Interval.MAJOR_SIXTH.semitones, 9);
    assert.strictEqual(Interval.MINOR_SEVENTH.semitones, 10);
    assert.strictEqual(Interval.MAJOR_SEVENTH.semitones, 11);
    assert.strictEqual(Interval.OCTAVE.semitones, 12);
  });

  it('should invert intervals accurately', () => {
    // 3ra Mayor invertida es 6ta Menor (M3 -> m6)
    const invertedM3 = Interval.MAJOR_THIRD.invert();
    assert.strictEqual(invertedM3.quality, 'MINOR');
    assert.strictEqual(invertedM3.number, 6);
    assert.strictEqual(invertedM3.semitones, 8);

    // 5ta Justa invertida es 4ta Justa (P5 -> P4)
    const invertedP5 = Interval.PERFECT_FIFTH.invert();
    assert.strictEqual(invertedP5.quality, 'PERFECT');
    assert.strictEqual(invertedP5.number, 4);
    assert.strictEqual(invertedP5.semitones, 5);
  });

  it('should calculate exact interval between notes', () => {
    // C a E = 3ra Mayor
    const cToE = Interval.between(NoteName.C, NoteName.E);
    assert.strictEqual(cToE.quality, 'MAJOR');
    assert.strictEqual(cToE.number, 3);
    assert.strictEqual(cToE.semitones, 4);

    // C a Eb = 3ra Menor
    const cToEb = Interval.between(NoteName.C, NoteName.EB);
    assert.strictEqual(cToEb.quality, 'MINOR');
    assert.strictEqual(cToEb.number, 3);
    assert.strictEqual(cToEb.semitones, 3);

    // C a G = 5ta Justa
    const cToG = Interval.between(NoteName.C, NoteName.G);
    assert.strictEqual(cToG.quality, 'PERFECT');
    assert.strictEqual(cToG.number, 5);
    assert.strictEqual(cToG.semitones, 7);

    // C a F# = 4ta Aumentada (Tritono)
    const cToFs = Interval.between(NoteName.C, NoteName.FS);
    assert.strictEqual(cToFs.quality, 'AUGMENTED');
    assert.strictEqual(cToFs.number, 4);
    assert.strictEqual(cToFs.semitones, 6);

    // C a Gb = 5ta Disminuida (Tritono)
    const cToGb = Interval.between(NoteName.C, NoteName.GB);
    assert.strictEqual(cToGb.quality, 'DIMINISHED');
    assert.strictEqual(cToGb.number, 5);
    assert.strictEqual(cToGb.semitones, 6);
  });
});
