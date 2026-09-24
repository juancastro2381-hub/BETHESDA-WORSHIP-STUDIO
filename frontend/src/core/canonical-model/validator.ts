/**
 * @file validator.ts
 * @description Motor de validación exhaustivo y determinista para el CanonicalMusicPayload.
 * Detecta inconsistencias temporales, errores de métrica, IDs duplicados y referencias rotas.
 */

import { CanonicalMusicPayload } from './canonical-music-payload.ts';
import { CANONICAL_TPQN } from './types.ts';

export interface ValidationError {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export class CanonicalModelValidator {
  /**
   * Ejecuta la batería completa de validaciones de dominio sobre un CanonicalMusicPayload.
   */
  public static validate(payload: CanonicalMusicPayload): ValidationResult {
    const errors: ValidationError[] = [];

    // 1. Verificación de Resolución Canónica TPQN
    if (payload.timeline.tpqn !== CANONICAL_TPQN) {
      errors.push({
        code: 'INVALID_TPQN',
        message: `Resolución temporal debe ser exactamente ${CANONICAL_TPQN} TPQN, recibida: ${payload.timeline.tpqn}`,
      });
    }

    // 2. Verificación de Compases
    let expectedTick = 0;
    const seenMeasureNumbers = new Set<number>();
    const seenIds = new Set<string>();
    const allNoteIds = new Set<string>();

    for (let i = 0; i < payload.measures.length; i++) {
      const measure = payload.measures[i];
      if (!measure) continue;

      // 2.1 Numeración correlativa estricta (1, 2, ..., N)
      const expectedNumber = i + 1;
      if (measure.number !== expectedNumber) {
        errors.push({
          code: 'NON_SEQUENTIAL_MEASURE_NUMBER',
          message: `El compás en índice ${i} tiene número ${measure.number}; se esperaba ${expectedNumber}.`,
          context: { index: i, measureNumber: measure.number, expectedNumber },
        });
      }

      if (seenMeasureNumbers.has(measure.number)) {
        errors.push({
          code: 'DUPLICATE_MEASURE_NUMBER',
          message: `Número de compás duplicado: ${measure.number}`,
          context: { measureNumber: measure.number },
        });
      }
      seenMeasureNumbers.add(measure.number);

      // 2.2 Continuidad temporal de ticks
      if (measure.startTick !== expectedTick) {
        errors.push({
          code: 'MEASURE_TICK_DISCONTINUITY',
          message: `Compás ${measure.number} inicia en tick ${measure.startTick}; se esperaba ${expectedTick}.`,
          context: {
            measureNumber: measure.number,
            startTick: measure.startTick,
            expectedTick,
          },
        });
      }

      // 2.3 Coherencia métrica de duración del compás
      const expectedDuration = measure.timeSignature.calculateMeasureDurationTicks();
      if (measure.durationTicks !== expectedDuration) {
        errors.push({
          code: 'MEASURE_DURATION_MISMATCH',
          message: `Compás ${measure.number} tiene duración ${measure.durationTicks} ticks; métrica ${measure.timeSignature} exige ${expectedDuration} ticks.`,
          context: {
            measureNumber: measure.number,
            durationTicks: measure.durationTicks,
            expectedDuration,
          },
        });
      }

      expectedTick = measure.startTick + measure.durationTicks;

      // 2.4 Validación de Eventos de Voces
      for (const voice of measure.voices) {
        for (const ev of voice.events) {
          // ID duplicado
          if (seenIds.has(ev.id)) {
            errors.push({
              code: 'DUPLICATE_EVENT_ID',
              message: `ID de evento musical duplicado: ${ev.id}`,
              context: { eventId: ev.id, measureNumber: measure.number },
            });
          }
          seenIds.add(ev.id);

          if (!ev.isRest) {
            allNoteIds.add(ev.id);
          }

          // Límite de compás
          if (ev.startTick < measure.startTick || ev.startTick >= measure.endTick) {
            errors.push({
              code: 'EVENT_OUT_OF_MEASURE_BOUNDS',
              message: `Evento ${ev.id} inicia en tick ${ev.startTick}, fuera del compás ${measure.number} [${measure.startTick}, ${measure.endTick}).`,
              context: {
                eventId: ev.id,
                startTick: ev.startTick,
                measureStart: measure.startTick,
                measureEnd: measure.endTick,
              },
            });
          }

          // Consistencia de voz
          if (ev.voice !== voice.id) {
            errors.push({
              code: 'EVENT_VOICE_MISMATCH',
              message: `Evento ${ev.id} asignado a voz ${ev.voice} dentro del contenedor de voz ${voice.id}.`,
              context: { eventId: ev.id, eventVoice: ev.voice, containerVoice: voice.id },
            });
          }
        }
      }

      // 2.5 Validación de Acordes
      for (const chord of measure.chords) {
        if (seenIds.has(chord.id)) {
          errors.push({
            code: 'DUPLICATE_CHORD_ID',
            message: `ID de evento de acorde duplicado: ${chord.id}`,
            context: { chordId: chord.id, measureNumber: measure.number },
          });
        }
        seenIds.add(chord.id);

        if (chord.measureNumber !== measure.number) {
          errors.push({
            code: 'CHORD_MEASURE_MISMATCH',
            message: `Acorde ${chord.id} declara compás ${chord.measureNumber} pero reside en compás ${measure.number}.`,
            context: {
              chordId: chord.id,
              declaredMeasure: chord.measureNumber,
              actualMeasure: measure.number,
            },
          });
        }

        if (chord.startTick < measure.startTick || chord.startTick >= measure.endTick) {
          errors.push({
            code: 'CHORD_OUT_OF_MEASURE_BOUNDS',
            message: `Acorde ${chord.id} inicia en tick ${chord.startTick}, fuera del compás ${measure.number}.`,
            context: {
              chordId: chord.id,
              startTick: chord.startTick,
              measureStart: measure.startTick,
              measureEnd: measure.endTick,
            },
          });
        }
      }

      // 2.6 Validación de Sílabas Líricas
      for (const lyric of measure.lyrics) {
        if (seenIds.has(lyric.id)) {
          errors.push({
            code: 'DUPLICATE_LYRIC_ID',
            message: `ID de sílaba lírica duplicado: ${lyric.id}`,
            context: { lyricId: lyric.id, measureNumber: measure.number },
          });
        }
        seenIds.add(lyric.id);

        if (lyric.measureNumber !== measure.number) {
          errors.push({
            code: 'LYRIC_MEASURE_MISMATCH',
            message: `Sílaba lírica ${lyric.id} declara compás ${lyric.measureNumber} pero reside en compás ${measure.number}.`,
            context: {
              lyricId: lyric.id,
              declaredMeasure: lyric.measureNumber,
              actualMeasure: measure.number,
            },
          });
        }

        if (lyric.tickOffset < 0 || lyric.tickOffset >= measure.durationTicks) {
          errors.push({
            code: 'LYRIC_TICK_OFFSET_OUT_OF_BOUNDS',
            message: `Sílaba ${lyric.id} tiene offset ${lyric.tickOffset} ticks, fuera de la duración del compás ${measure.durationTicks}.`,
            context: {
              lyricId: lyric.id,
              tickOffset: lyric.tickOffset,
              measureDuration: measure.durationTicks,
            },
          });
        }
      }
    }

    // 3. Verificación de Enlace Sílaba -> Nota (Bound Note)
    for (const lyric of payload.getAllLyrics()) {
      if (lyric.boundNoteId && !allNoteIds.has(lyric.boundNoteId)) {
        errors.push({
          code: 'BROKEN_LYRIC_NOTE_BINDING',
          message: `Sílaba ${lyric.id} ("${lyric.text}") referencia nota inexistente: ${lyric.boundNoteId}.`,
          context: { lyricId: lyric.id, boundNoteId: lyric.boundNoteId },
        });
      }
    }

    // 4. Coherencia Global del Timeline
    if (payload.timeline.totalDurationTicks !== expectedTick) {
      errors.push({
        code: 'TIMELINE_DURATION_MISMATCH',
        message: `Timeline totalDurationTicks es ${payload.timeline.totalDurationTicks}, pero la suma de compases es ${expectedTick}.`,
        context: {
          timelineDuration: payload.timeline.totalDurationTicks,
          measuresDuration: expectedTick,
        },
      });
    }

    if (payload.timeline.measureCount !== payload.measures.length) {
      errors.push({
        code: 'TIMELINE_MEASURE_COUNT_MISMATCH',
        message: `Timeline measureCount es ${payload.timeline.measureCount}, pero hay ${payload.measures.length} compases.`,
        context: {
          timelineCount: payload.timeline.measureCount,
          actualCount: payload.measures.length,
        },
      });
    }

    // 5. Validación de Secciones
    let lastSectionEndMeasure = 0;
    for (const section of payload.sections) {
      if (seenIds.has(section.id)) {
        errors.push({
          code: 'DUPLICATE_SECTION_ID',
          message: `ID de sección duplicado: ${section.id}`,
          context: { sectionId: section.id },
        });
      }
      seenIds.add(section.id);

      if (section.startMeasure < 1 || section.endMeasure > payload.measures.length) {
        errors.push({
          code: 'SECTION_MEASURE_OUT_OF_RANGE',
          message: `Sección ${section.id} (${section.label}) abarca compases [${section.startMeasure}, ${section.endMeasure}], fuera de rango 1..${payload.measures.length}.`,
          context: {
            sectionId: section.id,
            startMeasure: section.startMeasure,
            endMeasure: section.endMeasure,
            totalMeasures: payload.measures.length,
          },
        });
      }

      if (section.startMeasure < lastSectionEndMeasure) {
        errors.push({
          code: 'SECTION_OVERLAP_OR_DISORDER',
          message: `Sección ${section.id} (${section.label}) inicia en compás ${section.startMeasure}, antes del fin de la sección anterior (${lastSectionEndMeasure}).`,
          context: {
            sectionId: section.id,
            startMeasure: section.startMeasure,
            lastSectionEndMeasure,
          },
        });
      }
      lastSectionEndMeasure = section.endMeasure;
    }

    // 6. Validación de Pistas Instrumentales
    for (const track of payload.instrumentTracks) {
      if (seenIds.has(track.id)) {
        errors.push({
          code: 'DUPLICATE_TRACK_ID',
          message: `ID de pista instrumental duplicado: ${track.id}`,
          context: { trackId: track.id },
        });
      }
      seenIds.add(track.id);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
