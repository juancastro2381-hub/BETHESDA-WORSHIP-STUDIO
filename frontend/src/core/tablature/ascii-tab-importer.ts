/**
 * @file ascii-tab-importer.ts
 * @description Importador y normalizador de tablaturas ASCII hacia CanonicalMusicPayload (Fase 2B.2).
 *
 * Implementa el contrato unificado MusicImporter preservando la independencia total del resto de la arquitectura.
 * Principio: CERO invención de timing; notas no medidas mantienen ticks en null.
 */

import { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { InstrumentTrack } from '../canonical-model/instrument-track.ts';
import { Measure } from '../canonical-model/measure.ts';
import { Note, Voice } from '../canonical-model/musical-event.ts';
import { Section } from '../canonical-model/section.ts';
import { Timeline } from '../canonical-model/timeline.ts';
import { type ArticulationType } from '../canonical-model/types.ts';
import { IngestionResult, type MusicImporter } from '../ingestion/importer-contract.ts';
import { ProvenanceManager } from '../ingestion/provenance.ts';
import {
  type Diagnostic,
  type ImportFormat,
  type ImportOptions,
  type ImportStatistics,
} from '../ingestion/types.ts';
import { AsciiTabParser, type ParsedTabScore } from './ascii-tab-parser.ts';

export class AsciiTabImporter implements MusicImporter {
  public readonly format: ImportFormat = 'TABLATURE';
  public readonly name: string = 'Bethesda ASCII Tablature Importer';
  public readonly version: string = '1.0.0';

  public canHandle(source: string, filename?: string): boolean {
    if (filename && filename.toLowerCase().trim().endsWith('.tab')) {
      return true;
    }

    if (!source || typeof source !== 'string') {
      return false;
    }

    const trimmed = source.trim();
    // Detección de patrones característicos de tablatura (ej. e|---, |---2---3---|)
    const hasTabLines = /\|[-0-9pxbshrv\/\*<>\s~]{4,}\|/i.test(trimmed);
    const hasStringPrefixes = /^[A-Ga-g][b#]?\d?\s*\|[-0-9]/m.test(trimmed);

    return hasTabLines || hasStringPrefixes;
  }

  public import(source: string, options?: ImportOptions): IngestionResult {
    const trimmed = source ? source.trim() : '';
    if (!trimmed) {
      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: 'TABLATURE',
          sourceName: options?.sourceName,
          importer: this.name,
          importerVersion: this.version,
        }),
        diagnostics: [
          {
            code: 'EMPTY_SOURCE',
            severity: 'ERROR',
            message: 'El contenido de la tablatura está vacío.',
          },
        ],
      });
    }

    const parseOpts: {
      title?: string | undefined;
      sourceName?: string | undefined;
    } = {};
    if (options?.sourceName) {
      parseOpts.title = options.sourceName.replace(/\.[^.]+$/, '');
      parseOpts.sourceName = options.sourceName;
    }

    let parsedScore: ParsedTabScore;
    try {
      parsedScore = AsciiTabParser.parse(source, parseOpts);
    } catch (err) {
      const isSizeError = (err as Error).message.includes('excede el límite máximo');
      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: 'TABLATURE',
          sourceName: options?.sourceName,
          importer: this.name,
          importerVersion: this.version,
        }),
        diagnostics: [
          {
            code: isSizeError ? 'INPUT_TOO_LARGE' : 'TAB_PARSER_ERROR',
            severity: 'ERROR',
            message: (err as Error).message,
          },
        ],
      });
    }

    const diagnostics: Diagnostic[] = parsedScore.diagnostics.map((d) => {
      const diag: Diagnostic = {
        code: d.code,
        severity: d.severity,
        message: d.message,
      };
      if (d.lineNumber !== undefined || d.columnNumber !== undefined) {
        diag.location = {};
        if (d.lineNumber !== undefined) diag.location.lineNumber = d.lineNumber;
        if (d.columnNumber !== undefined) diag.location.columnNumber = d.columnNumber;
      }
      return diag;
    });

    if (parsedScore.totalNotes === 0 && parsedScore.measures.length === 0) {
      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: 'TABLATURE',
          sourceName: options?.sourceName,
          importer: this.name,
          importerVersion: this.version,
        }),
        diagnostics:
          diagnostics.length > 0
            ? diagnostics
            : [
                {
                  code: 'NO_NOTES_FOUND',
                  severity: 'ERROR',
                  message: 'No se encontraron notas musicales válidas en la tablatura.',
                },
              ],
      });
    }

    // Normalización hacia CanonicalMusicPayload
    const payload = this.normalizeToCanonical(parsedScore, options);

    const hasErrors = diagnostics.some((d) => d.severity === 'ERROR');
    const hasWarnings = diagnostics.some((d) => d.severity === 'WARNING');
    const status = hasErrors ? 'FAILED' : hasWarnings ? 'SUCCESS_WITH_WARNINGS' : 'SUCCESS';

    const statistics: ImportStatistics = {
      measureCount: payload.measures.length,
      noteCount: payload.getAllNotes().length,
      restCount: payload.getAllRests().length,
      chordCount: payload.getAllChords().length,
      lyricCount: payload.getAllLyrics().length,
      sectionCount: payload.sections.length,
      trackCount: payload.instrumentTracks.length,
      durationTicks: payload.timeline.totalDurationTicks,
      durationSeconds: payload.timeline.totalDurationSeconds,
    };

    const resultInit: {
      status: typeof status;
      payload?: CanonicalMusicPayload;
      provenance: ReturnType<typeof ProvenanceManager.create>;
      diagnostics: Diagnostic[];
      statistics?: ImportStatistics;
    } = {
      status,
      provenance: ProvenanceManager.create({
        sourceFormat: 'TABLATURE',
        sourceName: options?.sourceName,
        importer: this.name,
        importerVersion: this.version,
        inputMetadata: {
          instrument: parsedScore.instrument,
          tuningName: parsedScore.tuningName,
          stringLabels: parsedScore.stringLabels,
          rhythmicProvenance: parsedScore.rhythmicProvenance,
        },
      }),
      diagnostics,
      statistics,
    };
    if (!hasErrors) {
      resultInit.payload = payload;
    }

    return new IngestionResult(resultInit);
  }

  private normalizeToCanonical(
    score: ParsedTabScore,
    options?: ImportOptions
  ): CanonicalMusicPayload {
    const isUnmeasured = score.rhythmicProvenance === 'NONE';
    const trackId = 'track_tab_1';

    // 1. Pista Instrumental
    const instrumentTrack = new InstrumentTrack({
      id: trackId,
      name: score.instrument === 'BASS' ? 'Bajo Eléctrico' : 'Guitarra',
      family: score.instrument,
      clef: score.instrument === 'BASS' ? 'BASS' : 'TREBLE',
      transpositionOffsetSemitones: 0,
      voiceIds: [1],
      staffCount: 1,
    });

    // 2. Compases y Voces
    const canonicalMeasures: Measure[] = [];
    const sectionMeasureMap = new Map<string, number[]>();

    let cumulativeStartTick: number | null = isUnmeasured ? null : 0;

    for (let mIdx = 0; mIdx < score.measures.length; mIdx++) {
      const parsedM = score.measures[mIdx]!;
      const notes: Note[] = [];

      let measureDurationTicks: number | null = null;
      // CERO FABRICACIÓN (Defecto A): Un compás solo posee duración si TODAS sus notas tienen timing explícito
      const hasUntimedNotesInMeasure = parsedM.notes.some(
        (n) => n.startTick === null || n.durationTicks === null
      );
      if (!isUnmeasured && parsedM.notes.length > 0 && !hasUntimedNotesInMeasure) {
        const maxEndTick = parsedM.notes.reduce((max, n) => {
          return Math.max(max, (n.startTick ?? 0) + (n.durationTicks ?? 0));
        }, 0);
        measureDurationTicks = maxEndTick > 0 ? maxEndTick : null;
      }

      for (let nIdx = 0; nIdx < parsedM.notes.length; nIdx++) {
        const pNote = parsedM.notes[nIdx]!;
        if (!pNote.resolvedPitch) continue;

        const noteArticulations: ArticulationType[] = [];
        if (pNote.isMuted) noteArticulations.push('ghost');
        if (pNote.isHarmonic) noteArticulations.push('harmonic');
        if (pNote.articulation === 'VIBRATO') noteArticulations.push('accent');

        const absStartTick =
          isUnmeasured || pNote.startTick === null || cumulativeStartTick === null
            ? null
            : cumulativeStartTick + pNote.startTick;

        const note = new Note({
          id: `tab_note_m${parsedM.measureNumber}_${nIdx + 1}`,
          pitch: pNote.resolvedPitch,
          startTick: absStartTick,
          durationTicks: isUnmeasured ? null : (pNote.durationTicks ?? null),
          voice: 1,
          staff: 1,
          velocity: pNote.isMuted ? 30 : 80,
          articulations: noteArticulations,
          notationMetadata: {
            tablature: {
              stringNumber: pNote.stringNumber,
              fret: pNote.fret,
              isMuted: pNote.isMuted,
              isHarmonic: pNote.isHarmonic,
              articulation: pNote.articulation,
              visualColumnIndex: pNote.visualColumnIndex,
              lineNumber: pNote.lineNumber,
              sourceFragment: pNote.sourceFragment,
              chordId: pNote.chordId,
              rhythmToken: pNote.rhythmToken,
            },
          },
        });
        if (pNote.chordId) {
          (note as any).chordId = pNote.chordId;
        }
        notes.push(note);
      }

      const voice = new Voice(1, notes);

      const measure = new Measure({
        number: parsedM.measureNumber,
        timeSignature: null,
        keySignature: null,
        startTick: cumulativeStartTick,
        durationTicks: measureDurationTicks,
        voices: [voice],
      });

      canonicalMeasures.push(measure);

      if (parsedM.sectionName) {
        let arr = sectionMeasureMap.get(parsedM.sectionName);
        if (!arr) {
          arr = [];
          sectionMeasureMap.set(parsedM.sectionName, arr);
        }
        arr.push(parsedM.measureNumber);
      }

      if (cumulativeStartTick !== null) {
        if (measureDurationTicks !== null) {
          cumulativeStartTick += measureDurationTicks;
        } else {
          cumulativeStartTick = null; // Un compás con duración desconocida corta el inicio de compases subsiguientes
        }
      }
    }

    // 3. Secciones
    const sections: Section[] = [];
    let secIndex = 1;
    for (const [secName, mNums] of sectionMeasureMap.entries()) {
      if (mNums.length === 0) continue;
      const startM = Math.min(...mNums);
      const endM = Math.max(...mNums);
      sections.push(
        new Section({
          id: `sec_${secIndex++}`,
          label: secName,
          type: 'CUSTOM',
          startMeasure: startM,
          measureCount: endM - startM + 1,
          startTick: null,
          durationTicks: null,
        })
      );
    }

    // 4. Timeline
    const allNotesInPayload = canonicalMeasures.flatMap((m) => m.getAllNotes());
    const hasAnyUntimedNotes =
      allNotesInPayload.length === 0 ||
      allNotesInPayload.some((n) => n.startTick === null || n.durationTicks === null);

    const totalTicks =
      isUnmeasured || hasAnyUntimedNotes || cumulativeStartTick === null ? null : cumulativeStartTick;
    const timeline = new Timeline({
      tpqn: 480,
      totalDurationTicks: totalTicks,
      measureCount: canonicalMeasures.length,
      isUnmetered: isUnmeasured || hasAnyUntimedNotes,
    });

    return new CanonicalMusicPayload({
      title: options?.sourceName ? options.sourceName.replace(/\.[^.]+$/, '') : score.title,
      timeline,
      sections,
      measures: canonicalMeasures,
      instrumentTracks: [instrumentTrack],
      metadata: {
        rhythmicProvenance: score.rhythmicProvenance,
        tuningName: score.tuningName,
        stringLabels: score.stringLabels,
        instrument: score.instrument,
        tuningPitches: score.tuning.map((p) => p.toString()),
        unpitchedTabEvents: score.measures.flatMap((m) =>
          m.notes
            .filter((n) => !n.resolvedPitch)
            .map((n) => ({
              measureNumber: m.measureNumber,
              stringNumber: n.stringNumber,
              fret: n.fret,
              isMuted: n.isMuted,
              isHarmonic: n.isHarmonic,
              visualColumnIndex: n.visualColumnIndex,
              sourceFragment: n.sourceFragment,
              lineNumber: n.lineNumber,
            }))
        ),
      },
    });
  }
}
