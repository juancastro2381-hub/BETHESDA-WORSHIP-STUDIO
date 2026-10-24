/**
 * @file chord-sheet-converter.ts
 * @description Convertidor determinista de cancioneros y partituras de texto (Chord-over-Text)
 * hacia formato estándar ChordPro, texto de solo letra (Lyrics Only), acordes digitados de guitarra
 * y CanonicalMusicPayload para Bethesda Worship Studio.
 */

import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordProImporter } from '../chordpro/chordpro-importer.ts';
import { isChordLine, isChordToken, isTabLine } from './pdf-chord-extractor.ts';

export interface ConvertedSongOutput {
  readonly title: string;
  readonly artist: string | null;
  readonly key: string;
  readonly chordPro: string;
  readonly lyricsOnly: string;
  readonly uniqueChords: string[];
  readonly chordVoicings: Array<{ chord: string; fretPattern: string; fingeringNotes: string }>;
  readonly asciiTablature: string | null;
  readonly canonicalPayload: CanonicalMusicPayload | null;
  readonly warnings: string[];
}

export type ConvertedChordSheet = ConvertedSongOutput;

export interface ConvertOptions {
  title?: string | undefined;
  artist?: string | undefined;
  defaultKey?: string | undefined;
}

/**
 * Diccionario de digitaciones estándar de guitarra (afinación E2-A2-D3-G3-B3-E4)
 * para presentación de tablaturas/diagramas de acordes.
 */
export const GUITAR_CHORD_VOICINGS: Record<string, { fretPattern: string; fingeringNotes: string }> = {
  C: { fretPattern: 'x-3-2-0-1-0', fingeringNotes: 'C, E, G, C, E' },
  Cm: { fretPattern: 'x-3-5-5-4-3', fingeringNotes: 'C, G, C, Eb, G' },
  C7: { fretPattern: 'x-3-2-3-1-0', fingeringNotes: 'C, E, Bb, C, E' },
  Cadd9: { fretPattern: 'x-3-2-0-3-0', fingeringNotes: 'C, E, G, D, E' },
  'C#': { fretPattern: 'x-4-6-6-6-4', fingeringNotes: 'C#, G#, C#, F, G#' },
  'C#m': { fretPattern: 'x-4-6-6-5-4', fingeringNotes: 'C#, G#, C#, E, G#' },
  D: { fretPattern: 'x-x-0-2-3-2', fingeringNotes: 'D, A, D, F#' },
  Dm: { fretPattern: 'x-x-0-2-3-1', fingeringNotes: 'D, A, D, F' },
  D7: { fretPattern: 'x-x-0-2-1-2', fingeringNotes: 'D, A, C, F#' },
  'D#': { fretPattern: 'x-6-8-8-8-6', fingeringNotes: 'Eb, Bb, Eb, G, Bb' },
  'D#m': { fretPattern: 'x-6-8-8-7-6', fingeringNotes: 'Eb, Bb, Eb, Gb, Bb' },
  Eb: { fretPattern: 'x-6-8-8-8-6', fingeringNotes: 'Eb, Bb, Eb, G, Bb' },
  E: { fretPattern: '0-2-2-1-0-0', fingeringNotes: 'E, B, E, G#, B, E' },
  Em: { fretPattern: '0-2-2-0-0-0', fingeringNotes: 'E, B, E, G, B, E' },
  E7: { fretPattern: '0-2-0-1-0-0', fingeringNotes: 'E, B, D, G#, B, E' },
  F: { fretPattern: '1-3-3-2-1-1', fingeringNotes: 'F, C, F, A, C, F' },
  Fm: { fretPattern: '1-3-3-1-1-1', fingeringNotes: 'F, C, F, Ab, C, F' },
  'F#': { fretPattern: '2-4-4-3-2-2', fingeringNotes: 'F#, C#, F#, A#, C#, F#' },
  'F#m': { fretPattern: '2-4-4-2-2-2', fingeringNotes: 'F#, C#, F#, A, C#, F#' },
  G: { fretPattern: '3-2-0-0-0-3', fingeringNotes: 'G, B, D, G, B, G' },
  Gm: { fretPattern: '3-5-5-3-3-3', fingeringNotes: 'G, D, G, Bb, D, G' },
  G7: { fretPattern: '3-2-0-0-0-1', fingeringNotes: 'G, B, D, G, B, F' },
  'G#': { fretPattern: '4-6-6-5-4-4', fingeringNotes: 'Ab, Eb, Ab, C, Eb, Ab' },
  'G#m': { fretPattern: '4-6-6-4-4-4', fingeringNotes: 'Ab, Eb, Ab, B, Eb, Ab' },
  A: { fretPattern: 'x-0-2-2-2-0', fingeringNotes: 'A, E, A, C#, E' },
  Am: { fretPattern: 'x-0-2-2-1-0', fingeringNotes: 'A, E, A, C, E' },
  A7: { fretPattern: 'x-0-2-0-2-0', fingeringNotes: 'A, E, G, C#, E' },
  'A#': { fretPattern: 'x-1-3-3-3-1', fingeringNotes: 'Bb, F, Bb, D, F' },
  Bb: { fretPattern: 'x-1-3-3-3-1', fingeringNotes: 'Bb, F, Bb, D, F' },
  B: { fretPattern: 'x-2-4-4-4-2', fingeringNotes: 'B, F#, B, D#, F#' },
  Bm: { fretPattern: 'x-2-4-4-3-2', fingeringNotes: 'B, F#, B, D, F#' },
  B7: { fretPattern: 'x-2-1-2-0-2', fingeringNotes: 'B, D#, A, B, F#' },
};

export class ChordSheetConverter {
  /**
   * Convierte líneas de texto (Chord-over-Text) en una estructura completa multicapa.
   */
  public static convert(lines: string[], defaultTitleOrOptions?: string | ConvertOptions): ConvertedSongOutput {
    const options: ConvertOptions =
      typeof defaultTitleOrOptions === 'string'
        ? { title: defaultTitleOrOptions }
        : defaultTitleOrOptions ?? {};

    const warnings: string[] = [];
    if (lines.length === 0) {
      return {
        title: options.title || 'Canción Vacía',
        artist: options.artist || null,
        key: options.defaultKey || 'C',
        chordPro: '{title: Canción Vacía}\n',
        lyricsOnly: '',
        uniqueChords: [],
        chordVoicings: [],
        asciiTablature: null,
        canonicalPayload: null,
        warnings: ['El documento no contiene líneas de texto legibles.'],
      };
    }

    // 1. Extraer título y artista
    const firstLine = lines[0] ?? '';
    let title = (options.title || firstLine).trim();
    let artist: string | null = options.artist || null;
    let startIndex = 1;

    const titleMatch = firstLine.match(/^(.*?)\s*[\(\[](.*?)[\)\]]?$/);
    if (!options.title && titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
      artist = (titleMatch[2] ?? '').replace(/[\\)\]]+$/, '').trim() || null;
    } else if (!options.title) {
      const secondLine = lines[1]?.trim() ?? '';
      if (lines.length > 1 && secondLine.startsWith('(') && secondLine.endsWith(')')) {
        artist = secondLine.slice(1, -1).trim() || null;
        startIndex = 2;
      }
    }

    title = title.replace(/[\\()]+/g, '').trim() || 'Canción Sin Título';

    // 2. Procesar líneas para identificar acordes, letra, intros y tablaturas
    const chordProLines: string[] = [`{title: ${title}}`];
    if (artist) chordProLines.push(`{artist: ${artist}}`);
    if (options.defaultKey) chordProLines.push(`{key: ${options.defaultKey}}`);

    const lyricsOnlyLines: string[] = [];
    const detectedChordsSet = new Set<string>();
    const tabLines: string[] = [];
    let detectedKey = options.defaultKey || 'C';

    let i = startIndex;
    while (i < lines.length) {
      const line = (lines[i] ?? '').trim();
      if (!line) {
        chordProLines.push('');
        lyricsOnlyLines.push('');
        i++;
        continue;
      }

      // Tablatura ASCII
      if (isTabLine(line)) {
        tabLines.push(line);
        chordProLines.push(`{comment: TAB: ${line}}`);
        i++;
        continue;
      }

      // Marcadores de sección litúrgica (CORO, VERSO, PUENTE, INTRO, etc.)
      const sectionMatch = line.match(
        /^(CORO|VERSO|ESTROFA|PUENTE|INTRO|PRE-CORO|PRECORO|INSTRUMENTAL|INTERLUDIO|FINAL|SOLO)(?:\s*[:\d]*\s*)?(.*)$/i
      );

      if (sectionMatch && sectionMatch[1]) {
        const secType = sectionMatch[1].toUpperCase();
        const remainder = (sectionMatch[2] ?? '').trim();

        if (secType.startsWith('CORO')) {
          chordProLines.push(`\n{start_of_chorus: Coro}`);
          lyricsOnlyLines.push(`\n[CORO]`);
        } else if (secType.startsWith('VERSO') || secType.startsWith('ESTROFA')) {
          chordProLines.push(`\n{start_of_verse: ${line}}`);
          lyricsOnlyLines.push(`\n[${line}]`);
        } else if (secType.startsWith('PUENTE')) {
          chordProLines.push(`\n{start_of_bridge: Puente}`);
          lyricsOnlyLines.push(`\n[PUENTE]`);
        } else {
          chordProLines.push(`{comment: ${line}}`);
          lyricsOnlyLines.push(`[${line}]`);
        }

        // Si la misma línea del marcador contiene acordes (ej. "CORO: D A")
        if (remainder && isChordLine(remainder)) {
          const chordTokens = remainder.split(/\s+/).filter(isChordToken);
          chordTokens.forEach((c) => detectedChordsSet.add(c));
          chordProLines.push(chordTokens.map((c) => `[${c}]`).join(' '));
        }

        i++;
        continue;
      }

      // Si es una línea de acordes
      if (isChordLine(line)) {
        const nextLine = i + 1 < lines.length ? (lines[i + 1] ?? '').trim() : '';

        // Si la línea siguiente es de letra, fusionar (Chord-over-Text)
        if (nextLine && !isChordLine(nextLine) && !isTabLine(nextLine)) {
          const merged = this.mergeChordsAndLyrics(line, nextLine, detectedChordsSet);
          chordProLines.push(merged);
          lyricsOnlyLines.push(nextLine);
          i += 2; // Avanzamos ambas líneas
        } else {
          // Línea de acordes aislada (ej. progresión de acordes o intro)
          const chordTokens = line.split(/\s+/).filter(Boolean);
          const chordProTokens = chordTokens.map((t) => {
            if (isChordToken(t)) {
              detectedChordsSet.add(t);
              return `[${t}]`;
            }
            return t;
          });
          chordProLines.push(chordProTokens.join(' '));
          i++;
        }
      } else {
        // Línea pura de letra
        chordProLines.push(line);
        lyricsOnlyLines.push(line);
        i++;
      }
    }

    // 3. Determinar tonalidad canónica estimada
    const uniqueChords = Array.from(detectedChordsSet);
    if (uniqueChords.length > 0) {
      detectedKey = uniqueChords[0] ?? 'C';
      chordProLines.splice(artist ? 2 : 1, 0, `{key: ${detectedKey}}`);
    }

    const fullChordPro = chordProLines.join('\n');
    const fullLyrics = lyricsOnlyLines.join('\n');

    // 4. Calcular digitaciones de guitarra para los acordes presentes
    const chordVoicings: Array<{ chord: string; fretPattern: string; fingeringNotes: string }> = [];
    for (const c of uniqueChords) {
      // Normalizar acorde base (ej. Bm/D -> Bm)
      const baseChord = c.split('/')[0] ?? c;
      const voicing = GUITAR_CHORD_VOICINGS[baseChord] || {
        fretPattern: 'x-x-x-x-x-x',
        fingeringNotes: `Acorde ${c} (requiere cejilla o afinación personalizada)`,
      };
      chordVoicings.push({
        chord: c,
        fretPattern: voicing.fretPattern,
        fingeringNotes: voicing.fingeringNotes,
      });
    }

    // 5. Normalizar hacia CanonicalMusicPayload mediante ChordProImporter
    let canonicalPayload: CanonicalMusicPayload | null = null;
    try {
      const importer = new ChordProImporter();
      const ingestionResult = importer.import(fullChordPro, {
        sourceName: `${title}.chordpro`,
        defaultKey: detectedKey,
      });
      if (ingestionResult.status === 'SUCCESS' && ingestionResult.payload) {
        canonicalPayload = ingestionResult.payload;
      }
    } catch (err: unknown) {
      warnings.push(`No se pudo normalizar al grafo canónico: ${String(err)}`);
    }

    return {
      title,
      artist,
      key: detectedKey,
      chordPro: fullChordPro,
      lyricsOnly: fullLyrics,
      uniqueChords,
      chordVoicings,
      asciiTablature: tabLines.length > 0 ? tabLines.join('\n') : null,
      canonicalPayload,
      warnings,
    };
  }

  /**
   * Fusiona una línea de acordes colocados encima de una línea de letra.
   * Inserta los acordes en la posición semántica correspondiente.
   */
  private static mergeChordsAndLyrics(
    chordLine: string,
    lyricLine: string,
    chordSet: Set<string>
  ): string {
    const chordTokens = chordLine.split(/\s+/).filter(Boolean);
    const validChords = chordTokens.filter(isChordToken);

    if (validChords.length === 0) {
      return lyricLine;
    }

    validChords.forEach((c) => chordSet.add(c));

    // Si solo hay un acorde, colocarlo al inicio de la frase lírica
    if (validChords.length === 1) {
      return `[${validChords[0]}]${lyricLine}`;
    }

    // Distribuir equitativamente los acordes a lo largo de las palabras de la línea lírica
    const words = lyricLine.split(' ');
    if (words.length <= validChords.length) {
      // Menos o igual palabras que acordes: poner uno por palabra
      return words.map((w, idx) => (idx < validChords.length ? `[${validChords[idx]}]${w}` : w)).join(' ');
    }

    // Si hay más palabras que acordes, espaciar proporcionalmente
    const step = Math.floor(words.length / validChords.length);
    const resultWords: string[] = [];
    let chordIdx = 0;

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx] ?? '';
      if (chordIdx < validChords.length && wIdx === chordIdx * step) {
        resultWords.push(`[${validChords[chordIdx]}]${word}`);
        chordIdx++;
      } else {
        resultWords.push(word);
      }
    }

    // Si quedaron acordes sobrantes, agregarlos al final
    while (chordIdx < validChords.length) {
      resultWords.push(`[${validChords[chordIdx]}]`);
      chordIdx++;
    }

    return resultWords.join(' ');
  }
}
