/**
 * @file types.ts
 * @description Tipos de dominio para Reconocimiento Óptico de Música (OMR / IA) (Fase 3C — D2).
 *
 * Principio mandatorio:
 * El resultado de OMR es SIEMPRE una propuesta (isAiDraft: true) con revisión humana
 * obligatoria antes de persistirse como canción canónica.
 */

export interface OmrNoteDetected {
  step: string;
  octave: number;
  duration: string;
  confidence: number;
}

export interface OmrChordDetected {
  chord: string;
  beat: number;
  confidence: number;
}

export interface OmrLyricDetected {
  text: string;
  confidence: number;
}

export interface OmrMeasureProposal {
  measureNumber: number;
  timeSignature?: string;
  keySignature?: string;
  chordsDetected: OmrChordDetected[];
  notesDetected: OmrNoteDetected[];
  lyricsDetected: OmrLyricDetected[];
  measureConfidence: number; // 0.0 a 1.0
}

export interface OmrUnrecognizedRegion {
  page: number;
  boundingBox?: [number, number, number, number];
  reason: string;
}

export type OmrReviewStatus = 'PENDING_REVIEW' | 'APPROVED_FOR_IMPORT' | 'REJECTED';

export interface OmrProposal {
  proposalId: string;
  sourceFilename: string;
  sourceHash: string;
  detectedTitle: string | null;
  detectedArtist: string | null;
  detectedKey: string | null;
  detectedBpm: number | null;
  detectedTimeSignature: string | null;
  overallConfidence: number; // 0.0 a 1.0
  isAiDraft: true; // Invariante: La salida de IA/OMR NUNCA es verdad canónica automática
  reviewStatus: OmrReviewStatus;
  measures: OmrMeasureProposal[];
  unrecognizedRegions: OmrUnrecognizedRegion[];
  createdAt: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
}

export interface OmrRecognitionInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
}
