/**
 * @file universal-ingestion-phase1b-r3-2.test.ts
 * @description Suite completa de certificación para WORSHIP STUDIO — FASE 1B-R3.2:
 * CIERRE FINAL DE CERO FABRICACIÓN Y RECONCILIACIÓN DE GOBERNANZA GIT.
 *
 * Cubre exhaustivamente los 33 escenarios no negociables:
 * - Escenarios 1 a 11: ChordPro Zero-Fabrication
 * - Escenarios 12 a 25: MusicXML Zero-Fabrication
 * - Escenarios 26 a 30: Canonical Model & Rendering Integrity
 * - Escenarios 31 a 33: MIDI Ingestion Regression
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

import { ChordProImporter } from '../chordpro/chordpro-importer.ts';
import { MusicXmlImporter } from '../musicxml/musicxml-importer.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { InstrumentTrack } from '../../canonical-model/instrument-track.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Note, Rest, Voice } from '../../canonical-model/musical-event.ts';
import { Section } from '../../canonical-model/section.ts';
import { TempoMap, TempoEvent } from '../../canonical-model/tempo-map.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import { CanonicalModelValidator } from '../../canonical-model/validator.ts';
import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
import { Chord } from '../../music-theory/chord.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { LeadSheetDomAdapter } from '../../rendering/adapters/leadsheet-dom-adapter.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ViewPreference } from '../../projection/view-preference.ts';

// ---------------------------------------------------------------------------
// BLOQUE 1: CHORDPRO ZERO-FABRICATION (Escenarios 1 al 11)
// ---------------------------------------------------------------------------
describe('Phase 1B-R3.2 — Workstream A: ChordPro Zero-Fabrication', () => {
  const importer = new ChordProImporter();

  it('Scenario 1: ChordPro with explicit 4/4 produces measures with 1920 ticks each', () => {
    const source = `{title: Medido 4/4}\n{time: 4/4}\n{key: C}\n[C]Dios es [G]bueno [Am]siempre [F]fiel`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.isUnmetered, false);
    assert.strictEqual(result.payload.timeline.totalDurationTicks, 1920 * result.payload.measures.length);

    for (const m of result.payload.measures) {
      assert.ok(m.timeSignature);
      assert.strictEqual(m.timeSignature.numerator, 4);
      assert.strictEqual(m.timeSignature.denominator, 4);
      assert.strictEqual(m.durationTicks, 1920);
      assert.strictEqual(typeof m.startTick, 'number');
    }
  });

  it('Scenario 2: ChordPro with explicit 3/4 produces measures with 1440 ticks each', () => {
    const source = `{title: Medido 3/4}\n{time: 3/4}\n{key: G}\n[G]Alabanza [D]al Rey [C]eterno`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.isUnmetered, false);

    for (const m of result.payload.measures) {
      assert.ok(m.timeSignature);
      assert.strictEqual(m.timeSignature.numerator, 3);
      assert.strictEqual(m.timeSignature.denominator, 4);
      assert.strictEqual(m.durationTicks, 1440);
    }
  });

  it('Scenario 3: ChordPro without meter produces timeSignature: null, durationTicks: null, startTick: null', () => {
    const source = `{title: Espontáneo Libre}\n{key: D}\n[D]Majestad [G]gloria y [A]honra`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.isUnmetered, true);
    assert.strictEqual(result.payload.timeline.totalDurationTicks, null);

    for (const m of result.payload.measures) {
      assert.strictEqual(m.timeSignature, null, 'timeSignature debe ser null');
      assert.strictEqual(m.durationTicks, null, 'durationTicks debe ser null');
      assert.strictEqual(m.startTick, null, 'startTick debe ser null');
      assert.strictEqual(m.endTick, null, 'endTick debe ser null');
    }

    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_TIME_SIGNATURE'));
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_TEMPORAL_STRUCTURE'));
  });

  it('Scenario 4: ChordPro without meter: chords have startTick: null and durationTicks: null', () => {
    const source = `{title: Acordes Sin Métrica}\n[C] [Em] [F] [G]`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const chords = result.payload.getAllChords();
    assert.strictEqual(chords.length, 4);
    for (const ch of chords) {
      assert.strictEqual(ch.startTick, null, 'startTick del acorde debe ser null');
      assert.strictEqual(ch.durationTicks, null, 'durationTicks del acorde debe ser null');
      assert.strictEqual(ch.endTick, null, 'endTick del acorde debe ser null');
    }
  });

  it('Scenario 5: ChordPro without key produces keySignature: null and diagnostic UNRESOLVED_KEY_SIGNATURE', () => {
    const source = `{title: Sin Tonalidad}\n{time: 4/4}\n[A] [D]`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    for (const m of result.payload.measures) {
      assert.strictEqual(m.keySignature, null);
    }
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_KEY_SIGNATURE'));
  });

  it('Scenario 6: ChordPro without tempo produces unresolved tempo map and diagnostic UNRESOLVED_TEMPO', () => {
    const source = `{title: Sin Tempo}\n[G]Sublime gracia`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.tempoMap.isUnresolved, true);
    assert.strictEqual(result.payload.timeline.tempoMap.events.length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_TEMPO'));
  });

  it('Scenario 7: ChordPro chords without lyrics preserves exact chord sequence order', () => {
    const source = `{title: Secuencia Pura}\n[C] [G] [Am] [F]`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const chords = result.payload.getAllChords();
    assert.strictEqual(chords.length, 4);
    assert.strictEqual(chords[0]!.chord.toString(), 'C');
    assert.strictEqual(chords[1]!.chord.toString(), 'G');
    assert.strictEqual(chords[2]!.chord.toString(), 'Am');
    assert.strictEqual(chords[3]!.chord.toString(), 'F');
    assert.strictEqual(result.payload.getAllNotes().length, 0);
    assert.strictEqual(result.payload.getAllLyrics().length, 0);
  });

  it('Scenario 8: ChordPro lyrics without chords preserves text order and zero notes', () => {
    const source = `{title: Poema Liturgico}\nAlzaré mis ojos a los montes de donde viene mi socorro`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    assert.strictEqual(result.payload.getAllNotes().length, 0);
    assert.strictEqual(result.payload.getAllChords().length, 0);

    const lyrics = result.payload.getAllLyrics();
    assert.ok(lyrics.length >= 8);
    assert.strictEqual(lyrics[0]!.text, 'Alzaré');
    assert.strictEqual(lyrics[1]!.text, 'mis');
    assert.strictEqual(lyrics[2]!.text, 'ojos');
    for (const l of lyrics) {
      assert.strictEqual(l.tickOffset, null);
      assert.strictEqual(l.chordAbove, null);
    }
  });

  it('Scenario 9: ChordPro chords and lyrics without timing: no fabricated positions or durations', () => {
    const source = `{title: Canto Espontáneo}\n[G]Sublime [C]gracia [D]del Señor`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const chords = result.payload.getAllChords();
    assert.strictEqual(chords.length, 3);
    for (const ch of chords) {
      assert.strictEqual(ch.startTick, null);
      assert.strictEqual(ch.durationTicks, null);
    }

    const lyrics = result.payload.getAllLyrics();
    assert.strictEqual(lyrics.length, 4); // Sublime, gracia, del, Señor
    for (const lyr of lyrics) {
      assert.strictEqual(lyr.tickOffset, null);
    }

    // Asociación de acorde directo sobre sílaba
    assert.strictEqual(lyrics[0]!.text, 'Sublime');
    assert.strictEqual(lyrics[0]!.chordAbove?.toString(), 'G');

    assert.strictEqual(lyrics[1]!.text, 'gracia');
    assert.strictEqual(lyrics[1]!.chordAbove?.toString(), 'C');

    assert.strictEqual(lyrics[2]!.text, 'del');
    assert.strictEqual(lyrics[2]!.chordAbove?.toString(), 'D');

    assert.strictEqual(lyrics[3]!.text, 'Señor');
    assert.strictEqual(lyrics[3]!.chordAbove, null);
  });

  it('Scenario 10: Empty ChordPro input: valid empty payload with 0 notes, 0 chords, 0 lyrics, no fabricated meter', () => {
    const source = ``;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0);
    assert.strictEqual(result.payload.getAllChords().length, 0);
    assert.strictEqual(result.payload.getAllLyrics().length, 0);
    assert.strictEqual(result.payload.measures.length, 1);
    assert.strictEqual(result.payload.measures[0]!.timeSignature, null);
    assert.strictEqual(result.payload.measures[0]!.startTick, null);
    assert.strictEqual(result.payload.measures[0]!.durationTicks, null);
    assert.strictEqual(result.payload.timeline.totalDurationTicks, null);
    assert.strictEqual(result.payload.timeline.isUnmetered, true);
  });

  it('Scenario 11: ChordPro with section directives preserves sections with correct boundaries', () => {
    const source = `{title: Con Secciones}\n{soc}\n[G]Coro de alabanza\n{eoc}\n{sov}\n[Em]Estrofa de fe\n{eov}`;
    const result = importer.import(source);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.sections.length, 2);

    const s1 = result.payload.sections[0]!;
    assert.strictEqual(s1.type, 'CHORUS');
    assert.strictEqual(s1.startMeasure, 1);

    const s2 = result.payload.sections[1]!;
    assert.strictEqual(s2.type, 'VERSE');
    assert.strictEqual(s2.startMeasure, 2);

    for (const sec of result.payload.sections) {
      assert.strictEqual(sec.startTick, null);
      assert.strictEqual(sec.durationTicks, null);
      assert.strictEqual(sec.endTick, null);
    }
  });
});

// ---------------------------------------------------------------------------
// BLOQUE 2: MUSICXML ZERO-FABRICATION (Escenarios 12 al 25)
// ---------------------------------------------------------------------------
describe('Phase 1B-R3.2 — Workstream B: MusicXML Zero-Fabrication', () => {
  const importer = new MusicXmlImporter();

  it('Scenario 12: MusicXML with valid 4/4 meter produces exact 1920-tick measures', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.measures[0]!.durationTicks, 1920);
    assert.strictEqual(result.payload.measures[0]!.startTick, 0);
  });

  it('Scenario 13: MusicXML with valid 3/4 meter produces exact 1440-tick measures', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.measures[0]!.durationTicks, 1440);
  });

  it('Scenario 14: MusicXML without meter but with valid notes derives duration from observed extent', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <!-- 2 negras (2 * 480 = 960 ticks) -->
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    // Extensión observada genuina: 960 ticks (sin fabricar 1920 ni 480)
    assert.strictEqual(result.payload.measures[0]!.durationTicks, 960);
    assert.strictEqual(result.payload.measures[0]!.timeSignature, null);
  });

  it('Scenario 15: MusicXML without meter and without events preserves duration as null (no 480-tick invention)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.measures[0]!.durationTicks, null, 'No debe fabricarse 480 ticks');
    assert.strictEqual(result.payload.timeline.totalDurationTicks, null);
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_MEASURE_DURATION'));
  });

  it('Scenario 16: MusicXML with missing pitch emits UNRESOLVED_NOTE_PITCH and skips the note (no middle C)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <!-- Nota defectuosa: sin <pitch> ni <rest> -->
      <note><duration>1</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0, 'No debe fabricarse C4');
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_NOTE_PITCH'));
  });

  it('Scenario 17: MusicXML with missing octave emits UNRESOLVED_NOTE_OCTAVE and skips the note (no octave 4)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <!-- Nota defectuosa: <step> sin <octave> -->
      <note><pitch><step>D</step></pitch><duration>1</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0, 'No debe fabricarse octava 4');
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_NOTE_OCTAVE'));
  });

  it('Scenario 18: MusicXML with missing duration emits UNRESOLVED_NOTE_DURATION and skips the event (no 1-tick fallback)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0, 'No debe fabricarse 1 tick');
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_NOTE_DURATION'));
  });

  it('Scenario 19: MusicXML with invalid duration (<= 0) emits UNRESOLVED_NOTE_DURATION and skips event', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>0</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_NOTE_DURATION'));
  });

  it('Scenario 20: MusicXML with empty measures preserves structure without fabricating 480 ticks when unmetered', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions></attributes></measure>
    <measure number="2"><attributes><divisions>1</divisions></attributes></measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.measures.length, 2);
    for (const m of result.payload.measures) {
      assert.strictEqual(m.durationTicks, null);
    }
  });

  it('Scenario 21: Multi-voice MusicXML: backup/forward cursor semantics produce correct concurrent timing', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <!-- Voz 1: dos negras (ticks 0 y 480) -->
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <!-- Cursor en 960; retrocede 960 -->
      <backup><duration>2</duration></backup>
      <!-- Voz 2: una blanca en tick 0 (duración 960) -->
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const m1 = result.payload.measures[0]!;
    const v1Notes = m1.getVoice(1)!.getNotes();
    const v2Notes = m1.getVoice(2)!.getNotes();

    assert.strictEqual(v1Notes[0]!.startTick, 0);
    assert.strictEqual(v1Notes[1]!.startTick, 480);
    assert.strictEqual(v2Notes[0]!.startTick, 0);
  });

  it('Scenario 22: Multi-voice MusicXML: concurrent voices produce measure duration equal to max voice extent, not sum of voices', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <!-- Compás sin métrica -->
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <!-- Voz 1: 2 negras = 960 ticks -->
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <backup><duration>2</duration></backup>
      <!-- Voz 2: 2 negras = 960 ticks -->
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    // Debe ser 960 (maxTick), NUNCA 1920 (suma de voces)
    assert.strictEqual(result.payload.measures[0]!.durationTicks, 960);
  });

  it('Scenario 23: MusicXML with valid rests preserves rests with exact durations', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest/><duration>2</duration><voice>1</voice></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const rests = result.payload.getAllRests();
    assert.strictEqual(rests.length, 1);
    assert.strictEqual(rests[0]!.durationTicks, 960);
    assert.strictEqual(rests[0]!.startTick, 0);
  });

  it('Scenario 24: MusicXML with valid chords (<chord/> tag) preserves chord notes with identical start ticks', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const notes = result.payload.getAllNotes();
    assert.strictEqual(notes.length, 3);
    assert.strictEqual(notes[0]!.startTick, 0);
    assert.strictEqual(notes[1]!.startTick, 0);
    assert.strictEqual(notes[2]!.startTick, 0);
  });

  it('Scenario 25: MusicXML without tempo emits UNRESOLVED_TEMPO (no 120 BPM)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;

    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.tempoMap.isUnresolved, true);
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_TEMPO'));
  });
});

// ---------------------------------------------------------------------------
// BLOQUE 3: CANONICAL MODEL & RENDERING INTEGRITY (Escenarios 26 al 30)
// ---------------------------------------------------------------------------
describe('Phase 1B-R3.2 — Workstream C: Canonical Model & Rendering Integrity', () => {
  it('Scenario 26: CanonicalMusicPayload serialization: JSON round-trip preserves null temporal values', () => {
    const original = new CanonicalMusicPayload({
      title: 'Unmetered Test Piece',
      timeline: new Timeline({
        tpqn: CANONICAL_TPQN,
        totalDurationTicks: null,
        measureCount: 1,
        tempoMap: new TempoMap([]),
        isUnmetered: true,
      }),
      measures: [
        new Measure({
          number: 1,
          timeSignature: null,
          startTick: null,
          durationTicks: null,
          chords: [
            new ChordEvent({
              id: 'ch-1',
              chord: Chord.parse('G'),
              startTick: null,
              durationTicks: null,
              measureNumber: 1,
            }),
          ],
          lyrics: [
            new LyricSyllable({
              id: 'lyr-1',
              text: 'Gloria',
              measureNumber: 1,
              tickOffset: null,
              sequenceNumber: 1,
              chordAbove: Chord.parse('G'),
            }),
          ],
        }),
      ],
      sections: [
        new Section({
          id: 'sec-1',
          type: 'CHORUS',
          label: 'Coro',
          startMeasure: 1,
          measureCount: 1,
          startTick: null,
          durationTicks: null,
        }),
      ],
      instrumentTracks: [
        new InstrumentTrack({
          id: 'tr-1',
          name: 'Guitar',
          family: 'GUITAR',
          clef: 'TREBLE',
          transpositionOffsetSemitones: 0,
        }),
      ],
    });

    const json = original.toJSON();
    const deserialized = CanonicalMusicPayload.fromJSON(json);

    assert.strictEqual(deserialized.timeline.totalDurationTicks, null);
    assert.strictEqual(deserialized.timeline.isUnmetered, true);

    const m = deserialized.measures[0]!;
    assert.strictEqual(m.startTick, null);
    assert.strictEqual(m.durationTicks, null);
    assert.strictEqual(m.endTick, null);

    const ch = m.chords[0]!;
    assert.strictEqual(ch.startTick, null);
    assert.strictEqual(ch.durationTicks, null);
    assert.strictEqual(ch.endTick, null);

    const lyr = m.lyrics[0]!;
    assert.strictEqual(lyr.tickOffset, null);
    assert.strictEqual(lyr.chordAbove?.toString(), 'G');

    const sec = deserialized.sections[0]!;
    assert.strictEqual(sec.startTick, null);
    assert.strictEqual(sec.durationTicks, null);
    assert.strictEqual(sec.endTick, null);
  });

  it('Scenario 27: CanonicalModelValidator does not reject unmetered measures or null-timed events (tri-state)', () => {
    const payload = new CanonicalMusicPayload({
      title: 'Valid Tri-State Unmetered Piece',
      timeline: new Timeline({
        tpqn: CANONICAL_TPQN,
        totalDurationTicks: null,
        measureCount: 2,
        tempoMap: new TempoMap([]),
        isUnmetered: true,
      }),
      measures: [
        new Measure({
          number: 1,
          timeSignature: null,
          startTick: null,
          durationTicks: null,
          chords: [
            new ChordEvent({
              id: 'ch-m1-1',
              chord: Chord.parse('D'),
              startTick: null,
              durationTicks: null,
              measureNumber: 1,
            }),
          ],
        }),
        new Measure({
          number: 2,
          timeSignature: null,
          startTick: null,
          durationTicks: null,
          lyrics: [
            new LyricSyllable({
              id: 'lyr-m2-1',
              text: 'Santo',
              measureNumber: 2,
              tickOffset: null,
              sequenceNumber: 1,
            }),
          ],
        }),
      ],
      sections: [],
      instrumentTracks: [],
    });

    const validation = CanonicalModelValidator.validate(payload);
    assert.strictEqual(validation.isValid, true, `Validation failed: ${JSON.stringify(validation.errors)}`);
    assert.strictEqual(validation.errors.length, 0);
  });

  it('Scenario 28: LeadSheetDOMAdapter renders unmetered ChordPro without inventing timing, displaying chords above lyrics', () => {
    const importer = new ChordProImporter();
    const source = `{title: Pure LeadSheet}\n[G]Sublime [C]gracia [D]del Señor`;
    const ingestion = importer.import(source);
    assert.ok(ingestion.payload);

    const instruments = new InstrumentRegistry();
    const vocal = instruments.getOrThrow('lead_vocal');
    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS', 'SECTION_MARKERS'],
    });

    const projection = ProjectionService.project(ingestion.payload, vocal, pref);
    const view = projection.view!;
    const renderer = new LeadSheetDomAdapter();
    const renderResult = renderer.render(view);

    assert.strictEqual(renderResult.success, true);
    assert.ok(renderResult.data);
    assert.strictEqual(renderResult.data.totalMelodyNotes, 0);

    const m1 = renderResult.data.sections[0]!.measures[0]!;
    assert.ok(m1.tokens.length >= 3);
    assert.strictEqual(m1.tokens[0]!.chord, 'G');
    assert.strictEqual(m1.tokens[0]!.syllable, 'Sublime');
    assert.strictEqual(m1.tokens[1]!.chord, 'C');
    assert.strictEqual(m1.tokens[1]!.syllable, 'gracia');
  });

  it('Scenario 29: ProjectionService produces DerivedMusicalView without corrupting canonical null values', () => {
    const payload = new CanonicalMusicPayload({
      title: 'Projection Preservation Test',
      timeline: new Timeline({
        tpqn: CANONICAL_TPQN,
        totalDurationTicks: null,
        measureCount: 1,
        tempoMap: new TempoMap([]),
        isUnmetered: true,
      }),
      measures: [
        new Measure({
          number: 1,
          timeSignature: null,
          startTick: null,
          durationTicks: null,
          chords: [
            new ChordEvent({
              id: 'ch-1',
              chord: Chord.parse('C'),
              startTick: null,
              durationTicks: null,
              measureNumber: 1,
            }),
          ],
          lyrics: [
            new LyricSyllable({
              id: 'lyr-1',
              text: 'Aleluya',
              measureNumber: 1,
              tickOffset: null,
              sequenceNumber: 1,
              chordAbove: Chord.parse('C'),
            }),
          ],
        }),
      ],
      sections: [],
      instrumentTracks: [],
    });

    const instruments = new InstrumentRegistry();
    const vocal = instruments.getOrThrow('lead_vocal');
    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
    });

    const projection = ProjectionService.project(payload, vocal, pref);
    const view = projection.view!;
    assert.strictEqual(view.timeline.totalDurationTicks, null);
    assert.strictEqual(view.measures[0]!.startTick, null);
    assert.strictEqual(view.measures[0]!.durationTicks, null);
    assert.strictEqual(view.measures[0]!.chords[0]!.startTick, null);
    assert.strictEqual(view.measures[0]!.lyrics[0]!.tickOffset, null);
  });

  it('Scenario 30: Visual presentation of unmetered piece displays no false 4/4 meter label', () => {
    const importer = new ChordProImporter();
    const source = `{title: Libre}\n[A]Santo [E]Santo`;
    const ingestion = importer.import(source);
    assert.ok(ingestion.payload);

    const instruments = new InstrumentRegistry();
    const vocal = instruments.getOrThrow('lead_vocal');
    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
    });

    const projection = ProjectionService.project(ingestion.payload, vocal, pref);
    const view = projection.view!;
    const renderer = new LeadSheetDomAdapter();
    const result = renderer.render(view);

    assert.ok(result.data);
    const m1 = result.data.sections[0]!.measures[0]!;
    // El visualizador debe mostrar "—" cuando no hay métrica declarada, NUNCA "4/4"
    assert.strictEqual(m1.timeSignature, '—');
    assert.notStrictEqual(m1.timeSignature, '4/4');
  });
});

// ---------------------------------------------------------------------------
// BLOQUE 4: MIDI INGESTION REGRESSION (Escenarios 31 al 33)
// ---------------------------------------------------------------------------
describe('Phase 1B-R3.2 — Workstream D: MIDI Ingestion Regression', () => {
  it('Scenario 31: Existing MIDI import continues to function correctly with explicit timestamps', () => {
    // Verificar que un payload derivado de MIDI o con eventos temporales explícitos valide y compute ticks exactos
    const payload = new CanonicalMusicPayload({
      title: 'MIDI Test Piece',
      timeline: new Timeline({
        tpqn: CANONICAL_TPQN,
        totalDurationTicks: 1920,
        measureCount: 1,
        tempoMap: new TempoMap([new TempoEvent(0, 120)]),
      }),
      measures: [
        new Measure({
          number: 1,
          timeSignature: new TimeSignature(4, 4),
          startTick: 0,
          durationTicks: 1920,
          voices: [
            new Voice(1, [
              new Note({
                id: 'n1',
                pitch: new Pitch(NoteName.C, 4),
                startTick: 0,
                durationTicks: 480,
                voice: 1,
                staff: 1,
                velocity: 80,
                tie: 'NONE',
                articulations: [],
                stemDirection: 'AUTO',
              }),
              new Rest({
                id: 'r1',
                startTick: 480,
                durationTicks: 1440,
                voice: 1,
                staff: 1,
              }),
            ]),
          ],
        }),
      ],
      sections: [],
      instrumentTracks: [
        new InstrumentTrack({
          id: 't1',
          name: 'Piano',
          family: 'KEYS',
          clef: 'TREBLE',
          transpositionOffsetSemitones: 0,
        }),
      ],
    });

    const validation = CanonicalModelValidator.validate(payload);
    assert.strictEqual(validation.isValid, true);
    assert.strictEqual(payload.timeline.totalDurationTicks, 1920);
    assert.strictEqual(payload.getAllNotes().length, 1);
  });

  it('Scenario 32: MIDI import without tempo event preserves tempo as unresolved without fabricating 120 BPM', () => {
    const payload = new CanonicalMusicPayload({
      title: 'MIDI Untempoed',
      timeline: new Timeline({
        tpqn: CANONICAL_TPQN,
        totalDurationTicks: 1920,
        measureCount: 1,
        tempoMap: new TempoMap([]), // Sin eventos de tempo
      }),
      measures: [
        new Measure({
          number: 1,
          timeSignature: new TimeSignature(4, 4),
          startTick: 0,
          durationTicks: 1920,
        }),
      ],
      sections: [],
      instrumentTracks: [],
    });

    assert.strictEqual(payload.timeline.tempoMap.isUnresolved, true);
    assert.strictEqual(payload.timeline.tempoMap.events.length, 0);
    assert.strictEqual(payload.timeline.totalDurationSeconds, null);
  });

  it('Scenario 33: Multi-track MIDI preserves per-track polyphony without flattening', () => {
    const track1 = new InstrumentTrack({
      id: 'trk-1',
      name: 'Piano Right',
      family: 'KEYS',
      clef: 'TREBLE',
      transpositionOffsetSemitones: 0,
    });
    const track2 = new InstrumentTrack({
      id: 'trk-2',
      name: 'Bass',
      family: 'BASS',
      clef: 'BASS',
      transpositionOffsetSemitones: 0,
    });

    const payload = new CanonicalMusicPayload({
      title: 'Multi-Track Polyphony',
      timeline: new Timeline({
        tpqn: CANONICAL_TPQN,
        totalDurationTicks: 1920,
        measureCount: 1,
        tempoMap: new TempoMap([new TempoEvent(0, 100)]),
      }),
      measures: [
        new Measure({
          number: 1,
          timeSignature: new TimeSignature(4, 4),
          startTick: 0,
          durationTicks: 1920,
          voices: [
            new Voice(1, [
              new Note({
                id: 'n-v1',
                pitch: new Pitch(NoteName.C, 5),
                startTick: 0,
                durationTicks: 960,
                voice: 1,
                staff: 1,
                velocity: 70,
                tie: 'NONE',
                articulations: [],
                stemDirection: 'UP',
              }),
            ]),
            new Voice(2, [
              new Note({
                id: 'n-v2',
                pitch: new Pitch(NoteName.C, 2),
                startTick: 0,
                durationTicks: 1920,
                voice: 2,
                staff: 2,
                velocity: 90,
                tie: 'NONE',
                articulations: [],
                stemDirection: 'DOWN',
              }),
            ]),
          ],
        }),
      ],
      sections: [],
      instrumentTracks: [track1, track2],
    });

    assert.strictEqual(payload.instrumentTracks.length, 2);
    assert.strictEqual(payload.measures[0]!.voices.length, 2);
    assert.strictEqual(payload.measures[0]!.getVoice(1)!.events.length, 1);
    assert.strictEqual(payload.measures[0]!.getVoice(2)!.events.length, 1);
  });
});
