/**
 * @file SetlistNavigationToolbar.tsx
 * @description Barra de control y navegación de atril litúrgico para setlists (Fase 2C — WS7).
 *
 * Responsabilidades:
 * - Proveer controles táctiles de escenario con área efectiva mínima de 48px.
 * - Ubicación responsiva (Decisión 1 Aprobada): Superior en Desktop/Tablet, Inferior fija en Mobile.
 * - Navegación determinista hacia adelante, hacia atrás y reporte de posición (Ítem N de Total).
 * - Identificación visual del modo de ejecución (🎵 CANCIÓN vs 🕊️ MOMENTO LITÚRGICO).
 * - Proyección visual del tono litúrgico objetivo, Δ semitonos y BPM.
 * - Modo Off-Setlist: banner y botón de retorno rápido "↩ Volver al Culto" con preservación de índice.
 * - Atajos de teclado para atril (ArrowRight, ArrowLeft, Space, PageDown, PageUp, Escape).
 * - Accesibilidad semántica (role="toolbar", aria-label, aria-disabled).
 */

import React, { useEffect, useCallback } from 'react';
import type {
  FrontendSetlistDetail,
  FrontendSetlistItem,
} from '../../core/api/setlist-types.ts';

export interface SetlistNavigationToolbarProps {
  readonly loadedSetlist: FrontendSetlistDetail | null;
  readonly currentIndex: number;
  readonly totalItems: number;
  readonly currentItem: FrontendSetlistItem | null;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly isSong: boolean;
  readonly isServiceMoment: boolean;
  readonly isOffSetlistSongActive: boolean;
  readonly offSetlistSongTitle: string | null;
  readonly transpositionSemitones: number;
  readonly effectiveTargetKey: string | null;
  readonly isLoading?: boolean;
  readonly onGoToNext: () => void;
  readonly onGoToPrevious: () => void;
  readonly onReturnToSetlist: () => void;
  readonly onOpenSetlistsModal?: () => void;
  readonly onUnloadSetlist?: () => void;
}

export const SetlistNavigationToolbar: React.FC<SetlistNavigationToolbarProps> = ({
  loadedSetlist,
  currentIndex,
  totalItems,
  currentItem,
  hasNext,
  hasPrevious,
  isSong,
  isServiceMoment,
  isOffSetlistSongActive,
  offSetlistSongTitle,
  transpositionSemitones,
  effectiveTargetKey,
  isLoading = false,
  onGoToNext,
  onGoToPrevious,
  onReturnToSetlist,
  onOpenSetlistsModal,
  onUnloadSetlist,
}) => {
  // Manejador global de atajos de teclado para atril de alabanza
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignorar si el usuario está escribiendo en un input, textarea o form
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !isOffSetlistSongActive)) {
        if (hasNext && !isLoading) {
          e.preventDefault();
          onGoToNext();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (hasPrevious && !isLoading) {
          e.preventDefault();
          onGoToPrevious();
        }
      } else if (e.key === 'Escape' && isOffSetlistSongActive) {
        e.preventDefault();
        onReturnToSetlist();
      }
    },
    [hasNext, hasPrevious, isLoading, isOffSetlistSongActive, onGoToNext, onGoToPrevious, onReturnToSetlist]
  );

  useEffect(() => {
    if (!loadedSetlist) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loadedSetlist, handleKeyDown]);

  if (!loadedSetlist) {
    return null;
  }

  // Título e información del ítem actual
  let itemTitle = 'Sin selección';
  let musicalDetail = '';

  if (currentItem) {
    if (currentItem.itemType === 'SONG') {
      itemTitle = currentItem.song?.title ?? 'Canción sin título';
      const keyStr = effectiveTargetKey
        ? `Tono: ${effectiveTargetKey}`
        : currentItem.song?.defaultKey
        ? `Tono: ${currentItem.song.defaultKey}`
        : '';
      const deltaStr =
        transpositionSemitones !== 0
          ? ` (${transpositionSemitones > 0 ? `+${transpositionSemitones}` : transpositionSemitones} st)`
          : '';
      const bpmStr = currentItem.targetBpm ? ` • ♩ = ${currentItem.targetBpm}` : '';
      musicalDetail = `${keyStr}${deltaStr}${bpmStr}`;
    } else if (currentItem.itemType === 'SERVICE_MOMENT') {
      itemTitle = currentItem.momentTitle || 'Momento Litúrgico';
      const durationStr = currentItem.durationMinutes
        ? `⏱️ ${currentItem.durationMinutes} min`
        : '';
      const padKeyStr = currentItem.musicalKey
        ? ` • Pad: ${currentItem.musicalKey}`
        : '';
      musicalDetail = `${durationStr}${padKeyStr}`.trim();
    }
  }

  // Formateo de posición
  const positionDisplay = totalItems > 0 ? `${currentIndex + 1} / ${totalItems}` : '0 / 0';
  const progressPercent = totalItems > 0 ? ((currentIndex + 1) / totalItems) * 100 : 0;

  return (
    <aside
      className="setlist-navigation-toolbar"
      role="toolbar"
      aria-label="Controles de navegación de atril litúrgico"
    >
      {/* Barra de Progreso Sutil */}
      <div
        className="setlist-progress-bar-fill"
        style={{ width: `${progressPercent}%` }}
        aria-hidden="true"
      />

      <div className="setlist-toolbar-content">
        {/* Columna Izquierda: Identificación del Setlist y Modo */}
        <div className="setlist-toolbar-meta">
          <div className="setlist-header-badges">
            <span
              className={`setlist-status-badge ${loadedSetlist.status.toLowerCase()}`}
              title={`Estado del repertorio: ${loadedSetlist.status}`}
            >
              {loadedSetlist.status === 'ACTIVE' && '● EN CULTO'}
              {loadedSetlist.status === 'PLANNING' && 'PLANIFICACIÓN'}
              {loadedSetlist.status === 'COMPLETED' && 'COMPLETADO'}
              {loadedSetlist.status === 'ARCHIVED' && 'ARCHIVADO'}
            </span>

            {isSong && <span className="item-mode-badge song">🎵 CANCIÓN</span>}
            {isServiceMoment && <span className="item-mode-badge service-moment">🕊️ LITURGIA</span>}

            {onOpenSetlistsModal && (
              <button
                type="button"
                className="btn-switch-setlist"
                onClick={onOpenSetlistsModal}
                title="Cambiar o consultar repertorios"
                aria-label="Abrir catálogo de repertorios"
              >
                📋 {loadedSetlist.title}
              </button>
            )}
          </div>

          {/* Información del Ítem Actual */}
          <div className="setlist-current-item-info">
            <h3 className="setlist-item-title" title={itemTitle}>
              {itemTitle}
            </h3>
            {musicalDetail && (
              <span className="setlist-item-musical-detail">{musicalDetail}</span>
            )}
          </div>
        </div>

        {/* Columna Central: Notificación Off-Setlist y Botón Volver al Culto */}
        {isOffSetlistSongActive && (
          <div className="setlist-offsetlist-banner" role="alert">
            <div className="offsetlist-text">
              <span className="offsetlist-icon" aria-hidden="true">
                👀
              </span>
              <span>
                Viendo fuera de setlist: <strong>"{offSetlistSongTitle}"</strong>
              </span>
            </div>
            <button
              type="button"
              className="btn-return-to-setlist"
              onClick={onReturnToSetlist}
              aria-label={`Volver al culto en la posición ${currentIndex + 1}: ${itemTitle}`}
            >
              ↩ Volver al Culto ({positionDisplay})
            </button>
          </div>
        )}

        {/* Columna Derecha: Controles de Navegación de Atril (Touch Target >= 48px) */}
        <div className="setlist-toolbar-controls">
          <button
            type="button"
            className="btn-nav-touch btn-nav-prev"
            onClick={onGoToPrevious}
            disabled={!hasPrevious || isLoading}
            aria-label="Ir al ítem anterior del repertorio"
            title="Ítem anterior (Flecha Izquierda / PageUp)"
          >
            <span className="nav-icon" aria-hidden="true">
              ◀
            </span>
            <span className="nav-label">Anterior</span>
          </button>

          <div
            className="setlist-position-indicator"
            aria-live="polite"
            title={`Ítem ${currentIndex + 1} de ${totalItems}`}
          >
            <span className="position-current">{currentIndex + 1}</span>
            <span className="position-divider">/</span>
            <span className="position-total">{totalItems}</span>
          </div>

          <button
            type="button"
            className="btn-nav-touch btn-nav-next"
            onClick={onGoToNext}
            disabled={!hasNext || isLoading}
            aria-label="Ir al siguiente ítem del repertorio"
            title="Siguiente ítem (Flecha Derecha / Espacio / PageDown)"
          >
            <span className="nav-label">Siguiente</span>
            <span className="nav-icon" aria-hidden="true">
              ▶
            </span>
          </button>

          {onUnloadSetlist && (
            <button
              type="button"
              className="btn-nav-touch btn-nav-unload"
              onClick={onUnloadSetlist}
              title="Salir de la ejecución de este repertorio"
              aria-label="Cerrar repertorio en atril"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
