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

  it('should correctly classify the 4 explicit capability states', () => {
    // 1. MusicXML -> SUPPORTED
    const xmlCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('STRUCTURED_MUSICXML');
    const xmlSelf = xmlCaps.find((c) => c.format === 'MUSIC_XML');
    assert.strictEqual(xmlSelf?.capabilityState, 'SUPPORTED');
    assert.strictEqual(xmlSelf?.isAvailable, true);

    const xmlMidi = xmlCaps.find((c) => c.format === 'MIDI');
    assert.strictEqual(xmlMidi?.capabilityState, 'SUPPORTED');

    const xmlPdf = xmlCaps.find((c) => c.format === 'ENGRAVED_PDF');
    assert.strictEqual(xmlPdf?.capabilityState, 'PLANNED_PHASE_2B');
    assert.strictEqual(xmlPdf?.isAvailable, false);

    // 2. ChordPro -> MIDI is NOT_SUPPORTED (Zero Fabrication)
    const choCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('STRUCTURED_CHORDPRO');
    const choMidi = choCaps.find((c) => c.format === 'MIDI');
    assert.strictEqual(choMidi?.capabilityState, 'NOT_SUPPORTED');
    assert.strictEqual(choMidi?.statusBadge, 'BLOCKED_ZERO_FABRICATION');
    assert.strictEqual(choMidi?.isAvailable, false);

    // 3. Audio -> PLANNED_PHASE_2B
    const audioCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('AUDIO_RECORDING');
    for (const cap of audioCaps) {
      assert.strictEqual(cap.capabilityState, 'PLANNED_PHASE_2B');
      assert.strictEqual(cap.isAvailable, false);
    }

    // 4. Tablature -> MIDI is NOT_SUPPORTED (Zero Fabrication), others SUPPORTED
    const tabCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('TABLATURE_ASCII');
    const tabMidi = tabCaps.find((c) => c.format === 'MIDI');
    assert.strictEqual(tabMidi?.capabilityState, 'NOT_SUPPORTED');
    assert.strictEqual(tabMidi?.statusBadge, 'BLOCKED_ZERO_FABRICATION');
    assert.strictEqual(tabMidi?.isAvailable, false);

    const tabTab = tabCaps.find((c) => c.format === 'TABLATURE');
    assert.strictEqual(tabTab?.capabilityState, 'SUPPORTED');
    assert.strictEqual(tabTab?.isAvailable, true);
  });

  it('should produce accurate SourceCapabilitySummary for all source formats', () => {
    // MusicXML
    const xmlSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('STRUCTURED_MUSICXML');
    assert.strictEqual(xmlSum.state, 'SUPPORTED');
    assert.strictEqual(xmlSum.canConvert, true);

    // MIDI
    const midiSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('STRUCTURED_MIDI');
    assert.strictEqual(midiSum.state, 'SUPPORTED');
    assert.strictEqual(midiSum.canConvert, true);

    // ChordPro
    const choSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('STRUCTURED_CHORDPRO');
    assert.strictEqual(choSum.state, 'SUPPORTED');
    assert.strictEqual(choSum.canConvert, true);
    assert.ok(choSum.advisoryNotice?.includes('Cero Fabricación'));

    // TXT Lyrics
    const txtSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('TXT_LYRICS');
    assert.strictEqual(txtSum.state, 'PARTIALLY_SUPPORTED');
    assert.strictEqual(txtSum.canConvert, true);

    // PDF Score
    const pdfSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('PDF_SCORE');
    assert.strictEqual(pdfSum.state, 'PARTIALLY_SUPPORTED');
    assert.strictEqual(pdfSum.canConvert, false);
    assert.ok(pdfSum.advisoryNotice?.includes('Fase 2B'));

    // Image Score
    const imgSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('IMAGE_SCORE');
    assert.strictEqual(imgSum.state, 'PARTIALLY_SUPPORTED');
    assert.strictEqual(imgSum.canConvert, false);
    assert.ok(imgSum.advisoryNotice?.includes('Fase 2B'));

    // Audio
    const audioSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('AUDIO_RECORDING');
    assert.strictEqual(audioSum.state, 'PARTIALLY_SUPPORTED');
    assert.strictEqual(audioSum.canConvert, false);
    assert.ok(audioSum.advisoryNotice?.includes('Fase 2B'));

    // Tablature (Phase 2B.2)
    const tabSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('TABLATURE_ASCII');
    assert.strictEqual(tabSum.state, 'SUPPORTED');
    assert.strictEqual(tabSum.canConvert, true);
  });

  it('should detect tablature and lyrics extensions properly', () => {
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('solo.tab'),
      'TABLATURE_ASCII'
    );
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('letra.txt', 'Sublime Gracia del Senor'),
      'TXT_LYRICS'
    );
  });

  it('should fail-closed on unknown formats, arbitrary json, invalid xml, and unsupported binaries', () => {
    // 1. Unknown extension without content
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('archivo.desconocido'),
      'UNKNOWN_UNSUPPORTED'
    );
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('sin_extension'),
      'UNKNOWN_UNSUPPORTED'
    );

    // 2. Unsupported binary content (random bytes with nulls)
    const randomBinary = new Uint8Array([0x00, 0x01, 0x02, 0x7f, 0x1a, 0x2b]);
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('datos.bin', randomBinary),
      'UNKNOWN_UNSUPPORTED'
    );

    // 3. XML that is not MusicXML
    const nonMusicXml = '<?xml version="1.0"?><configuration><setting name="port">8080</setting></configuration>';
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('config.xml', nonMusicXml),
      'UNKNOWN_UNSUPPORTED'
    );

    // 4. Arbitrary non-canonical JSON
    const arbitraryJson = JSON.stringify({ name: 'package', version: '1.0.0', dependencies: {} });
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('package.json', arbitraryJson),
      'UNKNOWN_UNSUPPORTED'
    );

    // 5. Malformed JSON
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('corrupt.json', '{ "incomplete": true'),
      'UNKNOWN_UNSUPPORTED'
    );

    // 6. Valid canonical JSON should be detected as WRITTEN_NOTES
    const canonicalJson = JSON.stringify({
      version: '1.0',
      title: 'Canción Canónica',
      timeline: { measures: [] },
    });
    assert.strictEqual(
      FormatCapabilitiesEvaluator.detectSourceCategory('score.json', canonicalJson),
      'WRITTEN_NOTES'
    );

    // 7. Source capability summary for UNKNOWN_UNSUPPORTED
    const unknownSum = FormatCapabilitiesEvaluator.getSourceCapabilitySummary('UNKNOWN_UNSUPPORTED', 'datos.bin');
    assert.strictEqual(unknownSum.state, 'NOT_SUPPORTED');
    assert.strictEqual(unknownSum.canConvert, false);
    assert.ok(unknownSum.advisoryNotice?.includes('no reconocido'));

    // 8. Format capabilities for UNKNOWN_UNSUPPORTED
    const unknownCaps = FormatCapabilitiesEvaluator.getFormatCapabilities('UNKNOWN_UNSUPPORTED');
    for (const cap of unknownCaps) {
      assert.strictEqual(cap.isAvailable, false);
      assert.strictEqual(cap.capabilityState, 'NOT_SUPPORTED');
    }
  });
});

