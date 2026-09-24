/**
 * @file determinism.test.ts
 * @description Pruebas de determinismo e idéntica reproducibilidad en la ingesta musical.
 * Demuestra que dos ejecuciones idénticas producen un CanonicalMusicPayload exactamente idéntico.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { GOLDEN_FIXTURE_A_SIMPLE_MELODY, GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO } from '../fixtures/golden-fixtures.ts';
import { UnifiedMusicImporter } from '../unified-importer.ts';

describe('Determinism and Reproducibility Ingestion Tests', () => {
  const importer = new UnifiedMusicImporter();

  it('should produce identical JSON payloads on repeated MusicXML imports', () => {
    const run1 = importer.import(GOLDEN_FIXTURE_A_SIMPLE_MELODY, 'song.musicxml');
    const run2 = importer.import(GOLDEN_FIXTURE_A_SIMPLE_MELODY, 'song.musicxml');

    assert.strictEqual(run1.isSuccess, true);
    assert.strictEqual(run2.isSuccess, true);

    const json1 = JSON.stringify(run1.payload?.toJSON());
    const json2 = JSON.stringify(run2.payload?.toJSON());

    assert.strictEqual(json1, json2, 'Las salidas deben ser byte a byte idénticas');
  });

  it('should produce identical JSON payloads on repeated ChordPro imports', () => {
    const run1 = importer.import(GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO, 'song.chordpro');
    const run2 = importer.import(GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO, 'song.chordpro');

    assert.strictEqual(run1.isSuccess, true);
    assert.strictEqual(run2.isSuccess, true);

    const json1 = JSON.stringify(run1.payload?.toJSON());
    const json2 = JSON.stringify(run2.payload?.toJSON());

    assert.strictEqual(json1, json2, 'Las salidas deben ser byte a byte idénticas');
  });
});
