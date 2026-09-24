/**
 * @file types.ts
 * @description Definiciones de tipos y contratos para la capa de transformación musical
 * y proyección de atril por instrumento (Fase 1D).
 */

import { type Pitch } from '../music-theory/pitch.ts';
import { type ClefType } from '../canonical-model/types.ts';

/**
 * Representaciones visuales de partitura admitidas por el dominio.
 * Invariante arquitectónico: Instrumento ≠ Vista.
 */
export type ViewRepresentation =
  | 'STANDARD_NOTATION'
  | 'TABLATURE'
  | 'CHORDS'
  | 'LYRICS'
  | 'PERCUSSION_NOTATION'
  | 'GRAND_STAFF'
  | 'SECTION_MARKERS';

/**
 * Sistema de nomenclatura para visualización de acordes.
 * STANDARD = Cifrado Americano (C, D, E, F, G, A, B)
 * LATIN = Solfeo Latino (Do, Re, Mi, Fa, Sol, La, Si)
 */
export type ChordNotationSystem = 'STANDARD' | 'LATIN';

/**
 * Afinación para instrumentos de cuerda con tablatura (guitarra, bajo).
 */
export interface TuningDefinition {
  readonly id: string;
  readonly name: string;
  /**
   * Alturas canónicas de cada cuerda al aire, ordenadas de la primera (más aguda)
   * a la última (más grave).
   * Ej. Guitarra estándar: [E4, B3, G3, D3, A2, E2] (cuerdas 1 a 6).
   */
  readonly stringPitches: readonly Pitch[];
}

/**
 * Coordenada de tablatura proyectada para una nota musical.
 */
export interface TabPosition {
  /** Número de cuerda (1-indexed: 1 = cuerda más aguda) */
  readonly stringNumber: number;
  /** Número de traste digitado (0 = al aire; con cejilla, relativo al traste de cejilla) */
  readonly fret: number;
  /** Altura canónica real */
  readonly canonicalPitch: Pitch;
  /** Duración en ticks del evento */
  readonly durationTicks: number;
  /** Voz polifónica */
  readonly voice: number;
  /** Referencia de la afinación utilizada */
  readonly tuningReference: string;
}

/**
 * Diagnóstico estructurado de proyección (errores de capacidad, advertencias de rango).
 */
export interface ProjectionDiagnostic {
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
  readonly code: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Estado del resultado de la proyección.
 */
export type ProjectionStatus = 'SUCCESS' | 'UNSUPPORTED_VIEW' | 'ERROR';
