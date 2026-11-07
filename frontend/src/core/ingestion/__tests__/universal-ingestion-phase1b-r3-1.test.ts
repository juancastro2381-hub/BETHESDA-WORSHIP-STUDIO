/**
 * @file universal-ingestion-phase1b-r3-1.test.ts
 * @description Suite de pruebas de regresión, integridad y fidelidad musical para Fase 1B-R3.1.
 * Cubre exhaustivamente los Workstreams B1 (ChordPro), B2 (MusicXML), y B3 (Modelo Canónico).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ChordProImporter } from '../chordpro/chordpro-importer.ts';
import { MusicXmlImporter } from '../musicxml/musicxml-importer.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import { TempoMap, TempoEvent } from '../../canonical-model/tempo-map.ts';
import { CanonicalModelValidator } from '../../canonical-model/validator.ts';
import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
import { LeadSheetDomAdapter } from '../../rendering/adapters/leadsheet-dom-adapter.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ViewPreference } from '../../projection/view-preference.ts';

describe('Phase 1B-R3.1 — Workstream B1: ChordPro Musical Fidelity', () => {
  const importer = new ChordProImporter();

  it('B1.1: File with explicit time signature preserves declared meter', () => {
    const chordpro = `{title: Medido 3/4}\n{time: 3/4}\n{key: G}\n[G]Dios es [D]bueno [C]siempre`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.isUnmetered, false);
    const m1 = result.payload.measures[0]!;
    assert.ok(m1.timeSignature);
    assert.strictEqual(m1.timeSignature.numerator, 3);
    assert.strictEqual(m1.timeSignature.denominator, 4);
    assert.strictEqual(m1.durationTicks, 1440); // 3 * 480
  });

  it('B1.2: File without time signature preserves null meter without assuming 4/4 (Zero Fabrication)', () => {
    const chordpro = `{title: Libre y Espontaneo}\n{key: D}\n[D]Alabanza al [G]Rey de reyes [A]para siempre`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    // Verificación de invariante: isUnmetered = true, timeSignature = null
    assert.strictEqual(result.payload.timeline.isUnmetered, true);
    for (const m of result.payload.measures) {
      assert.strictEqual(m.timeSignature, null, 'No debe fabricarse un TimeSignature 4/4');
    }
    // Debe emitirse diagnóstico explícito
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_TIME_SIGNATURE'));
  });

  it('B1.3: File with explicit key preserves declared tonality', () => {
    const chordpro = `{title: En Tonalidad de Mi}\n{key: E}\n{time: 4/4}\n[E]Grande es el Señor`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    const m1 = result.payload.measures[0]!;
    assert.ok(m1.keySignature);
    assert.strictEqual(m1.keySignature.tonic.toString(), 'E');
  });

  it('B1.4: File without key preserves keySignature=null with explicit diagnostic', () => {
    const chordpro = `{title: Sin Clave}\n{time: 4/4}\n[C]Aleluya [F]Aleluya`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    const m1 = result.payload.measures[0]!;
    assert.strictEqual(m1.keySignature, null, 'No debe inventarse armadura C Major');
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_KEY_SIGNATURE'));
  });

  it('B1.5: Invalid time signature is rejected gracefully to null with warning diagnostic', () => {
    const chordpro = `{title: Metrica Erronea}\n{time: 99/99}\n[A]Santo es el Señor`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.isUnmetered, true);
    assert.strictEqual(result.payload.measures[0]!.timeSignature, null);
    assert.ok(result.diagnostics.some((d) => d.code === 'INVALID_TIME_SIGNATURE'));
  });

  it('B1.6: Lyrics without chords are ingested with zero invented melodic notes', () => {
    const chordpro = `{title: Solo Poema Liturgico}\nAlzaré mis ojos a los montes de donde viene mi socorro`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0, 'Cero notas inventadas para lírica pura');
    assert.ok(result.payload.getAllLyrics().length > 0);
  });

  it('B1.7: Chords without lyrics are ingested with zero invented melodic notes', () => {
    const chordpro = `{title: Secuencia Instrumental}\n{key: C}\n[C] [G] [Am] [F]`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0);
    const chords = result.payload.getAllChords();
    assert.strictEqual(chords.length, 4);
    assert.strictEqual(chords[0]?.chord.root.toString(), 'C');
    assert.strictEqual(chords[1]?.chord.root.toString(), 'G');
    assert.strictEqual(chords[2]?.chord.root.toString(), 'A');
    assert.strictEqual(chords[3]?.chord.root.toString(), 'F');
  });

  it('B1.8: Multiple sections ({sov}, {soc}, {sob}) are properly structured', () => {
    const chordpro = `{title: Himno Multiseccion}
{start_of_verse: Estrofa}
[C]Canto de alabanza
{end_of_verse}
{start_of_chorus: Coro}
[G]Gloria en las alturas
{end_of_chorus}
{start_of_bridge: Puente}
[Am]Por los siglos de los siglos
{end_of_bridge}`;
    const result = importer.import(chordpro);

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.sections.length, 3);
    assert.strictEqual(result.payload.sections[0]?.type, 'VERSE');
    assert.strictEqual(result.payload.sections[1]?.type, 'CHORUS');
    assert.strictEqual(result.payload.sections[2]?.type, 'BRIDGE');
  });

  it('B1.9: Round-trip JSON serialization preserves unmetered metadata fidelity', () => {
    const chordpro = `{title: Unmetered Song}\n[D]Dios es [A]real`;
    const result = importer.import(chordpro);
    assert.ok(result.payload);

    const json = result.payload.toJSON();
    const jsonStr = JSON.stringify(json);
    const rehydrated = CanonicalMusicPayload.fromJSON(jsonStr);

    assert.strictEqual(rehydrated.timeline.isUnmetered, true);
    assert.strictEqual(rehydrated.measures[0]!.timeSignature, null);
    assert.strictEqual(rehydrated.timeline.totalDurationSeconds, null); // tempoMap sin eventos -> durationSeconds null
  });
});

describe('Phase 1B-R3.1 — Workstream B2: MusicXML Musical Fidelity & Malformed Input Handling', () => {
  const importer = new MusicXmlImporter();

  it('B2.1: Complete valid score imports with exact metrics and polyphony', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Voz</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction><sound tempo="100"/></direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.isUnmetered, false);
    assert.strictEqual(result.payload.timeline.tempoMap.getTempoAtTick(0), 100);
    assert.strictEqual(result.payload.measures[0]!.durationTicks, 1920);
    assert.strictEqual(result.payload.getAllNotes().length, 1);
  });

  it('B2.2: Missing time signature preserves null meter without defaulting to 4/4 or 1920', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Voz</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>1</fifths><mode>major</mode></key>
      </attributes>
      <!-- Nota que dura 3 negras = 1440 ticks -->
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>3</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.isUnmetered, true);
    const m1 = result.payload.measures[0]!;
    assert.strictEqual(m1.timeSignature, null, 'No debe inventarse métrica');
    assert.strictEqual(m1.durationTicks, 1440, 'La duración del compás debe derivarse de las notas reales (1440), no de 1920');
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_TIME_SIGNATURE'));
  });

  it('B2.3: Missing key signature preserves null tonality with diagnostic', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Flauta</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.measures[0]!.keySignature, null);
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_KEY_SIGNATURE'));
  });

  it('B2.4: Missing tempo preserves unresolved tempoMap without defaulting to 120 BPM', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.timeline.tempoMap.isUnresolved, true);
    assert.strictEqual(result.payload.timeline.totalDurationSeconds, null);
    assert.ok(result.diagnostics.some((d) => d.code === 'UNRESOLVED_TEMPO'));
  });

  it('B2.5: Missing pitch step does NOT invent "C" and emits diagnostic', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Pista</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <!-- Pitch sin elemento step -->
        <pitch><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
      <!-- Nota válida subsiguiente -->
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    const notes = result.payload.getAllNotes();
    // La nota sin step NO se inventa como 'C'; solo se añade la nota válida G4
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0]?.pitch.noteName.toString(), 'G');
    assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_PITCH_STEP'));
  });

  it('B2.6: Missing octave does NOT invent octave 4 and emits diagnostic', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Pista</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <!-- Pitch sin elemento octave -->
        <pitch><step>E</step></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    const notes = result.payload.getAllNotes();
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0]?.pitch.noteName.toString(), 'D');
    assert.strictEqual(notes[0]?.pitch.octave, 5);
    assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_PITCH_OCTAVE'));
  });

  it('B2.7: Missing duration does NOT invent 1-tick duration and emits diagnostic', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Pista</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <!-- Falta elemento duration -->
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    const notes = result.payload.getAllNotes();
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0]?.pitch.noteName.toString(), 'F');
    assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_NOTE_DURATION'));
  });

  it('B2.8: Invalid pitch step (e.g. "X") is rejected without fabricating "C"', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Pista</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>X</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'INVALID_PITCH_STEP'));
  });

  it('B2.9: Invalid duration (<= 0) is rejected without fabricating 1 tick', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Pista</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>0</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.getAllNotes().length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'INVALID_NOTE_DURATION'));
  });

  it('B2.10: Partially invalid score preserves all valid content without discarding the piece', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Violín</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <!-- Nota 1 válida -->
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <!-- Nota 2 defectuosa (sin pitch) -->
      <note><duration>1</duration><voice>1</voice></note>
      <!-- Nota 3 defectuosa (sin duración) -->
      <note><pitch><step>E</step><octave>4</octave></pitch><voice>1</voice></note>
      <!-- Nota 4 válida -->
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const result = importer.import(xml);
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    const notes = result.payload.getAllNotes();
    // Se preservan las dos notas válidas (C4 y G4)
    assert.strictEqual(notes.length, 2);
    assert.strictEqual(notes[0]?.pitch.noteName.toString(), 'C');
    assert.strictEqual(notes[1]?.pitch.noteName.toString(), 'G');
    // Se emitieron los diagnósticos de los eventos omitidos
    assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_PITCH'));
    assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_NOTE_DURATION'));
  });
});

describe('Phase 1B-R3.1 — Workstream B3: Canonical Model & Rendering Integrity', () => {
  it('B3.1: Null key and null timeSignature survive domain validation without throwing', () => {
    const measure = new Measure({
      number: 1,
      timeSignature: null,
      keySignature: null,
      startTick: 0,
      durationTicks: 1920,
    });

    const timeline = new Timeline({
      totalDurationTicks: 1920,
      measureCount: 1,
      tempoMap: new TempoMap([]),
      isUnmetered: true,
    });

    const payload = new CanonicalMusicPayload({
      title: 'Valid Unmetered Work',
      timeline,
      measures: [measure],
      sections: [],
      instrumentTracks: [],
    });

    const validation = CanonicalModelValidator.validate(payload);
    assert.strictEqual(validation.isValid, true, 'El validador canónico debe admitir timeSignature=null y keySignature=null');
  });

  it('B3.2: Unresolved tempoMap produces null totalDurationSeconds on Timeline', () => {
    const timeline = new Timeline({
      totalDurationTicks: 3840,
      measureCount: 2,
      tempoMap: new TempoMap([]), // sin eventos de tempo
      isUnmetered: false,
    });

    assert.strictEqual(timeline.tempoMap.isUnresolved, true);
    assert.strictEqual(timeline.totalDurationSeconds, null, 'No debe sintetizarse duración temporal con 120 BPM');
  });

  it('B3.3: LeadSheetDomAdapter renders unmetered presentation fallback without mutating canonical data', () => {
    const measure = new Measure({
      number: 1,
      timeSignature: null,
      keySignature: null,
      startTick: 0,
      durationTicks: 960,
    });

    const timeline = new Timeline({
      totalDurationTicks: 960,
      measureCount: 1,
      tempoMap: new TempoMap([]),
      isUnmetered: true,
    });

    const payload = new CanonicalMusicPayload({
      title: 'Atril Unmetered LeadSheet',
      timeline,
      measures: [measure],
      sections: [],
      instrumentTracks: [],
    });

    const instruments = new InstrumentRegistry();
    const vocal = instruments.getOrThrow('lead_vocal');
    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS', 'SECTION_MARKERS'],
    });

    const view = ProjectionService.project(payload, vocal, pref).view!;
    assert.ok(view);

    // En la vista proyectada se preserva timeSignature = null
    assert.strictEqual(view.measures[0]?.timeSignature, null);

    // El adaptador renderiza sin mutar el payload canónico
    const adapter = new LeadSheetDomAdapter();
    const result = adapter.render(view);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.sections[0]?.measures[0]?.timeSignature, '—'); // Fallback visual de guión largo sin alterar el modelo

    // Verificación de cero mutación en el payload original
    assert.strictEqual(payload.measures[0]?.timeSignature, null);
    assert.strictEqual(payload.timeline.isUnmetered, true);
  });
});
