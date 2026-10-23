/**
 * @file document-types.ts
 * @description Tipos de dominio, constantes de tamaño y contratos para ingesta de documentos y partituras visuales (Fase B).
 */

export const DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
]);

export type DocumentDetectedFormat = 'PDF' | 'IMAGE';

export interface DocumentMetadata {
  readonly documentId: string;
  readonly filename: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly checksumSha256: string;
  readonly detectedFormat: DocumentDetectedFormat;
  readonly isVisualOnly: true;
  readonly uploadedAt: string;
  readonly uploadedByUserId?: string | undefined;
}

export interface DocumentInspectionResult {
  readonly documentId: string;
  readonly filename: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly checksumSha256: string;
  readonly detectedFormat: DocumentDetectedFormat;
  readonly isVisualOnly: true;
  readonly uploadedAt: string;
}

export interface DocumentSaveResult {
  readonly storageKey: string;
  readonly checksumSha256: string;
  readonly fileSizeBytes: number;
}
