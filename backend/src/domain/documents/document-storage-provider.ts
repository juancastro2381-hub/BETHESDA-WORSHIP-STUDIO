/**
 * @file document-storage-provider.ts
 * @description Proveedor de almacenamiento físico seguro para documentos de partituras (PDF e imágenes) (Fase B).
 * Implementa aislamiento en el sistema de archivos, prevención estricta de path traversal,
 * cálculo criptográfico SHA-256 e integridad inmutable.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { type DocumentSaveResult } from './document-types.ts';
import { DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES } from './document-types.ts';

export interface IDocumentStorageProvider {
  save(filename: string, buffer: Buffer): Promise<DocumentSaveResult>;
  getBuffer(storageKey: string): Promise<Buffer>;
  getStream(storageKey: string, start?: number, end?: number): Promise<{ stream: NodeJS.ReadableStream; totalSize: number }>;
  delete(storageKey: string): Promise<boolean>;
  exists(storageKey: string): Promise<boolean>;
  resolveSafePath(storageKey: string): string;
}

export class LocalFileSystemDocumentStorageProvider implements IDocumentStorageProvider {
  private readonly baseDir: string;
  private readonly maxSizeBytes: number;

  public constructor(
    baseDir: string = 'storage/documents',
    maxSizeBytes: number = DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES
  ) {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this.maxSizeBytes = maxSizeBytes;

    // Asegurar que el directorio base de documentos exista
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Resuelve y valida una clave contra ataques de Path Traversal (Directory Traversal).
   * Lanza un error de seguridad si el destino se encuentra fuera del baseDir.
   */
  public resolveSafePath(storageKey: string): string {
    if (!storageKey || storageKey.includes('..') || path.isAbsolute(storageKey)) {
      throw new Error(`Violación de seguridad: Intento de Path Traversal detectado en: ${storageKey}`);
    }

    const sanitizedKey = path.basename(storageKey);
    const resolvedPath = path.resolve(this.baseDir, sanitizedKey);

    if (!resolvedPath.startsWith(this.baseDir)) {
      throw new Error(`Violación de seguridad: Intento de Path Traversal detectado en: ${storageKey}`);
    }

    return resolvedPath;
  }

  /**
   * Guarda un buffer de documento validando límites y calculando checksum SHA-256.
   */
  public async save(filename: string, buffer: Buffer): Promise<DocumentSaveResult> {
    if (buffer.length > this.maxSizeBytes) {
      throw new Error(
        `El documento (${buffer.length} bytes) excede el tamaño máximo permitido de ${this.maxSizeBytes} bytes.`
      );
    }

    if (buffer.length === 0) {
      throw new Error('El archivo de documento no puede estar vacío.');
    }

    // Generar nombre físico único e impredecible preservando la extensión
    const ext = path.extname(filename).toLowerCase() || '.pdf';
    const uniqueKey = `${crypto.randomUUID()}${ext}`;
    const targetPath = this.resolveSafePath(uniqueKey);

    // Calcular hash SHA-256
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Escribir archivo en disco
    await fs.promises.writeFile(targetPath, buffer);

    return {
      storageKey: uniqueKey,
      checksumSha256: hash,
      fileSizeBytes: buffer.length,
    };
  }

  /**
   * Lee el buffer completo de un documento almacenado.
   */
  public async getBuffer(storageKey: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(storageKey);
    return await fs.promises.readFile(filePath);
  }

  /**
   * Retorna un Readable stream del documento.
   */
  public async getStream(
    storageKey: string,
    start?: number,
    end?: number
  ): Promise<{ stream: NodeJS.ReadableStream; totalSize: number }> {
    const filePath = this.resolveSafePath(storageKey);
    const stat = await fs.promises.stat(filePath);

    const stream = fs.createReadStream(filePath, {
      start: typeof start === 'number' ? start : undefined,
      end: typeof end === 'number' ? end : undefined,
    });

    return {
      stream,
      totalSize: stat.size,
    };
  }

  /**
   * Elimina un documento del sistema de archivos.
   */
  public async delete(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(storageKey);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Comprueba si un documento existe físicamente.
   */
  public async exists(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(storageKey);
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }
}
