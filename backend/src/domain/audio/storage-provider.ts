/**
 * @file storage-provider.ts
 * @description Proveedor de almacenamiento físico seguro para recursos de audio (Workstream A).
 * Implementa aislamiento en el sistema de archivos, prevención estricta de path traversal,
 * cálculo criptográfico SHA-256 y lectura por rangos para streaming HTTP 206.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

export interface StorageSaveResult {
  readonly storagePath: string;
  readonly checksumSha256: string;
  readonly fileSizeBytes: number;
}

export interface StorageStreamResult {
  readonly stream: NodeJS.ReadableStream;
  readonly totalSize: number;
  readonly start: number;
  readonly end: number;
  readonly chunkSize: number;
}

export interface IAudioStorageProvider {
  save(filename: string, buffer: Buffer): Promise<StorageSaveResult>;
  getStream(storagePath: string, start?: number, end?: number): Promise<StorageStreamResult>;
  getBuffer(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<boolean>;
  exists(storagePath: string): Promise<boolean>;
  resolveSafePath(storagePath: string): string;
}

export class LocalFileSystemAudioStorageProvider implements IAudioStorageProvider {
  private readonly baseDir: string;
  private readonly maxSizeBytes: number;

  public constructor(baseDir: string = 'storage/audio', maxSizeBytes: number = 50 * 1024 * 1024) {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this.maxSizeBytes = maxSizeBytes;

    // Asegurar que el directorio base exista
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Resuelve y valida una ruta contra ataques de Path Traversal (Directory Traversal).
   * Lanza un error de seguridad si el destino se encuentra fuera del baseDir.
   */
  public resolveSafePath(relativePathOrKey: string): string {
    if (!relativePathOrKey || relativePathOrKey.includes('..') || path.isAbsolute(relativePathOrKey)) {
      throw new Error(`Violación de seguridad: Intento de Path Traversal detectado en: ${relativePathOrKey}`);
    }
    const sanitizedKey = path.basename(relativePathOrKey);
    const resolvedPath = path.resolve(this.baseDir, sanitizedKey);

    if (!resolvedPath.startsWith(this.baseDir)) {
      throw new Error(`Violación de seguridad: Intento de Path Traversal detectado en: ${relativePathOrKey}`);
    }

    return resolvedPath;
  }

  /**
   * Guarda un buffer de audio validando tamaño máximo y calculando SHA-256.
   */
  public async save(filename: string, buffer: Buffer): Promise<StorageSaveResult> {
    if (buffer.length > this.maxSizeBytes) {
      throw new Error(
        `El archivo de audio (${buffer.length} bytes) excede la cuota máxima permitida de ${this.maxSizeBytes} bytes (50MB).`
      );
    }

    if (buffer.length === 0) {
      throw new Error('El archivo de audio no puede estar vacío.');
    }

    // Generar nombre físico único e impredecible preservando la extensión
    const ext = path.extname(filename).toLowerCase() || '.mp3';
    const uniqueKey = `${crypto.randomUUID()}${ext}`;
    const targetPath = this.resolveSafePath(uniqueKey);

    // Calcular checksum SHA-256
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Escribir archivo en disco
    await fs.promises.writeFile(targetPath, buffer);

    return {
      storagePath: uniqueKey,
      checksumSha256: hash,
      fileSizeBytes: buffer.length,
    };
  }

  /**
   * Obtiene un flujo de lectura (Readable Stream) con soporte de rangos HTTP para streaming 206.
   */
  public async getStream(storagePath: string, start?: number, end?: number): Promise<StorageStreamResult> {
    const fullPath = this.resolveSafePath(storagePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archivo de audio no encontrado en almacenamiento: ${storagePath}`);
    }

    const stat = await fs.promises.stat(fullPath);
    const totalSize = stat.size;

    const rangeStart = start !== undefined ? Math.max(0, start) : 0;
    const rangeEnd = end !== undefined ? Math.min(totalSize - 1, end) : totalSize - 1;

    if (rangeStart > rangeEnd || rangeStart >= totalSize) {
      throw new Error(`Rango de bytes inválido: bytes=${start}-${end} para un archivo de ${totalSize} bytes.`);
    }

    const chunkSize = rangeEnd - rangeStart + 1;
    const stream = fs.createReadStream(fullPath, { start: rangeStart, end: rangeEnd });

    return {
      stream,
      totalSize,
      start: rangeStart,
      end: rangeEnd,
      chunkSize,
    };
  }

  /**
   * Obtiene el buffer completo del archivo de audio.
   */
  public async getBuffer(storagePath: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(storagePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archivo de audio no encontrado: ${storagePath}`);
    }
    return await fs.promises.readFile(fullPath);
  }

  /**
   * Elimina el archivo del almacenamiento físico.
   */
  public async delete(storagePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(storagePath);
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Verifica la existencia del archivo físico.
   */
  public async exists(storagePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(storagePath);
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
  }
}
