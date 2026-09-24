/**
 * @file serialization.test.ts
 * @description Pruebas de serialización/deserialización determinista en JSON (PostgreSQL JSONB / IndexedDB)
 * garantizando la ausencia de referencias circulares y la preservación completa del grafo tipado.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Chord } from '../../music-theory/chord.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { CanonicalMusicPayload } from '../canonical-music-payload.ts';
import { ChordEvent } from '../chord-event.ts';
import { InstrumentTrack } from '../instrument-track.ts';
import { KeySignatureReference } from '../key-signature-reference.ts';
import { LyricSyllable } from '../lyric-syllable.ts';
import { Measure } from '../measure.ts';
import { Note, Rest, Voice } from '../musical-event.ts';
import { Section } from '../section.ts';
import { TempoEvent, TempoMap } from '../tempo-map.ts';
import { Timeline } from '../timeline.ts';
import { TimeSignature } from '../time-signature.ts';
import { CANONICAL_TPQN, DURATION_TICKS } from '../types.ts';

describe('Deterministic JSON Serialization & Deserialization Tests', () => {
  it('should roundtrip a complete CanonicalMusicPayload to and from JSON deterministically', () => {
    const keySig = new KeySignatureReference(NoteName.D, 'MAJOR');
    const tempoMap = new TempoMap([new TempoEvent(0, 100), new TempoEvent(3840, 120)]);

    const note1 = new Note({
      id: 'n_101',
      pitch: new Pitch(NoteName.D, 4),
      startTick: 0,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
      velocity: 88,
      dynamic: 'mf',
      articulations: ['accent'],
    });

    const rest1 = new Rest({
      id: 'r_101',
      startTick: DURATION_TICKS.QUARTER,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
    });

    const chord1 = new ChordEvent({
      id: 'ch_101',
      chord: Chord.parse('Dmaj7'),
      startTick: 0,
      durationTicks: DURATION_TICKS.HALF,
      measureNumber: 1,
    });

    const syl1 = new LyricSyllable({
      id: 'syl_101',
      text: 'Dios',
      isHyphenated: false,
      boundNoteId: 'n_101',
      measureNumber: 1,
      tickOffset: 0,
      sequenceNumber: 1,
      chordAbove: Chord.parse('Dmaj7'),
    });

    const measure1 = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: keySig,
      startTick: 0,
      voices: [new Voice(1, [note1, rest1])],
      chords: [chord1],
      lyrics: [syl1],
      repeatStart: true,
    });

    const measure2 = new Measure({
      number: 2,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: keySig,
      startTick: 1920,
      repeatEnd: true,
      repeatCount: 2,
    });

    const section = new Section({
      id: 'sec_v1',
      type: 'VERSE',
      label: 'Estrofa 1',
      startMeasure: 1,
      measureCount: 2,
      startTick: 0,
      durationTicks: 3840,
    });

    const track = new InstrumentTrack({
      id: 'track_lead',
      name: 'Voz Solista',
      family: 'VOCALS',
      clef: 'TREBLE',
      transpositionOffsetSemitones: 0,
      voiceIds: [1],
    });

    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      totalDurationTicks: 3840,
      measureCount: 2,
      tempoMap,
    });

    const payload = new CanonicalMusicPayload({
      title: 'Obra de Prueba Serialización',
      timeline,
      sections: [section],
      measures: [measure1, measure2],
      instrumentTracks: [track],
    });

    // 1. Serializar a objeto JSON
    const json = payload.toJSON();

    // 2. Serializar a string JSON (probar que no hay referencias circulares)
    const jsonString = JSON.stringify(json);
    assert.strictEqual(typeof jsonString, 'string');
    assert.strictEqual(jsonString.includes('Obra de Prueba Serialización'), true);

    // 3. Deserializar a nueva instancia
    const deserialized = CanonicalMusicPayload.fromJSON(jsonString);

    // 4. Aseveraciones de fidelidad completa del grafo
    assert.strictEqual(deserialized.title, payload.title);
    assert.strictEqual(deserialized.timeline.totalDurationTicks, 3840);
    assert.strictEqual(deserialized.timeline.measureCount, 2);
    assert.strictEqual(deserialized.timeline.tempoMap.getTempoAtTick(0), 100);
    assert.strictEqual(deserialized.timeline.tempoMap.getTempoAtTick(3840), 120);

    assert.strictEqual(deserialized.sections.length, 1);
    assert.strictEqual(deserialized.sections[0]?.label, 'Estrofa 1');
    assert.strictEqual(deserialized.sections[0]?.type, 'VERSE');

    assert.strictEqual(deserialized.measures.length, 2);
    const m1 = deserialized.getMeasure(1);
    assert.ok(m1);
    assert.strictEqual(m1.repeatStart, true);
    assert.strictEqual(m1.keySignature.tonic.toString(), 'D');
    assert.strictEqual(m1.keySignature.mode, 'MAJOR');

    // Nota deserializada
    const notes = m1.getAllNotes();
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0]?.id, 'n_101');
    assert.strictEqual(notes[0]?.pitch.noteName.toString(), 'D');
    assert.strictEqual(notes[0]?.pitch.octave, 4);
    assert.strictEqual(notes[0]?.dynamic, 'mf');
    assert.strictEqual(notes[0]?.articulations.includes('accent'), true);

    // Acorde deserializado
    assert.strictEqual(m1.chords.length, 1);
    assert.strictEqual(m1.chords[0]?.chord.root.toString(), 'D');
    assert.strictEqual(m1.chords[0]?.chord.quality, 'MAJOR_7');

    // Sílaba lírica deserializada
    assert.strictEqual(m1.lyrics.length, 1);
    assert.strictEqual(m1.lyrics[0]?.text, 'Dios');
    assert.strictEqual(m1.lyrics[0]?.boundNoteId, 'n_101');
    assert.strictEqual(m1.lyrics[0]?.chordAbove?.toString(), 'Dmaj7');

    // Deserialización determinista idéntica
    const secondPass = deserialized.toJSON();
    assert.deepStrictEqual(json, secondPass);
  });
});
