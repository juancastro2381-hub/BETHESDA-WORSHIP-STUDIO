/**
 * @file midi-parser.ts
 * @description Parser determinista y seguro de Standard MIDI Files (SMF Formatos 0 y 1) en TypeScript puro.
 *
 * Características (Fase 1B-R):
 * 1. Validación estricta de cabecera 'MThd' y chunks de pista 'MTrk'.
 * 2. Decodificación segura de tiempos delta y longitudes VLQ (máximo 4 bytes / 28 bits) con protección contra overflow.
 * 3. Soporte estricto de Running Status: solo mensajes de canal voz (0x80..0xEF) actualizan el status; meta-eventos y SysEx lo resetean.
 * 4. Extracción de eventos de canal: Note-On, Note-Off, Note-On vel=0 como Note-Off, Program Change.
 * 5. CERO invención de duración de negra para notas sin Note-Off (se extienden al final de la pista y se registran como UNMATCHED_NOTE_ON).
 * 6. CERO umbral arbitrario de 15 ticks (se preserva la duración exacta >= 1 tick).
 * 7. Normalización matemática exacta a 480 TPQN (CANONICAL_TPQN) sin inversión de orden ni duraciones cero.
 * 8. Extracción completa de meta-eventos de tempo (0x51), métrica (0x58), armadura (0x59) y nombre de pista (0x03).
 * 9. Metadatos desconocidos se reportan estrictamente como null (sin falsos C, 4/4 o 120 BPM).
 */

import { ValidationError } from '../../../errors.ts';
import type { IngestionDiagnostic } from '../../types.ts';

export interface MidiParsedNote {
  pitch: number; // 0..127
  velocity: number; // 1..127
  channel: number; // 0..15
  startTickMidi: number;
  durationTicksMidi: number;
  startTickCanonical: number;
  durationTicksCanonical: number;
  unmatchedNoteOn?: boolean;
}

export interface MidiTempoEvent {
  tickMidi: number;
  tickCanonical: number;
  microsecondsPerQuarterNote: number;
  bpm: number;
}

export interface MidiTimeSignatureEvent {
  tickMidi: number;
  tickCanonical: number;
  numerator: number;
  denominator: number;
}

export interface MidiKeySignatureEvent {
  tickMidi: number;
  tickCanonical: number;
  sharpsFlats: number; // -7 (Cb/Abm) .. 7 (C#/A#m)
  isMinor: boolean;
  keyName: string;
}

export interface MidiParsedTrack {
  trackIndex: number;
  trackName: string;
  channel?: number;
  programNumber?: number; // 0..127 General MIDI
  notes: MidiParsedNote[];
  totalTicksMidi: number;
  totalTicksCanonical: number;
}

export interface MidiParsedData {
  format: number; // 0, 1, or 2
  trackCount: number;
  division: number; // Ticks Per Quarter Note (TPQN)
  tracks: MidiParsedTrack[];
  tempoEvents: MidiTempoEvent[];
  timeSignatures: MidiTimeSignatureEvent[];
  keySignatures: MidiKeySignatureEvent[];
  defaultBpm: number | null;
  defaultTimeSignature: { numerator: number; denominator: number } | null;
  defaultKey: string | null;
  totalDurationTicksCanonical: number;
  diagnostics: IngestionDiagnostic[];
}

const CANONICAL_TPQN = 480;

export class MidiParser {
  /**
   * Valida la firma binaria de archivo MIDI ('MThd').
   */
  public static isMidiFile(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 14) return false;
    return (
      buffer[0] === 0x4d && // M
      buffer[1] === 0x54 && // T
      buffer[2] === 0x68 && // h
      buffer[3] === 0x64 // d
    );
  }

  /**
   * Lee un valor de cantidad de longitud variable (VLQ) con protección estricta contra overflow.
   */
  private static readVlq(
    buffer: Buffer,
    startOffset: number,
    maxOffset: number
  ): { value: number; nextOffset: number } {
    let value = 0;
    let bytesRead = 0;
    let offset = startOffset;

    while (offset < maxOffset) {
      const b = buffer[offset++];
      bytesRead++;
      value = (value << 7) | (b & 0x7f);

      if (bytesRead > 4) {
        throw new ValidationError(
          `Secuencia VLQ MIDI malformada o inválida (excede el límite estándar de 4 bytes / 28 bits) en offset ${offset}.`
        );
      }

      if ((b & 0x80) === 0) {
        return { value, nextOffset: offset };
      }
    }

    throw new ValidationError(
      `Secuencia VLQ MIDI truncada antes de completarse en offset ${startOffset}.`
    );
  }

  /**
   * Parsea un buffer SMF completo hacia una estructura de datos estructurada y validada.
   */
  public static parse(buffer: Buffer): MidiParsedData {
    if (!this.isMidiFile(buffer)) {
      throw new ValidationError('Firma de archivo MIDI inválida: no comienza con la cabecera mágica "MThd".');
    }

    let offset = 0;
    const diagnostics: IngestionDiagnostic[] = [];

    // 1. Cabecera MThd
    const headerId = buffer.toString('ascii', offset, offset + 4);
    offset += 4;
    const headerLength = buffer.readUInt32BE(offset);
    offset += 4;

    if (headerId !== 'MThd' || headerLength < 6) {
      throw new ValidationError(`Cabecera MThd corrupta o longitud insuficiente (${headerLength} bytes).`);
    }

    const format = buffer.readUInt16BE(offset);
    offset += 2;
    const trackCount = buffer.readUInt16BE(offset);
    offset += 2;
    const division = buffer.readUInt16BE(offset);
    offset += 2;

    // Si headerLength > 6, saltar bytes extra de cabecera futura
    if (headerLength > 6) {
      offset += headerLength - 6;
    }

    if (division <= 0 || (division & 0x8000) !== 0) {
      throw new ValidationError(
        `División MIDI SMPTE o negativa no soportada (${division}). Se requieren ticks por negra (TPQN > 0).`
      );
    }

    const tracks: MidiParsedTrack[] = [];
    const tempoEvents: MidiTempoEvent[] = [];
    const timeSignatures: MidiTimeSignatureEvent[] = [];
    const keySignatures: MidiKeySignatureEvent[] = [];

    // Conversión matemática exacta a 480 TPQN
    const toCanonicalTicks = (midiTicks: number): number => {
      if (division === CANONICAL_TPQN) return midiTicks;
      return Math.round((midiTicks * CANONICAL_TPQN) / division);
    };

    // 2. Procesar cada Chunk MTrk
    for (let trackIdx = 0; trackIdx < trackCount && offset < buffer.length; trackIdx++) {
      if (offset + 8 > buffer.length) break;

      const chunkId = buffer.toString('ascii', offset, offset + 4);
      offset += 4;
      const chunkLength = buffer.readUInt32BE(offset);
      offset += 4;

      if (chunkId !== 'MTrk') {
        // Saltar chunks no reconocidos de forma segura
        offset += chunkLength;
        continue;
      }

      const trackEnd = Math.min(buffer.length, offset + chunkLength);
      let trackCurrentTick = 0;
      let lastStatusByte = 0;
      let trackName = `Pista ${trackIdx + 1}`;
      let detectedProgram: number | undefined;
      let detectedChannel: number | undefined;

      // Estructura para emparejar Note-On con Note-Off
      // key: channel_pitch -> array FIFO de { startTick, velocity }
      const activeNotes = new Map<string, Array<{ startTick: number; velocity: number }>>();
      const completedNotes: MidiParsedNote[] = [];

      while (offset < trackEnd) {
        // Leer delta-time VLQ con control de límites
        const deltaResult = this.readVlq(buffer, offset, trackEnd);
        const deltaTime = deltaResult.value;
        offset = deltaResult.nextOffset;

        trackCurrentTick += deltaTime;

        if (offset >= trackEnd) break;

        let statusByte = buffer[offset];

        if (statusByte >= 0x80) {
          offset++;
          // Solo mensajes de canal voz (0x80..0xEF) actualizan el running status
          if (statusByte < 0xf0) {
            lastStatusByte = statusByte;
          } else {
            // Meta-eventos (0xFF) y SysEx (0xF0, 0xF7) resetean running status
            lastStatusByte = 0;
          }
        } else {
          // Running status
          if (lastStatusByte === 0) {
            throw new ValidationError(`Running status MIDI inválido en offset ${offset}: no hay status previo.`);
          }
          statusByte = lastStatusByte;
        }

        // Meta Event (0xFF)
        if (statusByte === 0xff) {
          if (offset >= trackEnd) break;
          const metaType = buffer[offset++];
          
          const lenResult = this.readVlq(buffer, offset, trackEnd);
          let metaLength = lenResult.value;
          offset = lenResult.nextOffset;

          if (offset + metaLength > trackEnd) {
            metaLength = trackEnd - offset;
          }

          const metaData = buffer.subarray(offset, offset + metaLength);
          offset += metaLength;

          // 0x03: Track Name
          if (metaType === 0x03) {
            const rawName = metaData.toString('utf8').trim();
            if (rawName) trackName = rawName;
          }

          // 0x51: Set Tempo (3 bytes: microsegundos por negra)
          if (metaType === 0x51 && metaLength >= 3) {
            const mpqn = (metaData[0] << 16) | (metaData[1] << 8) | metaData[2];
            if (mpqn > 0) {
              const bpm = Math.round((60000000 / mpqn) * 10) / 10;
              tempoEvents.push({
                tickMidi: trackCurrentTick,
                tickCanonical: toCanonicalTicks(trackCurrentTick),
                microsecondsPerQuarterNote: mpqn,
                bpm,
              });
            }
          }

          // 0x58: Time Signature (num, denPower, clocks, 32nds)
          if (metaType === 0x58 && metaLength >= 2) {
            const num = metaData[0];
            const den = Math.pow(2, metaData[1]);
            timeSignatures.push({
              tickMidi: trackCurrentTick,
              tickCanonical: toCanonicalTicks(trackCurrentTick),
              numerator: num,
              denominator: den,
            });
          }

          // 0x59: Key Signature (sf: -7..7, mi: 0=major, 1=minor)
          if (metaType === 0x59 && metaLength >= 2) {
            const sf = metaData.readInt8(0);
            const isMinor = metaData[1] === 1;
            const keyName = MidiParser.keySignatureToString(sf, isMinor);
            keySignatures.push({
              tickMidi: trackCurrentTick,
              tickCanonical: toCanonicalTicks(trackCurrentTick),
              sharpsFlats: sf,
              isMinor,
              keyName,
            });
          }

          // 0x2F: End of Track
          if (metaType === 0x2f) {
            break;
          }
          continue;
        }

        // SysEx Events (0xF0 o 0xF7)
        if (statusByte === 0xf0 || statusByte === 0xf7) {
          const sysexLenResult = this.readVlq(buffer, offset, trackEnd);
          offset = sysexLenResult.nextOffset + sysexLenResult.value;
          continue;
        }

        // Channel Voice Events
        const messageType = statusByte & 0xf0;
        const channel = statusByte & 0x0f;
        if (detectedChannel === undefined) {
          detectedChannel = channel;
        }

        // Note Off (0x80) o Note On con velocity 0 (0x90)
        if (messageType === 0x80 || (messageType === 0x90 && offset + 1 < trackEnd && buffer[offset + 1] === 0)) {
          const pitch = buffer[offset++];
          const vel = buffer[offset++];
          const noteKey = `${channel}_${pitch}`;
          const queue = activeNotes.get(noteKey);

          if (queue && queue.length > 0) {
            const onEvent = queue.shift()!;
            const durationMidi = Math.max(1, trackCurrentTick - onEvent.startTick);
            const durationCanonical = Math.max(1, toCanonicalTicks(durationMidi));
            completedNotes.push({
              pitch,
              velocity: onEvent.velocity,
              channel,
              startTickMidi: onEvent.startTick,
              durationTicksMidi: durationMidi,
              startTickCanonical: toCanonicalTicks(onEvent.startTick),
              durationTicksCanonical: durationCanonical,
            });
          } else {
            // Note-Off sin Note-On previo
            diagnostics.push({
              code: 'UNMATCHED_NOTE_OFF',
              severity: 'INFO',
              message: `Evento Note-Off en tick ${trackCurrentTick} (canal ${channel}, pitch ${pitch}) no tiene un Note-On activo previo; ignorado de forma segura.`,
              location: { trackIndex: trackIdx + 1 },
            });
          }
        } else if (messageType === 0x90) {
          // Note On con vel > 0
          const pitch = buffer[offset++];
          const vel = buffer[offset++];
          const noteKey = `${channel}_${pitch}`;

          if (!activeNotes.has(noteKey)) {
            activeNotes.set(noteKey, []);
          }
          activeNotes.get(noteKey)!.push({
            startTick: trackCurrentTick,
            velocity: vel,
          });
        } else if (messageType === 0xc0) {
          // Program Change (1 data byte)
          detectedProgram = buffer[offset++];
        } else if (messageType === 0xd0) {
          // Channel Pressure (1 data byte)
          offset++;
        } else if (
          messageType === 0xa0 ||
          messageType === 0xb0 ||
          messageType === 0xe0
        ) {
          // Poly Key Pressure, Control Change, Pitch Bend (2 data bytes)
          offset += 2;
        }
      }

      // Si quedaron notas sin Note-Off al final del track:
      // PRESERVAR su duración real hasta el final del track (NO inventar 1 negra)
      for (const [noteKey, queue] of activeNotes.entries()) {
        const parts = noteKey.split('_');
        const channel = parseInt(parts[0], 10);
        const pitch = parseInt(parts[1], 10);

        for (const onEvent of queue) {
          const durationMidi = Math.max(1, trackCurrentTick - onEvent.startTick);
          const durationCanonical = Math.max(1, toCanonicalTicks(durationMidi));
          completedNotes.push({
            pitch,
            velocity: onEvent.velocity,
            channel: channel ?? detectedChannel ?? 0,
            startTickMidi: onEvent.startTick,
            durationTicksMidi: durationMidi,
            startTickCanonical: toCanonicalTicks(onEvent.startTick),
            durationTicksCanonical: durationCanonical,
            unmatchedNoteOn: true,
          });

          diagnostics.push({
            code: 'UNMATCHED_NOTE_ON',
            severity: 'WARNING',
            message: `Nota sin Note-Off al final de la pista: pitch ${pitch} en tick ${onEvent.startTick}. Se preservó su duración hasta el fin del track (${durationMidi} ticks MIDI) sin inventar duración por defecto.`,
            location: { trackIndex: trackIdx + 1 },
          });
        }
      }

      // Ordenar notas por tick inicial ascendente
      completedNotes.sort((a, b) => a.startTickCanonical - b.startTickCanonical || a.pitch - b.pitch);

      tracks.push({
        trackIndex: trackIdx + 1,
        trackName,
        channel: detectedChannel,
        programNumber: detectedProgram,
        notes: completedNotes,
        totalTicksMidi: trackCurrentTick,
        totalTicksCanonical: toCanonicalTicks(trackCurrentTick),
      });

      offset = trackEnd;
    }

    // Ordenar eventos de tempo y armadura temporalmente
    tempoEvents.sort((a, b) => a.tickCanonical - b.tickCanonical);
    timeSignatures.sort((a, b) => a.tickCanonical - b.tickCanonical);
    keySignatures.sort((a, b) => a.tickCanonical - b.tickCanonical);

    // CERO VALORES INVENTADOS: Si no existen eventos explícitos, reportar null
    const defaultBpm = tempoEvents.length > 0 ? tempoEvents[0].bpm : null;
    const defaultTimeSignature = timeSignatures.length > 0
      ? { numerator: timeSignatures[0].numerator, denominator: timeSignatures[0].denominator }
      : null;
    const defaultKey = keySignatures.length > 0 ? keySignatures[0].keyName : null;

    const maxTrackTicks = tracks.reduce((max, t) => Math.max(max, t.totalTicksCanonical), 0);

    return {
      format,
      trackCount: tracks.length,
      division,
      tracks,
      tempoEvents,
      timeSignatures,
      keySignatures,
      defaultBpm,
      defaultTimeSignature,
      defaultKey,
      totalDurationTicksCanonical: maxTrackTicks,
      diagnostics,
    };
  }

  /**
   * Convierte un valor de armadura MIDI (sf y mi) a una cadena de clave tonal formal.
   */
  public static keySignatureToString(sharpsFlats: number, isMinor: boolean): string {
    const majorKeys: Record<number, string> = {
      '-7': 'Cb',
      '-6': 'Gb',
      '-5': 'Db',
      '-4': 'Ab',
      '-3': 'Eb',
      '-2': 'Bb',
      '-1': 'F',
      '0': 'C',
      '1': 'G',
      '2': 'D',
      '3': 'A',
      '4': 'E',
      '5': 'B',
      '6': 'F#',
      '7': 'C#',
    };

    const minorKeys: Record<number, string> = {
      '-7': 'Abm',
      '-6': 'Ebm',
      '-5': 'Bbm',
      '-4': 'Fm',
      '-3': 'Cm',
      '-2': 'Gm',
      '-1': 'Dm',
      '0': 'Am',
      '1': 'Em',
      '2': 'Bm',
      '3': 'F#m',
      '4': 'C#m',
      '5': 'G#m',
      '6': 'D#m',
      '7': 'A#m',
    };

    if (isMinor) {
      return minorKeys[sharpsFlats] ?? 'Am';
    }
    return majorKeys[sharpsFlats] ?? 'C';
  }

  /**
   * Mapea un número de nota MIDI (0..127) a un nombre de nota diatónica y octava.
   */
  public static midiPitchToNote(midiPitch: number): { noteName: string; octave: number; baseLetter: string; alter: number } {
    const clamped = Math.max(0, Math.min(127, Math.round(midiPitch)));
    const octave = Math.floor(clamped / 12) - 1;
    const pitchClass = clamped % 12;

    const pitchClassMap: Array<{ noteName: string; baseLetter: string; alter: number }> = [
      { noteName: 'C', baseLetter: 'C', alter: 0 },
      { noteName: 'C#', baseLetter: 'C', alter: 1 },
      { noteName: 'D', baseLetter: 'D', alter: 0 },
      { noteName: 'Eb', baseLetter: 'E', alter: -1 },
      { noteName: 'E', baseLetter: 'E', alter: 0 },
      { noteName: 'F', baseLetter: 'F', alter: 0 },
      { noteName: 'F#', baseLetter: 'F', alter: 1 },
      { noteName: 'G', baseLetter: 'G', alter: 0 },
      { noteName: 'Ab', baseLetter: 'A', alter: -1 },
      { noteName: 'A', baseLetter: 'A', alter: 0 },
      { noteName: 'Bb', baseLetter: 'B', alter: -1 },
      { noteName: 'B', baseLetter: 'B', alter: 0 },
    ];

    const mapped = pitchClassMap[pitchClass];
    return {
      noteName: mapped.noteName,
      octave,
      baseLetter: mapped.baseLetter,
      alter: mapped.alter,
    };
  }
}
