/**
 * @file audio-service.ts
 * @description Servicio de aplicación para la gestión del ciclo de vida de audio (Workstream A).
 * Orquesta validaciones de MIME, cuotas, almacenamiento físico, persistencia en BD y streaming con soporte Range.
 */

import { type IAudioRepository } from '../repositories/audio-repository.ts';
import { type IAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import { type ISongRepository } from '../repositories/song-repository.ts';
import { type AudioAsset } from '../db/schema.ts';
import { ValidationError, NotFoundError } from '../domain/errors.ts';

export interface UploadAudioParams {
  readonly songId: string;
  readonly title: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
  readonly durationSeconds?: number | undefined;
  readonly uploadedByUserId?: string | undefined;
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

export class AudioService {
  public constructor(
    private readonly audioRepo: IAudioRepository,
    private readonly storageProvider: IAudioStorageProvider,
    private readonly songRepo: ISongRepository,
    private readonly maxFileSizeBytes: number = 50 * 1024 * 1024 // 50MB
  ) {}

  /**
   * Sube y registra un nuevo activo de audio asociado a una canción.
   */
  public async uploadAudio(params: UploadAudioParams): Promise<AudioAsset> {
    const { songId, title, filename, mimeType, buffer, durationSeconds, uploadedByUserId } = params;

    // 1. Validar existencia de la canción
    const song = await this.songRepo.findById(songId);
    if (!song) {
      throw new NotFoundError(`Canción con ID ${songId} no encontrada.`);
    }

    // 2. Validar tipo MIME
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

    // 4. Guardar archivo físico en el storage provider seguro
    const saveResult = await this.storageProvider.save(filename, buffer);

    // 5. Persistir metadatos en la base de datos
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
   * Genera un stream de audio con soporte de cabecera HTTP Range (para streaming 206 en <audio>).
   */
  public async streamAudio(audioId: string, rangeHeader?: string): Promise<AudioStreamResponse> {
    const asset = await this.getAudioById(audioId);
    const totalSize = asset.fileSizeBytes;

    let start = 0;
    let end = totalSize - 1;
    let isRangeRequest = false;

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const rawStart = parts[0]?.trim();
      const rawEnd = parts[1]?.trim();

      if (rawStart) {
        start = parseInt(rawStart, 10);
      }
      if (rawEnd) {
        end = parseInt(rawEnd, 10);
      }

      if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
        throw new Error(`Rango insatisfactorio: Range: ${rangeHeader} sobre tamaño total ${totalSize}`);
      }

      end = Math.min(end, totalSize - 1);
      isRangeRequest = true;
    }

    const { stream, chunkSize } = await this.storageProvider.getStream(asset.storagePath, start, end);

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
      },
    };
  }

  /**
   * Obtiene la descarga binaria completa de un audio.
   */
  public async downloadAudio(audioId: string): Promise<AudioDownloadResponse> {
    const asset = await this.getAudioById(audioId);
    const buffer = await this.storageProvider.getBuffer(asset.storagePath);

    return {
      buffer,
      filename: asset.filename,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes,
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
