/**
 * @file musicxml-importer.test.ts
 * @description Pruebas unitarias para MusicXmlImporter y normalización a 480 TPQN.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
import { GOLDEN_FIXTURE_A_SIMPLE_MELODY, GOLDEN_FIXTURE_B_PIANO_POLYPHONY } from '../fixtures/golden-fixtures.ts';
import { MusicXmlImporter } from '../musicxml/musicxml-importer.ts';

describe('MusicXmlImporter Tests (MusicXML 4.0 -> CanonicalMusicPayload)', () => {
  const importer = new MusicXmlImporter();

  it('should correctly identify supported MusicXML sources in canHandle', () => {
    assert.strictEqual(importer.canHandle('<score-partwise></score-partwise>'), true);
    assert.strictEqual(importer.canHandle('<score-timewise></score-timewise>'), true);
    assert.strictEqual(importer.canHandle('', 'hymn.musicxml'), true);
    assert.strictEqual(importer.canHandle('', 'piece.xml'), true);
    assert.strictEqual(importer.canHandle('{title: Song}'), false);
    assert.strictEqual(importer.canHandle('', 'song.chordpro'), false);
  });

  it('should import a simple melody and normalize divisions to 480 TPQN integer ticks', () => {
    const result = importer.import(GOLDEN_FIXTURE_A_SIMPLE_MELODY, { sourceName: 'simple.musicxml' });

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const payload = result.payload;
    assert.strictEqual(payload.title, 'Melodía Simple');
    assert.strictEqual(payload.timeline.tpqn, CANONICAL_TPQN);
    assert.strictEqual(payload.measures.length, 1);

    const measure = payload.measures[0]!;
    assert.strictEqual(measure.number, 1);
    assert.strictEqual(measure.durationTicks, 1920); // 4/4 = 1920 ticks

    const notes = measure.getAllNotes();
    assert.strictEqual(notes.length, 4);

    // Cada nota debe durar exactamente 1 negra = 480 ticks canónicos
    assert.strictEqual(notes[0]?.pitch.noteName.toString(), 'C');
    assert.strictEqual(notes[0]?.durationTicks, 480);
    assert.strictEqual(notes[0]?.startTick, 0);

    assert.strictEqual(notes[1]?.pitch.noteName.toString(), 'D');
    assert.strictEqual(notes[1]?.durationTicks, 480);
    assert.strictEqual(notes[1]?.startTick, 480);

    assert.strictEqual(notes[2]?.pitch.noteName.toString(), 'E');
    assert.strictEqual(notes[2]?.durationTicks, 480);
    assert.strictEqual(notes[2]?.startTick, 960);

    assert.strictEqual(notes[3]?.pitch.noteName.toString(), 'F');
    assert.strictEqual(notes[3]?.durationTicks, 480);
    assert.strictEqual(notes[3]?.startTick, 1440);
  });

  it('should import polyphonic piano MusicXML preserving voices via <backup>', () => {
    const result = importer.import(GOLDEN_FIXTURE_B_PIANO_POLYPHONY);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const m = result.payload.measures[0]!;
    assert.strictEqual(m.voices.length, 2);

    // Voz 1: Dos blancas (E4 en tick 0, G4 en tick 960)
    const voice1 = m.getVoice(1);
    assert.ok(voice1);
    const v1Notes = voice1.getNotes();
    assert.strictEqual(v1Notes.length, 2);
    assert.strictEqual(v1Notes[0]?.pitch.noteName.toString(), 'E');
    assert.strictEqual(v1Notes[0]?.startTick, 0);
    assert.strictEqual(v1Notes[0]?.durationTicks, 960);

    assert.strictEqual(v1Notes[1]?.pitch.noteName.toString(), 'G');
    assert.strictEqual(v1Notes[1]?.startTick, 960);
    assert.strictEqual(v1Notes[1]?.durationTicks, 960);

    // Voz 2: Una redonda en tick 0 (C3 que dura 1920 ticks) gracias al <backup>
    const voice2 = m.getVoice(2);
    assert.ok(voice2);
    const v2Notes = voice2.getNotes();
    assert.strictEqual(v2Notes.length, 1);
    assert.strictEqual(v2Notes[0]?.pitch.noteName.toString(), 'C');
    assert.strictEqual(v2Notes[0]?.pitch.octave, 3);
    assert.strictEqual(v2Notes[0]?.startTick, 0);
    assert.strictEqual(v2Notes[0]?.durationTicks, 1920);
  });

  it('should report actionable diagnostics on malformed or empty MusicXML', () => {
    const badXml = '<score-partwise><not-closed>';
    const result = importer.import(badXml);

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.hasErrors, true);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'MUSICXML_PARSING_FAILED'));
  });
});
