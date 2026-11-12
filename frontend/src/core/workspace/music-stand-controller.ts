/**
 * @file music-stand-controller.ts
 * @description Controlador determinista de Modo Atril (Music Stand), resolución de preferencias
 * individuales vs sugerencias por entrada de setlist, y filtrado de cultos/eventos (Fase 2C).
 *
 * Garantías arquitectónicas:
 * - Cero invención musical (Zero-Fabrication): los formatos sugeridos se validan contra el
 *   contenido real del CanonicalMusicPayload mediante computeFormatDefinitions.
 * - Precedencia de preferencias individuales (Sección 4.4): las preferencias del músico
 *   prevalecen en su atril sin mutar el setlist compartido ni afectar a otros músicos.
 */

import type { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import type { InstrumentProfile } from '../projection/instrument-profile.ts';
import type { ViewRepresentation } from '../projection/types.ts';
import type { UserViewPreferenceData } from '../api/preference-types.ts';
import type {
  FrontendReadingFormat,
  FrontendSetlistItem,
  FrontendWorshipService,
} from '../api/setlist-types.ts';
import {
  computeFormatDefinitions,
  type FormatDefinition,
  type ReadingFormatId,
} from '../../components/workspace/reading-format-selector-component.ts';

// ============================================================================
// 1. CONTROLES DE TAMAÑO / ZOOM Y ALTO CONTRASTE DE ATRIL (SECCIÓN 4.5)
// ============================================================================

export const MIN_STAND_ZOOM = 80;
export const MAX_STAND_ZOOM = 160;
export const DEFAULT_STAND_ZOOM = 100;
export const STAND_ZOOM_STEP = 10;

export type StandOrientation = 'LANDSCAPE' | 'PORTRAIT';

export interface MusicStandDisplayState {
  readonly isMusicStandMode: boolean;
  readonly isHighContrast: boolean;
  readonly zoomPercent: number;
}

export function createInitialMusicStandDisplayState(): MusicStandDisplayState {
  return {
    isMusicStandMode: false,
    isHighContrast: false,
    zoomPercent: DEFAULT_STAND_ZOOM,
  };
}

export function clampStandZoom(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_STAND_ZOOM;
  const rounded = Math.round(percent / STAND_ZOOM_STEP) * STAND_ZOOM_STEP;
  return Math.max(MIN_STAND_ZOOM, Math.min(MAX_STAND_ZOOM, rounded));
}

export function zoomInStand(currentPercent: number): number {
  return clampStandZoom(currentPercent + STAND_ZOOM_STEP);
}

export function zoomOutStand(currentPercent: number): number {
  return clampStandZoom(currentPercent - STAND_ZOOM_STEP);
}

export function detectStandOrientation(width: number, height: number): StandOrientation {
  return width >= height ? 'LANDSCAPE' : 'PORTRAIT';
}

// ============================================================================
// 2. MAPEO DE FORMATO DE LECTURA Y PRECEDENCIA DE PREFERENCIAS (SECCIONES 4.3 & 4.4)
// ============================================================================

const READING_FORMAT_TO_SELECTOR_ID: Record<FrontendReadingFormat, ReadingFormatId> = {
  SCORE: 'STAFF_NOTATION',
  CHORD_SHEET: 'CHORD_CHART',
  LYRICS: 'LYRICS_ONLY',
  TAB: 'TABLATURE',
};

const SELECTOR_ID_TO_READING_FORMAT: Record<ReadingFormatId, FrontendReadingFormat> = {
  STAFF_NOTATION: 'SCORE',
  CHORD_CHART: 'CHORD_SHEET',
  LYRICS_ONLY: 'LYRICS',
  TABLATURE: 'TAB',
};

export function readingFormatToSelectorId(format: FrontendReadingFormat): ReadingFormatId {
  return READING_FORMAT_TO_SELECTOR_ID[format];
}

export function selectorIdToReadingFormat(id: ReadingFormatId): FrontendReadingFormat {
  return SELECTOR_ID_TO_READING_FORMAT[id];
}

export interface ResolvedFormatMapping {
  readonly readingFormat: FrontendReadingFormat;
  readonly selectorId: ReadingFormatId;
  readonly label: string;
  readonly primary: ViewRepresentation;
  readonly secondary: ViewRepresentation[];
  readonly isAvailable: boolean;
  readonly unavailabilityReason?: string;
}

/**
 * Evalúa un formato de lectura frente al contenido canónico real de la canción y el instrumento.
 * Nunca fabrica notas, acordes ni tablaturas inexistentes.
 */
export function resolveReadingFormatForSong(
  format: FrontendReadingFormat,
  song: CanonicalMusicPayload,
  instrumentProfile: InstrumentProfile
): ResolvedFormatMapping {
  const definitions: FormatDefinition[] = computeFormatDefinitions(song, instrumentProfile);
  const targetId = READING_FORMAT_TO_SELECTOR_ID[format];
  const matched = definitions.find((d) => d.id === targetId) ?? definitions[0]!;

  return {
    readingFormat: format,
    selectorId: matched.id,
    label: matched.label,
    primary: matched.primary,
    secondary: [...matched.secondary],
    isAvailable: matched.isAvailable,
    ...(matched.unavailabilityReason ? { unavailabilityReason: matched.unavailabilityReason } : {}),
  };
}

export type EffectiveViewSource =
  | 'USER_PREFERENCE'
  | 'SETLIST_SUGGESTION'
  | 'INSTRUMENT_DEFAULT';

export interface EffectiveStandViewResolution {
  readonly source: EffectiveViewSource;
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: ViewRepresentation[];
  readonly suggestedFormat: FrontendReadingFormat | null;
  readonly suggestedFormatAvailable: boolean;
  readonly suggestedFormatReason?: string;
}

/**
 * Resuelve la configuración visual efectiva en el atril respetando la autonomía del músico:
 * 1. Si el músico tiene preferencias guardadas (userPreferences !== null), prevalecen siempre.
 * 2. Si no tiene preferencias guardadas y la entrada del setlist sugiere un formato disponible,
 *    se aplica la sugerencia del director sin mutar el estado global ni las preferencias de otros.
 * 3. En caso contrario, se conserva la representación por defecto del perfil de instrumento.
 */
export function resolveEffectiveStandView(params: {
  readonly userPreferences: UserViewPreferenceData | null;
  readonly setlistItem: FrontendSetlistItem | null;
  readonly song: CanonicalMusicPayload;
  readonly instrumentProfile: InstrumentProfile;
  readonly currentPrimary: ViewRepresentation;
  readonly currentSecondary: readonly ViewRepresentation[];
}): EffectiveStandViewResolution {
  const {
    userPreferences,
    setlistItem,
    song,
    instrumentProfile,
    currentPrimary,
    currentSecondary,
  } = params;

  const suggestedFormat = setlistItem?.preferredFormat ?? null;
  let suggestedFormatAvailable = false;
  let suggestedFormatReason: string | undefined;
  let mappedSuggestion: ResolvedFormatMapping | null = null;

  if (suggestedFormat) {
    mappedSuggestion = resolveReadingFormatForSong(suggestedFormat, song, instrumentProfile);
    suggestedFormatAvailable = mappedSuggestion.isAvailable;
    suggestedFormatReason = mappedSuggestion.unavailabilityReason;
  }

  // Regla 1: Las preferencias individuales del músico prevalecen siempre en su atril
  if (userPreferences !== null) {
    return {
      source: 'USER_PREFERENCE',
      primaryRepresentation: userPreferences.primaryRepresentation as ViewRepresentation,
      secondaryRepresentations: [
        ...(userPreferences.secondaryRepresentations as ViewRepresentation[]),
      ],
      suggestedFormat,
      suggestedFormatAvailable,
      ...(suggestedFormatReason ? { suggestedFormatReason } : {}),
    };
  }

  // Regla 2: Sin preferencia personal, usar sugerencia de la entrada si es compatible con el contenido real
  if (mappedSuggestion && mappedSuggestion.isAvailable) {
    return {
      source: 'SETLIST_SUGGESTION',
      primaryRepresentation: mappedSuggestion.primary,
      secondaryRepresentations: mappedSuggestion.secondary,
      suggestedFormat,
      suggestedFormatAvailable: true,
    };
  }

  // Regla 3: Mantener configuración del instrumento actual
  return {
    source: 'INSTRUMENT_DEFAULT',
    primaryRepresentation: currentPrimary,
    secondaryRepresentations: [...currentSecondary],
    suggestedFormat,
    suggestedFormatAvailable,
    ...(suggestedFormatReason ? { suggestedFormatReason } : {}),
  };
}

// ============================================================================
// 3. FILTRADO DE CULTOS Y SERVICIOS LITÚRGICOS (SECCIÓN 4.1)
// ============================================================================

export type WorshipServiceFilterTab = 'UPCOMING' | 'DRAFT' | 'COMPLETED' | 'ALL';

export function filterWorshipServices(
  services: readonly FrontendWorshipService[],
  tab: WorshipServiceFilterTab,
  categoryFilter?: string,
  nowMs: number = Date.now()
): FrontendWorshipService[] {
  const normalizedCategory = categoryFilter?.trim().toLowerCase() ?? '';

  return services.filter((svc) => {
    if (normalizedCategory && !svc.serviceType.toLowerCase().includes(normalizedCategory)) {
      return false;
    }

    if (tab === 'DRAFT') {
      return svc.status === 'DRAFT';
    }

    if (tab === 'COMPLETED') {
      return svc.status === 'COMPLETED' || svc.status === 'ARCHIVED';
    }

    if (tab === 'UPCOMING') {
      if (svc.status === 'UPCOMING' || svc.status === 'ACTIVE') return true;
      if (svc.status === 'COMPLETED' || svc.status === 'ARCHIVED') return false;
      const scheduledTime = new Date(svc.scheduledAt).getTime();
      return Number.isFinite(scheduledTime) && scheduledTime >= nowMs;
    }

    return true;
  });
}

