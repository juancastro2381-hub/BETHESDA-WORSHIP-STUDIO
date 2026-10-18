/**
 * @file types.ts
 * Exclusión estricta: Cero integración o exposición de hardware externo.
 */

export type AutoscrollStatus = 'IDLE' | 'SCROLLING' | 'PAUSED' | 'COMPLETED';

export type AutoscrollSpeed = 0.5 | 0.75 | 1.0 | 1.25 | 1.5 | 2.0 | 2.5 | 3.0;

export interface AutoscrollConfig {
  /** Velocidad base en píxeles por segundo a factor 1.0x (por defecto 35 px/s) */
  readonly basePixelsPerSecond?: number;
  /** Si debe pausar automáticamente al detectar interacción táctil o scroll de rueda del usuario */
  readonly pauseOnUserScroll?: boolean;
  /** Tiempo de gracia en milisegundos tras scroll manual antes de permitir reanudación */
  readonly manualScrollGracePeriodMs?: number;
}

export interface AutoscrollState {
  readonly status: AutoscrollStatus;
  readonly isRunning: boolean;
  readonly isPaused: boolean;
  readonly speed: AutoscrollSpeed;
  readonly currentScrollTop: number;
  readonly maxScrollTop: number;
  readonly progressPercentage: number;
}

export interface AutoscrollController {
  readonly state: AutoscrollState;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  togglePlayPause: () => void;
  setSpeed: (speed: AutoscrollSpeed) => void;
  increaseSpeed: () => void;
  decreaseSpeed: () => void;
  reset: () => void;
}
