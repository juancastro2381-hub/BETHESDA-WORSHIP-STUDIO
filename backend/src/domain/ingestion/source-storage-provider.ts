/**
 * @file source-storage-provider.ts
 * @description Proveedor de almacenamiento físico y preservación inmutable de fuentes musicales (Fase 1B).
 * Garantiza aislamiento en disco, prevención estricta de Path Traversal, cálculo de hash SHA-256
 * y verificación de integridad criptográfica de los archivos originales importados.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAX_OMR_FILE_SIZE_BYTES } from '../omr/types.ts';
import { ValidationError } from '../errors.ts';

export class StorageReadError extends Error {
  public constructor(
    message: string,
    public readonly originalError?: unknown,
    public readonly targetPath?: string
  ) {
    super(message);
    this.name = 'StorageReadError';
  }
}

export interface SourceStorageSaveResult {
  readonly storageKey: string;
  readonly checksumSha256: string;
  readonly fileSizeBytes: number;
}

export interface ISourceStorageProvider {
  save(filename: string, buffer: Buffer): Promise<SourceStorageSaveResult>;
  getBuffer(storageKey: string): Promise<Buffer>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<boolean>;
  resolveSafePath(storageKey: string): string;
  listKeys?(): Promise<string[]>;
}

export class LocalFileSystemSourceStorageProvider implements ISourceStorageProvider {
  private readonly baseDir: string;
  private readonly maxSizeBytes: number;

  public constructor(
    baseDir: string = 'storage/sources',
    maxSizeBytes: number = MAX_OMR_FILE_SIZE_BYTES // 15 MiB
  ) {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this.maxSizeBytes = maxSizeBytes;

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Resuelve y valida una clave contra ataques de Path Traversal.
   */
  public resolveSafePath(storageKey: string): string {
    if (!storageKey || storageKey.includes('..') || path.isAbsolute(storageKey)) {
      throw new ValidationError(`Violación de seguridad: Intento de Path Traversal detectado en: ${storageKey}`);
    }

    const sanitizedKey = path.basename(storageKey);
    const resolvedPath = path.resolve(this.baseDir, sanitizedKey);

    if (!resolvedPath.startsWith(this.baseDir)) {
      throw new ValidationError(`Violación de seguridad: Intento de Path Traversal detectado en: ${storageKey}`);
    }

    return resolvedPath;
  }

  /**
   * Guarda un buffer de fuente validando límites de tamaño y calculando hash SHA-256.
   */
  public async save(filename: string, buffer: Buffer): Promise<SourceStorageSaveResult> {
    if (buffer.length > this.maxSizeBytes) {
      throw new ValidationError(
        `El archivo (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) excede el tamaño máximo permitido de ${(this.maxSizeBytes / (1024 * 1024)).toFixed(2)} MB.`
      );
    }

    if (buffer.length === 0) {
      throw new ValidationError('El archivo fuente suministrado está vacío (0 bytes).');
    }

    const ext = path.extname(filename).toLowerCase() || '.bin';
    const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const storageKey = `${checksumSha256}${ext}`;
    const targetPath = this.resolveSafePath(storageKey);

    // Escribir archivo atómicamente mediante archivo temporal y renombrado atómico (CR-06)
    if (!fs.existsSync(targetPath)) {
      const tempPath = `${targetPath}.tmp.${crypto.randomUUID()}`;
      try {
        await fs.promises.writeFile(tempPath, buffer);
        await fs.promises.rename(tempPath, targetPath);
      } catch (err) {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath).catch(() => {});
        }
        // Si el archivo de destino ya existe (escritura concurrente idempotente), no fallar
        if (!fs.existsSync(targetPath)) {
          throw err;
        }
      }
    }

    return {
      storageKey,
      checksumSha256,
      fileSizeBytes: buffer.length,
    };
  }

  public async getBuffer(storageKey: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(storageKey);
    try {
      return await fs.promises.readFile(filePath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        throw new ValidationError(`Archivo fuente no encontrado en almacenamiento: ${storageKey}`);
      }
      throw new StorageReadError(
        `Fallo al leer el archivo en almacenamiento "${filePath}": ${err?.message ?? String(err)}`,
        err,
        filePath
      );
    }
  }

  public async exists(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(storageKey);
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  public async delete(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(storageKey);
      await fs.promises.unlink(filePath);
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return false;
      }
      return false;
    }
  }

  public async listKeys(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && !entry.name.includes('.tmp.'))
        .map((entry) => entry.name);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return [];
      }
      throw new StorageReadError(
        `Fallo al leer las claves del almacenamiento en "${this.baseDir}": ${err?.message ?? String(err)}`,
        err,
        this.baseDir
      );
    }
  }
}

