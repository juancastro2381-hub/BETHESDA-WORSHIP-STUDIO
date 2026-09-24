/**
 * @file musicxml-generator.ts
 * @description Generador ligero y determinista de MusicXML 4.0 a partir de una DerivedMusicalView.
 * Empleado por OsmdAdapter para alimentar a OpenSheetMusicDisplay sin intermediarios opacos.
 */

import { type DerivedMeasure, type DerivedMusicalView } from '../../projection/derived-musical-view.ts';

export class MusicXmlGenerator {
  /**
   * Convierte una DerivedMusicalView en una cadena de documento MusicXML 4.0 válida.
   */
  public static generate(view: DerivedMusicalView): string {
    const title = MusicXmlGenerator.escapeXml(view.songTitle);
    const partName = MusicXmlGenerator.escapeXml(view.instrumentProfile.name);
    const isGrandStaff =
      view.activeRepresentations.includes('GRAND_STAFF') ||
      view.instrumentProfile.staffCount === 2;

    const fifths = view.writtenKey.keySignature.accidentalCount;
    const mode = view.writtenKey.mode.toLowerCase();

    const partsXml = view.measures
      .map((measure, idx) => MusicXmlGenerator.generateMeasure(measure, idx === 0, isGrandStaff, fifths, mode))
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${title}</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>${partName}</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${partsXml}
  </part>
</score-partwise>`;
  }

  private static generateMeasure(
    measure: DerivedMeasure,
    isFirst: boolean,
    isGrandStaff: boolean,
    fifths: number,
    mode: string
  ): string {
    const num = measure.measureNumber;
    let xml = `    <measure number="${num}">\n`;

    if (isFirst) {
      xml += `      <attributes>\n`;
      xml += `        <divisions>480</divisions>\n`;
      xml += `        <key>\n`;
      xml += `          <fifths>${fifths}</fifths>\n`;
      xml += `          <mode>${mode}</mode>\n`;
      xml += `        </key>\n`;
      xml += `        <time>\n`;
      xml += `          <beats>${measure.timeSignature.numerator}</beats>\n`;
      xml += `          <beat-type>${measure.timeSignature.denominator}</beat-type>\n`;
      xml += `        </time>\n`;

      if (isGrandStaff) {
        xml += `        <staves>2</staves>\n`;
        xml += `        <clef number="1">\n          <sign>G</sign>\n          <line>2</line>\n        </clef>\n`;
        xml += `        <clef number="2">\n          <sign>F</sign>\n          <line>4</line>\n        </clef>\n`;
      } else {
        const clef = measure.clefs[0] ?? 'TREBLE';
        const sign = clef === 'BASS' ? 'F' : 'G';
        const line = clef === 'BASS' ? '4' : '2';
        xml += `        <clef>\n          <sign>${sign}</sign>\n          <line>${line}</line>\n        </clef>\n`;
      }
      xml += `      </attributes>\n`;
    }

    // Agregar acordes (harmony)
    for (const chord of measure.chords) {
      const rootStep = chord.writtenChord.root.letter;
      const rootAlter = chord.writtenChord.root.accidental.semitoneOffset;
      xml += `      <harmony>\n`;
      xml += `        <root>\n`;
      xml += `          <root-step>${rootStep}</root-step>\n`;
      if (rootAlter !== 0) {
        xml += `          <root-alter>${rootAlter}</root-alter>\n`;
      }
      xml += `        </root>\n`;
      xml += `        <kind text="${MusicXmlGenerator.escapeXml(chord.displayString)}">other</kind>\n`;
      xml += `      </harmony>\n`;
    }

    // Agregar notas o silencios
    if (measure.notes.length === 0) {
      // Compás sin melodía (ej. ChordPro lead sheet): agregar un silencio de compás completo
      xml += `      <note>\n`;
      xml += `        <rest measure="yes"/>\n`;
      xml += `        <duration>${measure.durationTicks}</duration>\n`;
      xml += `        <voice>1</voice>\n`;
      if (isGrandStaff) xml += `        <staff>1</staff>\n`;
      xml += `      </note>\n`;
    } else {
      for (const note of measure.notes) {
        const step = note.writtenPitch.noteName.letter;
        const alter = note.writtenPitch.noteName.accidental.semitoneOffset;
        const octave = note.writtenPitch.octave;

        xml += `      <note>\n`;
        xml += `        <pitch>\n`;
        xml += `          <step>${step}</step>\n`;
        if (alter !== 0) {
          xml += `          <alter>${alter}</alter>\n`;
        }
        xml += `          <octave>${octave}</octave>\n`;
        xml += `        </pitch>\n`;
        xml += `        <duration>${note.durationTicks}</duration>\n`;
        xml += `        <voice>${note.voice}</voice>\n`;
        xml += `        <type>${MusicXmlGenerator.ticksToNoteType(note.durationTicks)}</type>\n`;
        if (isGrandStaff) {
          xml += `        <staff>${note.staff}</staff>\n`;
        }

        // Sílabas asociadas
        const lyric = measure.lyrics.find((l) => l.tickOffset === note.startTick || l.boundNoteId === note.id);
        if (lyric) {
          const syllType = lyric.isHyphenated ? 'begin' : 'single';
          xml += `        <lyric>\n`;
          xml += `          <syllabic>${syllType}</syllabic>\n`;
          xml += `          <text>${MusicXmlGenerator.escapeXml(lyric.text)}</text>\n`;
          xml += `        </lyric>\n`;
        }

        xml += `      </note>\n`;
      }
    }

    xml += `    </measure>`;
    return xml;
  }

  private static ticksToNoteType(ticks: number): string {
    if (ticks >= 1920) return 'whole';
    if (ticks >= 960) return 'half';
    if (ticks >= 480) return 'quarter';
    if (ticks >= 240) return 'eighth';
    if (ticks >= 120) return '16th';
    return 'quarter';
  }

  private static escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
