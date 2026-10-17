/**
 * @file workspace-orchestrator.ts
 * @description Orquestador determinista y funciones puras de transición para el Musical Workspace (Fase 1G).
 *
 * Desacoplado de React para permitir:
 * 1. Pruebas unitarias puras y deterministas en Node.js sin mocks complejos de DOM.
 * 2. Cero duplicación de la verdad musical canónica.
 * 3. Consistencia matemática y musical en las transiciones de estado de presentación.
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { InstrumentRegistry, type InstrumentProfile } from '../projection/instrument-profile.ts';
import { ProjectionService } from '../projection/projection-service.ts';
import { type ChordNotationSystem, type ViewRepresentation } from '../projection/types.ts';
import { ViewPreference } from '../projection/view-preference.ts';
import { RendererRegistry } from '../rendering/renderer-registry.ts';
import { type RendererId } from '../rendering/types.ts';
import { GOLDEN_SCENARIO_PRESETS } from './presets.ts';
import {
  type GoldenScenarioId,
  type InstrumentId,
  type IWorkspaceState,
  type IWorkspaceViewResult,
  type ScenarioPreset,
  type WorkspaceDiagnostic,
} from './types.ts';
import { type UserViewPreferenceData } from '../api/preference-types.ts';

const defaultInstrumentRegistry = new InstrumentRegistry();
const defaultRendererRegistry = new RendererRegistry();

/**
 * Consulta si un perfil de instrumento soporta el uso de cejilla (Capo).
 */
export function instrumentSupportsCapo(profile: InstrumentProfile): boolean {
  return profile.tuning !== undefined && (profile.family === 'GUITAR' || profile.family === 'BASS');
}

/**
 * Genera el estado inicial del Workspace basado en un Preset Dorado o por defecto Escenario A.
 */
export function createInitialWorkspaceState(presetId: GoldenScenarioId = 'SCENARIO_A'): IWorkspaceState {
  const preset = GOLDEN_SCENARIO_PRESETS[presetId];
  return {
    selectedInstrumentId: preset.instrumentId,
    primaryRepresentation: preset.primaryRepresentation,
    secondaryRepresentations: preset.secondaryRepresentations,
    capoFret: preset.capoFret,
    transpositionSemitones: preset.transpositionSemitones,
    chordNotationSystem: preset.chordNotationSystem,
    forcedRendererId: preset.preferredRendererId,
    activePresetId: preset.id,
  };
}

/**
 * Transición de estado al cambiar de instrumento:
 * Filtra dinámicamente representaciones incompatibles y restablece el capo si no es soportado.
 */
export function transitionSelectInstrument(
  current: IWorkspaceState,
  targetProfile: InstrumentProfile
): IWorkspaceState {
  let newPrimary = current.primaryRepresentation;
  if (!targetProfile.isRepresentationSupported(newPrimary)) {
    newPrimary = Array.from(targetProfile.supportedRepresentations)[0] ?? 'CHORDS';
  }

  const newSecondary = current.secondaryRepresentations.filter(
    (r) => targetProfile.isRepresentationSupported(r) && r !== newPrimary
  );

  const newCapo = instrumentSupportsCapo(targetProfile) ? current.capoFret : 0;

  return {
    ...current,
    selectedInstrumentId: targetProfile.id,
    primaryRepresentation: newPrimary,
    secondaryRepresentations: newSecondary,
    capoFret: newCapo,
    activePresetId: 'CUSTOM',
  };
}

/**
 * Transición al cambiar la representación primaria:
 * La remueve de las secundarias si estaba presente.
 */
export function transitionSetPrimary(
  current: IWorkspaceState,
  representation: ViewRepresentation,
  profile: InstrumentProfile
): IWorkspaceState {
  if (!profile.isRepresentationSupported(representation)) {
    // Si no es soportada, no se aplica o se mantiene la actual
    return current;
  }

  const newSecondary = current.secondaryRepresentations.filter((r) => r !== representation);
  return {
    ...current,
    primaryRepresentation: representation,
    secondaryRepresentations: newSecondary,
    activePresetId: 'CUSTOM',
  };
}

/**
 * Transición al alternar una representación secundaria:
 * Solo se permite si el instrumento la soporta y no es la primaria.
 */
export function transitionToggleSecondary(
  current: IWorkspaceState,
  representation: ViewRepresentation,
  profile: InstrumentProfile
): IWorkspaceState {
  if (representation === current.primaryRepresentation) {
    return current;
  }
  if (!profile.isRepresentationSupported(representation)) {
    return current;
  }

  const exists = current.secondaryRepresentations.includes(representation);
  const newSecondary = exists
    ? current.secondaryRepresentations.filter((r) => r !== representation)
    : [...current.secondaryRepresentations, representation];

  return {
    ...current,
    secondaryRepresentations: newSecondary,
    activePresetId: 'CUSTOM',
  };
}

/**
 * Transición al modificar la cejilla (Capo):
 * Solo se aplica si el instrumento soporta cejilla; de lo contrario se fija en 0.
 */
export function transitionSetCapo(
  current: IWorkspaceState,
  fret: number,
  profile: InstrumentProfile
): IWorkspaceState {
  const safeFret = instrumentSupportsCapo(profile) ? Math.max(0, Math.min(12, fret)) : 0;
  return {
    ...current,
    capoFret: safeFret,
    activePresetId: 'CUSTOM',
  };
}

/**
 * Transición al modificar la transposición por semitonos (-11 a +11).
 */
export function transitionSetTransposition(current: IWorkspaceState, semitones: number): IWorkspaceState {
  const clamped = Math.max(-11, Math.min(11, semitones));
  return {
    ...current,
    transpositionSemitones: clamped,
    activePresetId: 'CUSTOM',
  };
}

/**
 * Transición al cambiar el sistema de notación de acordes (STANDARD vs LATIN).
 */
export function transitionSetChordNotation(
  current: IWorkspaceState,
  system: ChordNotationSystem
): IWorkspaceState {
  return {
    ...current,
    chordNotationSystem: system,
    activePresetId: 'CUSTOM',
  };
}

/**
 * Transición al aplicar un Preset de Escenario Dorado.
 */
export function transitionApplyPreset(preset: ScenarioPreset): IWorkspaceState {
  return {
    selectedInstrumentId: preset.instrumentId,
    primaryRepresentation: preset.primaryRepresentation,
    secondaryRepresentations: preset.secondaryRepresentations,
    capoFret: preset.capoFret,
    transpositionSemitones: preset.transpositionSemitones,
    chordNotationSystem: preset.chordNotationSystem,
    forcedRendererId: preset.preferredRendererId,
    activePresetId: preset.id,
  };
}

export interface EffectiveViewResult {
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly isFallbackApplied: boolean;
  readonly fallbackReason?: string;
}

/**
 * Resuelve de forma determinista y segura la representación efectiva de lectura musical
 * basada en el contenido REAL de la canción (CERO invención de notas) y el perfil del instrumento.
 *
 * Si la representación solicitada no puede ser satisfecha por los datos reales de la canción
 * (por ejemplo, STANDARD_NOTATION en un Lead Sheet con 0 notas melódicas), aplica un fallback seguro
 * sin corromper ni sobrescribir la preferencia almacenada del usuario (F-04).
 */
export function resolveEffectiveViewRepresentation(
  song: CanonicalMusicPayload,
  instrumentProfile: InstrumentProfile,
  requestedPrimary: ViewRepresentation,
  requestedSecondary: readonly ViewRepresentation[] = []
): EffectiveViewResult {
  // Inspección del contenido canónico de la canción (CERO invención de contenido).
  // Se utiliza getAllNotes() para asegurar que los silencios (Rest) NUNCA se cuenten como notas (F-03).
  const totalNotes = song.measures.reduce((acc, m) => acc + m.getAllNotes().length, 0);
  const totalChords = song.measures.reduce((acc, m) => acc + m.chords.length, 0);
  const totalLyrics = song.measures.reduce((acc, m) => acc + m.lyrics.length, 0);

  const hasNotes = totalNotes > 0;
  const hasChords = totalChords > 0;
  const hasLyrics = totalLyrics > 0;

  // 1. Verificar si la representación primaria solicitada es directamente soportada
  let isPrimarySupported = false;
  let reason = '';

  if (requestedPrimary === 'STANDARD_NOTATION' || requestedPrimary === 'GRAND_STAFF') {
    if (!instrumentProfile.isRepresentationSupported(requestedPrimary)) {
      reason = `El instrumento "${instrumentProfile.name}" no soporta notación en pentagrama.`;
    } else if (!hasNotes) {
      reason = 'La canción no contiene notas melódicas registradas (Lead Sheet puro).';
    } else {
      isPrimarySupported = true;
    }
  } else if (requestedPrimary === 'TABLATURE') {
    if (instrumentProfile.tuning === undefined) {
      reason = 'El instrumento no es de cuerda afinada (requiere Guitarra o Bajo).';
    } else if (!instrumentProfile.isRepresentationSupported('TABLATURE')) {
      reason = 'El perfil del instrumento no tiene habilitada tablatura.';
    } else if (!hasNotes) {
      reason = 'La canción no contiene notas melódicas para calcular digitación en trastes.';
    } else {
      isPrimarySupported = true;
    }
  } else if (requestedPrimary === 'CHORDS') {
    if (!instrumentProfile.isRepresentationSupported('CHORDS')) {
      reason = `El instrumento "${instrumentProfile.name}" no soporta cifrado.`;
    } else if (!hasChords) {
      reason = 'La canción no contiene acordes de cifrado armónico.';
    } else {
      isPrimarySupported = true;
    }
  } else if (requestedPrimary === 'LYRICS') {
    if (!instrumentProfile.isRepresentationSupported('LYRICS')) {
      reason = `El instrumento "${instrumentProfile.name}" no soporta capa de letra.`;
    } else if (!hasLyrics) {
      reason = 'La canción no contiene texto lírico.';
    } else {
      isPrimarySupported = true;
    }
  }

  if (isPrimarySupported) {
    const validSecondary = requestedSecondary.filter((s) => {
      if (s === requestedPrimary) return false;
      if (!instrumentProfile.isRepresentationSupported(s)) return false;
      if (s === 'LYRICS' && !hasLyrics) return false;
      if (s === 'CHORDS' && !hasChords) return false;
      if (s === 'TABLATURE' && (!hasNotes || instrumentProfile.tuning === undefined)) return false;
      if ((s === 'STANDARD_NOTATION' || s === 'GRAND_STAFF') && !hasNotes) return false;
      return true;
    });

    return {
      primaryRepresentation: requestedPrimary,
      secondaryRepresentations: validSecondary,
      isFallbackApplied: false,
    };
  }

  // 2. Si no es soportada por el contenido o instrumento, calcular Fallback Seguro
  // Orden jerárquico determinista:
  // A. Cifrado con Letra (si tiene acordes y letra, y el instrumento los soporta)
  if (
    instrumentProfile.isRepresentationSupported('CHORDS') &&
    hasChords &&
    hasLyrics &&
    instrumentProfile.isRepresentationSupported('LYRICS')
  ) {
    return {
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS', 'SECTION_MARKERS'],
      isFallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // B. Cifrado Solo (si tiene acordes y no letra)
  if (instrumentProfile.isRepresentationSupported('CHORDS') && hasChords) {
    return {
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['SECTION_MARKERS'],
      isFallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // C. Letra Sola (si tiene letra)
  if (instrumentProfile.isRepresentationSupported('LYRICS') && hasLyrics) {
    return {
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['SECTION_MARKERS'],
      isFallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // D. Partitura tradicional (si tiene notas)
  const isGrandStaff = instrumentProfile.isRepresentationSupported('GRAND_STAFF');
  const staffRep: ViewRepresentation = isGrandStaff ? 'GRAND_STAFF' : 'STANDARD_NOTATION';
  if (hasNotes && instrumentProfile.isRepresentationSupported(staffRep)) {
    return {
      primaryRepresentation: staffRep,
      secondaryRepresentations: hasChords ? ['CHORDS'] : [],
      isFallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // E. Fallback canónico por defecto del instrumento
  const defaultRep = Array.from(instrumentProfile.supportedRepresentations)[0] ?? 'CHORDS';
  return {
    primaryRepresentation: defaultRep,
    secondaryRepresentations: [],
    isFallbackApplied: true,
    fallbackReason: reason,
  };
}

/**
 * Orquesta la proyección y resolución del renderizador para el estado actual del Workspace.
 * Función pura y determinista: dado el mismo (song, state), produce exactamente el mismo IWorkspaceViewResult.
 */
export function orchestrateWorkspaceView(
  activeSong: CanonicalMusicPayload,
  state: IWorkspaceState,
  instrumentRegistry: InstrumentRegistry = defaultInstrumentRegistry,
  rendererRegistry: RendererRegistry = defaultRendererRegistry
): IWorkspaceViewResult {
  const instrumentProfile = instrumentRegistry.getOrThrow(state.selectedInstrumentId);
  const supportedRepresentations = Array.from(instrumentProfile.supportedRepresentations);
  const availableInstruments = instrumentRegistry.getAll();

  // Resolución determinista de representación efectiva con fallback seguro (F-04)
  const effective = resolveEffectiveViewRepresentation(
    activeSong,
    instrumentProfile,
    state.primaryRepresentation,
    state.secondaryRepresentations
  );

  const viewPreference = new ViewPreference({
    instrumentId: state.selectedInstrumentId,
    primaryRepresentation: effective.primaryRepresentation,
    secondaryRepresentations: [...effective.secondaryRepresentations],
    capoFret: state.capoFret,
    transpositionSemitones: state.transpositionSemitones,
    chordNotationSystem: state.chordNotationSystem,
  });

  const projectionResult = ProjectionService.project(activeSong, instrumentProfile, viewPreference);

  const diagnostics: WorkspaceDiagnostic[] = [];

  // Diagnóstico de fallback de vista aplicado (F-04)
  if (effective.isFallbackApplied) {
    diagnostics.push({
      source: 'WORKSPACE',
      severity: 'INFO',
      code: 'VIEW_FALLBACK_APPLIED',
      message: `Fallback de vista aplicado: "${state.primaryRepresentation}" no está soportado por el contenido de la canción (${effective.fallbackReason}). Mostrando "${effective.primaryRepresentation}".`,
    });
  }

  // Diagnóstico de canción vacía
  if (activeSong.measures.length === 0) {
    diagnostics.push({
      source: 'WORKSPACE',
      severity: 'WARNING',
      code: 'EMPTY_SONG_NO_MEASURES',
      message: 'La canción activa no contiene compases musicales ni estructura.',
    });
  }

  // Diagnósticos de la proyección
  for (const d of projectionResult.diagnostics) {
    diagnostics.push({
      source: 'PROJECTION',
      severity: d.severity,
      code: d.code,
      message: d.message,
    });
  }

  // Resolución de renderizador
  let activeRendererId: RendererId | null = null;
  if (projectionResult.view) {
    const activeReps = projectionResult.view.activeRepresentations;
    if (state.forcedRendererId && !effective.isFallbackApplied) {
      const forced = rendererRegistry.get(state.forcedRendererId);
      if (forced && forced.capabilities.canRender(activeReps)) {
        activeRendererId = state.forcedRendererId;
      } else {
        diagnostics.push({
          source: 'RENDERER',
          severity: 'WARNING',
          code: 'FORCED_RENDERER_INCOMPATIBLE',
          message: `El renderizador forzado "${state.forcedRendererId}" no soporta las representaciones [${activeReps.join(', ')}]. Se usará selección por capacidades.`,
        });
        const best = rendererRegistry.selectBestRenderer(activeReps);
        activeRendererId = best?.id ?? null;
      }
    } else {
      const best = rendererRegistry.selectBestRenderer(activeReps);
      activeRendererId = best?.id ?? null;
    }

    if (!activeRendererId) {
      diagnostics.push({
        source: 'RENDERER',
        severity: 'ERROR',
        code: 'NO_COMPATIBLE_RENDERER',
        message: `No se encontró ningún motor de renderizado compatible con las representaciones: ${activeReps.join(', ')}`,
      });
    }
  }

  return {
    activeSong,
    state: effective.isFallbackApplied
      ? {
          ...state,
          primaryRepresentation: effective.primaryRepresentation,
          secondaryRepresentations: effective.secondaryRepresentations,
        }
      : state,
    instrumentProfile,
    viewPreference,
    derivedView: projectionResult.view ?? null,
    activeRendererId,
    isProjectionValid: projectionResult.status === 'SUCCESS' && !!projectionResult.view,
    diagnostics,
    supportedRepresentations,
    availableInstruments,
  };
}

/**
 * Transición al seleccionar o cambiar de canción:
 * Preserva intacta la preferencia de lectura deseada del usuario en el estado,
 * permitiendo que orchestrateWorkspaceView aplique fallbacks seguros dinámicos y diagnósticos (F-04).
 */
export function transitionSelectSong(
  current: IWorkspaceState,
  _song: CanonicalMusicPayload,
  _profile: InstrumentProfile,
  preferredFormat?: { primary: ViewRepresentation; secondary: readonly ViewRepresentation[] } | null
): IWorkspaceState {
  return {
    ...current,
    primaryRepresentation: preferredFormat?.primary ?? current.primaryRepresentation,
    secondaryRepresentations: preferredFormat?.secondary ?? current.secondaryRepresentations,
    activePresetId: 'CUSTOM',
  };
}

/**
 * Transición al aplicar preferencias guardadas del usuario:
 * Valida soporte de instrumento y establece la preferencia deseada en el estado.
 */
export function transitionApplyUserPreference(
  current: IWorkspaceState,
  _activeSong: CanonicalMusicPayload,
  pref: UserViewPreferenceData,
  registry: InstrumentRegistry = defaultInstrumentRegistry
): IWorkspaceState {
  const targetInstrumentId = pref.instrumentId;
  const profile = registry.get(targetInstrumentId) ?? registry.getOrThrow(current.selectedInstrumentId);
  const isPrimarySupported = profile.isRepresentationSupported(pref.primaryRepresentation);
  const desiredPrimary = isPrimarySupported
    ? pref.primaryRepresentation
    : Array.from(profile.supportedRepresentations)[0] ?? 'CHORDS';

  const desiredSecondary = (pref.secondaryRepresentations ?? []).filter(
    (s) => profile.isRepresentationSupported(s) && s !== desiredPrimary
  );

  const safeCapo = instrumentSupportsCapo(profile) ? pref.capoFret : 0;

  return {
    ...current,
    selectedInstrumentId: profile.id,
    primaryRepresentation: desiredPrimary,
    secondaryRepresentations: desiredSecondary,
    chordNotationSystem: pref.chordNotationSystem ?? current.chordNotationSystem,
    transpositionSemitones: pref.transpositionSemitones ?? current.transpositionSemitones,
    capoFret: safeCapo,
    activePresetId: 'CUSTOM',
    forcedRendererId: undefined,
  };
}

/**
 * Transición al cambiar el formato de lectura (primaria y secundarias atómicamente):
 */
export function transitionSetReadingFormat(
  current: IWorkspaceState,
  primary: ViewRepresentation,
  secondary: readonly ViewRepresentation[],
  profile: InstrumentProfile
): IWorkspaceState {
  if (!profile.isRepresentationSupported(primary)) {
    return current;
  }
  const validSecondary = secondary.filter(
    (s) => profile.isRepresentationSupported(s) && s !== primary
  );
  return {
    ...current,
    primaryRepresentation: primary,
    secondaryRepresentations: validSecondary,
    activePresetId: 'CUSTOM',
    forcedRendererId: undefined,
  };
}

/**
 * Sesión determinista del Espacio de Trabajo Musical.
 * Encapsula la máquina de estados y las transiciones del hook useMusicalWorkspace,
 * permitiendo pruebas deterministas del ciclo de vida y navegación sin requerir reconciliador DOM.
 */
export class MusicalWorkspaceSession {
  private _state: IWorkspaceState;
  private _activeSong: CanonicalMusicPayload;
  private _preferredFormat: { primary: ViewRepresentation; secondary: readonly ViewRepresentation[] } | null = null;
  private readonly _instrumentRegistry: InstrumentRegistry;
  private readonly _rendererRegistry: RendererRegistry;

  constructor(
    initialPresetId: GoldenScenarioId = 'SCENARIO_A',
    initialSong?: CanonicalMusicPayload,
    instrumentRegistry = defaultInstrumentRegistry,
    rendererRegistry = defaultRendererRegistry
  ) {
    this._instrumentRegistry = instrumentRegistry;
    this._rendererRegistry = rendererRegistry;
    const preset = GOLDEN_SCENARIO_PRESETS[initialPresetId];
    this._activeSong = initialSong ?? preset.canonicalSongFactory();
    this._state = createInitialWorkspaceState(initialPresetId);
    this._preferredFormat = {
      primary: preset.primaryRepresentation,
      secondary: preset.secondaryRepresentations,
    };
  }

  get state(): IWorkspaceState {
    return this._state;
  }

  get activeSong(): CanonicalMusicPayload {
    return this._activeSong;
  }

  get preferredFormat(): { primary: ViewRepresentation; secondary: readonly ViewRepresentation[] } | null {
    return this._preferredFormat;
  }

  get viewResult(): IWorkspaceViewResult {
    return orchestrateWorkspaceView(
      this._activeSong,
      this._state,
      this._instrumentRegistry,
      this._rendererRegistry
    );
  }

  applyUserPreference(pref: UserViewPreferenceData): void {
    this._preferredFormat = {
      primary: pref.primaryRepresentation,
      secondary: pref.secondaryRepresentations ?? [],
    };
    this._state = transitionApplyUserPreference(
      this._state,
      this._activeSong,
      pref,
      this._instrumentRegistry
    );
  }

  setReadingFormat(primary: ViewRepresentation, secondary: ViewRepresentation[]): void {
    this._preferredFormat = { primary, secondary };
    const profile = this._instrumentRegistry.getOrThrow(this._state.selectedInstrumentId);
    this._state = transitionSetReadingFormat(this._state, primary, secondary, profile);
  }

  selectSong(song: CanonicalMusicPayload): void {
    this._activeSong = song;
    const profile = this._instrumentRegistry.getOrThrow(this._state.selectedInstrumentId);
    this._state = transitionSelectSong(this._state, song, profile, this._preferredFormat);
  }

  selectInstrument(instrumentId: InstrumentId): void {
    const profile = this._instrumentRegistry.getOrThrow(instrumentId);
    const transitioned = transitionSelectInstrument(this._state, profile);
    const reqPrimary = this._preferredFormat?.primary ?? transitioned.primaryRepresentation;
    const reqSecondary = this._preferredFormat?.secondary ?? transitioned.secondaryRepresentations;
    const isPrimarySupported = profile.isRepresentationSupported(reqPrimary);
    const validPrimary = isPrimarySupported
      ? reqPrimary
      : Array.from(profile.supportedRepresentations)[0] ?? 'CHORDS';
    const validSecondary = reqSecondary.filter(
      (s) => profile.isRepresentationSupported(s) && s !== validPrimary
    );
    this._state = {
      ...transitioned,
      primaryRepresentation: validPrimary,
      secondaryRepresentations: validSecondary,
    };
  }
}

