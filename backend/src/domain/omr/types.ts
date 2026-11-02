/**
 * @file types.ts
 * @description Tipos de dominio para Reconocimiento Óptico de Música (OMR / IA) (Fase 1A & Fase 3C).
 *
 * Principio mandatorio:
 * El resultado de OMR es SIEMPRE una propuesta preliminar (isAiDraft: true) con revisión humana
 * obligatoria antes de persistirse como canción canónica.
 */

export interface OmrNoteDetected {
  step: string;
  octave: number;
  duration: string;
  confidence: number;
  alter?: number;
  type?: string;
  isRest?: boolean;
}

export interface OmrChordDetected {
  chord: string;
  beat: number;
  confidence: number;
  tickOffset?: number;
}

export interface OmrLyricDetected {
  text: string;
  confidence: number;
  beat?: number;
  tickOffset?: number;
  durationTicks?: number;
}

export interface OmrMeasureProposal {
  measureNumber: number;
  timeSignature?: string;
  keySignature?: string;
  chordsDetected: OmrChordDetected[];
  notesDetected: OmrNoteDetected[];
  lyricsDetected: OmrLyricDetected[];
  measureConfidence: number; // 0.0 a 1.0
  flags?: string[];
}

export interface OmrUnrecognizedRegion {
  page: number;
  boundingBox?: [number, number, number, number];
  reason: string;
}

export type OmrReviewStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED_FOR_IMPORT'
  | 'REJECTED'
  | 'COMMITTED';

export interface OmrProposal {
  proposalId: string;
  jobId?: string;
  userId?: string;
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

export type OmrActionType =
  | 'CREATE_PROPOSAL'
  | 'UPDATE_MEASURE'
  | 'APPROVE_MEASURE'
  | 'FLAG_MEASURE'
  | 'APPROVE_PROPOSAL'
  | 'REJECT_PROPOSAL'
  | 'COMMIT_TO_SONG';

export interface OmrAuditEntry {
  id?: string;
  proposalId: string;
  userId?: string;
  actionType: OmrActionType;
  targetMeasure?: number;
  targetTick?: number;
  previousValue?: any;
  newValue?: any;
  reason?: string;
  createdAt?: string;
}
