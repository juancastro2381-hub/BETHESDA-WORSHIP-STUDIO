/**
 * @file pdf-text-extractor.ts
 * @description Extractor determinista de texto, acordes y canciones desde flujos PDF
 * para cancioneros y partituras de Bethesda Worship Studio.
 *
 * Características:
 * 1. Descompresión de streams FlateDecode estándar de PDF en memoria.
 * 2. Extracción de coordenadas espaciales (x, y) de operadores Tm/Td y tokens de texto (Tj, TJ).
 * 3. Detección y separación de diagramaciones multicolumna (ej. columnas izquierda y derecha en CMB AZUL).
 * 4. Filtrado de pies/encabezados institucionales repetitivos y numeración de páginas.
 * 5. Segmentación precisa de canciones con identificación de título, artista y tonalidad preliminar.
 */

import zlib from 'node:zlib';

export interface ExtractedTextBlock {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface ExtractedTextLine {
  readonly y: number;
  readonly text: string;
  readonly items: ExtractedTextBlock[];
}

export interface ExtractedSongBlock {
  readonly id: string;
  readonly pageNumber: number;
  readonly title: string;
  readonly artist: string | null;
  readonly rawLines: string[];
  readonly column: 'LEFT' | 'RIGHT' | 'SINGLE';
  readonly hasChords: boolean;
  readonly hasTablature: boolean;
  readonly detectedKey: string | null;
}

export interface ExtractedDocument {
  readonly totalPages: number;
  readonly songs: ExtractedSongBlock[];
  readonly rawPagesText: Array<{
    pageNumber: number;
    text: string;
    hasTwoColumns: boolean;
  }>;
}

const CHORD_TOKEN_REGEX =
  /^[A-G][b#]?(?:m|maj|min|dim|aug|sus|add|M|[0-9])*(?:\/[A-G][b#]?)?$/;

/**
 * Determina si un token individual representa un acorde musical cifrado.
 */
export function isChordToken(token: string): boolean {
  const clean = token.replace(/^[\\(\\/\\-]+|[\\)\\/\\-\\.,;:!]+$/g, '').trim();
  if (!clean) return false;
  return CHORD_TOKEN_REGEX.test(clean);
}

/**
 * Determina si una línea completa está compuesta predominantemente por acordes.
 */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  let chordCount = 0;
  for (const t of tokens) {
    if (
      isChordToken(t) ||
      t === '-' ||
      t === '/' ||
      t === '|' ||
      t.startsWith('//') ||
      t.startsWith('Intro:') ||
      t.startsWith('Capo:') ||
      t.startsWith('Coro:') ||
      t.includes('x2') ||
      t.includes('x4')
    ) {
      chordCount++;
    }
  }

  return chordCount / tokens.length >= 0.55;
}

/**
 * Determina si una línea es parte de una tablatura de guitarra/bajo en formato ASCII.
 */
export function isTabLine(line: string): boolean {
  const trimmed = line.trim();
  // Ej: E-------17--15--13-------- o B-25-25---25--25--27-25-23 o G---19-19-19-17slide19
  return /^[eEbBgGdDaA1-6]\s*[-|]/.test(trimmed) && trimmed.includes('-');
}

/**
 * Filtra líneas de ruido institucional y numeración aislada.
 */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim().toUpperCase();
  if (!trimmed) return true;
  if (/^\d{1,3}$/.test(trimmed)) return true; // Números de página aislados
  if (trimmed.includes('CENTRO MISIONERO BETHESDA')) return true;
  if (trimmed.includes('MADRID CUNDINAMARCA')) return true;
  if (trimmed.includes('MINISTERIO DE ALABANZA')) return true;
  if (trimmed.includes('GENERACION DE FUEGO') || trimmed.includes('GENERACIÓN DE FUEGO')) return true;
  if (trimmed.includes('TABLA DE CONTENIDO') || trimmed.startsWith('PÁGINA') || trimmed.startsWith('PAGINA')) return true;
  return false;
}

/**
 * Agrupa bloques de texto con coordenadas en líneas horizontales coherentes.
 */
export function clusterIntoLines(blocks: ExtractedTextBlock[]): ExtractedTextLine[] {
  const sorted = [...blocks].sort((a, b) => b.y - a.y);
  const lines: ExtractedTextLine[] = [];
  let currentLine: ExtractedTextBlock[] = [];
  let currentY: number | null = null;

  for (const block of sorted) {
    if (currentY === null || Math.abs(currentY - block.y) <= 3.5) {
      currentLine.push(block);
      currentY = currentY === null ? block.y : (currentY + block.y) / 2;
    } else {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push({
        y: currentY,
        items: currentLine,
        text: currentLine.map((i) => i.text).join(' '),
      });
      currentLine = [block];
      currentY = block.y;
    }
  }

  if (currentLine.length > 0 && currentY !== null) {
    currentLine.sort((a, b) => a.x - b.x);
    lines.push({
      y: currentY,
      items: currentLine,
      text: currentLine.map((i) => i.text).join(' '),
    });
  }

  return lines;
}

/**
 * Descomprime y analiza flujos de texto PDF deterministas.
 */
export class PdfTextExtractor {
  /**
   * Extrae todas las páginas y canciones estructuradas de un documento PDF.
   */
  public static extractFromBuffer(pdfBuffer: Buffer): ExtractedDocument {
    const latinText = pdfBuffer.toString('latin1');
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    const decompressedStreams: string[] = [];

    while ((match = streamRegex.exec(latinText)) !== null) {
      try {
        const rawStream = Buffer.from(match[1], 'latin1');
        const dec = zlib.inflateSync(rawStream).toString('utf-8');
        if (dec.includes('BT') && (dec.includes('Tj') || dec.includes('TJ'))) {
          decompressedStreams.push(dec);
        }
      } catch {
        // Stream no FlateDecode o no textual
      }
    }

    const rawPagesText: Array<{
      pageNumber: number;
      text: string;
      hasTwoColumns: boolean;
    }> = [];

    const songs: ExtractedSongBlock[] = [];
    let pageCounter = 0;

    for (const streamContent of decompressedStreams) {
      pageCounter++;
      const btRegex = /BT([\s\S]*?)ET/g;
      let bMatch: RegExpExecArray | null;
      const blocks: ExtractedTextBlock[] = [];

      while ((bMatch = btRegex.exec(streamContent)) !== null) {
        const content = bMatch[1];
        let x = 0;
        let y = 0;
        const tmMatch = content.match(/1\s+0\s+0\s+1\s+([\d.]+)\s+([\d.]+)\s+Tm/);
        if (tmMatch) {
          x = parseFloat(tmMatch[1]);
          y = parseFloat(tmMatch[2]);
        }

        const tokenRegex = /(?:\(([\s\S]*?)\)\s*Tj|\[([\s\S]*?)\]\s*TJ)/g;
        let tMatch: RegExpExecArray | null;
        let text = '';

        while ((tMatch = tokenRegex.exec(content)) !== null) {
          if (tMatch[1] !== undefined) {
            text += tMatch[1];
          } else if (tMatch[2] !== undefined) {
            const innerRegex = /\(([\s\S]*?)\)/g;
            let im: RegExpExecArray | null;
            while ((im = innerRegex.exec(tMatch[2])) !== null) {
              text += im[1];
            }
          }
        }

        // Desescapar caracteres especiales
        text = text
          .replace(/\\\\/g, '\\')
          .replace(/\\([()])/g, '$1')
          .trim();

        if (text) {
          blocks.push({ x, y, text });
        }
      }

      if (blocks.length === 0) continue;

      // Detectar si la página tiene dos columnas analizando la distribución de X
      const leftBlocks = blocks.filter((b) => b.x < 285);
      const rightBlocks = blocks.filter((b) => b.x >= 285);
      const hasTwoColumns = leftBlocks.length > 5 && rightBlocks.length > 5;

      const leftLines = clusterIntoLines(leftBlocks)
        .map((l) => l.text)
        .filter((l) => !isNoiseLine(l));
      const rightLines = clusterIntoLines(rightBlocks)
        .map((l) => l.text)
        .filter((l) => !isNoiseLine(l));

      const fullPageText = hasTwoColumns
        ? leftLines.join('\n') + '\n\n' + rightLines.join('\n')
        : clusterIntoLines(blocks)
            .map((l) => l.text)
            .filter((l) => !isNoiseLine(l))
            .join('\n');

      rawPagesText.push({
        pageNumber: pageCounter,
        text: fullPageText,
        hasTwoColumns,
      });

      // Procesar columnas como canciones independientes
      if (hasTwoColumns) {
        if (leftLines.length > 0) {
          const song = this.parseSongFromLines(leftLines, pageCounter, 'LEFT');
          if (song) songs.push(song);
        }
        if (rightLines.length > 0) {
          const song = this.parseSongFromLines(rightLines, pageCounter, 'RIGHT');
          if (song) songs.push(song);
        }
      } else {
        const pageLines = clusterIntoLines(blocks)
          .map((l) => l.text)
          .filter((l) => !isNoiseLine(l));
        if (pageLines.length > 0) {
          const song = this.parseSongFromLines(pageLines, pageCounter, 'SINGLE');
          if (song) songs.push(song);
        }
      }
    }

    return {
      totalPages: Math.max(pageCounter, decompressedStreams.length),
      songs,
      rawPagesText,
    };
  }

  /**
   * Extrae la identidad y metadatos de una canción a partir de sus líneas agrupadas.
   */
  private static parseSongFromLines(
    lines: string[],
    pageNumber: number,
    column: 'LEFT' | 'RIGHT' | 'SINGLE'
  ): ExtractedSongBlock | null {
    if (lines.length === 0) return null;

    // La primera línea suele ser el título y autor: ej. "Danzo en el rio ( miel san marcos)"
    let rawTitleLine = lines[0];
    let artist: string | null = null;
    let title = rawTitleLine;

    // Buscar si la línea 1 o 2 contiene paréntesis con el autor: ej. (Jaime Murrell)
    const authorInTitleMatch = rawTitleLine.match(/^(.*?)\s*\((.*?)\)?$/);
    if (authorInTitleMatch) {
      title = authorInTitleMatch[1].trim();
      artist = authorInTitleMatch[2].replace(/[\\)]+$/, '').trim();
    } else if (lines.length > 1 && lines[1].startsWith('(') && lines[1].endsWith(')')) {
      artist = lines[1].slice(1, -1).trim();
    }

    // Limpieza de caracteres de escape
    title = title.replace(/[\\()]+/g, '').trim();
    if (!title) title = `Canción Pág. ${pageNumber}`;

    // Detectar presencia de acordes y tonalidad
    let hasChords = false;
    let hasTablature = false;
    let detectedKey: string | null = null;

    for (const line of lines) {
      if (isTabLine(line) || line.includes('SOLO BAJO:') || line.includes('SOLO DE GUITARRA:')) {
        hasTablature = true;
      }
      if (isChordLine(line)) {
        hasChords = true;
        if (!detectedKey) {
          const tokens = line.split(/\s+/).filter(Boolean);
          for (const t of tokens) {
            if (isChordToken(t)) {
              detectedKey = t.replace(/^[\\(\\/\\-]+|[\\)\\/\\-\\.,;:!]+$/g, '');
              break;
            }
          }
        }
      }
    }

    return {
      id: `song-p${pageNumber}-${column.toLowerCase()}`,
      pageNumber,
      title,
      artist,
      rawLines: lines,
      column,
      hasChords,
      hasTablature,
      detectedKey: detectedKey || 'C',
    };
  }
}
