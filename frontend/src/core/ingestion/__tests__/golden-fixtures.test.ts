/**
 * @file golden-fixtures.test.ts
 * @description Suite de validación exhaustiva de los 11 Golden Fixtures (A hasta K),
 * garantizando que tanto MusicXML como ChordPro produzcan CanonicalMusicPayload válidos.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalModelValidator } from '../../canonical-model/validator.ts';
import {
  GOLDEN_FIXTURE_A_SIMPLE_MELODY,
  GOLDEN_FIXTURE_B_PIANO_POLYPHONY,
  GOLDEN_FIXTURE_C_GUITAR_CHORDS,
  GOLDEN_FIXTURE_D_LYRICS,
  GOLDEN_FIXTURE_E_HARMONY,
  GOLDEN_FIXTURE_F_REPEATS,
  GOLDEN_FIXTURE_G_SIMPLE_CHORDPRO,
  GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO,
  GOLDEN_FIXTURE_I_CAPO_CHORDPRO,
  GOLDEN_FIXTURE_J_COMPLEX_CHORDS_CHORDPRO,
  GOLDEN_FIXTURE_K_LYRICS_NO_MELODY_CHORDPRO,
} from '../fixtures/golden-fixtures.ts';
import { UnifiedMusicImporter } from '../unified-importer.ts';

describe('All 11 Golden Fixtures Validation Tests (A through K)', () => {
  const unifiedImporter = new UnifiedMusicImporter();

  it('Fixture A: Simple MusicXML melody should pass validation', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_A_SIMPLE_MELODY, 'fixture_a.musicxml');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
  });

  it('Fixture B: Piano polyphonic MusicXML should pass validation and preserve voices', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_B_PIANO_POLYPHONY, 'fixture_b.musicxml');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    assert.strictEqual(res.payload.measures[0]?.voices.length, 2);
  });

  it('Fixture C: Guitar MusicXML should pass validation and extract harmony', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_C_GUITAR_CHORDS, 'fixture_c.musicxml');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    assert.ok(res.payload.getAllChords().length >= 2);
  });

  it('Fixture D: MusicXML with lyrics should pass validation and link syllables to notes', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_D_LYRICS, 'fixture_d.musicxml');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    const lyrics = res.payload.getAllLyrics();
    assert.strictEqual(lyrics.length, 3);
    assert.strictEqual(lyrics[0]?.isHyphenated, true); // "Glo-"
    assert.strictEqual(lyrics[1]?.isHyphenated, false); // "ria"
    assert.ok(lyrics[0]?.boundNoteId);
  });

  it('Fixture E: MusicXML with complex harmony (maj7, D/F#) should pass validation', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_E_HARMONY, 'fixture_e.musicxml');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    const chords = res.payload.getAllChords();
    assert.strictEqual(chords.length, 2);
    assert.strictEqual(chords[0]?.chord.quality, 'MAJOR_7');
    assert.strictEqual(chords[1]?.chord.isSlashChord, true);
    assert.strictEqual(chords[1]?.chord.bass?.toString(), 'F#');
  });

  it('Fixture F: MusicXML with repeats and endings should pass validation', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_F_REPEATS, 'fixture_f.musicxml');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    assert.strictEqual(res.payload.measures[0]?.repeatStart, true);
    assert.strictEqual(res.payload.measures[1]?.repeatEnd, true);
    assert.strictEqual(res.payload.measures[1]?.endingNumber, 1);
  });

  it('Fixture G: Simple ChordPro should pass validation', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_G_SIMPLE_CHORDPRO, 'fixture_g.chordpro');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
  });

  it('Fixture H: ChordPro with sections should pass validation and create section objects', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO, 'fixture_h.chordpro');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    assert.strictEqual(res.payload.sections.length, 3);
  });

  it('Fixture I: ChordPro with Capo should preserve concert key and set capoFret', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_I_CAPO_CHORDPRO, 'fixture_i.chordpro');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    assert.strictEqual(res.provenance.capoFret, 2);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
  });

  it('Fixture J: ChordPro with complex chords should parse C#m7(b5)/G and G7(b9)', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_J_COMPLEX_CHORDS_CHORDPRO, 'fixture_j.chordpro');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    const chords = res.payload.getAllChords();
    assert.ok(chords.length >= 2);
  });

  it('Fixture K: ChordPro with lyrics and NO melody notes should pass validation', () => {
    const res = unifiedImporter.import(GOLDEN_FIXTURE_K_LYRICS_NO_MELODY_CHORDPRO, 'fixture_k.chordpro');
    assert.strictEqual(res.isSuccess, true);
    assert.ok(res.payload);
    const val = CanonicalModelValidator.validate(res.payload);
    assert.strictEqual(val.isValid, true);
    assert.strictEqual(res.payload.getAllNotes().length, 0);
  });
});
