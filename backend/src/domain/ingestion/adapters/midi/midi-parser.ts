/**
 * @file midi-parser.ts
 * @description Parser determinista y seguro de Standard MIDI Files (SMF Formatos 0 y 1) en TypeScript puro (Fase 1B).
 *
 * Características:
 * 1. Validación de cabecera mágica 'MThd' y chunks de pista 'MTrk'.
 * 2. Decodificación de tiempos delta en cantidad de longitud variable (VLQ) protegida contra overflow.
 * 3. Soporte de Running Status estándar MIDI.
 * 4. Extracción de eventos de canal: Note-On, Note-Off, Program Change, Control Change, Pitch Bend.
 * 5. Extracción de meta-eventos: Set Tempo (0x51), Time Signature (0x58), Key Signature (0x59), Track Name (0x03).
 * 6. Normalización temporal exacta a 480 TPQN (CANONICAL_TPQN).
 * 7. CERO dependencias externas ni librerías nativas propensas a vulnerabilidades.
 */

import { ValidationError } from '../../../errors.ts';

export interface MidiParsedNote {
  pitch: number; // 0..127
  velocity: number; // 1..127
  channel: number; // 0..15
  startTickMidi: number;
  durationTicksMidi: number;
  startTickCanonical: number;
  durationTicksCanonical: number;
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
  defaultBpm: number;
  defaultTimeSignature: { numerator: number; denominator: number };
  defaultKey: string;
  totalDurationTicksCanonical: number;
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
   * Parsea un buffer SMF completo hacia una estructura de datos estructurada y validada.
   */
  public static parse(buffer: Buffer): MidiParsedData {
    if (!this.isMidiFile(buffer)) {
      throw new ValidationError('Firma de archivo MIDI inválida: no comienza con la cabecera mágica "MThd".');
    }

    let offset = 0;

    // 1. Cabecera MThd
    const headerId = buffer.toString('ascii', offset, offset + 4);
    offset += 4;
    const headerLength = buffer.readUInt32BE(offset);
    offset += 4;

    if (headerId !== 'MThd' || headerLength < 6) {
      throw new ValidationError(`Cabecera MIDI corrupta: longitud esperada >= 6, recibida ${headerLength}.`);
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

    // Función auxiliar para convertir ticks MIDI a ticks canónicos (480 TPQN)
    const toCanonicalTicks = (midiTicks: number): number => {
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

      // Estructura temporal para emparejar Note-On con Note-Off
      // key: channel_pitch -> array de { startTick, velocity }
      const activeNotes = new Map<string, Array<{ startTick: number; velocity: number }>>();
      const completedNotes: MidiParsedNote[] = [];

      while (offset < trackEnd) {
        // Leer delta-time VLQ
        let deltaTime = 0;
        let vlqBytes = 0;
        while (offset < trackEnd) {
          const b = buffer[offset++];
          deltaTime = (deltaTime << 7) | (b & 0x7f);
          vlqBytes++;
          if (vlqBytes > 4) {
            throw new ValidationError('Overflow en decodificación VLQ de delta-time MIDI (más de 4 bytes).');
          }
          if ((b & 0x80) === 0) break;
        }

        trackCurrentTick += deltaTime;

        if (offset >= trackEnd) break;

        let statusByte = buffer[offset];

        if (statusByte >= 0x80) {
          // Nuevo status byte
          offset++;
          lastStatusByte = statusByte;
        } else {
          // Running status
          if (lastStatusByte === 0) {
            throw new ValidationError(`Running status MIDI inválido en offset ${offset}: no hay status previo.`);
          }
          statusByte = lastStatusByte;
        }

        // Meta Event
        if (statusByte === 0xff) {
          if (offset >= trackEnd) break;
          const metaType = buffer[offset++];
          
          // Leer longitud del meta evento (VLQ)
          let metaLength = 0;
          while (offset < trackEnd) {
            const b = buffer[offset++];
            metaLength = (metaLength << 7) | (b & 0x7f);
            if ((b & 0x80) === 0) break;
          }

          if (offset + metaLength > trackEnd) {
            metaLength = trackEnd - offset;
          }

          const metaData = buffer.subarray(offset, offset + metaLength);
          offset += metaLength;

          // 0x03: Track Name
          if (metaType === 0x03) {
            trackName = metaData.toString('utf8').trim() || trackName;
          }

          // 0x51: Set Tempo (3 bytes microseconds per quarter note)
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
            let sf = metaData.readInt8(0);
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
          let sysexLen = 0;
          while (offset < trackEnd) {
            const b = buffer[offset++];
            sysexLen = (sysexLen << 7) | (b & 0x7f);
            if ((b & 0x80) === 0) break;
          }
          offset += sysexLen;
          continue;
        }

        // Channel Voice Events
        const messageType = statusByte & 0xf0;
        const channel = statusByte & 0x0f;
        if (detectedChannel === undefined) {
          detectedChannel = channel;
        }

        // Note Off (0x80) o Note On con velocity 0 (0x90)
        if (messageType === 0x80) {
          const pitch = buffer[offset++];
          const _vel = buffer[offset++];
          const noteKey = `${channel}_${pitch}`;
          const queue = activeNotes.get(noteKey);
          if (queue && queue.length > 0) {
            const onEvent = queue.shift()!;
            const durationMidi = Math.max(1, trackCurrentTick - onEvent.startTick);
            completedNotes.push({
              pitch,
              velocity: onEvent.velocity,
              channel,
              startTickMidi: onEvent.startTick,
              durationTicksMidi: durationMidi,
              startTickCanonical: toCanonicalTicks(onEvent.startTick),
              durationTicksCanonical: Math.max(15, toCanonicalTicks(durationMidi)),
            });
          }
        } else if (messageType === 0x90) {
          const pitch = buffer[offset++];
          const vel = buffer[offset++];
          const noteKey = `${channel}_${pitch}`;

          if (vel === 0) {
            // Note On con vel=0 equivale a Note Off
            const queue = activeNotes.get(noteKey);
            if (queue && queue.length > 0) {
              const onEvent = queue.shift()!;
              const durationMidi = Math.max(1, trackCurrentTick - onEvent.startTick);
              completedNotes.push({
                pitch,
                velocity: onEvent.velocity,
                channel,
                startTickMidi: onEvent.startTick,
                durationTicksMidi: durationMidi,
                startTickCanonical: toCanonicalTicks(onEvent.startTick),
                durationTicksCanonical: Math.max(15, toCanonicalTicks(durationMidi)),
              });
            }
          } else {
            // Note On real
            if (!activeNotes.has(noteKey)) {
              activeNotes.set(noteKey, []);
            }
            activeNotes.get(noteKey)!.push({
              startTick: trackCurrentTick,
              velocity: vel,
            });
          }
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

      // Si quedaron notas sin Note-Off al final del track, cerrarlas con duración de 1 negra
      for (const [noteKey, queue] of activeNotes.entries()) {
        const pitch = parseInt(noteKey.split('_')[1], 10);
        for (const onEvent of queue) {
          const defaultDurationMidi = division; // 1 negra
          completedNotes.push({
            pitch,
            velocity: onEvent.velocity,
            channel: detectedChannel ?? 0,
            startTickMidi: onEvent.startTick,
            durationTicksMidi: defaultDurationMidi,
            startTickCanonical: toCanonicalTicks(onEvent.startTick),
            durationTicksCanonical: toCanonicalTicks(defaultDurationMidi),
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

    // Calcular valores por defecto
    const defaultBpm = tempoEvents[0]?.bpm ?? 120;
    const defaultTimeSignature = timeSignatures[0]
      ? { numerator: timeSignatures[0].numerator, denominator: timeSignatures[0].denominator }
      : { numerator: 4, denominator: 4 };
    const defaultKey = keySignatures[0]?.keyName ?? 'C';

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
    };
  }

  /**
   * Mapea un conteo de sostenidos/bemoles (-7 a 7) y modo a una tonalidad musical legible.
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

