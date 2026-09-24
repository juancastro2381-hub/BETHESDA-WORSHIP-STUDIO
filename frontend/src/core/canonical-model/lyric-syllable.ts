/**
 * @file lyric-syllable.ts
 * @description Modela sílabas líricas estructuradas (LyricSyllable), garantizando
 * que el contenido de la letra resida única y exclusivamente dentro del CanonicalMusicPayload.
 */

import { Chord } from '../music-theory/chord.ts';
import { NoteName } from '../music-theory/note-name.ts';
import { type ChordStructuredJSON } from './chord-event.ts';

export interface LyricSyllableJSON {
  id: string;
  text: string;
  isHyphenated: boolean;
  boundNoteId: string | null;
  measureNumber: number;
  tickOffset: number;
  sequenceNumber: number;
  chordAbove: ChordStructuredJSON | null;
}

export class LyricSyllable {
  public readonly id: string;
  public readonly text: string;
  public readonly isHyphenated: boolean;
  public readonly boundNoteId: string | null;
  public readonly measureNumber: number;
  public readonly tickOffset: number;
  public readonly sequenceNumber: number;
  public readonly chordAbove: Chord | null;

  public constructor(init: {
    id: string;
    text: string;
    isHyphenated?: boolean;
    boundNoteId?: string | null;
    measureNumber: number;
    tickOffset: number;
    sequenceNumber: number;
    chordAbove?: Chord | null;
  }) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error(`ID de sílaba lírica requerido e inválido: ${init.id}`);
    }
    if (typeof init.text !== 'string') {
      throw new Error(`Texto de sílaba lírica inválido en sílaba ${init.id}`);
    }
    if (!Number.isInteger(init.measureNumber) || init.measureNumber <= 0) {
      throw new Error(`Número de compás inválido en sílaba ${init.id}: ${init.measureNumber}`);
    }
    if (!Number.isInteger(init.tickOffset) || init.tickOffset < 0) {
      throw new Error(`Offset de tick inválido en sílaba ${init.id}: ${init.tickOffset}`);
    }
    if (!Number.isInteger(init.sequenceNumber) || init.sequenceNumber < 0) {
      throw new Error(`Número de secuencia inválido en sílaba ${init.id}: ${init.sequenceNumber}`);
    }

    this.id = init.id;
    this.text = init.text;
    this.isHyphenated = init.isHyphenated ?? false;
    this.boundNoteId = init.boundNoteId ?? null;
    this.measureNumber = init.measureNumber;
    this.tickOffset = init.tickOffset;
    this.sequenceNumber = init.sequenceNumber;
    this.chordAbove = init.chordAbove ?? null;
  }

  public toJSON(): LyricSyllableJSON {
    return {
      id: this.id,
      text: this.text,
      isHyphenated: this.isHyphenated,
      boundNoteId: this.boundNoteId,
      measureNumber: this.measureNumber,
      tickOffset: this.tickOffset,
      sequenceNumber: this.sequenceNumber,
      chordAbove: this.chordAbove
        ? {
            root: this.chordAbove.root.toString(),
            quality: this.chordAbove.quality,
            extensions: [...this.chordAbove.extensions],
            alterations: [...this.chordAbove.alterations],
            addedTones: [...this.chordAbove.addedTones],
            suspended: this.chordAbove.suspended,
            bass: this.chordAbove.bass ? this.chordAbove.bass.toString() : null,
            symbol: this.chordAbove.toString('STANDARD'),
          }
        : null,
    };
  }

  public static fromJSON(json: LyricSyllableJSON): LyricSyllable {
    let chordAbove: Chord | null = null;
    if (json.chordAbove) {
      const root = NoteName.parse(json.chordAbove.root);
      const bass = json.chordAbove.bass ? NoteName.parse(json.chordAbove.bass) : null;
      chordAbove = new Chord({
        root,
        quality: json.chordAbove.quality,
        extensions: json.chordAbove.extensions,
        alterations: json.chordAbove.alterations,
        addedTones: json.chordAbove.addedTones,
        suspended: json.chordAbove.suspended,
        bass,
      });
    }

    return new LyricSyllable({
      id: json.id,
      text: json.text,
      isHyphenated: json.isHyphenated,
      boundNoteId: json.boundNoteId,
      measureNumber: json.measureNumber,
      tickOffset: json.tickOffset,
      sequenceNumber: json.sequenceNumber,
      chordAbove,
    });
  }
}
