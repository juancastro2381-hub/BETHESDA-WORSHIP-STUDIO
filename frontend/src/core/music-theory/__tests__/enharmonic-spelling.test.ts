import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EnharmonicSpelling } from '../enharmonic-spelling.ts';
import { MusicalKey } from '../musical-key.ts';
import { NoteName } from '../note-name.ts';
import { PitchClass } from '../pitch-class.ts';

describe('Enharmonic Spelling Engine Tests', () => {
  it('should strictly spell PitchClass 10 as Bb in F Major, never as A#', () => {
    // PitchClass 10 en F Major debe ser Bb
    const spelled = EnharmonicSpelling.spell(PitchClass.from(10), MusicalKey.F_MAJOR);
    assert.strictEqual(spelled.toString(), 'Bb');
    assert.notStrictEqual(spelled.toString(), 'A#');
  });

  it('should strictly spell PitchClass 6 as F# in G Major and D Major, never as Gb', () => {
    const spelledInG = EnharmonicSpelling.spell(PitchClass.from(6), MusicalKey.G_MAJOR);
    assert.strictEqual(spelledInG.toString(), 'F#');
    assert.notStrictEqual(spelledInG.toString(), 'Gb');

    const spelledInD = EnharmonicSpelling.spell(PitchClass.from(6), MusicalKey.D_MAJOR);
    assert.strictEqual(spelledInD.toString(), 'F#');
    assert.notStrictEqual(spelledInD.toString(), 'Gb');
  });

  it('should correctly distinguish enharmonic tonal contexts between F# Major and Gb Major', () => {
    // En Fa# Mayor, el 7mo grado es Mi sostenido (E#), correspondiente a PitchClass 5
    const degree7Fs = EnharmonicSpelling.spell(PitchClass.from(5), MusicalKey.FS_MAJOR);
    assert.strictEqual(degree7Fs.toString(), 'E#');

    // En Solb Mayor, el 4to grado es Do bemol (Cb), correspondiente a PitchClass 11
    const degree4Gb = EnharmonicSpelling.spell(PitchClass.from(11), MusicalKey.GB_MAJOR);
    assert.strictEqual(degree4Gb.toString(), 'Cb');
  });

  it('should handle non-diatonic chromatic notes with appropriate accidental bias', () => {
    // En Re Mayor (armadura de 2 sostenidos: F#, C#):
    // Una nota cromática no diatónica como PitchClass 1 (C# es diatónica; PitchClass 8 es Sol#/Lab)
    // En tonalidad con sostenidos, prefiere G#
    const pc8InD = EnharmonicSpelling.spell(PitchClass.from(8), MusicalKey.D_MAJOR);
    assert.strictEqual(pc8InD.toString(), 'G#');

    // En Mib Mayor (armadura de 3 bemoles: Bb, Eb, Ab):
    // PitchClass 1 (Re bemol) en tonalidad con bemoles prefiere Db
    const pc1InEb = EnharmonicSpelling.spell(PitchClass.from(1), MusicalKey.EB_MAJOR);
    assert.strictEqual(pc1InEb.toString(), 'Db');
  });
});
