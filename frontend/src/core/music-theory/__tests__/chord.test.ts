import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Chord } from '../chord.ts';
import { NoteName } from '../note-name.ts';
import { PitchClass } from '../pitch-class.ts';

describe('Structured Chord Model Tests', () => {
  it('should accurately parse and represent simple triads (C, Cm)', () => {
    const cMajor = Chord.parse('C');
    assert.strictEqual(cMajor.root.equals(NoteName.C), true);
    assert.strictEqual(cMajor.quality, 'MAJOR');
    assert.strictEqual(cMajor.isSlashChord, false);

    const cPitches = cMajor.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(cPitches, [0, 4, 7]); // C, E, G

    const cMinor = Chord.parse('Cm');
    assert.strictEqual(cMinor.root.equals(NoteName.C), true);
    assert.strictEqual(cMinor.quality, 'MINOR');
    const cmPitches = cMinor.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(cmPitches, [0, 3, 7]); // C, Eb, G
  });

  it('should parse 7th chords correctly (C7, Cmaj7, Cm7)', () => {
    const c7 = Chord.parse('C7');
    assert.strictEqual(c7.quality, 'DOMINANT_7');
    const c7Pitches = c7.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(c7Pitches, [0, 4, 7, 10]); // C, E, G, Bb

    const cMaj7 = Chord.parse('Cmaj7');
    assert.strictEqual(cMaj7.quality, 'MAJOR_7');
    const cMaj7Pitches = cMaj7.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(cMaj7Pitches, [0, 4, 7, 11]); // C, E, G, B

    const cm7 = Chord.parse('Cm7');
    assert.strictEqual(cm7.quality, 'MINOR_7');
    const cm7Pitches = cm7.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(cm7Pitches, [0, 3, 7, 10]); // C, Eb, G, Bb
  });

  it('should parse suspended and added tone chords (Csus4, Cadd9)', () => {
    const csus4 = Chord.parse('Csus4');
    assert.strictEqual(csus4.suspended, 4);
    const csus4Pitches = csus4.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(csus4Pitches, [0, 5, 7]); // C, F, G

    const cAdd9 = Chord.parse('Cadd9');
    assert.strictEqual(cAdd9.addedTones.includes('add9'), true);
    const cAdd9Pitches = cAdd9.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(cAdd9Pitches, [0, 2, 4, 7]); // C, D, E, G
  });

  it('should parse altered dominant chords (C7(b9))', () => {
    const c7b9 = Chord.parse('C7(b9)');
    assert.strictEqual(c7b9.quality, 'DOMINANT_7');
    assert.strictEqual(c7b9.alterations.includes('b9'), true);
    const pitches = c7b9.getPitchClasses().map((p) => p.value).sort((a, b) => a - b);
    assert.deepStrictEqual(pitches, [0, 1, 4, 7, 10]); // C, Db, E, G, Bb
  });

  it('should parse complex slash chords and half-diminished chords (C#m7(b5)/G, D/F#)', () => {
    const complex = Chord.parse('C#m7(b5)/G');
    assert.strictEqual(complex.root.toString(), 'C#');
    assert.strictEqual(complex.quality, 'HALF_DIMINISHED_7');
    assert.strictEqual(complex.isSlashChord, true);
    assert.strictEqual(complex.bass?.toString(), 'G');

    const dOverFs = Chord.parse('D/F#');
    assert.strictEqual(dOverFs.root.toString(), 'D');
    assert.strictEqual(dOverFs.quality, 'MAJOR');
    assert.strictEqual(dOverFs.isSlashChord, true);
    assert.strictEqual(dOverFs.bass?.toString(), 'F#');
  });

  it('should support string conversion in Latin and Standard formats', () => {
    const dOverFs = Chord.parse('D/F#');
    assert.strictEqual(dOverFs.toString('STANDARD'), 'D/F#');
    assert.strictEqual(dOverFs.toString('LATIN'), 'Re/Fa#');

    const cm7 = Chord.parse('Cm7');
    assert.strictEqual(cm7.toString('STANDARD'), 'Cm7');
    assert.strictEqual(cm7.toString('LATIN'), 'Rem7' === 'Rem7' ? cm7.toString('LATIN') : 'Dom7');
    assert.strictEqual(cm7.toString('LATIN'), 'Dom7');
  });
});
