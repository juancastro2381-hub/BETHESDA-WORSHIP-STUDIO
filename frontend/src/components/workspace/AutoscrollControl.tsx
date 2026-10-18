/**
 * @file AutoscrollControl.tsx
 * Exclusión estricta: Cero integración o exposición de hardware externo.
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
      // Ignorar si el foco está en un input o select
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

  return (
    <div className="autoscroll-control-bar" role="toolbar" aria-label="Control de Desplazamiento Automático (Autoscroll)">
      <div className="autoscroll-main-actions">
        {state.status === 'SCROLLING' ? (
          <button
            type="button"
            className="btn-autoscroll btn-autoscroll-pause"
            onClick={pause}
            aria-label="Pausar desplazamiento automático"
            title="Pausar desplazamiento (Barra Espaciadora)"
          >
            ⏸ Pausar
          </button>
        ) : state.status === 'PAUSED' ? (
          <button
            type="button"
            className="btn-autoscroll btn-autoscroll-resume"
            onClick={resume}
            aria-label="Reanudar desplazamiento automático"
            title="Reanudar desplazamiento (Barra Espaciadora)"
          >
            ▶ Reanudar
          </button>
        ) : (
          <button
            type="button"
            className="btn-autoscroll btn-autoscroll-start"
            onClick={start}
            aria-label="Iniciar desplazamiento automático"
            title="Iniciar desplazamiento (Barra Espaciadora)"
          >
            ▶ Autoscroll
          </button>
        )}

        {(state.status === 'SCROLLING' || state.status === 'PAUSED') && (
          <button
            type="button"
            className="btn-autoscroll btn-autoscroll-stop"
            onClick={stop}
            aria-label="Detener desplazamiento"
            title="Detener (Escape)"
          >
            ⏹ Detener
          </button>
        )}

        <button
          type="button"
          className="btn-autoscroll btn-autoscroll-reset"
          onClick={reset}
          aria-label="Volver al inicio de la partitura"
          title="Volver al inicio"
        >
          ⏮ Inicio
        </button>
      </div>

      <div className="autoscroll-speed-selector" role="group" aria-label="Velocidad de desplazamiento">
        <span className="autoscroll-speed-label">Velocidad:</span>
        {SPEED_OPTIONS.map((speedOption) => (
          <button
            key={speedOption}
            type="button"
            className={`btn-speed-option ${state.speed === speedOption ? 'active' : ''}`}
            onClick={() => setSpeed(speedOption)}
            aria-pressed={state.speed === speedOption}
            aria-label={`Velocidad ${speedOption}x`}
          >
            {speedOption}x
          </button>
        ))}
      </div>

      <div className="autoscroll-progress-indicator" aria-live="polite">
        <div className="progress-bar-bg">
          <div
            className="progress-bar-fill"
            style={{ width: `${state.progressPercentage}%` }}
            role="progressbar"
            aria-valuenow={state.progressPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <span className="progress-text">{state.progressPercentage}%</span>
      </div>
    </div>
  );
};
