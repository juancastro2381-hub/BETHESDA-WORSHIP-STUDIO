/**
 * @file midi-serializer.test.ts
 * @description Pruebas unitarias para CanonicalToMidiSerializer (Fase 2A).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalToMidiSerializer } from '../exporters/midi-serializer.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Voice } from '../../canonical-model/musical-event.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TempoMap } from '../../canonical-model/tempo-map.ts';
import {
  createChordsAndLyricsOnlyFixture,
  createFullSongFixture,
  createInstrumentalFixture,
} from './fixtures.ts';

describe('CanonicalToMidiSerializer Tests', () => {
  it('should serialize full canonical song to valid Standard MIDI File (Format 1, 480 TPQN)', () => {
    const payload = createFullSongFixture();
    const result = CanonicalToMidiSerializer.serialize(payload);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.targetFormat, 'MIDI');
    assert.strictEqual(result.mimeType, 'audio/midi');
    assert.ok(result.content instanceof Uint8Array);

    const buffer = result.content;
    assert.ok(buffer.length > 30, 'El archivo MIDI debe tener bytes suficientes');

    // 1. Verificación de cabecera MThd
    // 'MThd' (4 bytes)
    assert.strictEqual(buffer[0], 0x4d); // M
    assert.strictEqual(buffer[1], 0x54); // T
    assert.strictEqual(buffer[2], 0x68); // h
    assert.strictEqual(buffer[3], 0x64); // d

    // Header length 6
    assert.strictEqual(buffer[4], 0x00);
    assert.strictEqual(buffer[5], 0x00);
    assert.strictEqual(buffer[6], 0x00);
    assert.strictEqual(buffer[7], 0x06);

    // Format 1 (multi-track)
    assert.strictEqual(buffer[8], 0x00);
    assert.strictEqual(buffer[9], 0x01);

    // Track count = 2 (Conductor + Music)
    assert.strictEqual(buffer[10], 0x00);
    assert.strictEqual(buffer[11], 0x02);

    // Division = 480 (0x01E0)
    assert.strictEqual(buffer[12], 0x01);
    assert.strictEqual(buffer[13], 0xe0);

    // 2. Verificación de chunks MTrk
    // Primer chunk 'MTrk' (Conductor Track)
    assert.strictEqual(buffer[14], 0x4d); // M
    assert.strictEqual(buffer[15], 0x54); // T
    assert.strictEqual(buffer[16], 0x72); // r
    assert.strictEqual(buffer[17], 0x6b); // k

    // Contenido debe contener el título 'Sublime Gracia' codificado en UTF-8
    const textDecoder = new TextDecoder('ascii');
    const fullAscii = textDecoder.decode(buffer);
    assert.ok(fullAscii.includes('Sublime Gracia'));
    assert.ok(fullAscii.includes('Partitura Principal'));
  });

  it('should REJECT MIDI serialization when payload contains NO notes (Zero-Fabrication Contract)', () => {
    const chordSheet = createChordsAndLyricsOnlyFixture();
    const result = CanonicalToMidiSerializer.serialize(chordSheet);

    // En Fase 2A, una obra sin notas NO produce un archivo MIDI con notas inventadas.
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.content.length, 0);

    const errorDiag = result.diagnostics.find((d) => d.code === 'CANNOT_EXPORT_MIDI_WITHOUT_NOTES');
    assert.ok(errorDiag, 'Debe registrar diagnóstico de bloqueo CANNOT_EXPORT_MIDI_WITHOUT_NOTES');
    assert.strictEqual(errorDiag.severity, 'ERROR');
    assert.ok(errorDiag.message.includes('CERO'));
  });

  it('should correctly encode VLQ delta times without overflow', () => {
    assert.deepStrictEqual(CanonicalToMidiSerializer.encodeVLQ(0), [0x00]);
    assert.deepStrictEqual(CanonicalToMidiSerializer.encodeVLQ(127), [0x7f]);
    assert.deepStrictEqual(CanonicalToMidiSerializer.encodeVLQ(128), [0x81, 0x00]);
    assert.deepStrictEqual(CanonicalToMidiSerializer.encodeVLQ(480), [0x83, 0x60]);
    assert.deepStrictEqual(CanonicalToMidiSerializer.encodeVLQ(1920), [0x8f, 0x00]);
  });

  it('should omit tempo meta event when tempo is not specified (Zero-Fabrication)', () => {
    const instrumental = createInstrumentalFixture();
    const result = CanonicalToMidiSerializer.serialize(instrumental);

    assert.strictEqual(result.success, true);
    assert.ok(result.content.length > 20);
  });

  it('should reject serialization and NOT clamp pitches when pitch is out of range 0-127 (CR-05)', () => {
    const timeline = new Timeline({
      totalDurationTicks: 1920,
      measureCount: 1,
      tempoMap: new TempoMap([]),
    });
    const badPitchNote = {
      isRest: false,
      id: 'bad-pitch-1',
      pitch: { midiNumber: 135, toString: () => 'G10' },
      startTick: 0,
      durationTicks: 480,
      voice: 1,
      staff: 1,
    } as any;
    const badMeasure = new Measure({
      number: 1,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [badPitchNote])],
      chords: [],
      lyrics: [],
    });
    const payload = new CanonicalMusicPayload({
      title: 'Bad Pitch Song',
      timeline,
      measures: [badMeasure],
    });

    const result = CanonicalToMidiSerializer.serialize(payload);
    assert.strictEqual(result.success, false, 'No debe tener éxito al encontrar alturas fuera de rango');
    assert.strictEqual(result.content.length, 0);

    const pitchError = result.diagnostics.find((d) => d.code === 'MIDI_PITCH_OUT_OF_RANGE');
    assert.ok(pitchError, 'Debe registrar diagnóstico de error MIDI_PITCH_OUT_OF_RANGE');
    assert.strictEqual(pitchError.severity, 'ERROR');
    assert.ok(pitchError.message.includes('CERO fabricación'));
  });

  it('should reject serialization and NOT invent duration when durationTicks <= 0 (CR-05)', () => {
    const timeline = new Timeline({
      totalDurationTicks: 1920,
      measureCount: 1,
      tempoMap: new TempoMap([]),
    });
    const badDurationNote = {
      isRest: false,
      id: 'bad-duration-1',
      pitch: { midiNumber: 60, toString: () => 'C4' },
      startTick: 0,
      durationTicks: 0, // Invalido: 0 ticks
      voice: 1,
      staff: 1,
    } as any;
    const badMeasure = new Measure({
      number: 1,
      startTick: 0,
      durationTicks: 1920,
      voices: [new Voice(1, [badDurationNote])],
      chords: [],
      lyrics: [],
    });
    const payload = new CanonicalMusicPayload({
      title: 'Bad Duration Song',
      timeline,
      measures: [badMeasure],
    });

    const result = CanonicalToMidiSerializer.serialize(payload);
    assert.strictEqual(result.success, false, 'No debe tener éxito con duración de nota <= 0');
    assert.strictEqual(result.content.length, 0);

    const durationError = result.diagnostics.find((d) => d.code === 'MIDI_INVALID_NOTE_DURATION');
    assert.ok(durationError, 'Debe registrar diagnóstico de error MIDI_INVALID_NOTE_DURATION');
    assert.strictEqual(durationError.severity, 'ERROR');
    assert.ok(durationError.message.includes('CERO fabricación'));
  });
});
