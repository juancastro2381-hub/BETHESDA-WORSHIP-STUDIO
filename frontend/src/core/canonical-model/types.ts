/**
 * @file types.ts
 * @description Tipos fundamentales, constantes temporales y enumeraciones del modelo canónico musical.
 * Resolución canónica establecida en 480 TPQN (Ticks Per Quarter Note).
 */

/**
 * Resolución temporal canónica obligatoria para todos los cálculos en Bethesda Worship Studio.
 * 480 ticks = 1 negra (quarter note).
 */
export const CANONICAL_TPQN = 480;

/**
 * Constantes de duración estándar en ticks a 480 TPQN.
 */
export const DURATION_TICKS = {
  WHOLE: CANONICAL_TPQN * 4, // 1920
  HALF: CANONICAL_TPQN * 2, // 960
  QUARTER: CANONICAL_TPQN, // 480
  EIGHTH: CANONICAL_TPQN / 2, // 240
  SIXTEENTH: CANONICAL_TPQN / 4, // 120
  THIRTY_SECOND: CANONICAL_TPQN / 8, // 60
  DOTTED_HALF: CANONICAL_TPQN * 3, // 1440
  DOTTED_QUARTER: CANONICAL_TPQN + CANONICAL_TPQN / 2, // 720
  DOTTED_EIGHTH: CANONICAL_TPQN / 2 + CANONICAL_TPQN / 4, // 360
  TRIPLET_QUARTER: (CANONICAL_TPQN * 2) / 3, // 320
  TRIPLET_EIGHTH: CANONICAL_TPQN / 3, // 160
} as const;

/**
 * Secciones canónicas aprobadas en la arquitectura.
 */
export type SectionType =
  | 'INTRO'
  | 'VERSE'
  | 'PRE_CHORUS'
  | 'CHORUS'
  | 'BRIDGE'
  | 'INTERLUDE'
  | 'SOLO'
  | 'INSTRUMENTAL'
  | 'OUTRO'
  | 'ENDING'
  | 'TAG'
  | 'VAMP'
  | 'CUSTOM';

/**
 * Familias de instrumentos musicales soportadas en el arreglo.
 */
export type InstrumentFamily =
  | 'KEYS'
  | 'GUITAR'
  | 'BASS'
  | 'DRUMS'
  | 'VOCALS'
  | 'WOODWINDS'
  | 'BRASS'
  | 'STRINGS'
  | 'OTHER';

/**
 * Claves musicales estándar para renderizado de pentagramas.
 */
export type ClefType =
  | 'TREBLE'
  | 'BASS'
  | 'ALTO'
  | 'TENOR'
  | 'PERCUSSION'
  | 'DOUBLE_TREBLE_BASS';

/**
 * Matices dinámicos tradicionales.
 */
export type DynamicMarking =
  | 'ppp'
  | 'pp'
  | 'p'
  | 'mp'
  | 'mf'
  | 'f'
  | 'ff'
  | 'fff';

/**
 * Articulaciones y expresiones de nota.
 */
export type ArticulationType =
  | 'accent'
  | 'staccato'
  | 'tenuto'
  | 'fermata'
  | 'marcato'
  | 'ghost'
  | 'harmonic';

/**
 * Estados de ligadura (tie) entre notas.
 */
export type TieType = 'START' | 'STOP' | 'CONTINUE' | 'NONE';

/**
 * Dirección de la plica (stem) de la nota.
 */
export type StemDirection = 'UP' | 'DOWN' | 'AUTO';
