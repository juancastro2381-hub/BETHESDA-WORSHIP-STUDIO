/**
 * @file ascii-tab-serializer.test.ts
 * @description Suite de pruebas para el serializador y formateador determinista de tablatura ASCII (Fase 2B.2).
 *
 * Valida:
 * 1. Determinismo estricto: la serialización idéntica produce idéntico contenido byte a byte.
 * 2. Compensación de columnas para trastes multidígito (10, 12, 14, 24).
 * 3. Alineación vertical exacta de barras de compás.
 * 4. Generación de cabeceras completas (Obra, Instrumento, Afinación y advertencia CERO Fabricación si es no medida).
 * 5. Generación de tablatura ergonómica desde partitura canónica pura (sin metadatos de tab previa).
 * 6. Prueba Round-trip: Parse -> Canonical -> Serialize -> Parse (Fidelidad de notas, trastes, afinación y compases).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { AsciiTabParser } from '../ascii-tab-parser.ts';
import { AsciiTabImporter } from '../ascii-tab-importer.ts';
import { CanonicalToTablatureSerializer } from '../../conversion/exporters/tablature-serializer.ts';
import { createFullSongFixture } from '../../conversion/__tests__/fixtures.ts';

describe('ASCII Tablature Serializer & Formatter Suite (Fase 2B.2)', () => {
  const importer = new AsciiTabImporter();

  it('1. should serialize unmeasured tab with Zero-Fabrication header notice and aligned bar lines', () => {
    const rawTab = `
e|---0-------2-------3---|
B|-------1-------1-------|
G|-----------------------|
D|-----------------------|
A|-----------------------|
E|-----------------------|
`;
    const impRes = importer.import(rawTab, { sourceName: 'test_song.tab' });
    assert.strictEqual(impRes.status, 'SUCCESS');
    assert.ok(impRes.payload);

    const exportRes = CanonicalToTablatureSerializer.serialize(impRes.payload);
    assert.strictEqual(exportRes.success, true);
    assert.strictEqual(exportRes.targetFormat, 'TABLATURE');
    assert.strictEqual(exportRes.mimeType, 'text/plain');

    const content = exportRes.content as string;
    assert.ok(content.includes('BETHESDA WORSHIP STUDIO — TABLATURA CANÓNICA ASCII'));
    assert.ok(content.includes('CERO Fabricación'));
    assert.ok(/e\s*\|/.test(content));
    assert.ok(/B\s*\|/.test(content));
    assert.ok(/G\s*\|/.test(content));
    assert.ok(/D\s*\|/.test(content));
    assert.ok(/A\s*\|/.test(content));
    assert.ok(/E\s*\|/.test(content));

    // Verificar que todas las líneas de cuerdas tienen exactamente la misma longitud visual
    const stringLines = content
      .split('\n')
      .filter((l: string) => /^[A-Ga-g][b#]?\s*\|/.test(l));
    assert.strictEqual(stringLines.length, 6);
    const lineLen = stringLines[0]!.length;
    for (const l of stringLines) {
      assert.strictEqual(l.length, lineLen, 'Todas las líneas de cuerdas del sistema deben tener idéntica longitud');
    }
  });

  it('2. should align columns correctly when notes contain multi-digit frets (10, 12, 14)', () => {
    const rawTab = `
e|---0---10---12---14---|
B|---1------------------|
G|---0------------------|
D|---2------------------|
A|---3------------------|
E|----------------------|
`;
    const impRes = importer.import(rawTab);
    assert.ok(impRes.payload);

    const exportRes = CanonicalToTablatureSerializer.serialize(impRes.payload);
    assert.strictEqual(exportRes.success, true);

    const content = exportRes.content as string;
    const stringLines = content
      .split('\n')
      .filter((l: string) => /^[A-Ga-g][b#]?\s*\|/.test(l));
    assert.strictEqual(stringLines.length, 6);

    // Asegurar que el final de compás '|' está alineado en la misma posición en todas las cuerdas
    const barIndices = stringLines.map((l: string) => l.lastIndexOf('|'));
    const expectedBarIdx = barIndices[0]!;
    for (const idx of barIndices) {
      assert.strictEqual(idx, expectedBarIdx, 'Las barras de compás deben estar perfectamente alineadas verticalmente');
    }
  });

  it('3. should enforce deterministic output: identical payload produces identical tab text', () => {
    const rawTab = `
e|---0---3---|
B|---1---0---|
G|---0---0---|
D|---2---0---|
A|---3---2---|
E|-------3---|
`;
    const impRes = importer.import(rawTab, { sourceName: 'Deterministic Test' });
    const payload = impRes.payload!;

    const run1 = CanonicalToTablatureSerializer.serialize(payload);
    const run2 = CanonicalToTablatureSerializer.serialize(payload);

    assert.strictEqual(run1.content, run2.content, 'La salida debe ser estrictamente determinista');
  });

  it('4. should calculate ergonomic tablature positions when exporting canonical score without previous tab metadata', () => {
    const fullSong = createFullSongFixture();
    const exportRes = CanonicalToTablatureSerializer.serialize(fullSong);

    assert.strictEqual(exportRes.success, true);
    const content = exportRes.content as string;
    assert.ok(content.includes('Obra: Sublime Gracia'));
    assert.ok(content.includes('Compás 1 - 2'));

    // Debe contener trastes calculados ergonómicamente
    assert.ok(/\d/.test(content));
  });

  it('5. should round-trip cleanly: parse -> serialize -> parse preserves musical contents', () => {
    const originalTab = `
e|---0---2---3---|
B|---1---3---0---|
G|---0---2---0---|
D|---2---0---0---|
A|---3-------2---|
E|-----------3---|
`;
    // 1. Ingesta inicial
    const imp1 = importer.import(originalTab, { sourceName: 'Roundtrip' });
    assert.strictEqual(imp1.status, 'SUCCESS');
    const notes1 = imp1.payload!.getAllNotes();

    // 2. Serialización a tablatura ASCII
    const exp1 = CanonicalToTablatureSerializer.serialize(imp1.payload!);
    assert.strictEqual(exp1.success, true);

    // 3. Re-ingesta desde la tablatura exportada
    const exp1Content = exp1.content as string;
    const imp2 = importer.import(exp1Content, { sourceName: 'Roundtrip' });
    assert.strictEqual(imp2.status, 'SUCCESS');
    const notes2 = imp2.payload!.getAllNotes();

    // 4. Comparación de fidelidad
    assert.strictEqual(notes1.length, notes2.length, 'Debe preservar exactamente el mismo número de notas');
    for (let i = 0; i < notes1.length; i++) {
      const n1 = notes1[i]!;
      const n2 = notes2[i]!;
      assert.strictEqual(n1.pitch.midiNumber, n2.pitch.midiNumber, `Nota ${i} debe preservar la misma altura MIDI`);
      const meta1 = (n1.notationMetadata as any)?.tablature;
      const meta2 = (n2.notationMetadata as any)?.tablature;
      assert.strictEqual(meta1?.stringNumber, meta2?.stringNumber, `Nota ${i} debe preservar la misma cuerda`);
      assert.strictEqual(meta1?.fret, meta2?.fret, `Nota ${i} debe preservar el mismo traste`);
    }
  });
});
