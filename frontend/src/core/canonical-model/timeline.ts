/**
 * @file timeline.ts
 * @description Modela la línea de tiempo global de la pieza musical (Timeline),
 * integrando la duración total en ticks enteros (480 TPQN), conteo de compases y mapa de tempos.
 */

import { TempoMap, type TempoMapJSON } from './tempo-map.ts';
import { CANONICAL_TPQN } from './types.ts';

export interface TimelineJSON {
  tpqn: number;
  totalDurationTicks: number | null;
  measureCount: number;
  tempoMap: TempoMapJSON;
  isUnmetered?: boolean;
}

export class Timeline {
  public readonly tpqn: number = CANONICAL_TPQN;
  public readonly totalDurationTicks: number | null;
  public readonly measureCount: number;
  public readonly tempoMap: TempoMap;
  public readonly isUnmetered: boolean;

  public constructor(init: {
    totalDurationTicks: number | null;
    measureCount: number;
    tempoMap?: TempoMap | undefined;
    tpqn?: number | undefined;
    isUnmetered?: boolean | undefined;
  }) {
    if (init.tpqn !== undefined && init.tpqn !== CANONICAL_TPQN) {
      throw new Error(`Resolución TPQN no canónica: ${init.tpqn}. Bethesda Worship Studio exige exactamente ${CANONICAL_TPQN} TPQN.`);
    }
    if (init.totalDurationTicks !== null && (!Number.isInteger(init.totalDurationTicks) || init.totalDurationTicks < 0)) {
      throw new Error(`totalDurationTicks inválido: ${init.totalDurationTicks}. Debe ser >= 0 o null.`);
    }
    if (!Number.isInteger(init.measureCount) || init.measureCount < 0) {
      throw new Error(`measureCount inválido: ${init.measureCount}. Debe ser >= 0.`);
    }

    this.totalDurationTicks = init.totalDurationTicks;
    this.measureCount = init.measureCount;
    this.tempoMap = init.tempoMap ?? new TempoMap([]);
    this.isUnmetered = Boolean(init.isUnmetered);
  }

  public get totalDurationSeconds(): number | null {
    if (this.totalDurationTicks === null || this.tempoMap.isUnresolved) {
      return null;
    }
    return this.tempoMap.tickToSeconds(this.totalDurationTicks);
  }

  public tickToSeconds(tick: number, fallbackBpm?: number): number {
    return this.tempoMap.tickToSeconds(tick, fallbackBpm);
  }

  public secondsToTick(seconds: number, fallbackBpm?: number): number {
    return this.tempoMap.secondsToTick(seconds, fallbackBpm);
  }

  public toJSON(): TimelineJSON {
    const json: TimelineJSON = {
      tpqn: this.tpqn,
      totalDurationTicks: this.totalDurationTicks,
      measureCount: this.measureCount,
      tempoMap: this.tempoMap.toJSON(),
    };
    if (this.isUnmetered) {
      json.isUnmetered = true;
    }
    return json;
  }

  public static fromJSON(json: TimelineJSON): Timeline {
    const tempoMap = TempoMap.fromJSON(json.tempoMap);
    return new Timeline({
      tpqn: json.tpqn,
      totalDurationTicks: json.totalDurationTicks ?? null,
      measureCount: json.measureCount,
      tempoMap,
      isUnmetered: json.isUnmetered,
    });
  }
}
