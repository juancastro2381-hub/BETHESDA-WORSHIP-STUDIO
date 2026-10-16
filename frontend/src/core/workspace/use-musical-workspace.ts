/**
 * @file use-musical-workspace.ts
 * @description Hook orquestador del Espacio de Trabajo Musical (Fase 1G).
 *
 * Responsabilidades:
 * - Mantener el contexto de la canción activa (CanonicalMusicPayload)
 * - Mantener el contexto de preferencias de vista del usuario (IWorkspaceState)
 * - Delegar transiciones puras a workspace-orchestrator.ts
 * - Orquestar la vista proyectada mediante orchestrateWorkspaceView
 * - Preservar estrictamente la inmutabilidad del modelo canónico
 * - Proveer callbacks interactivos accesibles
 */

import { useCallback, useMemo, useState } from 'react';
import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { InstrumentRegistry, type InstrumentProfile } from '../projection/instrument-profile.ts';
import { type ChordNotationSystem, type ViewRepresentation } from '../projection/types.ts';
import { type UserViewPreferenceData } from '../api/preference-types.ts';
import { RendererRegistry } from '../rendering/renderer-registry.ts';
import { type RendererId } from '../rendering/types.ts';
import { GOLDEN_SCENARIO_PRESETS } from './presets.ts';
import {
  type GoldenScenarioId,
  type InstrumentId,
  type IWorkspaceState,
  type IWorkspaceViewResult,
} from './types.ts';
import {
  createInitialWorkspaceState,
  instrumentSupportsCapo,
  orchestrateWorkspaceView,
  transitionApplyPreset,
  transitionSelectInstrument,
  transitionSetCapo,
  transitionSetChordNotation,
  transitionSetPrimary,
  transitionSetTransposition,
  transitionToggleSecondary,
} from './workspace-orchestrator.ts';

export { instrumentSupportsCapo };

const instrumentRegistry = new InstrumentRegistry();
const rendererRegistry = new RendererRegistry();

export interface UseMusicalWorkspaceOptions {
  readonly initialPresetId?: GoldenScenarioId | undefined;
  readonly initialSong?: CanonicalMusicPayload | undefined;
}

export function useMusicalWorkspace(options: UseMusicalWorkspaceOptions = {}): {
  readonly viewResult: IWorkspaceViewResult;
  readonly availableInstruments: readonly InstrumentProfile[];
  readonly importedMeta: { sourceName?: string; format: string } | null;
  readonly persistedMeta: { isPersisted: boolean; songId: string; versionNumber: number } | null;
  readonly applyPreset: (presetId: GoldenScenarioId) => void;
  readonly selectSong: (song: CanonicalMusicPayload) => void;
  readonly importSong: (song: CanonicalMusicPayload, meta: { sourceName?: string; format: string }) => void;
  readonly selectPersistedSong: (song: CanonicalMusicPayload, meta: { isPersisted: boolean; songId: string; versionNumber: number }) => void;
  readonly selectInstrument: (instrumentId: InstrumentId) => void;
  readonly setPrimaryRepresentation: (representation: ViewRepresentation) => void;
  readonly toggleSecondaryRepresentation: (representation: ViewRepresentation) => void;
  readonly setReadingFormat: (primary: ViewRepresentation, secondary: ViewRepresentation[]) => void;
  readonly applyUserPreference: (preference: UserViewPreferenceData) => void;
  readonly setCapo: (fret: number) => void;
  readonly setTransposition: (semitones: number) => void;
  readonly setChordNotation: (system: ChordNotationSystem) => void;
  readonly setForcedRenderer: (rendererId: RendererId | undefined) => void;
  readonly resetToOriginal: () => void;
} {
  const initialPresetId = options.initialPresetId ?? 'SCENARIO_A';
  const initialPreset = GOLDEN_SCENARIO_PRESETS[initialPresetId];

  const [activeSong, setActiveSong] = useState<CanonicalMusicPayload>(
    options.initialSong ?? initialPreset.canonicalSongFactory()
  );

  const [importedMeta, setImportedMeta] = useState<{ sourceName?: string; format: string } | null>(null);
  const [persistedMeta, setPersistedMeta] = useState<{ isPersisted: boolean; songId: string; versionNumber: number } | null>(null);

  const [state, setState] = useState<IWorkspaceState>(
    createInitialWorkspaceState(initialPresetId)
  );

  // Lista de todos los instrumentos registrados en el dominio
  const availableInstruments = useMemo(() => {
    return instrumentRegistry.getAll();
  }, []);

  // Perfil del instrumento activo
  const instrumentProfile = useMemo(() => {
    return instrumentRegistry.getOrThrow(state.selectedInstrumentId);
  }, [state.selectedInstrumentId]);

  // Aplicar Preset Dorado
  const applyPreset = useCallback((presetId: GoldenScenarioId) => {
    const preset = GOLDEN_SCENARIO_PRESETS[presetId];
    if (!preset) return;
    setActiveSong(preset.canonicalSongFactory());
    setImportedMeta(null);
    setPersistedMeta(null);
    setState(transitionApplyPreset(preset));
  }, []);

  // Cambiar canción activa del catálogo
  const selectSong = useCallback((song: CanonicalMusicPayload) => {
    setActiveSong(song);
    setImportedMeta(null);
    setPersistedMeta(null);
    setState((prev) => ({ ...prev, activePresetId: 'CUSTOM' }));
  }, []);

  // Importar partitura desde archivo real
  const importSong = useCallback((song: CanonicalMusicPayload, meta: { sourceName?: string; format: string }) => {
    setActiveSong(song);
    setImportedMeta(meta);
    setPersistedMeta(null);
    setState((prev) => ({ ...prev, activePresetId: 'CUSTOM' }));
  }, []);

  // Cargar canción persistida desde base de datos PostgreSQL
  const selectPersistedSong = useCallback((song: CanonicalMusicPayload, meta: { isPersisted: boolean; songId: string; versionNumber: number }) => {
    setActiveSong(song);
    setImportedMeta(null);
    setPersistedMeta(meta);
    setState((prev) => ({ ...prev, activePresetId: 'CUSTOM' }));
  }, []);

  // Cambiar instrumento seleccionado y filtrar representaciones incompatibles
  const selectInstrument = useCallback((instrumentId: InstrumentId) => {
    const targetProfile = instrumentRegistry.getOrThrow(instrumentId);
    setState((prev) => transitionSelectInstrument(prev, targetProfile));
  }, []);

  // Cambiar representación primaria
  const setPrimaryRepresentation = useCallback((representation: ViewRepresentation) => {
    setState((prev) => {
      const profile = instrumentRegistry.getOrThrow(prev.selectedInstrumentId);
      return transitionSetPrimary(prev, representation, profile);
    });
  }, []);

  // Alternar representación secundaria (capas)
  const toggleSecondaryRepresentation = useCallback((representation: ViewRepresentation) => {
    setState((prev) => {
      const profile = instrumentRegistry.getOrThrow(prev.selectedInstrumentId);
      return transitionToggleSecondary(prev, representation, profile);
    });
  }, []);

  // Cambiar formato de lectura (primaria y secundarias atómicamente)
  const setReadingFormat = useCallback((primary: ViewRepresentation, secondary: ViewRepresentation[]) => {
    setState((prev) => {
      const profile = instrumentRegistry.getOrThrow(prev.selectedInstrumentId);
      if (!profile.isRepresentationSupported(primary)) {
        return prev;
      }
      const validSecondary = secondary.filter(
        (s) => profile.isRepresentationSupported(s) && s !== primary
      );
      return {
        ...prev,
        primaryRepresentation: primary,
        secondaryRepresentations: validSecondary,
        activePresetId: 'CUSTOM',
      };
    });
  }, []);

  // Aplicar preferencias de visualización persistidas del usuario (Fase 3A)
  const applyUserPreference = useCallback((pref: UserViewPreferenceData) => {
    setState((prev) => {
      const targetInstrumentId = pref.instrumentId;
      const profile = instrumentRegistry.get(targetInstrumentId) ?? instrumentRegistry.getOrThrow(prev.selectedInstrumentId);
      const isPrimarySupported = profile.isRepresentationSupported(pref.primaryRepresentation);
      const finalPrimary = isPrimarySupported
        ? pref.primaryRepresentation
        : Array.from(profile.supportedRepresentations)[0] ?? 'CHORDS';

      const finalSecondary = (pref.secondaryRepresentations ?? []).filter(
        (s) => profile.isRepresentationSupported(s) && s !== finalPrimary
      );

      const safeCapo = instrumentSupportsCapo(profile) ? pref.capoFret : 0;

      return {
        ...prev,
        selectedInstrumentId: profile.id,
        primaryRepresentation: finalPrimary,
        secondaryRepresentations: finalSecondary,
        chordNotationSystem: pref.chordNotationSystem ?? prev.chordNotationSystem,
        transpositionSemitones: pref.transpositionSemitones ?? prev.transpositionSemitones,
        capoFret: safeCapo,
        activePresetId: 'CUSTOM',
      };
    });
  }, []);

  // Modificar cejilla (Capo)
  const setCapo = useCallback((fret: number) => {
    setState((prev) => {
      const profile = instrumentRegistry.getOrThrow(prev.selectedInstrumentId);
      return transitionSetCapo(prev, fret, profile);
    });
  }, []);

  // Modificar transposición por semitonos
  const setTransposition = useCallback((semitones: number) => {
    setState((prev) => transitionSetTransposition(prev, semitones));
  }, []);

  // Modificar sistema de nomenclatura de acordes
  const setChordNotation = useCallback((system: ChordNotationSystem) => {
    setState((prev) => transitionSetChordNotation(prev, system));
  }, []);

  // Forzar motor de renderizado
  const setForcedRenderer = useCallback((rendererId: RendererId | undefined) => {
    setState((prev) => ({
      ...prev,
      forcedRendererId: rendererId,
      activePresetId: 'CUSTOM',
    }));
  }, []);

  // Restablecer a valores originales
  const resetToOriginal = useCallback(() => {
    setState((prev) => ({
      ...prev,
      capoFret: 0,
      transpositionSemitones: 0,
      chordNotationSystem: 'STANDARD',
      forcedRendererId: undefined,
      activePresetId: 'CUSTOM',
    }));
  }, []);

  // Orquestar la vista proyectada y resolución del renderizador (determinista)
  const viewResult: IWorkspaceViewResult = useMemo(() => {
    return orchestrateWorkspaceView(activeSong, state, instrumentRegistry, rendererRegistry);
  }, [activeSong, state]);

  return {
    viewResult,
    availableInstruments,
    importedMeta,
    persistedMeta,
    applyPreset,
    selectSong,
    importSong,
    selectPersistedSong,
    selectInstrument,
    setPrimaryRepresentation,
    toggleSecondaryRepresentation,
    setReadingFormat,
    applyUserPreference,
    setCapo,
    setTransposition,
    setChordNotation,
    setForcedRenderer,
    resetToOriginal,
  };
}
