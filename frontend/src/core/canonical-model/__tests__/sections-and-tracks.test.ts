/**
 * @file sections-and-tracks.test.ts
 * @description Pruebas unitarias para Section (secciones litúrgicas) e InstrumentTrack (descriptores y filtros sin duplicación de notas).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { CanonicalMusicPayload } from '../canonical-music-payload.ts';
import { InstrumentTrack } from '../instrument-track.ts';
import { KeySignatureReference } from '../key-signature-reference.ts';
import { Measure } from '../measure.ts';
import { Note, Voice } from '../musical-event.ts';
import { Section } from '../section.ts';
import { Timeline } from '../timeline.ts';
import { TimeSignature } from '../time-signature.ts';
import { DURATION_TICKS, type SectionType } from '../types.ts';

describe('Sections and Instrument Tracks Tests', () => {
  const cMajorKey = new KeySignatureReference(NoteName.C, 'MAJOR');

  it('should instantiate and validate all approved Section types', () => {
    const allTypes: SectionType[] = [
      'INTRO',
      'VERSE',
      'PRE_CHORUS',
      'CHORUS',
      'BRIDGE',
      'INTERLUDE',
      'SOLO',
      'INSTRUMENTAL',
      'OUTRO',
      'ENDING',
      'TAG',
      'VAMP',
      'CUSTOM',
    ];

    for (let i = 0; i < allTypes.length; i++) {
      const type = allTypes[i]!;
      const sec = new Section({
        id: `sec_${type.toLowerCase()}`,
        type,
        label: `Test ${type}`,
        startMeasure: i * 4 + 1,
        measureCount: 4,
        startTick: i * 7680,
        durationTicks: 7680,
      });

      assert.strictEqual(sec.type, type);
      assert.strictEqual(sec.startMeasure, i * 4 + 1);
      assert.strictEqual(sec.endMeasure, i * 4 + 4);
      assert.strictEqual(sec.containsMeasure(i * 4 + 2), true);
      assert.strictEqual(sec.containsMeasure(i * 4 + 5), false);
    }
  });

  it('should filter musical events through InstrumentTrack without duplicating notes in the track object', () => {
    // Compás con 2 voces polifónicas
    // Voz 1: Saxo Alto (Melodía)
    const saxNote = new Note({
      id: 'note_sax_1',
      pitch: new Pitch(NoteName.C, 5),
      startTick: 0,
      durationTicks: DURATION_TICKS.WHOLE,
      voice: 1,
    });

    // Voz 2: Bajo Eléctrico (Línea de bajo)
    const bassNote = new Note({
      id: 'note_bass_1',
      pitch: new Pitch(NoteName.C, 2),
      startTick: 0,
      durationTicks: DURATION_TICKS.WHOLE,
      voice: 2,
    });

    const measure = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
      voices: [new Voice(1, [saxNote]), new Voice(2, [bassNote])],
    });

    // Pistas como filtros lógicos
    const altoSaxTrack = new InstrumentTrack({
      id: 'track_sax',
      name: 'Saxo Alto',
      family: 'WOODWINDS',
      clef: 'TREBLE',
      transpositionOffsetSemitones: 9, // Eb = +9 semitonos
      voiceIds: [1],
    });

    const bassTrack = new InstrumentTrack({
      id: 'track_bass',
      name: 'Bajo Eléctrico',
      family: 'BASS',
      clef: 'BASS',
      transpositionOffsetSemitones: 0,
      voiceIds: [2],
    });

    const timeline = new Timeline({
      totalDurationTicks: 1920,
      measureCount: 1,
    });

    const payload = new CanonicalMusicPayload({
      title: 'Track Filter Test',
      timeline,
      measures: [measure],
      instrumentTracks: [altoSaxTrack, bassTrack],
    });

    // Proyección de eventos para Saxo Alto (debe recibir solo notas de Voz 1)
    const saxEvents = payload.getTrackEvents('track_sax');
    assert.strictEqual(saxEvents.length, 1);
    assert.strictEqual(saxEvents[0]?.notes.length, 1);
    assert.strictEqual(saxEvents[0]?.notes[0]?.id, 'note_sax_1');

    // Proyección de eventos para Bajo (debe recibir solo notas de Voz 2)
    const bassEvents = payload.getTrackEvents('track_bass');
    assert.strictEqual(bassEvents.length, 1);
    assert.strictEqual(bassEvents[0]?.notes.length, 1);
    assert.strictEqual(bassEvents[0]?.notes[0]?.id, 'note_bass_1');

    // Invariante de Dominio: InstrumentTrack NO almacena colecciones de notas en sus propiedades
    assert.strictEqual('notes' in altoSaxTrack, false);
    assert.strictEqual('events' in altoSaxTrack, false);
  });
});
