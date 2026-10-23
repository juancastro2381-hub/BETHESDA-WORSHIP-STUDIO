/**
 * @file types.ts
 * @description Tipos fundamentales, estados y diagnósticos del subsistema de ingesta musical.
 */

import { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';

export type ImportFormat = 'MUSIC_XML' | 'CHORD_PRO' | 'PDF' | 'IMAGE';

export type IngestionStatus = 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'FAILED';

export type DiagnosticSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface DiagnosticSourceLocation {
  measureNumber?: number;
  voiceId?: number;
  elementName?: string;
  lineNumber?: number;
  columnNumber?: number;
  token?: string;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  location?: DiagnosticSourceLocation;
  context?: Record<string, unknown>;
}

export interface SourceProvenance {
  sourceFormat: ImportFormat;
  sourceName?: string | undefined;
  importer: string;
  importerVersion: string;
  importTimestamp: string;
  sourceHash?: string | undefined;
  inputMetadata?: Record<string, unknown> | undefined;
  capoFret?: number | undefined;
}

export interface ImportStatistics {
  measureCount: number;
  noteCount: number;
  restCount: number;
  chordCount: number;
  lyricCount: number;
  sectionCount: number;
  trackCount: number;
  durationTicks: number;
  durationSeconds: number;
}

export interface ImportOptions {
  sourceName?: string | undefined;
  defaultKey?: string | undefined;
  defaultTimeSignature?: string | undefined;
  defaultBpm?: number | undefined;
  generateMissingSections?: boolean | undefined;
}

export interface IngestionResultJSON {
  status: IngestionStatus;
  provenance: SourceProvenance;
  diagnostics: Diagnostic[];
  statistics?: ImportStatistics;
  payload?: unknown;
}
