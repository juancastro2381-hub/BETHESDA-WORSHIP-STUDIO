/**
 * @file use-setlist-execution.ts
 * @description Hook orquestador de estado y navegación de setlist para el atril litúrgico (Fase 2C — WS6).
 *
 * Responsabilidades:
 * - Orquestar el ciclo de vida del setlist en ejecución (PLANNING, ACTIVE, COMPLETED).
 * - Controlar la navegación secuencial y por índice sobre los ítems ordenados.
 * - Discriminar el modo de ejecución (Canción con partitura vs Momento litúrgico de servicio).
 * - Calcular de forma pura la transposición requerida (Δ semitonos) en tiempo de ejecución.
 * - Proteger las fronteras de índice evitando estados fuera de rango.
 * - Preservar el contexto de culto al visualizar canciones independientes fuera del setlist (Off-Setlist).
 * - Soportar la actualización de metadatos (Estrategia A: fusión local preservando ítems).
 *
 * RESTRICCIONES ARQUITECTÓNICAS ESTRICTAS:
 * - Memoria volátil exclusivamente (useState / useMemo / useCallback).
 * - Cero persistencia en localStorage, sessionStorage o IndexedDB.
 * - Cero código visual (los componentes SetlistsModal, SetlistNavigationToolbar y ServiceMomentCard pertenecen a WS7).
 * - Cero mutaciones sobre CanonicalMusicPayload o la base de datos PostgreSQL.
 */

import { useCallback, useMemo, useState } from 'react';
import { BethesdaApiClient } from '../api/api-client.ts';
import type {
  FrontendSetlistDetail,
  FrontendSetlistItem,
  FrontendSetlistItemSong,
  UpdateSetlistPayload,
} from '../api/setlist-types.ts';
import {
  createInitialSetlistExecutionState,
  deriveExecutionView,
  transitionGoToIndex,
  transitionGoToNext,
  transitionGoToPrevious,
  transitionLoadSetlist,
  transitionNotifyOffSetlistSong,
  transitionReturnToCurrentSetlist,
  transitionUnloadSetlist,
  transitionUpdateMetadata,
  transitionUpdateStatus,
  type ISetlistExecutionState,
} from './setlist-execution-orchestrator.ts';
import { calculateTranspositionSemitones } from './transposition-helper.ts';

export { calculateTranspositionSemitones };
export * from './setlist-execution-orchestrator.ts';

export interface UseSetlistExecutionOptions {
  /**
   * Identificador opcional de setlist para carga automática al inicializar.
   */
  readonly initialSetlistId?: string | undefined;

  /**
   * Cliente API inyectable para facilitar pruebas unitarias o configuración personalizada.
   */
  readonly apiClient?: BethesdaApiClient | undefined;
}

export interface UseSetlistExecutionResult {
  // Estado de Datos
  readonly loadedSetlist: FrontendSetlistDetail | null;
  readonly isLoading: boolean;
  readonly error: string | null;

  // Estado de Navegación de Atril
  readonly currentIndex: number;
  readonly currentItem: FrontendSetlistItem | null;
  readonly totalItems: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly nextItem: FrontendSetlistItem | null;
  readonly previousItem: FrontendSetlistItem | null;

  // Modos de Ejecución Litúrgica
  readonly isSong: boolean;
  readonly isServiceMoment: boolean;
  readonly currentSongMetadata: FrontendSetlistItemSong | null;

  // Cálculo Armónico Litúrgico Puro
  readonly transpositionSemitones: number;
  readonly effectiveTargetKey: string | null;

  // Estado y Contexto de Canción Fuera de Setlist (Off-Setlist)
  readonly isOffSetlistSongActive: boolean;
  readonly offSetlistSongTitle: string | null;

  // Acciones de Navegación
  readonly goToNext: () => void;
  readonly goToPrevious: () => void;
  readonly goToIndex: (index: number) => void;

  // Acciones de Ciclo de Vida y Datos
  readonly loadSetlist: (setlistId: string) => Promise<void>;
  readonly unloadSetlist: () => void;
  readonly activateCurrentSetlist: () => Promise<void>;
  readonly completeCurrentSetlist: () => Promise<void>;
  readonly updateLoadedMetadata: (payload: UpdateSetlistPayload) => Promise<void>;
  readonly clearError: () => void;

  // Acciones de Canción Fuera de Setlist
  readonly notifyOffSetlistSongSelected: (songTitle?: string) => void;
  readonly returnToCurrentSetlistItem: () => void;
}

export function useSetlistExecution(options: UseSetlistExecutionOptions = {}): UseSetlistExecutionResult {
  const apiClient = options.apiClient ?? BethesdaApiClient.getInstance();

  // 1. Estado de Datos (Memoria Volátil React — Cero Web Storage)
  const [state, setState] = useState<ISetlistExecutionState>(createInitialSetlistExecutionState());

  // 2. Vista Derivada Determinista
  const view = useMemo(() => deriveExecutionView(state), [state]);

  // ==========================================================================
  // ACCIONES DE NAVEGACIÓN
  // ==========================================================================

  const goToNext = useCallback(() => {
    setState((prev) => transitionGoToNext(prev));
  }, []);

  const goToPrevious = useCallback(() => {
    setState((prev) => transitionGoToPrevious(prev));
  }, []);

  const goToIndex = useCallback((index: number) => {
    setState((prev) => transitionGoToIndex(prev, index));
  }, []);

  // ==========================================================================
  // ACCIONES DE CARGA Y CICLO DE VIDA
  // ==========================================================================

  const loadSetlist = useCallback(
    async (setlistId: string): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const detail = await apiClient.getSetlist(setlistId);
        setState((prev) => ({
          ...transitionLoadSetlist(prev, detail),
          isLoading: false,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido al cargar setlist.';
        setState((prev) => ({ ...prev, isLoading: false, error: message }));
        throw err;
      }
    },
    [apiClient]
  );

  const unloadSetlist = useCallback(() => {
    setState(transitionUnloadSetlist());
  }, []);

  const activateCurrentSetlist = useCallback(async (): Promise<void> => {
    if (!state.loadedSetlist) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await apiClient.updateSetlistStatus(state.loadedSetlist.id, 'ACTIVE');
      setState((prev) => ({
        ...transitionUpdateStatus(prev, 'ACTIVE', result.updatedAt),
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al activar setlist.';
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
      throw err;
    }
  }, [apiClient, state.loadedSetlist]);

  const completeCurrentSetlist = useCallback(async (): Promise<void> => {
    if (!state.loadedSetlist) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await apiClient.updateSetlistStatus(state.loadedSetlist.id, 'COMPLETED');
      setState((prev) => ({
        ...transitionUpdateStatus(prev, 'COMPLETED', result.updatedAt),
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al finalizar setlist.';
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
      throw err;
    }
  }, [apiClient, state.loadedSetlist]);

  /**
   * Actualiza los metadatos del setlist aplicando la Estrategia A reconciliada:
   * consume el SetlistEntity retornado y fusiona los cambios localmente
   * preservando los ítems, el director y el índice de navegación sin recargas innecesarias.
   */
  const updateLoadedMetadata = useCallback(
    async (payload: UpdateSetlistPayload): Promise<void> => {
      if (!state.loadedSetlist) return;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const updated = await apiClient.updateSetlist(state.loadedSetlist.id, payload);
        setState((prev) => ({
          ...transitionUpdateMetadata(prev, updated),
          isLoading: false,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al actualizar metadatos del setlist.';
        setState((prev) => ({ ...prev, isLoading: false, error: message }));
        throw err;
      }
    },
    [apiClient, state.loadedSetlist]
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // ==========================================================================
  // COMPORTAMIENTO OFF-SETLIST (CANCIÓN FUERA DE SETLIST)
  // ==========================================================================

  const notifyOffSetlistSongSelected = useCallback((songTitle?: string) => {
    setState((prev) => transitionNotifyOffSetlistSong(prev, songTitle));
  }, []);

  const returnToCurrentSetlistItem = useCallback(() => {
    setState((prev) => transitionReturnToCurrentSetlist(prev));
  }, []);

  return {
    // Estado
    loadedSetlist: state.loadedSetlist,
    isLoading: state.isLoading,
    error: state.error,
    currentIndex: state.currentIndex,
    currentItem: view.currentItem,
    totalItems: view.totalItems,
    hasNext: view.hasNext,
    hasPrevious: view.hasPrevious,
    nextItem: view.nextItem,
    previousItem: view.previousItem,

    // Modos
    isSong: view.isSong,
    isServiceMoment: view.isServiceMoment,
    currentSongMetadata: view.currentSongMetadata,

    // Transposición
    transpositionSemitones: view.transpositionSemitones,
    effectiveTargetKey: view.effectiveTargetKey,

    // Off-setlist
    isOffSetlistSongActive: state.isOffSetlistSongActive,
    offSetlistSongTitle: state.offSetlistSongTitle,

    // Acciones de Navegación
    goToNext,
    goToPrevious,
    goToIndex,

    // Acciones de Ciclo de Vida
    loadSetlist,
    unloadSetlist,
    activateCurrentSetlist,
    completeCurrentSetlist,
    updateLoadedMetadata,
    clearError,

    // Acciones Off-setlist
    notifyOffSetlistSongSelected,
    returnToCurrentSetlistItem,
  };
}
