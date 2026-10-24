/**
 * @file pdf-chord-extractor.ts
 * @description Utilidad universal (Browser / Node.js) para extracción de texto y detección
 * de acordes, letras y tablaturas en documentos musicales (Fase B/3).
 */

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
  return /^[eEbBgGdDaA1-6]\s*[-|]/.test(trimmed) && trimmed.includes('-');
}

/**
 * Filtra líneas de ruido institucional y numeración aislada.
 */
export function isNoiseLine(line: string): boolean {
  const trimmed = line.trim().toUpperCase();
  if (!trimmed) return true;
  if (/^\d{1,3}$/.test(trimmed)) return true;
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
 * Parsea canciones a partir de un texto plano dividido por saltos de línea o páginas.
 */
export function parseSongsFromRawText(rawText: string, defaultTitle?: string): ExtractedSongBlock[] {
  // 1. Si el texto contiene saltos de página de documento (\f), separadores explícitos (---),
  // o líneas en blanco seguidas de un nuevo encabezado de canción con autor entre paréntesis o prefijo CANCION
  const rawSections = rawText.split(
    /(?:\f|---\s*(?:NUEVA CANCION|PAGINA|\d+)?\s*---|(?:\r?\n){2,}(?=(?:CANCION\s*\d*:|[^\r\n()]{3,}\([^\r\n()]+\))))/i
  );

  const sectionsToProcess = rawSections.length > 1
    ? rawSections
    : [rawText];

  const songBlocks: ExtractedSongBlock[] = [];

  for (let sIdx = 0; sIdx < sectionsToProcess.length; sIdx++) {
    const sectionText = sectionsToProcess[sIdx] ?? '';
    const lines = sectionText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !isNoiseLine(l));

    if (lines.length === 0) continue;

    let hasChords = false;
    let hasTablature = false;
    let detectedKey: string | null = null;

    // Buscar indicación explícita de tono (ej. "Tono: G", "Key: G")
    for (const line of lines) {
      const keyMatch = line.match(/^(?:Tono|Key|Ton):\s*([A-G][b#]?[m]?)/i);
      if (keyMatch && keyMatch[1]) {
        detectedKey = keyMatch[1];
        break;
      }
    }

    for (const line of lines) {
      if (isTabLine(line)) hasTablature = true;
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

    const firstLine = lines[0] ?? '';
    let title = (rawSections.length === 1 && defaultTitle) ? defaultTitle : firstLine;
    let artist: string | null = null;
    const authorMatch = firstLine.match(/^(?:CANCION\s*\d*:\s*)?(.*?)\s*[\(\[](.*?)[\)\]]?$/i);
    if (authorMatch && authorMatch[1]) {
      title = authorMatch[1].trim();
      artist = (authorMatch[2] ?? '').replace(/[\\)\]]+$/, '').trim() || null;
    }

    songBlocks.push({
      id: `song-raw-section-${sIdx + 1}`,
      pageNumber: sIdx + 1,
      title: title || defaultTitle || `Canción ${sIdx + 1}`,
      artist,
      rawLines: lines,
      column: 'SINGLE',
      hasChords,
      hasTablature,
      detectedKey: detectedKey || 'C',
    });
  }

  return songBlocks;
}

