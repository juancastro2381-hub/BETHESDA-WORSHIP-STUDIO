/**
 * @file temporal-validator.ts
 * @description Motor exhaustivo y determinista de validación temporal y rítmica (Fase 2B.2).
 *
 * Valida:
 * 1. Anacrusa / compases de entrada (pickup measures).
 * 2. Orden cronológico estricto de eventos por voz.
 * 3. Detección de silencios implícitos internos y huecos de final de compás.
 * 4. Colisiones temporales en una misma voz (respetando acordes agrupados).
 * 5. Rangos físicos MIDI (0-127) y duraciones positivas.
 * 6. Cadenas de ligaduras (START -> CONTINUE -> STOP), consistencia de tono y ligaduras colgantes.
 * 7. Grupos de valores irregulares (tresillos/tuplets): completitud, conteo y duración acumulada.
 * 8. Distinción explícita entre validez estructural y completitud temporal (tablaturas no medidas).
 */

import { type CanonicalMusicPayload } from './canonical-music-payload.ts';
import { type Note } from './musical-event.ts';

export interface TupletGroupDeclaration {
  groupId: string;
  actualNotes: number;           // Ej. 3 notas
  normalNotes: number;           // Ej. en el tiempo de 2
  baseNoteDurationTicks: number; // Ej. 480 para tresillo de negras
  nominalSpanTicks: number;      // normalNotes * baseNoteDurationTicks (Ej. 960)
}

export interface TemporalValidationOptions {
  allowGapsAsImplicitRests?: boolean;
  strictPickupRules?: boolean;
  enforceMidiExportBounds?: boolean;
}

export interface TemporalIssue {
  severity: 'ERROR' | 'WARNING';
  code:
    | 'TEMPORAL_VOICE_GAP'
    | 'TRAILING_MEASURE_GAP'
    | 'SAME_VOICE_NOTE_COLLISION'
    | 'EVENT_ORDERING_VIOLATION'
    | 'INCOMPLETE_TUPLET_GROUP'
    | 'OVERFLOW_TUPLET_GROUP'
    | 'TUPLET_DURATION_MISMATCH'
    | 'TUPLET_FRACTIONAL_TICK_ERROR'
    | 'INVALID_PICKUP_DURATION'
    | 'BROKEN_TIE_CHAIN'
    | 'TIE_PITCH_MISMATCH'
    | 'TIE_TEMPORAL_DISCONTINUITY'
    | 'MIDI_PITCH_OUT_OF_RANGE'
    | 'MIDI_DURATION_NON_POSITIVE'
    | 'MIDI_INVALID_NOTE_DURATION'
    | 'STRUCTURAL_EMPTY_MEASURES'
    | 'STRUCTURAL_INVALID_MEASURE_NUMBER'
    | 'STRUCTURAL_INVALID_VOICE_ID'
    | 'STRUCTURAL_MISSING_EVENT_ID'
    | 'INSTRUMENT_INVALID_STRING_NUMBER'
    | 'INSTRUMENT_INVALID_FRET';
  voiceId: number;
  measureNumber: number;
  startTick: number;
  message: string;
  context?: Record<string, unknown>;
}

export type TemporalValidationIssue = TemporalIssue;

export interface TemporalValidationResult {
  isValid: boolean;
  issues: TemporalIssue[];
  isUnmeasured: boolean;
  isPartiallyMeasured: boolean;
  // 5 dimensiones formales de validación (Defecto D)
  isStructurallyValid: boolean;
  isInstrumentValid: boolean;
  isTemporallyComplete: boolean;
  isTemporallyValid: boolean;
  isMidiEligible: boolean;
}

export class TemporalValidator {
  public static validate(
    payload: CanonicalMusicPayload,
    options: TemporalValidationOptions = {}
  ): TemporalValidationResult {
    const opts: Required<TemporalValidationOptions> = {
      allowGapsAsImplicitRests: options.allowGapsAsImplicitRests ?? false,
      strictPickupRules: options.strictPickupRules ?? true,
      enforceMidiExportBounds: options.enforceMidiExportBounds ?? true,
    };

    const issues: TemporalIssue[] = [];
    const openTies = new Map<
      string,
      { noteId: string; pitchKey: string; endTick: number; voiceId: number; measureNumber: number }
    >();
    const tupletGroups = new Map<
      string,
      { decl: TupletGroupDeclaration; events: Array<{ id: string; duration: number }> }
    >();

    const allNotes = payload?.getAllNotes ? payload.getAllNotes() : [];
    const hasUnmeasuredNotes = allNotes.some(
      (n) => n.startTick === null || n.durationTicks === null
    );
    const rhythmicProv = (payload?.metadata as Record<string, unknown> | undefined)?.rhythmicProvenance;
    const isExplicitlyUnmeasured =
      rhythmicProv === 'NONE' || (allNotes.length > 0 && hasUnmeasuredNotes);

    const measures = payload?.measures ?? [];
    for (const measure of measures) {
      // -------------------------------------------------------------
      // ETAPA 1: VALIDACIÓN DE ANACRUSA / PICKUP MEASURE
      // -------------------------------------------------------------
      const isPickup =
        (measure as any).isPickup === true ||
        (measure as any).anacrusis === true ||
        (payload.metadata as any)?.pickupMeasureNumber === measure.number;

      if (measure.timeSignature && measure.durationTicks !== null) {
        const nominalTicks = measure.timeSignature.calculateMeasureDurationTicks();
        if (isPickup) {
          if (measure.number !== 1 && opts.strictPickupRules) {
            issues.push({
              severity: 'ERROR',
              code: 'INVALID_PICKUP_DURATION',
              voiceId: 0,
              measureNumber: measure.number,
              startTick: measure.startTick ?? 0,
              message: `El indicador de anacrusa (pickup measure) solo está permitido en el compás 1 (encontrado en compás ${measure.number}).`,
              context: { measureNumber: measure.number },
            });
          } else if (measure.durationTicks >= nominalTicks || measure.durationTicks <= 0) {
            issues.push({
              severity: 'ERROR',
              code: 'INVALID_PICKUP_DURATION',
              voiceId: 0,
              measureNumber: measure.number,
              startTick: measure.startTick ?? 0,
              message: `La duración de la anacrusa (${measure.durationTicks} ticks) debe ser > 0 y estrictamente menor que la nominal (${nominalTicks} ticks).`,
              context: { durationTicks: measure.durationTicks, nominalTicks },
            });
          }
        }
      }

      // -------------------------------------------------------------
      // ETAPA 2: RECORRIDO DE LÍNEA DE TIEMPO POR VOZ
      // -------------------------------------------------------------
      for (const voice of measure.voices ?? []) {
        const measureStart = measure.startTick ?? 0;
        let expectedVoiceTick = measureStart;
        let previousStartTick = -1;
        const hasUntimedEventsInVoice = (voice.events ?? []).some(
          (e) => e.startTick === null || e.durationTicks === null
        );
        const activeEventsInVoice: Array<{
          id: string;
          startTick: number;
          endTick: number;
          chordId?: string;
        }> = [];

        for (const ev of voice.events ?? []) {
          const rawStartTick = ev.startTick;
          const evDurationTicks = ev.durationTicks;
          if (rawStartTick === null || evDurationTicks === null) {
            continue;
          }

          // Resolver tick relativo a compás vs tick absoluto de score
          const evStartTick =
            measureStart > 0 && rawStartTick < measureStart
              ? measureStart + rawStartTick
              : rawStartTick;

          // A. Orden Cronológico de Eventos
          if (evStartTick < previousStartTick) {
            issues.push({
              severity: 'ERROR',
              code: 'EVENT_ORDERING_VIOLATION',
              voiceId: voice.id,
              measureNumber: measure.number,
              startTick: evStartTick,
              message: `El evento ${ev.id} inicia en tick ${evStartTick} antes del evento previo (${previousStartTick}).`,
              context: { eventId: ev.id, startTick: evStartTick, previousStartTick },
            });
          }
          previousStartTick = evStartTick;

          // B. Detección de Silencios Internos sin Rest Explícito (solo si la voz está completamente cronometrada)
          if (
            !hasUntimedEventsInVoice &&
            !opts.allowGapsAsImplicitRests &&
            evStartTick > expectedVoiceTick
          ) {
            issues.push({
              severity: 'ERROR',
              code: 'TEMPORAL_VOICE_GAP',
              voiceId: voice.id,
              measureNumber: measure.number,
              startTick: expectedVoiceTick,
              message: `Hueco temporal en Voz ${voice.id} entre tick ${expectedVoiceTick} y ${evStartTick} sin silencio explícito.`,
              context: { gapStart: expectedVoiceTick, gapEnd: evStartTick },
            });
          }

          // C. Detección de Colisiones en Misma Voz (Permitiendo Acordes Agrupados)
          if (evStartTick < expectedVoiceTick) {
            const colliding = activeEventsInVoice.filter((a) => a.endTick > evStartTick);
            const currentChordId =
              (ev as any).chordId ??
              (!ev.isRest && ev.notationMetadata ? (ev.notationMetadata as any).chordId : undefined);
            const isSimultaneousChord =
              colliding.length > 0 &&
              colliding.every(
                (c) =>
                  c.startTick === evStartTick &&
                  c.chordId &&
                  currentChordId &&
                  c.chordId === currentChordId
              );

            if (!isSimultaneousChord) {
              issues.push({
                severity: 'ERROR',
                code: 'SAME_VOICE_NOTE_COLLISION',
                voiceId: voice.id,
                measureNumber: measure.number,
                startTick: evStartTick,
                message: `Colisión temporal: El evento ${ev.id} se superpone con eventos activos en la Voz ${voice.id} sin agrupación explícita de acorde.`,
                context: { eventId: ev.id, collidingWith: colliding.map((c) => c.id) },
              });
            }
          }

          // D. Verificación de Límites MIDI
          if (opts.enforceMidiExportBounds && !ev.isRest) {
            const note = ev as Note;
            const midiPitch = note.pitch?.midiNumber;
            if (midiPitch === undefined || midiPitch < 0 || midiPitch > 127) {
              issues.push({
                severity: 'ERROR',
                code: 'MIDI_PITCH_OUT_OF_RANGE',
                voiceId: voice.id,
                measureNumber: measure.number,
                startTick: evStartTick,
                message: `Tono MIDI ${midiPitch} fuera del rango físico representable (0-127) en compás ${measure.number}. CERO fabricación: se prohíbe el clamping que alteraría la altura musical.`,
                context: { noteId: note.id, midiPitch },
              });
            }
            if (evDurationTicks <= 0) {
              issues.push({
                severity: 'ERROR',
                code: 'MIDI_INVALID_NOTE_DURATION',
                voiceId: voice.id,
                measureNumber: measure.number,
                startTick: evStartTick,
                message: `La nota ${note.id} posee una duración no positiva (${evDurationTicks} ticks). CERO fabricación: se prohíbe inventar duraciones arbitrarias.`,
                context: { noteId: note.id, durationTicks: evDurationTicks },
              });
            }
          }

          // E. Cadenas de Ligaduras (Tie Chains: START -> CONTINUE -> STOP)
          if (!ev.isRest) {
            const note = ev as Note;
            const pitchKey = note.pitch?.noteName
              ? `${note.pitch.noteName.toString()}_${note.pitch.octave}`
              : (note.pitch?.toString ? note.pitch.toString() : String(note.pitch?.midiNumber ?? 'unknown'));
            const tieLookupKey = `${voice.id}_${pitchKey}`;
            const activeTie = openTies.get(tieLookupKey);

            if (note.tie === 'START') {
              if (activeTie) {
                issues.push({
                  severity: 'ERROR',
                  code: 'BROKEN_TIE_CHAIN',
                  voiceId: voice.id,
                  measureNumber: measure.number,
                  startTick: evStartTick,
                  message: `La nota ${note.id} inicia una ligadura en ${pitchKey} mientras una ligadura previa de la nota ${activeTie.noteId} sigue abierta.`,
                  context: { noteId: note.id, previousNoteId: activeTie.noteId },
                });
              }
              openTies.set(tieLookupKey, {
                noteId: note.id,
                pitchKey,
                endTick: evStartTick + evDurationTicks,
                voiceId: voice.id,
                measureNumber: measure.number,
              });
            } else if (note.tie === 'CONTINUE' || note.tie === 'STOP') {
              if (!activeTie) {
                issues.push({
                  severity: 'ERROR',
                  code: 'BROKEN_TIE_CHAIN',
                  voiceId: voice.id,
                  measureNumber: measure.number,
                  startTick: evStartTick,
                  message: `La nota ${note.id} declara ligadura ${note.tie} en ${pitchKey} pero no existe ligadura activa abierta para esta altura.`,
                  context: { noteId: note.id, tieType: note.tie },
                });
              } else {
                if (evStartTick !== activeTie.endTick) {
                  issues.push({
                    severity: 'ERROR',
                    code: 'TIE_TEMPORAL_DISCONTINUITY',
                    voiceId: voice.id,
                    measureNumber: measure.number,
                    startTick: evStartTick,
                    message: `Discontinuidad temporal en ligadura: La nota ${note.id} inicia en tick ${evStartTick}, pero la nota ligada predecesora concluyó en tick ${activeTie.endTick}.`,
                    context: {
                      noteId: note.id,
                      startTick: evStartTick,
                      expectedTick: activeTie.endTick,
                    },
                  });
                }
                if (note.tie === 'STOP') {
                  openTies.delete(tieLookupKey);
                } else {
                  openTies.set(tieLookupKey, {
                    noteId: note.id,
                    pitchKey,
                    endTick: evStartTick + evDurationTicks,
                    voiceId: voice.id,
                    measureNumber: measure.number,
                  });
                }
              }
            }
          }

          // F. Agregación de Grupos de Valores Irregulares (Tuplet Groups)
          const tupletDecl =
            (ev as any).tupletGroup ??
            (!ev.isRest && ev.notationMetadata
              ? ((ev.notationMetadata as any)?.tupletGroup as TupletGroupDeclaration | undefined)
              : undefined);
          if (tupletDecl && tupletDecl.groupId) {
            let group = tupletGroups.get(tupletDecl.groupId);
            if (!group) {
              group = { decl: tupletDecl, events: [] };
              tupletGroups.set(tupletDecl.groupId, group);
            }
            group.events.push({ id: ev.id, duration: evDurationTicks });
          }

          const chordId =
            (ev as any).chordId ??
            (!ev.isRest && ev.notationMetadata ? (ev.notationMetadata as any)?.chordId : undefined);
          activeEventsInVoice.push({
            id: ev.id,
            startTick: evStartTick,
            endTick: evStartTick + evDurationTicks,
            chordId,
          });
          expectedVoiceTick = Math.max(expectedVoiceTick, evStartTick + evDurationTicks);
        }

        // G. Hueco de Final de Compás (Trailing Silence sin Rest Explícito, solo para voces completamente medidas)
        if (
          !hasUntimedEventsInVoice &&
          measure.endTick !== null &&
          !opts.allowGapsAsImplicitRests &&
          expectedVoiceTick < measure.endTick
        ) {
          issues.push({
            severity: 'ERROR',
            code: 'TRAILING_MEASURE_GAP',
            voiceId: voice.id,
            measureNumber: measure.number,
            startTick: expectedVoiceTick,
            message: `Silencio final no representado en Voz ${voice.id} entre tick ${expectedVoiceTick} y fin de compás ${measure.endTick} sin Rest explícito.`,
            context: { gapStart: expectedVoiceTick, measureEnd: measure.endTick },
          });
        }
      }
    }

    // -------------------------------------------------------------
    // ETAPA 3: VALIDACIÓN MATEMÁTICA DE TUPLETS
    // -------------------------------------------------------------
    for (const [groupId, group] of tupletGroups.entries()) {
      const { decl, events } = group;

      if (events.length < decl.actualNotes) {
        issues.push({
          severity: 'ERROR',
          code: 'INCOMPLETE_TUPLET_GROUP',
          voiceId: 0,
          measureNumber: 0,
          startTick: 0,
          message: `Grupo irregular ${groupId} declaró ${decl.actualNotes} notas reales, pero solo contiene ${events.length}.`,
          context: { groupId, expected: decl.actualNotes, actual: events.length },
        });
      } else if (events.length > decl.actualNotes) {
        issues.push({
          severity: 'ERROR',
          code: 'OVERFLOW_TUPLET_GROUP',
          voiceId: 0,
          measureNumber: 0,
          startTick: 0,
          message: `Grupo irregular ${groupId} declaró ${decl.actualNotes} notas reales, pero contiene un exceso de ${events.length}.`,
          context: { groupId, expected: decl.actualNotes, actual: events.length },
        });
      }

      const aggregateDuration = events.reduce((sum, e) => sum + e.duration, 0);
      if (aggregateDuration !== decl.nominalSpanTicks) {
        issues.push({
          severity: 'ERROR',
          code: 'TUPLET_DURATION_MISMATCH',
          voiceId: 0,
          measureNumber: 0,
          startTick: 0,
          message: `Duración acumulada del grupo irregular ${groupId} (${aggregateDuration} ticks) no coincide con el lapso nominal (${decl.nominalSpanTicks} ticks).`,
          context: { groupId, aggregateDuration, nominalSpanTicks: decl.nominalSpanTicks },
        });
      }
    }

    // -------------------------------------------------------------
    // ETAPA 4: LIGADURAS COLGANTES (DANGLING TIES)
    // -------------------------------------------------------------
    for (const [, tie] of openTies.entries()) {
      issues.push({
        severity: 'ERROR',
        code: 'BROKEN_TIE_CHAIN',
        voiceId: tie.voiceId,
        measureNumber: tie.measureNumber,
        startTick: tie.endTick,
        message: `Ligadura START colgante desde nota ${tie.noteId} (${tie.pitchKey}) nunca fue cerrada con un STOP.`,
        context: { openTie: tie },
      });
    }

    // -------------------------------------------------------------
    // ETAPA 5: CLASIFICACIÓN DE RESULTADOS INDEPENDIENTES (Defecto D)
    // -------------------------------------------------------------
    // 1. Validez Estructural
    let isStructurallyValid = true;
    if (!measures || measures.length === 0) {
      isStructurallyValid = false;
      issues.push({
        severity: 'ERROR',
        code: 'STRUCTURAL_EMPTY_MEASURES',
        voiceId: 0,
        measureNumber: 0,
        startTick: 0,
        message: 'El documento musical no contiene compases.',
      });
    } else {
      for (const m of measures) {
        if (!m || typeof m.number !== 'number' || m.number < 1) {
          isStructurallyValid = false;
          issues.push({
            severity: 'ERROR',
            code: 'STRUCTURAL_INVALID_MEASURE_NUMBER',
            voiceId: 0,
            measureNumber: m?.number ?? 0,
            startTick: m?.startTick ?? 0,
            message: `Número de compás inválido (${m?.number}). Los compases deben numerarse con enteros >= 1.`,
            context: { measureNumber: m?.number },
          });
        }
        if (!m.voices || m.voices.length === 0) {
          // Sin voces en el compás
        } else {
          for (const v of m.voices) {
            if (!v || typeof v.id !== 'number' || v.id < 1) {
              isStructurallyValid = false;
              issues.push({
                severity: 'ERROR',
                code: 'STRUCTURAL_INVALID_VOICE_ID',
                voiceId: v?.id ?? 0,
                measureNumber: m.number,
                startTick: m.startTick ?? 0,
                message: `ID de voz inválido (${v?.id}) en compás ${m.number}. Los IDs de voz deben ser enteros >= 1.`,
                context: { voiceId: v?.id },
              });
            }
            if (v.events) {
              for (const ev of v.events) {
                if (!ev || !ev.id || typeof ev.id !== 'string' || ev.id.trim() === '') {
                  isStructurallyValid = false;
                  issues.push({
                    severity: 'ERROR',
                    code: 'STRUCTURAL_MISSING_EVENT_ID',
                    voiceId: v?.id ?? 0,
                    measureNumber: m.number,
                    startTick: ev?.startTick ?? 0,
                    message: `Evento musical sin identificador obligatorio en compás ${m.number}, voz ${v?.id}.`,
                  });
                }
              }
            }
          }
        }
      }
    }

    // 2. Validez de Instrumento / Afinación
    let isInstrumentValid = true;
    for (const n of allNotes) {
      const tabMeta = (n.notationMetadata as Record<string, unknown> | undefined)?.tablature as
        | { stringNumber?: number; fret?: number | null; isMuted?: boolean }
        | undefined;
      if (tabMeta) {
        if (
          tabMeta.stringNumber !== undefined &&
          (typeof tabMeta.stringNumber !== 'number' ||
            tabMeta.stringNumber < 1 ||
            tabMeta.stringNumber > 12)
        ) {
          isInstrumentValid = false;
          issues.push({
            severity: 'ERROR',
            code: 'INSTRUMENT_INVALID_STRING_NUMBER',
            voiceId: n.voice ?? 0,
            measureNumber: 0,
            startTick: n.startTick ?? 0,
            message: `Número de cuerda de tablatura (${tabMeta.stringNumber}) fuera de rango válido (1-12) en nota ${n.id}.`,
            context: { noteId: n.id, stringNumber: tabMeta.stringNumber },
          });
        }
        if (
          tabMeta.fret !== undefined &&
          tabMeta.fret !== null &&
          (typeof tabMeta.fret !== 'number' || tabMeta.fret < 0 || tabMeta.fret > 30)
        ) {
          isInstrumentValid = false;
          issues.push({
            severity: 'ERROR',
            code: 'INSTRUMENT_INVALID_FRET',
            voiceId: n.voice ?? 0,
            measureNumber: 0,
            startTick: n.startTick ?? 0,
            message: `Traste de tablatura (${tabMeta.fret}) fuera de rango físico válido (0-30) en nota ${n.id}.`,
            context: { noteId: n.id, fret: tabMeta.fret },
          });
        }
      }
    }

    // 3. Completitud Temporal
    const isTemporallyComplete =
      allNotes.length > 0 &&
      !hasUnmeasuredNotes &&
      rhythmicProv !== 'NONE' &&
      rhythmicProv !== 'PARTIALLY_MEASURED';

    // 4. Validez Temporal cuando existe timing
    const hasTemporalErrors = issues.some(
      (i) =>
        i.severity === 'ERROR' &&
        [
          'SAME_VOICE_NOTE_COLLISION',
          'EVENT_ORDERING_VIOLATION',
          'BROKEN_TIE_CHAIN',
          'TIE_PITCH_MISMATCH',
          'TIE_TEMPORAL_DISCONTINUITY',
          'INCOMPLETE_TUPLET_GROUP',
          'OVERFLOW_TUPLET_GROUP',
          'TUPLET_DURATION_MISMATCH',
          'INVALID_PICKUP_DURATION',
          'MIDI_DURATION_NON_POSITIVE',
          'MIDI_INVALID_NOTE_DURATION',
          'TEMPORAL_VOICE_GAP',
          'TRAILING_MEASURE_GAP',
        ].includes(i.code)
    );
    const isTemporallyValid = !hasTemporalErrors;

    // 5. Elegibilidad para Exportación MIDI (Requiere todas las dimensiones anteriores + rango MIDI)
    const allPitchesValidForMidi = allNotes.every(
      (n) => n.pitch && n.pitch.midiNumber >= 0 && n.pitch.midiNumber <= 127
    );
    const allDurationsValidForMidi = allNotes.every(
      (n) => n.durationTicks !== null && n.durationTicks > 0
    );

    const isMidiEligible =
      isStructurallyValid &&
      isInstrumentValid &&
      isTemporallyComplete &&
      isTemporallyValid &&
      allNotes.length > 0 &&
      allPitchesValidForMidi &&
      allDurationsValidForMidi;

    const isFullyUnmeasured = isExplicitlyUnmeasured && allNotes.every((n) => n.startTick === null);
    const isPartiallyMeasured =
      !isTemporallyComplete &&
      !isFullyUnmeasured &&
      allNotes.some((n) => n.startTick !== null || n.durationTicks !== null);

    const isValid = isStructurallyValid && isInstrumentValid && isTemporallyValid;

    return {
      isValid,
      issues,
      isUnmeasured: isFullyUnmeasured,
      isPartiallyMeasured,
      isStructurallyValid,
      isInstrumentValid,
      isTemporallyComplete,
      isTemporallyValid,
      isMidiEligible,
    };
  }
}
