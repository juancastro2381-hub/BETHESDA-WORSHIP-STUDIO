/**
 * @file types.ts
 * @description Tipos, estados, contratos de adaptadores y DTOs del subsistema universal de ingesta musical (Fase 1B).
 */

import type { CanonicalMusicPayloadJSON } from '../../../../frontend/src/core/canonical-model/index.ts';
import type { AuthenticatedUser } from '../auth-types.ts';

export type IngestionSourceType =
  | 'MUSICXML'
  | 'MIDI'
  | 'CHORDPRO'
  | 'WRITTEN_NOTES'
  | 'PDF_SCORE'
  | 'IMAGE_SCORE'
  | 'AUDIO'
  | 'VIDEO_URL';

export type IngestionStatus =
  | 'IMPORTED'
  | 'PARSED'
  | 'SOURCE_PRESERVED'
  | 'REGISTERED'
  | 'RECOGNITION_PENDING'
  | 'RECOGNITION_UNAVAILABLE'
  | 'PARTIALLY_CONVERTED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'PENDING_REVIEW'
  | 'CONVERTED'
  | 'FAILED';

export type IngestionSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface IngestionDiagnostic {
  code: string;
  severity: IngestionSeverity;
  message: string;
  location?: {
    measureNumber?: number;
    trackIndex?: number;
    voice?: number;
    lineNumber?: number;
    columnNumber?: number;
  };
  context?: Record<string, unknown>;
}

export interface WrittenNoteInput {
  step: string; // 'A'..'G'
  octave: number; // 0..9
  alter?: number; // -2..2
  duration: 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
  isRest?: boolean;
  velocity?: number; // 0..127
  voice?: number;
  staff?: number;
}

export interface WrittenChordInput {
  root: string; // 'A'..'G'
  alter?: number;
  quality: string; // 'maj', 'm', '7', 'sus4', etc.
  bass?: string;
  startTick: number;
}

export interface WrittenLyricInput {
  text: string;
  startTick: number;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
}

export interface WrittenMeasureInput {
  measureNumber: number;
  timeSignature?: { numerator: number; denominator: number };
  keySignature?: string; // e.g. 'C', 'G', 'Eb'
  tempoBpm?: number;
  notes: WrittenNoteInput[];
  chords?: WrittenChordInput[];
  lyrics?: WrittenLyricInput[];
}

export interface WrittenNotesPayload {
  title: string;
  artist?: string;
  timeSignature?: { numerator: number; denominator: number };
  keySignature?: string;
  tempoBpm?: number;
  measures: WrittenMeasureInput[];
}

export interface IngestionInput {
  sourceType?: IngestionSourceType;
  filename?: string;
  mimeType?: string;
  buffer?: Buffer;
  rawText?: string;
  videoUrl?: string;
  writtenNotes?: WrittenNotesPayload;
  title?: string;
  artist?: string;
  targetFormat?: 'SHEET_MUSIC' | 'CHORDS_WITH_LYRICS' | 'LYRICS_ONLY' | 'TABLATURE';
  metadata?: Record<string, unknown>;
}

export interface IngestionOutput {
  status: IngestionStatus;
  sourceType: IngestionSourceType;
  sourceHash: string;
  sourceChecksumSha256?: string;
  sourceId?: string;
  filename?: string;
  storageKey?: string;
  title: string;
  artist: string | null;
  defaultKey: string | null;
  defaultBpm: number | null;
  timeSignature: string | null;
  canonicalPayload?: CanonicalMusicPayloadJSON | null;
  diagnostics: IngestionDiagnostic[];
  recognitionStatusMessage?: string;
  songId?: string | null;
  versionId?: string | null;
}

export interface IIngestionAdapter {
  readonly sourceType: IngestionSourceType;
  readonly name: string;
  readonly version: string;
  canHandle(input: IngestionInput): boolean;
  detectMimeType?(buffer: Buffer): string | undefined;
  ingest(input: IngestionInput, user: AuthenticatedUser): Promise<IngestionOutput>;
}
