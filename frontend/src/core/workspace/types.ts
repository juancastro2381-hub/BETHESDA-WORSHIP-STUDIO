/**
 * @file types.ts
 * @description Definiciones de tipos para la capa de Espacio de Trabajo Musical (Musical Workspace)
 * y Orquestación de Vistas (Fase 1G).
 *
 * Invariante arquitectónico:
 * El Workspace maneja el estado de presentación e interacción del usuario.
 * NUNCA duplica ni muta la verdad musical canónica (CanonicalMusicPayload).
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { type DerivedMusicalView } from '../projection/derived-musical-view.ts';
import { type InstrumentProfile } from '../projection/instrument-profile.ts';
import { type ChordNotationSystem, type ProjectionDiagnostic, type ViewRepresentation } from '../projection/types.ts';

export type InstrumentId = string;
import { type ViewPreference } from '../projection/view-preference.ts';
import { type RendererDiagnostic, type RendererId, type RendererStatus } from '../rendering/types.ts';

/**
 * Identificador de Escenarios Dorados oficiales de referencia.
 */
export type GoldenScenarioId = 'SCENARIO_A' | 'SCENARIO_B' | 'SCENARIO_C' | 'SCENARIO_D';

/**
 * Definición de un preset de escenario preconfigurado.
 */
export interface ScenarioPreset {
  readonly id: GoldenScenarioId;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly instrumentId: InstrumentId;
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly capoFret: number;
  readonly transpositionSemitones: number;
  readonly chordNotationSystem: ChordNotationSystem;
  readonly preferredRendererId: RendererId;
  readonly canonicalSongFactory: () => CanonicalMusicPayload;
}

/**
 * Estado de configuración del Workspace (preferencias de usuario / UI).
 * NO contiene notas, acordes ni métricas duplicadas.
 */
export interface IWorkspaceState {
  readonly selectedInstrumentId: InstrumentId;
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly capoFret: number;
  readonly transpositionSemitones: number;
  readonly chordNotationSystem: ChordNotationSystem;
  readonly forcedRendererId?: RendererId | undefined;
  readonly activePresetId: GoldenScenarioId | 'CUSTOM';
}

/**
 * Diagnósticos agregados del Workspace (proyección + renderizado).
 */
export interface WorkspaceDiagnostic {
  readonly source: 'PROJECTION' | 'RENDERER' | 'WORKSPACE';
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
  readonly code: string;
  readonly message: string;
}

/**
 * Resultado completo de la orquestación de vista en el Workspace.
 */
export interface IWorkspaceViewResult {
  readonly activeSong: CanonicalMusicPayload;
  readonly state: IWorkspaceState;
  readonly instrumentProfile: InstrumentProfile;
  readonly viewPreference: ViewPreference;
  readonly derivedView: DerivedMusicalView | null;
  readonly activeRendererId: RendererId | null;
  readonly isProjectionValid: boolean;
  readonly diagnostics: readonly WorkspaceDiagnostic[];
  readonly supportedRepresentations: readonly ViewRepresentation[];
  readonly availableInstruments: readonly InstrumentProfile[];
}
