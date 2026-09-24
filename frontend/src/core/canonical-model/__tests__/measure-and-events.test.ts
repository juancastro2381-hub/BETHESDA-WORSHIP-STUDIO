/**
 * @file measure-and-events.test.ts
 * @description Pruebas unitarias para Measure, Note, Rest, Voice y métricas variables.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { KeySignatureReference } from '../key-signature-reference.ts';
import { Measure } from '../measure.ts';
import { Note, Rest, Voice } from '../musical-event.ts';
import { TimeSignature } from '../time-signature.ts';
import { DURATION_TICKS } from '../types.ts';

describe('Measure, Note, Rest & Voice Engine Tests', () => {
  const cMajorKey = new KeySignatureReference(NoteName.C, 'MAJOR');

  it('should instantiate a single valid 4/4 measure with notes and rests', () => {
    const note1 = new Note({
      id: 'n_1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
      staff: 1,
      velocity: 85,
      dynamic: 'mf',
      articulations: ['accent'],
      tie: 'NONE',
    });

    const rest1 = new Rest({
      id: 'r_1',
      startTick: DURATION_TICKS.QUARTER,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
      staff: 1,
    });

    const note2 = new Note({
      id: 'n_2',
      pitch: new Pitch(NoteName.E, 4),
      startTick: DURATION_TICKS.HALF,
      durationTicks: DURATION_TICKS.HALF,
      voice: 1,
      staff: 1,
      velocity: 90,
      dynamic: 'f',
      tie: 'START',
    });

    const voice = new Voice(1, [note1, rest1, note2]);
    assert.strictEqual(voice.getNotes().length, 2);
    assert.strictEqual(voice.getRests().length, 1);
    assert.strictEqual(voice.calculateTotalDurationTicks(), 1920);

    const measure = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
      voices: [voice],
    });

    assert.strictEqual(measure.number, 1);
    assert.strictEqual(measure.startTick, 0);
    assert.strictEqual(measure.durationTicks, 1920);
    assert.strictEqual(measure.endTick, 1920);
    assert.strictEqual(measure.containsTick(500), true);
    assert.strictEqual(measure.containsTick(1920), false);
  });

  it('should handle multiple polyphonic voices within the same measure', () => {
    // Voz 1: Melodía de blanca (C5) + blanca (D5)
    const v1Notes = [
      new Note({
        id: 'sop_1',
        pitch: new Pitch(NoteName.C, 5),
        startTick: 0,
        durationTicks: DURATION_TICKS.HALF,
        voice: 1,
      }),
      new Note({
        id: 'sop_2',
        pitch: new Pitch(NoteName.D, 5),
        startTick: DURATION_TICKS.HALF,
        durationTicks: DURATION_TICKS.HALF,
        voice: 1,
      }),
    ];

    // Voz 2: Bajo de redonda (C3)
    const v2Notes = [
      new Note({
        id: 'bass_1',
        pitch: new Pitch(NoteName.C, 3),
        startTick: 0,
        durationTicks: DURATION_TICKS.WHOLE,
        voice: 2,
        staff: 2,
      }),
    ];

    const voice1 = new Voice(1, v1Notes);
    const voice2 = new Voice(2, v2Notes);

    const measure = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
      voices: [voice1, voice2],
    });

    assert.strictEqual(measure.voices.length, 2);
    assert.strictEqual(measure.getVoice(1)?.getNotes().length, 2);
    assert.strictEqual(measure.getVoice(2)?.getNotes().length, 1);
    assert.strictEqual(measure.getAllNotes().length, 3);
  });

  it('should support variable meters across multiple measures (4/4 -> 3/4 -> 6/8)', () => {
    // Compás 1: 4/4 (0 a 1920)
    const m1 = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
    });
    assert.strictEqual(m1.durationTicks, 1920);
    assert.strictEqual(m1.endTick, 1920);

    // Compás 2: 3/4 (1920 a 1920 + 1440 = 3360)
    const m2 = new Measure({
      number: 2,
      timeSignature: TimeSignature.THREE_FOUR,
      keySignature: cMajorKey,
      startTick: m1.endTick,
    });
    assert.strictEqual(m2.durationTicks, 1440);
    assert.strictEqual(m2.startTick, 1920);
    assert.strictEqual(m2.endTick, 3360);

    // Compás 3: 6/8 (3360 a 3360 + 1440 = 4800)
    const m3 = new Measure({
      number: 3,
      timeSignature: TimeSignature.SIX_EIGHT,
      keySignature: cMajorKey,
      startTick: m2.endTick,
    });
    assert.strictEqual(m3.durationTicks, 1440);
    assert.strictEqual(m3.startTick, 3360);
    assert.strictEqual(m3.endTick, 4800);
  });

  it('should enforce voice ID consistency between Voice container and MusicalEvents', () => {
    const wrongVoiceEvent = new Note({
      id: 'err_note',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 2, // Declarada en voz 2
    });

    // Asignar evento de voz 2 en contenedor de voz 1 debe lanzar error
    assert.throws(
      () => new Voice(1, [wrongVoiceEvent]),
      /Inconsistencia en voz 1: el evento err_note declara pertenecer a la voz 2/
    );
  });
});
