/**
 * @file chord-and-lyric.test.ts
 * @description Pruebas unitarias para ChordEvent y LyricSyllable estructurados dentro del modelo canónico.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Chord } from '../../music-theory/chord.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { ChordEvent } from '../chord-event.ts';
import { KeySignatureReference } from '../key-signature-reference.ts';
import { LyricSyllable } from '../lyric-syllable.ts';
import { Measure } from '../measure.ts';
import { Note, Voice } from '../musical-event.ts';
import { TimeSignature } from '../time-signature.ts';
import { DURATION_TICKS } from '../types.ts';

describe('Structured ChordEvent & LyricSyllable Tests', () => {
  const cMajorKey = new KeySignatureReference(NoteName.C, 'MAJOR');

  it('should associate structured ChordEvents with measures and timing offsets', () => {
    const chordG = Chord.parse('G');
    const chordDOverFs = Chord.parse('D/F#');

    const ev1 = new ChordEvent({
      id: 'ch_1',
      chord: chordG,
      startTick: 0,
      durationTicks: DURATION_TICKS.HALF,
      measureNumber: 1,
    });

    const ev2 = new ChordEvent({
      id: 'ch_2',
      chord: chordDOverFs,
      startTick: DURATION_TICKS.HALF,
      durationTicks: DURATION_TICKS.HALF,
      measureNumber: 1,
    });

    assert.strictEqual(ev1.chord.root.toString(), 'G');
    assert.strictEqual(ev1.chord.quality, 'MAJOR');
    assert.strictEqual(ev2.chord.isSlashChord, true);
    assert.strictEqual(ev2.chord.bass?.toString(), 'F#');

    const measure = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
      chords: [ev1, ev2],
    });

    assert.strictEqual(measure.chords.length, 2);
    assert.strictEqual(measure.chords[0]?.chord.root.toString(), 'G');
    assert.strictEqual(measure.chords[1]?.chord.bass?.toString(), 'F#');
  });

  it('should model structured LyricSyllables with hyphenation, note binding and chord context', () => {
    // Nota cantada: "Glo-"
    const noteGlo = new Note({
      id: 'note_glo',
      pitch: new Pitch(NoteName.G, 4),
      startTick: 0,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
    });

    // Nota cantada: "-ria"
    const noteRia = new Note({
      id: 'note_ria',
      pitch: new Pitch(NoteName.A, 4),
      startTick: DURATION_TICKS.QUARTER,
      durationTicks: DURATION_TICKS.QUARTER,
      voice: 1,
    });

    const chordG = Chord.parse('G');

    const sylGlo = new LyricSyllable({
      id: 'syl_1',
      text: 'Glo',
      isHyphenated: true,
      boundNoteId: 'note_glo',
      measureNumber: 1,
      tickOffset: 0,
      sequenceNumber: 1,
      chordAbove: chordG,
    });

    const sylRia = new LyricSyllable({
      id: 'syl_2',
      text: 'ria',
      isHyphenated: false,
      boundNoteId: 'note_ria',
      measureNumber: 1,
      tickOffset: DURATION_TICKS.QUARTER,
      sequenceNumber: 2,
    });

    assert.strictEqual(sylGlo.text, 'Glo');
    assert.strictEqual(sylGlo.isHyphenated, true);
    assert.strictEqual(sylGlo.boundNoteId, 'note_glo');
    assert.strictEqual(sylGlo.chordAbove?.root.toString(), 'G');

    assert.strictEqual(sylRia.text, 'ria');
    assert.strictEqual(sylRia.isHyphenated, false);
    assert.strictEqual(sylRia.boundNoteId, 'note_ria');
    assert.strictEqual(sylRia.chordAbove, null);

    const voice = new Voice(1, [noteGlo, noteRia]);
    const measure = new Measure({
      number: 1,
      timeSignature: TimeSignature.FOUR_FOUR,
      keySignature: cMajorKey,
      startTick: 0,
      voices: [voice],
      lyrics: [sylGlo, sylRia],
    });

    assert.strictEqual(measure.lyrics.length, 2);
    assert.strictEqual(measure.lyrics[0]?.boundNoteId, 'note_glo');
    assert.strictEqual(measure.lyrics[1]?.boundNoteId, 'note_ria');
  });
});
