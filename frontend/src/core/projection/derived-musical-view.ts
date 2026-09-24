/**
 * @file derived-musical-view.ts
 * @description Modelo de vista musical derivada (DerivedMusicalView).
 * Representa la proyección pura y determinista de la verdad musical canónica
 * adaptada al instrumento, clave de transposición, cejilla y preferencias del músico.
 * NO muta jamás el CanonicalMusicPayload original.
 */

import { type Chord } from '../music-theory/chord.ts';
import { type MusicalKey } from '../music-theory/musical-key.ts';
import { type Pitch } from '../music-theory/pitch.ts';
import { type KeySignatureReference } from '../canonical-model/key-signature-reference.ts';
import { type Section } from '../canonical-model/section.ts';
import { type TimeSignature } from '../canonical-model/time-signature.ts';
import { type Timeline } from '../canonical-model/timeline.ts';
import {
  type ArticulationType,
  type ClefType,
  type StemDirection,
  type TieType,
} from '../canonical-model/types.ts';
import { type InstrumentProfile } from './instrument-profile.ts';
import { type TabPosition, type ViewRepresentation } from './types.ts';
import { type ViewPreference } from './view-preference.ts';

export interface DerivedNoteInit {
  id: string;
  canonicalPitch: Pitch;
  writtenPitch: Pitch;
  startTick: number;
  durationTicks: number;
  voice?: number | undefined;
  staff?: number | undefined;
  velocity?: number | undefined;
  tie?: TieType | undefined;
  articulations?: readonly ArticulationType[] | undefined;
  stemDirection?: StemDirection | undefined;
}

export class DerivedNote {
  public readonly isRest: false = false;
  public readonly id: string;
  public readonly canonicalPitch: Pitch;
  public readonly writtenPitch: Pitch;
  public readonly startTick: number;
  public readonly durationTicks: number;
  public readonly voice: number;
  public readonly staff: number;
  public readonly velocity: number;
  public readonly tie: TieType;
  public readonly articulations: readonly ArticulationType[];
  public readonly stemDirection: StemDirection;

  public constructor(init: DerivedNoteInit) {
    this.id = init.id;
    this.canonicalPitch = init.canonicalPitch;
    this.writtenPitch = init.writtenPitch;
    this.startTick = init.startTick;
    this.durationTicks = init.durationTicks;
    this.voice = init.voice ?? 1;
    this.staff = init.staff ?? 1;
    this.velocity = init.velocity ?? 64;
    this.tie = init.tie ?? 'NONE';
    this.articulations = Object.freeze([...(init.articulations ?? [])]);
    this.stemDirection = init.stemDirection ?? 'AUTO';
  }
}

export interface DerivedChordInit {
  id: string;
  canonicalChord: Chord;
  writtenChord: Chord;
  fingeringChord: Chord;
  displayString: string;
  soundingDisplayString: string;
  startTick: number;
  durationTicks?: number | undefined;
  measureNumber: number;
  voice?: number | undefined;
  beat?: number | undefined;
}

export class DerivedChord {
  public readonly id: string;
  public readonly canonicalChord: Chord;
  public readonly writtenChord: Chord;
  public readonly fingeringChord: Chord;
  public readonly displayString: string;
  public readonly soundingDisplayString: string;
  public readonly startTick: number;
  public readonly durationTicks?: number | undefined;
  public readonly measureNumber: number;
  public readonly voice?: number | undefined;
  public readonly beat: number;

  public constructor(init: DerivedChordInit) {
    this.id = init.id;
    this.canonicalChord = init.canonicalChord;
    this.writtenChord = init.writtenChord;
    this.fingeringChord = init.fingeringChord;
    this.displayString = init.displayString;
    this.soundingDisplayString = init.soundingDisplayString;
    this.startTick = init.startTick;
    if (init.durationTicks !== undefined) this.durationTicks = init.durationTicks;
    this.measureNumber = init.measureNumber;
    if (init.voice !== undefined) this.voice = init.voice;
    this.beat = init.beat ?? 1;
  }
}

export interface DerivedLyricInit {
  id: string;
  text: string;
  measureNumber: number;
  tickOffset: number;
  sequenceNumber: number;
  isHyphenated?: boolean | undefined;
  boundNoteId?: string | null | undefined;
  chordAbove?: Chord | null | undefined;
}

export class DerivedLyric {
  public readonly id: string;
  public readonly text: string;
  public readonly measureNumber: number;
  public readonly tickOffset: number;
  public readonly sequenceNumber: number;
  public readonly isHyphenated: boolean;
  public readonly boundNoteId: string | null;
  public readonly chordAbove: Chord | null;

  public constructor(init: DerivedLyricInit) {
    this.id = init.id;
    this.text = init.text;
    this.measureNumber = init.measureNumber;
    this.tickOffset = init.tickOffset;
    this.sequenceNumber = init.sequenceNumber;
    this.isHyphenated = init.isHyphenated ?? false;
    this.boundNoteId = init.boundNoteId ?? null;
    this.chordAbove = init.chordAbove ?? null;
  }
}

export interface DerivedMeasureInit {
  measureNumber: number;
  timeSignature: TimeSignature;
  concertKeySignature: KeySignatureReference;
  writtenKeySignature: KeySignatureReference;
  startTick: number;
  durationTicks: number;
  notes?: DerivedNote[] | undefined;
  chords?: DerivedChord[] | undefined;
  lyrics?: DerivedLyric[] | undefined;
  tablature?: TabPosition[] | undefined;
  clefs?: ClefType[] | undefined;
  repeatStart?: boolean | undefined;
  repeatEnd?: boolean | undefined;
  repeatCount?: number | undefined;
  endingNumber?: number | undefined;
}

export class DerivedMeasure {
  public readonly measureNumber: number;
  public readonly timeSignature: TimeSignature;
  public readonly concertKeySignature: KeySignatureReference;
  public readonly writtenKeySignature: KeySignatureReference;
  public readonly startTick: number;
  public readonly durationTicks: number;
  public readonly notes: readonly DerivedNote[];
  public readonly chords: readonly DerivedChord[];
  public readonly lyrics: readonly DerivedLyric[];
  public readonly tablature: readonly TabPosition[];
  public readonly clefs: readonly ClefType[];
  public readonly repeatStart?: boolean | undefined;
  public readonly repeatEnd?: boolean | undefined;
  public readonly repeatCount?: number | undefined;
  public readonly endingNumber?: number | undefined;

  public constructor(init: DerivedMeasureInit) {
    this.measureNumber = init.measureNumber;
    this.timeSignature = init.timeSignature;
    this.concertKeySignature = init.concertKeySignature;
    this.writtenKeySignature = init.writtenKeySignature;
    this.startTick = init.startTick;
    this.durationTicks = init.durationTicks;
    this.notes = Object.freeze([...(init.notes ?? [])]);
    this.chords = Object.freeze([...(init.chords ?? [])]);
    this.lyrics = Object.freeze([...(init.lyrics ?? [])]);
    this.tablature = Object.freeze([...(init.tablature ?? [])]);
    this.clefs = Object.freeze([...(init.clefs ?? ['TREBLE'])]);

    if (init.repeatStart) this.repeatStart = true;
    if (init.repeatEnd) this.repeatEnd = true;
    if (init.repeatCount !== undefined) this.repeatCount = init.repeatCount;
    if (init.endingNumber !== undefined) this.endingNumber = init.endingNumber;
  }
}

export interface DerivedMusicalViewInit {
  songTitle: string;
  instrumentProfile: InstrumentProfile;
  viewPreference: ViewPreference;
  activeRepresentations: readonly ViewRepresentation[];
  concertKey: MusicalKey;
  writtenKey: MusicalKey;
  capoFret: number;
  measures: DerivedMeasure[];
  timeline: Timeline;
  sections?: readonly Section[] | undefined;
}

export class DerivedMusicalView {
  public readonly songTitle: string;
  public readonly instrumentProfile: InstrumentProfile;
  public readonly viewPreference: ViewPreference;
  public readonly activeRepresentations: readonly ViewRepresentation[];
  public readonly concertKey: MusicalKey;
  public readonly writtenKey: MusicalKey;
  public readonly capoFret: number;
  public readonly measures: readonly DerivedMeasure[];
  public readonly timeline: Timeline;
  public readonly sections: readonly Section[];

  public constructor(init: DerivedMusicalViewInit) {
    this.songTitle = init.songTitle;
    this.instrumentProfile = init.instrumentProfile;
    this.viewPreference = init.viewPreference;
    this.activeRepresentations = Object.freeze([...init.activeRepresentations]);
    this.concertKey = init.concertKey;
    this.writtenKey = init.writtenKey;
    this.capoFret = init.capoFret;
    this.measures = Object.freeze([...init.measures]);
    this.timeline = init.timeline;
    this.sections = Object.freeze([...(init.sections ?? [])]);
  }

  public getAllNotes(): DerivedNote[] {
    return this.measures.flatMap((m) => [...m.notes]);
  }

  public getAllChords(): DerivedChord[] {
    return this.measures.flatMap((m) => [...m.chords]);
  }

  public getAllLyrics(): DerivedLyric[] {
    return this.measures.flatMap((m) => [...m.lyrics]);
  }

  public getAllTabPositions(): TabPosition[] {
    return this.measures.flatMap((m) => [...m.tablature]);
  }
}
