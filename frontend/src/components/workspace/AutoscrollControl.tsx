/**
 * @file AutoscrollControl.tsx
 * @description Barra flotante responsiva de control de desplazamiento automático (Autoscroll)
 * para el Atril Digital. Opera exclusivamente sobre la lectura visual sin reproducción de audio.
 */

import React, { useEffect, useCallback } from 'react';
import { type AutoscrollController, type AutoscrollSpeed } from '../../core/autoscroll/types.ts';

export interface AutoscrollControlProps {
  readonly controller: AutoscrollController;
  readonly isVisible?: boolean;
}

const SPEED_OPTIONS: readonly AutoscrollSpeed[] = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];

export const AutoscrollControl: React.FC<AutoscrollControlProps> = ({
  controller,
  isVisible = true,
}) => {
  const { state, start, pause, resume, stop, togglePlayPause, setSpeed, reset } = controller;

  // Atajos de teclado para accesibilidad (Espacio = Play/Pause, Escape = Stop)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        stop();
      }
    },
    [togglePlayPause, stop]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  if (!isVisible) {
    return null;
  }

  const isScrolling = state.status === 'SCROLLING';
  const isPaused = state.status === 'PAUSED';
  const isIdleOrCompleted = state.status === 'IDLE' || state.status === 'COMPLETED';

  return (
    <aside
      className={`autoscroll-control-bar status-${state.status.toLowerCase()}`}
      role="toolbar"
      aria-label="Controles flotantes de lectura y desplazamiento automático"
      data-status={state.status}
    >
      <div className="autoscroll-main-actions">
        {isScrolling ? (
          <button
            type="button"
            className="btn-autoscroll btn-autoscroll-pause is-active"
            onClick={pause}
            aria-pressed="true"
            aria-label="Pausar desplazamiento automático"
            title="Pausar desplazamiento (Barra Espaciadora)"
          >
            <span aria-hidden="true">⏸</span>
            <span>Pausar</span>
          </button>
        ) : isPaused ? (
          <button
            type="button"
            className="btn-autoscroll btn-autoscroll-resume"
            onClick={resume}
            aria-pressed="false"
            aria-label="Reanudar desplazamiento automático desde la posición actual"
            title="Reanudar desde la posición actual (Barra Espaciadora)"
          >
            <span aria-hidden="true">▶</span>
            <span>Reanudar</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn-autoscroll btn-autoscroll-start"
            onClick={start}
            aria-pressed="false"
            aria-label="Iniciar desplazamiento automático"
            title="Iniciar desplazamiento automático (Barra Espaciadora)"
          >
            <span aria-hidden="true">▶</span>
            <span>Autoscroll</span>
          </button>
        )}

        <button
          type="button"
          className="btn-autoscroll btn-autoscroll-stop"
          onClick={stop}
          disabled={isIdleOrCompleted}
          aria-label="Detener desplazamiento automático manteniendo la posición actual"
          title="Detener manteniendo posición actual (Escape)"
        >
          <span aria-hidden="true">⏹</span>
          <span>Detener</span>
        </button>

        <button
          type="button"
          className="btn-autoscroll btn-autoscroll-reset"
          onClick={reset}
          aria-label="Volver al inicio del contenido musical"
          title="Volver al inicio (0%)"
        >
          <span aria-hidden="true">⏮</span>
          <span>Inicio</span>
        </button>
      </div>

      <div className="autoscroll-speed-selector" role="group" aria-label="Selector de velocidad de lectura">
        <span className="autoscroll-speed-label">Velocidad:</span>
        {SPEED_OPTIONS.map((speedOption) => {
          const isSelected = state.speed === speedOption;
          return (
            <button
              key={speedOption}
              type="button"
              className={`btn-speed-option ${isSelected ? 'active' : ''}`}
              onClick={() => setSpeed(speedOption)}
              aria-pressed={isSelected}
              aria-label={`Velocidad ${speedOption}x`}
            >
              {speedOption}x
            </button>
          );
        })}
      </div>

      <div className="autoscroll-progress-indicator" aria-live="polite">
        <div className="progress-bar-bg">
          <div
            className="progress-bar-fill"
            style={{ width: `${state.progressPercentage}%` }}
            role="progressbar"
            aria-label="Progreso de lectura"
            aria-valuenow={state.progressPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <span className="progress-text">{state.progressPercentage}%</span>
      </div>
    </aside>
  );
};
