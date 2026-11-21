/**
 * @file chordpro-serializer.test.ts
 * @description Pruebas unitarias para CanonicalToChordProSerializer (Fase 2A).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalToChordProSerializer } from '../exporters/chordpro-serializer.ts';
import {
  createChordsAndLyricsOnlyFixture,
  createFullSongFixture,
  createInstrumentalFixture,
} from './fixtures.ts';

describe('CanonicalToChordProSerializer Tests', () => {
  it('should serialize full canonical song to valid ChordPro format with directives and bracket chords', () => {
    const payload = createFullSongFixture();
    const result = CanonicalToChordProSerializer.serialize(payload);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.targetFormat, 'CHORD_PRO');
    assert.strictEqual(result.mimeType, 'text/plain');
    assert.ok(typeof result.content === 'string');

    const cho = result.content;

    // 1. Directivas de Cabecera
    assert.ok(cho.includes('{title: Sublime Gracia}'));
    assert.ok(cho.includes('{artist: John Newton}'));
    assert.ok(cho.includes('{key: G}'));
    assert.ok(cho.includes('{tempo: 120}'));
    assert.ok(cho.includes('{time: 4/4}'));

    // 2. Secciones
    assert.ok(cho.includes('{start_of_verse: Verso 1}'));
    assert.ok(cho.includes('{end_of_verse}'));

    // 3. Notación acorde-sobre-letra entre corchetes
    assert.ok(cho.includes('[G]'));
    assert.ok(cho.includes('[D]'));
    assert.ok(cho.includes('[Em]'));
    assert.ok(cho.includes('Sublime'));
    assert.ok(cho.includes('Señor'));
  });

  it('should omit {key}, {tempo}, {time} directives when unmetered / unresolved', () => {
    const chordSheet = createChordsAndLyricsOnlyFixture();
    const result = CanonicalToChordProSerializer.serialize(chordSheet);

    assert.strictEqual(result.success, true);
    const cho = result.content as string;

    assert.ok(cho.includes('{title: Canto de Adoración}'));
    assert.ok(!cho.includes('{key:'), 'No debe fabricar tonalidad {key: C} si no fue declarada');
    assert.ok(!cho.includes('{tempo:'), 'No debe fabricar tempo {tempo: 120} si no fue declarado');
    assert.ok(!cho.includes('{time:'), 'No debe fabricar compás {time: 4/4} si no fue declarado');

    assert.ok(cho.includes('{start_of_chorus: Coro}'));
    assert.ok(cho.includes('[C]Aleluya'));
  });

  it('should warn when serializing purely instrumental song without chords', () => {
    const instrumental = createInstrumentalFixture();
    const result = CanonicalToChordProSerializer.serialize(instrumental);

    assert.strictEqual(result.success, true);
    const warning = result.diagnostics.find((d) => d.code === 'CHORDPRO_NO_CHORDS');
    assert.ok(warning, 'Debe registrar diagnóstico CHORDPRO_NO_CHORDS');
  });
});

