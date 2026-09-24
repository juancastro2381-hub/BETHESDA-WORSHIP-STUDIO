/**
 * @file validator.test.ts
 * @description Pruebas unitarias para el motor de validación CanonicalModelValidator,
 * comprobando la aceptación de grafos válidos y la detección rigurosa de corrupciones del dominio.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { CanonicalMusicPayload } from '../canonical-music-payload.ts';
import { KeySignatureReference } from '../key-signature-reference.ts';
import { LyricSyllable } from '../lyric-syllable.ts';
import { Measure } from '../measure.ts';
import { Note, Voice } from '../musical-event.ts';
import { Section } from '../section.ts';
import { Timeline } from '../timeline.ts';
import { TimeSignature } from '../time-signature.ts';
import { CANONICAL_TPQN, DURATION_TICKS } from '../types.ts';
import { CanonicalModelValidator } from '../validator.ts';

describe('CanonicalModelValidator Domain Tests', () => {
  const cMajorKey = new KeySignatureReference(NoteName.C, 'MAJOR');

  it('should validate an empty valid CanonicalMusicPayload', () => {
    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      totalDurationTicks: 0,
      measureCount: 0,
    });

    const payload = new CanonicalMusicPayload({
      title: 'Empty Piece',
      timeline,
      measures: [],
      sections: [],
    });

    const result = CanonicalModelValidator.validate(payload);
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('should validate a healthy multi-measure payload', () => {
    const m1 = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
    });
    const m2 = new Measure({
      number: 2,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 1920,
    });

    const timeline = new Timeline({
      totalDurationTicks: 3840,
      measureCount: 2,
    });

    const payload = new CanonicalMusicPayload({
      title: 'Healthy Piece',
      timeline,
      measures: [m1, m2],
    });

    const result = CanonicalModelValidator.validate(payload);
    assert.strictEqual(result.isValid, true);
  });

  it('should detect measure numbering gaps (NON_SEQUENTIAL_MEASURE_NUMBER)', () => {
    const m1 = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
    });
    const m2 = new Measure({
      number: 3, // Salto de compás 1 a 3
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 1920,
    });

    const timeline = new Timeline({ totalDurationTicks: 3840, measureCount: 2 });
    const payload = new CanonicalMusicPayload({
      title: 'Broken Measure Numbers',
      timeline,
      measures: [m1, m2],
    });

    const result = CanonicalModelValidator.validate(payload);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.code === 'NON_SEQUENTIAL_MEASURE_NUMBER'));
  });

  it('should detect tick discontinuity between measures (MEASURE_TICK_DISCONTINUITY)', () => {
    const m1 = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
    });
    const m2 = new Measure({
      number: 2,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 2000, // Debería ser 1920
    });

    const timeline = new Timeline({ totalDurationTicks: 3920, measureCount: 2 });
    const payload = new CanonicalMusicPayload({
      title: 'Discontinuous Ticks',
      timeline,
      measures: [m1, m2],
    });

    const result = CanonicalModelValidator.validate(payload);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.code === 'MEASURE_TICK_DISCONTINUITY'));
  });

  it('should detect duplicate event IDs (DUPLICATE_EVENT_ID)', () => {
    const note1 = new Note({
      id: 'dup_id',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
    });
    const note2 = new Note({
      id: 'dup_id', // ID idéntico
      pitch: new Pitch(NoteName.E, 4),
      startTick: DURATION_TICKS.QUARTER,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
    });

    const m = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
      voices: [new Voice(1, [note1, note2])],
    });

    const timeline = new Timeline({ totalDurationTicks: 1920, measureCount: 1 });
    const payload = new CanonicalMusicPayload({
      title: 'Duplicate Event ID',
      timeline,
      measures: [m],
    });

    const result = CanonicalModelValidator.validate(payload);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.code === 'DUPLICATE_EVENT_ID'));
  });

  it('should detect broken lyric note bindings (BROKEN_LYRIC_NOTE_BINDING)', () => {
    const syl = new LyricSyllable({
      id: 'syl_1',
      text: 'Paz',
      boundNoteId: 'ghost_note_that_does_not_exist',
      measureNumber: 1,
      tickOffset: 0,
      sequenceNumber: 1,
    });

    const m = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
      lyrics: [syl],
    });

    const timeline = new Timeline({ totalDurationTicks: 1920, measureCount: 1 });
    const payload = new CanonicalMusicPayload({
      title: 'Broken Lyric Binding',
      timeline,
      measures: [m],
    });

    const result = CanonicalModelValidator.validate(payload);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.code === 'BROKEN_LYRIC_NOTE_BINDING'));
  });

  it('should detect section measure ranges out of bounds (SECTION_MEASURE_OUT_OF_RANGE)', () => {
    const m1 = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
    });

    const sec = new Section({
      id: 'sec_out',
      type: 'VERSE',
      label: 'Verse 1',
      startMeasure: 1,
      measureCount: 5, // Abarca hasta compás 5 pero la pieza solo tiene 1 compás
      startTick: 0,
      durationTicks: 1920 * 5,
    });

    const timeline = new Timeline({ totalDurationTicks: 1920, measureCount: 1 });
    const payload = new CanonicalMusicPayload({
      title: 'Section Range Out of Bounds',
      timeline,
      sections: [sec],
      measures: [m1],
    });

    const result = CanonicalModelValidator.validate(payload);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.code === 'SECTION_MEASURE_OUT_OF_RANGE'));
  });
});
