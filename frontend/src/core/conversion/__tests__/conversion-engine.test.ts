/**
 * @file conversion-engine.test.ts
 * @description Pruebas de integración del motor de conversión ConversionEngine (Fase 2A).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ConversionEngine } from '../conversion-engine.ts';
import { createFullSongFixture } from './fixtures.ts';

describe('ConversionEngine Integration Tests', () => {
  const engine = new ConversionEngine();

  it('should convert CanonicalMusicPayload to all 4 supported formats', () => {
    const payload = createFullSongFixture();

    // 1. MusicXML
    const resXml = engine.convertPayload(payload, { targetFormat: 'MUSIC_XML' });
    assert.strictEqual(resXml.success, true);
    assert.ok(typeof resXml.content === 'string');
    assert.ok(resXml.content.includes('<score-partwise'));

    // 2. MIDI
    const resMidi = engine.convertPayload(payload, { targetFormat: 'MIDI' });
    assert.strictEqual(resMidi.success, true);
    assert.ok(resMidi.content instanceof Uint8Array);

    // 3. ChordPro
    const resCho = engine.convertPayload(payload, { targetFormat: 'CHORD_PRO' });
    assert.strictEqual(resCho.success, true);
    assert.ok(typeof resCho.content === 'string');
    assert.ok(resCho.content.includes('{title:'));

    // 4. Lyrics Only
    const resTxt = engine.convertPayload(payload, { targetFormat: 'LYRICS_ONLY' });
    assert.strictEqual(resTxt.success, true);
    assert.ok(typeof resTxt.content === 'string');
    assert.ok(resTxt.content.includes('[Verso 1]'));
  });

  it('should reject deferred formats with explanatory diagnostic', () => {
    const payload = createFullSongFixture();

    const resPdf = engine.convertPayload(payload, { targetFormat: 'ENGRAVED_PDF' });
    assert.strictEqual(resPdf.success, false);
    assert.ok(resPdf.diagnostics.some((d) => d.code === 'ENGRAVED_PDF_DEFERRED_PHASE'));

    // TABLATURE is now supported in Phase 2B.2
    const resTab = engine.convertPayload(payload, { targetFormat: 'TABLATURE' });
    assert.strictEqual(resTab.success, true);
    assert.ok(typeof resTab.content === 'string');
    assert.ok(resTab.content.includes('TABLATURA CANÓNICA ASCII'));
  });

  it('should convert raw ChordPro string to MusicXML lead sheet and lyrics text', () => {
    const chordProSource = `
{title: Gracia Sublime}
{artist: Phil Wickham}
{key: G}
{tempo: 100}
{start_of_chorus: Coro}
[G]Gracia sublime es, [C]perfecto amor
{end_of_chorus}
`;

    // A. A Texto de solo letra
    const resTxt = engine.convertSource(chordProSource, 'cancion.cho', {
      targetFormat: 'LYRICS_ONLY',
    });
    assert.strictEqual(resTxt.success, true);
    assert.ok(resTxt.content.toString().includes('Gracia sublime es'));

    // B. A MusicXML (con advertencia de que no contiene notas melódicas)
    const resXml = engine.convertSource(chordProSource, 'cancion.cho', {
      targetFormat: 'MUSIC_XML',
    });
    assert.strictEqual(resXml.success, true);
    assert.ok(resXml.content.toString().includes('<score-partwise'));

    // C. A MIDI (debe fallar por Cero Fabricación)
    const resMidi = engine.convertSource(chordProSource, 'cancion.cho', {
      targetFormat: 'MIDI',
    });
    assert.strictEqual(resMidi.success, false);
    assert.ok(resMidi.diagnostics.some((d) => d.code === 'CANNOT_EXPORT_MIDI_WITHOUT_NOTES'));
  });
});

