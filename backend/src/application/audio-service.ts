/**
 * @file audio-service.ts
 * @description Servicio de aplicación para la gestión del ciclo de vida de audio (Workstream A / R1).
 * Orquesta validaciones de MIME, verificación de magic bytes binarios, cuotas, almacenamiento físico,
 * persistencia en BD y streaming conforme con soporte estricto de HTTP Range (RFC 7233 / 9110).
 */

import crypto from 'node:crypto';
import { type IAudioRepository } from '../repositories/audio-repository.ts';
import { type IAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import { type ISongRepository } from '../repositories/song-repository.ts';
import { type AudioAsset } from '../db/schema.ts';
import { ValidationError, NotFoundError, RangeNotSatisfiableError } from '../domain/errors.ts';
import { validateAudioBuffer } from '../domain/audio/audio-signature-validator.ts';
import {
  PythonAudioWorkerBridge,
  PythonWorkerError,
  globalPythonAudioWorkerBridge,
  type InspectAudioOptions,
  type PythonWorkerInspectResult,
} from '../infrastructure/python-worker/python-audio-worker-bridge.ts';

export interface UploadAudioParams {
  readonly songId: string;
  readonly title: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
  readonly durationSeconds?: number | undefined;
  readonly uploadedByUserId?: string | undefined;
  readonly verifyWithPythonWorker?: boolean | undefined;
}

export interface AudioStorageReconciliationReport {
  readonly checkedAssets: number;
  readonly healthyAssetIds: string[];
  readonly missingPhysicalFiles: Array<{ assetId: string; storagePath: string }>;
  readonly corruptedPhysicalFiles: Array<{ assetId: string; storagePath: string; reason: string }>;
  readonly orphanFiles: string[];
  readonly purgedOrphanFiles: string[];
}

export interface AudioStreamResponse {
  readonly stream: NodeJS.ReadableStream;
  readonly statusCode: 200 | 206;
  readonly headers: Record<string, string | number>;
}

export interface AudioDownloadResponse {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly checksumSha256: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'audio/m4a',
  'audio/webm',
  'audio/flac',
]);

/**
 * Valida la firma binaria ("magic bytes") del archivo para prevenir falsificación MIME.
 */
export function validateAudioMagicBytes(buffer: Buffer, mimeType: string): void {
  if (!buffer || buffer.length < 4) {
    throw new ValidationError('El archivo es demasiado pequeño para contener una cabecera de audio válida.');
  }

  const normalized = mimeType.toLowerCase().trim();

  // Caso especial: WebM (EBML container)
  if (normalized === 'audio/webm') {
    const isEbml =
      buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    if (!isEbml) {
      throw new ValidationError(
        'El archivo no posee una firma válida de audio WebM (falta encabezado EBML). Posible falsificación MIME.'
      );
    }
    return;
  }

  // Validación binaria profunda universal (MP3 con/sin ID3, WAV, FLAC, OGG, M4A, AAC)
  validateAudioBuffer(buffer, normalized);
}

export class AudioService {
  public constructor(
    private readonly audioRepo: IAudioRepository,
    private readonly storageProvider: IAudioStorageProvider,
    private readonly songRepo: ISongRepository,
    private readonly maxFileSizeBytes: number = 50 * 1024 * 1024, // 50MB
    private readonly pythonWorkerBridge: PythonAudioWorkerBridge = globalPythonAudioWorkerBridge
  ) {}

  private async executeWorkerInspect(
    jobId: string,
    fullPath: string,
    expectedSha256: string,
    options: InspectAudioOptions = {}
  ): Promise<PythonWorkerInspectResult> {
    try {
      return await this.pythonWorkerBridge.inspectAndVerifyAudio(
        jobId,
        fullPath,
        expectedSha256,
        options
      );
    } catch (err) {
      if (err instanceof PythonWorkerError) {
        if (err.errorCode === 'SOURCE_FILE_NOT_FOUND') {
          throw new NotFoundError('Archivo físico de audio', fullPath);
        }
        if (
          err.errorCode === 'AUDIO_VALIDATION_FAILED' ||
          err.errorCode === 'AUDIO_DECODE_FAILED' ||
          err.errorCode === 'INVALID_ARGUMENT' ||
          err.errorCode === 'INVALID_WORKER_REQUEST' ||
          err.errorCode === 'MISSING_REQUIRED_FIELDS'
        ) {
          throw new ValidationError(err.message, { workerErrorCode: err.errorCode });
        }
      }
      throw err;
    }
  }

  /**
   * Sube y registra un nuevo activo de audio asociado a una canción.
   * Valida existencia de la canción, cuota de tamaño, tipo MIME y magic bytes binarios.
   * Garantiza reversión física automática si falla la verificación del worker o la inserción en BD.
   */
  public async uploadAudio(params: UploadAudioParams): Promise<AudioAsset> {
    const { songId, title, filename, mimeType, buffer, durationSeconds, uploadedByUserId } = params;

    // 1. Validar existencia de la canción
    const song = await this.songRepo.findById(songId);
    if (!song) {
      throw new NotFoundError(`Canción con ID ${songId} no encontrada.`);
    }

    // 2. Validar tipo MIME permitido
    const normalizedMime = mimeType.toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      throw new ValidationError(`Formato de audio no permitido o inválido: "${mimeType}".`);
    }

    // 3. Validar tamaño del buffer
    if (!buffer || buffer.length === 0) {
      throw new ValidationError('El archivo de audio no puede estar vacío.');
    }

    if (buffer.length > this.maxFileSizeBytes) {
      throw new ValidationError(
        `El archivo de audio (${buffer.length} bytes) supera el límite máximo de ${this.maxFileSizeBytes} bytes (50MB).`
      );
    }

    // 4. Validar firma binaria (magic bytes) para prevenir falsificación MIME
    validateAudioMagicBytes(buffer, normalizedMime);

    // 5. Guardar archivo físico de forma atómica e inmutable en el storage provider seguro
    const saveResult = await this.storageProvider.save(filename, buffer);

    try {
      // 6. Verificación profunda opcional mediante worker local en Python
      if (params.verifyWithPythonWorker) {
        const fullPath = this.storageProvider.resolveSafePath(saveResult.storagePath);
        await this.executeWorkerInspect(
          `upload-${crypto.randomUUID()}`,
          fullPath,
          saveResult.checksumSha256
        );
      }

      // 7. Persistir metadatos en la base de datos
      const created = await this.audioRepo.create({
        songId,
        title: title.trim() || filename,
        filename: filename.trim(),
        storagePath: saveResult.storagePath,
        mimeType: normalizedMime,
        fileSizeBytes: saveResult.fileSizeBytes,
        checksumSha256: saveResult.checksumSha256,
        durationSeconds: durationSeconds && durationSeconds > 0 ? Math.floor(durationSeconds) : null,
        uploadedByUserId: uploadedByUserId ?? null,
      });

      return created;
    } catch (err) {
      // Limpieza transaccional compensatoria para impedir archivos huérfanos en disco
      await this.storageProvider.delete(saveResult.storagePath).catch(() => {});
      throw err;
    }
  }

  /**
   * Obtiene la lista de activos de audio para una canción específica.
   */
  public async getAudiosBySongId(songId: string): Promise<AudioAsset[]> {
    const song = await this.songRepo.findById(songId);
    if (!song) {
      throw new NotFoundError(`Canción con ID ${songId} no encontrada.`);
    }
    return await this.audioRepo.findBySongId(songId);
  }

  /**
   * Obtiene un activo de audio por su ID.
   */
  public async getAudioById(audioId: string): Promise<AudioAsset> {
    const asset = await this.audioRepo.findById(audioId);
    if (!asset) {
      throw new NotFoundError(`Activo de audio con ID ${audioId} no encontrado.`);
    }
    return asset;
  }

  /**
   * Genera un stream de audio con soporte de cabecera HTTP Range conforme a RFC 7233 / RFC 9110.
   * Maneja rangos cerrados (start-end), abiertos (start-) y sufijos (-N), retornando 206 o 416.
   */
  public async streamAudio(audioId: string, rangeHeader?: string): Promise<AudioStreamResponse> {
    const asset = await this.getAudioById(audioId);
    const totalSize = asset.fileSizeBytes;

    let start = 0;
    let end = totalSize - 1;
    let isRangeRequest = false;

    if (rangeHeader) {
      if (!rangeHeader.startsWith('bytes=')) {
        throw new RangeNotSatisfiableError(
          `Unidad de rango no soportada: ${rangeHeader}`,
          totalSize
        );
      }

      // Solicitud de múltiples rangos no soportada para streams directos de audio
      if (rangeHeader.includes(',')) {
        throw new RangeNotSatisfiableError(
          'Solicitud de múltiples rangos no soportada.',
          totalSize
        );
      }

      const rangeSpec = rangeHeader.slice('bytes='.length).trim();
      const parts = rangeSpec.split('-');
      if (parts.length !== 2) {
        throw new RangeNotSatisfiableError(
          `Formato de rango no satisfacible: ${rangeHeader}`,
          totalSize
        );
      }

      const rawStart = parts[0]?.trim();
      const rawEnd = parts[1]?.trim();

      if (rawStart === '' && rawEnd === '') {
        throw new RangeNotSatisfiableError(
          `Rango vacío o malformado: ${rangeHeader}`,
          totalSize
        );
      }

      // Caso A: Suffix range, e.g. bytes=-500 (los últimos 500 bytes del archivo)
      if (rawStart === '' && rawEnd !== '') {
        const suffixLength = parseInt(rawEnd, 10);
        if (isNaN(suffixLength) || suffixLength <= 0) {
          throw new RangeNotSatisfiableError(
            `Longitud de sufijo inválida: ${rawEnd}`,
            totalSize
          );
        }
        start = Math.max(0, totalSize - suffixLength);
        end = totalSize - 1;
      }
      // Caso B: Prefix range, e.g. bytes=500- (desde 500 hasta el final)
      else if (rawStart !== '' && rawEnd === '') {
        start = parseInt(rawStart, 10);
        if (isNaN(start) || start < 0) {
          throw new RangeNotSatisfiableError(
            `Posición de inicio inválida: ${rawStart}`,
            totalSize
          );
        }
        end = totalSize - 1;
      }
      // Caso C: Closed range, e.g. bytes=100-200
      else {
        start = parseInt(rawStart, 10);
        end = parseInt(rawEnd, 10);
        if (isNaN(start) || isNaN(end) || start < 0) {
          throw new RangeNotSatisfiableError(
            `Valores de rango inválidos: ${rangeHeader}`,
            totalSize
          );
        }
      }

      // Validar límites según RFC 7233
      if (start >= totalSize || start > end) {
        throw new RangeNotSatisfiableError(
          `Rango fuera de los límites del archivo (${totalSize} bytes): ${rangeHeader}`,
          totalSize
        );
      }

      // Clamping del extremo final si supera el tamaño total
      end = Math.min(end, totalSize - 1);
      isRangeRequest = true;
    }

    const { stream, chunkSize } = await this.storageProvider.getStream(
      asset.storagePath,
      start,
      end,
      {
        expectedChecksumSha256: asset.checksumSha256,
        expectedSizeBytes: asset.fileSizeBytes,
      }
    );

    if (isRangeRequest) {
      return {
        stream,
        statusCode: 206,
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': chunkSize,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-cache',
          'X-Checksum-Sha256': asset.checksumSha256,
          ETag: `"${asset.checksumSha256}"`,
        },
      };
    }

    return {
      stream,
      statusCode: 200,
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': totalSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-cache',
        'X-Checksum-Sha256': asset.checksumSha256,
        ETag: `"${asset.checksumSha256}"`,
      },
    };
  }

  /**
   * Ejecuta inspección binaria profunda y verificación PCM mediante el worker local de Python
   * sobre un activo de audio ya preservado en disco.
   */
  public async inspectAndVerifyStoredAudio(
    audioId: string,
    options: InspectAudioOptions = {}
  ): Promise<PythonWorkerInspectResult> {
    const asset = await this.getAudioById(audioId);
    const exists = await this.storageProvider.exists(asset.storagePath);
    if (!exists) {
      throw new NotFoundError('Archivo físico de audio', asset.storagePath);
    }

    const fullPath = this.storageProvider.resolveSafePath(asset.storagePath);
    return await this.executeWorkerInspect(
      `verify-${asset.id}-${Date.now()}`,
      fullPath,
      asset.checksumSha256,
      options
    );
  }

  /**
   * Reconcilia la consistencia entre los registros de `audio_assets` en PostgreSQL y los archivos físicos en disco.
   * Detecta archivos huérfanos en disco, registros sin archivo físico y archivos físicamente alterados (SHA-256).
   */
  public async reconcileStorageConsistency(
    options: { purgeOrphanFiles?: boolean } = {}
  ): Promise<AudioStorageReconciliationReport> {
    const [assets, physicalKeys] = await Promise.all([
      this.audioRepo.findAll(),
      this.storageProvider.listKeys(),
    ]);

    const referencedPaths = new Set(assets.map((a) => a.storagePath));
    const healthyAssetIds: string[] = [];
    const missingPhysicalFiles: Array<{ assetId: string; storagePath: string }> = [];
    const corruptedPhysicalFiles: Array<{ assetId: string; storagePath: string; reason: string }> = [];

    for (const asset of assets) {
      try {
        const probe = await this.storageProvider.getStream(asset.storagePath, undefined, undefined, {
          expectedChecksumSha256: asset.checksumSha256,
          expectedSizeBytes: asset.fileSizeBytes,
        });
        (probe.stream as any).on?.('error', () => {});
        if (typeof (probe.stream as any).destroy === 'function') {
          (probe.stream as any).destroy();
        }
        healthyAssetIds.push(asset.id);
      } catch (err: any) {
        if (err instanceof NotFoundError) {
          missingPhysicalFiles.push({
            assetId: asset.id,
            storagePath: asset.storagePath,
          });
        } else {
          corruptedPhysicalFiles.push({
            assetId: asset.id,
            storagePath: asset.storagePath,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const orphanFiles = physicalKeys.filter((key) => !referencedPaths.has(key));
    const purgedOrphanFiles: string[] = [];

    if (options.purgeOrphanFiles) {
      for (const orphanKey of orphanFiles) {
        const deleted = await this.storageProvider.delete(orphanKey);
        if (deleted) {
          purgedOrphanFiles.push(orphanKey);
        }
      }
    }

    return {
      checkedAssets: assets.length,
      healthyAssetIds,
      missingPhysicalFiles,
      corruptedPhysicalFiles,
      orphanFiles,
      purgedOrphanFiles,
    };
  }

  /**
   * Obtiene la descarga binaria completa de un audio con verificación criptográfica SHA-256.
   */
  public async downloadAudio(audioId: string): Promise<AudioDownloadResponse> {
    const asset = await this.getAudioById(audioId);
    const buffer = await this.storageProvider.getBuffer(asset.storagePath);

    // Re-verificación de integridad física SHA-256
    const calculatedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (calculatedHash !== asset.checksumSha256) {
      throw new ValidationError(
        `Integridad física comprometida: el hash SHA-256 verificado (${calculatedHash}) no coincide con el registro original (${asset.checksumSha256}).`
      );
    }

    return {
      buffer,
      filename: asset.filename,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes,
      checksumSha256: asset.checksumSha256,
    };
  }

  /**
   * Elimina un archivo de audio tanto de la base de datos como del disco físico.
   */
  public async deleteAudio(audioId: string): Promise<boolean> {
    const asset = await this.audioRepo.findById(audioId);
    if (!asset) {
      return false;
    }

    // 1. Eliminar archivo físico
    await this.storageProvider.delete(asset.storagePath);

    // 2. Eliminar registro en base de datos
    return await this.audioRepo.delete(audioId);
  }
}
