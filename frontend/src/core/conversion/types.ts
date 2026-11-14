/**
 * @file types.ts
 * @description Tipos y contratos para el Centro de Conversión Musical de Bethesda Worship Studio (Fase 2A).
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';

/**
 * Estados de capacidad.
 * - SUPPORTED / PARTIALLY_SUPPORTED / NOT_SUPPORTED: capacidades operativas actuales.
 * - PLANNED_PHASE_2B: identificador HISTÓRICO (Fase 2A) para capacidades diferidas de OMR/PDF. Se conserva por
 *   compatibilidad con datos y pruebas; su reconciliación con la hoja de ruta se documenta en
 *   docs/audio/AUDIO_ROADMAP_AND_ACCEPTANCE_MATRIX.md.
 * - PLANNED_AUDIO_WORKSTREAM: audio→notación autorizado en principio (Opción 1C), aún NO implementado:
 *   WS-AUDIO-02 (acordes/ChordPro) y WS-AUDIO-03 (MIDI/MusicXML/Tablatura), sujetos a puertas de aceptación.
 */
export type CapabilityState =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'NOT_SUPPORTED'
  | 'PLANNED_PHASE_2B'
  | 'PLANNED_AUDIO_WORKSTREAM';

export type StatusBadge =
  | 'NATIVE'
  | 'CONVERTED'
  | 'AI_DRAFT'
  | 'BLOCKED_ZERO_FABRICATION'
  | 'DEFERRED_PHASE';

export type ConversionSourceCategory =
  | 'STRUCTURED_MUSICXML'
  | 'STRUCTURED_MIDI'
  | 'STRUCTURED_CHORDPRO'
  | 'TXT_LYRICS'
  | 'WRITTEN_NOTES'
  | 'PDF_SCORE'
  | 'IMAGE_SCORE'
  | 'AUDIO_RECORDING'
  | 'VIDEO_REFERENCE'
  | 'TABLATURE_ASCII'
  | 'UNKNOWN_UNSUPPORTED';

export interface SourceCapabilitySummary {
  category: ConversionSourceCategory;
  label: string;
  state: CapabilityState;
  description: string;
  canConvert: boolean;
  /** WS-AUDIO-01: el archivo puede preservarse de forma duradera en el servidor y reproducirse (audio). */
  canPreserve?: boolean | undefined;
  advisoryNotice?: string | undefined;
}

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
  capabilityState: CapabilityState;
  statusBadge: StatusBadge;
  description: string;
  blockingReason?: string | undefined;
}

