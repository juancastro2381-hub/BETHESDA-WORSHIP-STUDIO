/**
 * @file audio-service.ts
 * @description Servicio de aplicación para la gestión del ciclo de vida de audio (Workstream A / R1).
 * Orquesta validaciones de MIME, verificación de magic bytes binarios, cuotas, almacenamiento físico,
 * persistencia en BD y streaming conforme con soporte estricto de HTTP Range (RFC 7233 / 9110).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type IAudioRepository } from '../repositories/audio-repository.ts';
import { type IAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import { type ISongRepository } from '../repositories/song-repository.ts';
import { DrizzleAuditLogRepository, type IAuditLogRepository } from '../repositories/audit-repository.ts';
import { type AudioAsset } from '../db/schema.ts';
import { ValidationError, NotFoundError, PersistenceError, RangeNotSatisfiableError } from '../domain/errors.ts';
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

export interface AudioUploadCompensationReport {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly storagePath: string;
  readonly checksumSha256: string;
  readonly fileSizeBytes: number;
  readonly compensationError?: string | undefined;
  readonly recoveryRecordId?: string | undefined;
  readonly persistedToAuditLog: boolean;
  readonly recordedAt: string;
}

export type AudioRecoveryType =
  | 'UPLOAD_COMPENSATION_ORPHAN'
  | 'DELETE_PHYSICAL_FAILED'
  | 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE';

export type AudioRecoveryStatus =
  | 'PENDING_RECOVERY'
  | 'ABORTED_DB_PRESERVED'
  | 'RECOVERED';

export interface AudioStorageRecoveryRecord {
  id: string;
  recoveryType: AudioRecoveryType;
  status: AudioRecoveryStatus;
  storagePath: string;
  assetId?: string | undefined;
  songId: string;
  filename: string;
  mimeType: string;
  checksumSha256: string;
  fileSizeBytes: number;
  primaryError: string;
  secondaryError?: string | undefined;
  persistedToAuditLog: boolean;
  auditLogId?: string | undefined;
  createdAt: string;
  recoveredAt?: string | undefined;
}

export interface AudioStorageReconciliationOptions {
  readonly purgeOrphanFiles?: boolean | undefined;
  readonly recoverFailedOperations?: boolean | undefined;
  readonly minOrphanAgeMs?: number | undefined;
}

export interface AudioStorageReconciliationReport {
  readonly checkedAssets: number;
  readonly healthyAssetIds: string[];
  readonly missingPhysicalFiles: Array<{ assetId: string; storagePath: string }>;
  readonly corruptedPhysicalFiles: Array<{ assetId: string; storagePath: string; reason: string }>;
  readonly orphanFiles: string[];
  readonly purgedOrphanFiles: string[];
  readonly skippedInFlightFiles: string[];
  readonly ambiguousFiles: Array<{ storagePath: string; reason: string }>;
  readonly failedOrphanPurges: Array<{ storagePath: string; reason: string }>;
  readonly pendingRecoveryRecords: AudioStorageRecoveryRecord[];
  readonly recoveredOperations: Array<{
    recoveryRecordId: string;
    recoveryType: AudioRecoveryType;
    target: string;
  }>;
  readonly auditLogIds: string[];
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

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.wave',
  '.ogg',
  '.m4a',
  '.mp4',
  '.aac',
  '.flac',
  '.webm',
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
  private readonly inFlightUploadPaths = new Set<string>();
  private readonly recoveryRecords = new Map<string, AudioStorageRecoveryRecord>();

  public constructor(
    private readonly audioRepo: IAudioRepository,
    private readonly storageProvider: IAudioStorageProvider,
    private readonly songRepo: ISongRepository,
    private readonly maxFileSizeBytes: number = 50 * 1024 * 1024, // 50MB
    private readonly pythonWorkerBridge: PythonAudioWorkerBridge = globalPythonAudioWorkerBridge,
    private readonly auditRepo: IAuditLogRepository = new DrizzleAuditLogRepository()
  ) {}

  /**
   * Retorna una instantánea de los registros de recuperación de fallos de almacenamiento registrados por esta instancia.
   */
  public getRecoveryRecords(): AudioStorageRecoveryRecord[] {
    return Array.from(this.recoveryRecords.values()).map((r) => ({ ...r }));
  }

  private async persistAuditEvent(
    eventType: string,
    userId: string | null | undefined,
    resource: string,
    metadata: Record<string, unknown>
  ): Promise<{ persisted: boolean; auditLogId?: string; error?: string }> {
    const safeResource = resource.slice(0, 128);
    const enrichedMetadata: Record<string, unknown> = {
      ...metadata,
      actorUserId: userId ?? null,
    };

    try {
      const created = await this.auditRepo.create({
        eventType,
        userId: userId ?? null,
        resource: safeResource,
        metadata: enrichedMetadata,
      });
      return { persisted: true, auditLogId: created.id };
    } catch (firstErr) {
      if (userId) {
        try {
          const fallbackCreated = await this.auditRepo.create({
            eventType,
            userId: null,
            resource: safeResource,
            metadata: {
              ...enrichedMetadata,
              userIdFallbackReason: firstErr instanceof Error ? firstErr.message : String(firstErr),
            },
          });
          return { persisted: true, auditLogId: fallbackCreated.id };
        } catch (secondErr) {
          const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
          console.error(`[AudioService] Failed to persist audit event ${eventType}: ${msg}`);
          return { persisted: false, error: msg };
        }
      }

      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      console.error(`[AudioService] Failed to persist audit event ${eventType}: ${msg}`);
      return { persisted: false, error: msg };
    }
  }

  private async getFileMtimeMs(storagePath: string): Promise<number | null> {
    if (typeof this.storageProvider.stat === 'function') {
      const statResult = await this.storageProvider.stat(storagePath).catch(() => null);
      return statResult ? statResult.mtimeMs : null;
    }

    try {
      const fullPath = this.storageProvider.resolveSafePath(storagePath);
      const statResult = await fs.promises.stat(fullPath);
      return statResult.isFile() ? statResult.mtimeMs : null;
    } catch {
      return null;
    }
  }

  private async markRelatedRecoveriesCompleted(
    match: { assetId?: string | undefined; storagePath?: string | undefined },
    actorUserId?: string | null
  ): Promise<Array<{ recoveryRecordId: string; recoveryType: AudioRecoveryType; target: string; auditLogId?: string }>> {
    const completed: Array<{
      recoveryRecordId: string;
      recoveryType: AudioRecoveryType;
      target: string;
      auditLogId?: string;
    }> = [];
    const nowIso = new Date().toISOString();

    for (const record of this.recoveryRecords.values()) {
      if (record.status === 'RECOVERED') continue;
      const matchesAsset = Boolean(match.assetId && record.assetId === match.assetId);
      const matchesPath = Boolean(match.storagePath && record.storagePath === match.storagePath);
      if (!matchesAsset && !matchesPath) continue;

      record.status = 'RECOVERED';
      record.recoveredAt = nowIso;

      const auditResult = await this.persistAuditEvent(
        'AUDIO_RECOVERY_COMPLETED',
        actorUserId ?? null,
        record.storagePath,
        {
          recoveryRecordId: record.id,
          recoveryType: record.recoveryType,
          assetId: record.assetId ?? null,
          storagePath: record.storagePath,
          songId: record.songId,
          checksumSha256: record.checksumSha256,
          recoveredAt: nowIso,
        }
      );

      completed.push({
        recoveryRecordId: record.id,
        recoveryType: record.recoveryType,
        target: record.assetId ?? record.storagePath,
        ...(auditResult.auditLogId ? { auditLogId: auditResult.auditLogId } : {}),
      });
    }

    return completed;
  }

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
   * Ejecuta compensación física cuando falla el worker o la persistencia en BD; si la compensación física
   * también falla, preserva el error primario, adjunta telemetría y persiste un registro accionable de recuperación.
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
    this.inFlightUploadPaths.add(saveResult.storagePath);

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
    } catch (primaryError) {
      const recordedAt = new Date().toISOString();
      const primaryMessage =
        primaryError instanceof Error ? primaryError.message : String(primaryError);

      let cleanupError: unknown = null;
      try {
        await this.storageProvider.delete(saveResult.storagePath);
      } catch (err) {
        cleanupError = err;
      }

      const stillExists = await this.storageProvider
        .exists(saveResult.storagePath)
        .catch(() => true);

      const compensationSucceeded = !cleanupError && !stillExists;
      let compensationErrorMsg: string | undefined;
      let recoveryRecordId: string | undefined;
      let persistedToAuditLog = false;

      if (!compensationSucceeded) {
        compensationErrorMsg =
          cleanupError instanceof Error
            ? cleanupError.message
            : cleanupError !== null
              ? String(cleanupError)
              : 'El archivo físico permanece en disco tras intentar la limpieza compensatoria.';

        const recoveryId = crypto.randomUUID();
        recoveryRecordId = recoveryId;

        const recoveryRecord: AudioStorageRecoveryRecord = {
          id: recoveryId,
          recoveryType: 'UPLOAD_COMPENSATION_ORPHAN',
          status: 'PENDING_RECOVERY',
          storagePath: saveResult.storagePath,
          songId,
          filename: filename.trim(),
          mimeType: normalizedMime,
          checksumSha256: saveResult.checksumSha256,
          fileSizeBytes: saveResult.fileSizeBytes,
          primaryError: primaryMessage,
          secondaryError: compensationErrorMsg,
          persistedToAuditLog: false,
          createdAt: recordedAt,
        };

        const auditResult = await this.persistAuditEvent(
          'AUDIO_UPLOAD_COMPENSATION_FAILED',
          uploadedByUserId ?? null,
          saveResult.storagePath,
          {
            recoveryRecordId: recoveryId,
            recoveryType: recoveryRecord.recoveryType,
            status: recoveryRecord.status,
            storagePath: saveResult.storagePath,
            songId,
            filename: recoveryRecord.filename,
            mimeType: normalizedMime,
            checksumSha256: saveResult.checksumSha256,
            fileSizeBytes: saveResult.fileSizeBytes,
            primaryError: primaryMessage,
            compensationError: compensationErrorMsg,
            recordedAt,
          }
        );

        persistedToAuditLog = auditResult.persisted;
        recoveryRecord.persistedToAuditLog = auditResult.persisted;
        if (auditResult.auditLogId) {
          recoveryRecord.auditLogId = auditResult.auditLogId;
        }
        this.recoveryRecords.set(recoveryId, recoveryRecord);
      }

      const compensationReport: AudioUploadCompensationReport = {
        attempted: true,
        succeeded: compensationSucceeded,
        storagePath: saveResult.storagePath,
        checksumSha256: saveResult.checksumSha256,
        fileSizeBytes: saveResult.fileSizeBytes,
        ...(compensationErrorMsg ? { compensationError: compensationErrorMsg } : {}),
        ...(recoveryRecordId ? { recoveryRecordId } : {}),
        persistedToAuditLog,
        recordedAt,
      };

      if (primaryError && typeof primaryError === 'object') {
        (primaryError as Error & { compensation?: AudioUploadCompensationReport }).compensation =
          compensationReport;
      }

      throw primaryError;
    } finally {
      this.inFlightUploadPaths.delete(saveResult.storagePath);
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
   * Protege subidas en vuelo y archivos ambiguos, y permite recuperación idempotente y auditada de fallos previos.
   */
  public async reconcileStorageConsistency(
    options: AudioStorageReconciliationOptions = {}
  ): Promise<AudioStorageReconciliationReport> {
    const shouldRecoverFailed = options.recoverFailedOperations ?? Boolean(options.purgeOrphanFiles);
    const recoveredOperations: Array<{
      recoveryRecordId: string;
      recoveryType: AudioRecoveryType;
      target: string;
    }> = [];
    const auditLogIds: string[] = [];

    // 1. Recuperación idempotente de operaciones fallidas pendientes (antes de inventariar estado actual)
    if (shouldRecoverFailed) {
      for (const rec of this.recoveryRecords.values()) {
        if (rec.status !== 'PENDING_RECOVERY') continue;

        if (rec.recoveryType === 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE' && rec.assetId) {
          const stillOnDisk = await this.storageProvider.exists(rec.storagePath).catch(() => true);
          if (!stillOnDisk) {
            try {
              const existingAsset = await this.audioRepo.findById(rec.assetId);
              const resolved = existingAsset ? await this.audioRepo.delete(rec.assetId) : true;
              if (resolved) {
                const completed = await this.markRelatedRecoveriesCompleted(
                  { assetId: rec.assetId, storagePath: rec.storagePath },
                  null
                );
                for (const item of completed) {
                  recoveredOperations.push({
                    recoveryRecordId: item.recoveryRecordId,
                    recoveryType: item.recoveryType,
                    target: item.target,
                  });
                  if (item.auditLogId) {
                    auditLogIds.push(item.auditLogId);
                  }
                }
              }
            } catch (recErr) {
              rec.secondaryError = recErr instanceof Error ? recErr.message : String(recErr);
            }
          }
        } else if (
          rec.recoveryType === 'UPLOAD_COMPENSATION_ORPHAN' &&
          !this.inFlightUploadPaths.has(rec.storagePath)
        ) {
          const stillOnDisk = await this.storageProvider.exists(rec.storagePath).catch(() => true);
          if (!stillOnDisk) {
            const completed = await this.markRelatedRecoveriesCompleted(
              { storagePath: rec.storagePath },
              null
            );
            for (const item of completed) {
              recoveredOperations.push({
                recoveryRecordId: item.recoveryRecordId,
                recoveryType: item.recoveryType,
                target: item.target,
              });
              if (item.auditLogId) {
                auditLogIds.push(item.auditLogId);
              }
            }
          }
        }
      }
    }

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

    const orphanFiles: string[] = [];
    const purgedOrphanFiles: string[] = [];
    const skippedInFlightFiles: string[] = [];
    const ambiguousFiles: Array<{ storagePath: string; reason: string }> = [];
    const failedOrphanPurges: Array<{ storagePath: string; reason: string }> = [];

    for (const diskKey of physicalKeys) {
      if (referencedPaths.has(diskKey)) {
        continue;
      }

      // Guardia 1: Nunca clasificar ni purgar una subida actualmente en vuelo
      if (this.inFlightUploadPaths.has(diskKey)) {
        skippedInFlightFiles.push(diskKey);
        continue;
      }

      const isConfirmedCompensationOrphan = Array.from(this.recoveryRecords.values()).some(
        (r) =>
          r.status === 'PENDING_RECOVERY' &&
          r.recoveryType === 'UPLOAD_COMPENSATION_ORPHAN' &&
          r.storagePath === diskKey
      );

      // Guardia 2: No clasificar como huérfanos elegibles a purga automática archivos ambiguos
      if (!isConfirmedCompensationOrphan) {
        const ext = path.extname(diskKey).toLowerCase();
        if (!ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
          ambiguousFiles.push({
            storagePath: diskKey,
            reason: 'Extensión no perteneciente al catálogo de audio gestionado; requiere revisión manual.',
          });
          continue;
        }

        if (options.minOrphanAgeMs !== undefined && options.minOrphanAgeMs > 0) {
          const mtimeMs = await this.getFileMtimeMs(diskKey);
          if (mtimeMs === null || Date.now() - mtimeMs < options.minOrphanAgeMs) {
            ambiguousFiles.push({
              storagePath: diskKey,
              reason: 'Archivo reciente o marca temporal no verificable dentro de la ventana de seguridad.',
            });
            continue;
          }
        }
      }

      orphanFiles.push(diskKey);
    }

    if (options.purgeOrphanFiles) {
      for (const orphanKey of orphanFiles) {
        let purgeErr: unknown = null;
        try {
          await this.storageProvider.delete(orphanKey);
        } catch (err) {
          purgeErr = err;
        }

        const existsAfter = await this.storageProvider.exists(orphanKey).catch(() => true);
        if (!purgeErr && !existsAfter) {
          purgedOrphanFiles.push(orphanKey);

          const purgeAudit = await this.persistAuditEvent(
            'AUDIO_ORPHAN_FILE_PURGED',
            null,
            orphanKey,
            {
              storagePath: orphanKey,
              purgedAt: new Date().toISOString(),
            }
          );
          if (purgeAudit.auditLogId) {
            auditLogIds.push(purgeAudit.auditLogId);
          }

          const completed = await this.markRelatedRecoveriesCompleted(
            { storagePath: orphanKey },
            null
          );
          for (const item of completed) {
            recoveredOperations.push({
              recoveryRecordId: item.recoveryRecordId,
              recoveryType: item.recoveryType,
              target: item.target,
            });
            if (item.auditLogId) {
              auditLogIds.push(item.auditLogId);
            }
          }
        } else {
          const reason =
            purgeErr instanceof Error
              ? purgeErr.message
              : purgeErr !== null
                ? String(purgeErr)
                : 'El archivo huérfano permanece en disco tras intentar purgarlo.';
          failedOrphanPurges.push({ storagePath: orphanKey, reason });

          const failAudit = await this.persistAuditEvent(
            'AUDIO_ORPHAN_PURGE_FAILED',
            null,
            orphanKey,
            {
              storagePath: orphanKey,
              reason,
              attemptedAt: new Date().toISOString(),
            }
          );
          if (failAudit.auditLogId) {
            auditLogIds.push(failAudit.auditLogId);
          }
        }
      }
    }

    const pendingRecoveryRecords = Array.from(this.recoveryRecords.values())
      .filter((r) => r.status !== 'RECOVERED')
      .map((r) => ({ ...r }));

    return {
      checkedAssets: assets.length,
      healthyAssetIds,
      missingPhysicalFiles,
      corruptedPhysicalFiles,
      orphanFiles,
      purgedOrphanFiles,
      skippedInFlightFiles,
      ambiguousFiles,
      failedOrphanPurges,
      pendingRecoveryRecords,
      recoveredOperations,
      auditLogIds,
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
   * Elimina un archivo de audio tanto del disco físico como de la base de datos.
   * Si falla la eliminación física, preserva el registro en BD y lanza PersistenceError (sin falsos positivos).
   * Si el archivo físico fue eliminado pero falla la eliminación en BD, persiste metadatos accionables de recuperación y lanza PersistenceError.
   * Es seguro frente a reintentos idempotentes.
   */
  public async deleteAudio(audioId: string, actorUserId?: string): Promise<boolean> {
    const asset = await this.audioRepo.findById(audioId);
    if (!asset) {
      return false;
    }

    const effectiveActorId = actorUserId ?? asset.uploadedByUserId ?? null;
    const existedBefore = await this.storageProvider.exists(asset.storagePath).catch(() => true);

    // Fase 1: Eliminar archivo físico verificando resultado real
    let deletedPhysical = false;
    let physicalError: unknown = null;
    try {
      deletedPhysical = await this.storageProvider.delete(asset.storagePath);
    } catch (err) {
      physicalError = err;
    }

    const existsAfter = await this.storageProvider.exists(asset.storagePath).catch(() => true);
    if (physicalError || (existedBefore && !deletedPhysical) || existsAfter) {
      const causeMessage =
        physicalError instanceof Error
          ? physicalError.message
          : physicalError !== null
            ? String(physicalError)
            : `El archivo físico '${asset.storagePath}' permanece en disco tras intentar eliminarlo.`;
      const createdAt = new Date().toISOString();
      const recoveryId = crypto.randomUUID();

      const record: AudioStorageRecoveryRecord = {
        id: recoveryId,
        recoveryType: 'DELETE_PHYSICAL_FAILED',
        status: 'ABORTED_DB_PRESERVED',
        storagePath: asset.storagePath,
        assetId: asset.id,
        songId: asset.songId,
        filename: asset.filename,
        mimeType: asset.mimeType,
        checksumSha256: asset.checksumSha256,
        fileSizeBytes: asset.fileSizeBytes,
        primaryError: causeMessage,
        persistedToAuditLog: false,
        createdAt,
      };

      const auditRes = await this.persistAuditEvent(
        'AUDIO_DELETE_PHYSICAL_FAILED',
        effectiveActorId,
        asset.storagePath,
        {
          recoveryRecordId: recoveryId,
          recoveryType: record.recoveryType,
          status: record.status,
          assetId: asset.id,
          songId: asset.songId,
          storagePath: asset.storagePath,
          filename: asset.filename,
          mimeType: asset.mimeType,
          checksumSha256: asset.checksumSha256,
          fileSizeBytes: asset.fileSizeBytes,
          cause: causeMessage,
          createdAt,
        }
      );
      record.persistedToAuditLog = auditRes.persisted;
      if (auditRes.auditLogId) {
        record.auditLogId = auditRes.auditLogId;
      }
      this.recoveryRecords.set(recoveryId, record);

      throw new PersistenceError(
        `Fallo al eliminar el archivo físico de audio '${asset.storagePath}'. El registro en base de datos fue preservado para mantener la consistencia.`,
        {
          assetId: asset.id,
          storagePath: asset.storagePath,
          recoveryRecordId: recoveryId,
          dbRecordPreserved: true,
          persistedToAuditLog: record.persistedToAuditLog,
          cause: causeMessage,
        }
      );
    }

    // Fase 2: Eliminar registro en base de datos
    let dbDeleted = false;
    let dbError: unknown = null;
    try {
      dbDeleted = await this.audioRepo.delete(audioId);
    } catch (err) {
      dbError = err;
    }

    if (dbError || !dbDeleted) {
      const causeMessage =
        dbError instanceof Error
          ? dbError.message
          : dbError !== null
            ? String(dbError)
            : `audioRepo.delete('${audioId}') retornó false tras la eliminación física.`;
      const createdAt = new Date().toISOString();
      const recoveryId = crypto.randomUUID();

      const record: AudioStorageRecoveryRecord = {
        id: recoveryId,
        recoveryType: 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE',
        status: 'PENDING_RECOVERY',
        storagePath: asset.storagePath,
        assetId: asset.id,
        songId: asset.songId,
        filename: asset.filename,
        mimeType: asset.mimeType,
        checksumSha256: asset.checksumSha256,
        fileSizeBytes: asset.fileSizeBytes,
        primaryError: causeMessage,
        persistedToAuditLog: false,
        createdAt,
      };

      const auditRes = await this.persistAuditEvent(
        'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE',
        effectiveActorId,
        asset.storagePath,
        {
          recoveryRecordId: recoveryId,
          recoveryType: record.recoveryType,
          status: record.status,
          assetId: asset.id,
          songId: asset.songId,
          storagePath: asset.storagePath,
          filename: asset.filename,
          mimeType: asset.mimeType,
          checksumSha256: asset.checksumSha256,
          fileSizeBytes: asset.fileSizeBytes,
          cause: causeMessage,
          createdAt,
        }
      );
      record.persistedToAuditLog = auditRes.persisted;
      if (auditRes.auditLogId) {
        record.auditLogId = auditRes.auditLogId;
      }
      this.recoveryRecords.set(recoveryId, record);

      throw new PersistenceError(
        `El archivo físico '${asset.storagePath}' fue eliminado, pero falló la eliminación del registro en base de datos para el activo '${asset.id}'. Se generó el registro de recuperación '${recoveryId}'.`,
        {
          assetId: asset.id,
          storagePath: asset.storagePath,
          recoveryRecordId: recoveryId,
          physicalDeleted: true,
          dbDeleted: false,
          persistedToAuditLog: record.persistedToAuditLog,
          cause: causeMessage,
        }
      );
    }

    await this.markRelatedRecoveriesCompleted(
      { assetId: asset.id, storagePath: asset.storagePath },
      effectiveActorId
    );

    return true;
  }
}
