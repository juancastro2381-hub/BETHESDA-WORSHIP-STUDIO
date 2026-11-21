/**
 * @file musicxml-serializer.test.ts
 * @description Pruebas unitarias para CanonicalToMusicXmlSerializer (Fase 2A).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalToMusicXmlSerializer } from '../exporters/musicxml-serializer.ts';
import {
  createChordsAndLyricsOnlyFixture,
  createFullSongFixture,
  createInstrumentalFixture,
} from './fixtures.ts';

describe('CanonicalToMusicXmlSerializer Tests', () => {
  it('should serialize full canonical song to valid MusicXML 4.0 partwise document', () => {
    const payload = createFullSongFixture();
    const result = CanonicalToMusicXmlSerializer.serialize(payload);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.targetFormat, 'MUSIC_XML');
    assert.strictEqual(result.mimeType, 'application/vnd.recordare.musicxml+xml');
    assert.ok(typeof result.content === 'string');

    const xml = result.content;

    // 1. Declaración DOCTYPE MusicXML 4.0
    assert.ok(xml.includes('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"'));
    assert.ok(xml.includes('<score-partwise version="4.0">'));

    // 2. Metadatos de la obra
    assert.ok(xml.includes('<work-title>Sublime Gracia</work-title>'));
    assert.ok(xml.includes('<creator type="composer">John Newton</creator>'));

    // 3. Atributos musicales
    assert.ok(xml.includes('<divisions>480</divisions>'));
    assert.ok(xml.includes('<fifths>1</fifths>')); // G Mayor = 1 sostenido
    assert.ok(xml.includes('<mode>major</mode>'));
    assert.ok(xml.includes('<beats>4</beats>'));
    assert.ok(xml.includes('<beat-type>4</beat-type>'));

    // 4. Notas y Alturas
    assert.ok(xml.includes('<step>G</step>'));
    assert.ok(xml.includes('<octave>4</octave>'));
    assert.ok(xml.includes('<step>B</step>'));
    assert.ok(xml.includes('<step>D</step>'));
    assert.ok(xml.includes('<octave>5</octave>'));

    // 5. Duraciones canónicas exactas
    assert.ok(xml.includes('<duration>480</duration>')); // Negra
    assert.ok(xml.includes('<duration>960</duration>')); // Blanca

    // 6. Cifrados armónicos (Harmony)
    assert.ok(xml.includes('<root-step>G</root-step>'));
    assert.ok(xml.includes('<root-step>D</root-step>'));
    assert.ok(xml.includes('<root-step>E</root-step>'));
    assert.ok(xml.includes('<kind text="Em">minor</kind>'));

    // 7. Lírica y sílabas
    assert.ok(xml.includes('<text>Sub</text>'));
    assert.ok(xml.includes('<syllabic>begin</syllabic>'));
    assert.ok(xml.includes('<text>me</text>'));
    assert.ok(xml.includes('<syllabic>single</syllabic>'));
    assert.ok(xml.includes('Señor'));
  });

  it('should preserve zero-fabrication contract when document lacks notes', () => {
    const chordSheet = createChordsAndLyricsOnlyFixture();
    const result = CanonicalToMusicXmlSerializer.serialize(chordSheet);

    assert.strictEqual(result.success, true);
    assert.ok(typeof result.content === 'string');

    // Debe emitir advertencia informativa de ausencia de notas
    const warning = result.diagnostics.find((d) => d.code === 'MUSICXML_NO_MELODIC_NOTES');
    assert.ok(warning, 'Debe registrar diagnóstico MUSICXML_NO_MELODIC_NOTES');
    assert.strictEqual(warning.severity, 'WARNING');

    // No debe contener notas inventadas
    assert.ok(!result.content.includes('<step>C</step>'), 'No debe inventar notas C');
    assert.ok(!result.content.includes('<pitch>'), 'No debe contener tags pitch cuando no hay notas');

    // Pero sí debe contener armonías y letra
    assert.ok(result.content.includes('<root-step>C</root-step>'));
    assert.ok(result.content.includes('Aleluya'));
  });

  it('should omit key signature and tempo tags when canonical data is null (Zero-Fabrication)', () => {
    const instrumental = createInstrumentalFixture();
    const result = CanonicalToMusicXmlSerializer.serialize(instrumental);

    assert.strictEqual(result.success, true);
    const xml = result.content as string;

    // Tonalidad no declarada: no debe contener <key>
    assert.ok(!xml.includes('<key>'), 'No debe fabricar armadura de clave si es nula');

    // Notas reales presentes
    assert.ok(xml.includes('<step>A</step>'));
    assert.ok(xml.includes('<step>C</step>'));
  });
});
