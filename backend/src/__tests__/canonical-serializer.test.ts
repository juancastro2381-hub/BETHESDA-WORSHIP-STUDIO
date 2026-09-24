/**
 * @file canonical-serializer.test.ts
 * @description Pruebas unitarias de serialización y deserialización determinista del modelo canónico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/index.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import {
  CanonicalDeserializer,
  CanonicalSerializer,
} from '../domain/canonical-serializer.ts';
import { InvalidMusicPayloadError } from '../domain/errors.ts';

describe('Phase 2A — Canonical Serializer & Deserializer Tests', () => {
  it('7. should serialize a CanonicalMusicPayload into a deterministic JSON structure', () => {
    const song = createReferenceSongFixture();
    const json = CanonicalSerializer.serialize(song);

    assert.strictEqual(json.title, 'En Tu Presencia (Referencia Litúrgica)');
    assert.strictEqual(json.version, '1.0.0');
    assert.strictEqual(json.timeline.tpqn, 480);
    assert.strictEqual(json.measures.length, 32);
    assert.strictEqual(json.sections.length, 8);

    const stats = CanonicalSerializer.extractStatistics(song);
    assert.strictEqual(stats.totalMeasures, 32);
    assert.ok(stats.totalNotes > 0);
    assert.ok(stats.totalChords > 0);
  });

  it('8. should deserialize JSON structure back into a fully hydrated CanonicalMusicPayload', () => {
    const original = createReferenceSongFixture();
    const json = CanonicalSerializer.serialize(original);

    const hydrated = CanonicalDeserializer.deserialize(json);

    assert.ok(hydrated instanceof CanonicalMusicPayload);
    assert.strictEqual(hydrated.title, original.title);
    assert.strictEqual(hydrated.measures.length, original.measures.length);
    assert.strictEqual(hydrated.timeline.tpqn, original.timeline.tpqn);

    // Comprobar equivalencia compás por compás
    const m1Original = original.measures[0]!;
    const m1Hydrated = hydrated.measures[0]!;
    assert.strictEqual(m1Hydrated.number, m1Original.number);
    assert.strictEqual(m1Hydrated.timeSignature.numerator, m1Original.timeSignature.numerator);
    assert.strictEqual(m1Hydrated.keySignature.toMusicalKey().toString(), m1Original.keySignature.toMusicalKey().toString());
    assert.strictEqual(m1Hydrated.getAllNotes().length, m1Original.getAllNotes().length);
    assert.strictEqual(m1Hydrated.chords.length, m1Original.chords.length);
  });

  it('9. should reject malformed or invalid canonical structures with InvalidMusicPayloadError', () => {
    // Caso 1: Estructura no objeto
    assert.throws(
      () => CanonicalDeserializer.deserialize('no-es-objeto'),
      (err: any) => err instanceof InvalidMusicPayloadError
    );

    // Caso 2: Falta el título
    assert.throws(
      () => CanonicalDeserializer.deserialize({ measures: [], timeline: {} }),
      (err: any) => err instanceof InvalidMusicPayloadError
    );

    // Caso 3: Objeto inválido sin compases
    assert.throws(
      () => CanonicalDeserializer.deserialize({ title: 'Canción Inválida', timeline: {}, measures: 'no-array' }),
      (err: any) => err instanceof InvalidMusicPayloadError
    );
  });
});
