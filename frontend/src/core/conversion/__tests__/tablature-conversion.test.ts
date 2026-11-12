/**
 * @file tablature-conversion.test.ts
 * @description Suite de pruebas de integración para el pipeline de conversión de tablatura (Fase 2B.2).
 *
 * Valida:
 * 1. Conversión de archivo .tab hacia TABLATURE (reformateado canónico).
 * 2. Conversión de archivo .tab hacia CHORD_PRO.
 * 3. Conversión de archivo .tab hacia LYRICS_ONLY.
 * 4. Conversión de archivo .tab hacia MUSIC_XML (con y sin timing explícito).
 * 5. Principio de CERO Fabricación: Bloqueo estricto Fail-Closed de exportación MIDI para tablatura no medida (BLOCKED_ZERO_FABRICATION).
 * 6. Exportación MIDI exitosa cuando la tablatura contiene métrica y ritmo explícitos válidos.
 * 7. Ingesta a través de UnifiedMusicImporter con detección automática de formato TABLATURE.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ConversionEngine } from '../conversion-engine.ts';
import { UnifiedMusicImporter } from '../../ingestion/unified-importer.ts';
import { MidiExportGatekeeper } from '../../canonical-model/midi-export-gatekeeper.ts';
import { AsciiTabImporter } from '../../tablature/ascii-tab-importer.ts';

describe('Tablature Conversion Pipeline & MIDI Gatekeeper Suite (Fase 2B.2)', () => {
  const engine = new ConversionEngine();

  const unmeasuredTabSource = `
e|---0-------2-------3---|
B|-------1-------1-------|
G|-----------------------|
D|-----------------------|
A|-----------------------|
E|-----------------------|
`;

  const measuredTabSource = `
   q   q   h
e|---0---2---3---|
B|---1---3---0---|
G|---0---2---0---|
D|---2---0---0---|
A|---3-------2---|
E|-----------3---|
`;

  // --------------------------------------------------------------------------
  // 1. CONVERSIÓN HACIA TABLATURE (REFORMATEO)
  // --------------------------------------------------------------------------
  it('1. should convert raw .tab source to canonical ASCII tab format', () => {
    const res = engine.convertSource(unmeasuredTabSource, 'acordes.tab', {
      targetFormat: 'TABLATURE',
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.targetFormat, 'TABLATURE');
    assert.strictEqual(res.mimeType, 'text/plain');
    assert.ok(typeof res.content === 'string');
    assert.ok(res.content.includes('BETHESDA WORSHIP STUDIO — TABLATURA CANÓNICA ASCII'));
    assert.ok(res.content.includes('CERO Fabricación'));
  });

  // --------------------------------------------------------------------------
  // 2. CONVERSIÓN HACIA CHORD_PRO
  // --------------------------------------------------------------------------
  it('2. should convert .tab source to ChordPro representation', () => {
    const res = engine.convertSource(measuredTabSource, 'alabanza.tab', {
      targetFormat: 'CHORD_PRO',
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.targetFormat, 'CHORD_PRO');
    assert.ok(typeof res.content === 'string');
  });

  // --------------------------------------------------------------------------
  // 3. CONVERSIÓN HACIA LYRICS_ONLY (RECHAZO CERO FABRICACIÓN)
  // --------------------------------------------------------------------------
  it('3. should reject converting instrumental tab source to lyrics document (Zero Fabrication)', () => {
    const res = engine.convertSource(unmeasuredTabSource, 'himno.tab', {
      targetFormat: 'LYRICS_ONLY',
    });

    assert.strictEqual(res.success, false, 'Obra puramente instrumental sin letra debe rechazar exportación a solo letra');
    assert.strictEqual(res.targetFormat, 'LYRICS_ONLY');
    assert.ok(res.diagnostics.some((d) => d.code === 'LYRICS_NO_VOCAL_CONTENT'));
  });

  // --------------------------------------------------------------------------
  // 4. CONVERSIÓN HACIA MUSIC_XML
  // --------------------------------------------------------------------------
  it('4. should convert .tab source to valid MusicXML score', () => {
    const res = engine.convertSource(measuredTabSource, 'solo.tab', {
      targetFormat: 'MUSIC_XML',
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.targetFormat, 'MUSIC_XML');
    assert.ok(typeof res.content === 'string');
    assert.ok(res.content.includes('<?xml version="1.0"'));
    assert.ok(res.content.includes('<score-partwise'));
  });

  // --------------------------------------------------------------------------
  // 5. FAIL-CLOSED MIDI EXPORT FOR UNMEASURED TAB (BLOCKED_ZERO_FABRICATION)
  // --------------------------------------------------------------------------
  it('5. should STRICTLY BLOCK MIDI export from unmeasured tab (BLOCKED_ZERO_FABRICATION)', () => {
    const res = engine.convertSource(unmeasuredTabSource, 'unmeasured.tab', {
      targetFormat: 'MIDI',
    });

    assert.strictEqual(res.success, false, 'La exportación MIDI debe fallar para tablatura sin ritmo medido');
    assert.strictEqual(res.content.length, 0);

    // Debe registrar diagnóstico explicativo Fail-Closed
    const gateDiagnostic = res.diagnostics.find(
      (d) =>
        d.code === 'BLOCKED_ZERO_FABRICATION' ||
        d.code === 'MIDI_EXPORT_INELIGIBLE' ||
        d.code === 'MIDI_INVALID_NOTE_TIMING'
    );
    assert.ok(gateDiagnostic, 'Debe registrar diagnóstico de bloqueo de exportación MIDI');
    assert.strictEqual(gateDiagnostic.severity, 'ERROR');

    // Verificar directamente con el Guardián Multi-Factor
    const tabImporter = new AsciiTabImporter();
    const impRes = tabImporter.import(unmeasuredTabSource);
    assert.ok(impRes.payload);
    const gateCheck = MidiExportGatekeeper.isEligible(impRes.payload);
    assert.strictEqual(gateCheck.eligible, false);
    assert.strictEqual(gateCheck.code, 'BLOCKED_ZERO_FABRICATION');
  });

  // --------------------------------------------------------------------------
  // 6. PERMITTED MIDI EXPORT FOR EXPLICITLY TIMED TAB
  // --------------------------------------------------------------------------
  it('6. should ALLOW MIDI export when tablature includes explicit valid rhythm track', () => {
    const tabImporter = new AsciiTabImporter();
    const impRes = tabImporter.import(measuredTabSource);
    assert.ok(impRes.payload);

    // El guardián debe certificar elegibilidad completa
    const gateCheck = MidiExportGatekeeper.isEligible(impRes.payload);
    assert.strictEqual(gateCheck.eligible, true, 'Debe ser elegible al tener métrica y timing explícito');

    // Conversión debe completarse y emitir archivo Standard MIDI File Format 1
    const res = engine.convertSource(measuredTabSource, 'measured.tab', {
      targetFormat: 'MIDI',
    });

    assert.strictEqual(res.success, true, 'Debe exportar MIDI exitosamente');
    assert.strictEqual(res.targetFormat, 'MIDI');
    assert.strictEqual(res.mimeType, 'audio/midi');
    assert.ok(res.content instanceof Uint8Array);
    assert.ok(res.content.length > 30);

    // Verificar cabecera 'MThd'
    assert.strictEqual(res.content[0], 0x4d); // M
    assert.strictEqual(res.content[1], 0x54); // T
    assert.strictEqual(res.content[2], 0x68); // h
    assert.strictEqual(res.content[3], 0x64); // d
  });

  // --------------------------------------------------------------------------
  // 7. UNIFIED MUSIC IMPORTER INTEGRATION
  // --------------------------------------------------------------------------
  it('7. should correctly recognize and import .tab files via UnifiedMusicImporter', () => {
    const unified = new UnifiedMusicImporter();
    const res = unified.import(measuredTabSource, 'guitar_solo.tab');

    assert.strictEqual(res.status, 'SUCCESS');
    assert.strictEqual(res.provenance.sourceFormat, 'TABLATURE');
    assert.ok(res.payload);
    assert.strictEqual(res.payload.measures.length, 1);
    assert.strictEqual(res.payload.getAllNotes().length, 15);
  });
});
