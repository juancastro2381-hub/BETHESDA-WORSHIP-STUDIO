/**
 * @file use-autoscroll.ts
 * @description Hook de React para desplazamiento vertical automático suave a velocidad constante (WP-05).
 *
 * Características:
 * - Resolución aislada sobre el viewport musical dedicado (.workspace-viewport-area o visor visual anidado).
 * - Acumulador de subpíxeles (virtualScrollTopRef) para movimiento suave independiente de la tasa
 *   de refresco (60Hz / 120Hz / 144Hz) incluso a velocidades lentas (0.5x).
 * - Velocidad basada estrictamente en delta de tiempo (con límite anti-saltos de 100ms/frame).
 * - Pausa inteligente ante interacción táctil o rueda del usuario con tiempo de gracia (gracePeriodMs).
 * - Pausa automática si la pestaña del navegador pierde visibilidad (Page Visibility API).
 * - Limpieza absoluta de temporizadores y frames al desmontar o detener.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  type AutoscrollConfig,
  type AutoscrollController,
  type AutoscrollSpeed,
  type AutoscrollState,
  type AutoscrollStatus,
} from './types.ts';

const AVAILABLE_SPEEDS: readonly AutoscrollSpeed[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

function isElementScrollableY(el: HTMLElement): boolean {
  const maxScroll = el.scrollHeight - el.clientHeight;
  if (maxScroll <= 2) return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const overflowY = window.getComputedStyle(el).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  }
  return true;
}

/**
 * Resuelve exclusivamente el viewport de lectura musical dedicado:
 * 1. Visor visual anidado (.visual-document-viewport, .score-viewport-container) si posee desbordamiento propio.
 * 2. El propio contenedor musical dedicado (viewportRef.current / .workspace-viewport-area).
 *
 * Nunca desplaza el documento raíz ni la ventana externa, manteniendo estacionaria toda la página.
 */
export function resolveScrollTarget(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;

  const nested = element.querySelector<HTMLElement>(
    '.visual-document-viewport, .score-viewport-container'
  );
  if (nested && isElementScrollableY(nested)) {
    return nested;
  }

  return element;
}

export function useAutoscroll(
  containerRef: React.RefObject<HTMLElement | null>,
  config?: AutoscrollConfig
): AutoscrollController {
  const baseSpeed = config?.basePixelsPerSecond ?? 35; // px por segundo en velocidad 1.0x
  const pauseOnUserScroll = config?.pauseOnUserScroll ?? true;
  const gracePeriodMs = config?.manualScrollGracePeriodMs ?? 2000;

  const [status, setStatus] = useState<AutoscrollStatus>('IDLE');
  const [speed, setSpeed] = useState<AutoscrollSpeed>(1.0);
  const [currentScrollTop, setCurrentScrollTop] = useState<number>(0);
  const [maxScrollTop, setMaxScrollTop] = useState<number>(0);
  const [progressPercentage, setProgressPercentage] = useState<number>(0);

  const animFrameIdRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const virtualScrollTopRef = useRef<number | null>(null);
  const lastReportedProgressRef = useRef<number>(-1);
  const isUserScrollingRef = useRef<boolean>(false);
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speedRef = useRef<AutoscrollSpeed>(speed);
  const statusRef = useRef<AutoscrollStatus>(status);

  speedRef.current = speed;

  // Detiene el frame actual de forma limpia e idempotente
  const cancelLoop = useCallback(() => {
    if (animFrameIdRef.current !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      animFrameIdRef.current = null;
    }
    lastTimestampRef.current = null;
  }, []);

  // Bucle de animación suave basado en tiempo transcurrido y acumulador subpíxel
  const scrollLoop = useCallback(
    (timestamp: number) => {
      const container = resolveScrollTarget(containerRef.current);
      if (!container || statusRef.current !== 'SCROLLING') {
        cancelLoop();
        return;
      }

      const clientHeight = container.clientHeight;
      const scrollHeight = container.scrollHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      if (maxScroll <= 2) {
        statusRef.current = 'COMPLETED';
        setStatus('COMPLETED');
        setCurrentScrollTop(0);
        setMaxScrollTop(0);
        setProgressPercentage(100);
        cancelLoop();
        return;
      }

      if (lastTimestampRef.current === null) {
        lastTimestampRef.current = timestamp;
        virtualScrollTopRef.current = container.scrollTop;
        animFrameIdRef.current = requestAnimationFrame(scrollLoop);
        return;
      }

      // Acotar deltaSeconds a máximo 100ms para evitar saltos bruscos tras cambios de pestaña o pausas del hilo
      const rawDeltaSeconds = (timestamp - lastTimestampRef.current) / 1000;
      const deltaSeconds = Math.min(0.1, Math.max(0, rawDeltaSeconds));
      lastTimestampRef.current = timestamp;

      if (isUserScrollingRef.current) {
        virtualScrollTopRef.current = container.scrollTop;
      } else {
        const basePos =
          virtualScrollTopRef.current !== null &&
          Math.abs(virtualScrollTopRef.current - container.scrollTop) <= 2
            ? virtualScrollTopRef.current
            : container.scrollTop;

        const pixelsToAdvance = deltaSeconds * baseSpeed * speedRef.current;
        const nextTop = Math.min(maxScroll, basePos + pixelsToAdvance);
        virtualScrollTopRef.current = nextTop;
        container.scrollTop = nextTop;
      }

      const currentScroll = container.scrollTop;
      const nextProgress = Math.min(100, Math.round((currentScroll / maxScroll) * 100));

      if (nextProgress !== lastReportedProgressRef.current) {
        lastReportedProgressRef.current = nextProgress;
        setCurrentScrollTop(Math.round(currentScroll));
        setMaxScrollTop(maxScroll);
        setProgressPercentage(nextProgress);
      }

      // Detener automáticamente al alcanzar el final del contenido musical
      if (currentScroll >= maxScroll - 2) {
        container.scrollTop = maxScroll;
        virtualScrollTopRef.current = maxScroll;
        statusRef.current = 'COMPLETED';
        setStatus('COMPLETED');
        setCurrentScrollTop(maxScroll);
        setMaxScrollTop(maxScroll);
        setProgressPercentage(100);
        cancelLoop();
        return;
      }

      animFrameIdRef.current = requestAnimationFrame(scrollLoop);
    },
    [containerRef, baseSpeed, cancelLoop]
  );

  // Iniciar desplazamiento continuo
  const start = useCallback(() => {
    const container = resolveScrollTarget(containerRef.current);
    if (!container) return;

    // Si ya está desplazándose, no crear loop duplicado (idempotencia)
    if (statusRef.current === 'SCROLLING' && animFrameIdRef.current !== null) {
      return;
    }

    cancelLoop();

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScroll <= 2) {
      statusRef.current = 'COMPLETED';
      setStatus('COMPLETED');
      setMaxScrollTop(0);
      setProgressPercentage(100);
      return;
    }

    // Si estaba COMPLETED al final y se vuelve a iniciar, regresar al principio limpiamente
    if (statusRef.current === 'COMPLETED' && container.scrollTop >= maxScroll - 2) {
      container.scrollTop = 0;
    }

    virtualScrollTopRef.current = container.scrollTop;
    lastReportedProgressRef.current = -1;
    statusRef.current = 'SCROLLING';
    setStatus('SCROLLING');
    lastTimestampRef.current = null;
    animFrameIdRef.current = requestAnimationFrame(scrollLoop);
  }, [containerRef, cancelLoop, scrollLoop]);

  // Pausar desplazamiento manteniendo la posición actual
  const pause = useCallback(() => {
    cancelLoop();
    statusRef.current = 'PAUSED';
    setStatus('PAUSED');
  }, [cancelLoop]);

  // Reanudar desplazamiento desde la posición actual
  const resume = useCallback(() => {
    if (statusRef.current === 'PAUSED') {
      start();
    }
  }, [start]);

  // Detener
  const stop = useCallback(() => {
    cancelLoop();
    statusRef.current = 'IDLE';
    setStatus('IDLE');
  }, [cancelLoop]);

  // Alternar play/pause
  const togglePlayPause = useCallback(() => {
    if (statusRef.current === 'SCROLLING') {
      pause();
    } else if (statusRef.current === 'PAUSED' || statusRef.current === 'IDLE' || statusRef.current === 'COMPLETED') {
      start();
    }
  }, [start, pause]);

  // Resetear scroll al inicio de la partitura
  const reset = useCallback(() => {
    cancelLoop();
    const container = resolveScrollTarget(containerRef.current);
    if (container) {
      container.scrollTop = 0;
      virtualScrollTopRef.current = 0;
      lastReportedProgressRef.current = 0;
      setCurrentScrollTop(0);
      setProgressPercentage(0);
    }
    statusRef.current = 'IDLE';
    setStatus('IDLE');
  }, [containerRef, cancelLoop]);

  // Ajuste de velocidad
  const changeSpeed = useCallback((newSpeed: AutoscrollSpeed) => {
    speedRef.current = newSpeed;
    setSpeed(newSpeed);
  }, []);

  const increaseSpeed = useCallback(() => {
    const currentIndex = AVAILABLE_SPEEDS.indexOf(speedRef.current);
    if (currentIndex >= 0 && currentIndex < AVAILABLE_SPEEDS.length - 1) {
      const nextSpeed = AVAILABLE_SPEEDS[currentIndex + 1];
      if (nextSpeed !== undefined) {
        speedRef.current = nextSpeed;
        setSpeed(nextSpeed);
      }
    }
  }, []);

  const decreaseSpeed = useCallback(() => {
    const currentIndex = AVAILABLE_SPEEDS.indexOf(speedRef.current);
    if (currentIndex > 0) {
      const prevSpeed = AVAILABLE_SPEEDS[currentIndex - 1];
      if (prevSpeed !== undefined) {
        speedRef.current = prevSpeed;
        setSpeed(prevSpeed);
      }
    }
  }, []);

  // 1. Detección de interacción manual del usuario (rueda / táctil) exclusivamente sobre el viewport musical
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl || !pauseOnUserScroll) return;

    const handleUserInteraction = () => {
      if (statusRef.current === 'SCROLLING') {
        isUserScrollingRef.current = true;
        if (userScrollTimeoutRef.current) {
          clearTimeout(userScrollTimeoutRef.current);
        }
        userScrollTimeoutRef.current = setTimeout(() => {
          isUserScrollingRef.current = false;
          const activeTarget = resolveScrollTarget(containerRef.current);
          if (activeTarget) {
            virtualScrollTopRef.current = activeTarget.scrollTop;
          }
        }, gracePeriodMs);
      }
    };

    containerEl.addEventListener('wheel', handleUserInteraction, { passive: true });
    containerEl.addEventListener('touchstart', handleUserInteraction, { passive: true });

    return () => {
      containerEl.removeEventListener('wheel', handleUserInteraction);
      containerEl.removeEventListener('touchstart', handleUserInteraction);
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
        userScrollTimeoutRef.current = null;
      }
    };
  }, [containerRef, pauseOnUserScroll, gracePeriodMs]);

  // 2. Detección de visibilidad de pestaña (pausar si la pestaña se oculta sin saltos al volver)
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.hidden && statusRef.current === 'SCROLLING') {
        pause();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pause]);

  // 2b. Sincronizar indicador de progreso al desplazar manualmente dentro del viewport musical o redimensionar
  useEffect(() => {
    const containerEl = containerRef.current;

    const syncProgress = () => {
      if (statusRef.current === 'SCROLLING') return;
      const target = resolveScrollTarget(containerRef.current);
      if (!target) return;
      const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
      const currentScroll = target.scrollTop;
      const nextProgress = maxScroll > 2 ? Math.min(100, Math.round((currentScroll / maxScroll) * 100)) : 0;
      if (nextProgress !== lastReportedProgressRef.current) {
        lastReportedProgressRef.current = nextProgress;
        setCurrentScrollTop(Math.round(currentScroll));
        setMaxScrollTop(maxScroll);
        setProgressPercentage(nextProgress);
      }
    };

    containerEl?.addEventListener('scroll', syncProgress, { passive: true });
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', syncProgress, { passive: true });
    }
    return () => {
      containerEl?.removeEventListener('scroll', syncProgress);
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', syncProgress);
      }
    };
  }, [containerRef]);

  // 3. Limpieza absoluta en desmontaje
  useEffect(() => {
    return () => {
      cancelLoop();
    };
  }, [cancelLoop]);

  const state: AutoscrollState = {
    status,
    isRunning: status === 'SCROLLING',
    isPaused: status === 'PAUSED',
    speed,
    currentScrollTop,
    maxScrollTop,
    progressPercentage,
  };

  return {
    state,
    start,
    pause,
    resume,
    stop,
    togglePlayPause,
    setSpeed: changeSpeed,
    increaseSpeed,
    decreaseSpeed,
    reset,
  };
}
