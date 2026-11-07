/**
 * @file lyrics-serializer.ts
 * @description Serializador de CanonicalMusicPayload hacia texto plano de solo letra (.txt).
 *
 * Principios de Fase 2A:
 * 1. CERO invención lírica: Si el documento no contiene sílabas líricas (ej. obra puramente instrumental),
 *    SE RECHAZA la generación con un diagnóstico explícito en vez de inventar versos o líneas ficticias.
 * 2. CERO acordes o marcado técnico: Se eliminan cifrados armónicos, etiquetas XML y duraciones musicales,
 *    produciendo un texto limpio y legible para cantantes y directores de adoración.
 * 3. Preservación estricta de estructura: Marcadores de sección canónicos ([Verso 1], [Coro], [Puente]).
 */

import { type CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { type LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { type Section } from '../../canonical-model/section.ts';
import {
  type ConversionDiagnostic,
  type ConversionExportResult,
} from '../types.ts';

export interface LyricsExportOptions {
  includeHeaderMetadata?: boolean; // Título y compositor al inicio
  sectionMarkerStyle?: 'BRACKETS' | 'COLON' | 'UPPERCASE'; // [Coro], Coro:, CORO
}

export class CanonicalToLyricsSerializer {
  /**
   * Serializa un CanonicalMusicPayload a un archivo de texto plano con la letra de la canción.
   */
  public static serialize(
    payload: CanonicalMusicPayload,
    options?: LyricsExportOptions
  ): ConversionExportResult {
    const diagnostics: ConversionDiagnostic[] = [];

    if (!payload || !payload.title) {
      throw new Error('No se puede serializar un CanonicalMusicPayload inválido o sin título.');
    }

    const allLyrics = payload.getAllLyrics();

    // Principio de Cero-Fabricación: Si no hay letra, no inventamos texto
    if (allLyrics.length === 0) {
      return {
        success: false,
        targetFormat: 'LYRICS_ONLY',
        filename: `${this.sanitizeFilename(payload.title)}_letra.txt`,
        mimeType: 'text/plain; charset=utf-8',
        content: '',
        canonicalPayload: payload,
        diagnostics: [
          {
            code: 'LYRICS_NO_VOCAL_CONTENT',
            severity: 'ERROR',
            message:
              'El documento canónico no contiene letra ni texto lírico vocal (obra puramente instrumental). No es posible generar un archivo de solo letra sin violar el principio de cero fabricación.',
          },
        ],
      };
    }

    const includeHeader = options?.includeHeaderMetadata ?? true;
    const markerStyle = options?.sectionMarkerStyle ?? 'BRACKETS';

    const lines: string[] = [];

    if (includeHeader) {
      lines.push(payload.title.toUpperCase());
      const artist = typeof payload.metadata?.['artist'] === 'string' ? payload.metadata['artist'] : null;
      if (artist) {
        lines.push(`Compositor / Artista: ${artist}`);
      }
      lines.push('----------------------------------------');
      lines.push('');
    }

    if (payload.sections.length > 0) {
      for (const section of payload.sections) {
        this.serializeSectionLyrics(section, payload, lines, markerStyle);
      }
    } else {
      // Sin secciones formales: extraer líneas compás por compás
      for (const measure of payload.measures) {
        if (measure.lyrics.length > 0) {
          const lineText = this.assembleSyllables(measure.lyrics);
          if (lineText.trim().length > 0) {
            lines.push(lineText.trim());
          }
        }
      }
    }

    const content = lines.join('\n').trim() + '\n';

    return {
      success: true,
      targetFormat: 'LYRICS_ONLY',
      filename: `${this.sanitizeFilename(payload.title)}_letra.txt`,
      mimeType: 'text/plain; charset=utf-8',
      content,
      canonicalPayload: payload,
      diagnostics,
    };
  }

  private static serializeSectionLyrics(
    section: Section,
    payload: CanonicalMusicPayload,
    lines: string[],
    markerStyle: 'BRACKETS' | 'COLON' | 'UPPERCASE'
  ): void {
    const startMeasure = section.startMeasure;
    const endMeasure = section.startMeasure + section.measureCount - 1;
    const sectionMeasures = payload.measures.filter(
      (m) => m.number >= startMeasure && m.number <= endMeasure
    );

    const sectionLyrics = sectionMeasures.flatMap((m) => m.lyrics);
    if (sectionLyrics.length === 0) {
      return; // Omitir secciones sin letra en exportación de texto
    }

    const sectionName = section.label || this.defaultSectionName(section.type);
    let header = `[${sectionName}]`;
    if (markerStyle === 'COLON') header = `${sectionName}:`;
    if (markerStyle === 'UPPERCASE') header = sectionName.toUpperCase();

    lines.push(header);

    for (const measure of sectionMeasures) {
      if (measure.lyrics.length > 0) {
        const lineText = this.assembleSyllables(measure.lyrics);
        if (lineText.trim().length > 0) {
          lines.push(lineText.trim());
        }
      }
    }

    lines.push(''); // Línea en blanco entre secciones
  }

  private static assembleSyllables(lyrics: readonly LyricSyllable[]): string {
    const sorted = [...lyrics].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    let result = '';

    for (let i = 0; i < sorted.length; i++) {
      const syl = sorted[i]!;
      result += syl.text;
      if (!syl.isHyphenated && i < sorted.length - 1) {
        result += ' ';
      }
    }

    return result;
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

  private static sanitizeFilename(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50) || 'letra';
  }
}
