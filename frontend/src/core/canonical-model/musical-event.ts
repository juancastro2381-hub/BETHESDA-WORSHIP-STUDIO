/**
 * @file musical-event.ts
 * @description Modela eventos musicales (Note, Rest), polifonía de voces (Voice)
 * y metadatos de articulación/ligadura sin atarse a renderizadores visuales.
 */

import { NoteName } from '../music-theory/note-name.ts';
import { Pitch } from '../music-theory/pitch.ts';
import {
  type ArticulationType,
  type DynamicMarking,
  type StemDirection,
  type TieType,
} from './types.ts';

export interface NoteJSON {
  type: 'NOTE';
  id: string;
  pitch: {
    noteName: string;
    octave: number;
  };
  startTick: number;
  durationTicks: number;
  voice: number;
  staff: number;
  velocity: number;
  dynamic?: DynamicMarking;
  articulations: ArticulationType[];
  tie: TieType;
  stemDirection: StemDirection;
  notationMetadata?: Record<string, unknown>;
}

export interface RestJSON {
  type: 'REST';
  id: string;
  startTick: number;
  durationTicks: number;
  voice: number;
  staff: number;
}

export type MusicalEventJSON = NoteJSON | RestJSON;

export class Note {
  public readonly isRest: false = false;
  public readonly id: string;
  public readonly pitch: Pitch;
  public readonly startTick: number;
  public readonly durationTicks: number;
  public readonly voice: number;
  public readonly staff: number;
  public readonly velocity: number;
  public readonly dynamic?: DynamicMarking;
  public readonly articulations: readonly ArticulationType[];
  public readonly tie: TieType;
  public readonly stemDirection: StemDirection;
  public readonly notationMetadata?: Readonly<Record<string, unknown>>;

  public constructor(init: {
    id: string;
    pitch: Pitch;
    startTick: number;
    durationTicks: number;
    voice?: number;
    staff?: number;
    velocity?: number;
    dynamic?: DynamicMarking;
    articulations?: ArticulationType[];
    tie?: TieType;
    stemDirection?: StemDirection;
    notationMetadata?: Record<string, unknown>;
  }) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error(`ID de nota requerido e inválido: ${init.id}`);
    }
    if (!init.pitch || !(init.pitch instanceof Pitch)) {
      throw new Error(`Tono (Pitch) de nota inválido o no proporcionado en nota ${init.id}`);
    }
    if (!Number.isInteger(init.startTick) || init.startTick < 0) {
      throw new Error(`Tick inicial de nota inválido: ${init.startTick}. Debe ser >= 0.`);
    }
    if (!Number.isInteger(init.durationTicks) || init.durationTicks <= 0) {
      throw new Error(`Duración en ticks de nota inválida: ${init.durationTicks}. Debe ser >= 1.`);
    }

    this.id = init.id;
    this.pitch = init.pitch;
    this.startTick = init.startTick;
    this.durationTicks = init.durationTicks;
    this.voice = init.voice ?? 1;
    this.staff = init.staff ?? 1;
    this.velocity = Math.max(0, Math.min(127, init.velocity ?? 64));
    if (init.dynamic) this.dynamic = init.dynamic;
    this.articulations = Object.freeze([...(init.articulations ?? [])]);
    this.tie = init.tie ?? 'NONE';
    this.stemDirection = init.stemDirection ?? 'AUTO';
    if (init.notationMetadata) {
      this.notationMetadata = Object.freeze({ ...init.notationMetadata });
    }
  }

  public get endTick(): number {
    return this.startTick + this.durationTicks;
  }

  public toJSON(): NoteJSON {
    const json: NoteJSON = {
      type: 'NOTE',
      id: this.id,
      pitch: {
        noteName: this.pitch.noteName.toString(),
        octave: this.pitch.octave,
      },
      startTick: this.startTick,
      durationTicks: this.durationTicks,
      voice: this.voice,
      staff: this.staff,
      velocity: this.velocity,
      articulations: [...this.articulations],
      tie: this.tie,
      stemDirection: this.stemDirection,
    };
    if (this.dynamic) json.dynamic = this.dynamic;
    if (this.notationMetadata) json.notationMetadata = { ...this.notationMetadata };
    return json;
  }

  public static fromJSON(json: NoteJSON): Note {
    const noteName = NoteName.parse(json.pitch.noteName);
    const pitch = new Pitch(noteName, json.pitch.octave);
    const init: {
      id: string;
      pitch: Pitch;
      startTick: number;
      durationTicks: number;
      voice: number;
      staff: number;
      velocity: number;
      dynamic?: DynamicMarking;
      articulations: ArticulationType[];
      tie: TieType;
      stemDirection: StemDirection;
      notationMetadata?: Record<string, unknown>;
    } = {
      id: json.id,
      pitch,
      startTick: json.startTick,
      durationTicks: json.durationTicks,
      voice: json.voice,
      staff: json.staff,
      velocity: json.velocity,
      articulations: json.articulations,
      tie: json.tie,
      stemDirection: json.stemDirection,
    };
    if (json.dynamic) init.dynamic = json.dynamic;
    if (json.notationMetadata) init.notationMetadata = json.notationMetadata;
    return new Note(init);
  }
}

export class Rest {
  public readonly isRest: true = true;
  public readonly id: string;
  public readonly startTick: number;
  public readonly durationTicks: number;
  public readonly voice: number;
  public readonly staff: number;

  public constructor(init: {
    id: string;
    startTick: number;
    durationTicks: number;
    voice?: number;
    staff?: number;
  }) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error(`ID de silencio requerido e inválido: ${init.id}`);
    }
    if (!Number.isInteger(init.startTick) || init.startTick < 0) {
      throw new Error(`Tick inicial de silencio inválido: ${init.startTick}. Debe ser >= 0.`);
    }
    if (!Number.isInteger(init.durationTicks) || init.durationTicks <= 0) {
      throw new Error(`Duración en ticks de silencio inválida: ${init.durationTicks}. Debe ser >= 1.`);
    }

    this.id = init.id;
    this.startTick = init.startTick;
    this.durationTicks = init.durationTicks;
    this.voice = init.voice ?? 1;
    this.staff = init.staff ?? 1;
  }

  public get endTick(): number {
    return this.startTick + this.durationTicks;
  }

  public toJSON(): RestJSON {
    return {
      type: 'REST',
      id: this.id,
      startTick: this.startTick,
      durationTicks: this.durationTicks,
      voice: this.voice,
      staff: this.staff,
    };
  }

  public static fromJSON(json: RestJSON): Rest {
    return new Rest(json);
  }
}

export type MusicalEvent = Note | Rest;

export interface VoiceJSON {
  id: number;
  events: MusicalEventJSON[];
}

export class Voice {
  public readonly id: number;
  public readonly events: readonly MusicalEvent[];

  public constructor(id: number, events: MusicalEvent[]) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`ID de voz inválido: ${id}. Debe ser un entero positivo.`);
    }

    // Verificar que los eventos asignados a esta voz correspondan a su ID
    const sorted = [...events].sort((a, b) => a.startTick - b.startTick);
    for (const ev of sorted) {
      if (ev.voice !== id) {
        throw new Error(
          `Inconsistencia en voz ${id}: el evento ${ev.id} declara pertenecer a la voz ${ev.voice}.`
        );
      }
    }

    this.id = id;
    this.events = Object.freeze(sorted);
  }

  public getNotes(): Note[] {
    return this.events.filter((e): e is Note => !e.isRest);
  }

  public getRests(): Rest[] {
    return this.events.filter((e): e is Rest => e.isRest);
  }

  public calculateTotalDurationTicks(): number {
    return this.events.reduce((acc, ev) => acc + ev.durationTicks, 0);
  }

  public toJSON(): VoiceJSON {
    return {
      id: this.id,
      events: this.events.map((e) => e.toJSON()),
    };
  }

  public static fromJSON(json: VoiceJSON): Voice {
    const events: MusicalEvent[] = (json.events || []).map((e) => {
      if (e.type === 'NOTE') {
        return Note.fromJSON(e);
      } else {
        return Rest.fromJSON(e);
      }
    });
    return new Voice(json.id, events);
  }
}
