/**
 * @file chord-event.ts
 * @description Modela eventos de acordes armónicos (ChordEvent) en la línea de tiempo,
 * integrando el modelo estructurado de la Fase 1A (Chord, NoteName).
 */

import {
  type ChordAddedTone,
  type ChordAlteration,
  type ChordExtension,
  Chord,
} from '../music-theory/chord.ts';
import { type ChordQualityType } from '../music-theory/chord-quality.ts';
import { NoteName } from '../music-theory/note-name.ts';

export interface ChordStructuredJSON {
  root: string;
  quality: ChordQualityType;
  extensions: ChordExtension[];
  alterations: ChordAlteration[];
  addedTones: ChordAddedTone[];
  suspended: 2 | 4 | null;
  bass: string | null;
  symbol: string;
}

export interface ChordEventJSON {
  id: string;
  chord: ChordStructuredJSON;
  startTick: number;
  durationTicks?: number;
  measureNumber: number;
  voice?: number;
}

export class ChordEvent {
  public readonly id: string;
  public readonly chord: Chord;
  public readonly startTick: number;
  public readonly durationTicks?: number;
  public readonly measureNumber: number;
  public readonly voice?: number;

  public constructor(init: {
    id: string;
    chord: Chord;
    startTick: number;
    durationTicks?: number;
    measureNumber: number;
    voice?: number;
  }) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error(`ID de evento de acorde requerido e inválido: ${init.id}`);
    }
    if (!init.chord || !(init.chord instanceof Chord)) {
      throw new Error(`Objeto Chord requerido en evento ${init.id}`);
    }
    if (!Number.isInteger(init.startTick) || init.startTick < 0) {
      throw new Error(`Tick inicial de acorde inválido: ${init.startTick}. Debe ser >= 0.`);
    }
    if (init.durationTicks !== undefined && (!Number.isInteger(init.durationTicks) || init.durationTicks <= 0)) {
      throw new Error(`Duración en ticks de acorde inválida: ${init.durationTicks}. Debe ser >= 1.`);
    }
    if (!Number.isInteger(init.measureNumber) || init.measureNumber <= 0) {
      throw new Error(`Número de compás de acorde inválido: ${init.measureNumber}. Debe ser >= 1.`);
    }

    this.id = init.id;
    this.chord = init.chord;
    this.startTick = init.startTick;
    if (init.durationTicks !== undefined) this.durationTicks = init.durationTicks;
    this.measureNumber = init.measureNumber;
    if (init.voice !== undefined) this.voice = init.voice;
  }

  public get endTick(): number | undefined {
    return this.durationTicks !== undefined ? this.startTick + this.durationTicks : undefined;
  }

  public toJSON(): ChordEventJSON {
    const json: ChordEventJSON = {
      id: this.id,
      chord: {
        root: this.chord.root.toString(),
        quality: this.chord.quality,
        extensions: [...this.chord.extensions],
        alterations: [...this.chord.alterations],
        addedTones: [...this.chord.addedTones],
        suspended: this.chord.suspended,
        bass: this.chord.bass ? this.chord.bass.toString() : null,
        symbol: this.chord.toString('STANDARD'),
      },
      startTick: this.startTick,
      measureNumber: this.measureNumber,
    };
    if (this.durationTicks !== undefined) json.durationTicks = this.durationTicks;
    if (this.voice !== undefined) json.voice = this.voice;
    return json;
  }

  public static fromJSON(json: ChordEventJSON): ChordEvent {
    const root = NoteName.parse(json.chord.root);
    const bass = json.chord.bass ? NoteName.parse(json.chord.bass) : null;
    const chord = new Chord({
      root,
      quality: json.chord.quality,
      extensions: json.chord.extensions,
      alterations: json.chord.alterations,
      addedTones: json.chord.addedTones,
      suspended: json.chord.suspended,
      bass,
    });
    const init: {
      id: string;
      chord: Chord;
      startTick: number;
      durationTicks?: number;
      measureNumber: number;
      voice?: number;
    } = {
      id: json.id,
      chord,
      startTick: json.startTick,
      measureNumber: json.measureNumber,
    };
    if (json.durationTicks !== undefined) init.durationTicks = json.durationTicks;
    if (json.voice !== undefined) init.voice = json.voice;
    return new ChordEvent(init);
  }
}
