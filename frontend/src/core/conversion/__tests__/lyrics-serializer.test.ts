/**
 * @file lyrics-serializer.test.ts
 * @description Pruebas unitarias para CanonicalToLyricsSerializer (Fase 2A).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalToLyricsSerializer } from '../exporters/lyrics-serializer.ts';
import {
  createChordsAndLyricsOnlyFixture,
  createFullSongFixture,
  createInstrumentalFixture,
} from './fixtures.ts';

describe('CanonicalToLyricsSerializer Tests', () => {
  it('should serialize full canonical song to clean lyrics text with sections and without chords', () => {
    const payload = createFullSongFixture();
    const result = CanonicalToLyricsSerializer.serialize(payload);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.targetFormat, 'LYRICS_ONLY');
    assert.strictEqual(result.mimeType, 'text/plain; charset=utf-8');
    assert.ok(typeof result.content === 'string');

    const txt = result.content;

    // Encabezado
    assert.ok(txt.includes('SUBLIME GRACIA'));
    assert.ok(txt.includes('Compositor / Artista: John Newton'));

    // Marcador de sección
    assert.ok(txt.includes('[Verso 1]'));

    // Letra limpia ensamblada de sílabas
    assert.ok(txt.includes('Sublime'));
    assert.ok(txt.includes('del Señor'));

    // Cero acordes o corchetes
    assert.ok(!txt.includes('[G]'));
    assert.ok(!txt.includes('[D]'));
    assert.ok(!txt.includes('<note>'));
  });

  it('should REJECT lyrics serialization when document has NO vocal lyrics (Zero-Fabrication Contract)', () => {
    const instrumental = createInstrumentalFixture();
    const result = CanonicalToLyricsSerializer.serialize(instrumental);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.content, '');

    const errorDiag = result.diagnostics.find((d) => d.code === 'LYRICS_NO_VOCAL_CONTENT');
    assert.ok(errorDiag, 'Debe registrar diagnóstico LYRICS_NO_VOCAL_CONTENT');
    assert.strictEqual(errorDiag.severity, 'ERROR');
  });

  it('should serialize chords-and-lyrics fixture with section markers', () => {
    const chordSheet = createChordsAndLyricsOnlyFixture();
    const result = CanonicalToLyricsSerializer.serialize(chordSheet);

    assert.strictEqual(result.success, true);
    const content = result.content as string;
    assert.ok(content.includes('[Coro]'));
    assert.ok(content.includes('Aleluya'));
  });
});
