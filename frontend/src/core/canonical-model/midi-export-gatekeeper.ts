/**
 * @file midi-export-gatekeeper.ts
 * @description Guardián multi-factor de exportación MIDI con política Fail-Closed (Fase 2B.2).
 *
 * Exige:
 * 1. Existencia de notas melódicas (Principio de CERO Fabricación).
 * 2. Asignación completa de timing numérico (prohíbe exportación de scores o tablaturas no medidas con ticks nulos).
 * 3. Aprobación rigurosa de validación temporal (sin colisiones ni desórdenes cronológicos).
 * 4. Rango de alturas MIDI 0..127 y duraciones > 0 para todas las notas.
 */

import { type CanonicalMusicPayload } from './canonical-music-payload.ts';
import { type TemporalValidationIssue, TemporalValidator } from './temporal-validator.ts';

export interface MidiExportEligibilityResult {
  eligible: boolean;
  reason?: string;
  code?: string;
  issues?: TemporalValidationIssue[];
}

export class MidiExportGatekeeper {
  public static isEligible(score: CanonicalMusicPayload): MidiExportEligibilityResult {
    if (!score || !score.measures) {
      return { eligible: false, reason: 'Payload musical inválido o inexistente.', code: 'INVALID_PAYLOAD' };
    }

    const allNotes = score.getAllNotes();
    if (allNotes.length === 0) {
      return {
        eligible: false,
        reason: 'El documento canónico no contiene notas ni alturas melódicas (CERO invención de notas).',
        code: 'CANNOT_EXPORT_MIDI_WITHOUT_NOTES',
      };
    }

    // Factor 1: Rhythmic Provenance & Timing Completeness Gate
    const hasUnassignedTiming = allNotes.some(
      (n) => n.startTick === null || n.durationTicks === null
    );
    const rhythmicProv = (score.metadata as Record<string, unknown> | undefined)?.rhythmicProvenance;
    if (hasUnassignedTiming || rhythmicProv === 'NONE' || rhythmicProv === 'PARTIALLY_MEASURED') {
      return {
        eligible: false,
        reason:
          'Tablaturas o partituras con métrica no asignada o incompleta (unmeasured / partially measured / rhythmicProvenance NONE) no pueden ser exportadas a MIDI sin alineación temporal explícita para todas las notas.',
        code: 'BLOCKED_ZERO_FABRICATION',
      };
    }

    // Factor 2: Temporal Validation Gate
    const validation = TemporalValidator.validate(score, {
      allowGapsAsImplicitRests: false,
      strictPickupRules: true,
      enforceMidiExportBounds: true,
    });

    if (!validation.isStructurallyValid) {
      return {
        eligible: false,
        reason: 'Estructura musical inválida para exportación MIDI.',
        code: 'STRUCTURAL_VALIDATION_FAILED',
        issues: validation.issues,
      };
    }

    if (!validation.isTemporallyComplete) {
      return {
        eligible: false,
        reason:
          'Tablaturas o partituras con métrica no asignada o incompleta (unmeasured / partially measured) no pueden ser exportadas a MIDI sin alineación temporal explícita.',
        code: 'BLOCKED_ZERO_FABRICATION',
        issues: validation.issues,
      };
    }

    if (!validation.isTemporallyValid) {
      const firstError = validation.issues.find((i) => i.severity === 'ERROR');
      return {
        eligible: false,
        reason: `Validación temporal fallida: ${firstError?.message ?? 'Inconsistencias temporales detectadas.'}`,
        code: firstError?.code ?? 'TEMPORAL_VALIDATION_FAILED',
        issues: validation.issues,
      };
    }

    if (!validation.isMidiEligible) {
      const firstError = validation.issues.find((i) => i.severity === 'ERROR');
      return {
        eligible: false,
        reason:
          firstError?.message ??
          'El documento musical no cumple con los límites físicos para exportación MIDI (0-127).',
        code: firstError?.code ?? 'MIDI_EXPORT_INELIGIBLE',
        issues: validation.issues,
      };
    }

    // Factor 3: Pitch & Duration Range Gate
    for (const note of allNotes) {
      if (note.startTick === null || note.durationTicks === null) {
        return {
          eligible: false,
          reason: `Nota ${note.id} no posee timing asignado.`,
          code: 'MIDI_INVALID_NOTE_TIMING',
        };
      }
      const midiNum = note.pitch?.midiNumber;
      if (midiNum === undefined || midiNum < 0 || midiNum > 127) {
        return {
          eligible: false,
          reason: `Tono MIDI ${midiNum} fuera del rango físico representable (0-127). CERO fabricación: se prohíbe el clamping que alteraría la altura musical.`,
          code: 'MIDI_PITCH_OUT_OF_RANGE',
        };
      }
      if (note.durationTicks <= 0) {
        return {
          eligible: false,
          reason: `Nota ${note.id} tiene duración no positiva: ${note.durationTicks}.`,
          code: 'MIDI_INVALID_NOTE_DURATION',
        };
      }
    }

    return { eligible: true };
  }
}
