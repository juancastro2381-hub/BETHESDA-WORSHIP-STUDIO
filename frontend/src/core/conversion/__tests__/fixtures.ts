/**
 * @file fixtures.ts
 * @description Fixtures canónicos para pruebas del subsistema de conversión (Fase 2A).
 */

import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { KeySignatureReference } from '../../canonical-model/key-signature-reference.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Note, Rest, Voice } from '../../canonical-model/musical-event.ts';
import { Section } from '../../canonical-model/section.ts';
import { TempoEvent, TempoMap } from '../../canonical-model/tempo-map.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import { CANONICAL_TPQN, DURATION_TICKS } from '../../canonical-model/types.ts';
import { Chord } from '../../music-theory/chord.ts';
import { KeySignature } from '../../music-theory/key-signature.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';

/**
 * 1. Obra completa: Título, Artista, Tempo 120, Tonalidad G Mayor, 4/4, notas, acordes y letra.
 */
export function createFullSongFixture(): CanonicalMusicPayload {
  const gMajorRef = new KeySignatureReference(
    NoteName.G,
    'MAJOR',
    new KeySignature(1) // 1 sostenido: F#
  );

  const tempoMap = new TempoMap([new TempoEvent(0, 120)]);
  const timeline = new Timeline({
    totalDurationTicks: 3840,
    measureCount: 2,
    tempoMap,
  });

  // Compás 1: Verso - "Sublime gracia"
  // Notas: G4 (negra), B4 (negra), D5 (blanca)
  const note1 = new Note({
    id: 'n_m1_1',
    pitch: new Pitch(NoteName.G, 4),
    startTick: 0,
    durationTicks: DURATION_TICKS.QUARTER,
    voice: 1,
    velocity: 80,
  });

  const note2 = new Note({
    id: 'n_m1_2',
    pitch: new Pitch(NoteName.B, 4),
    startTick: DURATION_TICKS.QUARTER,
    durationTicks: DURATION_TICKS.QUARTER,
    voice: 1,
    velocity: 85,
  });

  const note3 = new Note({
    id: 'n_m1_3',
    pitch: new Pitch(NoteName.D, 5),
    startTick: DURATION_TICKS.HALF,
    durationTicks: DURATION_TICKS.HALF,
    voice: 1,
    velocity: 90,
  });

  const chordG = new ChordEvent({
    id: 'ch_m1_1',
    chord: Chord.parse('G'),
    startTick: 0,
    durationTicks: DURATION_TICKS.HALF,
    measureNumber: 1,
  });

  const chordD = new ChordEvent({
    id: 'ch_m1_2',
    chord: Chord.parse('D'),
    startTick: DURATION_TICKS.HALF,
    durationTicks: DURATION_TICKS.HALF,
    measureNumber: 1,
  });

  const syl1 = new LyricSyllable({
    id: 'ly_1',
    text: 'Sub',
    isHyphenated: true,
    boundNoteId: 'n_m1_1',
    measureNumber: 1,
    tickOffset: 0,
    sequenceNumber: 1,
    chordAbove: Chord.parse('G'),
  });

  const syl2 = new LyricSyllable({
    id: 'ly_2',
    text: 'li',
    isHyphenated: true,
    boundNoteId: 'n_m1_2',
    measureNumber: 1,
    tickOffset: DURATION_TICKS.QUARTER,
    sequenceNumber: 2,
  });

  const syl3 = new LyricSyllable({
    id: 'ly_3',
    text: 'me',
    isHyphenated: false,
    boundNoteId: 'n_m1_3',
    measureNumber: 1,
    tickOffset: DURATION_TICKS.HALF,
    sequenceNumber: 3,
    chordAbove: Chord.parse('D'),
  });

  const measure1 = new Measure({
    number: 1,
    timeSignature: TimeSignature.FOUR_FOUR,
    keySignature: gMajorRef,
    startTick: 0,
    durationTicks: 1920,
    voices: [new Voice(1, [note1, note2, note3])],
    chords: [chordG, chordD],
    lyrics: [syl1, syl2, syl3],
  });

  // Compás 2: "del Señor"
  const note4 = new Note({
    id: 'n_m2_1',
    pitch: new Pitch(NoteName.E, 4),
    startTick: 0,
    durationTicks: DURATION_TICKS.HALF,
    voice: 1,
    velocity: 80,
  });

  const rest1 = new Rest({
    id: 'r_m2_1',
    startTick: DURATION_TICKS.HALF,
    durationTicks: DURATION_TICKS.HALF,
    voice: 1,
    staff: 1,
  });

  const chordEm = new ChordEvent({
    id: 'ch_m2_1',
    chord: Chord.parse('Em'),
    startTick: 0,
    durationTicks: DURATION_TICKS.WHOLE,
    measureNumber: 2,
  });

  const syl4 = new LyricSyllable({
    id: 'ly_4',
    text: 'del',
    isHyphenated: false,
    boundNoteId: 'n_m2_1',
    measureNumber: 2,
    tickOffset: 0,
    sequenceNumber: 4,
    chordAbove: Chord.parse('Em'),
  });

  const syl5 = new LyricSyllable({
    id: 'ly_5',
    text: 'Señor',
    isHyphenated: false,
    boundNoteId: null,
    measureNumber: 2,
    tickOffset: DURATION_TICKS.QUARTER,
    sequenceNumber: 5,
  });

  const measure2 = new Measure({
    number: 2,
    timeSignature: TimeSignature.FOUR_FOUR,
    keySignature: gMajorRef,
    startTick: 1920,
    durationTicks: 1920,
    voices: [new Voice(1, [note4, rest1])],
    chords: [chordEm],
    lyrics: [syl4, syl5],
  });

  const sectionVerse = new Section({
    id: 'sec_1',
    type: 'VERSE',
    label: 'Verso 1',
    startMeasure: 1,
    measureCount: 2,
    startTick: 0,
    durationTicks: 3840,
  });

  return new CanonicalMusicPayload({
    title: 'Sublime Gracia',
    timeline,
    sections: [sectionVerse],
    measures: [measure1, measure2],
    metadata: {
      artist: 'John Newton',
      bpm: 120,
    },
  });
}

/**
 * 2. Obra sólo de acordes y letra (sin notas melódicas, típica de ChordPro).
 */
export function createChordsAndLyricsOnlyFixture(): CanonicalMusicPayload {
  const timeline = new Timeline({
    totalDurationTicks: null,
    measureCount: 1,
    tempoMap: new TempoMap([]),
    isUnmetered: true,
  });

  const chordC = new ChordEvent({
    id: 'ch_1',
    chord: Chord.parse('C'),
    startTick: 0,
    durationTicks: 1920,
    measureNumber: 1,
  });

  const syl1 = new LyricSyllable({
    id: 'ly_1',
    text: 'Aleluya',
    isHyphenated: false,
    boundNoteId: null,
    measureNumber: 1,
    tickOffset: 0,
    sequenceNumber: 1,
    chordAbove: Chord.parse('C'),
  });

  const measure1 = new Measure({
    number: 1,
    timeSignature: null,
    keySignature: null,
    startTick: null,
    durationTicks: null,
    voices: [],
    chords: [chordC],
    lyrics: [syl1],
  });

  const sectionChorus = new Section({
    id: 'sec_1',
    type: 'CHORUS',
    label: 'Coro',
    startMeasure: 1,
    measureCount: 1,
    startTick: null,
    durationTicks: null,
  });

  return new CanonicalMusicPayload({
    title: 'Canto de Adoración',
    timeline,
    sections: [sectionChorus],
    measures: [measure1],
  });
}

/**
 * 3. Obra instrumental (solo notas melódicas, sin acordes ni letra).
 */
export function createInstrumentalFixture(): CanonicalMusicPayload {
  const timeline = new Timeline({
    totalDurationTicks: 1920,
    measureCount: 1,
    tempoMap: new TempoMap([new TempoEvent(0, 100)]),
  });

  const noteA = new Note({
    id: 'n_1',
    pitch: new Pitch(NoteName.A, 4),
    startTick: 0,
    durationTicks: DURATION_TICKS.HALF,
    voice: 1,
  });

  const noteC = new Note({
    id: 'n_2',
    pitch: new Pitch(NoteName.C, 5),
    startTick: DURATION_TICKS.HALF,
    durationTicks: DURATION_TICKS.HALF,
    voice: 1,
  });

  const measure1 = new Measure({
    number: 1,
    timeSignature: TimeSignature.FOUR_FOUR,
    keySignature: null,
    startTick: 0,
    durationTicks: 1920,
    voices: [new Voice(1, [noteA, noteC])],
    chords: [],
    lyrics: [],
  });

  return new CanonicalMusicPayload({
    title: 'Preludio Instrumental',
    timeline,
    sections: [],
    measures: [measure1],
  });
}
