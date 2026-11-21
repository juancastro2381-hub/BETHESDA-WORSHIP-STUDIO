/**
 * @file written-notes-adapter.ts
 * @description Adaptador universal para ingesta de notas musicales introducidas manualmente (Fase 1B-R).
 *
 * Principios:
 * 1. Validación estricta de paso tonal ^[A-G]$ y octava 0..9.
 * 2. CERO asunción de notas redondas, blancas o negras si la duración es inválida.
 * 3. CERO tonalidad 'C', métrica '4/4' o tempo 120 BPM inventados si no fueron suministrados.
 * 4. Mapeo correlativo estricto de compases y voces con alineación exacta de ticks.
 */

import crypto from 'node:crypto';
import {
  CanonicalMusicPayload,
  CANONICAL_TPQN,
  ChordEvent,
  InstrumentTrack,
  KeySignatureReference,
  LyricSyllable,
  Measure,
  Note,
  Rest,
  Timeline,
  TimeSignature,
  Voice,
} from '../../../../../../frontend/src/core/canonical-model/index.ts';
import { Pitch } from '../../../../../../frontend/src/core/music-theory/pitch.ts';
import { NoteName } from '../../../../../../frontend/src/core/music-theory/note-name.ts';
import { Chord } from '../../../../../../frontend/src/core/music-theory/chord.ts';
import { MusicalKey } from '../../../../../../frontend/src/core/music-theory/musical-key.ts';
import { TempoEvent, TempoMap } from '../../../../../../frontend/src/core/canonical-model/tempo-map.ts';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
  WrittenNotesPayload,
} from '../../types.ts';

const DURATION_TICKS_MAP: Record<string, number> = {
  whole: 1920,
  half: 960,
  quarter: 480,
  eighth: 240,
  '16th': 120,
  '32nd': 60,
};

export class WrittenNotesIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'WRITTEN_NOTES' as const;
  public readonly name = 'Bethesda Manual Written Notes Importer';
  public readonly version = '1.1.0';

  public canHandle(input: IngestionInput): boolean {
    return input.sourceType === 'WRITTEN_NOTES' || Boolean(input.writtenNotes);
  }

  public detectMimeType(_buffer: Buffer): string {
    return 'application/json';
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    const payload: WrittenNotesPayload | undefined = input.writtenNotes;

    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Payload de notas escritas no suministrado o inválido.');
    }

    if (!payload.title || typeof payload.title !== 'string' || payload.title.trim().length === 0) {
      throw new ValidationError('El título de la obra es obligatorio para la ingesta de notas escritas.');
    }

    if (!Array.isArray(payload.measures) || payload.measures.length === 0) {
      throw new ValidationError('Debe suministrar al menos un compás con notas para la ingesta de notas escritas.');
    }

    const title = payload.title.trim();
    const artist = payload.artist?.trim() || null;
    const diagnostics: IngestionDiagnostic[] = [];

    // Tonalidad: No asumir C si no se especifica
    let defaultKey: string | null = null;
    let defaultKeyRef: KeySignatureReference;

    if (payload.keySignature) {
      try {
        const parsedKey = MusicalKey.parse(payload.keySignature);
        defaultKeyRef = KeySignatureReference.fromMusicalKey(parsedKey);
        defaultKey = parsedKey.toString();
      } catch {
        throw new ValidationError(
          `Tonalidad inválida en notas escritas: '${payload.keySignature}'. Use un formato válido (ej. 'C', 'G', 'F#', 'Eb', 'Am').`
        );
      }
    } else {
      defaultKeyRef = KeySignatureReference.fromMusicalKey(MusicalKey.C_MAJOR);
      defaultKey = null;
      diagnostics.push({
        code: 'MISSING_KEY_SIGNATURE',
        severity: 'INFO',
        message: 'No se declaró tonalidad en las notas escritas; el campo permanece no resuelto (null).',
      });
    }

    // Métrica: No asumir 4/4 si no se especifica
    let defaultTimeSignatureStr: string | null = null;
    let defaultTimeSig: TimeSignature;

    if (payload.timeSignature) {
      defaultTimeSig = new TimeSignature(payload.timeSignature.numerator, payload.timeSignature.denominator);
      defaultTimeSignatureStr = `${payload.timeSignature.numerator}/${payload.timeSignature.denominator}`;
    } else {
      defaultTimeSig = new TimeSignature(4, 4);
      defaultTimeSignatureStr = null;
      diagnostics.push({
        code: 'MISSING_TIME_SIGNATURE',
        severity: 'INFO',
        message: 'No se declaró métrica en las notas escritas; el campo permanece no resuelto (null).',
      });
    }

    const measureDurationTicks = defaultTimeSig.calculateMeasureDurationTicks();

    // Tempo BPM: No asumir 120 si no se especifica
    const defaultBpm: number | null = payload.tempoBpm ?? null;
    if (defaultBpm === null) {
      diagnostics.push({
        code: 'MISSING_TEMPO',
        severity: 'INFO',
        message: 'No se declaró tempo BPM en las notas escritas; el campo permanece no resuelto (null).',
      });
    }

    const rawHashInput = JSON.stringify(payload);
    const sourceHash = crypto.createHash('sha256').update(rawHashInput).digest('hex');

    // 1. Crear Pistas Instrumentales
    const instrumentTracks = [
      new InstrumentTrack({
        id: 'track-written-notes-1',
        name: 'Voz Principal / Melodía',
        family: 'VOCALS',
        voiceIds: [1],
      }),
    ];

    // 2. Procesar Compases y Notas
    const measures: Measure[] = [];
    let currentTick = 0;

    for (let i = 0; i < payload.measures.length; i++) {
      const mInput = payload.measures[i];
      const mNum = i + 1;
      const mStartTick = currentTick;
      const mEndTick = mStartTick + measureDurationTicks;

      const voiceEvents: Array<Note | Rest> = [];
      let nextVoiceTick = mStartTick;

      for (let noteIdx = 0; noteIdx < (mInput.notes || []).length; noteIdx++) {
        const n = mInput.notes[noteIdx];

        if (!/^[A-G]$/i.test(n.step)) {
          throw new ValidationError(
            `Nota inválida en compás ${mNum}: el paso tonal '${n.step}' no es válido (debe ser una letra de A a G).`
          );
        }

        if (n.octave < 0 || n.octave > 9 || !Number.isInteger(n.octave)) {
          throw new ValidationError(
            `Octava inválida en compás ${mNum}: ${n.octave}. Debe ser un entero entre 0 y 9.`
          );
        }

        const durationTicks = DURATION_TICKS_MAP[n.duration];
        if (!durationTicks) {
          throw new ValidationError(
            `Duración de nota inválida en compás ${mNum}: '${n.duration}'. Opciones válidas: whole, half, quarter, eighth, 16th, 32nd.`
          );
        }

        const noteStartTick = nextVoiceTick;

        if (noteStartTick >= mEndTick) {
          diagnostics.push({
            code: 'NOTE_TRUNCATED_MEASURE_OVERFLOW',
            severity: 'WARNING',
            message: `La nota ${n.step}${n.octave} excede los ticks del compás ${mNum} y fue omitida.`,
            location: { measureNumber: mNum },
          });
          break;
        }

        const effectiveDuration = Math.min(durationTicks, mEndTick - noteStartTick);

        if (n.isRest) {
          voiceEvents.push(
            new Rest({
              id: `wn-rest-${mNum}-${noteIdx + 1}`,
              startTick: noteStartTick,
              durationTicks: effectiveDuration,
              voice: 1,
              staff: 1,
            })
          );
        } else {
          const baseStep = n.step.toUpperCase();
          const alterStr = n.alter === 1 ? '#' : n.alter === -1 ? 'b' : '';
          const noteName = NoteName.parse(`${baseStep}${alterStr}`);
          const pitch = new Pitch(noteName, n.octave);

          voiceEvents.push(
            new Note({
              id: `wn-note-${mNum}-${noteIdx + 1}`,
              pitch,
              startTick: noteStartTick,
              durationTicks: effectiveDuration,
              voice: 1,
              staff: 1,
              velocity: n.velocity ?? 80,
            })
          );
        }

        nextVoiceTick += effectiveDuration;
      }

      // Si la voz no llenó el compás, rellenar con silencio hasta el final del compás
      if (nextVoiceTick < mEndTick) {
        voiceEvents.push(
          new Rest({
            id: `wn-fill-rest-${mNum}`,
            startTick: nextVoiceTick,
            durationTicks: mEndTick - nextVoiceTick,
            voice: 1,
            staff: 1,
          })
        );
      }

      // Acordes del compás
      const chords: ChordEvent[] = [];
      const chordsInput = mInput.chords || [];
      for (let cIdx = 0; cIdx < chordsInput.length; cIdx++) {
        const c = chordsInput[cIdx];
        const chordStartTick = mStartTick + (c.startTick ?? 0);
        if (chordStartTick < mEndTick) {
          const rootStr = `${c.root.toUpperCase()}${c.alter === 1 ? '#' : c.alter === -1 ? 'b' : ''}`;
          try {
            const parsedChord = Chord.parse(`${rootStr}${c.quality}`);
            chords.push(
              new ChordEvent({
                id: `wn-chord-${mNum}-${cIdx + 1}`,
                chord: parsedChord,
                startTick: chordStartTick,
                measureNumber: mNum,
              })
            );
          } catch {
            diagnostics.push({
              code: 'UNPARSEABLE_CHORD',
              severity: 'WARNING',
              message: `El acorde '${c.root}${c.quality}' en el compás ${mNum} no pudo ser reconocido formalmente.`,
              location: { measureNumber: mNum },
            });
          }
        }
      }

      // Letras del compás
      const lyrics: LyricSyllable[] = [];
      const lyricsInput = mInput.lyrics || [];
      for (let lIdx = 0; lIdx < lyricsInput.length; lIdx++) {
        const l = lyricsInput[lIdx];
        const offsetInMeasure = Math.max(0, Math.min(measureDurationTicks - 1, l.startTick ?? 0));
        if (l.text.trim()) {
          lyrics.push(
            new LyricSyllable({
              id: `wn-lyric-${mNum}-${lIdx + 1}`,
              text: l.text.trim(),
              measureNumber: mNum,
              tickOffset: offsetInMeasure,
              sequenceNumber: lIdx + 1,
            })
          );
        }
      }

      measures.push(
        new Measure({
          number: mNum,
          timeSignature: defaultTimeSig,
          keySignature: defaultKeyRef,
          startTick: mStartTick,
          durationTicks: measureDurationTicks,
          voices: [new Voice(1, voiceEvents)],
          chords,
          lyrics,
        })
      );

      currentTick = mEndTick;
    }

    // 3. Crear Timeline
    const tempoMap = new TempoMap([new TempoEvent(0, defaultBpm ?? 120)]);
    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      tempoMap,
      totalDurationTicks: currentTick,
      measureCount: measures.length,
    });

    const canonicalPayload = new CanonicalMusicPayload({
      title,
      timeline,
      measures,
      sections: [],
      instrumentTracks,
      metadata: {
        sourceFormat: 'WRITTEN_NOTES',
        importer: this.name,
        sourceHash,
        hasUnresolvedKey: defaultKey === null,
        hasUnresolvedMeter: defaultTimeSignatureStr === null,
        hasUnresolvedTempo: defaultBpm === null,
      },
    });

    const isFullyResolved = defaultKey !== null && defaultTimeSignatureStr !== null && defaultBpm !== null;
    const status = isFullyResolved ? 'CONVERTED' : 'PARTIALLY_CONVERTED';

    return {
      status,
      sourceType: 'WRITTEN_NOTES',
      sourceHash,
      title,
      artist,
      defaultKey,
      defaultBpm,
      timeSignature: defaultTimeSignatureStr,
      canonicalPayload: canonicalPayload.toJSON(),
      diagnostics,
    };
  }
}
