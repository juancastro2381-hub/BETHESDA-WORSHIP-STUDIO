/**
 * @file tablature-serializer.ts
 * @description Serializador y formateador profesional y determinista de CanonicalMusicPayload
 * hacia tablatura ASCII estándar para guitarra y bajo (Fase 2B.2).
 *
 * Características:
 * 1. Alineación vertical estricta de cuerdas con compensación automática de anchos para trastes multidígito (10, 12, 14, 24).
 * 2. Soporte para Guitarra (6 y 7 cuerdas), Bajo (4 y 5 cuerdas) y afinaciones personalizadas.
 * 3. Encabezados descriptivos (Título, Instrumento, Afinación y advertencia explícita de CERO Fabricación si es no medida).
 * 4. Barras de compás delimitadas y alineadas verticalmente entre todas las cuerdas.
 * 5. Determinismo estricto: idéntica entrada genera idéntica salida byte por byte.
 * 6. Cálculo automático de digitaciones ergonómicas si el material proviene de partitura o MIDI sin metadatos previos.
 */

import { type CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { type Measure } from '../../canonical-model/measure.ts';
import { type Note } from '../../canonical-model/musical-event.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { TablatureCalculator } from '../../projection/tablature-calculator.ts';
import {
  type TabInstrumentType,
  GUITAR_6_STANDARD,
  BASS_4_STANDARD,
  TabInstrumentConfig,
} from '../../tablature/tab-instrument-config.ts';
import {
  type ConversionDiagnostic,
  type ConversionExportResult,
} from '../types.ts';

export interface TablatureExportOptions {
  instrument?: TabInstrumentType;
  measuresPerSystem?: number; // Por defecto 2 compases por línea
  includeRhythmHeader?: boolean;
}

interface ColumnCell {
  stringNumber: number; // 1..N
  text: string;
}

interface ColumnStep {
  cells: Map<number, string>;
  width: number;
  rhythmToken?: string | undefined;
}

export class CanonicalToTablatureSerializer {
  /**
   * Serializa un CanonicalMusicPayload a una representación en texto plano de tablatura ASCII.
   */
  public static serialize(
    payload: CanonicalMusicPayload,
    options: TablatureExportOptions = {}
  ): ConversionExportResult {
    const diagnostics: ConversionDiagnostic[] = [];

    if (!payload || !payload.title) {
      throw new Error('No se puede serializar un CanonicalMusicPayload nulo o sin título.');
    }

    const measuresPerSystem = options.measuresPerSystem ?? 2;
    const allNotes = payload.getAllNotes();

    // 1. Detección de instrumento y afinación
    const track = payload.instrumentTracks[0];
    const isBass =
      options.instrument === 'BASS' ||
      track?.family === 'BASS' ||
      (payload.metadata as Record<string, unknown> | undefined)?.instrument === 'BASS';

    const defaultPreset = isBass ? BASS_4_STANDARD : GUITAR_6_STANDARD;
    const instrumentName = isBass ? 'Bajo' : 'Guitarra';

    // Recuperar afinación de metadatos si está disponible
    const rawLabels = (payload.metadata as Record<string, unknown> | undefined)?.stringLabels as
      | string[]
      | undefined;
    const stringLabels = rawLabels && rawLabels.length > 0 ? rawLabels : defaultPreset.stringLabels;
    const stringCount = stringLabels.length;

    let tuningPreset: ReturnType<typeof TabInstrumentConfig.resolveTuning>;
    try {
      tuningPreset = TabInstrumentConfig.resolveTuning(
        stringCount,
        stringLabels,
        isBass ? 'BASS' : 'GUITAR'
      );
    } catch {
      tuningPreset = {
        tuning: defaultPreset.stringPitches,
        labels: defaultPreset.stringLabels,
        instrument: isBass ? 'BASS' : 'GUITAR',
        name: defaultPreset.name,
        isCustom: false,
      };
    }

    const isUnmeasured =
      (payload.metadata as Record<string, unknown> | undefined)?.rhythmicProvenance === 'NONE' ||
      allNotes.some((n) => n.startTick === null || n.durationTicks === null);

    // 2. Construcción de cabecera documental
    const outputLines: string[] = [];
    outputLines.push(`################################################################`);
    outputLines.push(`# BETHESDA WORSHIP STUDIO — TABLATURA CANÓNICA ASCII`);
    outputLines.push(`# Obra: ${payload.title}`);
    outputLines.push(`# Instrumento: ${instrumentName} (${tuningPreset.name})`);
    outputLines.push(`# Cuerdas: [${stringLabels.join(' ')}]`);
    if (isUnmeasured) {
      outputLines.push(`# NOTA: Tablatura no medida. Métrica temporal no asignada (CERO Fabricación).`);
    }
    outputLines.push(`################################################################`);
    outputLines.push('');

    if (payload.measures.length === 0) {
      diagnostics.push({
        code: 'EMPTY_TABLATURE_EXPORT',
        severity: 'WARNING',
        message: 'La obra no contiene compases; se genera plantilla vacía de tablatura.',
      });
      return {
        success: true,
        targetFormat: 'TABLATURE',
        filename: `${this.sanitizeFilename(payload.title)}.tab`,
        mimeType: 'text/plain',
        content: outputLines.join('\n'),
        canonicalPayload: payload,
        diagnostics,
      };
    }

    // 3. Procesamiento de compases agrupados por sistemas
    for (let i = 0; i < payload.measures.length; i += measuresPerSystem) {
      const systemMeasures = payload.measures.slice(i, i + measuresPerSystem);

      // Etiqueta de compases para el sistema (ej. "[Compás 1 - 2]")
      const firstM = systemMeasures[0]!.number;
      const lastM = systemMeasures[systemMeasures.length - 1]!.number;
      const section = payload.getSectionForMeasure(firstM);
      const sectionHeader = section ? `[${section.label}] ` : '';
      outputLines.push(`${sectionHeader}Compás ${firstM}${lastM !== firstM ? ` - ${lastM}` : ''}`);

      // Generar columnas para cada compás del sistema
      const formattedMeasures = systemMeasures.map((m) =>
        this.formatMeasureColumns(m, stringCount, tuningPreset.tuning, diagnostics)
      );

      // Comprobar si hay línea de ritmo para este sistema
      const hasAnyRhythm = formattedMeasures.some((fm) => fm.hasRhythm);
      if (hasAnyRhythm && options.includeRhythmHeader !== false) {
        const rhythmLineParts: string[] = [];
        const prefixSpaces = ' '.repeat(4); // e|-- tiene 4 chars
        rhythmLineParts.push(prefixSpaces);

        for (const fm of formattedMeasures) {
          rhythmLineParts.push(' '); // para la barra inicial '|'
          for (const step of fm.steps) {
            const token = step.rhythmToken || ' ';
            rhythmLineParts.push(token.padEnd(step.width + 1, ' '));
          }
          rhythmLineParts.push(' '); // para la barra final '|'
        }
        outputLines.push(rhythmLineParts.join(''));
      }

      // Renderizar cada cuerda de 1 a N
      for (let s = 1; s <= stringCount; s++) {
        const label = (stringLabels[s - 1] || ' ').padEnd(2, ' ');
        const lineParts: string[] = [];
        lineParts.push(`${label}|`);

        for (const fm of formattedMeasures) {
          lineParts.push('-');
          for (const step of fm.steps) {
            const cellText = step.cells.get(s);
            if (cellText !== undefined) {
              lineParts.push(cellText.padEnd(step.width, '-'));
            } else {
              lineParts.push('-'.repeat(step.width));
            }
            lineParts.push('-'); // Separador entre pasos
          }
          lineParts.push('|');
        }

        outputLines.push(lineParts.join(''));
      }

      outputLines.push(''); // Línea en blanco entre sistemas
    }

    const finalContent = outputLines.join('\n');

    return {
      success: true,
      targetFormat: 'TABLATURE',
      filename: `${this.sanitizeFilename(payload.title)}.tab`,
      mimeType: 'text/plain',
      content: finalContent,
      canonicalPayload: payload,
      diagnostics,
    };
  }

  private static formatMeasureColumns(
    measure: Measure,
    totalStrings: number,
    tuningPitches: readonly Pitch[],
    diagnostics: ConversionDiagnostic[]
  ): { steps: ColumnStep[]; hasRhythm: boolean } {
    const notes = measure.getAllNotes();
    let hasRhythm = false;

    if (notes.length === 0) {
      // Compás vacío: 8 guiones de pausa
      const emptyStep: ColumnStep = {
        cells: new Map(),
        width: 8,
      };
      return { steps: [emptyStep], hasRhythm: false };
    }

    // Agrupar notas por columna visual o por startTick
    const columnMap = new Map<number | string, Note[]>();
    for (const note of notes) {
      const tabMeta = (note.notationMetadata as Record<string, unknown> | undefined)?.tablature as
        | Record<string, unknown>
        | undefined;
      const key =
        tabMeta?.visualColumnIndex !== undefined
          ? `col_${tabMeta.visualColumnIndex}`
          : note.startTick !== null
          ? `tick_${note.startTick}`
          : `id_${note.id}`;

      let arr = columnMap.get(key);
      if (!arr) {
        arr = [];
        columnMap.set(key, arr);
      }
      arr.push(note);
    }

    const steps: ColumnStep[] = [];

    for (const [, colNotes] of columnMap.entries()) {
      const cells = new Map<number, string>();
      let maxCellWidth = 1;
      let stepRhythmToken: string | undefined;

      for (const note of colNotes) {
        const tabMeta = (note.notationMetadata as Record<string, unknown> | undefined)?.tablature as
          | Record<string, unknown>
          | undefined;

        let stringNumber: number;
        let fretText: string;

        if (tabMeta && typeof tabMeta.stringNumber === 'number') {
          stringNumber = tabMeta.stringNumber;
          if (tabMeta.isMuted) {
            fretText = 'x';
          } else if (tabMeta.fret !== null && tabMeta.fret !== undefined) {
            fretText = String(tabMeta.fret);
            // Incluir símbolos de articulación
            if (tabMeta.articulation === 'SLIDE_UP') fretText += '/';
            else if (tabMeta.articulation === 'SLIDE_DOWN') fretText += '\\';
            else if (tabMeta.articulation === 'HAMMER_ON') fretText += 'h';
            else if (tabMeta.articulation === 'PULL_OFF') fretText += 'p';
            else if (tabMeta.articulation === 'BEND') fretText += 'b';
            else if (tabMeta.articulation === 'VIBRATO') fretText += '~';
          } else {
            fretText = '0';
          }
          if (tabMeta.rhythmToken) {
            stepRhythmToken = String(tabMeta.rhythmToken);
            hasRhythm = true;
          }
        } else {
          // Si no tiene metadatos de tablatura (ej. importada de MusicXML/MIDI), calculamos la digitación óptima
          const tuningDef = {
            id: 'export_tuning',
            name: 'Afinación de Exportación',
            stringPitches: tuningPitches,
          };
          const calcPos = TablatureCalculator.calculatePosition(
            note.pitch,
            tuningDef,
            0,
            note.durationTicks ?? 480,
            note.voice
          );
          if (calcPos) {
            stringNumber = calcPos.stringNumber;
            fretText = String(calcPos.fret);
          } else {
            // Nota fuera del diapasón de este instrumento
            stringNumber = 1;
            fretText = '?';
            diagnostics.push({
              code: 'NOTE_EXCEEDS_TAB_RANGE',
              severity: 'WARNING',
              message: `La nota ${note.pitch.toString()} excede el registro de tablatura.`,
              measureNumber: measure.number,
            });
          }
        }

        cells.set(stringNumber, fretText);
        if (fretText.length > maxCellWidth) {
          maxCellWidth = fretText.length;
        }
      }

      const step: ColumnStep = {
        cells,
        width: Math.max(maxCellWidth, 1),
      };
      if (stepRhythmToken !== undefined) {
        step.rhythmToken = stepRhythmToken;
      }
      steps.push(step);
    }

    return { steps, hasRhythm };
  }

  private static sanitizeFilename(title: string): string {
    return (
      title
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 50) || 'tablatura'
    );
  }
}
