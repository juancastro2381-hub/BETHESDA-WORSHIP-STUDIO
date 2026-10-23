/**
 * @file document-ingestion.test.ts
 * @description Suite de pruebas automatizadas para la ingesta, validación server-side,
 * almacenamiento seguro y persistencia de documentos visuales (PDF e imágenes) (Fase B).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateDocumentFileSignature,
  sanitizeSafeFilename,
} from '../domain/documents/document-validation.ts';
import { LocalFileSystemDocumentStorageProvider } from '../domain/documents/document-storage-provider.ts';
import { DocumentService } from '../application/document-service.ts';
import { SongService } from '../application/song-service.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { ValidationError, NotFoundError } from '../domain/errors.ts';
import { buildApp } from '../app.ts';
import { type FastifyInstance } from 'fastify';
import { pool } from '../db/index.ts';

describe('Fase B — Ingesta de Documentos y Partituras Visuales (Backend Suite)', () => {
  const TEST_STORAGE_DIR = 'storage/test-documents';
  let storageProvider: LocalFileSystemDocumentStorageProvider;
  let documentService: DocumentService;
  let app: FastifyInstance;
  let leaderToken: string;
  let testUserId: string;

  // Buffers sintéticos con firmas binarias legítimas
  const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf-8');
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validTiffBuffer = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]); // Little-endian TIFF
  const validWebpBuffer = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x1a, 0x00, 0x00, 0x00, // file size
    0x57, 0x45, 0x42, 0x50, // "WEBP"
    0x56, 0x50, 0x38, 0x20, // "VP8 "
  ]);

  before(async () => {
    storageProvider = new LocalFileSystemDocumentStorageProvider(TEST_STORAGE_DIR);
    const songRepo = new DrizzleSongRepository();
    const versionRepo = new DrizzleSongVersionRepository();
    const songService = new SongService(songRepo, versionRepo);
    documentService = new DocumentService(storageProvider, songService);

    app = await buildApp();
    await app.ready();

    // Crear usuario de prueba con rol WORSHIP_LEADER para autorización
    const userRepo = new DrizzleUserRepository();
    const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    const timestamp = Date.now();

    const leaderUser = await userRepo.create({
      email: `test-doc-leader-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Director',
      lastName: 'Worship',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    testUserId = leaderUser.id;

    leaderToken = tokenService.signAccessToken({
      sub: leaderUser.id,
      email: leaderUser.email,
      role: leaderUser.role,
    }).token;
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (testUserId) {
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    // Limpieza de directorio de pruebas
    try {
      const absDir = path.resolve(process.cwd(), TEST_STORAGE_DIR);
      if (fs.existsSync(absDir)) {
        fs.rmSync(absDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorar errores de limpieza
    }
  });

  // ==========================================================================
  // 1. VALIDACIÓN SERVER-SIDE DE FIRMAS BINARIAS Y SEGURIDAD
  // ==========================================================================
  describe('1. Validación de Firmas Binarias y Seguridad (Server-side)', () => {
    it('1.1 should detect and approve legitimate PDF documents (%PDF- header)', () => {
      const format = validateDocumentFileSignature(validPdfBuffer, 'application/pdf');
      assert.equal(format, 'PDF');
    });

    it('1.2 should detect and approve legitimate PNG images', () => {
      const format = validateDocumentFileSignature(validPngBuffer, 'image/png');
      assert.equal(format, 'IMAGE');
    });

    it('1.3 should detect and approve legitimate JPEG images', () => {
      const format = validateDocumentFileSignature(validJpegBuffer, 'image/jpeg');
      assert.equal(format, 'IMAGE');
    });

    it('1.4 should detect and approve legitimate TIFF images', () => {
      const format = validateDocumentFileSignature(validTiffBuffer, 'image/tiff');
      assert.equal(format, 'IMAGE');
    });

    it('1.5 should detect and approve legitimate WEBP images', () => {
      const format = validateDocumentFileSignature(validWebpBuffer, 'image/webp');
      assert.equal(format, 'IMAGE');
    });

    it('1.6 should reject truncated or empty buffers (< 8 bytes) with ValidationError', () => {
      const smallBuffer = Buffer.from('%PDF', 'utf-8');
      assert.throws(
        () => validateDocumentFileSignature(smallBuffer, 'application/pdf'),
        (err: any) => err instanceof ValidationError && err.message.includes('demasiado pequeño')
      );
    });

    it('1.7 should reject MIME spoofing: HTML disguised as PDF', () => {
      const htmlDisguisedAsPdf = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf-8');
      assert.throws(
        () => validateDocumentFileSignature(htmlDisguisedAsPdf, 'application/pdf'),
        (err: any) => err instanceof ValidationError && err.message.includes('Firma binaria de PDF inválida')
      );
    });

    it('1.8 should reject unsupported MIME types (e.g. executables or scripts)', () => {
      const dummyExe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff', 'binary');
      assert.throws(
        () => validateDocumentFileSignature(dummyExe, 'application/x-msdownload'),
        (err: any) => err instanceof ValidationError && err.message.includes('Tipo MIME no soportado')
      );
    });

    it('1.9 should reject documents exceeding maximum size quota', () => {
      const largeBuffer = Buffer.alloc(16 * 1024 * 1024); // 16 MB
      largeBuffer[0] = 0x25;
      largeBuffer[1] = 0x50;
      largeBuffer[2] = 0x44;
      largeBuffer[3] = 0x46;
      largeBuffer[4] = 0x2d; // %PDF-
      assert.throws(
        () => validateDocumentFileSignature(largeBuffer, 'application/pdf', 15 * 1024 * 1024),
        (err: any) => err instanceof ValidationError && err.message.includes('supera el límite máximo')
      );
    });

    it('1.10 should sanitize filenames and strictly neutralize Path Traversal attempts', () => {
      assert.equal(sanitizeSafeFilename('../../../etc/passwd'), 'passwd');
      assert.equal(sanitizeSafeFilename('..\\..\\windows\\system32\\calc.exe'), 'calc.exe');
      assert.equal(sanitizeSafeFilename('partitura<>:"|?*prueba.pdf'), 'partitura_prueba.pdf');
      assert.equal(sanitizeSafeFilename(''), 'partitura_importada');
      assert.equal(sanitizeSafeFilename('   '), 'partitura_importada');
    });

    it('1.11 should strictly reject path traversal in LocalFileSystemDocumentStorageProvider.resolveSafePath', () => {
      assert.throws(
        () => storageProvider.resolveSafePath('../secret.txt'),
        (err: any) => err.message.includes('Path Traversal')
      );
      assert.throws(
        () => storageProvider.resolveSafePath('sub/../../secret.txt'),
        (err: any) => err.message.includes('Path Traversal')
      );
    });
  });

  // ==========================================================================
  // 2. DOCUMENT SERVICE: ALMACENAMIENTO Y PERSISTENCIA VISUAL
  // ==========================================================================
  describe('2. DocumentService & Persistencia Canónica de Documentos Visuales', () => {
    let inspectedDoc: any;

    it('2.1 should inspect and safely store a valid PDF document with SHA-256 checksum', async () => {
      inspectedDoc = await documentService.inspectAndStoreDocument({
        buffer: validPdfBuffer,
        filename: 'Himno_Victoria.pdf',
        mimeType: 'application/pdf',
        userId: testUserId,
      });

      assert.ok(inspectedDoc.documentId);
      assert.equal(inspectedDoc.filename, 'Himno_Victoria.pdf');
      assert.equal(inspectedDoc.detectedFormat, 'PDF');
      assert.equal(inspectedDoc.isVisualOnly, true);
      assert.equal(inspectedDoc.fileSizeBytes, validPdfBuffer.length);

      const expectedHash = crypto.createHash('sha256').update(validPdfBuffer).digest('hex');
      assert.equal(inspectedDoc.checksumSha256, expectedHash);
    });

    it('2.2 should retrieve stored document file and verify physical integrity', async () => {
      const fileData = await documentService.getDocumentFile(inspectedDoc.storageKey);
      assert.equal(fileData.fileSizeBytes, validPdfBuffer.length);
      assert.deepEqual(fileData.buffer, validPdfBuffer);
    });

    it('2.3 should persist a visual document as a canonical song with ZERO invented notes', async () => {
      const createdSong = await documentService.importVisualDocumentSong({
        storageKey: inspectedDoc.storageKey,
        filename: inspectedDoc.filename,
        mimeType: inspectedDoc.mimeType,
        title: 'Himno de la Victoria',
        artist: 'Bethesda Worship',
        userId: testUserId,
      });

      assert.ok(createdSong.song.id);
      assert.equal(createdSong.song.title, 'Himno de la Victoria');
      assert.equal(createdSong.song.artist, 'Bethesda Worship');
      assert.equal(createdSong.version.sourceFormat, 'PDF');

      // Invariante mandatorio: CERO notas o acordes inventados
      assert.equal(createdSong.version.totalMeasures, 0);
      assert.equal(createdSong.version.totalNotes, 0);
      assert.equal(createdSong.version.totalChords, 0);

      // El payload canónico debe tener measures vacío
      const payload: any = createdSong.version.canonicalPayload;
      assert.ok(Array.isArray(payload.measures));
      assert.equal(payload.measures.length, 0);
    });

    it('2.4 should throw NotFoundError when importing non-existent storage key', async () => {
      await assert.rejects(
        async () => {
          await documentService.importVisualDocumentSong({
            storageKey: 'non-existent-key.pdf',
            filename: 'test.pdf',
            mimeType: 'application/pdf',
          });
        },
        (err: any) => err instanceof NotFoundError
      );
    });
  });

  // ==========================================================================
  // 3. ENDPOINTS RESTful Y CONTROL DE ACCESO (RBAC)
  // ==========================================================================
  describe('3. Endpoints RESTful de Documentos (/api/v1/documents)', () => {
    let savedStorageKey = '';

    it('3.1 should reject unauthenticated requests to POST /api/v1/documents/inspect (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/inspect',
        payload: {
          filename: 'partitura.pdf',
          mimeType: 'application/pdf',
          dataBase64: validPdfBuffer.toString('base64'),
        },
      });
      assert.equal(res.statusCode, 401);
    });

    it('3.2 should accept authenticated POST /api/v1/documents/inspect and return 201 Created', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/inspect',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'Glorioso_Rey.pdf',
          mimeType: 'application/pdf',
          dataBase64: validPdfBuffer.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const json = JSON.parse(res.body);
      assert.ok(json.data.documentId);
      assert.equal(json.data.filename, 'Glorioso_Rey.pdf');
      assert.equal(json.data.detectedFormat, 'PDF');
      assert.ok(json.data.storageKey);
      savedStorageKey = json.data.storageKey;
    });

    it('3.3 should stream stored document via GET /api/v1/documents/:storageKey/file with correct headers', async () => {
      assert.ok(savedStorageKey, 'Se requiere storageKey guardado en la prueba anterior');

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${savedStorageKey}/file`,
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      assert.ok(res.headers['x-checksum-sha256']);
      assert.ok(res.headers['etag']);
      assert.equal(res.rawPayload.length, validPdfBuffer.length);
    });

    it('3.4 should import and persist visual document song via POST /api/v1/documents/import-song (201)', async () => {
      assert.ok(savedStorageKey);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/documents/import-song',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          storageKey: savedStorageKey,
          filename: 'Glorioso_Rey.pdf',
          mimeType: 'application/pdf',
          title: 'Glorioso Rey Señor',
          artist: 'Bethesda Madrid',
        },
      });

      assert.equal(res.statusCode, 201);
      const json = JSON.parse(res.body);
      assert.ok(json.data.song.id);
      assert.equal(json.data.song.title, 'Glorioso Rey Señor');
      assert.equal(json.data.version.sourceFormat, 'PDF');
      assert.equal(json.data.version.totalMeasures, 0);
    });

    it('3.5 should reject invalid storageKey path traversal attempts (404 / 500)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/documents/..%2F..%2Fetc%2Fpasswd/file',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
      });

      assert.ok(res.statusCode >= 400);
    });

    it('3.6 should reject GET /api/v1/documents/:storageKey/file without Bearer or Ticket (401)', async () => {
      assert.ok(savedStorageKey);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${savedStorageKey}/file`,
      });
      assert.equal(res.statusCode, 401);
      const json = JSON.parse(res.body);
      const message = json.error?.message ?? json.message;
      assert.match(message, /Autenticación requerida/i);
    });

    it('3.7 should issue single-use / short-lived document viewing ticket via POST /:storageKey/ticket', async () => {
      assert.ok(savedStorageKey);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${savedStorageKey}/ticket`,
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.ok(json.data.ticket);
      assert.equal(json.data.expiresInSeconds, 60);

      // 3.8 Visualizar documento usando el ticket emitido SIN encabezado de autorización
      const viewRes = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${savedStorageKey}/file?ticket=${encodeURIComponent(json.data.ticket)}`,
      });

      assert.equal(viewRes.statusCode, 200);
      assert.equal(viewRes.headers['content-type'], 'application/pdf');
      assert.equal(viewRes.rawPayload.length, validPdfBuffer.length);
    });

    it('3.9 should reject GET /api/v1/documents/:storageKey/file with invalid ticket (401)', async () => {
      assert.ok(savedStorageKey);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${savedStorageKey}/file?ticket=invalid-or-fake-ticket`,
      });
      assert.equal(res.statusCode, 401);
    });

    it('3.10 should detect page count accurately for a multipage PDF', async () => {
      const multiPagePdf = Buffer.from(
        '%PDF-1.4\n' +
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n' +
        '4 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n' +
        '5 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n' +
        'trailer\n<< /Root 1 0 R >>\n%%EOF',
        'utf-8'
      );

      const inspected = await documentService.inspectAndStoreDocument({
        buffer: multiPagePdf,
        filename: 'Multipage_Hymn.pdf',
        mimeType: 'application/pdf',
        userId: testUserId,
      });

      assert.equal(inspected.pageCount, 3, 'Debe detectar exactamente 3 páginas');
      assert.equal(inspected.isVisualOnly, true);
    });
  });
});
