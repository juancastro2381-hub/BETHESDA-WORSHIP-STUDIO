/**
 * @file midi-serializer.ts
 * @description Serializador determinista y fidedigno de CanonicalMusicPayload hacia Standard MIDI File (SMF Formato 1).
 *
 * Principios de Fase 2A:
 * 1. CERO invención de notas: Si la obra no contiene notas melódicas (ej. viene de un cifrado ChordPro puro),
 *    SE RECHAZA la generación de MIDI con un diagnóstico de error explícito en vez de inventar notas o acordes falsos.
 * 2. CERO invención de tempo: Si no existe tempo especificado en el timeline o metadatos, se omite el meta-evento 0x51.
 * 3. CERO invención de métrica o armadura: Si son nulas, se omiten los meta-eventos 0x58 y 0x59.
 * 4. Resolución canónica exacta: 480 ticks por negra (CANONICAL_TPQN = 480).
 * 5. SMF Formato 1 con Pista 0 Conductor (título, tempo, métrica, armadura) y Pistas 1..N para notas/voces.
 */

import { type CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { type Note } from '../../canonical-model/musical-event.ts';
import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
import { MidiExportGatekeeper } from '../../canonical-model/midi-export-gatekeeper.ts';
import {
  type ConversionDiagnostic,
  type ConversionExportResult,
} from '../types.ts';

export interface MidiExportOptions {
  trackName?: string;
  defaultChannel?: number; // 0..15 (default 0)
}

interface RawMidiTimedEvent {
  tick: number;
  priority: number; // 0: NoteOff, 1: NoteOn (NoteOff executes first at the same tick)
  bytes: number[];
}

export class CanonicalToMidiSerializer {
  /**
   * Serializa un CanonicalMusicPayload a un archivo binario Standard MIDI File (SMF Formato 1).
   */
  public static serialize(
    payload: CanonicalMusicPayload,
    options?: MidiExportOptions
  ): ConversionExportResult {
    const diagnostics: ConversionDiagnostic[] = [];

    if (!payload || !payload.title) {
      throw new Error('No se puede serializar un CanonicalMusicPayload inválido o sin título.');
    }

    const allNotes = payload.getAllNotes();

    // Guardián Multi-Factor de Exportación MIDI (Fase 2B.2)
    const gateResult = MidiExportGatekeeper.isEligible(payload);
    if (!gateResult.eligible) {
      const issues = gateResult.issues ?? [];
      const errorDiagnostics: ConversionDiagnostic[] = issues.map((iss) => ({
        code: iss.code,
        severity: 'ERROR',
        message: iss.message,
        measureNumber: iss.measureNumber,
      }));
      if (errorDiagnostics.length === 0) {
        errorDiagnostics.push({
          code:
            allNotes.length === 0
              ? 'CANNOT_EXPORT_MIDI_WITHOUT_NOTES'
              : gateResult.code || 'MIDI_EXPORT_INELIGIBLE',
          severity: 'ERROR',
          message:
            gateResult.reason ||
            'El documento canónico no es elegible para exportación MIDI (Fail-Closed Gatekeeper).',
        });
      }
      return {
        success: false,
        targetFormat: 'MIDI',
        filename: `${this.sanitizeFilename(payload.title)}.mid`,
        mimeType: 'audio/midi',
        content: new Uint8Array(0),
        canonicalPayload: payload,
        diagnostics: errorDiagnostics,
      };
    }

    // Pista 0: Pista Conductor (Metadatos globales, Tempo, TimeSig, KeySig)
    const conductorTrackBytes = this.buildConductorTrack(payload, diagnostics);

    // Pistas 1..N: Pistas de notas
    const musicTracksBytes = this.buildMusicTracks(payload, options, diagnostics);

    // Principio de Cero-Fabricación: Si ocurrieron errores de integridad (alturas fuera de rango o duraciones inválidas),
    // se prohíbe generar un archivo MIDI corrupto o clamped.
    const hasIntegrityErrors = diagnostics.some((d) => d.severity === 'ERROR');
    if (hasIntegrityErrors) {
      return {
        success: false,
        targetFormat: 'MIDI',
        filename: `${this.sanitizeFilename(payload.title)}.mid`,
        mimeType: 'audio/midi',
        content: new Uint8Array(0),
        canonicalPayload: payload,
        diagnostics,
      };
    }

    const totalTracks = 1 + musicTracksBytes.length;

    // Cabecera MThd (14 bytes):
    // 'MThd' (4) + length 00 00 00 06 (4) + format 00 01 (2) + numTracks (2) + division CANONICAL_TPQN (2)
    const headerBytes: number[] = [
      0x4d, 0x54, 0x68, 0x64, // 'MThd'
      0x00, 0x00, 0x00, 0x06, // length 6
      0x00, 0x01,             // Format 1 (multi-track synchronous)
      (totalTracks >> 8) & 0xff,
      totalTracks & 0xff,
      (CANONICAL_TPQN >> 8) & 0xff,
      CANONICAL_TPQN & 0xff,
    ];

    // Ensamblar archivo MIDI completo
    const finalBufferLength =
      headerBytes.length +
      conductorTrackBytes.length +
      musicTracksBytes.reduce((acc, trk) => acc + trk.length, 0);

    const midiBuffer = new Uint8Array(finalBufferLength);
    let offset = 0;

    midiBuffer.set(headerBytes, offset);
    offset += headerBytes.length;

    midiBuffer.set(conductorTrackBytes, offset);
    offset += conductorTrackBytes.length;

    for (const trackBytes of musicTracksBytes) {
      midiBuffer.set(trackBytes, offset);
      offset += trackBytes.length;
    }

    return {
      success: true,
      targetFormat: 'MIDI',
      filename: `${this.sanitizeFilename(payload.title)}.mid`,
      mimeType: 'audio/midi',
      content: midiBuffer,
      canonicalPayload: payload,
      diagnostics,
    };
  }

  /**
   * Construye el chunk MTrk para la Pista Conductor (Track 0).
   */
  private static buildConductorTrack(
    payload: CanonicalMusicPayload,
    diagnostics: ConversionDiagnostic[]
  ): Uint8Array {
    const trackEventsData: number[] = [];

    // 1. Nombre de la Pista (Título de la obra)
    // Delta 0, FF 03 len text
    const titleBytes = new TextEncoder().encode(payload.title);
    trackEventsData.push(0x00); // delta 0
    trackEventsData.push(0xff, 0x03);
    trackEventsData.push(...this.encodeVLQ(titleBytes.length));
    for (let i = 0; i < titleBytes.length; i++) {
      trackEventsData.push(titleBytes[i]!);
    }

    // 2. Tempo: Buscar tempo en timeline o metadata
    // Si no existe, CERO invención: no emitimos tempo (el reproductor MIDI asume el default del estándar SMF)
    const bpm = this.extractBpm(payload);
    if (bpm !== null && bpm > 0) {
      const microsecondsPerQuarter = Math.round(60_000_000 / bpm);
      trackEventsData.push(0x00); // delta 0
      trackEventsData.push(0xff, 0x51, 0x03);
      trackEventsData.push((microsecondsPerQuarter >> 16) & 0xff);
      trackEventsData.push((microsecondsPerQuarter >> 8) & 0xff);
      trackEventsData.push(microsecondsPerQuarter & 0xff);
    } else {
      diagnostics.push({
        code: 'MIDI_NO_TEMPO_SPECIFIED',
        severity: 'INFO',
        message: 'No se especificó tempo en el modelo canónico. Se omite meta-evento 0x51 (Cero Fabricación).',
      });
    }

    // 3. Métrica (Time Signature): Buscar en primer compás
    const firstMeasure = payload.measures[0];
    const timeSig = firstMeasure?.timeSignature;
    if (timeSig) {
      // 0xFF 0x58 0x04 nn dd cc bb
      // dd es potencia de 2: ej. denominador 4 -> dd=2 (2^2=4), denom 8 -> dd=3 (2^3=8)
      const dd = Math.round(Math.log2(timeSig.denominator));
      trackEventsData.push(0x00); // delta 0
      trackEventsData.push(0xff, 0x58, 0x04);
      trackEventsData.push(timeSig.numerator & 0xff);
      trackEventsData.push(dd & 0xff);
      trackEventsData.push(24); // 24 relojes MIDI por click de metrónomo
      trackEventsData.push(8);  // 8 notas de 32avos por negra
    }

    // 4. Armadura (Key Signature): Buscar en primer compás
    const keySig = firstMeasure?.keySignature;
    if (keySig) {
      // 0xFF 0x59 0x02 sf mi
      // sf = -7 a 7 (bemoles o sostenidos), mi = 0 mayor, 1 menor
      const sf = keySig.keySignature.accidentalCount;
      const mi = keySig.mode === 'NATURAL_MINOR' ? 1 : 0;
      trackEventsData.push(0x00); // delta 0
      trackEventsData.push(0xff, 0x59, 0x02);
      trackEventsData.push(sf & 0xff);
      trackEventsData.push(mi & 0xff);
    }

    // 5. Fin de Pista (End of Track): Delta 0, FF 2F 00
    trackEventsData.push(0x00, 0xff, 0x2f, 0x00);

    return this.wrapTrackChunk(trackEventsData);
  }

  /**
   * Construye las pistas MTrk para las notas.
   */
  private static buildMusicTracks(
    payload: CanonicalMusicPayload,
    options: MidiExportOptions | undefined,
    diagnostics: ConversionDiagnostic[]
  ): Uint8Array[] {
    const rawEvents: RawMidiTimedEvent[] = [];
    const channel = (options?.defaultChannel ?? 0) & 0x0f;

    let currentMeasureTick = 0;

    for (const measure of payload.measures) {
      const measureStart = measure.startTick !== null ? measure.startTick : currentMeasureTick;

      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!event.isRest) {
            const note = event as Note;
            // Principio de Cero-Fabricación: Validar duración fidedigna sin inventar 1 tick con Math.max
            if (note.durationTicks === null || !Number.isFinite(note.durationTicks) || note.durationTicks <= 0) {
              diagnostics.push({
                code: 'MIDI_INVALID_NOTE_DURATION',
                severity: 'ERROR',
                message: `Duración de nota inválida (${note.durationTicks} ticks) en compás ${measure.number}. CERO fabricación: se prohíbe inventar duraciones arbitrarias.`,
                measureNumber: measure.number,
              });
              continue;
            }

            if (note.startTick === null) {
              diagnostics.push({
                code: 'MIDI_INVALID_NOTE_TIMING',
                severity: 'ERROR',
                message: `Tick inicial de nota no asignado (null) en compás ${measure.number}. No es posible generar MIDI sin timing resuelto.`,
                measureNumber: measure.number,
              });
              continue;
            }

            const startTick = measureStart + note.startTick;
            const duration = note.durationTicks;
            const endTick = startTick + duration;

            const pitchNum = note.pitch.midiNumber;
            // Principio de Cero-Fabricación: Prohibido clamping que modifique notas (ej. C-1 a C0 o G9 a G8)
            if (pitchNum < 0 || pitchNum > 127) {
              diagnostics.push({
                code: 'MIDI_PITCH_OUT_OF_RANGE',
                severity: 'ERROR',
                message: `Tono MIDI ${pitchNum} fuera del rango físico representable (0-127) en compás ${measure.number}. CERO fabricación: se prohíbe el clamping que alteraría la altura musical.`,
                measureNumber: measure.number,
              });
              continue;
            }

            const velocity = Math.max(1, Math.min(127, note.velocity ?? 80));

            // Note On
            rawEvents.push({
              tick: startTick,
              priority: 1, // On runs after Off at identical tick
              bytes: [0x90 | channel, pitchNum, velocity],
            });

            // Note Off
            rawEvents.push({
              tick: endTick,
              priority: 0, // Off runs first
              bytes: [0x80 | channel, pitchNum, 0x40],
            });
          }
        }
      }

      // Avanzar offset de compás si no está explícito en el siguiente compás
      if (measure.durationTicks !== null && measure.durationTicks > 0) {
        currentMeasureTick = measureStart + measure.durationTicks;
      } else if (measure.timeSignature) {
        currentMeasureTick = measureStart + measure.timeSignature.calculateMeasureDurationTicks();
      } else {
        // En compás sin métrica ni duración, calculamos el máximo tick de los eventos del compás
        let maxEventEnd = 0;
        for (const voice of measure.voices) {
          for (const ev of voice.events) {
            if (ev.startTick !== null && ev.durationTicks !== null) {
              maxEventEnd = Math.max(maxEventEnd, ev.startTick + ev.durationTicks);
            }
          }
        }
        currentMeasureTick = measureStart + Math.max(CANONICAL_TPQN, maxEventEnd);
      }
    }

    // Ordenar eventos cronológicamente:
    // 1. tick ascendente
    // 2. si tick coincide, priority ascendente (NoteOff antes que NoteOn)
    rawEvents.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      return a.priority - b.priority;
    });

    // Construir stream de bytes con delta-times VLQ
    const trackBytes: number[] = [];

    // Opcional: Nombre de pista
    const trackName = options?.trackName ?? 'Partitura Principal';
    const trackNameBytes = new TextEncoder().encode(trackName);
    trackBytes.push(0x00, 0xff, 0x03);
    trackBytes.push(...this.encodeVLQ(trackNameBytes.length));
    for (let i = 0; i < trackNameBytes.length; i++) {
      trackBytes.push(trackNameBytes[i]!);
    }

    let lastTick = 0;
    for (const event of rawEvents) {
      const delta = Math.max(0, event.tick - lastTick);
      lastTick = event.tick;
      trackBytes.push(...this.encodeVLQ(delta));
      trackBytes.push(...event.bytes);
    }

    // End of Track
    trackBytes.push(0x00, 0xff, 0x2f, 0x00);

    return [this.wrapTrackChunk(trackBytes)];
  }

  /**
   * Envuelve los bytes de eventos con la cabecera MTrk y su longitud de 4 bytes big-endian.
   */
  private static wrapTrackChunk(eventData: number[]): Uint8Array {
    const chunkLength = eventData.length;
    const chunkHeader = [
      0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
      (chunkLength >> 24) & 0xff,
      (chunkLength >> 16) & 0xff,
      (chunkLength >> 8) & 0xff,
      chunkLength & 0xff,
    ];

    const result = new Uint8Array(chunkHeader.length + chunkLength);
    result.set(chunkHeader, 0);
    for (let i = 0; i < chunkLength; i++) {
      result[chunkHeader.length + i] = eventData[i]!;
    }
    return result;
  }

  /**
   * Codifica un entero positivo en Variable-Length Quantity (VLQ) de MIDI (1 a 4 bytes).
   */
  public static encodeVLQ(value: number): number[] {
    let v = Math.max(0, Math.floor(value));
    const bytes: number[] = [v & 0x7f];
    while ((v >>= 7) > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
    }
    return bytes;
  }

  private static extractBpm(payload: CanonicalMusicPayload): number | null {
    if (
      payload.timeline?.tempoMap &&
      !payload.timeline.tempoMap.isUnresolved &&
      payload.timeline.tempoMap.events.length > 0
    ) {
      const firstTempo = payload.timeline.tempoMap.events[0];
      if (firstTempo && typeof firstTempo.bpm === 'number' && firstTempo.bpm > 0) {
        return firstTempo.bpm;
      }
    }
    const metaBpm = payload.metadata?.['bpm'];
    if (typeof metaBpm === 'number' && metaBpm > 0) {
      return metaBpm;
    }
    return null;
  }

  private static calculateSharpsFlats(root: string, mode: 'MAJOR' | 'MINOR'): number {
    const cleanRoot = root.toUpperCase().replace(/\s+/g, '');
    const majorMap: Record<string, number> = {
      CB: -7, GB: -6, DB: -5, AB: -4, EB: -3, BB: -2, F: -1,
      C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
    };
    const minorMap: Record<string, number> = {
      AB: -7, EB: -6, BB: -5, F: -4, C: -3, G: -2, D: -1,
      A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
    };

    if (mode === 'MINOR') {
      return minorMap[cleanRoot] ?? 0;
    }
    return majorMap[cleanRoot] ?? 0;
  }

  private static sanitizeFilename(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50) || 'conversion';
  }
}
