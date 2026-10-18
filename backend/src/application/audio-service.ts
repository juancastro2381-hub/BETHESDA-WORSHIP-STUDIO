/**
 * @file audio-service.ts
 * @description Servicio de aplicación para la gestión del ciclo de vida de audio (Workstream A / R1).
 * Orquesta validaciones de MIME, verificación de magic bytes binarios, cuotas, almacenamiento físico,
 * persistencia en BD y streaming conforme con soporte estricto de HTTP Range (RFC 7233 / 9110).
 */

import { type IAudioRepository } from '../repositories/audio-repository.ts';
import { type IAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import { type ISongRepository } from '../repositories/song-repository.ts';
import { type AudioAsset } from '../db/schema.ts';
import { ValidationError, NotFoundError, RangeNotSatisfiableError } from '../domain/errors.ts';

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

/**
 * Valida la firma binaria ("magic bytes") del archivo para prevenir falsificación MIME.
 */
export function validateAudioMagicBytes(buffer: Buffer, mimeType: string): void {
  if (!buffer || buffer.length < 4) {
    throw new ValidationError('El archivo es demasiado pequeño para contener una cabecera de audio válida.');
  }

  const normalized = mimeType.toLowerCase().trim();

  // 1. WAV: Comienza con 'RIFF' o 'RIFX' y contiene 'WAVE' en los primeros bytes
  if (normalized === 'audio/wav' || normalized === 'audio/wave' || normalized === 'audio/x-wav') {
    const isRiff =
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' ||
      buffer.subarray(0, 4).toString('ascii') === 'RIFX';
    const hasWave = buffer.subarray(0, 32).includes(Buffer.from('WAVE'));
    if (!isRiff || !hasWave) {
      throw new ValidationError(
        'El archivo no posee una firma válida de audio WAV (falta encabezado RIFF/WAVE). Posible falsificación MIME.'
      );
    }
    return;
  }

  // 2. MP3 / MPEG: ID3v2 ('ID3') o Frame Sync (0xFF seguido de bits 111xxxxx)
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') {
    const isId3 = buffer.subarray(0, 3).toString('ascii') === 'ID3';
    const isSync = buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0;
    if (!isId3 && !isSync) {
      throw new ValidationError(
        'El archivo no posee una firma válida de audio MP3 (falta cabecera ID3 o sincronización de tramas MPEG). Posible falsificación MIME.'
      );
    }
    return;
  }

  // 3. OGG: 'OggS'
  if (normalized === 'audio/ogg') {
    const isOgg = buffer.subarray(0, 4).toString('ascii') === 'OggS';
    if (!isOgg) {
      throw new ValidationError(
        'El archivo no posee una firma válida de audio OGG (falta encabezado OggS). Posible falsificación MIME.'
      );
    }
    return;
  }

  // 4. FLAC: 'fLaC'
  if (normalized === 'audio/flac') {
    const isFlac = buffer.subarray(0, 4).toString('ascii') === 'fLaC';
    if (!isFlac) {
      throw new ValidationError(
        'El archivo no posee una firma válida de audio FLAC (falta encabezado fLaC). Posible falsificación MIME.'
      );
    }
    return;
  }

  // 5. MP4 / M4A / AAC: caja 'ftyp' o sync ADTS (0xFFF)
  if (
    normalized === 'audio/mp4' ||
    normalized === 'audio/m4a' ||
    normalized === 'audio/x-m4a' ||
    normalized === 'audio/aac'
  ) {
    const hasFtyp =
      (buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') ||
      buffer.subarray(0, 4).toString('ascii') === 'ftyp';
    const isAdts = buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xf6) === 0xf0;
    if (!hasFtyp && !isAdts) {
      throw new ValidationError(
        'El archivo no posee una firma válida de audio MP4/M4A/AAC (falta contenedor ftyp o tramas ADTS). Posible falsificación MIME.'
      );
    }
    return;
  }

  // 6. WebM: EBML header (0x1A 0x45 0xDF 0xA3)
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

  throw new ValidationError(`Tipo MIME de audio no reconocido para validación de firma: ${mimeType}`);
}

export class AudioService {
  public constructor(
    private readonly audioRepo: IAudioRepository,
    private readonly storageProvider: IAudioStorageProvider,
    private readonly songRepo: ISongRepository,
    private readonly maxFileSizeBytes: number = 50 * 1024 * 1024 // 50MB
  ) {}

  /**
   * Sube y registra un nuevo activo de audio asociado a una canción.
   * Valida existencia de la canción, cuota de tamaño, tipo MIME y magic bytes binarios.
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

    // 5. Guardar archivo físico en el storage provider seguro
    const saveResult = await this.storageProvider.save(filename, buffer);

    // 6. Persistir metadatos en la base de datos
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
