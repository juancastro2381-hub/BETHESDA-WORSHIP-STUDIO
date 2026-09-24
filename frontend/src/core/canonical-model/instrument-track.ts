/**
 * @file instrument-track.ts
 * @description Modela pistas de instrumentos (InstrumentTrack) como descriptores lógicos y filtros
 * de proyección sobre el material musical canónico, preservando la regla arquitectónica de
 * no duplicar notas en entidades secundarias.
 */

import { type ClefType, type InstrumentFamily } from './types.ts';

export interface InstrumentTrackJSON {
  id: string;
  name: string;
  family: InstrumentFamily;
  clef: ClefType;
  transpositionOffsetSemitones: number;
  voiceIds: number[];
  staffCount: number;
  channel?: number;
  isPercussion?: boolean;
}

export class InstrumentTrack {
  public readonly id: string;
  public readonly name: string;
  public readonly family: InstrumentFamily;
  public readonly clef: ClefType;
  public readonly transpositionOffsetSemitones: number;
  public readonly voiceIds: readonly number[];
  public readonly staffCount: number;
  public readonly channel?: number;
  public readonly isPercussion: boolean;

  public constructor(init: {
    id: string;
    name: string;
    family: InstrumentFamily;
    clef?: ClefType;
    transpositionOffsetSemitones?: number;
    voiceIds?: number[];
    staffCount?: number;
    channel?: number;
    isPercussion?: boolean;
  }) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error(`ID de pista instrumental requerido e inválido: ${init.id}`);
    }
    if (!init.name || typeof init.name !== 'string') {
      throw new Error(`Nombre de pista requerido en pista ${init.id}`);
    }

    this.id = init.id;
    this.name = init.name.trim();
    this.family = init.family;
    this.clef = init.clef ?? (init.family === 'BASS' ? 'BASS' : 'TREBLE');
    this.transpositionOffsetSemitones = init.transpositionOffsetSemitones ?? 0;
    this.voiceIds = Object.freeze([...(init.voiceIds ?? [1])]);
    this.staffCount = init.staffCount ?? (init.family === 'KEYS' ? 2 : 1);
    if (init.channel !== undefined) this.channel = init.channel;
    this.isPercussion = init.isPercussion ?? init.family === 'DRUMS';
  }

  public toJSON(): InstrumentTrackJSON {
    const json: InstrumentTrackJSON = {
      id: this.id,
      name: this.name,
      family: this.family,
      clef: this.clef,
      transpositionOffsetSemitones: this.transpositionOffsetSemitones,
      voiceIds: [...this.voiceIds],
      staffCount: this.staffCount,
    };
    if (this.channel !== undefined) json.channel = this.channel;
    if (this.isPercussion) json.isPercussion = true;
    return json;
  }

  public static fromJSON(json: InstrumentTrackJSON): InstrumentTrack {
    return new InstrumentTrack(json);
  }
}
