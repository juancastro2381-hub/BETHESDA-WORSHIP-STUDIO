/**
 * @file chordpro-importer.test.ts
 * @description Pruebas unitarias para ChordProImporter, independencia del Capo y no invención de notas.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  GOLDEN_FIXTURE_G_SIMPLE_CHORDPRO,
  GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO,
  GOLDEN_FIXTURE_I_CAPO_CHORDPRO,
  GOLDEN_FIXTURE_K_LYRICS_NO_MELODY_CHORDPRO,
} from '../fixtures/golden-fixtures.ts';
import { ChordProImporter } from '../chordpro/chordpro-importer.ts';

describe('ChordProImporter Tests (ChordPro -> CanonicalMusicPayload)', () => {
  const importer = new ChordProImporter();

  it('should identify supported ChordPro files in canHandle', () => {
    assert.strictEqual(importer.canHandle('{title: Sublime Gracia}'), true);
    assert.strictEqual(importer.canHandle('[G]Dios de pactos'), true);
    assert.strictEqual(importer.canHandle('', 'alabanza.chordpro'), true);
    assert.strictEqual(importer.canHandle('', 'cancion.pro'), true);
    assert.strictEqual(importer.canHandle('<score-partwise></score-partwise>'), false);
    assert.strictEqual(importer.canHandle('', 'score.musicxml'), false);
  });

  it('should import simple ChordPro extracting structured chords and metadata', () => {
    const result = importer.import(GOLDEN_FIXTURE_G_SIMPLE_CHORDPRO);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const payload = result.payload;
    assert.strictEqual(payload.title, 'Cuan Grande es Dios');
    assert.strictEqual(payload.timeline.tempoMap.getTempoAtTick(0), 76);

    const chords = payload.getAllChords();
    assert.ok(chords.length >= 3);
    assert.strictEqual(chords[0]?.chord.root.toString(), 'G');
    assert.strictEqual(chords[1]?.chord.root.toString(), 'E');
    assert.strictEqual(chords[1]?.chord.quality, 'MINOR_7');
  });

  it('should handle Capo independently without transposing the canonical concert key', () => {
    const result = importer.import(GOLDEN_FIXTURE_I_CAPO_CHORDPRO);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    // Invariante de Dominio: El Capo se registra en provenance.capoFret = 2
    assert.strictEqual(result.provenance.capoFret, 2);

    // La tonalidad canónica de concierto NO se altera; sigue siendo Sol Mayor (G)
    const m1 = result.payload.measures[0]!;
    assert.strictEqual(m1.keySignature.tonic.toString(), 'G');
    assert.strictEqual(m1.keySignature.mode, 'MAJOR');

    // El primer acorde sonante canónico sigue siendo G
    const chords = result.payload.getAllChords();
    assert.strictEqual(chords[0]?.chord.root.toString(), 'G');
  });

  it('should strictly respect the invariant: DO NOT invent Note objects for ChordPro lyrics and chords', () => {
    const result = importer.import(GOLDEN_FIXTURE_K_LYRICS_NO_MELODY_CHORDPRO);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const payload = result.payload;
    assert.strictEqual(payload.title, 'Solo Letra y Cifrado');

    // Se importan acordes y sílabas líricas
    const chords = payload.getAllChords();
    const lyrics = payload.getAllLyrics();
    assert.ok(chords.length > 0);
    assert.ok(lyrics.length > 0);

    // INVARIANTE CRÍTICO: ¡CERO NOTAS MELÓDICAS INVENTADAS!
    const notes = payload.getAllNotes();
    assert.strictEqual(notes.length, 0, 'No deben inventarse objetos Note para ChordPro');

    // Las sílabas tienen boundNoteId = null
    for (const lyric of lyrics) {
      assert.strictEqual(
        lyric.boundNoteId,
        null,
        'Las sílabas de ChordPro sin melodía deben tener boundNoteId = null'
      );
    }
  });

  it('should parse explicit ChordPro sections ({start_of_verse}, {start_of_chorus}, {start_of_bridge})', () => {
    const result = importer.import(GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const sections = result.payload.sections;
    assert.strictEqual(sections.length, 3);
    assert.strictEqual(sections[0]?.type, 'VERSE');
    assert.strictEqual(sections[1]?.type, 'CHORUS');
    assert.strictEqual(sections[2]?.type, 'BRIDGE');
  });
});
