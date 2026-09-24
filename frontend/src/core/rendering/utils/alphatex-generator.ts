/**
 * @file alphatex-generator.ts
 * @description Generador ligero y determinista de AlphaTex a partir de una DerivedMusicalView.
 * Empleado por AlphaTabAdapter para alimentar a AlphaTab en el navegador sin intermediarios opacos.
 */

import { type DerivedMeasure, type DerivedMusicalView } from '../../projection/derived-musical-view.ts';

export class AlphaTexGenerator {
  /**
   * Convierte una DerivedMusicalView en una cadena de texto AlphaTex compatible con AlphaTab.
   */
  public static generate(view: DerivedMusicalView): string {
    const lines: string[] = [];

    lines.push(`\\title "${AlphaTexGenerator.escapeTex(view.songTitle)}"`);
    lines.push('\\tempo 120');

    if (view.capoFret > 0) {
      lines.push(`\\capo ${view.capoFret}`);
    }

    if (view.instrumentProfile.tuning) {
      const tuningStr = view.instrumentProfile.tuning.stringPitches
        .map((p) => p.toString())
        .join(' ');
      lines.push(`\\tuning (${tuningStr})`);
    }

    // Generar compases
    const measuresTex = view.measures
      .map((measure, idx) => AlphaTexGenerator.generateMeasure(measure, idx === 0))
      .join(' |\n');

    lines.push(measuresTex + ' |');

    return lines.join('\n');
  }

  private static generateMeasure(measure: DerivedMeasure, isFirst: boolean): string {
    const tokens: string[] = [];

    if (isFirst) {
      tokens.push(`\\ts (${measure.timeSignature.numerator} ${measure.timeSignature.denominator})`);
    }

    if (measure.notes.length === 0) {
      // Compás sin notas melódicas: representar acordes sobre silencios
      if (measure.chords.length > 0) {
        for (const ch of measure.chords) {
          const chordLabel = AlphaTexGenerator.escapeTex(ch.displayString);
          tokens.push(`:2 r{txt "${chordLabel}"}`);
        }
      } else {
        tokens.push(':1 r');
      }
    } else {
      for (const note of measure.notes) {
        const tabCoord = measure.tablature.find(
          (t) =>
            t.canonicalPitch.midiNumber === note.canonicalPitch.midiNumber &&
            t.durationTicks === note.durationTicks
        );

        const chordEvent = measure.chords.find((c) => c.startTick === note.startTick);
        const lyricEvent = measure.lyrics.find(
          (l) => l.tickOffset === note.startTick || l.boundNoteId === note.id
        );

        const stringNum = tabCoord ? tabCoord.stringNumber : 1;
        const fretNum = tabCoord ? tabCoord.fret : 0;
        const dur = AlphaTexGenerator.ticksToDuration(note.durationTicks);

        const props: string[] = [];
        if (chordEvent) {
          props.push(`txt "${AlphaTexGenerator.escapeTex(chordEvent.displayString)}"`);
        }
        if (lyricEvent) {
          props.push(`lyrics "${AlphaTexGenerator.escapeTex(lyricEvent.text)}"`);
        }

        const propStr = props.length > 0 ? `{${props.join(' ')}}` : '';
        tokens.push(`:${dur} ${fretNum}.${stringNum}${propStr}`);
      }
    }

    return tokens.join(' ');
  }

  private static ticksToDuration(ticks: number): string {
    if (ticks >= 1920) return '1';
    if (ticks >= 960) return '2';
    if (ticks >= 480) return '4';
    if (ticks >= 240) return '8';
    if (ticks >= 120) return '16';
    return '4';
  }

  private static escapeTex(text: string): string {
    return text.replace(/"/g, "'");
  }
}
