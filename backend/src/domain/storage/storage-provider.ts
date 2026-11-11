/**
 * @file storage-provider.ts
 * @description Proveedor de almacenamiento agnóstico y de nivel de producción para Bethesda Worship Studio (Fase 2B.1).
 *
 * Soporta:
 * 1. LocalFileSystemStorageProvider: Almacenamiento local con escrituras atómicas (tmp + rename),
 *    prevención estricta de Path Traversal, cálculo criptográfico SHA-256 e idempotencia CAS.
 * 2. S3CompatibleStorageProvider: Abstracción nativa compatible con AWS S3, MinIO y Cloudflare R2
 *    utilizando AWS Signature Version 4 (SigV4) y la API estándar de Node.js (fetch/crypto/stream),
 *    sin dependencias externas adicionales.
 *
 * Invariante no negociable:
 * - El almacenamiento de salidas (storage/outputs/) es independiente de las fuentes (storage/sources/).
 * - Los archivos fuente son inmutables y nunca se podan.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

// ============================================================================
// TIPOS Y METADATOS DE ALMACENAMIENTO
// ============================================================================

export interface StorageMetadata {
  readonly storageKey: string;
  readonly checksumSha256: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly createdAt: Date;
}

export interface StorageSaveOptions {
  mimeType?: string;
  expectedChecksumSha256?: string;
  overwrite?: boolean;
}

export interface StorageStreamResult {
  readonly stream: NodeJS.ReadableStream;
  readonly totalSize: number;
  readonly mimeType?: string;
  readonly checksumSha256?: string;
}

export interface S3ClientConfig {
  endpoint?: string; // e.g. "http://localhost:9000" para MinIO o "https://s3.us-east-1.amazonaws.com"
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // true para MinIO / LocalStack
  publicBaseUrl?: string; // URL pública alternativa para descargas firmadas
}

// ============================================================================
// ERRORES ESPECÍFICOS DE ALMACENAMIENTO
// ============================================================================

export class StorageError extends Error {
  public constructor(
    message: string,
    public readonly code: string = 'STORAGE_ERROR',
    public readonly originalError?: unknown,
    public readonly targetKey?: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export class StorageNotFoundError extends StorageError {
  public constructor(key: string, originalError?: unknown) {
    super(`Objeto no encontrado en almacenamiento: "${key}"`, 'STORAGE_NOT_FOUND', originalError, key);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageIntegrityError extends StorageError {
  public constructor(key: string, expectedHash: string, actualHash: string) {
    super(
      `Violación de integridad en "${key}": hash esperado ${expectedHash}, hash calculado ${actualHash}`,
      'STORAGE_INTEGRITY_MISMATCH',
      undefined,
      key
    );
    this.name = 'StorageIntegrityError';
  }
}

export class StorageCollisionError extends StorageError {
  public constructor(key: string) {
    super(
      `Conflicto CAS: el contenido existente en "${key}" difiere del nuevo contenido propuesto. Sobreescritura no permitida.`,
      'STORAGE_COLLISION_DETECTED',
      undefined,
      key
    );
    this.name = 'StorageCollisionError';
  }
}

export class StorageSecurityError extends StorageError {
  public constructor(message: string, key?: string) {
    super(message, 'STORAGE_SECURITY_VIOLATION', undefined, key);
    this.name = 'StorageSecurityError';
  }
}

// ============================================================================
// INTERFAZ AUTORITATIVA DE PROVEEDOR DE ALMACENAMIENTO
// ============================================================================

export interface IStorageProvider {
  /**
   * Guarda un buffer de forma atómica e idempotente bajo una clave especificada.
   */
  save(storageKey: string, buffer: Buffer, options?: StorageSaveOptions): Promise<StorageMetadata>;

  /**
   * Obtiene el contenido completo de un objeto como Buffer.
   */
  getBuffer(storageKey: string): Promise<Buffer>;

  /**
   * Obtiene un flujo de lectura (ReadableStream) para transferencias eficientes.
   */
  getStream(storageKey: string, start?: number, end?: number): Promise<NodeJS.ReadableStream>;

  /**
   * Verifica la existencia de un objeto en el almacenamiento.
   */
  exists(storageKey: string): Promise<boolean>;

  /**
   * Elimina un objeto del almacenamiento. Retorna true si fue eliminado o false si no existía.
   */
  delete(storageKey: string): Promise<boolean>;

  /**
   * Genera una URL temporal firmada para descarga segura.
   */
  getSignedDownloadUrl(storageKey: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Lista las claves presentes en el almacenamiento bajo un prefijo opcional.
   */
  listKeys(prefix?: string): Promise<string[]>;

  /**
   * Obtiene metadatos de un objeto sin descargar su contenido completo.
   */
  getMetadata(storageKey: string): Promise<StorageMetadata>;
}

// ============================================================================
// IMPLEMENTACIÓN 1: LOCAL FILE SYSTEM STORAGE PROVIDER
// ============================================================================

export class LocalFileSystemStorageProvider implements IStorageProvider {
  private readonly baseDir: string;
  private readonly signingSecret: string;

  public constructor(
    baseDir: string = 'storage/outputs',
    signingSecret: string = 'bethesda_default_storage_signing_secret_2026'
  ) {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this.signingSecret = signingSecret;

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Valida y resuelve de forma segura una clave de almacenamiento contra Directory Traversal.
   */
  public resolveSafePath(storageKey: string): string {
    if (!storageKey || typeof storageKey !== 'string') {
      throw new StorageSecurityError('La clave de almacenamiento no puede estar vacía');
    }

    if (storageKey.includes('\0')) {
      throw new StorageSecurityError(
        `Violación de seguridad: Carácter de byte nulo no permitido en: "${storageKey}"`,
        storageKey
      );
    }

    // Normalizar slashes a formato estándar
    const normalizedKey = storageKey.replace(/\\/g, '/');

    // Detección estricta de traversal
    if (
      normalizedKey.includes('../') ||
      normalizedKey.includes('/..') ||
      normalizedKey === '..' ||
      path.isAbsolute(normalizedKey) ||
      /^[a-zA-Z]:/.test(normalizedKey) // Windows drive letter
    ) {
      throw new StorageSecurityError(
        `Violación de seguridad: Intento de Path Traversal detectado en: "${storageKey}"`,
        storageKey
      );
    }

    const resolved = path.resolve(this.baseDir, normalizedKey);

    // Debe residir estrictamente dentro del baseDir
    if (!resolved.startsWith(this.baseDir + path.sep) && resolved !== this.baseDir) {
      throw new StorageSecurityError(
        `Violación de seguridad: Ruta resuelta fuera del directorio base en: "${storageKey}"`,
        storageKey
      );
    }

    return resolved;
  }

  public async save(
    storageKey: string,
    buffer: Buffer,
    options?: StorageSaveOptions
  ): Promise<StorageMetadata> {
    if (!buffer || buffer.length === 0) {
      throw new StorageError('No se puede almacenar un archivo vacío (0 bytes).', 'EMPTY_BUFFER', undefined, storageKey);
    }

    const targetPath = this.resolveSafePath(storageKey);
    const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    // Validación de checksum esperado (si fue provisto por el llamador)
    if (options?.expectedChecksumSha256 && options.expectedChecksumSha256 !== checksumSha256) {
      throw new StorageIntegrityError(storageKey, options.expectedChecksumSha256, checksumSha256);
    }

    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }

    // Idempotencia CAS: si el archivo ya existe
    if (fs.existsSync(targetPath)) {
      const existingBuffer = await fs.promises.readFile(targetPath);
      const existingHash = crypto.createHash('sha256').update(existingBuffer).digest('hex');

      if (existingHash === checksumSha256) {
        // Idéntico contenido: retornar metadatos sin sobreescribir (operación idempotente)
        const stats = await fs.promises.stat(targetPath);
        return {
          storageKey,
          checksumSha256,
          byteLength: buffer.length,
          mimeType: options?.mimeType || this.inferMimeType(storageKey),
          createdAt: stats.birthtime,
        };
      }

      // El archivo existe pero el contenido difiere: no sobreescribir silenciosamente a menos que se indique overwrite
      if (!options?.overwrite) {
        throw new StorageCollisionError(storageKey);
      }
    }

    // Escritura atómica: crear archivo temporal y renombrar atómicamente
    const tempPath = `${targetPath}.tmp.${crypto.randomUUID()}`;
    try {
      await fs.promises.writeFile(tempPath, buffer);
      await fs.promises.rename(tempPath, targetPath);
    } catch (err: any) {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
      // Si otra hebra completó la escritura con idéntico contenido en paralelo
      if (fs.existsSync(targetPath)) {
        const verifyBuffer = await fs.promises.readFile(targetPath);
        const verifyHash = crypto.createHash('sha256').update(verifyBuffer).digest('hex');
        if (verifyHash === checksumSha256) {
          const stats = await fs.promises.stat(targetPath);
          return {
            storageKey,
            checksumSha256,
            byteLength: buffer.length,
            mimeType: options?.mimeType || this.inferMimeType(storageKey),
            createdAt: stats.birthtime,
          };
        }
      }
      throw new StorageError(
        `Fallo al escribir objeto en almacenamiento "${storageKey}": ${err?.message ?? String(err)}`,
        'WRITE_FAILED',
        err,
        storageKey
      );
    }

    return {
      storageKey,
      checksumSha256,
      byteLength: buffer.length,
      mimeType: options?.mimeType || this.inferMimeType(storageKey),
      createdAt: new Date(),
    };
  }

  public async getBuffer(storageKey: string): Promise<Buffer> {
    const targetPath = this.resolveSafePath(storageKey);
    try {
      return await fs.promises.readFile(targetPath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        throw new StorageNotFoundError(storageKey, err);
      }
      throw new StorageError(
        `Fallo al leer objeto "${storageKey}": ${err?.message ?? String(err)}`,
        'READ_FAILED',
        err,
        storageKey
      );
    }
  }

  public async getStream(
    storageKey: string,
    start?: number,
    end?: number
  ): Promise<NodeJS.ReadableStream> {
    const targetPath = this.resolveSafePath(storageKey);
    if (!fs.existsSync(targetPath)) {
      throw new StorageNotFoundError(storageKey);
    }

    const options: { start?: number; end?: number } = {};
    if (typeof start === 'number') options.start = start;
    if (typeof end === 'number') options.end = end;

    return fs.createReadStream(targetPath, options);
  }

  public async exists(storageKey: string): Promise<boolean> {
    try {
      const targetPath = this.resolveSafePath(storageKey);
      return fs.existsSync(targetPath);
    } catch (err) {
      if (err instanceof StorageSecurityError) {
        throw err;
      }
      return false;
    }
  }

  public async delete(storageKey: string): Promise<boolean> {
    const targetPath = this.resolveSafePath(storageKey);
    try {
      await fs.promises.unlink(targetPath);
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return false;
      }
      throw new StorageError(
        `Fallo al eliminar objeto "${storageKey}": ${err?.message ?? String(err)}`,
        'DELETE_FAILED',
        err,
        storageKey
      );
    }
  }

  public async getMetadata(storageKey: string): Promise<StorageMetadata> {
    const targetPath = this.resolveSafePath(storageKey);
    try {
      const stats = await fs.promises.stat(targetPath);
      const buffer = await fs.promises.readFile(targetPath);
      const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      return {
        storageKey,
        checksumSha256,
        byteLength: stats.size,
        mimeType: this.inferMimeType(storageKey),
        createdAt: stats.mtime < stats.birthtime ? stats.mtime : (stats.birthtime || stats.mtime),
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        throw new StorageNotFoundError(storageKey, err);
      }
      throw new StorageError(
        `Fallo al obtener metadatos de "${storageKey}": ${err?.message ?? String(err)}`,
        'METADATA_FAILED',
        err,
        storageKey
      );
    }
  }

  public async getSignedDownloadUrl(storageKey: string, expiresInSeconds: number = 3600): Promise<string> {
    if (!(await this.exists(storageKey))) {
      throw new StorageNotFoundError(storageKey);
    }

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const dataToSign = `${storageKey}:${expiresAt}`;
    const signature = crypto
      .createHmac('sha256', this.signingSecret)
      .update(dataToSign)
      .digest('hex');

    // Retorna URL relativa para consumo por API
    const encodedKey = encodeURIComponent(storageKey);
    return `/api/v1/conversion/outputs/${encodedKey}?expires=${expiresAt}&signature=${signature}`;
  }

  public verifySignedUrl(storageKey: string, expiresAt: number, signature: string): boolean {
    if (Math.floor(Date.now() / 1000) > expiresAt) {
      return false;
    }
    const dataToSign = `${storageKey}:${expiresAt}`;
    const expectedSig = crypto
      .createHmac('sha256', this.signingSecret)
      .update(dataToSign)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSig, 'utf8'));
  }

  public async listKeys(prefix: string = ''): Promise<string[]> {
    const result: string[] = [];

    const scanDir = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          // Ignorar archivos temporales
          if (entry.name.includes('.tmp.')) continue;
          const relativeKey = path.relative(this.baseDir, fullPath).replace(/\\/g, '/');
          if (!prefix || relativeKey.startsWith(prefix)) {
            result.push(relativeKey);
          }
        }
      }
    };

    if (fs.existsSync(this.baseDir)) {
      await scanDir(this.baseDir);
    }
    return result.sort();
  }

  private inferMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case '.musicxml':
      case '.xml':
        return 'application/vnd.recordare.musicxml+xml';
      case '.mid':
      case '.midi':
        return 'audio/midi';
      case '.cho':
      case '.crd':
      case '.pro':
      case '.chordpro':
        return 'text/x-chordpro';
      case '.pdf':
        return 'application/pdf';
      case '.json':
        return 'application/json';
      case '.txt':
        return 'text/plain';
      default:
        return 'application/octet-stream';
    }
  }
}

// ============================================================================
// IMPLEMENTACIÓN 2: S3-COMPATIBLE STORAGE PROVIDER (Nativo AWS SigV4)
// ============================================================================

export class S3CompatibleStorageProvider implements IStorageProvider {
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;
  private readonly publicBaseUrl?: string;

  public constructor(config: S3ClientConfig) {
    this.bucket = config.bucket;
    this.region = config.region || 'us-east-1';
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.forcePathStyle = config.forcePathStyle ?? true;
    this.publicBaseUrl = config.publicBaseUrl;

    const rawEndpoint = config.endpoint || 'https://s3.amazonaws.com';
    this.endpoint = rawEndpoint.replace(/\/+$/, '');
  }

  public getBucketName(): string {
    return this.bucket;
  }

  public getRegion(): string {
    return this.region;
  }

  public isPathStyle(): boolean {
    return this.forcePathStyle;
  }

  public getSignatureKey(
    key: string,
    dateStamp: string,
    region: string,
    service: string
  ): Buffer {
    const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  }

  /**
   * Construye el URL completo de destino para un objeto S3.
   */
  private getObjectUrl(storageKey: string): URL {
    const cleanKey = storageKey.replace(/^\/+/, '');
    if (this.forcePathStyle) {
      return new URL(`${this.endpoint}/${this.bucket}/${cleanKey}`);
    } else {
      const endpointUrl = new URL(this.endpoint);
      return new URL(`${endpointUrl.protocol}//${this.bucket}.${endpointUrl.host}/${cleanKey}`);
    }
  }

  /**
   * Firma solicitudes HTTP utilizando AWS Signature Version 4 (SigV4).
   */
  private signRequest(
    method: string,
    url: URL,
    headers: Record<string, string>,
    payloadHash: string,
    date: Date = new Date()
  ): Record<string, string> {
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const signedHeadersList: string[] = [];
    const canonicalHeadersMap: Record<string, string> = {};

    const baseHeaders: Record<string, string> = {
      ...headers,
      host: url.host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    };

    const sortedHeaderKeys = Object.keys(baseHeaders).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    for (const key of sortedHeaderKeys) {
      const lowerKey = key.toLowerCase();
      signedHeadersList.push(lowerKey);
      canonicalHeadersMap[lowerKey] = baseHeaders[key].trim().replace(/\s+/g, ' ');
    }

    const signedHeaders = signedHeadersList.join(';');
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => `${k.toLowerCase()}:${canonicalHeadersMap[k.toLowerCase()]}\n`)
      .join('');

    const canonicalUri = url.pathname;
    const canonicalQueryString = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');

    const stringToSign = [algorithm, amzDate, credentialScope, canonicalRequestHash].join('\n');

    // Derivación de clave de firma
    const kDate = crypto.createHmac('sha256', `AWS4${this.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authorizationHeader = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...baseHeaders,
      authorization: authorizationHeader,
    };
  }

  public async save(
    storageKey: string,
    buffer: Buffer,
    options?: StorageSaveOptions
  ): Promise<StorageMetadata> {
    if (!buffer || buffer.length === 0) {
      throw new StorageError('No se puede almacenar un archivo vacío en S3.', 'EMPTY_BUFFER', undefined, storageKey);
    }

    const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    if (options?.expectedChecksumSha256 && options.expectedChecksumSha256 !== checksumSha256) {
      throw new StorageIntegrityError(storageKey, options.expectedChecksumSha256, checksumSha256);
    }

    const mimeType = options?.mimeType || 'application/octet-stream';
    const url = this.getObjectUrl(storageKey);

    // Verificar si ya existe idéntico objeto (Idempotencia CAS)
    const existsAlready = await this.exists(storageKey);
    if (existsAlready && !options?.overwrite) {
      const existingMeta = await this.getMetadata(storageKey).catch(() => null);
      if (existingMeta && existingMeta.checksumSha256 === checksumSha256) {
        return existingMeta;
      }
      if (existingMeta && existingMeta.checksumSha256 !== checksumSha256) {
        throw new StorageCollisionError(storageKey);
      }
    }

    const headers: Record<string, string> = {
      'content-type': mimeType,
      'content-length': String(buffer.length),
      'x-amz-meta-checksum-sha256': checksumSha256,
    };

    const signedHeaders = this.signRequest('PUT', url, headers, checksumSha256);

    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: signedHeaders,
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new StorageError(
        `Fallo al subir objeto a S3 [${response.status} ${response.statusText}]: ${errText}`,
        'S3_PUT_FAILED',
        undefined,
        storageKey
      );
    }

    return {
      storageKey,
      checksumSha256,
      byteLength: buffer.length,
      mimeType,
      createdAt: new Date(),
    };
  }

  public async getBuffer(storageKey: string): Promise<Buffer> {
    const url = this.getObjectUrl(storageKey);
    const emptyPayloadHash = crypto.createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('GET', url, {}, emptyPayloadHash);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: signedHeaders,
    });

    if (response.status === 404) {
      throw new StorageNotFoundError(storageKey);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new StorageError(
        `Fallo al leer objeto de S3 [${response.status} ${response.statusText}]: ${errText}`,
        'S3_GET_FAILED',
        undefined,
        storageKey
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  public async getStream(
    storageKey: string,
    start?: number,
    end?: number
  ): Promise<NodeJS.ReadableStream> {
    const url = this.getObjectUrl(storageKey);
    const emptyPayloadHash = crypto.createHash('sha256').update('').digest('hex');

    const headers: Record<string, string> = {};
    if (typeof start === 'number') {
      headers['range'] = `bytes=${start}-${typeof end === 'number' ? end : ''}`;
    }

    const signedHeaders = this.signRequest('GET', url, headers, emptyPayloadHash);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: signedHeaders,
    });

    if (response.status === 404) {
      throw new StorageNotFoundError(storageKey);
    }

    if (!response.ok && response.status !== 206) {
      throw new StorageError(
        `Fallo al solicitar flujo desde S3 [${response.status}]`,
        'S3_STREAM_FAILED',
        undefined,
        storageKey
      );
    }

    if (!response.body) {
      throw new StorageError('Cuerpo de respuesta vacío desde S3', 'S3_EMPTY_BODY', undefined, storageKey);
    }

    // Convertir Web ReadableStream a Node.js ReadableStream
    return Readable.fromWeb(response.body as any);
  }

  public async exists(storageKey: string): Promise<boolean> {
    const url = this.getObjectUrl(storageKey);
    const emptyPayloadHash = crypto.createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('HEAD', url, {}, emptyPayloadHash);

    const response = await fetch(url.toString(), {
      method: 'HEAD',
      headers: signedHeaders,
    });

    if (response.status === 200) return true;
    if (response.status === 404) return false;
    return false;
  }

  public async delete(storageKey: string): Promise<boolean> {
    const url = this.getObjectUrl(storageKey);
    const emptyPayloadHash = crypto.createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('DELETE', url, {}, emptyPayloadHash);

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: signedHeaders,
    });

    if (response.status === 204 || response.status === 200) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }

    return false;
  }

  public async getMetadata(storageKey: string): Promise<StorageMetadata> {
    const url = this.getObjectUrl(storageKey);
    const emptyPayloadHash = crypto.createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('HEAD', url, {}, emptyPayloadHash);

    const response = await fetch(url.toString(), {
      method: 'HEAD',
      headers: signedHeaders,
    });

    if (response.status === 404) {
      throw new StorageNotFoundError(storageKey);
    }

    if (!response.ok) {
      throw new StorageError(`Fallo al consultar metadatos S3 [${response.status}]`, 'S3_HEAD_FAILED', undefined, storageKey);
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    const metaHash = response.headers.get('x-amz-meta-checksum-sha256') || '';
    const lastModifiedStr = response.headers.get('last-modified');
    const createdAt = lastModifiedStr ? new Date(lastModifiedStr) : new Date();

    return {
      storageKey,
      checksumSha256: metaHash,
      byteLength: contentLength,
      mimeType,
      createdAt,
    };
  }

  public async getSignedDownloadUrl(storageKey: string, expiresInSeconds: number = 3600): Promise<string> {
    const url = this.getObjectUrl(storageKey);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', `${this.accessKeyId}/${credentialScope}`);
    url.searchParams.set('X-Amz-Date', amzDate);
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
    url.searchParams.set('X-Amz-SignedHeaders', 'host');

    const canonicalUri = url.pathname;
    const canonicalQueryString = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const canonicalHeaders = `host:${url.host}\n`;
    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n');

    const kDate = crypto.createHmac('sha256', `AWS4${this.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    url.searchParams.set('X-Amz-Signature', signature);

    if (this.publicBaseUrl) {
      const publicBase = new URL(this.publicBaseUrl);
      url.protocol = publicBase.protocol;
      url.host = publicBase.host;
    }

    return url.toString();
  }

  public async listKeys(prefix: string = ''): Promise<string[]> {
    const url = new URL(this.endpoint);
    if (this.forcePathStyle) {
      url.pathname = `/${this.bucket}`;
    } else {
      url.host = `${this.bucket}.${url.host}`;
      url.pathname = '/';
    }

    url.searchParams.set('list-type', '2');
    if (prefix) {
      url.searchParams.set('prefix', prefix);
    }

    const emptyPayloadHash = crypto.createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('GET', url, {}, emptyPayloadHash);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: signedHeaders,
    });

    if (!response.ok) {
      throw new StorageError(`Fallo al listar objetos en S3 [${response.status}]`, 'S3_LIST_FAILED');
    }

    const xmlText = await response.text();
    // Extracción regex de <Key>...</Key> para evitar dependencias XML externas
    const keys: string[] = [];
    const keyMatches = xmlText.matchAll(/<Key>(.*?)<\/Key>/g);
    for (const match of keyMatches) {
      if (match[1]) {
        keys.push(match[1]);
      }
    }

    return keys.sort();
  }
}
