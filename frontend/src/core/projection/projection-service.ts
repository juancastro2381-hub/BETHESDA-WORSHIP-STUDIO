/**
 * @file projection-service.ts
 * @description Servicio determinista de proyección y transformación musical (Fase 1D).
 *
 * Arquitectura conceptual:
 * CANONICAL MUSIC -> TRANSFORMATION ENGINE -> INSTRUMENT PROJECTION -> MUSICAL VIEW
 *
 * Invariantes no negociables:
 * 1. El payload canónico (CanonicalMusicPayload) es estrictamente INMUTABLE.
 * 2. Instrumento ≠ Vista.
 * 3. Capo ≠ Transposición Musical.
 * 4. Toda transformación produce vistas derivadas puras (DerivedMusicalView).
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { KeySignatureReference } from '../canonical-model/key-signature-reference.ts';
import { type ClefType } from '../canonical-model/types.ts';
import { MusicalKey } from '../music-theory/musical-key.ts';
import { Pitch } from '../music-theory/pitch.ts';
import { CapoCalculator, TranspositionEngine } from '../music-theory/transposition.ts';
import {
  DerivedChord,
  DerivedLyric,
  DerivedMeasure,
  DerivedMusicalView,
  DerivedNote,
} from './derived-musical-view.ts';
import { type InstrumentProfile } from './instrument-profile.ts';
import { TablatureCalculator } from './tablature-calculator.ts';
import {
  type ProjectionDiagnostic,
  type ProjectionStatus,
  type TabPosition,
  type ViewRepresentation,
} from './types.ts';
import { type ViewPreference } from './view-preference.ts';

export interface ProjectionResult {
  readonly status: ProjectionStatus;
  readonly view?: DerivedMusicalView;
  readonly diagnostics: readonly ProjectionDiagnostic[];
}

export class ProjectionService {
  /**
   * Ejecuta la proyección determinista de un arreglo musical canónico hacia
   * una vista derivada adaptada al perfil del instrumento y las preferencias del músico.
   */
  public static project(
    canonicalMusic: CanonicalMusicPayload,
    instrumentProfile: InstrumentProfile,
    viewPreference: ViewPreference
  ): ProjectionResult {
    const diagnostics: ProjectionDiagnostic[] = [];

    // 1. Validar que las representaciones solicitadas sean soportadas por el perfil del instrumento
    const requestedReps = viewPreference.getAllRequestedRepresentations();
    const validation = instrumentProfile.validateRequestedRepresentations(requestedReps);

    if (!validation.valid) {
      const unsupportedList = validation.unsupported.join(', ');
      diagnostics.push({
        severity: 'ERROR',
        code: 'UNSUPPORTED_VIEW_REPRESENTATION',
        message: `El instrumento "${instrumentProfile.name}" (${instrumentProfile.id}) no soporta la(s) siguiente(s) representación(es): ${unsupportedList}.`,
        context: {
          instrumentId: instrumentProfile.id,
          requested: requestedReps,
          unsupported: validation.unsupported,
          supported: Array.from(instrumentProfile.supportedRepresentations),
        },
      });

      return {
        status: 'UNSUPPORTED_VIEW',
        diagnostics: Object.freeze(diagnostics),
      };
    }

    // 2. Determinar tonalidades y desplazamientos interválicos
    const firstMeasure = canonicalMusic.measures[0];
    const canonicalKey = firstMeasure?.keySignature.toMusicalKey() ?? MusicalKey.C_MAJOR;

    // Desplazamiento sonante (transposición musical solicitada por el músico/director)
    const musicianSemitones = viewPreference.transpositionSemitones;
    const soundingKey = musicianSemitones !== 0
      ? TranspositionEngine.transposeKey(canonicalKey, musicianSemitones)
      : canonicalKey;

    // Desplazamiento para instrumentos transpositores (ej. Eb saxo = +9, Bb trompeta = +2)
    const instrumentOffset = instrumentProfile.transpositionOffsetSemitones;
    const totalWrittenOffset = musicianSemitones + instrumentOffset;

    const writtenKey = totalWrittenOffset !== 0
      ? TranspositionEngine.transposeKey(canonicalKey, totalWrittenOffset)
      : canonicalKey;

    // Tonalidad de digitación para cejilla (Capo)
    const capoFret = viewPreference.capoFret;
    const fingeringKeyContext = capoFret > 0
      ? TranspositionEngine.transposeKey(soundingKey, -capoFret)
      : soundingKey;

    // Determinar claves (clefs)
    const activeClefs = ProjectionService.resolveClefs(
      instrumentProfile,
      viewPreference,
      requestedReps
    );

    // 3. Proyectar compases
    const derivedMeasures: DerivedMeasure[] = [];
    const isTabRequested = requestedReps.includes('TABLATURE');

    for (const measure of canonicalMusic.measures) {
      // Clave de armadura de compás
      const concertKeySig = measure.keySignature;
      const writtenKeySig = totalWrittenOffset !== 0
        ? KeySignatureReference.fromMusicalKey(writtenKey)
        : concertKeySig;

      // Proyectar notas
      const derivedNotes: DerivedNote[] = [];
      const allMeasureNotes = measure.getAllNotes();

      for (const note of allMeasureNotes) {
        let writtenPitch = note.pitch;
        if (totalWrittenOffset !== 0) {
          const transposedNoteName = TranspositionEngine.transposeNote(
            note.pitch.noteName,
            totalWrittenOffset,
            writtenKey
          );
          const targetMidi = note.pitch.midiNumber + totalWrittenOffset;
          const targetOctave = Math.floor(targetMidi / 12) - 1;
          writtenPitch = new Pitch(transposedNoteName, targetOctave);
        }

        derivedNotes.push(
          new DerivedNote({
            id: note.id,
            canonicalPitch: note.pitch,
            writtenPitch,
            startTick: note.startTick,
            durationTicks: note.durationTicks,
            voice: note.voice,
            staff: note.staff,
            velocity: note.velocity,
            tie: note.tie,
            articulations: note.articulations,
            stemDirection: note.stemDirection,
          })
        );
      }

      // Proyectar acordes
      const derivedChords: DerivedChord[] = [];
      for (const chordEvent of measure.chords) {
        const canonicalChord = chordEvent.chord;

        // Acorde sonante con transposición musical
        const effectiveConcertChord = musicianSemitones !== 0
          ? TranspositionEngine.transposeChord(canonicalChord, musicianSemitones, soundingKey)
          : canonicalChord;

        // Acorde escrito para instrumentos transpositores
        const writtenChord = instrumentOffset !== 0
          ? TranspositionEngine.transposeChord(effectiveConcertChord, instrumentOffset, writtenKey)
          : effectiveConcertChord;

        // Acorde de digitación con cejilla (Capo)
        let fingeringChord = effectiveConcertChord;
        if (capoFret > 0) {
          fingeringChord = CapoCalculator.calculateFingeringChord(
            effectiveConcertChord,
            capoFret,
            fingeringKeyContext
          );
        }

        // Determinar cadena a mostrar según preferencias
        let displayChord = effectiveConcertChord;
        if (capoFret > 0) {
          displayChord = fingeringChord;
        } else if (instrumentOffset !== 0) {
          displayChord = writtenChord;
        }

        const displayString = displayChord.toString(viewPreference.chordNotationSystem);
        const soundingDisplayString = effectiveConcertChord.toString(viewPreference.chordNotationSystem);

        derivedChords.push(
          new DerivedChord({
            id: chordEvent.id,
            canonicalChord,
            writtenChord,
            fingeringChord,
            displayString,
            soundingDisplayString,
            startTick: chordEvent.startTick,
            durationTicks: chordEvent.durationTicks,
            measureNumber: chordEvent.measureNumber,
            voice: chordEvent.voice,
          })
        );
      }

      // Proyectar lírica
      const derivedLyrics: DerivedLyric[] = measure.lyrics.map(
        (s) =>
          new DerivedLyric({
            id: s.id,
            text: s.text,
            measureNumber: s.measureNumber,
            tickOffset: s.tickOffset,
            sequenceNumber: s.sequenceNumber,
            isHyphenated: s.isHyphenated,
            boundNoteId: s.boundNoteId,
            chordAbove: s.chordAbove,
          })
      );

      // Proyectar tablatura si fue solicitada y el instrumento tiene afinación
      const derivedTab: TabPosition[] = [];
      if (isTabRequested && instrumentProfile.tuning) {
        for (const note of allMeasureNotes) {
          const tabPos = TablatureCalculator.calculatePosition(
            note.pitch,
            instrumentProfile.tuning,
            capoFret,
            note.durationTicks,
            note.voice
          );
          if (tabPos) {
            derivedTab.push(tabPos);
          } else {
            diagnostics.push({
              severity: 'WARNING',
              code: 'NOTE_OUT_OF_TAB_RANGE',
              message: `La nota ${note.pitch.toString()} en compás ${measure.number} excede el rango de tablatura para ${instrumentProfile.name}.`,
              context: {
                measureNumber: measure.number,
                pitch: note.pitch.toString(),
                midi: note.pitch.midiNumber,
                tuning: instrumentProfile.tuning.name,
              },
            });
          }
        }
      }

      derivedMeasures.push(
        new DerivedMeasure({
          measureNumber: measure.number,
          timeSignature: measure.timeSignature,
          concertKeySignature: concertKeySig,
          writtenKeySignature: writtenKeySig,
          startTick: measure.startTick,
          durationTicks: measure.durationTicks,
          notes: derivedNotes,
          chords: derivedChords,
          lyrics: derivedLyrics,
          tablature: derivedTab,
          clefs: activeClefs,
          repeatStart: measure.repeatStart,
          repeatEnd: measure.repeatEnd,
          repeatCount: measure.repeatCount,
          endingNumber: measure.endingNumber,
        })
      );
    }

    const view = new DerivedMusicalView({
      songTitle: canonicalMusic.title,
      instrumentProfile,
      viewPreference,
      activeRepresentations: requestedReps,
      concertKey: soundingKey,
      writtenKey,
      capoFret,
      measures: derivedMeasures,
      timeline: canonicalMusic.timeline,
      sections: canonicalMusic.sections,
    });

    return {
      status: 'SUCCESS',
      view,
      diagnostics: Object.freeze(diagnostics),
    };
  }

  private static resolveClefs(
    profile: InstrumentProfile,
    preference: ViewPreference,
    requestedReps: readonly ViewRepresentation[]
  ): ClefType[] {
    if (preference.clefOverride) {
      return [preference.clefOverride];
    }
    if (requestedReps.includes('GRAND_STAFF') || profile.staffCount === 2) {
      return ['TREBLE', 'BASS'];
    }
    return [profile.clef];
  }
}
