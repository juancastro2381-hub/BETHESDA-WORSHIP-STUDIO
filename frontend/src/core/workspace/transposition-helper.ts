/**
 * @file transposition-helper.ts
 * @description Cálculo analítico de transposición litúrgica para el atril (Fase 2C — WS6).
 *
 * Utiliza exclusivamente las abstracciones canónicas del dominio:
 * - MusicalKey.parse() de musical-key.ts
 * - PitchClass de pitch-class.ts
 * - shortestDistanceTo() en aritmética modular [-6, +6]
 *
 * INVARIANTE NO NEGOCIABLE:
 * - Esta función es un cálculo puro de proyección en tiempo de ejecución.
 * - Cero mutaciones sobre CanonicalMusicPayload.
 * - Cero mutaciones en la base de datos PostgreSQL.
 */

import { MusicalKey } from '../music-theory/musical-key.ts';

/**
 * Calcula el desplazamiento óptimo en semitonos [-6, +6] entre dos tonalidades.
 *
 * @param sourceKeyStr Tonalidad de origen (por defecto de la canción canónica, ej. "G")
 * @param targetKeyStr Tonalidad objetivo solicitada en el setlist (ej. "A", "Bb")
 * @returns Desplazamiento en semitonos (ej. +2, -3) o 0 si falta alguna clave o es inválida
 */
export function calculateTranspositionSemitones(
  sourceKeyStr: string | null | undefined,
  targetKeyStr: string | null | undefined
): number {
  if (!sourceKeyStr || !targetKeyStr) {
    return 0;
  }

  const trimmedSource = sourceKeyStr.trim();
  const trimmedTarget = targetKeyStr.trim();

  if (!trimmedSource || !trimmedTarget) {
    return 0;
  }

  try {
    const sourceKey = MusicalKey.parse(trimmedSource);
    const targetKey = MusicalKey.parse(trimmedTarget);

    const sourcePc = sourceKey.tonic.toPitchClass();
    const targetPc = targetKey.tonic.toPitchClass();

    return sourcePc.shortestDistanceTo(targetPc);
  } catch {
    // Fallback determinista y seguro ante claves corruptas o no estándar
    return 0;
  }
}
