/**
 * @file importer-contract.ts
 * @description Contrato unificado de ingesta musical (MusicImporter) y contenedor
 * del resultado de ingesta (IngestionResult).
 */

import { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import {
  type Diagnostic,
  type ImportFormat,
  type ImportOptions,
  type ImportStatistics,
  type IngestionResultJSON,
  type IngestionStatus,
  type SourceProvenance,
} from './types.ts';

export class IngestionResult {
  public readonly status: IngestionStatus;
  public readonly payload?: CanonicalMusicPayload;
  public readonly provenance: SourceProvenance;
  public readonly diagnostics: readonly Diagnostic[];
  public readonly statistics?: ImportStatistics;

  public constructor(init: {
    status: IngestionStatus;
    payload?: CanonicalMusicPayload;
    provenance: SourceProvenance;
    diagnostics?: Diagnostic[];
    statistics?: ImportStatistics;
  }) {
    this.status = init.status;
    if (init.payload) this.payload = init.payload;
    this.provenance = init.provenance;
    this.diagnostics = Object.freeze([...(init.diagnostics ?? [])]);
    if (init.statistics) this.statistics = init.statistics;
  }

  public get isSuccess(): boolean {
    return this.status === 'SUCCESS' || this.status === 'SUCCESS_WITH_WARNINGS';
  }

  public get hasWarnings(): boolean {
    return this.diagnostics.some((d) => d.severity === 'WARNING');
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === 'ERROR');
  }

  public static computeStatistics(payload: CanonicalMusicPayload): ImportStatistics {
    const allNotes = payload.getAllNotes();
    const allRests = payload.getAllRests();
    const allChords = payload.getAllChords();
    const allLyrics = payload.getAllLyrics();

    return {
      measureCount: payload.measures.length,
      noteCount: allNotes.length,
      restCount: allRests.length,
      chordCount: allChords.length,
      lyricCount: allLyrics.length,
      sectionCount: payload.sections.length,
      trackCount: payload.instrumentTracks.length,
      durationTicks: payload.timeline.totalDurationTicks,
      durationSeconds: payload.timeline.totalDurationSeconds,
    };
  }

  public toJSON(): IngestionResultJSON {
    const json: IngestionResultJSON = {
      status: this.status,
      provenance: this.provenance,
      diagnostics: [...this.diagnostics],
    };
    if (this.statistics) json.statistics = this.statistics;
    if (this.payload) json.payload = this.payload.toJSON();
    return json;
  }
}

/**
 * Contrato unificado de importador musical independiente del framework.
 */
export interface MusicImporter {
  readonly format: ImportFormat;
  readonly name: string;
  readonly version: string;

  /**
   * Determina si este importador puede procesar el contenido o archivo provisto.
   */
  canHandle(source: string, filename?: string): boolean;

  /**
   * Ejecuta la ingesta, normalización a 480 TPQN y validación de dominio.
   */
  import(source: string, options?: ImportOptions): IngestionResult;
}
