/**
 * @file xml-parser.test.ts
 * @description Pruebas unitarias para el analizador seguro XmlParser y XmlElement.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { XmlParser } from '../xml/xml-parser.ts';

describe('XmlParser Security and Structure Tests', () => {
  it('should parse a basic XML tree with attributes and text', () => {
    const xml = `
      <score-partwise version="4.0">
        <work>
          <work-title>Cántico Nuevo</work-title>
        </work>
        <part id="P1">
          <measure number="1">
            <note>
              <pitch>
                <step>C</step>
                <octave>4</octave>
              </pitch>
              <duration>4</duration>
            </note>
          </measure>
        </part>
      </score-partwise>
    `;

    const root = XmlParser.parse(xml);
    assert.strictEqual(root.name, 'score-partwise');
    assert.strictEqual(root.attr('version'), '4.0');

    const work = root.child('work');
    assert.ok(work);
    assert.strictEqual(work.childText('work-title'), 'Cántico Nuevo');

    const part = root.child('part');
    assert.ok(part);
    assert.strictEqual(part.attr('id'), 'P1');

    const measure = part.child('measure');
    assert.ok(measure);
    assert.strictEqual(measure.attr('number'), '1');

    const note = measure.child('note');
    assert.ok(note);
    assert.strictEqual(note.child('pitch')?.childText('step'), 'C');
    assert.strictEqual(note.child('pitch')?.childInt('octave'), 4);
    assert.strictEqual(note.childInt('duration'), 4);
  });

  it('should handle self-closing tags and multiple child elements', () => {
    const xml = `
      <measure number="2">
        <note>
          <rest/>
          <duration>2</duration>
        </note>
        <note>
          <pitch><step>E</step><octave>4</octave></pitch>
          <duration>2</duration>
        </note>
      </measure>
    `;

    const root = XmlParser.parse(xml);
    assert.strictEqual(root.name, 'measure');
    const notes = root.childrenNamed('note');
    assert.strictEqual(notes.length, 2);
    assert.ok(notes[0]?.child('rest'));
    assert.strictEqual(notes[1]?.child('pitch')?.childText('step'), 'E');
  });

  it('should strictly reject XML External Entity (XXE) attacks', () => {
    const maliciousXml = `<?xml version="1.0"?>
      <!DOCTYPE foo [
        <!ENTITY xxe SYSTEM "file:///etc/passwd">
      ]>
      <foo>&xxe;</foo>`;

    assert.throws(
      () => XmlParser.parse(maliciousXml),
      /Inyección XXE detectada/
    );
  });

  it('should unescape XML entities cleanly (&amp;, &lt;, &gt;, &quot;, &apos;)', () => {
    const xml = `<text attr="&quot;quoted&quot;">Tom &amp; Jerry &lt;3</text>`;
    const root = XmlParser.parse(xml);
    assert.strictEqual(root.attr('attr'), '"quoted"');
    assert.strictEqual(root.text, 'Tom & Jerry <3');
  });

  it('should throw on mismatched or unclosed XML tags', () => {
    assert.throws(
      () => XmlParser.parse('<open><close></different></open>'),
      /Desajuste de etiquetas XML/
    );

    assert.throws(
      () => XmlParser.parse('<open><close>'),
      /Etiquetas XML no cerradas al final del documento/
    );
  });
});
