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
  isUnresolved?: boolean;
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
  public readonly isUnresolved: boolean;

  public constructor(events?: TempoEvent[]) {
    if (!events || events.length === 0) {
      // CERO FABRICACIÓN: Un mapa sin eventos permanece explícitamente no resuelto (sin fabricar 120 BPM)
      this.events = Object.freeze([]);
      this.isUnresolved = true;
      return;
    }

    this.isUnresolved = false;
    // Clonar y ordenar estrictamente por tick ascendente
    const sorted = [...events].sort((a, b) => a.tick - b.tick);

    // Asegurar que exista un evento en tick 0 si hay eventos declarados
    if (sorted[0] && sorted[0].tick !== 0) {
      sorted.unshift(new TempoEvent(0, sorted[0].bpm));
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
   * Crea un mapa de tempo vacío / no resuelto (sin fabricar 120 BPM).
   */
  public static unresolved(): TempoMap {
    return new TempoMap([]);
  }

  /**
   * Obtiene el tempo en BPM activo en un tick determinado.
   * Retorna null si el tempo no está resuelto.
   */
  public getTempoAtTick(tick: number): number | null {
    if (this.events.length === 0) {
      return null;
    }

    if (tick < 0) {
      return this.events[0]?.bpm ?? null;
    }

    let activeBpm: number | null = this.events[0]?.bpm ?? null;
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
   * Obtiene el tempo en BPM activo para propósitos de visualización o renderizado
   * con un valor de fallback explícito (por defecto 120 BPM).
   * Este valor NUNCA se persiste como metadato canónico.
   */
  public getTempoAtTickWithFallback(tick: number, fallbackBpm: number = 120): number {
    return this.getTempoAtTick(tick) ?? fallbackBpm;
  }

  /**
   * Convierte una posición en ticks a tiempo físico transcurrido en segundos,
   * integrando de forma continua todos los cambios de tempo previos.
   *
   * Fórmula:
   *  deltaSegundos = (deltaTicks * 60) / (CANONICAL_TPQN * bpm)
   */
  public tickToSeconds(targetTick: number, fallbackBpm?: number): number {
    if (targetTick <= 0) {
      return 0;
    }

    if (this.events.length === 0) {
      if (fallbackBpm && fallbackBpm > 0) {
        return (targetTick * 60) / (CANONICAL_TPQN * fallbackBpm);
      }
      throw new Error(
        'No se puede calcular tiempo físico (segundos) en un TempoMap no resuelto sin un tempo BPM o fallback explícito.'
      );
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
  public secondsToTick(targetSeconds: number, fallbackBpm?: number): number {
    if (targetSeconds <= 0) {
      return 0;
    }

    if (this.events.length === 0) {
      if (fallbackBpm && fallbackBpm > 0) {
        const deltaTicks = (targetSeconds * CANONICAL_TPQN * fallbackBpm) / 60;
        return Math.round(deltaTicks);
      }
      throw new Error(
        'No se puede calcular ticks desde tiempo físico en un TempoMap no resuelto sin un tempo BPM o fallback explícito.'
      );
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
    const json: TempoMapJSON = {
      events: this.events.map((e) => e.toJSON()),
    };
    if (this.isUnresolved) {
      json.isUnresolved = true;
    }
    return json;
  }

  public static fromJSON(json: TempoMapJSON): TempoMap {
    if (!json || !json.events || json.events.length === 0) {
      return new TempoMap([]);
    }
    const events = (json.events || []).map((e) => TempoEvent.fromJSON(e));
    return new TempoMap(events);
  }
}
