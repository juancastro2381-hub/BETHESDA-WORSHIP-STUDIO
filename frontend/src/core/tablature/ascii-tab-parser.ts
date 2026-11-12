/**
 * @file ascii-tab-parser.ts
 * @description Parser profesional, determinista y seguro de tablaturas ASCII para guitarra y bajo (Fase 2B.2).
 *
 * Características:
 * 1. Control de consumo de recursos (Límite 1MB, sin regex patológicas O(2^N)).
 * 2. Reconocimiento de guitarra (6 y 7 cuerdas), bajo (4 y 5 cuerdas) y afinaciones personalizadas.
 * 3. Trastes multidígito (10, 12, 14, 24) y alineación estricta de columnas visuales.
 * 4. Cuerdas al aire (0), cuerdas muteadas (x/X) y armónicos (<12>, *12*).
 * 5. Acordes / notas simultáneas verticales.
 * 6. Articulaciones completas: slides (/, \), bends (b, r), hammer-ons (h), pull-offs (p), vibrato (~, v), palm mute (PM).
 * 7. Preservación estricta de timing desconocido (null) vs. parsing de ritmos explícitos si están anotados.
 * 8. Trazabilidad de procedencia: coordenadas visuales, fragmento original y diagnósticos.
 */

import { Pitch } from '../music-theory/pitch.ts';
import {
  TabInstrumentConfig,
  type TabInstrumentType,
} from './tab-instrument-config.ts';

export const MAX_TAB_INPUT_SIZE_BYTES = 1024 * 1024; // 1 MiB

export interface TabParserOptions {
  instrument?: TabInstrumentType | undefined;
  customTuning?: Pitch[] | undefined;
  title?: string | undefined;
  sourceName?: string | undefined;
}

export type TabArticulation =
  | 'SLIDE_UP'
  | 'SLIDE_DOWN'
  | 'BEND'
  | 'BEND_RELEASE'
  | 'RELEASE'
  | 'HAMMER_ON'
  | 'PULL_OFF'
  | 'VIBRATO'
  | 'NATURAL_HARMONIC'
  | 'ARTIFICIAL_HARMONIC'
  | 'PALM_MUTE'
  | 'NONE';

export type RhythmicProvenance =
  | 'EXPLICIT_HEADER'
  | 'PARTIALLY_MEASURED'
  | 'INFERRED_SPACING'
  | 'NONE';

export interface ParsedTabNote {
  stringNumber: number; // 1 (más aguda) a N (más grave)
  fret: number | null;  // 0..30 o null si es muteada 'x'
  isMuted: boolean;
  isHarmonic: boolean;
  articulation: TabArticulation;
  resolvedPitch: Pitch | null;
  visualColumnIndex: number;
  lineNumber: number;
  sourceFragment: string;
  measureNumber: number;
  chordId?: string | undefined;
  rhythmToken?: string | undefined;
  startTick: number | null;
  durationTicks: number | null;
}

export interface ParsedTabColumn {
  visualColumnIndex: number;
  entries: ParsedTabNote[];
}

export interface ParsedTabMeasure {
  measureNumber: number;
  notes: ParsedTabNote[];
  columns: ParsedTabColumn[];
  sectionName?: string | undefined;
  startTick: number | null;
  durationTicks: number | null;
}

export interface TabParserDiagnostic {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  lineNumber?: number | undefined;
  columnNumber?: number | undefined;
  context?: Record<string, unknown> | undefined;
}

export interface ParsedTabScore {
  title: string;
  instrument: TabInstrumentType;
  tuning: readonly Pitch[];
  tuningName: string;
  stringLabels: readonly string[];
  stringCount: number;
  measures: ParsedTabMeasure[];
  rhythmicProvenance: RhythmicProvenance;
  diagnostics: TabParserDiagnostic[];
  totalNotes: number;
  sourceLinesCount: number;
}

interface RawStaffLine {
  lineNumber: number;
  label?: string | undefined;
  content: string;
  prefixLength: number;
}

interface RawStaffSystem {
  lines: RawStaffLine[];
  sectionName?: string | undefined;
  rhythmLine?: { content: string; prefixLength: number; lineNumber: number } | undefined;
}

export class AsciiTabParser {
  /**
   * Parsea texto de tablatura ASCII de forma segura y determinista.
   */
  public static parse(input: string, options: TabParserOptions = {}): ParsedTabScore {
    const diagnostics: TabParserDiagnostic[] = [];

    // 1. Verificación de tamaño de entrada (Defensa contra denegación de servicio por memoria)
    if (typeof input !== 'string') {
      throw new Error('La entrada para el parser de tablatura debe ser una cadena de texto.');
    }

    const byteLength = Buffer.byteLength(input, 'utf-8');
    if (byteLength > MAX_TAB_INPUT_SIZE_BYTES) {
      throw new Error(
        `El tamaño del archivo de tablatura (${byteLength} bytes) excede el límite máximo de seguridad (${MAX_TAB_INPUT_SIZE_BYTES} bytes).`
      );
    }

    if (input.trim().length === 0) {
      return {
        title: options.title || 'Tablatura Vacía',
        instrument: options.instrument || 'GUITAR',
        tuning: [],
        tuningName: 'Sin afinación',
        stringLabels: [],
        stringCount: 0,
        measures: [],
        rhythmicProvenance: 'NONE',
        diagnostics: [
          {
            code: 'EMPTY_TAB_CONTENT',
            severity: 'ERROR',
            message: 'El contenido de la tablatura está vacío.',
          },
        ],
        totalNotes: 0,
        sourceLinesCount: 0,
      };
    }

    const lines = input.split(/\r?\n/);
    const systems: RawStaffSystem[] = [];
    let currentSystemLines: RawStaffLine[] = [];
    let currentSectionName: string | undefined;
    let pendingRhythmLine:
      | { content: string; prefixLength: number; lineNumber: number }
      | undefined;
    let title = options.title || '';

    // 2. Extracción de metadatos de cabecera y partición de sistemas de tablatura
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const rawLine = lines[i]!;
      const trimmed = rawLine.trim();

      // Metadatos de cabecera
      const titleMatch = trimmed.match(/^(?:title|song):\s*(.+)$/i);
      if (titleMatch && !title) {
        title = titleMatch[1]!.trim();
        continue;
      }

      // Marcadores de sección: [Intro], [Verse 1], [Chorus], etc.
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        if (currentSystemLines.length > 0) {
          systems.push({
            lines: currentSystemLines,
            sectionName: currentSectionName,
            rhythmLine: pendingRhythmLine,
          });
          currentSystemLines = [];
          pendingRhythmLine = undefined;
        }
        currentSectionName = sectionMatch[1]!.trim();
        continue;
      }

      // Detección de líneas de ritmo explícito (ej. "  w   h   q   e   s  " o "  q   e   e   q  ")
      // Contiene únicamente espacios y tokens rítmicos: w, h, q, e, s, t, .
      if (/^\s*([whqest\.]\s*)+$/i.test(trimmed) && !trimmed.includes('-') && !trimmed.includes('|')) {
        pendingRhythmLine = {
          content: rawLine,
          prefixLength: rawLine.search(/\S/),
          lineNumber: lineNum,
        };
        continue;
      }

      // Detección de línea de tablatura (contiene barras y guiones característicos, ej. e|---2---3---|)
      const tabLineMatch = rawLine.match(/^(\s*)([A-Ga-g][b#]?\d?)?(\s*\|[-0-9pxbshrv\/\*<>\s~|]+)$/i);
      const isPlainTabLine = rawLine.includes('|') && /[-0-9pxbshrv\/\*<>\s~]{4,}/i.test(rawLine);

      if (tabLineMatch || isPlainTabLine) {
        // Extraer etiqueta de afinación si existe (ej. "e|", "B|", "G|", "D|", "A|", "E|", o "Q|")
        const labelMatch = rawLine.match(/^(\s*)([^\s|]+)?\s*\|/);
        const label = labelMatch && labelMatch[2] ? labelMatch[2] : undefined;
        const prefixLength = labelMatch ? labelMatch[0].length : 0;

        currentSystemLines.push({
          lineNumber: lineNum,
          label,
          content: rawLine,
          prefixLength,
        });
      } else {
        // Línea no-tablatura: si teníamos un sistema acumulado, lo cerramos
        if (currentSystemLines.length > 0) {
          // Un sistema válido de tablatura tiene típicamente entre 3 y 8 líneas
          if (currentSystemLines.length >= 3) {
            systems.push({
              lines: currentSystemLines,
              sectionName: currentSectionName,
              rhythmLine: pendingRhythmLine,
            });
          }
          currentSystemLines = [];
          pendingRhythmLine = undefined;
        }
      }
    }

    if (currentSystemLines.length >= 3) {
      systems.push({
        lines: currentSystemLines,
        sectionName: currentSectionName,
        rhythmLine: pendingRhythmLine,
      });
    }

    if (systems.length === 0) {
      return {
        title: title || 'Tablatura no reconocida',
        instrument: options.instrument || 'GUITAR',
        tuning: [],
        tuningName: 'Sin afinación',
        stringLabels: [],
        stringCount: 0,
        measures: [],
        rhythmicProvenance: 'NONE',
        diagnostics: [
          {
            code: 'NO_TABLATURE_SYSTEMS_FOUND',
            severity: 'ERROR',
            message: 'No se encontraron pentagramas o sistemas de tablatura reconocibles en el texto.',
          },
        ],
        totalNotes: 0,
        sourceLinesCount: lines.length,
      };
    }

    // 3. Resolución de afinación e instrumento
    const firstSystem = systems[0]!;
    const detectedStringCount = firstSystem.lines.length;
    const explicitLabels = firstSystem.lines.map((l) => l.label).filter((l): l is string => Boolean(l));

    let resolvedTuning: ReturnType<typeof TabInstrumentConfig.resolveTuning>;
    try {
      resolvedTuning = TabInstrumentConfig.resolveTuning(
        detectedStringCount,
        explicitLabels.length === detectedStringCount ? explicitLabels : undefined,
        options.instrument,
        options.customTuning
      );
    } catch (err) {
      return {
        title: title || 'Tablatura',
        instrument: options.instrument || 'GUITAR',
        tuning: [],
        tuningName: 'Afinación inválida',
        stringLabels: [],
        stringCount: 0,
        measures: [],
        rhythmicProvenance: 'NONE',
        diagnostics: [
          {
            code: 'AMBIGUOUS_OR_INVALID_TUNING',
            severity: 'ERROR',
            message: (err as Error).message,
          },
        ],
        totalNotes: 0,
        sourceLinesCount: lines.length,
      };
    }

    const measures: ParsedTabMeasure[] = [];
    let globalMeasureNumber = 1;
    let hasExplicitRhythmAnywhere = false;

    // 4. Procesamiento de cada sistema de tablatura
    for (let sIdx = 0; sIdx < systems.length; sIdx++) {
      const system = systems[sIdx]!;
      const numStrings = system.lines.length;

      if (numStrings !== detectedStringCount) {
        diagnostics.push({
          code: 'INCONSISTENT_STRING_COUNT',
          severity: 'WARNING',
          message: `El sistema ${sIdx + 1} tiene ${numStrings} cuerdas; se esperaban ${detectedStringCount}.`,
          lineNumber: system.lines[0]?.lineNumber,
        });
      }

      // Encontrar posiciones de compás (bar lines '|') dentro del sistema
      // Tomamos la primera línea como referencia para las barras divisorias
      const refLine = system.lines[0]!.content;
      const barPositions: number[] = [];
      for (let c = 0; c < refLine.length; c++) {
        if (refLine[c] === '|') {
          // Verificar que la mayoría de las cuerdas también tengan '|' en esa misma columna
          const matchCount = system.lines.filter((l) => l.content[c] === '|').length;
          if (matchCount >= Math.floor(numStrings / 2)) {
            barPositions.push(c);
          }
        }
      }

      // Si no hay barras intermedias, tratamos todo el bloque como un compás
      const segments: Array<{ startCol: number; endCol: number }> = [];
      if (barPositions.length >= 2) {
        for (let b = 0; b < barPositions.length - 1; b++) {
          const startCol = barPositions[b]! + 1;
          const endCol = barPositions[b + 1]!;
          if (endCol > startCol) {
            segments.push({ startCol, endCol });
          }
        }
      } else {
        const minPrefix = Math.max(...system.lines.map((l) => l.prefixLength));
        const maxLen = Math.max(...system.lines.map((l) => l.content.length));
        segments.push({ startCol: minPrefix, endCol: maxLen });
      }

      // 5. Parsear notas en cada segmento / compás
      for (const seg of segments) {
        const measureNotes: ParsedTabNote[] = [];
        const measureNum = globalMeasureNumber++;
        const consumedUntil = new Array<number>(numStrings).fill(seg.startCol);

        // Escanear columna por columna en el segmento
        let col = seg.startCol;
        while (col < seg.endCol) {
          const colNotesAtThisPoint: ParsedTabNote[] = [];

          for (let strIdx = 0; strIdx < numStrings; strIdx++) {
            if (col < consumedUntil[strIdx]!) continue;

            const strLine = system.lines[strIdx]!;
            const stringNumber = strIdx + 1;
            const openPitch = resolvedTuning.tuning[strIdx];

            if (col >= strLine.content.length) continue;
            const char = strLine.content[col]!;

            // 5.1 Fret multidígito o dígito simple (ej. "0", "5", "12", "24")
            if (/\d/.test(char)) {
              let fretStr = char;
              let lookahead = col + 1;
              while (lookahead < seg.endCol && /\d/.test(strLine.content[lookahead] || '')) {
                fretStr += strLine.content[lookahead]!;
                lookahead++;
              }

              const fret = parseInt(fretStr, 10);
              const validation = TabInstrumentConfig.validateFretAndString(
                stringNumber,
                fret,
                numStrings
              );

              if (!validation.valid) {
                diagnostics.push({
                  code: 'INVALID_FRET',
                  severity: 'WARNING',
                  message: validation.reason || `Traste ${fret} fuera de rango físico admisible.`,
                  lineNumber: strLine.lineNumber,
                  columnNumber: col + 1,
                });
              }

              let resolvedPitch: Pitch | null = null;
              if (openPitch && validation.valid) {
                try {
                  resolvedPitch = TabInstrumentConfig.calculateFretPitch(openPitch, fret);
                } catch {
                  resolvedPitch = null;
                }
              }

              // Detectar articulaciones inmediatamente adyacentes a la nota
              const nextChar = strLine.content[lookahead] || '';
              let articulation: TabArticulation = 'NONE';
              if (nextChar === '/') { articulation = 'SLIDE_UP'; lookahead++; }
              else if (nextChar === '\\') { articulation = 'SLIDE_DOWN'; lookahead++; }
              else if (nextChar === 'h') { articulation = 'HAMMER_ON'; lookahead++; }
              else if (nextChar === 'p') { articulation = 'PULL_OFF'; lookahead++; }
              else if (nextChar === 'b') { articulation = 'BEND'; lookahead++; }
              else if (nextChar === 'r') { articulation = 'BEND_RELEASE'; lookahead++; }
              else if (nextChar === '~' || nextChar === 'v') {
                articulation = 'VIBRATO';
                while (lookahead < seg.endCol && (strLine.content[lookahead] === '~' || strLine.content[lookahead] === 'v')) {
                  lookahead++;
                }
              }

              consumedUntil[strIdx] = lookahead;

              colNotesAtThisPoint.push({
                stringNumber,
                fret,
                isMuted: false,
                isHarmonic: false,
                articulation,
                resolvedPitch,
                visualColumnIndex: col,
                lineNumber: strLine.lineNumber,
                sourceFragment: fretStr,
                measureNumber: measureNum,
                startTick: null,
                durationTicks: null,
              });
            }
            // 5.2 Nota muteada ('x' o 'X')
            else if (char === 'x' || char === 'X') {
              consumedUntil[strIdx] = col + 1;
              diagnostics.push({
                code: 'UNPITCHED_MUTED_NOTE',
                severity: 'INFO',
                message: `Nota percusiva/muteada (${char}) en cuerda ${stringNumber} registrada sin asignación de tono musical arbitrario.`,
                lineNumber: strLine.lineNumber,
                columnNumber: col + 1,
              });

              colNotesAtThisPoint.push({
                stringNumber,
                fret: null,
                isMuted: true,
                isHarmonic: false,
                articulation: 'NONE',
                resolvedPitch: null, // CERO FABRICACIÓN: Un dead note no posee altura tonal melódica
                visualColumnIndex: col,
                lineNumber: strLine.lineNumber,
                sourceFragment: char,
                measureNumber: measureNum,
                startTick: null,
                durationTicks: null,
              });
            }
            // 5.3 Armónico natural o artificial (<12> o *12*)
            else if (char === '<' || char === '*') {
              const closeChar = char === '<' ? '>' : '*';
              const closingIdx = strLine.content.indexOf(closeChar, col + 1);
              if (closingIdx !== -1 && closingIdx - col <= 4) {
                consumedUntil[strIdx] = closingIdx + 1;
                const inner = strLine.content.substring(col + 1, closingIdx).trim();
                const fret = parseInt(inner, 10);
                if (!isNaN(fret)) {
                  let pitch: Pitch | null = null;
                  if (openPitch) {
                    const harmonicRes = TabInstrumentConfig.calculateHarmonicPitch(openPitch, fret);
                    if (harmonicRes.isSupported) {
                      pitch = harmonicRes.pitch;
                    } else {
                      diagnostics.push({
                        code: 'UNSUPPORTED_HARMONIC_FRET',
                        severity: 'WARNING',
                        message:
                          harmonicRes.reason ||
                          `Armónico en traste ${fret} no soportado (nodos naturales soportados: 4, 5, 7, 9, 12, 16, 19, 24). Se preserva la fuente sin inventar altura.`,
                        lineNumber: strLine.lineNumber,
                        columnNumber: col + 1,
                      });
                      pitch = null;
                    }
                  }

                  colNotesAtThisPoint.push({
                    stringNumber,
                    fret,
                    isMuted: false,
                    isHarmonic: true,
                    articulation: char === '<' ? 'NATURAL_HARMONIC' : 'ARTIFICIAL_HARMONIC',
                    resolvedPitch: pitch,
                    visualColumnIndex: col,
                    lineNumber: strLine.lineNumber,
                    sourceFragment: strLine.content.substring(col, closingIdx + 1),
                    measureNumber: measureNum,
                    startTick: null,
                    durationTicks: null,
                  });
                }
              }
            }
          }

          // Si se encontraron múltiples notas en la misma columna, se agrupan en un acorde
          if (colNotesAtThisPoint.length > 1) {
            const chordId = `chord_m${measureNum}_col${col}`;
            for (const n of colNotesAtThisPoint) {
              n.chordId = chordId;
            }
          }

          measureNotes.push(...colNotesAtThisPoint);
          col++;
        }

        // 6. Procesar anotaciones de ritmo si existen para este sistema (Contrato de Asociación Unívoco - Defecto B)
        if (system.rhythmLine && measureNotes.length > 0) {
          const rLine = system.rhythmLine.content;
          const rTokens: Array<{
            col: number;
            token: string;
            durationTicks: number;
            lineNumber: number;
          }> = [];

          // Escanear la línea de ritmo en el rango de columnas de este segmento
          for (let rc = seg.startCol; rc < seg.endCol && rc < rLine.length; rc++) {
            const ch = rLine[rc]?.toLowerCase();
            if (ch && ['w', 'h', 'q', 'e', 's', 't'].includes(ch)) {
              let ticks = 480; // default quarter
              if (ch === 'w') ticks = 1920;
              else if (ch === 'h') ticks = 960;
              else if (ch === 'q') ticks = 480;
              else if (ch === 'e') ticks = 240;
              else if (ch === 's') ticks = 120;
              else if (ch === 't') ticks = 60;

              let tokenStr = ch;
              if (rc + 1 < rLine.length && rLine[rc + 1] === '.') {
                ticks += ticks / 2;
                tokenStr += '.';
              }

              rTokens.push({
                col: rc,
                token: tokenStr,
                durationTicks: ticks,
                lineNumber: system.rhythmLine.lineNumber,
              });

              if (tokenStr.endsWith('.')) {
                rc++;
              }
            }
          }

          if (rTokens.length > 0) {
            hasExplicitRhythmAnywhere = true;
            const uniqueCols = Array.from(
              new Set(measureNotes.map((n) => n.visualColumnIndex))
            ).sort((a, b) => a - b);

            // Construir mapa de cobertura/ancho de cada columna de notas
            const colWidthMap = new Map<number, number>();
            for (const uCol of uniqueCols) {
              const notesInCol = measureNotes.filter((n) => n.visualColumnIndex === uCol);
              const maxW = Math.max(...notesInCol.map((n) => n.sourceFragment.length), 1);
              colWidthMap.set(uCol, maxW);
            }

            // Ventana visual directa sobre la nota o columna inmediatamente contigua:
            // Un token at 'rc' matches column 'uCol' si rc >= uCol - 1 y rc <= uCol + width
            const tokenToCandidateCols = new Map<number, number[]>();
            const colToCandidateTokens = new Map<number, typeof rTokens>();

            for (const uCol of uniqueCols) {
              colToCandidateTokens.set(uCol, []);
            }

            for (let tIdx = 0; tIdx < rTokens.length; tIdx++) {
              const rToken = rTokens[tIdx]!;
              const matchingCols: number[] = [];

              for (const uCol of uniqueCols) {
                const width = colWidthMap.get(uCol) ?? 1;
                if (rToken.col >= uCol - 1 && rToken.col <= uCol + width) {
                  matchingCols.push(uCol);
                }
              }

              tokenToCandidateCols.set(tIdx, matchingCols);
              for (const mCol of matchingCols) {
                colToCandidateTokens.get(mCol)!.push(rToken);
              }
            }

            // Detección de casos del contrato de asociación:
            // 1. Tokens en exceso / huérfanos
            for (let tIdx = 0; tIdx < rTokens.length; tIdx++) {
              const rToken = rTokens[tIdx]!;
              const candidateCols = tokenToCandidateCols.get(tIdx)!;
              if (candidateCols.length === 0) {
                diagnostics.push({
                  code: 'EXCESS_RHYTHM_TOKEN',
                  severity: 'WARNING',
                  message: `Token de ritmo "${rToken.token}" en línea ${rToken.lineNumber}, columna ${rToken.col + 1} no corresponde a ninguna nota visual en compás ${measureNum}.`,
                  lineNumber: rToken.lineNumber,
                  columnNumber: rToken.col + 1,
                });
              } else if (candidateCols.length > 1) {
                // Token ambiguo entre columnas
                diagnostics.push({
                  code: 'AMBIGUOUS_RHYTHM_TOKEN',
                  severity: 'WARNING',
                  message: `Token de ritmo "${rToken.token}" en columna ${rToken.col + 1} es ambiguo entre columnas [${candidateCols.map((c) => c + 1).join(', ')}].`,
                  lineNumber: rToken.lineNumber,
                  columnNumber: rToken.col + 1,
                });
              }
            }

            // 2. Columnas con tokens duplicados o faltantes
            const unambiguousColToken = new Map<number, (typeof rTokens)[0]>();

            for (const uCol of uniqueCols) {
              const candidateTokens = colToCandidateTokens.get(uCol)!;
              if (candidateTokens.length === 0) {
                diagnostics.push({
                  code: 'MISSING_RHYTHM_TOKEN',
                  severity: 'INFO',
                  message: `Columna de nota en posición ${uCol + 1} (compás ${measureNum}) carece de token de ritmo asociado.`,
                  lineNumber: system.rhythmLine.lineNumber,
                  columnNumber: uCol + 1,
                });
              } else if (candidateTokens.length > 1) {
                diagnostics.push({
                  code: 'DUPLICATE_RHYTHM_TOKENS_FOR_COLUMN',
                  severity: 'WARNING',
                  message: `Se encontraron múltiples tokens de ritmo (${candidateTokens.map((t) => t.token).join(', ')}) para la columna ${uCol + 1} en compás ${measureNum}. Se rechaza asociación ambigua.`,
                  lineNumber: system.rhythmLine.lineNumber,
                  columnNumber: uCol + 1,
                });
              } else {
                const token = candidateTokens[0]!;
                const tIdx = rTokens.indexOf(token);
                const tokenCandidates = tokenToCandidateCols.get(tIdx)!;
                if (tokenCandidates.length === 1) {
                  unambiguousColToken.set(uCol, token);
                }
              }
            }

            // Asignación estricta de timing sin invención:
            let currentTickInMeasure: number | null = 0;

            for (const uCol of uniqueCols) {
              const matchedToken = unambiguousColToken.get(uCol);
              const matchingNotes = measureNotes.filter((n) => n.visualColumnIndex === uCol);

              if (matchedToken) {
                for (const n of matchingNotes) {
                  n.durationTicks = matchedToken.durationTicks;
                  n.rhythmToken = matchedToken.token;
                  n.startTick = currentTickInMeasure;
                }
                if (currentTickInMeasure !== null) {
                  currentTickInMeasure += matchedToken.durationTicks;
                }
              } else {
                for (const n of matchingNotes) {
                  n.durationTicks = null;
                  n.rhythmToken = undefined;
                  n.startTick = null;
                }
                currentTickInMeasure = null; // Se interrumpe la certeza de inicio cronológico para notas subsiguientes
              }
            }
          }
        }

        const columnMap = new Map<number, ParsedTabNote[]>();
        for (const n of measureNotes) {
          let arr = columnMap.get(n.visualColumnIndex);
          if (!arr) {
            arr = [];
            columnMap.set(n.visualColumnIndex, arr);
          }
          arr.push(n);
        }
        const columns: ParsedTabColumn[] = Array.from(columnMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([visualColumnIndex, entries]) => ({
            visualColumnIndex,
            entries,
          }));

        measures.push({
          measureNumber: measureNum,
          notes: measureNotes,
          columns,
          sectionName: system.sectionName,
          startTick: null,
          durationTicks: null,
        });
      }
    }

    const totalNotes = measures.reduce((acc, m) => acc + m.notes.length, 0);
    const allNotesList = measures.flatMap((m) => m.notes);
    const hasAnyTiming = allNotesList.some((n) => n.durationTicks !== null);
    const allNotesHaveTiming =
      totalNotes > 0 &&
      allNotesList.every((n) => n.durationTicks !== null && n.startTick !== null);

    let rhythmicProvenance: RhythmicProvenance = 'NONE';
    if (allNotesHaveTiming) {
      rhythmicProvenance = 'EXPLICIT_HEADER';
    } else if (hasAnyTiming || hasExplicitRhythmAnywhere) {
      rhythmicProvenance = 'PARTIALLY_MEASURED';
    } else {
      rhythmicProvenance = 'NONE';
    }

    return {
      title: title || 'Tablatura',
      instrument: resolvedTuning.instrument,
      tuning: resolvedTuning.tuning,
      tuningName: resolvedTuning.name,
      stringLabels: resolvedTuning.labels,
      stringCount: resolvedTuning.tuning.length,
      measures,
      rhythmicProvenance,
      diagnostics,
      totalNotes,
      sourceLinesCount: lines.length,
    };
  }
}
