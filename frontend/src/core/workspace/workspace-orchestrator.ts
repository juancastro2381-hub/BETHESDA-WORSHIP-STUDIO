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

  const viewPreference = new ViewPreference({
    instrumentId: state.selectedInstrumentId,
    primaryRepresentation: state.primaryRepresentation,
    secondaryRepresentations: [...state.secondaryRepresentations],
    capoFret: state.capoFret,
    transpositionSemitones: state.transpositionSemitones,
    chordNotationSystem: state.chordNotationSystem,
  });

  const projectionResult = ProjectionService.project(activeSong, instrumentProfile, viewPreference);

  const diagnostics: WorkspaceDiagnostic[] = [];

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
    if (state.forcedRendererId) {
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
    state,
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
