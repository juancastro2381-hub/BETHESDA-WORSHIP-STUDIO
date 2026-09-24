/**
 * @file reference-song.ts
 * @description Fixture canónico de referencia realista para Bethesda Worship Studio.
 * Canción en Sol Mayor (G), 4/4, 74 BPM, con estructura litúrgica completa:
 * INTRO → VERSE 1 → CHORUS → VERSE 2 → CHORUS → BRIDGE → CHORUS → OUTRO.
 */

import { Chord } from '../../music-theory/chord.ts';
import { KeySignature } from '../../music-theory/key-signature.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { CanonicalMusicPayload } from '../canonical-music-payload.ts';
import { ChordEvent } from '../chord-event.ts';
import { InstrumentTrack } from '../instrument-track.ts';
import { KeySignatureReference } from '../key-signature-reference.ts';
import { LyricSyllable } from '../lyric-syllable.ts';
import { Measure } from '../measure.ts';
import { Note, Rest, Voice } from '../musical-event.ts';
import { Section } from '../section.ts';
import { TempoEvent, TempoMap } from '../tempo-map.ts';
import { Timeline } from '../timeline.ts';
import { TimeSignature } from '../time-signature.ts';
import { CANONICAL_TPQN, DURATION_TICKS } from '../types.ts';

export function createReferenceSongFixture(): CanonicalMusicPayload {
  const timeSignature = TimeSignature.FOUR_FOUR;
  const measureDuration = timeSignature.calculateMeasureDurationTicks(); // 1920
  const gMajorKeySig = new KeySignatureReference(
    NoteName.G,
    'MAJOR',
    new KeySignature(1) // 1 sostenido: Fa#
  );

  const tempoMap = new TempoMap([new TempoEvent(0, 74)]); // 74 BPM

  // Acordes canónicos reutilizados
  const chordG = Chord.parse('G');
  const chordC = Chord.parse('C');
  const chordEm = Chord.parse('Em');
  const chordD = Chord.parse('D');
  const chordGOverB = Chord.parse('G/B');

  const measures: Measure[] = [];
  let currentTick = 0;
  let syllableSequence = 1;

  // Generador auxiliar de compases
  for (let m = 1; m <= 32; m++) {
    const startTick = currentTick;
    let measureChord: Chord = chordG;
    let lyricText = '';
    let isHyphenated = false;

    // Progresión armónica según forma musical
    if (m >= 1 && m <= 4) {
      // INTRO: G - C - Em - D
      const introChords = [chordG, chordC, chordEm, chordD];
      measureChord = introChords[(m - 1) % 4] ?? chordG;
    } else if (m >= 5 && m <= 8) {
      // VERSE 1: G - C - Em - D ("En Tu pre-sen-cia hay paz")
      const v1Chords = [chordG, chordC, chordEm, chordD];
      measureChord = v1Chords[(m - 5) % 4] ?? chordG;
      if (m === 5) {
        lyricText = 'En';
      } else if (m === 6) {
        lyricText = 'Tu';
      } else if (m === 7) {
        lyricText = 'pre-';
        isHyphenated = true;
      } else if (m === 8) {
        lyricText = 'sen-cia';
      }
    } else if ((m >= 9 && m <= 12) || (m >= 17 && m <= 20) || (m >= 25 && m <= 28)) {
      // CHORUS: C - G - D - Em ("Dig-no es el Se-ñor")
      const chorusChords = [chordC, chordG, chordD, chordEm];
      const offset = m <= 12 ? m - 9 : m <= 20 ? m - 17 : m - 25;
      measureChord = chorusChords[offset] ?? chordC;
      if (offset === 0) {
        lyricText = 'Dig-';
        isHyphenated = true;
      } else if (offset === 1) {
        lyricText = 'no';
      } else if (offset === 2) {
        lyricText = 'es el';
      } else if (offset === 3) {
        lyricText = 'Se-ñor';
      }
    } else if (m >= 13 && m <= 16) {
      // VERSE 2: G - C - Em - D ("Tu gra-cia me sos-tie-ne")
      const v2Chords = [chordG, chordC, chordEm, chordD];
      measureChord = v2Chords[(m - 13) % 4] ?? chordG;
      if (m === 13) lyricText = 'Tu';
      else if (m === 14) lyricText = 'gra-cia';
      else if (m === 15) {
        lyricText = 'me';
      } else if (m === 16) {
        lyricText = 'sos-tie-ne';
      }
    } else if (m >= 21 && m <= 24) {
      // BRIDGE: C - D - Em - G/B ("A-le-lu-ya a-le-lu-ya")
      const bridgeChords = [chordC, chordD, chordEm, chordGOverB];
      measureChord = bridgeChords[(m - 21) % 4] ?? chordC;
      if (m === 21) {
        lyricText = 'A-le-';
        isHyphenated = true;
      } else if (m === 22) {
        lyricText = 'lu-ya';
      } else if (m === 23) {
        lyricText = 'a-le-';
        isHyphenated = true;
      } else if (m === 24) {
        lyricText = 'lu-ya';
      }
    } else if (m >= 29 && m <= 32) {
      // OUTRO: C - G - D - G (Conclusión instrumental)
      const outroChords = [chordC, chordG, chordD, chordG];
      measureChord = outroChords[(m - 29) % 4] ?? chordG;
    }

    // Evento armónico en el compás
    const chords: ChordEvent[] = [
      new ChordEvent({
        id: `chord_ev_${m}`,
        chord: measureChord,
        startTick,
        durationTicks: measureDuration,
        measureNumber: m,
      }),
    ];

    // Eventos melódicos en Voz 1 (Voz Principal)
    const noteId = `note_v1_m${m}`;
    const pitch =
      measureChord.root.equals(NoteName.G)
        ? new Pitch(NoteName.G, 4)
        : measureChord.root.equals(NoteName.C)
          ? new Pitch(NoteName.C, 4)
          : measureChord.root.equals(NoteName.E)
            ? new Pitch(NoteName.E, 4)
            : new Pitch(NoteName.D, 4);

    const voice1Events = [
      new Note({
        id: noteId,
        pitch,
        startTick,
        durationTicks: DURATION_TICKS.HALF, // 960 ticks
        voice: 1,
        staff: 1,
        velocity: 80,
      }),
      new Rest({
        id: `rest_v1_m${m}`,
        startTick: startTick + DURATION_TICKS.HALF,
        durationTicks: DURATION_TICKS.HALF,
        voice: 1,
        staff: 1,
      }),
    ];

    // Evento en Voz 2 (Acompañamiento de Guitarra en Negras)
    const voice2Events = [
      new Note({
        id: `note_v2_m${m}_1`,
        pitch: new Pitch(measureChord.root, 3),
        startTick: startTick,
        durationTicks: DURATION_TICKS.QUARTER,
        voice: 2,
        staff: 1,
        velocity: 70,
      }),
      new Note({
        id: `note_v2_m${m}_2`,
        pitch: new Pitch(measureChord.root, 3),
        startTick: startTick + DURATION_TICKS.QUARTER,
        durationTicks: DURATION_TICKS.QUARTER,
        voice: 2,
        staff: 1,
        velocity: 70,
      }),
      new Note({
        id: `note_v2_m${m}_3`,
        pitch: new Pitch(measureChord.root, 3),
        startTick: startTick + DURATION_TICKS.HALF,
        durationTicks: DURATION_TICKS.QUARTER,
        voice: 2,
        staff: 1,
        velocity: 70,
      }),
      new Note({
        id: `note_v2_m${m}_4`,
        pitch: new Pitch(measureChord.root, 3),
        startTick: startTick + DURATION_TICKS.HALF + DURATION_TICKS.QUARTER,
        durationTicks: DURATION_TICKS.QUARTER,
        voice: 2,
        staff: 1,
        velocity: 70,
      }),
    ];

    // Sílaba lírica si aplica al compás
    const lyrics: LyricSyllable[] = [];
    if (lyricText) {
      lyrics.push(
        new LyricSyllable({
          id: `syl_${m}`,
          text: lyricText,
          isHyphenated,
          boundNoteId: noteId,
          measureNumber: m,
          tickOffset: 0,
          sequenceNumber: syllableSequence++,
          chordAbove: measureChord,
        })
      );
    }

    measures.push(
      new Measure({
        number: m,
        timeSignature,
        keySignature: gMajorKeySig,
        startTick,
        durationTicks: measureDuration,
        voices: [new Voice(1, voice1Events), new Voice(2, voice2Events)],
        chords,
        lyrics,
      })
    );

    currentTick += measureDuration;
  }

  // 8 Secciones canónicas: INTRO, VERSE 1, CHORUS, VERSE 2, CHORUS, BRIDGE, CHORUS, OUTRO
  const sections: Section[] = [
    new Section({
      id: 'sec_intro',
      type: 'INTRO',
      label: 'Intro',
      startMeasure: 1,
      measureCount: 4,
      startTick: 0,
      durationTicks: measureDuration * 4,
    }),
    new Section({
      id: 'sec_v1',
      type: 'VERSE',
      label: 'Verse 1',
      startMeasure: 5,
      measureCount: 4,
      startTick: measureDuration * 4,
      durationTicks: measureDuration * 4,
    }),
    new Section({
      id: 'sec_c1',
      type: 'CHORUS',
      label: 'Chorus 1',
      startMeasure: 9,
      measureCount: 4,
      startTick: measureDuration * 8,
      durationTicks: measureDuration * 4,
    }),
    new Section({
      id: 'sec_v2',
      type: 'VERSE',
      label: 'Verse 2',
      startMeasure: 13,
      measureCount: 4,
      startTick: measureDuration * 12,
      durationTicks: measureDuration * 4,
    }),
    new Section({
      id: 'sec_c2',
      type: 'CHORUS',
      label: 'Chorus 2',
      startMeasure: 17,
      measureCount: 4,
      startTick: measureDuration * 16,
      durationTicks: measureDuration * 4,
    }),
    new Section({
      id: 'sec_bridge',
      type: 'BRIDGE',
      label: 'Bridge',
      startMeasure: 21,
      measureCount: 4,
      startTick: measureDuration * 20,
      durationTicks: measureDuration * 4,
    }),
    new Section({
      id: 'sec_c3',
      type: 'CHORUS',
      label: 'Chorus 3',
      startMeasure: 25,
      measureCount: 4,
      startTick: measureDuration * 24,
      durationTicks: measureDuration * 4,
    }),
    new Section({
      id: 'sec_outro',
      type: 'OUTRO',
      label: 'Outro',
      startMeasure: 29,
      measureCount: 4,
      startTick: measureDuration * 28,
      durationTicks: measureDuration * 4,
    }),
  ];

  // Descriptores de pistas instrumentales
  const instrumentTracks: InstrumentTrack[] = [
    new InstrumentTrack({
      id: 'track_lead_vocal',
      name: 'Voz Principal',
      family: 'VOCALS',
      clef: 'TREBLE',
      transpositionOffsetSemitones: 0,
      voiceIds: [1],
      staffCount: 1,
    }),
    new InstrumentTrack({
      id: 'track_acoustic_guitar',
      name: 'Guitarra Acústica',
      family: 'GUITAR',
      clef: 'TREBLE',
      transpositionOffsetSemitones: 0,
      voiceIds: [2],
      staffCount: 1,
    }),
    new InstrumentTrack({
      id: 'track_alto_sax',
      name: 'Saxo Alto (Eb)',
      family: 'WOODWINDS',
      clef: 'TREBLE',
      transpositionOffsetSemitones: 9, // Eb written offset = +9
      voiceIds: [1],
      staffCount: 1,
    }),
  ];

  const totalDurationTicks = measureDuration * 32; // 61440 ticks
  const timeline = new Timeline({
    tpqn: CANONICAL_TPQN,
    totalDurationTicks,
    measureCount: 32,
    tempoMap,
  });

  return new CanonicalMusicPayload({
    title: 'En Tu Presencia (Referencia Litúrgica)',
    timeline,
    sections,
    measures,
    instrumentTracks,
  });
}
