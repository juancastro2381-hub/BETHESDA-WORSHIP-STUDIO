/**
 * @file document-service.ts
 * @description Servicio de aplicación para la gestión de documentos visuales (PDF, PNG, JPG, WEBP, TIFF) (Fase B).
 * Implementa inspección, validación, almacenamiento seguro y persistencia canónica en modo Atril Visual.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { type IDocumentStorageProvider } from '../domain/documents/document-storage-provider.ts';
import {
  type DocumentInspectionResult,
  type DocumentMetadata,
} from '../domain/documents/document-types.ts';
import {
  sanitizeSafeFilename,
  validateDocumentFileSignature,
} from '../domain/documents/document-validation.ts';
import { extractPdfPageCount } from '../domain/documents/pdf-utils.ts';
import { NotFoundError, ValidationError } from '../domain/errors.ts';
import { type SongService } from './song-service.ts';
import { type SongWithVersion } from '../repositories/song-repository.ts';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { Timeline } from '../../../frontend/src/core/canonical-model/timeline.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';

export interface InspectDocumentParams {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly mimeType: string;
  readonly userId?: string | undefined;
}

export interface ImportVisualDocumentSongParams {
  readonly documentId?: string | undefined;
  readonly storageKey: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly title?: string | undefined;
  readonly artist?: string | undefined;
  readonly userId?: string | undefined;
}

export class DocumentService {
  private readonly storageProvider: IDocumentStorageProvider;
  private readonly songService: SongService;
  private readonly maxFileSizeBytes: number;
  private readonly registeredDocuments: Map<string, DocumentMetadata>;

  public constructor(
    storageProvider: IDocumentStorageProvider,
    songService: SongService,
    maxFileSizeBytes: number = 15 * 1024 * 1024
  ) {
    this.storageProvider = storageProvider;
    this.songService = songService;
    this.maxFileSizeBytes = maxFileSizeBytes;
    this.registeredDocuments = new Map();
  }

  /**
   * Inspecciona, valida firmas binarias y almacena con seguridad un documento visual.
   */
  public async inspectAndStoreDocument(
    params: InspectDocumentParams
  ): Promise<DocumentInspectionResult> {
    const { buffer, mimeType, filename, userId } = params;

    // 1. Validar firmas binarias y límites
    const detectedFormat = validateDocumentFileSignature(
      buffer,
      mimeType,
      this.maxFileSizeBytes
    );

    // 2. Sanear nombre original
    const safeFilename = sanitizeSafeFilename(filename);

    // 3. Almacenar físicamente con UUID único y calcular SHA-256
    const saveResult = await this.storageProvider.save(safeFilename, buffer);
    const documentId = crypto.randomUUID();
    const pageCount = detectedFormat === 'PDF' ? extractPdfPageCount(buffer) : 1;

    const metadata: DocumentMetadata = {
      documentId,
      filename: safeFilename,
      storageKey: saveResult.storageKey,
      mimeType,
      fileSizeBytes: saveResult.fileSizeBytes,
      checksumSha256: saveResult.checksumSha256,
      detectedFormat,
      isVisualOnly: true,
      uploadedAt: new Date().toISOString(),
      uploadedByUserId: userId,
      pageCount,
    };

    this.registeredDocuments.set(documentId, metadata);

    return {
      documentId: metadata.documentId,
      filename: metadata.filename,
      storageKey: metadata.storageKey,
      mimeType: metadata.mimeType,
      fileSizeBytes: metadata.fileSizeBytes,
      checksumSha256: metadata.checksumSha256,
      detectedFormat: metadata.detectedFormat,
      isVisualOnly: true,
      uploadedAt: metadata.uploadedAt,
      pageCount,
    };
  }

  /**
   * Obtiene los metadatos de un documento por su ID registrado.
   */
  public getDocumentMetadata(documentId: string): DocumentMetadata | undefined {
    return this.registeredDocuments.get(documentId);
  }

  /**
   * Obtiene el contenido binario de un documento almacenado para streaming o descarga.
   */
  public async getDocumentFile(storageKey: string): Promise<{
    buffer: Buffer;
    fileSizeBytes: number;
    checksumSha256: string;
  }> {
    const safePath = this.storageProvider.resolveSafePath(storageKey);
    const exists = await this.storageProvider.exists(storageKey);
    if (!exists) {
      throw new NotFoundError('Documento físico', storageKey);
    }

    const buffer = await this.storageProvider.getBuffer(storageKey);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
      buffer,
      fileSizeBytes: buffer.length,
      checksumSha256: hash,
    };
  }

  /**
   * Persiste un documento visual como canción en el catálogo musical canónico.
   * CERO invención de notas: se inicializa un CanonicalMusicPayload limpio en modo visual.
   */
  public async importVisualDocumentSong(
    params: ImportVisualDocumentSongParams
  ): Promise<SongWithVersion> {
    const { storageKey, filename, mimeType, title, artist } = params;

    const exists = await this.storageProvider.exists(storageKey);
    if (!exists) {
      throw new NotFoundError('Archivo fuente del documento', storageKey);
    }

    const safeFilename = sanitizeSafeFilename(filename);
    const ext = path.extname(safeFilename).toLowerCase();
    const isPdf = ext === '.pdf' || mimeType === 'application/pdf';
    const sourceFormat = isPdf ? 'PDF' : 'IMAGE';

    // Determinar título
    const baseName = path.basename(safeFilename, path.extname(safeFilename));
    const finalTitle = (title && title.trim()) || baseName || 'Partitura Visual';

    // Obtener metadatos del archivo para el registro de procedencia
    const fileData = await this.getDocumentFile(storageKey);
    const pageCount = isPdf ? extractPdfPageCount(fileData.buffer) : 1;

    // Crear CanonicalMusicPayload limpio (0 notas, 0 acordes inventados)
    const timeline = new Timeline({
      totalDurationTicks: 0,
      measureCount: 0,
    });

    const canonicalPayload = new CanonicalMusicPayload({
      title: finalTitle,
      timeline,
      measures: [],
      sections: [],
      instrumentTracks: [],
      metadata: {
        isVisualOnly: true,
        sourceFormat,
        storageKey,
        mimeType,
        filename: safeFilename,
        fileSizeBytes: fileData.fileSizeBytes,
        checksumSha256: fileData.checksumSha256,
        pageCount,
      },
    });

    const canonicalJSON = CanonicalSerializer.serialize(canonicalPayload);

    const sourceRecordContent = JSON.stringify({
      storageKey,
      filename: safeFilename,
      mimeType,
      fileSizeBytes: fileData.fileSizeBytes,
      checksumSha256: fileData.checksumSha256,
      isVisualOnly: true,
      pageCount,
      importedAt: new Date().toISOString(),
    });

    const created = await this.songService.createSong({
      title: finalTitle,
      artist: artist?.trim() || null,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: isPdf ? 'Partitura Original (PDF)' : 'Partitura Original (Imagen)',
      versionDescription: `Documento visual importado desde ${safeFilename} (${(fileData.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB). Lectura en atril visual.`,
      sourceFormat,
      canonicalPayload: canonicalJSON,
      sourceRecord: {
        filename: safeFilename,
        rawContent: sourceRecordContent,
        importerName: 'DocumentService',
        importerVersion: '1.0.0',
      },
      metadata: {
        notes: `Importado como documento visual. Checksum SHA-256: ${fileData.checksumSha256}.`,
        tags: ['visual-stand', sourceFormat.toLowerCase()],
      },
    });

    return created;
  }
}
