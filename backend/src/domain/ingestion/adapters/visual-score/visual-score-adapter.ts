/**
 * @file visual-score-adapter.ts
 * @description Adaptador universal para ingesta segura de partituras en PDF e imágenes (PNG, JPEG, TIFF) (Fase 1B).
 *
 * Principios:
 * 1. Preservación física inmutable del archivo fuente original.
 * 2. Validación rigurosa de cabecera mágica (magic bytes) contra ataques de MIME-spoofing.
 * 3. Cálculo estricto de integridad criptográfica SHA-256.
 * 4. Extracción de capas de texto/acordes cuando estén presentes en PDFs vectoriales.
 * 5. Reporte veraz y transparente: si no hay un motor OMR real instalado, reporta RECOGNITION_UNAVAILABLE
 *    con CERO notas inventadas, habilitando el modo de lectura en Atril Visual.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import {
  CanonicalMusicPayload,
  Timeline,
} from '../../../../../../frontend/src/core/canonical-model/index.ts';
import { extractPdfPageCount } from '../../../documents/pdf-utils.ts';
import { validateDocumentFileSignature } from '../../../documents/document-validation.ts';
import { PdfTextExtractor } from '../../../documents/pdf-text-extractor.ts';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import type { ISourceStorageProvider } from '../../source-storage-provider.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

export class VisualScoreIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'PDF_SCORE' as const;
  public readonly name = 'Bethesda Visual Score & PDF Adapter';
  public readonly version = '1.0.0';

  public constructor(private readonly storageProvider: ISourceStorageProvider) {}

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'PDF_SCORE' || input.sourceType === 'IMAGE_SCORE') return true;
    if (input.filename) {
      const ext = path.extname(input.filename).toLowerCase();
      if (['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.webp'].includes(ext)) {
        return true;
      }
    }
    if (input.mimeType) {
      return [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/tiff',
        'image/webp',
      ].includes(input.mimeType);
    }
    return false;
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationError('El buffer del documento/imagen está vacío o no fue suministrado.');
    }

    const filename = input.filename || 'partitura_visual.pdf';
    const ext = path.extname(filename).toLowerCase();
    const mimeType = input.mimeType || (ext === '.pdf' ? 'application/pdf' : 'image/png');

    // 1. Validar firmas binarias y límites
    const detectedFormat = validateDocumentFileSignature(input.buffer, mimeType, 15 * 1024 * 1024);

    // 2. Almacenar físicamente con hash SHA-256
    const saveResult = await this.storageProvider.save(filename, input.buffer);
    const sourceHash = saveResult.checksumSha256;
    const diagnostics: IngestionDiagnostic[] = [];

    const isPdf = detectedFormat === 'PDF';
    const pageCount = isPdf ? extractPdfPageCount(input.buffer) : 1;
    const baseTitle = path.basename(filename, ext);
    const title = input.title?.trim() || baseTitle || 'Partitura Visual';

    // 3. Revisar si contiene capa de texto con acordes en caso de ser PDF
    let extractedSongsCount = 0;
    if (isPdf) {
      try {
        const extracted = PdfTextExtractor.extractFromBuffer(input.buffer);
        extractedSongsCount = extracted.songs.length;
        if (extractedSongsCount > 0) {
          diagnostics.push({
            code: 'PDF_CHORDS_DETECTED',
            severity: 'INFO',
            message: `Se detectaron ${extractedSongsCount} canciones/cifrados en la capa de texto del PDF.`,
          });
        }
      } catch {
        // Continuar con modo visual puro
      }
    }

    // 4. Verificar disponibilidad del motor OMR
    const hasRealOmrEngine = process.env.REAL_OMR_ENGINE_CONFIGURED === 'true';

    // 5. Inicializar CanonicalMusicPayload limpio en modo Atril Visual (CERO notas inventadas)
    const timeline = new Timeline({
      totalDurationTicks: 0,
      measureCount: 0,
    });

    const canonicalPayload = new CanonicalMusicPayload({
      title,
      timeline,
      measures: [],
      sections: [],
      instrumentTracks: [],
      metadata: {
        isVisualOnly: true,
        sourceFormat: isPdf ? 'PDF' : 'IMAGE',
        storageKey: saveResult.storageKey,
        mimeType,
        filename,
        fileSizeBytes: saveResult.fileSizeBytes,
        checksumSha256: sourceHash,
        pageCount,
      },
    });

    const statusMessage = hasRealOmrEngine
      ? 'Documento recibido y enviado a la cola de procesamiento OMR real.'
      : 'Motor de reconocimiento óptico de música (OMR) no configurado en este servidor. El documento se ha preservado de forma inmutable para lectura en atril visual con cero notas inventadas.';

    diagnostics.push({
      code: hasRealOmrEngine ? 'OMR_QUEUED' : 'RECOGNITION_ENGINE_UNAVAILABLE',
      severity: hasRealOmrEngine ? 'INFO' : 'WARNING',
      message: statusMessage,
    });

    return {
      status: hasRealOmrEngine ? 'RECOGNITION_PENDING' : 'RECOGNITION_UNAVAILABLE',
      sourceType: isPdf ? 'PDF_SCORE' : 'IMAGE_SCORE',
      sourceHash,
      filename,
      storageKey: saveResult.storageKey,
      title,
      artist: input.artist || null,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
      canonicalPayload: canonicalPayload.toJSON(),
      diagnostics,
      recognitionStatusMessage: statusMessage,
    };
  }
}
