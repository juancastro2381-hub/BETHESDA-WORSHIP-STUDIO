/**
 * @file conversion-transformer.ts
 * @description Transformador fidedigno de opciones musicales para el Centro de Conversión (Fase 2A-R).
 *
 * Aplica opciones de transposición armónica (-11 a +11 semitonos), anulación de tonalidad (keyOverride),
 * anulación de tempo (bpmOverride) y anulación de métrica (timeSignatureOverride) sobre
 * el modelo canónico (CanonicalMusicPayload) antes de la serialización hacia formatos finales.
 *
 * Principios:
 * 1. CERO invención de notas: La transposición solo altera notas y acordes existentes.
 * 2. CERO alteración de letras: Las sílabas líricas NUNCA son modificadas o transpuesta su ortografía textual.
 * 3. Ortografía enarmónica analítica vía Círculo de Quintas y TranspositionEngine.
 * 4. Invariante de LeadSheet: Si totalMelodyNotes === 0, permanece estrictamente en 0 tras la transposición.
 */

import { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../canonical-model/chord-event.ts';
import { KeySignatureReference } from '../canonical-model/key-signature-reference.ts';
import { Measure } from '../canonical-model/measure.ts';
import { Note, Voice } from '../canonical-model/musical-event.ts';
import { TempoEvent, TempoMap } from '../canonical-model/tempo-map.ts';
import { Timeline } from '../canonical-model/timeline.ts';
import { TimeSignature } from '../canonical-model/time-signature.ts';
import { MusicalKey } from '../music-theory/musical-key.ts';
import { Pitch } from '../music-theory/pitch.ts';
import { TranspositionEngine } from '../music-theory/transposition.ts';
import {
  type ConversionDiagnostic,
  type ConversionOptions,
} from './types.ts';

export class ConversionTransformer {
  /**
   * Aplica las opciones de conversión sobre el CanonicalMusicPayload produciendo una nueva instancia
   * canónica fidedignamente transpuesta y ajustada.
   */
  public static applyOptions(
    payload: CanonicalMusicPayload,
    options?: ConversionOptions
  ): { payload: CanonicalMusicPayload; diagnostics: ConversionDiagnostic[] } {
    const diagnostics: ConversionDiagnostic[] = [];

    if (!options) {
      return { payload, diagnostics };
    }

    const { transposeSemitones, keyOverride, bpmOverride, timeSignatureOverride } = options;

    const hasTransposition = typeof transposeSemitones === 'number' && transposeSemitones !== 0;
    const hasKeyOverride = typeof keyOverride === 'string' && keyOverride.trim().length > 0;
    const hasBpmOverride = typeof bpmOverride === 'number' && bpmOverride > 0;
    const hasMeterOverride =
      typeof timeSignatureOverride === 'string' && timeSignatureOverride.trim().length > 0;

    if (!hasTransposition && !hasKeyOverride && !hasBpmOverride && !hasMeterOverride) {
      return { payload, diagnostics };
    }

    // 1. Resolver tonalidad objetivo para ortografía enarmónica
    let targetKey: MusicalKey | undefined = undefined;

    if (hasKeyOverride) {
      try {
        targetKey = MusicalKey.parse(keyOverride!.trim());
        diagnostics.push({
          code: 'KEY_OVERRIDE_APPLIED',
          severity: 'INFO',
          message: `Tonalidad anulada explícitamente a "${targetKey.toString()}".`,
        });
      } catch (err: any) {
        diagnostics.push({
          code: 'INVALID_KEY_OVERRIDE',
          severity: 'WARNING',
          message: `Tonalidad de anulación "${keyOverride}" no válida: ${err.message}. Se ignora la anulación.`,
        });
      }
    } else if (hasTransposition) {
      const firstMeasureKey = payload.measures[0]?.keySignature;
      if (firstMeasureKey) {
        try {
          targetKey = TranspositionEngine.transposeKey(
            firstMeasureKey.toMusicalKey(),
            transposeSemitones!
          );
        } catch {
          // Si no se puede transponer la tonalidad canónica, se utiliza ortografía genérica
        }
      }
    }

    if (hasTransposition) {
      diagnostics.push({
        code: 'TRANSPOSITION_APPLIED',
        severity: 'INFO',
        message: `Transposición armónica aplicada: ${transposeSemitones > 0 ? '+' : ''}${transposeSemitones} semitonos.`,
      });
    }

    // 2. Resolver anulación de métrica (Time Signature)
    let parsedTimeSig: TimeSignature | null = null;
    if (hasMeterOverride) {
      try {
        const parts = timeSignatureOverride!.trim().split('/');
        if (parts.length === 2) {
          const num = parseInt(parts[0]!, 10);
          const den = parseInt(parts[1]!, 10);
          parsedTimeSig = new TimeSignature(num, den);
          diagnostics.push({
            code: 'TIME_SIGNATURE_OVERRIDE_APPLIED',
            severity: 'INFO',
            message: `Métrica anulada explícitamente a ${parsedTimeSig.numerator}/${parsedTimeSig.denominator}.`,
          });
        } else {
          throw new Error('Formato esperado: "N/D" (ej. "3/4", "4/4", "6/8")');
        }
      } catch (err: any) {
        diagnostics.push({
          code: 'INVALID_TIME_SIGNATURE_OVERRIDE',
          severity: 'WARNING',
          message: `Métrica de anulación "${timeSignatureOverride}" no válida: ${err.message}. Se ignora.`,
        });
      }
    }

    // 3. Transformar compases (Measures)
    const newMeasures: Measure[] = payload.measures.map((measure, idx) => {
      // 3.1 Armadura (Key Signature)
      let newKeySigRef = measure.keySignature;
      if (targetKey && (idx === 0 || measure.keySignature !== null)) {
        newKeySigRef = KeySignatureReference.fromMusicalKey(targetKey);
      } else if (hasTransposition && measure.keySignature) {
        try {
          const transposedKey = TranspositionEngine.transposeKey(
            measure.keySignature.toMusicalKey(),
            transposeSemitones!
          );
          newKeySigRef = KeySignatureReference.fromMusicalKey(transposedKey);
        } catch {
          // Mantener si falla
        }
      }

      // 3.2 Métrica (Time Signature)
      const newTimeSig = parsedTimeSig ?? measure.timeSignature;

      // 3.3 Transponer Acordes (Chords)
      const newChords: ChordEvent[] = measure.chords.map((chordEvent) => {
        if (!hasTransposition) return chordEvent;
        try {
          const transposedChord = TranspositionEngine.transposeChord(
            chordEvent.chord,
            transposeSemitones!,
            targetKey
          );
          const chordInit: any = {
            id: chordEvent.id,
            chord: transposedChord,
            startTick: chordEvent.startTick,
            measureNumber: chordEvent.measureNumber,
          };
          if (chordEvent.durationTicks !== undefined) chordInit.durationTicks = chordEvent.durationTicks;
          if (chordEvent.voice !== undefined) chordInit.voice = chordEvent.voice;
          return new ChordEvent(chordInit);
        } catch (err: any) {
          diagnostics.push({
            code: 'CHORD_TRANSPOSITION_FAILED',
            severity: 'WARNING',
            message: `Error transponiendo acorde en compás ${measure.number}: ${err.message}`,
            measureNumber: measure.number,
          });
          return chordEvent;
        }
      });

      // 3.4 Transponer Notas (Melodic Notes in Voices)
      const newVoices: Voice[] = measure.voices.map((voice) => {
        if (!hasTransposition) return voice;

        const newEvents = voice.events.map((event) => {
          if (event.isRest) return event;
          const note = event as Note;
          const targetMidi = note.pitch.midiNumber + transposeSemitones!;

          if (targetMidi < 0 || targetMidi > 127) {
            diagnostics.push({
              code: 'TRANSPOSE_PITCH_OUT_OF_RANGE',
              severity: 'ERROR',
              message: `Nota ${note.pitch.toString()} transpuesta por ${transposeSemitones} semitonos produce tono MIDI ${targetMidi} fuera del rango físico (0-127) en compás ${measure.number}. CERO fabricación.`,
              measureNumber: measure.number,
            });
            return note;
          }

          try {
            const transposedNoteName = TranspositionEngine.transposeNote(
              note.pitch.noteName,
              transposeSemitones!,
              targetKey
            );
            const targetOctave = Math.floor(targetMidi / 12) - 1;
            const newPitch = new Pitch(transposedNoteName, targetOctave);

            const noteInit: any = {
              id: note.id,
              pitch: newPitch,
              startTick: note.startTick,
              durationTicks: note.durationTicks,
              voice: note.voice,
              staff: note.staff,
              velocity: note.velocity,
              articulations: [...note.articulations],
              tie: note.tie,
              stemDirection: note.stemDirection,
            };
            if (note.dynamic !== undefined) noteInit.dynamic = note.dynamic;
            if (note.notationMetadata !== undefined) noteInit.notationMetadata = note.notationMetadata;

            return new Note(noteInit);
          } catch (err: any) {
            diagnostics.push({
              code: 'NOTE_TRANSPOSITION_ERROR',
              severity: 'ERROR',
              message: `Error transponiendo nota ${note.pitch.toString()}: ${err.message}`,
              measureNumber: measure.number,
            });
            return note;
          }
        });

        return new Voice(voice.id, newEvents);
      });

      // 3.5 Letras: CERO mutación (se conservan intactas)
      const unchangedLyrics = [...measure.lyrics];

      const measureInit: any = {
        number: measure.number,
        timeSignature: newTimeSig,
        keySignature: newKeySigRef,
        startTick: measure.startTick,
        durationTicks: newTimeSig ? newTimeSig.calculateMeasureDurationTicks() : measure.durationTicks,
        voices: newVoices,
        chords: newChords,
        lyrics: unchangedLyrics,
      };
      if (measure.repeatStart !== undefined) measureInit.repeatStart = measure.repeatStart;
      if (measure.repeatEnd !== undefined) measureInit.repeatEnd = measure.repeatEnd;
      if (measure.repeatCount !== undefined) measureInit.repeatCount = measure.repeatCount;
      if (measure.endingNumber !== undefined) measureInit.endingNumber = measure.endingNumber;

      return new Measure(measureInit);
    });

    // 4. Transformar Timeline (Tempo)
    let newTempoMap = payload.timeline.tempoMap;
    if (hasBpmOverride) {
      newTempoMap = new TempoMap([new TempoEvent(0, bpmOverride!)]);
      diagnostics.push({
        code: 'BPM_OVERRIDE_APPLIED',
        severity: 'INFO',
        message: `Tempo anulado explícitamente a ${bpmOverride} BPM.`,
      });
    }

    const newTimeline = new Timeline({
      tpqn: payload.timeline.tpqn,
      totalDurationTicks: payload.timeline.totalDurationTicks,
      measureCount: newMeasures.length,
      tempoMap: newTempoMap,
      isUnmetered: parsedTimeSig ? false : payload.timeline.isUnmetered,
    });

    // 5. Ensamblar nuevo CanonicalMusicPayload
    const transformedPayload = new CanonicalMusicPayload({
      version: payload.version,
      title: payload.title,
      timeline: newTimeline,
      sections: [...payload.sections],
      measures: newMeasures,
      instrumentTracks: [...payload.instrumentTracks],
      metadata: {
        ...(payload.metadata ?? {}),
        conversionOptionsApplied: {
          transposeSemitones: hasTransposition ? transposeSemitones : undefined,
          keyOverride: targetKey ? targetKey.toString() : undefined,
          bpmOverride: hasBpmOverride ? bpmOverride : undefined,
          timeSignatureOverride: parsedTimeSig
            ? `${parsedTimeSig.numerator}/${parsedTimeSig.denominator}`
            : undefined,
        },
      },
    });

    return {
      payload: transformedPayload,
      diagnostics,
    };
  }
}
