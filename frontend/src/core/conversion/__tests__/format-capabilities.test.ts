/**
 * @file format-capabilities.test.ts
 * @description Pruebas unitarias para FormatCapabilitiesEvaluator (Fase 2A).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { FormatCapabilitiesEvaluator } from '../format-capabilities.ts';
import {
  createChordsAndLyricsOnlyFixture,
  createFullSongFixture,
  createInstrumentalFixture,
} from './fixtures.ts';

describe('FormatCapabilitiesEvaluator Tests', () => {
  it('should detect source categories correctly by filename and content', () => {
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('himno.musicxml'),
      'STRUCTURED_MUSICXML'
    );
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('himno.mid'),
      'STRUCTURED_MIDI'
    );
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('himno.cho'),
      'STRUCTURED_CHORDPRO'
    );
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('partitura.pdf'),
      'PDF_SCORE'
    );
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('grabacion.mp3'),
      'AUDIO_RECORDING'
    );

    // Magic Bytes MIDI
    const midiBytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0x00, 0x00]);
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('desconocido.bin', midiBytes),
      'STRUCTURED_MIDI'
    );

    // Magic Bytes PDF
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('documento.bin', pdfBytes),
      'PDF_SCORE'
    );
  });

  it('should mark audio and video sources as DEFERRED_PHASE with explanatory reason', () => {
    const caps = FormatCapabilitiesEvaluator.getFormatCapabilities('AUDIO_RECORDING');
    assert.ok(caps.length >= 6);
    for (const cap of caps) {
      assert.strictEqual(cap.isAvailable, false);
      assert.strictEqual(cap.statusBadge, 'DEFERRED_PHASE');
      assert.ok(cap.blockingReason?.includes('Fase 2B'));
    }
  });

  it('should mark PDF and image score sources as DEFERRED_PHASE with explanatory reason', () => {
    const caps = FormatCapabilitiesEvaluator.getFormatCapabilities('PDF_SCORE');
    for (const cap of caps) {
      assert.strictEqual(cap.isAvailable, false);
      assert.strictEqual(cap.statusBadge, 'DEFERRED_PHASE');
      assert.ok(cap.blockingReason?.includes('OMR'));
    }
  });

  it('should BLOCK MIDI export from ChordPro sources (Zero-Fabrication Contract)', () => {
    const caps = FormatCapabilitiesEvaluator.getFormatCapabilities('STRUCTURED_CHORDPRO');
    const midiCap = caps.find((c) => c.format === 'MIDI');
    assert.ok(midiCap);
    assert.strictEqual(midiCap.isAvailable, false);
    assert.strictEqual(midiCap.statusBadge, 'BLOCKED_ZERO_FABRICATION');
    assert.ok(midiCap.blockingReason?.includes('CERO'));

    const choCap = caps.find((c) => c.format === 'CHORD_PRO');
    assert.ok(choCap?.isAvailable);
    assert.strictEqual(choCap?.statusBadge, 'NATIVE');
  });

  it('should dynamically refine capabilities based on canonical payload contents', () => {
    // 1. Obra completa: todos los formatos estructurados disponibles
    const fullSong = createFullSongFixture();
    const fullCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('STRUCTURED_MUSICXML', fullSong);
    assert.ok(fullCaps.find((c) => c.format === 'MUSIC_XML')?.isAvailable);
    assert.ok(fullCaps.find((c) => c.format === 'MIDI')?.isAvailable);
    assert.ok(fullCaps.find((c) => c.format === 'CHORD_PRO')?.isAvailable);
    assert.ok(fullCaps.find((c) => c.format === 'LYRICS_ONLY')?.isAvailable);

    // 2. Obra sin notas: MIDI bloqueado dinámicamente
    const chordSheet = createChordsAndLyricsOnlyFixture();
    const chordCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('STRUCTURED_MUSICXML', chordSheet);
    const chordMidi = chordCaps.find((c) => c.format === 'MIDI');
    assert.strictEqual(chordMidi?.isAvailable, false);
    assert.strictEqual(chordMidi?.statusBadge, 'BLOCKED_ZERO_FABRICATION');

    // 3. Obra instrumental sin letra: LYRICS_ONLY bloqueado dinámicamente
    const instrumental = createInstrumentalFixture();
    const instCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('STRUCTURED_MUSICXML', instrumental);
    const instLyrics = instCaps.find((c) => c.format === 'LYRICS_ONLY');
    assert.strictEqual(instLyrics?.isAvailable, false);
    assert.strictEqual(instLyrics?.statusBadge, 'BLOCKED_ZERO_FABRICATION');
  });
});

