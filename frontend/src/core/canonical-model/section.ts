/**
 * @file section.ts
 * @description Modela las secciones estructurales de la pieza musical (Intro, Verso, Coro, Puente, etc.),
 * preservando el ordenamiento, rangos de compases y delimitación en ticks.
 */

import { type SectionType } from './types.ts';

export interface SectionJSON {
  id: string;
  type: SectionType;
  label: string;
  startMeasure: number;
  measureCount: number;
  startTick: number | null;
  durationTicks: number | null;
}

export class Section {
  public readonly id: string;
  public readonly type: SectionType;
  public readonly label: string;
  public readonly startMeasure: number;
  public readonly measureCount: number;
  public readonly startTick: number | null;
  public readonly durationTicks: number | null;

  public constructor(init: {
    id: string;
    type: SectionType;
    label: string;
    startMeasure: number;
    measureCount: number;
    startTick: number | null;
    durationTicks: number | null;
  }) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error(`ID de sección requerido e inválido: ${init.id}`);
    }
    if (!Number.isInteger(init.startMeasure) || init.startMeasure <= 0) {
      throw new Error(`Compás inicial de sección inválido: ${init.startMeasure}. Debe ser >= 1.`);
    }
    if (!Number.isInteger(init.measureCount) || init.measureCount <= 0) {
      throw new Error(`Cantidad de compases de sección inválida: ${init.measureCount}. Debe ser >= 1.`);
    }
    if (init.startTick !== null && (!Number.isInteger(init.startTick) || init.startTick < 0)) {
      throw new Error(`Tick inicial de sección inválido: ${init.startTick}. Debe ser >= 0 o null.`);
    }
    if (init.durationTicks !== null && (!Number.isInteger(init.durationTicks) || init.durationTicks <= 0)) {
      throw new Error(`Duración en ticks de sección inválida: ${init.durationTicks}. Debe ser >= 1 o null.`);
    }

    this.id = init.id;
    this.type = init.type;
    this.label = init.label.trim() || init.type;
    this.startMeasure = init.startMeasure;
    this.measureCount = init.measureCount;
    this.startTick = init.startTick;
    this.durationTicks = init.durationTicks;
  }

  public get endMeasure(): number {
    return this.startMeasure + this.measureCount - 1;
  }

  public get endTick(): number | null {
    if (this.startTick === null || this.durationTicks === null) {
      return null;
    }
    return this.startTick + this.durationTicks;
  }

  public containsMeasure(measureNumber: number): boolean {
    return measureNumber >= this.startMeasure && measureNumber <= this.endMeasure;
  }

  public containsTick(tick: number): boolean {
    if (this.startTick === null || this.endTick === null) {
      return false;
    }
    return tick >= this.startTick && tick < this.endTick;
  }

  public toJSON(): SectionJSON {
    return {
      id: this.id,
      type: this.type,
      label: this.label,
      startMeasure: this.startMeasure,
      measureCount: this.measureCount,
      startTick: this.startTick,
      durationTicks: this.durationTicks,
    };
  }

  public static fromJSON(json: SectionJSON): Section {
    return new Section({
      ...json,
      startTick: json.startTick ?? null,
      durationTicks: json.durationTicks ?? null,
    });
  }
}
