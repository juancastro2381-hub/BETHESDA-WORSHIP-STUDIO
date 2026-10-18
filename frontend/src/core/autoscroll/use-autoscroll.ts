/**
 * @file use-autoscroll.ts
 * @description Hook de control de desplazamiento automático continuo para vistas de lectura musical (WP-05).
 * Diseñado con estabilidad temporal mediante requestAnimationFrame, prevención de loops duplicados,
 * soporte de interacción manual del usuario y cero dependencia de hardware externo.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  type AutoscrollConfig,
  type AutoscrollController,
  type AutoscrollSpeed,
  type AutoscrollState,
  type AutoscrollStatus,
} from './types.ts';

const DEFAULT_BASE_PIXELS_PER_SECOND = 35;
const AVAILABLE_SPEEDS: readonly AutoscrollSpeed[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export function useAutoscroll(
  containerRef: React.RefObject<HTMLElement | null>,
  config?: AutoscrollConfig
): AutoscrollController {
  const baseSpeed = config?.basePixelsPerSecond ?? DEFAULT_BASE_PIXELS_PER_SECOND;
  const pauseOnUserScroll = config?.pauseOnUserScroll ?? true;
  const gracePeriodMs = config?.manualScrollGracePeriodMs ?? 800;

  const [status, setStatus] = useState<AutoscrollStatus>('IDLE');
  const [speed, setSpeed] = useState<AutoscrollSpeed>(1.0);
  const [currentScrollTop, setCurrentScrollTop] = useState<number>(0);
  const [maxScrollTop, setMaxScrollTop] = useState<number>(0);
  const [progressPercentage, setProgressPercentage] = useState<number>(0);

  const animFrameIdRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const speedRef = useRef<AutoscrollSpeed>(speed);
  const statusRef = useRef<AutoscrollStatus>(status);
  const isUserScrollingRef = useRef<boolean>(false);
  const userScrollTimeoutRef = useRef<any>(null);

  speedRef.current = speed;
  statusRef.current = status;

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

  // Bucle de animación suave
  const scrollLoop = useCallback(
    (timestamp: number) => {
      const container = containerRef.current;
      if (!container || statusRef.current !== 'SCROLLING') {
        cancelLoop();
        return;
      }

      const clientHeight = container.clientHeight;
      const scrollHeight = container.scrollHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      if (maxScroll <= 0) {
        // Contenido cabe completo en pantalla; nada que desplazar
        setStatus('COMPLETED');
        cancelLoop();
        return;
      }

      if (lastTimestampRef.current === null) {
        lastTimestampRef.current = timestamp;
      }

      const deltaSeconds = (timestamp - lastTimestampRef.current) / 1000;
      lastTimestampRef.current = timestamp;

      // Calcular avance en píxeles según velocidad configurada
      const pixelsToAdvance = deltaSeconds * baseSpeed * speedRef.current;

      if (!isUserScrollingRef.current) {
        container.scrollTop += pixelsToAdvance;
      }

      const currentScroll = container.scrollTop;
      setCurrentScrollTop(currentScroll);
      setMaxScrollTop(maxScroll);
      setProgressPercentage(Math.min(100, Math.round((currentScroll / maxScroll) * 100)));

      // Verificación de fin de partitura (llegó al fondo con margen de 2px)
      if (currentScroll >= maxScroll - 2) {
        setStatus('COMPLETED');
        cancelLoop();
        return;
      }

      // Continuar siguiente frame evitando loops duplicados
      animFrameIdRef.current = requestAnimationFrame(scrollLoop);
    },
    [containerRef, baseSpeed, cancelLoop]
  );

  // Iniciar desplazamiento continuo
  const start = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Si ya está desplazándose, no crear loop duplicado (idempotencia)
    if (statusRef.current === 'SCROLLING' && animFrameIdRef.current !== null) {
      return;
    }

    // Cancelar cualquier frame huérfano previo antes de lanzar nuevo
    cancelLoop();

    setStatus('SCROLLING');
    lastTimestampRef.current = null;
    animFrameIdRef.current = requestAnimationFrame(scrollLoop);
  }, [containerRef, cancelLoop, scrollLoop]);

  // Pausar desplazamiento
  const pause = useCallback(() => {
    cancelLoop();
    setStatus('PAUSED');
  }, [cancelLoop]);

  // Reanudar desplazamiento
  const resume = useCallback(() => {
    if (statusRef.current === 'PAUSED') {
      start();
    }
  }, [start]);

  // Detener y resetear
  const stop = useCallback(() => {
    cancelLoop();
    setStatus('IDLE');
  }, [cancelLoop]);

  // Alternar play/pause
  const togglePlayPause = useCallback(() => {
    if (statusRef.current === 'SCROLLING') {
      pause();
    } else if (statusRef.current === 'PAUSED' || statusRef.current === 'IDLE') {
      start();
    }
  }, [start, pause]);

  // Resetear scroll al inicio de la partitura
  const reset = useCallback(() => {
    cancelLoop();
    const container = containerRef.current;
    if (container) {
      container.scrollTop = 0;
      setCurrentScrollTop(0);
      setProgressPercentage(0);
    }
    setStatus('IDLE');
  }, [containerRef, cancelLoop]);

  // Ajuste de velocidad
  const changeSpeed = useCallback((newSpeed: AutoscrollSpeed) => {
    setSpeed(newSpeed);
  }, []);

  const increaseSpeed = useCallback(() => {
    const currentIndex = AVAILABLE_SPEEDS.indexOf(speedRef.current);
    if (currentIndex >= 0 && currentIndex < AVAILABLE_SPEEDS.length - 1) {
      const nextSpeed = AVAILABLE_SPEEDS[currentIndex + 1];
      if (nextSpeed !== undefined) {
        setSpeed(nextSpeed);
      }
    }
  }, []);

  const decreaseSpeed = useCallback(() => {
    const currentIndex = AVAILABLE_SPEEDS.indexOf(speedRef.current);
    if (currentIndex > 0) {
      const prevSpeed = AVAILABLE_SPEEDS[currentIndex - 1];
      if (prevSpeed !== undefined) {
        setSpeed(prevSpeed);
      }
    }
  }, []);

  // 1. Detección de interacción manual del usuario (scroll táctil / rueda)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pauseOnUserScroll) return;

    const handleUserInteraction = () => {
      if (statusRef.current === 'SCROLLING') {
        isUserScrollingRef.current = true;
        if (userScrollTimeoutRef.current) {
          clearTimeout(userScrollTimeoutRef.current);
        }
        userScrollTimeoutRef.current = setTimeout(() => {
          isUserScrollingRef.current = false;
        }, gracePeriodMs);
      }
    };

    container.addEventListener('wheel', handleUserInteraction, { passive: true });
    container.addEventListener('touchstart', handleUserInteraction, { passive: true });

    return () => {
      container.removeEventListener('wheel', handleUserInteraction);
      container.removeEventListener('touchstart', handleUserInteraction);
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
    };
  }, [containerRef, pauseOnUserScroll, gracePeriodMs]);

  // 2. Detección de visibilidad de pestaña (pausar si la pestaña se oculta)
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
