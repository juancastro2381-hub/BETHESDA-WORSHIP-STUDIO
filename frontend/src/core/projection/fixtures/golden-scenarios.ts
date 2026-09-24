/**
 * @file golden-scenarios.ts
 * @description Escenarios de proyección de referencia ("Golden Projection Scenarios")
 * para validar formalmente las transformaciones de la Fase 1D.
 *
 * Escenarios canónicos:
 * - Escenario A: Canción en Sol Mayor -> Guitarra con Capo 2 (Cifrado + Tablatura).
 * - Escenario B: Canción en Sol Mayor -> Piano (Grand Staff + Cifrado).
 * - Escenario C: Canción en Sol Mayor -> Saxofón Alto (Notación escrita en Eb).
 * - Escenario D: Canción en Sol Mayor -> Voz Principal (Letra + Cifrado, sin inventar notas).
 */

import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { InstrumentTrack } from '../../canonical-model/instrument-track.ts';
import { KeySignatureReference } from '../../canonical-model/key-signature-reference.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Note, Voice } from '../../canonical-model/musical-event.ts';
import { Section } from '../../canonical-model/section.ts';
import { TempoMap } from '../../canonical-model/tempo-map.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { Chord } from '../../music-theory/chord.ts';
import { MusicalKey } from '../../music-theory/musical-key.ts';
import { Pitch } from '../../music-theory/pitch.ts';

/**
 * Genera una canción canónica completa en Sol Mayor con melodía, acordes y letra.
 */
export function createCanonicalSongGMajorWithNotes(): CanonicalMusicPayload {
  const timeSig = TimeSignature.FOUR_FOUR;
  const keySigG = KeySignatureReference.fromMusicalKey(MusicalKey.G_MAJOR); // 1 sostenido (F#)
  const timeline = new Timeline({
    totalDurationTicks: 3840,
    measureCount: 2,
    tempoMap: TempoMap.constant(120),
  });

  const section = new Section({
    id: 'sec-verse',
    type: 'VERSE',
    label: 'Verso 1',
    startMeasure: 1,
    measureCount: 2,
    startTick: 0,
    durationTicks: 3840,
  });

  const trackMelody = new InstrumentTrack({
    id: 'trk-lead',
    name: 'Melodía Principal',
    family: 'GUITAR',
    voiceIds: [1],
  });

  // Compás 1: G (tick 0) y Em (tick 960)
  // Notas: G4 (480 ticks), B4 (480 ticks), E4 (960 ticks)
  const noteG4 = new Note({
    id: 'note-1',
    pitch: Pitch.parse('G4'),
    startTick: 0,
    durationTicks: 480,
    voice: 1,
  });
  const noteB4 = new Note({
    id: 'note-2',
    pitch: Pitch.parse('B4'),
    startTick: 480,
    durationTicks: 480,
    voice: 1,
  });
  const noteE4 = new Note({
    id: 'note-3',
    pitch: Pitch.parse('E4'),
    startTick: 960,
    durationTicks: 960,
    voice: 1,
  });

  const chordG = new ChordEvent({
    id: 'ch-1',
    chord: Chord.parse('G'),
    startTick: 0,
    durationTicks: 960,
    measureNumber: 1,
  });
  const chordEm = new ChordEvent({
    id: 'ch-2',
    chord: Chord.parse('Em'),
    startTick: 960,
    durationTicks: 960,
    measureNumber: 1,
  });

  const lyricSub = new LyricSyllable({
    id: 'lyr-1',
    text: 'Sub',
    measureNumber: 1,
    tickOffset: 0,
    sequenceNumber: 1,
    isHyphenated: true,
    boundNoteId: 'note-1',
  });
  const lyricLi = new LyricSyllable({
    id: 'lyr-2',
    text: 'li',
    measureNumber: 1,
    tickOffset: 480,
    sequenceNumber: 2,
    isHyphenated: true,
    boundNoteId: 'note-2',
  });
  const lyricMe = new LyricSyllable({
    id: 'lyr-3',
    text: 'me',
    measureNumber: 1,
    tickOffset: 960,
    sequenceNumber: 3,
    isHyphenated: false,
    boundNoteId: 'note-3',
  });

  const measure1 = new Measure({
    number: 1,
    timeSignature: timeSig,
    keySignature: keySigG,
    startTick: 0,
    durationTicks: 1920,
    voices: [new Voice(1, [noteG4, noteB4, noteE4])],
    chords: [chordG, chordEm],
    lyrics: [lyricSub, lyricLi, lyricMe],
  });

  // Compás 2: C (tick 1920) y D (tick 2880)
  // Notas: C4 (960 ticks), D4 (960 ticks)
  const noteC4 = new Note({
    id: 'note-4',
    pitch: Pitch.parse('C4'),
    startTick: 1920,
    durationTicks: 960,
    voice: 1,
  });
  const noteD4 = new Note({
    id: 'note-5',
    pitch: Pitch.parse('D4'),
    startTick: 2880,
    durationTicks: 960,
    voice: 1,
  });

  const chordC = new ChordEvent({
    id: 'ch-3',
    chord: Chord.parse('C'),
    startTick: 1920,
    durationTicks: 960,
    measureNumber: 2,
  });
  const chordD = new ChordEvent({
    id: 'ch-4',
    chord: Chord.parse('D'),
    startTick: 2880,
    durationTicks: 960,
    measureNumber: 2,
  });

  const lyricGra = new LyricSyllable({
    id: 'lyr-4',
    text: 'gra',
    measureNumber: 2,
    tickOffset: 0,
    sequenceNumber: 4,
    isHyphenated: true,
    boundNoteId: 'note-4',
  });
  const lyricCia = new LyricSyllable({
    id: 'lyr-5',
    text: 'cia',
    measureNumber: 2,
    tickOffset: 960,
    sequenceNumber: 5,
    isHyphenated: false,
    boundNoteId: 'note-5',
  });

  const measure2 = new Measure({
    number: 2,
    timeSignature: timeSig,
    keySignature: keySigG,
    startTick: 1920,
    durationTicks: 1920,
    voices: [new Voice(1, [noteC4, noteD4])],
    chords: [chordC, chordD],
    lyrics: [lyricGra, lyricCia],
  });

  return new CanonicalMusicPayload({
    title: 'Sublime Gracia (Golden G Major)',
    timeline,
    sections: [section],
    measures: [measure1, measure2],
    instrumentTracks: [trackMelody],
  });
}

/**
 * Genera una canción canónica en Sol Mayor tipo LeadSheet/ChordPro (solo acordes y letras, sin notas de melodía).
 */
export function createCanonicalSongGMajorChordsAndLyricsOnly(): CanonicalMusicPayload {
  const timeSig = TimeSignature.FOUR_FOUR;
  const keySigG = KeySignatureReference.fromMusicalKey(MusicalKey.G_MAJOR);
  const timeline = new Timeline({
    totalDurationTicks: 3840,
    measureCount: 2,
    tempoMap: TempoMap.constant(120),
  });

  const section = new Section({
    id: 'sec-verse',
    type: 'VERSE',
    label: 'Verso 1',
    startMeasure: 1,
    measureCount: 2,
    startTick: 0,
    durationTicks: 3840,
  });

  const chordG = new ChordEvent({
    id: 'ch-1',
    chord: Chord.parse('G'),
    startTick: 0,
    durationTicks: 960,
    measureNumber: 1,
  });
  const chordEm = new ChordEvent({
    id: 'ch-2',
    chord: Chord.parse('Em'),
    startTick: 960,
    durationTicks: 960,
    measureNumber: 1,
  });

  const lyricSub = new LyricSyllable({
    id: 'lyr-1',
    text: 'Sub',
    measureNumber: 1,
    tickOffset: 0,
    sequenceNumber: 1,
    isHyphenated: true,
    boundNoteId: null,
  });
  const lyricLi = new LyricSyllable({
    id: 'lyr-2',
    text: 'li',
    measureNumber: 1,
    tickOffset: 480,
    sequenceNumber: 2,
    isHyphenated: true,
    boundNoteId: null,
  });
  const lyricMe = new LyricSyllable({
    id: 'lyr-3',
    text: 'me',
    measureNumber: 1,
    tickOffset: 960,
    sequenceNumber: 3,
    isHyphenated: false,
    boundNoteId: null,
  });

  const measure1 = new Measure({
    number: 1,
    timeSignature: timeSig,
    keySignature: keySigG,
    startTick: 0,
    durationTicks: 1920,
    voices: [], // CERO notas inventadas
    chords: [chordG, chordEm],
    lyrics: [lyricSub, lyricLi, lyricMe],
  });

  const chordC = new ChordEvent({
    id: 'ch-3',
    chord: Chord.parse('C'),
    startTick: 1920,
    durationTicks: 960,
    measureNumber: 2,
  });
  const chordD = new ChordEvent({
    id: 'ch-4',
    chord: Chord.parse('D'),
    startTick: 2880,
    durationTicks: 960,
    measureNumber: 2,
  });

  const lyricGra = new LyricSyllable({
    id: 'lyr-4',
    text: 'gra',
    measureNumber: 2,
    tickOffset: 0,
    sequenceNumber: 4,
    isHyphenated: true,
    boundNoteId: null,
  });
  const lyricCia = new LyricSyllable({
    id: 'lyr-5',
    text: 'cia',
    measureNumber: 2,
    tickOffset: 960,
    sequenceNumber: 5,
    isHyphenated: false,
    boundNoteId: null,
  });

  const measure2 = new Measure({
    number: 2,
    timeSignature: timeSig,
    keySignature: keySigG,
    startTick: 1920,
    durationTicks: 1920,
    voices: [], // CERO notas inventadas
    chords: [chordC, chordD],
    lyrics: [lyricGra, lyricCia],
  });

  return new CanonicalMusicPayload({
    title: 'Sublime Gracia (ChordPro G Major)',
    timeline,
    sections: [section],
    measures: [measure1, measure2],
    instrumentTracks: [],
  });
}
