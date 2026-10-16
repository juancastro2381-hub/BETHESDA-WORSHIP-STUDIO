/**
 * @file user-preferences.schemas.ts
 * @description Esquemas Zod y validaciones de compatibilidad para preferencias de visualización (Fase 3A — WP-02).
 * Aplica DEC-02, DEC-03, DEC-04 y DEC-05, asegurando invariantes musicales entre instrumentos y representaciones.
 */

import { z } from 'zod';
import type { UserRole } from '../../../domain/auth-types.ts';

/**
 * Las 7 representaciones visuales canónicas del sistema de proyección.
 */
export const ViewRepresentationEnum = z.enum([
  'STANDARD_NOTATION',
  'TABLATURE',
  'CHORDS',
  'LYRICS',
  'PERCUSSION_NOTATION',
  'GRAND_STAFF',
  'SECTION_MARKERS',
]);

export type ViewRepresentation = z.infer<typeof ViewRepresentationEnum>;

/**
 * Sistemas de notación armónica soportados.
 */
export const ChordNotationSystemEnum = z.enum(['STANDARD', 'LATIN']);

export type ChordNotationSystem = z.infer<typeof ChordNotationSystemEnum>;

/**
 * Los 6 tipos de clave musicales canónicos alineados con CanonicalModel.
 */
export const ClefTypeEnum = z.enum([
  'TREBLE',
  'BASS',
  'ALTO',
  'TENOR',
  'PERCUSSION',
  'DOUBLE_TREBLE_BASS',
]);

export type ClefType = z.infer<typeof ClefTypeEnum>;

/**
 * Matriz de representaciones soportadas por cada uno de los 12 perfiles de instrumento registrados.
 * Fuente autoritativa: frontend/src/core/projection/instrument-profile.ts
 */
export const INSTRUMENT_SUPPORTED_VIEWS: Record<string, ViewRepresentation[]> = {
  acoustic_guitar: ['STANDARD_NOTATION', 'TABLATURE', 'CHORDS', 'LYRICS', 'SECTION_MARKERS'],
  electric_guitar: ['STANDARD_NOTATION', 'TABLATURE', 'CHORDS', 'LYRICS', 'SECTION_MARKERS'],
  bass: ['STANDARD_NOTATION', 'TABLATURE', 'CHORDS', 'LYRICS', 'SECTION_MARKERS'],
  acoustic_piano: ['GRAND_STAFF', 'STANDARD_NOTATION', 'CHORDS', 'LYRICS', 'SECTION_MARKERS'],
  keyboard: ['GRAND_STAFF', 'STANDARD_NOTATION', 'CHORDS', 'LYRICS', 'SECTION_MARKERS'],
  drums: ['PERCUSSION_NOTATION', 'LYRICS', 'SECTION_MARKERS'],
  alto_sax: ['STANDARD_NOTATION', 'CHORDS', 'SECTION_MARKERS'],
  tenor_sax: ['STANDARD_NOTATION', 'CHORDS', 'SECTION_MARKERS'],
  trumpet: ['STANDARD_NOTATION', 'CHORDS', 'SECTION_MARKERS'],
  lead_vocal: ['STANDARD_NOTATION', 'LYRICS', 'CHORDS', 'SECTION_MARKERS'],
  backing_vocal: ['STANDARD_NOTATION', 'LYRICS', 'CHORDS', 'SECTION_MARKERS'],
  generic: ['STANDARD_NOTATION', 'CHORDS', 'LYRICS', 'SECTION_MARKERS'],
};

/**
 * Esquema de validación para la actualización/creación de preferencias del usuario autenticado (PUT /me/preferences).
 */
export const UpdateUserPreferencesBodySchema = z
  .object({
    instrumentId: z
      .string({ required_error: 'El identificador de instrumento (instrumentId) es requerido.' })
      .trim()
      .min(1, 'El instrumentId no puede estar vacío.')
      .max(64, 'El instrumentId no debe superar 64 caracteres.'),
    primaryRepresentation: ViewRepresentationEnum,
    secondaryRepresentations: z.array(ViewRepresentationEnum).default([]),
    chordNotationSystem: ChordNotationSystemEnum.default('STANDARD'),
    transpositionSemitones: z
      .number({ invalid_type_error: 'transpositionSemitones debe ser un número entero.' })
      .int('transpositionSemitones debe ser un entero.')
      .min(-12, 'La transposición mínima es -12 semitonos.')
      .max(12, 'La transposición máxima es +12 semitonos.')
      .default(0),
    capoFret: z
      .number({ invalid_type_error: 'capoFret debe ser un número entero.' })
      .int('capoFret debe ser un entero.')
      .min(0, 'El traste de cejilla (capoFret) mínimo es 0.')
      .max(12, 'El traste de cejilla (capoFret) máximo es 12.')
      .default(0),
    clefOverride: ClefTypeEnum.nullable().optional(),
    preferFlats: z.boolean().default(false),
  })
  .refine(
    (data) => {
      const allowed = INSTRUMENT_SUPPORTED_VIEWS[data.instrumentId];
      if (!allowed) {
        return false;
      }
      return allowed.includes(data.primaryRepresentation);
    },
    {
      message: 'La representación principal solicitada no es compatible con el instrumento seleccionado.',
      path: ['primaryRepresentation'],
    }
  )
  .refine(
    (data) => {
      const allowed = INSTRUMENT_SUPPORTED_VIEWS[data.instrumentId];
      if (!allowed) {
        return false;
      }
      for (const sec of data.secondaryRepresentations) {
        if (!allowed.includes(sec)) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Una o más representaciones secundarias no son compatibles con el instrumento seleccionado.',
      path: ['secondaryRepresentations'],
    }
  );

export type UpdateUserPreferencesBody = z.infer<typeof UpdateUserPreferencesBodySchema>;

/**
 * Esquema de salida para las preferencias del usuario.
 */
export const UserPreferencesDataSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  instrumentId: z.string(),
  primaryRepresentation: ViewRepresentationEnum,
  secondaryRepresentations: z.array(ViewRepresentationEnum),
  chordNotationSystem: ChordNotationSystemEnum,
  transpositionSemitones: z.number().int(),
  capoFret: z.number().int(),
  clefOverride: ClefTypeEnum.nullable().optional(),
  preferFlats: z.boolean(),
  isDefault: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type UserPreferencesData = z.infer<typeof UserPreferencesDataSchema>;

export const UserPreferencesResponseSchema = z.object({
  success: z.boolean(),
  data: UserPreferencesDataSchema,
});

export type UserPreferencesResponse = z.infer<typeof UserPreferencesResponseSchema>;

/**
 * Estructura de valores por defecto de fábrica según rol.
 */
export interface RoleFactoryDefault {
  instrumentId: string;
  primaryRepresentation: ViewRepresentation;
  secondaryRepresentations: ViewRepresentation[];
  chordNotationSystem: ChordNotationSystem;
  transpositionSemitones: number;
  capoFret: number;
  clefOverride: null;
  preferFlats: boolean;
}

/**
 * Computa las preferencias de fábrica canónicas basadas en el rol del usuario.
 * Aplicación de decisiones de gobernanza:
 * - DEC-03: ADMIN y SUPER_ADMIN -> acoustic_guitar, CHORDS, ['LYRICS']
 * - DEC-04: WORSHIP_LEADER -> acoustic_guitar, CHORDS, ['LYRICS']
 * - DEC-05: VIEWER -> lead_vocal, LYRICS, ['CHORDS']
 * - DEC-02: MUSICIAN -> acoustic_guitar, CHORDS, ['LYRICS']
 */
export function getRoleFactoryDefault(role: UserRole | string): RoleFactoryDefault {
  switch (role) {
    case 'ADMIN':
    case 'SUPER_ADMIN':
      return {
        instrumentId: 'acoustic_guitar',
        primaryRepresentation: 'CHORDS',
        secondaryRepresentations: ['LYRICS'],
        chordNotationSystem: 'STANDARD',
        transpositionSemitones: 0,
        capoFret: 0,
        clefOverride: null,
        preferFlats: false,
      };
    case 'WORSHIP_LEADER':
      return {
        instrumentId: 'acoustic_guitar',
        primaryRepresentation: 'CHORDS',
        secondaryRepresentations: ['LYRICS'],
        chordNotationSystem: 'STANDARD',
        transpositionSemitones: 0,
        capoFret: 0,
        clefOverride: null,
        preferFlats: false,
      };
    case 'VIEWER':
      return {
        instrumentId: 'lead_vocal',
        primaryRepresentation: 'LYRICS',
        secondaryRepresentations: ['CHORDS'],
        chordNotationSystem: 'STANDARD',
        transpositionSemitones: 0,
        capoFret: 0,
        clefOverride: null,
        preferFlats: false,
      };
    case 'MUSICIAN':
    default:
      return {
        instrumentId: 'acoustic_guitar',
        primaryRepresentation: 'CHORDS',
        secondaryRepresentations: ['LYRICS'],
        chordNotationSystem: 'STANDARD',
        transpositionSemitones: 0,
        capoFret: 0,
        clefOverride: null,
        preferFlats: false,
      };
  }
}
