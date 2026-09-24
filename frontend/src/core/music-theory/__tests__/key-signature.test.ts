import { describe, it } from 'node:test';
import assert from 'node:assert';
import { KeySignature, SHARP_ORDER, FLAT_ORDER } from '../key-signature.ts';
import { MusicalKey } from '../musical-key.ts';
import { NoteName } from '../note-name.ts';

describe('KeySignature and Circle of Fifths Engine Tests', () => {
  it('should verify the canonical order of sharps and flats', () => {
    assert.deepStrictEqual(SHARP_ORDER, ['F', 'C', 'G', 'D', 'A', 'E', 'B']);
    assert.deepStrictEqual(FLAT_ORDER, ['B', 'E', 'A', 'D', 'G', 'C', 'F']);
  });

  it('should correctly configure key signatures along the Circle of Fifths', () => {
    assert.strictEqual(MusicalKey.C_MAJOR.keySignature.accidentalCount, 0);
    assert.strictEqual(MusicalKey.G_MAJOR.keySignature.accidentalCount, 1);
    assert.strictEqual(MusicalKey.D_MAJOR.keySignature.accidentalCount, 2);
    assert.strictEqual(MusicalKey.A_MAJOR.keySignature.accidentalCount, 3);
    assert.strictEqual(MusicalKey.E_MAJOR.keySignature.accidentalCount, 4);
    assert.strictEqual(MusicalKey.B_MAJOR.keySignature.accidentalCount, 5);
    assert.strictEqual(MusicalKey.FS_MAJOR.keySignature.accidentalCount, 6);
    assert.strictEqual(MusicalKey.CS_MAJOR.keySignature.accidentalCount, 7);

    assert.strictEqual(MusicalKey.F_MAJOR.keySignature.accidentalCount, -1);
    assert.strictEqual(MusicalKey.BB_MAJOR.keySignature.accidentalCount, -2);
    assert.strictEqual(MusicalKey.EB_MAJOR.keySignature.accidentalCount, -3);
    assert.strictEqual(MusicalKey.AB_MAJOR.keySignature.accidentalCount, -4);
    assert.strictEqual(MusicalKey.DB_MAJOR.keySignature.accidentalCount, -5);
    assert.strictEqual(MusicalKey.GB_MAJOR.keySignature.accidentalCount, -6);
    assert.strictEqual(MusicalKey.CB_MAJOR.keySignature.accidentalCount, -7);
  });

  it('should accurately resolve relative Major and Minor keys with identical key signatures', () => {
    // Do Mayor <-> La menor (0 alteraciones)
    assert.strictEqual(MusicalKey.C_MAJOR.getRelativeKey().equals(MusicalKey.A_MINOR), true);
    assert.strictEqual(MusicalKey.A_MINOR.getRelativeKey().equals(MusicalKey.C_MAJOR), true);

    // Sol Mayor <-> Mi menor (1 sostenido: Fa#)
    assert.strictEqual(MusicalKey.G_MAJOR.getRelativeKey().equals(MusicalKey.E_MINOR), true);
    assert.strictEqual(MusicalKey.E_MINOR.getRelativeKey().equals(MusicalKey.G_MAJOR), true);

    // Mi bemol Mayor <-> Do menor (3 bemoles: Sib, Mib, Lab)
    assert.strictEqual(MusicalKey.EB_MAJOR.getRelativeKey().equals(MusicalKey.C_MINOR), true);
    assert.strictEqual(MusicalKey.C_MINOR.getRelativeKey().equals(MusicalKey.EB_MAJOR), true);
  });

  it('should generate all 7 diatonic notes ensuring every letter A-G is used exactly once', () => {
    // Escala de Fa Mayor: F, G, A, Bb, C, D, E (¡Debe tener Bb, NUNCA A#!)
    const fMajorNotes = MusicalKey.F_MAJOR.getScaleNotes();
    assert.strictEqual(fMajorNotes.length, 7);
    const fNoteStrings = fMajorNotes.map((n) => n.toString());
    assert.deepStrictEqual(fNoteStrings, ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);

    // Escala de Sol Mayor: G, A, B, C, D, E, F# (¡Debe tener F#, NUNCA Gb!)
    const gMajorNotes = MusicalKey.G_MAJOR.getScaleNotes();
    const gNoteStrings = gMajorNotes.map((n) => n.toString());
    assert.deepStrictEqual(gNoteStrings, ['G', 'A', 'B', 'C', 'D', 'E', 'F#']);

    // Escala de Fa sostenido Mayor: F#, G#, A#, B, C#, D#, E# (¡Séptimo grado es E#, no F!)
    const fsMajorNotes = MusicalKey.FS_MAJOR.getScaleNotes();
    const fsNoteStrings = fsMajorNotes.map((n) => n.toString());
    assert.deepStrictEqual(fsNoteStrings, ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);

    // Escala de Sol bemol Mayor: Gb, Ab, Bb, Cb, Db, Eb, F (¡Cuarto grado es Cb, no B!)
    const gbMajorNotes = MusicalKey.GB_MAJOR.getScaleNotes();
    const gbNoteStrings = gbMajorNotes.map((n) => n.toString());
    assert.deepStrictEqual(gbNoteStrings, ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']);
  });
});
