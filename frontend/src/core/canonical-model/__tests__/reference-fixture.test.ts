/**
 * @file reference-fixture.test.ts
 * @description Pruebas de validación exhaustiva sobre el fixture canónico de referencia
 * "En Tu Presencia" (Sol Mayor, 4/4, 74 BPM, 8 secciones litúrgicas, notas, acordes, letra y pistas).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalMusicPayload } from '../canonical-music-payload.ts';
import { createReferenceSongFixture } from '../fixtures/reference-song.ts';
import { CANONICAL_TPQN } from '../types.ts';
import { CanonicalModelValidator } from '../validator.ts';

describe('Realistic Reference Song Fixture Tests ("En Tu Presencia" - G Major, 4/4, 74 BPM)', () => {
  it('should instantiate and validate the reference fixture with zero domain errors', () => {
    const fixture = createReferenceSongFixture();

    assert.strictEqual(fixture.title, 'En Tu Presencia (Referencia Litúrgica)');
    assert.strictEqual(fixture.timeline.tpqn, CANONICAL_TPQN);
    assert.strictEqual(fixture.timeline.measureCount, 32);
    assert.strictEqual(fixture.timeline.totalDurationTicks, 61440);

    // Tempo a 74 BPM
    assert.strictEqual(fixture.timeline.tempoMap.getTempoAtTick(0), 74);
    assert.strictEqual(fixture.timeline.tempoMap.getTempoAtTick(61440), 74);

    // Duración total en segundos: (61440 * 60) / (480 * 74) = 103.78378... s
    assert.ok(Math.abs(fixture.timeline.totalDurationSeconds - 103.78378) < 0.01);

    // Validación formal de dominio
    const validation = CanonicalModelValidator.validate(fixture);
    assert.strictEqual(
      validation.isValid,
      true,
      `Errores de validación encontrados: ${JSON.stringify(validation.errors)}`
    );
    assert.strictEqual(validation.errors.length, 0);
  });

  it('should verify the 8 liturgical sections and their exact measure/tick boundaries', () => {
    const fixture = createReferenceSongFixture();

    assert.strictEqual(fixture.sections.length, 8);

    const expectedSections = [
      { id: 'sec_intro', type: 'INTRO', startM: 1, count: 4, startT: 0 },
      { id: 'sec_v1', type: 'VERSE', startM: 5, count: 4, startT: 7680 },
      { id: 'sec_c1', type: 'CHORUS', startM: 9, count: 4, startT: 15360 },
      { id: 'sec_v2', type: 'VERSE', startM: 13, count: 4, startT: 23040 },
      { id: 'sec_c2', type: 'CHORUS', startM: 17, count: 4, startT: 30720 },
      { id: 'sec_bridge', type: 'BRIDGE', startM: 21, count: 4, startT: 38400 },
      { id: 'sec_c3', type: 'CHORUS', startM: 25, count: 4, startT: 46080 },
      { id: 'sec_outro', type: 'OUTRO', startM: 29, count: 4, startT: 53760 },
    ];

    for (let i = 0; i < expectedSections.length; i++) {
      const expected = expectedSections[i]!;
      const actual = fixture.sections[i]!;

      assert.strictEqual(actual.id, expected.id);
      assert.strictEqual(actual.type, expected.type);
      assert.strictEqual(actual.startMeasure, expected.startM);
      assert.strictEqual(actual.measureCount, expected.count);
      assert.strictEqual(actual.startTick, expected.startT);
      assert.strictEqual(actual.durationTicks, expected.count * 1920);
    }
  });

  it('should verify notes, chords, lyrics and note-binding in the fixture', () => {
    const fixture = createReferenceSongFixture();

    // Verificación de acordes globales
    const allChords = fixture.getAllChords();
    assert.strictEqual(allChords.length, 32);
    assert.strictEqual(allChords[0]?.chord.root.toString(), 'G');

    // Verificación de sílabas líricas
    const allLyrics = fixture.getAllLyrics();
    assert.ok(allLyrics.length >= 16);

    // Comprobar que cada sílaba con boundNoteId tiene su nota existente
    const allNotes = fixture.getAllNotes();
    const noteIdSet = new Set(allNotes.map((n) => n.id));

    for (const lyric of allLyrics) {
      if (lyric.boundNoteId) {
        assert.ok(
          noteIdSet.has(lyric.boundNoteId),
          `Nota vinculada ${lyric.boundNoteId} no existe en las notas del compás.`
        );
      }
    }
  });

  it('should verify instrument track projections without duplicating notes in track objects', () => {
    const fixture = createReferenceSongFixture();

    assert.strictEqual(fixture.instrumentTracks.length, 3);

    // Track 1: Lead Vocal (Voz 1)
    const vocalEvents = fixture.getTrackEvents('track_lead_vocal');
    assert.strictEqual(vocalEvents.length, 32);
    assert.ok(vocalEvents.every((e) => e.notes.every((n) => n.voice === 1)));

    // Track 2: Acoustic Guitar (Voz 2)
    const guitarEvents = fixture.getTrackEvents('track_acoustic_guitar');
    assert.strictEqual(guitarEvents.length, 32);
    assert.ok(guitarEvents.every((e) => e.notes.every((n) => n.voice === 2)));

    // Track 3: Alto Saxophone (Eb - offset +9)
    const saxTrack = fixture.getTrack('track_alto_sax');
    assert.ok(saxTrack);
    assert.strictEqual(saxTrack.transpositionOffsetSemitones, 9);
    assert.strictEqual(saxTrack.family, 'WOODWINDS');
  });

  it('should preserve complete fidelity across JSON serialization roundtrip of the fixture', () => {
    const fixture = createReferenceSongFixture();
    const jsonString = JSON.stringify(fixture.toJSON());
    const restored = CanonicalMusicPayload.fromJSON(jsonString);

    assert.strictEqual(restored.title, fixture.title);
    assert.strictEqual(restored.measures.length, 32);
    assert.strictEqual(restored.sections.length, 8);
    assert.strictEqual(restored.instrumentTracks.length, 3);
    assert.strictEqual(restored.timeline.totalDurationTicks, 61440);

    const validation = CanonicalModelValidator.validate(restored);
    assert.strictEqual(validation.isValid, true);
  });
});
