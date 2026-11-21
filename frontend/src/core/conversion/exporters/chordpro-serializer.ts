/**
 * @file chordpro-serializer.ts
 * @description Serializador de CanonicalMusicPayload hacia formato ChordPro (.cho / .chordpro).
 *
 * Principios de Fase 2A:
 * 1. CERO invención de acordes: Si la obra no contiene acordes, se serializa la letra y estructura sin acordes inventados.
 * 2. CERO invención de tonalidad, compás o tempo: Las directivas {key}, {time}, {tempo} solo se emiten si están explícitamente definidas.
 * 3. Preservación estricta de secciones: Mapeo a directivas {start_of_verse}, {start_of_chorus}, {start_of_bridge}, etc.
 * 4. Integración precisa acorde-letra: Notación entre corchetes ([G]Sub[D]lime...).
 */

import { type CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { type ChordEvent } from '../../canonical-model/chord-event.ts';
import { type LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { type Measure } from '../../canonical-model/measure.ts';
import { type Section } from '../../canonical-model/section.ts';
import {
  type ConversionDiagnostic,
  type ConversionExportResult,
} from '../types.ts';

export interface ChordProExportOptions {
  useShortDirectives?: boolean; // ej. {soc} en vez de {start_of_chorus}
}

export class CanonicalToChordProSerializer {
  /**
   * Serializa un CanonicalMusicPayload a una cadena de texto en formato ChordPro.
   */
  public static serialize(
    payload: CanonicalMusicPayload,
    options?: ChordProExportOptions
  ): ConversionExportResult {
    const diagnostics: ConversionDiagnostic[] = [];

    if (!payload || !payload.title) {
      throw new Error('No se puede serializar un CanonicalMusicPayload inválido o sin título.');
    }

    const allChords = payload.getAllChords();
    const allLyrics = payload.getAllLyrics();

    if (allChords.length === 0) {
      diagnostics.push({
        code: 'CHORDPRO_NO_CHORDS',
        severity: 'WARNING',
        message:
          'El documento canónico no contiene cifrado armónico. Se genera ChordPro con la estructura lírica disponible sin acordes inventados.',
      });
    }

    if (allLyrics.length === 0 && allChords.length === 0) {
      diagnostics.push({
        code: 'CHORDPRO_NO_CHORDS_OR_LYRICS',
        severity: 'WARNING',
        message:
          'El documento canónico no contiene cifrado armónico ni letra (ej. partitura melódica pura). Se exporta la cabecera de metadatos.',
      });
    }

    const shortDir = options?.useShortDirectives ?? false;
    const lines: string[] = [];

    // 1. Directivas de Cabecera
    lines.push(`{title: ${payload.title}}`);

    const artist = typeof payload.metadata?.['artist'] === 'string' ? payload.metadata['artist'] : null;
    if (artist) {
      lines.push(`{artist: ${artist}}`);
    }

    const capo = payload.metadata?.['capo'];
    if (typeof capo === 'number' && capo > 0) {
      lines.push(`{capo: ${capo}}`);
    }

    // Tonalidad (Solo si existe en primer compás o metadata)
    const firstMeasure = payload.measures[0];
    const keySig = firstMeasure?.keySignature;
    if (keySig) {
      const modeSuffix = keySig.mode === 'NATURAL_MINOR' ? 'm' : '';
      lines.push(`{key: ${keySig.tonic.toString()}${modeSuffix}}`);
    } else if (typeof payload.metadata?.['key'] === 'string') {
      lines.push(`{key: ${payload.metadata['key']}}`);
    }

    // Tempo (Solo si existe explícitamente en timeline o metadata)
    const bpm = this.extractBpm(payload);
    if (bpm !== null && bpm > 0) {
      lines.push(`{tempo: ${bpm}}`);
    }

    // Métrica (Solo si existe explícitamente)
    const timeSig = firstMeasure?.timeSignature;
    if (timeSig) {
      lines.push(`{time: ${timeSig.numerator}/${timeSig.denominator}}`);
    } else if (typeof payload.metadata?.['timeSignature'] === 'string') {
      lines.push(`{time: ${payload.metadata['timeSignature']}}`);
    }

    lines.push(''); // Línea en blanco tras metadatos

    // 2. Secciones o Compases
    if (payload.sections.length > 0) {
      for (const section of payload.sections) {
        this.serializeSection(section, payload, lines, shortDir);
      }
    } else {
      // Sin secciones formales: agrupar compases secuenciales
      this.serializeMeasureGroup(payload.measures, lines);
    }

    const content = lines.join('\n').trim() + '\n';

    return {
      success: true,
      targetFormat: 'CHORD_PRO',
      filename: `${this.sanitizeFilename(payload.title)}.cho`,
      mimeType: 'text/plain',
      content,
      canonicalPayload: payload,
      diagnostics,
    };
  }

  private static serializeSection(
    section: Section,
    payload: CanonicalMusicPayload,
    lines: string[],
    shortDir: boolean
  ): void {
    const startMeasure = section.startMeasure;
    const endMeasure = section.startMeasure + section.measureCount - 1;
    const sectionMeasures = payload.measures.filter(
      (m) => m.number >= startMeasure && m.number <= endMeasure
    );

    const type = section.type;
    const name = section.label || this.defaultSectionName(type);

    let startTag = '';
    let endTag = '';

    switch (type) {
      case 'VERSE':
        startTag = shortDir ? `{sov: ${name}}` : `{start_of_verse: ${name}}`;
        endTag = shortDir ? '{eov}' : '{end_of_verse}';
        break;
      case 'CHORUS':
        startTag = shortDir ? `{soc: ${name}}` : `{start_of_chorus: ${name}}`;
        endTag = shortDir ? '{eoc}' : '{end_of_chorus}';
        break;
      case 'BRIDGE':
        startTag = shortDir ? `{sob: ${name}}` : `{start_of_bridge: ${name}}`;
        endTag = shortDir ? '{eob}' : '{end_of_bridge}';
        break;
      default:
        startTag = `{comment: ${name}}`;
        endTag = '';
        break;
    }

    if (startTag) lines.push(startTag);
    this.serializeMeasureGroup(sectionMeasures, lines);
    if (endTag) lines.push(endTag);
    lines.push(''); // Separador entre secciones
  }

  private static serializeMeasureGroup(measures: readonly Measure[], lines: string[]): void {
    let currentLineTokens: string[] = [];

    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i]!;
      const measureText = this.formatMeasureContent(measure);

      if (measureText.trim().length > 0) {
        currentLineTokens.push(measureText.trim());
      }

      // Si el compás tiene lírica completa o es fin de frase (o cada 2-4 compases de sólo acordes)
      const hasLyrics = measure.lyrics.length > 0;
      if (hasLyrics || currentLineTokens.length >= 4 || i === measures.length - 1) {
        if (currentLineTokens.length > 0) {
          lines.push(currentLineTokens.join(' '));
          currentLineTokens = [];
        }
      }
    }

    if (currentLineTokens.length > 0) {
      lines.push(currentLineTokens.join(' '));
    }
  }

  private static formatMeasureContent(measure: Measure): string {
    const chords = [...measure.chords].sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
    const lyrics = [...measure.lyrics].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    // Caso 1: Tiene letra (con o sin acordes)
    if (lyrics.length > 0) {
      let result = '';
      const usedChordIds = new Set<string>();

      for (let sIdx = 0; sIdx < lyrics.length; sIdx++) {
        const syl = lyrics[sIdx]!;

        // Si la sílaba tiene acorde directo (ej. proveniente de importación ChordPro)
        if (syl.chordAbove) {
          result += `[${syl.chordAbove.toString()}]`;
        } else {
          // Buscar acordes en el compás cuyo startTick coincida con o preceda este syl
          const sylTick = syl.tickOffset ?? 0;
          for (const chord of chords) {
            if (!usedChordIds.has(chord.id)) {
              const chordTick = chord.startTick ?? 0;
              // Si el acorde está en este rango de tick
              if (chordTick <= sylTick) {
                result += `[${chord.chord.toString()}]`;
                usedChordIds.add(chord.id);
              }
            }
          }
        }

        result += syl.text;
        if (!syl.isHyphenated && sIdx < lyrics.length - 1) {
          result += ' ';
        }
      }

      // Agregar acordes remanentes al final del compás si los hay
      for (const chord of chords) {
        if (!usedChordIds.has(chord.id)) {
          result += ` [${chord.chord.toString()}]`;
        }
      }

      return result;
    }

    // Caso 2: Sólo acordes sin letra
    if (chords.length > 0) {
      return chords.map((c) => `[${c.chord.toString()}]`).join('  ');
    }

    // Caso 3: Sin letra ni acordes (compás instrumental de notas melódicas)
    return '';
  }

  private static defaultSectionName(type: string): string {
    switch (type) {
      case 'VERSE':
        return 'Verso';
      case 'CHORUS':
        return 'Coro';
      case 'BRIDGE':
        return 'Puente';
      case 'INTRO':
        return 'Intro';
      case 'OUTRO':
        return 'Outro';
      case 'PRE_CHORUS':
        return 'Pre-Coro';
      default:
        return 'Sección';
    }
  }

  private static extractBpm(payload: CanonicalMusicPayload): number | null {
    if (
      payload.timeline?.tempoMap &&
      !payload.timeline.tempoMap.isUnresolved &&
      payload.timeline.tempoMap.events.length > 0
    ) {
      const firstTempo = payload.timeline.tempoMap.events[0];
      if (firstTempo && typeof firstTempo.bpm === 'number' && firstTempo.bpm > 0) {
        return firstTempo.bpm;
      }
    }
    const metaBpm = payload.metadata?.['bpm'];
    if (typeof metaBpm === 'number' && metaBpm > 0) {
      return metaBpm;
    }
    return null;
  }

  private static sanitizeFilename(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50) || 'conversion';
  }
}
