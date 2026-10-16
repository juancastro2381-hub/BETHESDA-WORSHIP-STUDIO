/**
 * @file preference-types.ts
 * @description Tipos TypeScript para el consumo del endpoint de preferencias de vista de usuario (Fase 3A).
 * Totalmente alineado con los esquemas de backend Zod de WP-02 y el modelo de proyección canónico.
 */

import { type ChordNotationSystem, type ViewRepresentation } from '../projection/types.ts';
import { type ClefType } from '../canonical-model/types.ts';

export interface UserViewPreferenceData {
  readonly id?: string | undefined;
  readonly userId: string;
  readonly instrumentId: string;
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly chordNotationSystem: ChordNotationSystem;
  readonly transpositionSemitones: number;
  readonly capoFret: number;
  readonly clefOverride: ClefType | null;
  readonly preferFlats: boolean;
  readonly isDefault?: boolean | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface UpdateUserViewPreferencePayload {
  readonly instrumentId: string;
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations?: readonly ViewRepresentation[] | undefined;
  readonly chordNotationSystem?: ChordNotationSystem | undefined;
  readonly transpositionSemitones?: number | undefined;
  readonly capoFret?: number | undefined;
  readonly clefOverride?: ClefType | null | undefined;
  readonly preferFlats?: boolean | undefined;
}

export interface GetUserPreferencesResponse {
  readonly success: boolean;
  readonly data: UserViewPreferenceData;
}

export interface UpdateUserPreferencesResponse {
  readonly success: boolean;
  readonly data: UserViewPreferenceData;
}
