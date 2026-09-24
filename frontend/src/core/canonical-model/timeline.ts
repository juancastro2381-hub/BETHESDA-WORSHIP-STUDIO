/**
 * @file timeline.ts
 * @description Modela la línea de tiempo global de la pieza musical (Timeline),
 * integrando la duración total en ticks enteros (480 TPQN), conteo de compases y mapa de tempos.
 */

import { TempoMap, type TempoMapJSON } from './tempo-map.ts';
import { CANONICAL_TPQN } from './types.ts';

export interface TimelineJSON {
  tpqn: number;
  totalDurationTicks: number;
  measureCount: number;
  tempoMap: TempoMapJSON;
}

export class Timeline {
  public readonly tpqn: number = CANONICAL_TPQN;
  public readonly totalDurationTicks: number;
  public readonly measureCount: number;
  public readonly tempoMap: TempoMap;

  public constructor(init: {
    totalDurationTicks: number;
    measureCount: number;
    tempoMap?: TempoMap;
    tpqn?: number;
  }) {
    if (init.tpqn !== undefined && init.tpqn !== CANONICAL_TPQN) {
      throw new Error(`Resolución TPQN no canónica: ${init.tpqn}. Bethesda Worship Studio exige exactamente ${CANONICAL_TPQN} TPQN.`);
    }
    if (!Number.isInteger(init.totalDurationTicks) || init.totalDurationTicks < 0) {
      throw new Error(`totalDurationTicks inválido: ${init.totalDurationTicks}. Debe ser >= 0.`);
    }
    if (!Number.isInteger(init.measureCount) || init.measureCount < 0) {
      throw new Error(`measureCount inválido: ${init.measureCount}. Debe ser >= 0.`);
    }

    this.totalDurationTicks = init.totalDurationTicks;
    this.measureCount = init.measureCount;
    this.tempoMap = init.tempoMap ?? TempoMap.constant(120);
  }

  public get totalDurationSeconds(): number {
    return this.tempoMap.tickToSeconds(this.totalDurationTicks);
  }

  public tickToSeconds(tick: number): number {
    return this.tempoMap.tickToSeconds(tick);
  }

  public secondsToTick(seconds: number): number {
    return this.tempoMap.secondsToTick(seconds);
  }

  public toJSON(): TimelineJSON {
    return {
      tpqn: this.tpqn,
      totalDurationTicks: this.totalDurationTicks,
      measureCount: this.measureCount,
      tempoMap: this.tempoMap.toJSON(),
    };
  }

  public static fromJSON(json: TimelineJSON): Timeline {
    const tempoMap = TempoMap.fromJSON(json.tempoMap);
    return new Timeline({
      tpqn: json.tpqn,
      totalDurationTicks: json.totalDurationTicks,
      measureCount: json.measureCount,
      tempoMap,
    });
  }
}
