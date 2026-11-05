/**
 * @file visual-score-adapter.ts
 * @description Adaptador universal para ingesta y preservación de partituras visuales (PDF e Imágenes PNG/JPEG/TIFF).
 *
 * Principios (Fase 1B-R):
 * 1. Inspección estricta de firmas binarias de archivo (Magic Bytes) para neutralizar MIME Spoofing.
 * 2. Preservación incondicional de los bytes originales en almacenamiento seguro con digest SHA-256.
 * 3. CERO notas, tonalidades o compases fabricados (defaultKey: null, defaultBpm: null, timeSignature: null).
 * 4. Estado honesto RECOGNITION_UNAVAILABLE si no hay un motor OMR real configurado.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { validateDocumentFileSignature } from '../../../documents/document-validation.ts';
import { PdfTextExtractor } from '../../../documents/pdf-text-extractor.ts';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import type { ISourceStorageProvider } from '../../source-storage-provider.ts';
import { LocalFileSystemSourceStorageProvider } from '../../source-storage-provider.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

export class VisualScoreIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'PDF_SCORE' as const;
  public readonly name = 'Bethesda Visual Score & Image Importer';
  public readonly version = '1.1.0';

  private readonly storageProvider: ISourceStorageProvider;

  public constructor(storageProvider?: ISourceStorageProvider) {
    this.storageProvider = storageProvider ?? new LocalFileSystemSourceStorageProvider();
  }

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'PDF_SCORE' || input.sourceType === 'IMAGE_SCORE') return true;
    if (input.filename) {
      const ext = path.extname(input.filename).toLowerCase();
      if (['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.webp'].includes(ext)) {
        return true;
      }
    }
    if (input.buffer && input.buffer.length >= 4) {
      // PDF: %PDF-
      if (input.buffer[0] === 0x25 && input.buffer[1] === 0x50 && input.buffer[2] === 0x44 && input.buffer[3] === 0x46) {
        return true;
      }
      // PNG: 0x89 0x50 0x4E 0x47
      if (input.buffer[0] === 0x89 && input.buffer[1] === 0x50 && input.buffer[2] === 0x4e && input.buffer[3] === 0x47) {
        return true;
      }
      // JPEG: 0xFF 0xD8 0xFF
      if (input.buffer[0] === 0xff && input.buffer[1] === 0xd8 && input.buffer[2] === 0xff) {
        return true;
      }
    }
    return false;
  }

  public detectMimeType(buffer: Buffer): string {
    if (buffer.length >= 4) {
      if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
      if ((buffer[0] === 0x49 && buffer[1] === 0x49) || (buffer[0] === 0x4d && buffer[1] === 0x4d)) return 'image/tiff';
    }
    return 'application/octet-stream';
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationError('El archivo de partitura visual está vacío o no fue suministrado.');
    }

    const diagnostics: IngestionDiagnostic[] = [];
    const sourceHash = crypto.createHash('sha256').update(input.buffer).digest('hex');

    // 1. Detección y validación estricta de firma mágica
    const detectedMime = this.detectMimeType(input.buffer);
    if (!detectedMime || detectedMime === 'application/octet-stream') {
      throw new ValidationError('El archivo no corresponde a una partitura visual o imagen válida (PDF, PNG, JPEG, TIFF).');
    }
    const detectedFormat = validateDocumentFileSignature(input.buffer, detectedMime);
    const isPdf = detectedFormat === 'PDF';

    // 2. Almacenar archivo original en el proveedor de almacenamiento seguro
    const ext = isPdf ? '.pdf' : detectedMime === 'image/png' ? '.png' : detectedMime === 'image/jpeg' ? '.jpg' : '.tif';
    const filename = input.filename || `score_${sourceHash.substring(0, 8)}${ext}`;
    const saveResult = await this.storageProvider.save(filename, input.buffer);

    // Extraer título base
    const baseTitle = input.filename ? path.basename(input.filename, path.extname(input.filename)) : '';
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
      defaultKey: null, // CERO CLAVES INVENTADAS
      defaultBpm: null, // CERO TEMPOS INVENTADOS
      timeSignature: null, // CERO MÉTRICAS INVENTADAS
      canonicalPayload: null, // CERO PARTITURA CANÓNICA FALSA
      diagnostics,
      recognitionStatusMessage: statusMessage,
    };
  }
}
