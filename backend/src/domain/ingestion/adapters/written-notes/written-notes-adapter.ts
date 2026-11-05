/**
 * @file written-notes-adapter.ts
 * @description Adaptador universal para ingreso estructurado manual de notas, compases, acordes y letras (Fase 1B).
 * Proporciona un canal accesible para músicos que desean ingresar información musical de forma directa.
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
  public readonly name = 'Bethesda Written Notes Manual Importer';
  public readonly version = '1.0.0';

  public canHandle(input: IngestionInput): boolean {
    return input.sourceType === 'WRITTEN_NOTES' || input.writtenNotes !== undefined;
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    const payload: WrittenNotesPayload | undefined = input.writtenNotes;
    if (!payload) {
      throw new ValidationError('El payload de notas escritas no fue suministrado en la solicitud.');
    }

    if (!payload.title || typeof payload.title !== 'string' || payload.title.trim().length === 0) {
      throw new ValidationError('El título de la obra es obligatorio para la ingesta de notas escritas.');
    }

    if (!Array.isArray(payload.measures) || payload.measures.length === 0) {
      throw new ValidationError('Debe suministrar al menos un compás con notas para la ingesta de notas escritas.');
    }

    const title = payload.title.trim();
    const artist = payload.artist?.trim() || null;
    const defaultBpm = payload.tempoBpm ?? 120;
    const rawKeyStr = payload.keySignature || 'C';

    let musicalKey: MusicalKey;
    try {
      musicalKey = MusicalKey.parse(rawKeyStr);
    } catch {
      musicalKey = MusicalKey.C_MAJOR;
    }
    const defaultKeyRef = KeySignatureReference.fromMusicalKey(musicalKey);

    const timeSigData = payload.timeSignature || { numerator: 4, denominator: 4 };
    const defaultTimeSig = new TimeSignature(timeSigData.numerator, timeSigData.denominator);
    const measureDurationTicks = defaultTimeSig.calculateMeasureDurationTicks();

    const diagnostics: IngestionDiagnostic[] = [];
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
      const mNum = i + 1; // Correlativo estricto 1, 2, ...
      const mStartTick = currentTick;
      const mEndTick = mStartTick + measureDurationTicks;

      const voiceEvents: Array<Note | Rest> = [];
      let nextVoiceTick = mStartTick;

      for (let noteIdx = 0; noteIdx < (mInput.notes || []).length; noteIdx++) {
        const n = mInput.notes[noteIdx];

        // Validación estricta del nombre de nota ^[A-G]$
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

        const durationTicks = DURATION_TICKS_MAP[n.duration] ?? 480;
        const noteStartTick = nextVoiceTick;

        if (noteStartTick >= mEndTick) {
          diagnostics.push({
            code: 'NOTE_TRUNCATED_MEASURE_OVERFLOW',
            severity: 'WARNING',
            message: `La nota ${n.step}${n.octave} excede los ticks del compás ${mNum} y fue recortada.`,
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
          // Construir Pitch con alteración si existe
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

      // Si la voz no llenó el compás o no tenía notas, rellenar con silencio hasta el final del compás
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
    const tempoMap = new TempoMap([new TempoEvent(0, defaultBpm)]);
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
        sourceFormat: 'INTERNAL',
        importer: this.name,
        sourceHash,
      },
    });

    diagnostics.push({
      code: 'WRITTEN_NOTES_SUCCESS',
      severity: 'INFO',
      message: `Notas escritas procesadas exitosamente: ${measures.length} compases, ${defaultBpm} BPM, tonalidad ${rawKeyStr}.`,
    });

    return {
      status: 'PARSED',
      sourceType: 'WRITTEN_NOTES',
      sourceHash,
      title,
      artist,
      defaultKey: rawKeyStr,
      defaultBpm,
      timeSignature: `${defaultTimeSig.numerator}/${defaultTimeSig.denominator}`,
      canonicalPayload: canonicalPayload.toJSON(),
      diagnostics,
    };
  }
}
