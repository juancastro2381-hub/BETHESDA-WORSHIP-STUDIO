/**
 * @file time-signature-and-tempo.test.ts
 * @description Pruebas unitarias para TimeSignature, TempoMap y conversiones temporales a 480 TPQN.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { TempoEvent, TempoMap } from '../tempo-map.ts';
import { TimeSignature } from '../time-signature.ts';
import { CANONICAL_TPQN } from '../types.ts';

describe('TimeSignature & TempoMap Engine Tests (480 TPQN)', () => {
  it('should enforce 480 TPQN canonical resolution', () => {
    assert.strictEqual(CANONICAL_TPQN, 480);
  });

  it('should calculate exact measure duration in ticks for simple meters (4/4, 3/4, 2/4, 5/4)', () => {
    // 4/4: 4 * 480 = 1920 ticks
    assert.strictEqual(TimeSignature.FOUR_FOUR.calculateMeasureDurationTicks(), 1920);
    assert.strictEqual(TimeSignature.FOUR_FOUR.beatDurationTicks, 480);
    assert.strictEqual(TimeSignature.FOUR_FOUR.isCompound, false);

    // 3/4: 3 * 480 = 1440 ticks
    assert.strictEqual(TimeSignature.THREE_FOUR.calculateMeasureDurationTicks(), 1440);
    assert.strictEqual(TimeSignature.THREE_FOUR.beatDurationTicks, 480);

    // 2/4: 2 * 480 = 960 ticks
    assert.strictEqual(TimeSignature.TWO_FOUR.calculateMeasureDurationTicks(), 960);

    // 5/4: 5 * 480 = 2400 ticks
    assert.strictEqual(TimeSignature.FIVE_FOUR.calculateMeasureDurationTicks(), 2400);
  });

  it('should correctly calculate compound meters (6/8, 9/8, 12/8)', () => {
    // 6/8: 6 corcheas = 6 * 240 = 1440 ticks
    assert.strictEqual(TimeSignature.SIX_EIGHT.calculateMeasureDurationTicks(), 1440);
    assert.strictEqual(TimeSignature.SIX_EIGHT.isCompound, true);
    // Pulso compuesto = negra con puntillo = 720 ticks
    assert.strictEqual(TimeSignature.SIX_EIGHT.beatDurationTicks, 720);
    assert.strictEqual(TimeSignature.SIX_EIGHT.primaryBeatsPerMeasure, 2);

    // 9/8: 9 * 240 = 2160 ticks, 3 pulsos compuestos
    assert.strictEqual(TimeSignature.NINE_EIGHT.calculateMeasureDurationTicks(), 2160);
    assert.strictEqual(TimeSignature.NINE_EIGHT.primaryBeatsPerMeasure, 3);

    // 12/8: 12 * 240 = 2880 ticks, 4 pulsos compuestos
    assert.strictEqual(TimeSignature.TWELVE_EIGHT.calculateMeasureDurationTicks(), 2880);
    assert.strictEqual(TimeSignature.TWELVE_EIGHT.primaryBeatsPerMeasure, 4);
  });

  it('should reject invalid numerators or denominators', () => {
    assert.throws(() => new TimeSignature(0, 4), /Numerador de compás inválido/);
    assert.throws(() => new TimeSignature(-3, 4), /Numerador de compás inválido/);
    assert.throws(() => new TimeSignature(4, 5), /Denominador de compás inválido/);
  });

  it('should parse time signatures from text strings', () => {
    const ts = TimeSignature.parse('6/8');
    assert.strictEqual(ts.numerator, 6);
    assert.strictEqual(ts.denominator, 8);
    assert.strictEqual(ts.toString(), '6/8');
  });

  it('should calculate tick to seconds and seconds to tick accurately with constant tempo', () => {
    // 120 BPM a 480 TPQN:
    // 1 negra = 480 ticks = 0.5 segundos (120 negras por minuto)
    const map = TempoMap.constant(120);

    assert.strictEqual(map.getTempoAtTick(0), 120);
    assert.strictEqual(map.getTempoAtTick(1920), 120);

    // 480 ticks = 0.5 s
    assert.strictEqual(map.tickToSeconds(480), 0.5);

    // 1920 ticks (1 compás de 4/4) = 2.0 s
    assert.strictEqual(map.tickToSeconds(1920), 2.0);

    // Conversión inversa
    assert.strictEqual(map.secondsToTick(2.0), 1920);
    assert.strictEqual(map.secondsToTick(0.5), 480);
  });

  it('should integrate variable tempo changes across the timeline', () => {
    // Tick 0 a 1920: 60 BPM (1 negra = 480 ticks = 1.0 s -> compás 1 dura 4.0 s)
    // Tick 1920 en adelante: 120 BPM (1 negra = 480 ticks = 0.5 s -> compás 2 dura 2.0 s)
    const map = new TempoMap([new TempoEvent(0, 60), new TempoEvent(1920, 120)]);

    assert.strictEqual(map.getTempoAtTick(100), 60);
    assert.strictEqual(map.getTempoAtTick(1920), 120);
    assert.strictEqual(map.getTempoAtTick(3000), 120);

    // En tick 1920: transcurrieron exactamente 4.0 segundos
    assert.strictEqual(map.tickToSeconds(1920), 4.0);

    // En tick 3840 (1920 ticks a 120 BPM adicionales = 2.0 s): total = 6.0 s
    assert.strictEqual(map.tickToSeconds(3840), 6.0);

    // Conversión inversa
    assert.strictEqual(map.secondsToTick(4.0), 1920);
    assert.strictEqual(map.secondsToTick(6.0), 3840);
  });
});
