/**
 * @file tempo-map.ts
 * @description Modela el mapa de tempos (TempoMap) y eventos de tempo individuales (TempoEvent),
 * permitiendo conversiones exactas entre ticks enteros (480 TPQN) y tiempo físico (segundos/milisegundos).
 */

import { CANONICAL_TPQN } from './types.ts';

export interface TempoEventJSON {
  tick: number;
  bpm: number;
}

export interface TempoMapJSON {
  events: TempoEventJSON[];
}

export class TempoEvent {
  public readonly tick: number;
  public readonly bpm: number;

  public constructor(tick: number, bpm: number) {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error(`Tick de tempo inválido: ${tick}. Debe ser un entero no negativo.`);
    }
    if (typeof bpm !== 'number' || bpm <= 0 || !Number.isFinite(bpm)) {
      throw new Error(`BPM de tempo inválido: ${bpm}. Debe ser un número positivo finito.`);
    }

    this.tick = tick;
    this.bpm = bpm;
  }

  public toJSON(): TempoEventJSON {
    return {
      tick: this.tick,
      bpm: this.bpm,
    };
  }

  public static fromJSON(json: TempoEventJSON): TempoEvent {
    return new TempoEvent(json.tick, json.bpm);
  }
}

export class TempoMap {
  public readonly events: readonly TempoEvent[];

  public constructor(events: TempoEvent[]) {
    if (!events || events.length === 0) {
      // Default: 120 BPM en tick 0
      this.events = Object.freeze([new TempoEvent(0, 120)]);
      return;
    }

    // Clonar y ordenar estrictamente por tick ascendente
    const sorted = [...events].sort((a, b) => a.tick - b.tick);

    // Asegurar que exista un evento en tick 0
    if (sorted[0]?.tick !== 0) {
      sorted.unshift(new TempoEvent(0, sorted[0]?.bpm ?? 120));
    }

    // Validar duplicados en el mismo tick
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (current && next && current.tick === next.tick) {
        throw new Error(`Múltiples eventos de tempo en el mismo tick: ${current.tick}`);
      }
    }

    this.events = Object.freeze(sorted);
  }

  /**
   * Crea un mapa con un tempo constante desde el tick 0.
   */
  public static constant(bpm: number): TempoMap {
    return new TempoMap([new TempoEvent(0, bpm)]);
  }

  /**
   * Obtiene el tempo en BPM activo en un tick determinado.
   */
  public getTempoAtTick(tick: number): number {
    if (tick < 0) {
      return this.events[0]?.bpm ?? 120;
    }

    let activeBpm = this.events[0]?.bpm ?? 120;
    for (const ev of this.events) {
      if (ev.tick <= tick) {
        activeBpm = ev.bpm;
      } else {
        break;
      }
    }
    return activeBpm;
  }

  /**
   * Convierte una posición en ticks a tiempo físico transcurrido en segundos,
   * integrando de forma continua todos los cambios de tempo previos.
   *
   * Fórmula:
   *  deltaSegundos = (deltaTicks * 60) / (CANONICAL_TPQN * bpm)
   */
  public tickToSeconds(targetTick: number): number {
    if (targetTick <= 0) {
      return 0;
    }

    let elapsedSeconds = 0;
    let currentTick = 0;

    for (let i = 0; i < this.events.length; i++) {
      const currentEvent = this.events[i];
      if (!currentEvent) break;

      const nextEvent = this.events[i + 1];
      const nextTick = nextEvent ? Math.min(nextEvent.tick, targetTick) : targetTick;

      if (targetTick > currentTick) {
        const deltaTicks = nextTick - currentTick;
        const segmentSeconds = (deltaTicks * 60) / (CANONICAL_TPQN * currentEvent.bpm);
        elapsedSeconds += segmentSeconds;
        currentTick = nextTick;
      }

      if (currentTick >= targetTick) {
        break;
      }
    }

    return elapsedSeconds;
  }

  /**
   * Convierte tiempo físico en segundos a la posición en ticks canónicos más cercana.
   */
  public secondsToTick(targetSeconds: number): number {
    if (targetSeconds <= 0) {
      return 0;
    }

    let remainingSeconds = targetSeconds;
    let accumulatedTicks = 0;

    for (let i = 0; i < this.events.length; i++) {
      const currentEvent = this.events[i];
      if (!currentEvent) break;

      const nextEvent = this.events[i + 1];
      const ticksToNext = nextEvent ? nextEvent.tick - currentEvent.tick : Infinity;
      const secondsToNext =
        ticksToNext === Infinity
          ? Infinity
          : (ticksToNext * 60) / (CANONICAL_TPQN * currentEvent.bpm);

      if (remainingSeconds <= secondsToNext) {
        const deltaTicks = (remainingSeconds * CANONICAL_TPQN * currentEvent.bpm) / 60;
        return Math.round(accumulatedTicks + deltaTicks);
      } else {
        remainingSeconds -= secondsToNext;
        accumulatedTicks += ticksToNext;
      }
    }

    return Math.round(accumulatedTicks);
  }

  public toJSON(): TempoMapJSON {
    return {
      events: this.events.map((e) => e.toJSON()),
    };
  }

  public static fromJSON(json: TempoMapJSON): TempoMap {
    const events = (json.events || []).map((e) => TempoEvent.fromJSON(e));
    return new TempoMap(events);
  }
}
