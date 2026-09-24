/**
 * @file measure.ts
 * @description Modela el compás musical (Measure), agrupando métrica, armadura,
 * voces polifónicas, eventos de acordes, sílabas de texto y directivas de repetición.
 */

import { ChordEvent, type ChordEventJSON } from './chord-event.ts';
import {
  KeySignatureReference,
  type KeySignatureReferenceJSON,
} from './key-signature-reference.ts';
import { LyricSyllable, type LyricSyllableJSON } from './lyric-syllable.ts';
import { Note, Rest, Voice, type VoiceJSON } from './musical-event.ts';
import { TimeSignature, type TimeSignatureJSON } from './time-signature.ts';

export interface MeasureJSON {
  number: number;
  timeSignature: TimeSignatureJSON;
  keySignature: KeySignatureReferenceJSON;
  startTick: number;
  durationTicks: number;
  voices: VoiceJSON[];
  chords: ChordEventJSON[];
  lyrics: LyricSyllableJSON[];
  repeatStart?: boolean;
  repeatEnd?: boolean;
  repeatCount?: number;
  endingNumber?: number;
}

export class Measure {
  public readonly number: number;
  public readonly timeSignature: TimeSignature;
  public readonly keySignature: KeySignatureReference;
  public readonly startTick: number;
  public readonly durationTicks: number;
  public readonly voices: readonly Voice[];
  public readonly chords: readonly ChordEvent[];
  public readonly lyrics: readonly LyricSyllable[];
  public readonly repeatStart?: boolean;
  public readonly repeatEnd?: boolean;
  public readonly repeatCount?: number;
  public readonly endingNumber?: number;

  public constructor(init: {
    number: number;
    timeSignature: TimeSignature;
    keySignature: KeySignatureReference;
    startTick: number;
    durationTicks?: number;
    voices?: Voice[];
    chords?: ChordEvent[];
    lyrics?: LyricSyllable[];
    repeatStart?: boolean;
    repeatEnd?: boolean;
    repeatCount?: number;
    endingNumber?: number;
  }) {
    if (!Number.isInteger(init.number) || init.number <= 0) {
      throw new Error(`Número de compás inválido: ${init.number}. Debe ser >= 1.`);
    }
    if (!init.timeSignature || !(init.timeSignature instanceof TimeSignature)) {
      throw new Error(`TimeSignature inválido en compás ${init.number}`);
    }
    if (!init.keySignature || !(init.keySignature instanceof KeySignatureReference)) {
      throw new Error(`KeySignatureReference inválido en compás ${init.number}`);
    }
    if (!Number.isInteger(init.startTick) || init.startTick < 0) {
      throw new Error(`startTick inválido en compás ${init.number}: ${init.startTick}`);
    }

    const calculatedDuration = init.timeSignature.calculateMeasureDurationTicks();
    const duration = init.durationTicks ?? calculatedDuration;
    if (!Number.isInteger(duration) || duration <= 0) {
      throw new Error(`Duración en ticks inválida en compás ${init.number}: ${duration}`);
    }

    this.number = init.number;
    this.timeSignature = init.timeSignature;
    this.keySignature = init.keySignature;
    this.startTick = init.startTick;
    this.durationTicks = duration;
    this.voices = Object.freeze([...(init.voices ?? [])]);
    this.chords = Object.freeze([...(init.chords ?? [])]);
    this.lyrics = Object.freeze([...(init.lyrics ?? [])]);

    if (init.repeatStart) this.repeatStart = true;
    if (init.repeatEnd) this.repeatEnd = true;
    if (init.repeatCount !== undefined) this.repeatCount = init.repeatCount;
    if (init.endingNumber !== undefined) this.endingNumber = init.endingNumber;
  }

  public get endTick(): number {
    return this.startTick + this.durationTicks;
  }

  public containsTick(tick: number): boolean {
    return tick >= this.startTick && tick < this.endTick;
  }

  public getVoice(voiceId: number): Voice | undefined {
    return this.voices.find((v) => v.id === voiceId);
  }

  public getAllNotes(): Note[] {
    return this.voices.flatMap((v) => v.getNotes());
  }

  public getAllRests(): Rest[] {
    return this.voices.flatMap((v) => v.getRests());
  }

  public toJSON(): MeasureJSON {
    const json: MeasureJSON = {
      number: this.number,
      timeSignature: this.timeSignature.toJSON(),
      keySignature: this.keySignature.toJSON(),
      startTick: this.startTick,
      durationTicks: this.durationTicks,
      voices: this.voices.map((v) => v.toJSON()),
      chords: this.chords.map((c) => c.toJSON()),
      lyrics: this.lyrics.map((l) => l.toJSON()),
    };
    if (this.repeatStart) json.repeatStart = this.repeatStart;
    if (this.repeatEnd) json.repeatEnd = this.repeatEnd;
    if (this.repeatCount !== undefined) json.repeatCount = this.repeatCount;
    if (this.endingNumber !== undefined) json.endingNumber = this.endingNumber;
    return json;
  }

  public static fromJSON(json: MeasureJSON): Measure {
    const timeSignature = TimeSignature.fromJSON(json.timeSignature);
    const keySignature = KeySignatureReference.fromJSON(json.keySignature);
    const voices = (json.voices || []).map((v) => Voice.fromJSON(v));
    const chords = (json.chords || []).map((c) => ChordEvent.fromJSON(c));
    const lyrics = (json.lyrics || []).map((l) => LyricSyllable.fromJSON(l));

    const init: {
      number: number;
      timeSignature: TimeSignature;
      keySignature: KeySignatureReference;
      startTick: number;
      durationTicks: number;
      voices: Voice[];
      chords: ChordEvent[];
      lyrics: LyricSyllable[];
      repeatStart?: boolean;
      repeatEnd?: boolean;
      repeatCount?: number;
      endingNumber?: number;
    } = {
      number: json.number,
      timeSignature,
      keySignature,
      startTick: json.startTick,
      durationTicks: json.durationTicks,
      voices,
      chords,
      lyrics,
    };
    if (json.repeatStart !== undefined) init.repeatStart = json.repeatStart;
    if (json.repeatEnd !== undefined) init.repeatEnd = json.repeatEnd;
    if (json.repeatCount !== undefined) init.repeatCount = json.repeatCount;
    if (json.endingNumber !== undefined) init.endingNumber = json.endingNumber;

    return new Measure(init);
  }
}
