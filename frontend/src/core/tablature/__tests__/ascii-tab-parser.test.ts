/**
 * @file ascii-tab-parser.test.ts
 * @description Suite de pruebas exhaustiva para el motor de parsing e ingesta de tablatura ASCII (Fase 2B.2).
 *
 * Cubre:
 * 1. Guitarra Afinación Estándar 6 cuerdas (E B G D A E)
 * 2. Guitarra Drop D (D B G D A D)
 * 3. Guitarra DADGAD
 * 4. Guitarra Eb (Medio tono abajo: Eb Bb Gb Db Ab Eb)
 * 5. Bajo 4 cuerdas Estándar (G D A E)
 * 6. Bajo 4 cuerdas Drop D (G D A D)
 * 7. Bajo 5 cuerdas Estándar (G D A E B)
 * 8. Guitarra 7 cuerdas Estándar (E B G D A E B)
 * 9. Cuerdas al aire (0) y trastes multidígito (10, 12, 14, 24)
 * 10. Acordes simultáneos y alineación vertical
 * 11. Articulaciones y ornamentos: slides (/, \), bends (b, r), hammer-on/pull-off (h, p), vibrato (~), armónicos (<12>, *12*), palm mute (PM)
 * 12. Cuerdas muteadas / ghost notes (x, X)
 * 13. Validación de límites físicos: Traste > 30 rechazado con diagnóstico
 * 14. Afinaciones ambiguas o contradictorias
 * 15. Principio de CERO Fabricación: notas no medidas con startTick === null y durationTicks === null
 * 16. Preservación de coordenadas visuales en metadatos canónicos
 * 17. Anotaciones rítmicas explícitas (w, h, q, e, s)
 * 18. Límite de tamaño DoS (> 1MB rechazado)
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { AsciiTabParser } from '../ascii-tab-parser.ts';
import { AsciiTabImporter } from '../ascii-tab-importer.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { TabInstrumentConfig } from '../tab-instrument-config.ts';

describe('ASCII Tablature Parser & Ingestion Engine Suite (Fase 2B.2)', () => {
  const importer = new AsciiTabImporter();

  // --------------------------------------------------------------------------
  // 1. GUITARRA 6 CUERDAS ESTÁNDAR
  // --------------------------------------------------------------------------
  it('1. should parse 6-string guitar standard tuning with correct pitches and string order', () => {
    const tab = `
e|-------0-------|
B|-------1-------|
G|-------0-------|
D|-------2-------|
A|-------3-------|
E|---------------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.instrument, 'GUITAR');
    assert.strictEqual(parsed.tuningName.includes('Estándar'), true);
    assert.strictEqual(parsed.stringCount, 6);
    assert.strictEqual(parsed.measures.length, 1);

    const m = parsed.measures[0]!;
    assert.strictEqual(m.columns.length, 1);
    assert.strictEqual(m.columns[0]!.entries.length, 5); // C chord: 5 strings

    // Probar ingesta canónica
    const res = importer.import(tab, { sourceName: 'c_major.tab' });
    assert.strictEqual(res.status, 'SUCCESS');
    assert.ok(res.payload);
    const notes = res.payload.getAllNotes();
    assert.strictEqual(notes.length, 5);

    // Corde C Mayor: A(3)=C3, D(2)=E3, G(0)=G3, B(1)=C4, e(0)=E4
    const notePitches = notes.map((n) => n.pitch.toString());
    assert.ok(notePitches.includes('C3'));
    assert.ok(notePitches.includes('E3'));
    assert.ok(notePitches.includes('G3'));
    assert.ok(notePitches.includes('C4'));
    assert.ok(notePitches.includes('E4'));
  });

  // --------------------------------------------------------------------------
  // 2. GUITARRA DROP D
  // --------------------------------------------------------------------------
  it('2. should parse Guitar Drop D tuning and lower 6th string to D2', () => {
    const tab = `
e|---------------|
B|---------------|
G|---------------|
D|---0-----------|
A|---0-----------|
D|---0-----------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.tuningName.includes('Drop D'), true);
    assert.strictEqual(parsed.stringLabels[5], 'D');

    const res = importer.import(tab);
    assert.strictEqual(res.status, 'SUCCESS');
    assert.ok(res.payload);
    const notes = res.payload.getAllNotes();
    assert.strictEqual(notes.length, 3);

    // 6th string D2, 5th string A2, 4th string D3
    const sixthStringNote = notes.find(
      (n) => (n.notationMetadata as any)?.tablature?.stringNumber === 6
    );
    assert.ok(sixthStringNote);
    assert.strictEqual(sixthStringNote.pitch.noteName, NoteName.D);
    assert.strictEqual(sixthStringNote.pitch.octave, 2); // D2
  });

  // --------------------------------------------------------------------------
  // 3. GUITARRA DADGAD
  // --------------------------------------------------------------------------
  it('3. should parse Guitar DADGAD tuning correctly', () => {
    const tab = `
D|---0-----------|
A|---0-----------|
G|---0-----------|
D|---0-----------|
A|---0-----------|
D|---0-----------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.tuningName.includes('DADGAD'), true);
    assert.deepStrictEqual(
      parsed.stringLabels.map((s) => s.toUpperCase()),
      ['D', 'A', 'G', 'D', 'A', 'D']
    );
  });

  // --------------------------------------------------------------------------
  // 4. GUITARRA MEDIO TONO ABAJO (Eb / Half-step down)
  // --------------------------------------------------------------------------
  it('4. should parse Guitar Eb half-step down tuning correctly', () => {
    const tab = `
Eb|---0-----------|
Bb|---0-----------|
Gb|---0-----------|
Db|---0-----------|
Ab|---0-----------|
Eb|---0-----------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.tuningName.includes('Eb'), true);
    assert.strictEqual(parsed.stringCount, 6);
  });

  // --------------------------------------------------------------------------
  // 5. BAJO 4 CUERDAS ESTÁNDAR
  // --------------------------------------------------------------------------
  it('5. should parse 4-string bass standard tuning (G D A E)', () => {
    const tab = `
G|---------------|
D|-------2-------|
A|---0-----------|
E|---------------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.instrument, 'BASS');
    assert.strictEqual(parsed.stringCount, 4);

    const res = importer.import(tab);
    assert.strictEqual(res.status, 'SUCCESS');
    assert.ok(res.payload);
    assert.strictEqual(res.payload.instrumentTracks[0]?.family, 'BASS');

    const notes = res.payload.getAllNotes();
    // A cuerda 3 al aire = A1 (MIDI 33)
    const aNote = notes.find((n) => (n.notationMetadata as any)?.tablature?.stringNumber === 3);
    assert.ok(aNote);
    assert.strictEqual(aNote.pitch.noteName, NoteName.A);
    assert.strictEqual(aNote.pitch.octave, 1);
  });

  // --------------------------------------------------------------------------
  // 6. BAJO 4 CUERDAS DROP D
  // --------------------------------------------------------------------------
  it('6. should parse 4-string bass Drop D tuning (G D A D)', () => {
    const tab = `
G|---------------|
D|---------------|
A|---------------|
D|---0-----------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.instrument, 'BASS');
    assert.strictEqual(parsed.tuningName.includes('Drop D'), true);

    const res = importer.import(tab);
    assert.ok(res.payload);
    const lowD = res.payload.getAllNotes()[0]!;
    assert.strictEqual(lowD.pitch.noteName, NoteName.D);
    assert.strictEqual(lowD.pitch.octave, 1); // D1 (MIDI 26)
  });

  // --------------------------------------------------------------------------
  // 7. BAJO 5 CUERDAS ESTÁNDAR
  // --------------------------------------------------------------------------
  it('7. should parse 5-string bass standard tuning (G D A E B)', () => {
    const tab = `
G|---------------|
D|---------------|
A|---------------|
E|---------------|
B|---1-----------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.instrument, 'BASS');
    assert.strictEqual(parsed.stringCount, 5);

    const res = importer.import(tab);
    assert.ok(res.payload);
    const lowC = res.payload.getAllNotes()[0]!;
    // B0 + 1 traste = C1 (MIDI 24)
    assert.strictEqual(lowC.pitch.noteName, NoteName.C);
    assert.strictEqual(lowC.pitch.octave, 1);
  });

  // --------------------------------------------------------------------------
  // 8. GUITARRA 7 CUERDAS ESTÁNDAR
  // --------------------------------------------------------------------------
  it('8. should parse 7-string guitar standard tuning (E B G D A E B)', () => {
    const tab = `
e|---------------|
B|---------------|
G|---------------|
D|---------------|
A|---------------|
E|---------------|
B|---0-----------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.instrument, 'GUITAR');
    assert.strictEqual(parsed.stringCount, 7);

    const res = importer.import(tab);
    assert.ok(res.payload);
    const lowB = res.payload.getAllNotes()[0]!;
    // Cuerda 7 B al aire = B1 (MIDI 35)
    assert.strictEqual(lowB.pitch.noteName, NoteName.B);
    assert.strictEqual(lowB.pitch.octave, 1);
  });

  // --------------------------------------------------------------------------
  // 9. CUERDAS AL AIRE Y TRASTES MULTIDÍGITO (10, 12, 14, 24)
  // --------------------------------------------------------------------------
  it('9. should correctly parse multi-digit frets (10, 12, 14, 24) without splitting into 1 and 0', () => {
    const tab = `
e|---10---12---14---24---|
B|-----------------------|
G|-----------------------|
D|-----------------------|
A|-----------------------|
E|-----------------------|
`;
    const parsed = AsciiTabParser.parse(tab);
    const m = parsed.measures[0]!;
    assert.strictEqual(m.columns.length, 4);

    const frets = m.columns.map((c) => c.entries[0]!.fret);
    assert.deepStrictEqual(frets, [10, 12, 14, 24]);

    const res = importer.import(tab);
    const notes = res.payload!.getAllNotes();
    assert.strictEqual(notes.length, 4);

    // e (E4 = 64) + 24 = E6 (MIDI 88)
    const highestNote = notes[3]!;
    assert.strictEqual(highestNote.pitch.noteName, NoteName.E);
    assert.strictEqual(highestNote.pitch.octave, 6);
  });

  // --------------------------------------------------------------------------
  // 10. ACORDES SIMULTÁNEOS VERTICALES
  // --------------------------------------------------------------------------
  it('10. should cluster simultaneous notes on multiple strings into vertical chord steps', () => {
    const tab = `
e|---0---3---|
B|---1---0---|
G|---0---0---|
D|---2---0---|
A|---3---2---|
E|-------3---|
`;
    const parsed = AsciiTabParser.parse(tab);
    const m = parsed.measures[0]!;
    assert.strictEqual(m.columns.length, 2);
    assert.strictEqual(m.columns[0]!.entries.length, 5); // C
    assert.strictEqual(m.columns[1]!.entries.length, 6); // G

    const res = importer.import(tab);
    assert.strictEqual(res.status, 'SUCCESS');
    // Cada acorde debe agrupar sus notas bajo el mismo chordId
    const notes = res.payload!.getAllNotes();
    const chord1Notes = notes.filter(
      (n) => (n.notationMetadata as any)?.tablature?.visualColumnIndex === m.columns[0]!.visualColumnIndex
    );
    assert.strictEqual(chord1Notes.length, 5);
    const chordId0 = (chord1Notes[0]!.notationMetadata as any)?.tablature?.chordId;
    assert.ok(chordId0);
    assert.strictEqual(chord1Notes.every((n) => (n.notationMetadata as any)?.tablature?.chordId === chordId0), true);
  });

  // --------------------------------------------------------------------------
  // 11. ARTICULACIONES Y ORNAMENTOS (/, \, b, r, h, p, ~, <12>, *12*, PM)
  // --------------------------------------------------------------------------
  it('11. should parse articulations: slides, bends, hammer/pull, vibrato, harmonics, and palm mute', () => {
    const tab = `
e|---7/9---9\\7---7h9---9p7---7b9---9r7---7~---<12>---*12*---|
B|-----------------------------------------------------------|
G|-----------------------------------------------------------|
D|-----------------------------------------------------------|
A|-----------------------------------------------------------|
E|-----------------------------------------------------------|
`;
    const parsed = AsciiTabParser.parse(tab);
    const m = parsed.measures[0]!;
    assert.strictEqual(m.columns.length, 15);

    assert.strictEqual(m.columns[0]!.entries[0]!.articulation, 'SLIDE_UP');
    assert.strictEqual(m.columns[2]!.entries[0]!.articulation, 'SLIDE_DOWN');
    assert.strictEqual(m.columns[4]!.entries[0]!.articulation, 'HAMMER_ON');
    assert.strictEqual(m.columns[6]!.entries[0]!.articulation, 'PULL_OFF');
    assert.strictEqual(m.columns[8]!.entries[0]!.articulation, 'BEND');
    assert.strictEqual(m.columns[10]!.entries[0]!.articulation, 'BEND_RELEASE');
    assert.strictEqual(m.columns[12]!.entries[0]!.articulation, 'VIBRATO');
    assert.strictEqual(m.columns[13]!.entries[0]!.articulation, 'NATURAL_HARMONIC');
    assert.strictEqual(m.columns[14]!.entries[0]!.articulation, 'ARTIFICIAL_HARMONIC');
  });

  // --------------------------------------------------------------------------
  // 12. CUERDAS MUTEADAS / GHOST NOTES (x, X)
  // --------------------------------------------------------------------------
  it('12. should identify muted strings (x, X) as percussive dead notes without pitch error', () => {
    const tab = `
e|---x---|
B|---x---|
G|---X---|
D|---x---|
A|---x---|
E|---x---|
`;
    const parsed = AsciiTabParser.parse(tab);
    const col = parsed.measures[0]!.columns[0]!;
    assert.strictEqual(col.entries.every((e) => e.isMuted), true);

    const res = importer.import(tab);
    assert.strictEqual(res.status, 'SUCCESS');
    const notes = res.payload!.getAllNotes();
    assert.strictEqual(notes.every((n) => (n.notationMetadata as any)?.tablature?.isMuted), true);
  });

  // --------------------------------------------------------------------------
  // 13. LÍMITES FÍSICOS: TRASTE > 30 RECHAZADO CON DIAGNÓSTICO
  // --------------------------------------------------------------------------
  it('13. should produce WARNING diagnostic and clamp or skip impossible fret (> 30)', () => {
    const tab = `
e|---35---|
B|--------|
G|--------|
D|--------|
A|--------|
E|--------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.ok(parsed.diagnostics.some((d) => d.code === 'INVALID_FRET'));

    const res = importer.import(tab);
    assert.ok(res.diagnostics.some((d) => d.code === 'INVALID_FRET'));
  });

  // --------------------------------------------------------------------------
  // 14. AFINACIÓN AMBIGUA O CONTRADICTORIA
  // --------------------------------------------------------------------------
  it('14. should flag contradictory or ambiguous tunings with DIAGNOSTIC_WARNING', () => {
    // 4 cuerdas con afinación irreconocible
    const tab = `
Q|---0---|
Z|---1---|
W|---2---|
?|---3---|
`;
    const res = importer.import(tab);
    assert.ok(
      res.diagnostics.some(
        (d) =>
          d.code === 'AMBIGUOUS_OR_INVALID_TUNING' ||
          d.code === 'TAB_PARSER_ERROR' ||
          d.code === 'UNKNOWN_TAB_TUNING'
      )
    );
  });

  // --------------------------------------------------------------------------
  // 15. PRINCIPIO DE CERO FABRICACIÓN: TABLATURA NO MEDIDA (startTick: null)
  // --------------------------------------------------------------------------
  it('15. should preserve unmeasured tab notes with startTick === null and durationTicks === null', () => {
    const tab = `
e|---0-------2-------3-------|
B|-------1-------1-------0---|
G|---------------------------|
D|---------------------------|
A|---------------------------|
E|---------------------------|
`;
    const res = importer.import(tab);
    assert.strictEqual(res.status, 'SUCCESS');
    assert.ok(res.payload);

    // Métrica debe ser NONE y Timeline isUnmetered
    assert.strictEqual(res.payload.timeline.isUnmetered, true);
    assert.strictEqual(
      (res.payload.metadata as any)?.rhythmicProvenance,
      'NONE'
    );

    const notes = res.payload.getAllNotes();
    for (const note of notes) {
      assert.strictEqual(note.startTick, null, 'startTick debe ser estrictamente null');
      assert.strictEqual(note.durationTicks, null, 'durationTicks debe ser estrictamente null');
    }
  });

  // --------------------------------------------------------------------------
  // 16. PRESERVACIÓN DE COORDENADAS VISUALES
  // --------------------------------------------------------------------------
  it('16. should preserve stringNumber, fret, and visualColumnIndex in notationMetadata', () => {
    const tab = `
e|---5---|
B|-------|
G|-------|
D|-------|
A|-------|
E|-------|
`;
    const res = importer.import(tab);
    const note = res.payload!.getAllNotes()[0]!;
    const tabMeta = (note.notationMetadata as any)?.tablature;
    assert.ok(tabMeta);
    assert.strictEqual(tabMeta.stringNumber, 1);
    assert.strictEqual(tabMeta.fret, 5);
    assert.strictEqual(typeof tabMeta.visualColumnIndex, 'number');
  });

  // --------------------------------------------------------------------------
  // 17. ANOTACIONES RÍTMICAS EXPLÍCITAS (w, h, q, e, s)
  // --------------------------------------------------------------------------
  it('17. should assign explicit durations and startTicks when rhythm track is provided', () => {
    const tab = `
   q   q   h
e|---0---1---3---|
B|---1---3---0---|
G|---0---2---0---|
D|---------------|
A|---------------|
E|---------------|
`;
    const parsed = AsciiTabParser.parse(tab);
    assert.strictEqual(parsed.rhythmicProvenance, 'EXPLICIT_HEADER');

    const res = importer.import(tab);
    assert.strictEqual(res.status, 'SUCCESS');
    assert.strictEqual(res.payload!.timeline.isUnmetered, false);

    const notes = res.payload!.getAllNotes();
    // Primer paso (q = 480 ticks)
    const firstColNotes = notes.filter((n) => n.startTick === 0);
    assert.strictEqual(firstColNotes.length, 3);
    assert.strictEqual(firstColNotes[0]!.durationTicks, 480);

    // Segundo paso (q = 480 ticks en tick 480)
    const secondColNotes = notes.filter((n) => n.startTick === 480);
    assert.strictEqual(secondColNotes.length, 3);
    assert.strictEqual(secondColNotes[0]!.durationTicks, 480);

    // Tercer paso (h = 960 ticks en tick 960)
    const thirdColNotes = notes.filter((n) => n.startTick === 960);
    assert.strictEqual(thirdColNotes.length, 3);
    assert.strictEqual(thirdColNotes[0]!.durationTicks, 960);
  });

  // --------------------------------------------------------------------------
  // 18. LÍMITE DE TAMAÑO DOS (> 1MB RECHAZADO)
  // --------------------------------------------------------------------------
  it('18. should reject input exceeding 1MB bounded memory limit', () => {
    const hugeTab = 'e|---0---|\n'.repeat(120000); // ~1.2 MB
    const res = importer.import(hugeTab);
    assert.strictEqual(res.status, 'FAILED');
    assert.ok(res.diagnostics.some((d) => d.code === 'INPUT_TOO_LARGE'));
  });
});
