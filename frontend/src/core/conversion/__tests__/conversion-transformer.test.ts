/**
 * @file conversion-transformer.test.ts
 * @description Pruebas unitarias para ConversionTransformer (Fase 2A-R — CR-04 & CR-05).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ConversionTransformer } from '../conversion-transformer.ts';
import { ConversionEngine } from '../conversion-engine.ts';
import {
  createChordsAndLyricsOnlyFixture,
  createFullSongFixture,
} from './fixtures.ts';

describe('ConversionTransformer Tests (CR-04 Transposition & Musical Integrity)', () => {
  it('should transpose chords and notes by +2 semitones without modifying lyrics', () => {
    const payload = createFullSongFixture();
    const originalChordCount = payload.getAllChords().length;
    const originalNoteCount = payload.getAllNotes().length;
    const originalLyrics = payload.getAllLyrics().map((l) => l.text);

    const { payload: transposed, diagnostics } = ConversionTransformer.applyOptions(payload, {
      targetFormat: 'CHORD_PRO',
      transposeSemitones: 2,
    });

    assert.ok(diagnostics.some((d) => d.code === 'TRANSPOSITION_APPLIED'));

    // 1. Acordes deben transponerse: G -> A, C -> D, etc.
    const newChords = transposed.getAllChords();
    assert.strictEqual(newChords.length, originalChordCount);
    // El primer acorde del fixture es G -> transpone a A
    assert.strictEqual(newChords[0]!.chord.root.toString(), 'A');

    // 2. Notas deben transponerse: G4 (67) -> A4 (69)
    const newNotes = transposed.getAllNotes();
    assert.strictEqual(newNotes.length, originalNoteCount);
    assert.strictEqual(newNotes[0]!.pitch.midiNumber, 69);
    assert.strictEqual(newNotes[0]!.pitch.noteName.toString(), 'A');

    // 3. Letras deben permanecer ESTRICTAMENTE idénticas (CERO alteración de texto)
    const transposedLyrics = transposed.getAllLyrics().map((l) => l.text);
    assert.deepStrictEqual(transposedLyrics, originalLyrics);
  });

  it('should maintain totalMelodyNotes === 0 for chord sheets under transposition', () => {
    const chordSheet = createChordsAndLyricsOnlyFixture();
    assert.strictEqual(chordSheet.getAllNotes().length, 0);

    const { payload: transposed } = ConversionTransformer.applyOptions(chordSheet, {
      targetFormat: 'CHORD_PRO',
      transposeSemitones: 3,
    });

    assert.strictEqual(transposed.getAllNotes().length, 0, 'No debe inventar notas melódicas en cifrados');
    assert.strictEqual(transposed.getAllChords().length, chordSheet.getAllChords().length);
    // Primer acorde C -> D# (+3 semitones)
    assert.strictEqual(transposed.getAllChords()[0]!.chord.root.toString(), 'D#');
  });

  it('should apply key override to key signature without mutating notes', () => {
    const payload = createFullSongFixture();
    const { payload: updated, diagnostics } = ConversionTransformer.applyOptions(payload, {
      targetFormat: 'MUSIC_XML',
      keyOverride: 'D',
    });

    assert.ok(diagnostics.some((d) => d.code === 'KEY_OVERRIDE_APPLIED'));
    assert.strictEqual(updated.measures[0]!.keySignature?.tonic.toString(), 'D');
  });

  it('should apply BPM override to timeline tempo map', () => {
    const payload = createFullSongFixture();
    const { payload: updated, diagnostics } = ConversionTransformer.applyOptions(payload, {
      targetFormat: 'MIDI',
      bpmOverride: 140,
    });

    assert.ok(diagnostics.some((d) => d.code === 'BPM_OVERRIDE_APPLIED'));
    assert.strictEqual(updated.timeline.tempoMap.events[0]!.bpm, 140);
  });

  it('should apply time signature override to measures', () => {
    const payload = createFullSongFixture();
    const { payload: updated, diagnostics } = ConversionTransformer.applyOptions(payload, {
      targetFormat: 'MUSIC_XML',
      timeSignatureOverride: '6/8',
    });

    assert.ok(diagnostics.some((d) => d.code === 'TIME_SIGNATURE_OVERRIDE_APPLIED'));
    assert.strictEqual(updated.measures[0]!.timeSignature?.numerator, 6);
    assert.strictEqual(updated.measures[0]!.timeSignature?.denominator, 8);
  });

  it('should integrate options seamlessly through ConversionEngine.convertPayload', () => {
    const engine = new ConversionEngine();
    const payload = createFullSongFixture();

    const result = engine.convertPayload(payload, {
      targetFormat: 'CHORD_PRO',
      transposeSemitones: 2,
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.diagnostics.some((d) => d.code === 'TRANSPOSITION_APPLIED'));
    assert.ok(typeof result.content === 'string');
    // El texto ChordPro generado debe incluir el acorde transcurrido [A] en vez de [G]
    assert.ok((result.content as string).includes('[A]'));
  });
});
