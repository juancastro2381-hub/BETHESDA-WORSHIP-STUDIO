/**
 * @file storage-provider.ts
 * @description Proveedor de almacenamiento físico seguro para recursos de audio (Workstream A).
 * Implementa aislamiento en el sistema de archivos, prevención estricta de path traversal,
 * cálculo criptográfico SHA-256 y lectura por rangos para streaming HTTP 206.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NotFoundError, PersistenceError, RangeNotSatisfiableError, ValidationError } from '../errors.ts';

export interface StorageSaveResult {
  readonly storagePath: string;
  readonly checksumSha256: string;
  readonly fileSizeBytes: number;
}

export interface StreamIntegrityOptions {
  readonly expectedChecksumSha256?: string | undefined;
  readonly expectedSizeBytes?: number | undefined;
}

export interface StorageStreamResult {
  readonly stream: NodeJS.ReadableStream;
  readonly totalSize: number;
  readonly start: number;
  readonly end: number;
  readonly chunkSize: number;
  readonly verifiedChecksumSha256?: string | undefined;
}

export interface IAudioStorageProvider {
  save(filename: string, buffer: Buffer): Promise<StorageSaveResult>;
  getStream(
    storagePath: string,
    start?: number,
    end?: number,
    options?: StreamIntegrityOptions
  ): Promise<StorageStreamResult>;
  getBuffer(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<boolean>;
  exists(storagePath: string): Promise<boolean>;
  stat?(storagePath: string): Promise<{ size: number; mtimeMs: number } | null>;
  resolveSafePath(storagePath: string): string;
  listKeys(): Promise<string[]>;
}

const STREAM_HASH_CHUNK_BYTES = 65536; // 64 KiB buffer constante para verificación previa al streaming

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
   * Resuelve y valida una ruta contra ataques de Path Traversal, bytes nulos y escape por symlinks.
   * Lanza ValidationError si el destino es inválido o intenta salir de baseDir.
   */
  public resolveSafePath(relativePathOrKey: string): string {
    if (!relativePathOrKey || typeof relativePathOrKey !== 'string' || relativePathOrKey.includes('\0')) {
      throw new ValidationError(
        `Violación de seguridad: Intento de Path Traversal o clave inválida detectada en: ${relativePathOrKey}`
      );
    }

    if (
      relativePathOrKey.includes('..') ||
      path.isAbsolute(relativePathOrKey) ||
      /^[a-zA-Z]:/.test(relativePathOrKey)
    ) {
      throw new ValidationError(
        `Violación de seguridad: Intento de Path Traversal detectado en: ${relativePathOrKey}`
      );
    }

    const normalizedRel = path.normalize(relativePathOrKey).replace(/^[/\\]+/, '');
    if (!normalizedRel || normalizedRel === '.' || normalizedRel.startsWith('..') || path.isAbsolute(normalizedRel)) {
      throw new ValidationError(
        `Violación de seguridad: Intento de Path Traversal detectado en: ${relativePathOrKey}`
      );
    }

    const baseWithSep = this.baseDir.endsWith(path.sep) ? this.baseDir : `${this.baseDir}${path.sep}`;
    const resolvedPath = path.resolve(this.baseDir, normalizedRel);

    if (!resolvedPath.startsWith(baseWithSep)) {
      throw new ValidationError(
        `Violación de seguridad: Intento de Path Traversal detectado en: ${relativePathOrKey}`
      );
    }

    // Protección contra symlink escape cuando el archivo o enlace existe físicamente
    const realBase = fs.realpathSync(this.baseDir);
    const realBaseWithSep = realBase.endsWith(path.sep) ? realBase : `${realBase}${path.sep}`;
    const lstat = fs.lstatSync(resolvedPath, { throwIfNoEntry: false });
    if (lstat) {
      let realTarget: string;
      try {
        realTarget = fs.realpathSync(resolvedPath);
      } catch {
        throw new ValidationError(
          `Violación de seguridad: Intento de Path Traversal mediante enlace simbólico inválido en: ${relativePathOrKey}`
        );
      }
      if (!realTarget.startsWith(realBaseWithSep)) {
        throw new ValidationError(
          `Violación de seguridad: Intento de Path Traversal mediante enlace simbólico detectado en: ${relativePathOrKey}`
        );
      }
    }

    return resolvedPath;
  }

  /**
   * Guarda un buffer de audio de forma atómica (.tmp -> fsync/datasync -> rename),
   * calculando SHA-256 y aplicando permisos de solo lectura (0o444) en disco.
   */
  public async save(filename: string, buffer: Buffer): Promise<StorageSaveResult> {
    if (buffer.length > this.maxSizeBytes) {
      throw new ValidationError(
        `El archivo de audio (${buffer.length} bytes) excede la cuota máxima permitida de ${this.maxSizeBytes} bytes (50MB).`
      );
    }

    if (buffer.length === 0) {
      throw new ValidationError('El archivo de audio no puede estar vacío.');
    }

    // Generar clave física única e impredecible preservando extensión segura
    const rawExt = path.extname(path.basename(filename)).toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '.mp3';
    const uniqueKey = `${crypto.randomUUID()}${safeExt}`;
    const targetPath = this.resolveSafePath(uniqueKey);
    const tempPath = `${targetPath}.tmp.${crypto.randomUUID()}`;

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    // Calcular checksum SHA-256 sobre los bytes originales exactos
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Escritura atómica con datasync + rename
    const tempHandle = await fs.promises.open(tempPath, 'wx');
    try {
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await tempHandle.write(buffer, offset, buffer.length - offset, offset);
        if (bytesWritten <= 0) break;
        offset += bytesWritten;
      }
      await tempHandle.datasync();
    } catch (err) {
      await tempHandle.close().catch(() => {});
      await fs.promises.unlink(tempPath).catch(() => {});
      throw err;
    }
    await tempHandle.close();

    try {
      await fs.promises.rename(tempPath, targetPath);
      await fs.promises.chmod(targetPath, 0o444);
    } catch (err) {
      await fs.promises.unlink(tempPath).catch(() => {});
      await fs.promises.chmod(targetPath, 0o666).catch(() => {});
      await fs.promises.unlink(targetPath).catch(() => {});
      throw err;
    }

    return {
      storagePath: uniqueKey,
      checksumSha256: hash,
      fileSizeBytes: buffer.length,
    };
  }

  /**
   * Obtiene un flujo de lectura (Readable Stream) sobre un descriptor único abierto,
   * verificando tamaño e integridad SHA-256 completa antes de emitir bytes al cliente (sin TOCTOU ni buffering total).
   */
  public async getStream(
    storagePath: string,
    start?: number,
    end?: number,
    options?: StreamIntegrityOptions
  ): Promise<StorageStreamResult> {
    const fullPath = this.resolveSafePath(storagePath);

    let fileHandle: fs.promises.FileHandle;
    try {
      fileHandle = await fs.promises.open(fullPath, 'r');
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') {
        throw new NotFoundError('Archivo físico de audio', storagePath);
      }
      throw err;
    }

    let transferredOwnership = false;
    try {
      const stat = await fileHandle.stat();
      if (!stat.isFile()) {
        throw new NotFoundError('Archivo físico de audio', storagePath);
      }

      const totalSize = stat.size;

      if (options?.expectedSizeBytes !== undefined && totalSize !== options.expectedSizeBytes) {
        throw new ValidationError(
          `Integridad física comprometida: el tamaño físico en disco (${totalSize} bytes) no coincide con el tamaño registrado (${options.expectedSizeBytes} bytes).`
        );
      }

      let verifiedChecksumSha256: string | undefined;
      if (options?.expectedChecksumSha256) {
        const hasher = crypto.createHash('sha256');
        const chunkBuf = Buffer.allocUnsafe(STREAM_HASH_CHUNK_BYTES);
        let position = 0;

        while (position < totalSize) {
          const toRead = Math.min(chunkBuf.length, totalSize - position);
          const { bytesRead } = await fileHandle.read(chunkBuf, 0, toRead, position);
          if (bytesRead === 0) break;
          hasher.update(chunkBuf.subarray(0, bytesRead));
          position += bytesRead;
        }

        const computedHash = hasher.digest('hex');
        if (computedHash.toLowerCase() !== options.expectedChecksumSha256.toLowerCase()) {
          throw new ValidationError(
            `Integridad física comprometida: el hash SHA-256 verificado antes del streaming (${computedHash}) no coincide con el registrado (${options.expectedChecksumSha256}).`
          );
        }
        verifiedChecksumSha256 = computedHash;
      }

      const rangeStart = start !== undefined ? Math.max(0, start) : 0;
      const rangeEnd = end !== undefined ? Math.min(totalSize - 1, end) : totalSize - 1;

      if (totalSize === 0 || rangeStart > rangeEnd || rangeStart >= totalSize) {
        throw new RangeNotSatisfiableError(
          `Rango de bytes inválido: bytes=${start}-${end} para un archivo de ${totalSize} bytes.`,
          totalSize
        );
      }

      const chunkSize = rangeEnd - rangeStart + 1;
      const stream = fileHandle.createReadStream({
        start: rangeStart,
        end: rangeEnd,
        autoClose: true,
      });

      transferredOwnership = true;
      return {
        stream,
        totalSize,
        start: rangeStart,
        end: rangeEnd,
        chunkSize,
        verifiedChecksumSha256,
      };
    } finally {
      if (!transferredOwnership) {
        await fileHandle.close().catch(() => {});
      }
    }
  }

  /**
   * Obtiene el buffer completo del archivo de audio usando descriptor único seguro.
   */
  public async getBuffer(storagePath: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(storagePath);
    let fileHandle: fs.promises.FileHandle;
    try {
      fileHandle = await fs.promises.open(fullPath, 'r');
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') {
        throw new NotFoundError('Archivo físico de audio', storagePath);
      }
      throw err;
    }

    try {
      const stat = await fileHandle.stat();
      if (!stat.isFile()) {
        throw new NotFoundError('Archivo físico de audio', storagePath);
      }
      return await fileHandle.readFile();
    } finally {
      await fileHandle.close().catch(() => {});
    }
  }

  /**
   * Elimina el archivo del almacenamiento físico, restaurando permisos escribibles si es necesario.
   * Retorna `false` de forma idempotente únicamente cuando el archivo ya no existe (`ENOENT`).
   * Lanza `PersistenceError` si el archivo existe pero no pudo eliminarse del disco.
   */
  public async delete(storagePath: string): Promise<boolean> {
    const fullPath = this.resolveSafePath(storagePath);

    const lstat = fs.lstatSync(fullPath, { throwIfNoEntry: false });
    if (!lstat) {
      return false;
    }

    try {
      await fs.promises.chmod(fullPath, 0o666).catch(() => {});
      await fs.promises.unlink(fullPath);
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return false;
      }
      throw new PersistenceError(
        `No se pudo eliminar el archivo físico de audio '${storagePath}': ${err instanceof Error ? err.message : String(err)}`,
        {
          storagePath,
          code: err?.code,
          cause: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  /**
   * Obtiene metadatos básicos del archivo en disco (tamaño y marca de modificación) o null si no existe.
   */
  public async stat(storagePath: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const fullPath = this.resolveSafePath(storagePath);
      const fileStat = await fs.promises.stat(fullPath);
      if (!fileStat.isFile()) {
        return null;
      }
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Verifica la existencia del archivo físico.
   */
  public async exists(storagePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(storagePath);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Enumera todas las claves físicas válidas almacenadas bajo baseDir (excluyendo temporales .tmp.*).
   */
  public async listKeys(): Promise<string[]> {
    if (!fs.existsSync(this.baseDir)) {
      return [];
    }

    const keys: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.includes('.tmp.')) continue;
        const fullEntryPath = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(fullEntryPath);
        } else if (entry.isFile()) {
          const rel = path.relative(this.baseDir, fullEntryPath).split(path.sep).join('/');
          keys.push(rel);
        }
      }
    };

    await walk(this.baseDir);
    return keys.sort();
  }
}
