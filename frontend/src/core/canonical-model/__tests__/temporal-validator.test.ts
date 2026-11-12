/**
 * @file temporal-validator.test.ts
 * @description Batería de pruebas exhaustiva para TemporalValidator y MidiExportGatekeeper (Fase 2B.2).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { CanonicalMusicPayload } from '../canonical-music-payload.ts';
import { Measure } from '../measure.ts';
import { Note, Rest, Voice } from '../musical-event.ts';
import { TimeSignature } from '../time-signature.ts';
import { Timeline } from '../timeline.ts';
import { TemporalValidator } from '../temporal-validator.ts';
import { MidiExportGatekeeper } from '../midi-export-gatekeeper.ts';

function createBasePayload(measures: Measure[], metadata?: Record<string, unknown>): CanonicalMusicPayload {
  const hasTiming = measures.length > 0 && measures[0]?.durationTicks !== null;
  const totalDuration = hasTiming ? measures.reduce((acc, m) => acc + (m.durationTicks ?? 0), 0) : null;
  return new CanonicalMusicPayload({
    title: 'Test Temporal Score',
    timeline: new Timeline({
      tpqn: 480,
      totalDurationTicks: totalDuration,
      measureCount: measures.length,
    }),
    measures,
    metadata,
  });
}

describe('Phase 2B.2 — TemporalValidator & MidiExportGatekeeper Suite', () => {
  const time44 = new TimeSignature(4, 4); // 1920 ticks

  it('1. should validate a perfectly timed measure with no gaps or collisions', () => {
    const note1 = new Note({
      id: 'n1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 960,
      voice: 1,
    });
    const note2 = new Note({
      id: 'n2',
      pitch: new Pitch(NoteName.D, 4),
      startTick: 960,
      durationTicks: 960,
      voice: 1,
    });

    const measure = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [note1, note2])],
    });

    const payload = createBasePayload([measure]);
    const result = TemporalValidator.validate(payload);

    assert.equal(result.isValid, true);
    assert.equal(result.issues.length, 0);
    assert.equal(result.isUnmeasured, false);

    const gate = MidiExportGatekeeper.isEligible(payload);
    assert.equal(gate.eligible, true);
  });

  it('2. should detect event ordering violation when note starts before previous note', () => {
    const note1 = new Note({
      id: 'n1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 480,
      durationTicks: 480,
      voice: 1,
    });
    // Note 2 starts at 240, violating chronological order in voice
    const note2 = new Note({
      id: 'n2',
      pitch: new Pitch(NoteName.D, 4),
      startTick: 240,
      durationTicks: 480,
      voice: 1,
    });

    // Voice constructor automatically sorts by startTick, so let's bypass by creating an unsorted structure
    const voice = new Voice(1, [note1, note2]);
    // Force unsorted events for testing validator robustness
    (voice as any).events = [note1, note2];

    const measure = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [voice],
    });

    const payload = createBasePayload([measure]);
    const result = TemporalValidator.validate(payload);

    assert.equal(result.isValid, false);
    const orderingIssue = result.issues.find((i) => i.code === 'EVENT_ORDERING_VIOLATION');
    assert.ok(orderingIssue, 'Debe registrar EVENT_ORDERING_VIOLATION');
  });

  it('3. should detect internal voice gap when silence exists without explicit Rest', () => {
    const note1 = new Note({
      id: 'n1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 480,
      voice: 1,
    });
    // Gap between 480 and 960 without explicit Rest
    const note2 = new Note({
      id: 'n2',
      pitch: new Pitch(NoteName.D, 4),
      startTick: 960,
      durationTicks: 960,
      voice: 1,
    });

    const measure = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [note1, note2])],
    });

    const payload = createBasePayload([measure]);
    const result = TemporalValidator.validate(payload, { allowGapsAsImplicitRests: false });

    assert.equal(result.isValid, false);
    const gapIssue = result.issues.find((i) => i.code === 'TEMPORAL_VOICE_GAP');
    assert.ok(gapIssue, 'Debe registrar TEMPORAL_VOICE_GAP');
    assert.equal(gapIssue?.context?.gapStart, 480);
    assert.equal(gapIssue?.context?.gapEnd, 960);
  });

  it('4. should detect trailing measure gap when voice ends before measure boundary', () => {
    const note1 = new Note({
      id: 'n1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 960, // ends at 960, measure ends at 1920
      voice: 1,
    });

    const measure = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [note1])],
    });

    const payload = createBasePayload([measure]);
    const result = TemporalValidator.validate(payload, { allowGapsAsImplicitRests: false });

    assert.equal(result.isValid, false);
    const trailingIssue = result.issues.find((i) => i.code === 'TRAILING_MEASURE_GAP');
    assert.ok(trailingIssue, 'Debe registrar TRAILING_MEASURE_GAP');
    assert.equal(trailingIssue?.context?.gapStart, 960);
    assert.equal(trailingIssue?.context?.measureEnd, 1920);
  });

  it('5. should detect same-voice collision when unclustered notes overlap', () => {
    const note1 = new Note({
      id: 'n1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 960, // active 0..960
      voice: 1,
    });
    const note2 = new Note({
      id: 'n2',
      pitch: new Pitch(NoteName.E, 4),
      startTick: 480, // starts at 480, overlaps note 1 without chordId
      durationTicks: 480,
      voice: 1,
    });

    const measure = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [note1, note2])],
    });

    const payload = createBasePayload([measure]);
    const result = TemporalValidator.validate(payload);

    assert.equal(result.isValid, false);
    const collisionIssue = result.issues.find((i) => i.code === 'SAME_VOICE_NOTE_COLLISION');
    assert.ok(collisionIssue, 'Debe registrar SAME_VOICE_NOTE_COLLISION');
  });

  it('6. should allow simultaneous notes in the same voice when clustered with matching chordId', () => {
    const note1 = new Note({
      id: 'n1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 960,
      voice: 1,
      notationMetadata: { chordId: 'chord_c_maj' },
    });
    const note2 = new Note({
      id: 'n2',
      pitch: new Pitch(NoteName.E, 4),
      startTick: 0, // exactly simultaneous
      durationTicks: 960,
      voice: 1,
      notationMetadata: { chordId: 'chord_c_maj' },
    });
    const rest = new Rest({
      id: 'r1',
      startTick: 960,
      durationTicks: 960,
      voice: 1,
    });

    const measure = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [note1, note2, rest])],
    });

    const payload = createBasePayload([measure]);
    const result = TemporalValidator.validate(payload);

    assert.equal(result.isValid, true, 'Acorde simultáneo agrupado con chordId debe ser válido');
    assert.equal(result.issues.length, 0);
  });

  it('7. should validate pickup measure (anacrusis) duration and reject invalid pickup on measure > 1', () => {
    // Valid pickup on measure 1: 1 beat (480 ticks) in 4/4 (nominal 1920 ticks)
    const notePickup = new Note({
      id: 'p1',
      pitch: new Pitch(NoteName.G, 4),
      startTick: 0,
      durationTicks: 480,
      voice: 1,
    });
    const m1Pickup = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 480,
      voices: [new Voice(1, [notePickup])],
    });
    (m1Pickup as any).isPickup = true;

    const payloadValid = createBasePayload([m1Pickup]);
    const resValid = TemporalValidator.validate(payloadValid);
    assert.equal(resValid.isValid, true, 'Anacrusa válida en compás 1 debe pasar');

    // Invalid pickup flag on measure 2
    const m2Pickup = new Measure({
      number: 2,
      timeSignature: time44,
      startTick: 480,
      durationTicks: 480,
      voices: [new Voice(1, [notePickup])],
    });
    (m2Pickup as any).isPickup = true;

    const payloadInvalid = createBasePayload([m2Pickup]);
    const resInvalid = TemporalValidator.validate(payloadInvalid);
    assert.equal(resInvalid.isValid, false);
    const pickupIssue = resInvalid.issues.find((i) => i.code === 'INVALID_PICKUP_DURATION');
    assert.ok(pickupIssue, 'Debe registrar INVALID_PICKUP_DURATION en compás 2');
  });

  it('8. should validate tie chains and detect temporal discontinuity and dangling ties', () => {
    const noteStart = new Note({
      id: 't1',
      pitch: new Pitch(NoteName.A, 4),
      startTick: 0,
      durationTicks: 960,
      voice: 1,
      tie: 'START',
    });
    // Discontinuous tie: noteStop starts at 1440 instead of 960
    const noteStop = new Note({
      id: 't2',
      pitch: new Pitch(NoteName.A, 4),
      startTick: 1440,
      durationTicks: 480,
      voice: 1,
      tie: 'STOP',
    });

    const m = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [noteStart, noteStop])],
    });

    const payload = createBasePayload([m]);
    const result = TemporalValidator.validate(payload, { allowGapsAsImplicitRests: true });

    assert.equal(result.isValid, false);
    const tieDiscontinuity = result.issues.find((i) => i.code === 'TIE_TEMPORAL_DISCONTINUITY');
    assert.ok(tieDiscontinuity, 'Debe registrar TIE_TEMPORAL_DISCONTINUITY');
  });

  it('9. should detect dangling tie START that is never closed', () => {
    const noteStart = new Note({
      id: 't1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 1920,
      voice: 1,
      tie: 'START',
    });

    const m = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [noteStart])],
    });

    const payload = createBasePayload([m]);
    const result = TemporalValidator.validate(payload);

    assert.equal(result.isValid, false);
    const danglingIssue = result.issues.find((i) => i.code === 'BROKEN_TIE_CHAIN');
    assert.ok(danglingIssue, 'Debe registrar BROKEN_TIE_CHAIN para ligadura colgante');
  });

  it('10. should validate tuplet group completeness and duration span', () => {
    // Declared quarter-note triplet: 3 actual notes in the time of 2 (nominalSpan: 960 ticks, 320 ticks each)
    const tupletDecl = {
      groupId: 'trip_1',
      actualNotes: 3,
      normalNotes: 2,
      baseNoteDurationTicks: 480,
      nominalSpanTicks: 960,
    };

    const n1 = new Note({
      id: 't1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 320,
      voice: 1,
      notationMetadata: { tupletGroup: tupletDecl },
    });
    const n2 = new Note({
      id: 't2',
      pitch: new Pitch(NoteName.D, 4),
      startTick: 320,
      durationTicks: 320,
      voice: 1,
      notationMetadata: { tupletGroup: tupletDecl },
    });
    // Missing third note: only 2 notes provided
    const rest = new Rest({
      id: 'r1',
      startTick: 640,
      durationTicks: 1280,
      voice: 1,
    });

    const m = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [n1, n2, rest])],
    });

    const payload = createBasePayload([m]);
    const result = TemporalValidator.validate(payload);

    assert.equal(result.isValid, false);
    const tupletIssue = result.issues.find((i) => i.code === 'INCOMPLETE_TUPLET_GROUP');
    assert.ok(tupletIssue, 'Debe registrar INCOMPLETE_TUPLET_GROUP');
  });

  it('11. should handle unmeasured score gracefully without false temporal rejections', () => {
    const unmeasuredNote1 = new Note({
      id: 'tab_n1',
      pitch: new Pitch(NoteName.E, 2),
      startTick: null,
      durationTicks: null,
      voice: 1,
    });
    const unmeasuredNote2 = new Note({
      id: 'tab_n2',
      pitch: new Pitch(NoteName.A, 2),
      startTick: null,
      durationTicks: null,
      voice: 1,
    });

    const m = new Measure({
      number: 1,
      timeSignature: null,
      startTick: null,
      durationTicks: null,
      voices: [new Voice(1, [unmeasuredNote1, unmeasuredNote2])],
    });

    const payload = createBasePayload([m], { rhythmicProvenance: 'NONE' });
    const result = TemporalValidator.validate(payload);

    assert.equal(result.isValid, true, 'Tablatura no medida debe ser estructuralmente válida');
    assert.equal(result.isUnmeasured, true, 'Debe marcarse como isUnmeasured');
    assert.equal(result.issues.length, 0);

    // Fail-Closed: MIDI Export MUST be blocked
    const gate = MidiExportGatekeeper.isEligible(payload);
    assert.equal(gate.eligible, false, 'Score no medido no es elegible para MIDI');
    assert.match(gate.reason || '', /unmeasured|rhythmicProvenance NONE/i);
  });

  // --------------------------------------------------------------------------
  // 12. DEFECTO D: CLASIFICACIÓN EN 5 DIMENSIONES INDEPENDIENTES (SCORE MEDIDO VÁLIDO)
  // --------------------------------------------------------------------------
  it('12. should separate 5 validation dimensions for a fully measured valid score', () => {
    const note1 = new Note({
      id: 'n1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 960,
      voice: 1,
      notationMetadata: { tablature: { stringNumber: 2, fret: 1 } },
    });
    const note2 = new Note({
      id: 'n2',
      pitch: new Pitch(NoteName.D, 4),
      startTick: 960,
      durationTicks: 960,
      voice: 1,
      notationMetadata: { tablature: { stringNumber: 3, fret: 7 } },
    });

    const m = new Measure({
      number: 1,
      timeSignature: time44,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [note1, note2])],
    });

    const payload = createBasePayload([m], { rhythmicProvenance: 'EXPLICIT_HEADER' });
    const res = TemporalValidator.validate(payload);

    assert.strictEqual(res.isStructurallyValid, true, '1. Structural validity debe ser true');
    assert.strictEqual(res.isInstrumentValid, true, '2. Instrument validity debe ser true');
    assert.strictEqual(res.isTemporallyComplete, true, '3. Temporal completeness debe ser true');
    assert.strictEqual(res.isTemporallyValid, true, '4. Temporal validity debe ser true');
    assert.strictEqual(res.isMidiEligible, true, '5. MIDI export eligibility debe ser true');
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.isUnmeasured, false);
    assert.strictEqual(res.isPartiallyMeasured, false);

    const gate = MidiExportGatekeeper.isEligible(payload);
    assert.strictEqual(gate.eligible, true);
  });

  // --------------------------------------------------------------------------
  // 13. DEFECTO D: 5 DIMENSIONES EN SCORE NO MEDIDO (VÁLIDO PERO TEMPORALMENTE INCOMPLETO)
  // --------------------------------------------------------------------------
  it('13. should demonstrate structural validity without temporal completeness on unmeasured score', () => {
    const n1 = new Note({
      id: 'un_1',
      pitch: new Pitch(NoteName.E, 2),
      startTick: null,
      durationTicks: null,
      voice: 1,
      notationMetadata: { tablature: { stringNumber: 6, fret: 0 } },
    });
    const m = new Measure({
      number: 1,
      timeSignature: null,
      startTick: null,
      durationTicks: null,
      voices: [new Voice(1, [n1])],
    });

    const payload = createBasePayload([m], { rhythmicProvenance: 'NONE' });
    const res = TemporalValidator.validate(payload);

    assert.strictEqual(res.isStructurallyValid, true, '1. Estructuralmente válido');
    assert.strictEqual(res.isInstrumentValid, true, '2. Afinación válida');
    assert.strictEqual(res.isTemporallyComplete, false, '3. No es temporalmente completo');
    assert.strictEqual(res.isTemporallyValid, true, '4. Temporalmente válido (sin colisiones ni desórdenes)');
    assert.strictEqual(res.isMidiEligible, false, '5. MIDI strictly ineligible');
    assert.strictEqual(res.isValid, true, 'Documento es válido en el modelo');
    assert.strictEqual(res.isUnmeasured, true);
    assert.strictEqual(res.isPartiallyMeasured, false);

    const gate = MidiExportGatekeeper.isEligible(payload);
    assert.strictEqual(gate.eligible, false);
    assert.strictEqual(gate.code, 'BLOCKED_ZERO_FABRICATION');
  });

  // --------------------------------------------------------------------------
  // 14. DEFECTO D & A: TABLATURA PARCIALMENTE MEDIDA SIN COLISIONES
  // --------------------------------------------------------------------------
  it('14. should validate known timing in partially measured score without false gaps and block MIDI', () => {
    // Compás 1: con timing explícito
    const timedNote = new Note({
      id: 'timed_1',
      pitch: new Pitch(NoteName.G, 3),
      startTick: 0,
      durationTicks: 480,
      voice: 1,
    });
    const m1 = new Measure({
      number: 1,
      timeSignature: null,
      startTick: 0,
      durationTicks: 480,
      voices: [new Voice(1, [timedNote])],
    });

    // Compás 2: sin timing explícito (null)
    const untimedNote = new Note({
      id: 'untimed_1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: null,
      durationTicks: null,
      voice: 1,
    });
    const m2 = new Measure({
      number: 2,
      timeSignature: null,
      startTick: null,
      durationTicks: null,
      voices: [new Voice(1, [untimedNote])],
    });

    const payload = createBasePayload([m1, m2], { rhythmicProvenance: 'PARTIALLY_MEASURED' });
    const res = TemporalValidator.validate(payload);

    assert.strictEqual(res.isStructurallyValid, true);
    assert.strictEqual(res.isInstrumentValid, true);
    assert.strictEqual(res.isTemporallyComplete, false, 'Completitud temporal debe ser false al tener notas nulas');
    assert.strictEqual(res.isTemporallyValid, true, 'Timing conocido no tiene colisiones');
    assert.strictEqual(res.isMidiEligible, false, 'MIDI bloqueado por Cero Fabricación');
    assert.strictEqual(res.isPartiallyMeasured, true);
    assert.strictEqual(res.isValid, true);

    const gate = MidiExportGatekeeper.isEligible(payload);
    assert.strictEqual(gate.eligible, false);
    assert.strictEqual(gate.code, 'BLOCKED_ZERO_FABRICATION');
  });

  // --------------------------------------------------------------------------
  // 15. DEFECTO D & A: TABLATURA PARCIALMENTE MEDIDA CON COLISIÓN EN NOTAS MEDIDAS
  // --------------------------------------------------------------------------
  it('15. should NOT bypass validation of known timing in partially measured score when collisions exist', () => {
    // Compás 1: notas medidas con colisión en la misma voz
    const n1 = new Note({
      id: 'coll_1',
      pitch: new Pitch(NoteName.C, 4),
      startTick: 0,
      durationTicks: 480, // termina en 480
      voice: 1,
    });
    const n2 = new Note({
      id: 'coll_2',
      pitch: new Pitch(NoteName.E, 4),
      startTick: 240, // inicia en 240 (superposición sin chordId)
      durationTicks: 480,
      voice: 1,
    });
    const m1 = new Measure({
      number: 1,
      timeSignature: null,
      startTick: 0,
      durationTicks: 720,
      voices: [new Voice(1, [n1, n2])],
    });

    // Compás 2: nota no medida
    const nUntimed = new Note({
      id: 'un_2',
      pitch: new Pitch(NoteName.G, 4),
      startTick: null,
      durationTicks: null,
      voice: 1,
    });
    const m2 = new Measure({
      number: 2,
      timeSignature: null,
      startTick: null,
      durationTicks: null,
      voices: [new Voice(1, [nUntimed])],
    });

    const payload = createBasePayload([m1, m2], { rhythmicProvenance: 'PARTIALLY_MEASURED' });
    const res = TemporalValidator.validate(payload);

    assert.strictEqual(res.isStructurallyValid, true);
    assert.strictEqual(res.isTemporallyComplete, false);
    // Debe detectar la colisión de timing conocido
    assert.strictEqual(res.isTemporallyValid, false, 'Debe fallar isTemporallyValid por colisión de notas');
    assert.strictEqual(res.isValid, false);
    assert.ok(res.issues.some((i) => i.code === 'SAME_VOICE_NOTE_COLLISION'));

    const gate = MidiExportGatekeeper.isEligible(payload);
    assert.strictEqual(gate.eligible, false);
  });
});
