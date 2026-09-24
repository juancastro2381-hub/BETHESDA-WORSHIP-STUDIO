/**
 * @file setlist-execution-orchestrator.ts
 * @description Orquestador determinista y funciones puras de transición para la ejecución litúrgica en atril (Fase 2C — WS6).
 *
 * Sigue el mismo patrón arquitectónico que workspace-orchestrator.ts (Fase 1G):
 * 1. Desacoplado de React para permitir pruebas unitarias matemáticas, puras y deterministas en Node.js.
 * 2. Inmutabilidad estricta: cada transición retorna un nuevo estado sin mutar el anterior.
 * 3. Protección de fronteras de navegación: índices estrictamente acotados a [0, items.length - 1].
 * 4. Preservación del estado litúrgico al visualizar canciones fuera de setlist (Off-Setlist).
 * 5. Fusión local de metadatos (Estrategia A) sin recargas de red innecesarias.
 */

import type {
  FrontendSetlistDetail,
  FrontendSetlistEntity,
  FrontendSetlistItem,
  FrontendSetlistItemSong,
  FrontendSetlistStatus,
  UpdateSetlistPayload,
} from '../api/setlist-types.ts';
import { calculateTranspositionSemitones } from './transposition-helper.ts';

/**
 * Estado en memoria volátil de la ejecución del setlist.
 */
export interface ISetlistExecutionState {
  readonly loadedSetlist: FrontendSetlistDetail | null;
  readonly currentIndex: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly isOffSetlistSongActive: boolean;
  readonly offSetlistSongTitle: string | null;
}

/**
 * Vista proyectada derivada del estado actual de ejecución litúrgica.
 */
export interface ISetlistExecutionView {
  readonly currentItem: FrontendSetlistItem | null;
  readonly nextItem: FrontendSetlistItem | null;
  readonly previousItem: FrontendSetlistItem | null;
  readonly totalItems: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly isSong: boolean;
  readonly isServiceMoment: boolean;
  readonly currentSongMetadata: FrontendSetlistItemSong | null;
  readonly transpositionSemitones: number;
  readonly effectiveTargetKey: string | null;
}

/**
 * Crea el estado inicial vacío de ejecución litúrgica.
 */
export function createInitialSetlistExecutionState(): ISetlistExecutionState {
  return {
    loadedSetlist: null,
    currentIndex: 0,
    isLoading: false,
    error: null,
    isOffSetlistSongActive: false,
    offSetlistSongTitle: null,
  };
}

/**
 * Deriva las propiedades computadas y de proyección de atril a partir del estado puro.
 */
export function deriveExecutionView(state: ISetlistExecutionState): ISetlistExecutionView {
  const { loadedSetlist, currentIndex } = state;
  const totalItems = loadedSetlist?.items.length ?? 0;

  const hasNext = loadedSetlist !== null && totalItems > 0 && currentIndex < totalItems - 1;
  const hasPrevious = loadedSetlist !== null && totalItems > 0 && currentIndex > 0;

  let currentItem: FrontendSetlistItem | null = null;
  let nextItem: FrontendSetlistItem | null = null;
  let previousItem: FrontendSetlistItem | null = null;

  if (loadedSetlist && totalItems > 0 && currentIndex >= 0 && currentIndex < totalItems) {
    currentItem = loadedSetlist.items[currentIndex] ?? null;
    if (hasNext) {
      nextItem = loadedSetlist.items[currentIndex + 1] ?? null;
    }
    if (hasPrevious) {
      previousItem = loadedSetlist.items[currentIndex - 1] ?? null;
    }
  }

  const isSong = currentItem?.itemType === 'SONG';
  const isServiceMoment = currentItem?.itemType === 'SERVICE_MOMENT';
  const currentSongMetadata = isSong ? (currentItem?.song ?? null) : null;

  let transpositionSemitones = 0;
  let effectiveTargetKey: string | null = null;

  if (isSong && currentItem) {
    const defaultKey = currentItem.song?.defaultKey ?? null;
    const targetKey = currentItem.targetKey ?? null;
    transpositionSemitones = calculateTranspositionSemitones(defaultKey, targetKey);
    effectiveTargetKey = targetKey || defaultKey || null;
  }

  return {
    currentItem,
    nextItem,
    previousItem,
    totalItems,
    hasNext,
    hasPrevious,
    isSong,
    isServiceMoment,
    currentSongMetadata,
    transpositionSemitones,
    effectiveTargetKey,
  };
}

/**
 * Transición pura al cargar un setlist.
 */
export function transitionLoadSetlist(
  current: ISetlistExecutionState,
  detail: FrontendSetlistDetail
): ISetlistExecutionState {
  return {
    ...current,
    loadedSetlist: detail,
    currentIndex: 0,
    error: null,
    isOffSetlistSongActive: false,
    offSetlistSongTitle: null,
  };
}

/**
 * Transición pura al descargar el setlist activo.
 */
export function transitionUnloadSetlist(): ISetlistExecutionState {
  return createInitialSetlistExecutionState();
}

/**
 * Transición pura al avanzar al siguiente elemento del setlist.
 * Respeta la frontera superior (currentIndex < items.length - 1).
 */
export function transitionGoToNext(current: ISetlistExecutionState): ISetlistExecutionState {
  const total = current.loadedSetlist?.items.length ?? 0;
  if (!current.loadedSetlist || total === 0 || current.currentIndex >= total - 1) {
    return current;
  }

  return {
    ...current,
    currentIndex: current.currentIndex + 1,
    isOffSetlistSongActive: false,
    offSetlistSongTitle: null,
  };
}

/**
 * Transición pura al retroceder al elemento anterior del setlist.
 * Respeta la frontera inferior (currentIndex > 0).
 */
export function transitionGoToPrevious(current: ISetlistExecutionState): ISetlistExecutionState {
  if (!current.loadedSetlist || current.currentIndex <= 0) {
    return current;
  }

  return {
    ...current,
    currentIndex: current.currentIndex - 1,
    isOffSetlistSongActive: false,
    offSetlistSongTitle: null,
  };
}

/**
 * Transición pura al navegar a un índice arbitrario.
 * Si el índice está fuera de rango [0, items.length - 1], no muta el estado.
 */
export function transitionGoToIndex(
  current: ISetlistExecutionState,
  targetIndex: number
): ISetlistExecutionState {
  const total = current.loadedSetlist?.items.length ?? 0;
  if (!current.loadedSetlist || total === 0 || targetIndex < 0 || targetIndex >= total) {
    return current;
  }

  return {
    ...current,
    currentIndex: targetIndex,
    isOffSetlistSongActive: false,
    offSetlistSongTitle: null,
  };
}

/**
 * Transición pura al actualizar el estado litúrgico (ej. a ACTIVE o COMPLETED).
 */
export function transitionUpdateStatus(
  current: ISetlistExecutionState,
  newStatus: FrontendSetlistStatus,
  updatedAt: string
): ISetlistExecutionState {
  if (!current.loadedSetlist) {
    return current;
  }

  return {
    ...current,
    loadedSetlist: {
      ...current.loadedSetlist,
      status: newStatus,
      updatedAt,
    },
    error: null,
  };
}

/**
 * Transición pura al actualizar metadatos aplicando la Estrategia A reconciliada:
 * Fusiona los campos modificados preservando la lista de items, directorName y posición de atril.
 */
export function transitionUpdateMetadata(
  current: ISetlistExecutionState,
  updatedEntity: FrontendSetlistEntity
): ISetlistExecutionState {
  if (!current.loadedSetlist) {
    return current;
  }

  return {
    ...current,
    loadedSetlist: {
      ...current.loadedSetlist,
      title: updatedEntity.title,
      scheduledDateTime: updatedEntity.scheduledDateTime,
      directorUserId: updatedEntity.directorUserId,
      notes: updatedEntity.notes,
      updatedAt: updatedEntity.updatedAt,
      status: updatedEntity.status,
    },
    error: null,
  };
}

/**
 * Transición pura al seleccionar una canción independiente fuera del setlist (Off-Setlist):
 * Preserva loadedSetlist y currentIndex intactos en memoria.
 */
export function transitionNotifyOffSetlistSong(
  current: ISetlistExecutionState,
  songTitle?: string
): ISetlistExecutionState {
  return {
    ...current,
    isOffSetlistSongActive: true,
    offSetlistSongTitle: songTitle ?? 'Canción Independiente del Catálogo',
  };
}

/**
 * Transición pura para volver a la posición actual del setlist litúrgico.
 */
export function transitionReturnToCurrentSetlist(
  current: ISetlistExecutionState
): ISetlistExecutionState {
  return {
    ...current,
    isOffSetlistSongActive: false,
    offSetlistSongTitle: null,
  };
}
