/**
 * @file types.ts
 * @description Tipos y contratos para el Centro de Conversión Musical de Bethesda Worship Studio (Fase 2A).
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';

export type ConversionSourceCategory =
  | 'STRUCTURED_MUSICXML'
  | 'STRUCTURED_MIDI'
  | 'STRUCTURED_CHORDPRO'
  | 'WRITTEN_NOTES'
  | 'PDF_SCORE'
  | 'IMAGE_SCORE'
  | 'AUDIO_RECORDING'
  | 'VIDEO_REFERENCE';

export type ConversionTargetFormat =
  | 'MUSIC_XML'
  | 'MIDI'
  | 'CHORD_PRO'
  | 'LYRICS_ONLY'
  | 'ENGRAVED_PDF'
  | 'TABLATURE';

export type ConversionStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'REVIEW_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type DiagnosticSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface ConversionDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  measureNumber?: number | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface ConversionOptions {
  targetFormat: ConversionTargetFormat;
  title?: string | undefined;
  artist?: string | undefined;
  keyOverride?: string | undefined;
  timeSignatureOverride?: string | undefined;
  bpmOverride?: number | undefined;
  transposeSemitones?: number | undefined;
  quantizationGrid?: 'NONE' | 'QUARTER' | 'EIGHTH' | 'SIXTEENTH' | 'TRIPLET' | undefined;
}

export interface ConversionExportResult {
  success: boolean;
  targetFormat: ConversionTargetFormat;
  filename: string;
  mimeType: string;
  content: string | Uint8Array;
  canonicalPayload?: CanonicalMusicPayload | undefined;
  diagnostics: ConversionDiagnostic[];
  isAiDraft?: boolean | undefined;
  reviewRequired?: boolean | undefined;
}

export interface FormatCapabilityInfo {
  format: ConversionTargetFormat;
  label: string;
  extension: string;
  mimeType: string;
  isAvailable: boolean;
  statusBadge: 'NATIVE' | 'CONVERTED' | 'AI_DRAFT' | 'BLOCKED_ZERO_FABRICATION' | 'DEFERRED_PHASE';
  description: string;
  blockingReason?: string | undefined;
}

