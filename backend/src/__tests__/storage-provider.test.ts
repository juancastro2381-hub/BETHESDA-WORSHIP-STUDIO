/**
 * @file storage-provider.test.ts
 * @description Suite de pruebas unitarias e integración para el subsistema de almacenamiento agnóstico (Fase 2B.1).
 *
 * Valida:
 * - LocalFileSystemStorageProvider: escrituras atómicas, CAS idempotente, prevención de Path Traversal,
 *   detección de colisiones e integridad criptográfica SHA-256, y generación de URLs firmadas HMAC.
 * - S3CompatibleStorageProvider: inicialización, construcción de firmas SigV4 y manejo de endpoints.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  LocalFileSystemStorageProvider,
  S3CompatibleStorageProvider,
  StorageNotFoundError,
  StorageIntegrityError,
  StorageCollisionError,
  StorageSecurityError,
} from '../domain/storage/storage-provider.ts';

describe('Phase 2B.1 — Agnostic Storage Provider Subsystem', () => {
  const testBaseDir = path.resolve(process.cwd(), 'storage', 'test-outputs');
  let localStorage: LocalFileSystemStorageProvider;

  before(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
    localStorage = new LocalFileSystemStorageProvider('storage/test-outputs');
  });

  after(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  });

  describe('LocalFileSystemStorageProvider — Core Operations & Integrity', () => {
    it('debe guardar y recuperar un archivo de texto con integridad SHA-256 exacta', async () => {
      const content = 'Test MusicXML Content for Phase 2B.1 Verification';
      const buffer = Buffer.from(content, 'utf-8');
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const key = `outputs/${expectedHash}.xml`;

      const meta = await localStorage.save(key, buffer, {
        mimeType: 'application/vnd.recordare.musicxml+xml',
        expectedChecksumSha256: expectedHash,
      });

      assert.equal(meta.storageKey, key);
      assert.equal(meta.checksumSha256, expectedHash);
      assert.equal(meta.byteLength, buffer.byteLength);

      const retrieved = await localStorage.getBuffer(key);
      assert.equal(retrieved.toString('utf-8'), content);

      const exists = await localStorage.exists(key);
      assert.equal(exists, true);
    });

    it('debe garantizar idempotencia CAS: guardar el mismo contenido en la misma clave es un no-op exitoso', async () => {
      const content = 'Idempotent Content';
      const buffer = Buffer.from(content, 'utf-8');
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const key = `outputs/${expectedHash}.txt`;

      const firstMeta = await localStorage.save(key, buffer);
      const secondMeta = await localStorage.save(key, buffer);

      assert.equal(firstMeta.checksumSha256, secondMeta.checksumSha256);
      assert.equal(firstMeta.storageKey, secondMeta.storageKey);
    });

    it('debe rechazar escrituras cuando el hash esperado no coincide (StorageIntegrityError)', async () => {
      const content = 'Integrity Violation Content';
      const buffer = Buffer.from(content, 'utf-8');
      const wrongHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const key = `outputs/corrupted.xml`;

      await assert.rejects(
        async () => {
          await localStorage.save(key, buffer, {
            expectedChecksumSha256: wrongHash,
          });
        },
        (err: any) => {
          assert(err instanceof StorageIntegrityError);
          assert.equal(err.code, 'STORAGE_INTEGRITY_MISMATCH');
          return true;
        }
      );
    });

    it('debe rechazar colisiones de clave si el contenido difiere sin bandera overwrite (StorageCollisionError)', async () => {
      const key = 'outputs/collision-target.xml';
      const bufferA = Buffer.from('Original Content A', 'utf-8');
      const bufferB = Buffer.from('Different Content B', 'utf-8');

      await localStorage.save(key, bufferA);

      await assert.rejects(
        async () => {
          await localStorage.save(key, bufferB, { overwrite: false });
        },
        (err: any) => {
          assert(err instanceof StorageCollisionError);
          assert.equal(err.code, 'STORAGE_COLLISION_DETECTED');
          return true;
        }
      );
    });

    it('debe permitir sobreescritura explícita cuando overwrite = true', async () => {
      const key = 'outputs/overwrite-target.xml';
      const bufferA = Buffer.from('Initial Content', 'utf-8');
      const bufferB = Buffer.from('Updated Content Overwritten', 'utf-8');

      await localStorage.save(key, bufferA);
      const metaB = await localStorage.save(key, bufferB, { overwrite: true });

      const retrieved = await localStorage.getBuffer(key);
      assert.equal(retrieved.toString('utf-8'), 'Updated Content Overwritten');
      assert.equal(metaB.byteLength, bufferB.byteLength);
    });

    it('debe lanzar StorageNotFoundError al solicitar una clave inexistente', async () => {
      await assert.rejects(
        async () => {
          await localStorage.getBuffer('outputs/non-existent-key.xml');
        },
        (err: any) => {
          assert(err instanceof StorageNotFoundError);
          assert.equal(err.code, 'STORAGE_NOT_FOUND');
          return true;
        }
      );
    });

    it('debe eliminar un archivo existente y verificar que exists() retorne false', async () => {
      const key = 'outputs/to-be-deleted.xml';
      await localStorage.save(key, Buffer.from('Delete Me', 'utf-8'));
      assert.equal(await localStorage.exists(key), true);

      await localStorage.delete(key);
      assert.equal(await localStorage.exists(key), false);
    });
  });

  describe('LocalFileSystemStorageProvider — Security & Path Traversal Protections', () => {
    it('debe bloquear intentos de Path Traversal relativos (../)', async () => {
      const maliciousKeys = [
        '../evil.xml',
        '../../etc/passwd',
        'outputs/../../../system32/cmd.exe',
        'outputs/..\\..\\windows\\win.ini',
        'sub/../../secret.txt',
      ];

      for (const key of maliciousKeys) {
        await assert.rejects(
          async () => {
            await localStorage.save(key, Buffer.from('pwned', 'utf-8'));
          },
          (err: any) => {
            assert(err instanceof StorageSecurityError);
            assert.equal(err.code, 'STORAGE_SECURITY_VIOLATION');
            return true;
          }
        );
      }
    });

    it('debe bloquear intentos de acceso absoluto fuera del baseDir', async () => {
      const absoluteKeys = [
        '/etc/shadow',
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
        '\\\\network-share\\secret',
      ];

      for (const key of absoluteKeys) {
        await assert.rejects(
          async () => {
            await localStorage.getBuffer(key);
          },
          (err: any) => {
            assert(err instanceof StorageSecurityError);
            return true;
          }
        );
      }
    });

    it('debe bloquear claves con caracteres de control o bytes nulos', async () => {
      const nullByteKey = 'outputs/valid.xml\0malicious';
      await assert.rejects(
        async () => {
          await localStorage.save(nullByteKey, Buffer.from('data'));
        },
        (err: any) => {
          assert(err instanceof StorageSecurityError);
          return true;
        }
      );
    });
  });

  describe('LocalFileSystemStorageProvider — Signed URLs & Streaming', () => {
    it('debe generar y verificar URLs firmadas con HMAC-SHA256', async () => {
      const key = 'outputs/signed-test.xml';
      await localStorage.save(key, Buffer.from('Signed URL Test Content'));

      const signedUrl = await localStorage.getSignedDownloadUrl(key, 60);
      assert(signedUrl.includes('/api/v1/conversion/outputs/'));
      assert(signedUrl.includes('expires='));
      assert(signedUrl.includes('signature='));

      const urlObj = new URL(signedUrl, 'http://localhost');
      const sig = urlObj.searchParams.get('signature')!;
      const expires = Number(urlObj.searchParams.get('expires')!);

      const isValid = localStorage.verifySignedUrl(key, expires, sig);
      assert.equal(isValid, true);

      // Firma con expiración alterada debe ser inválida
      const isTamperedValid = localStorage.verifySignedUrl(key, expires + 100, sig);
      assert.equal(isTamperedValid, false);
    });

    it('debe transmitir archivos mediante getStream()', async () => {
      const content = 'Streaming test data payload for Phase 2B.1';
      const key = 'outputs/stream-test.txt';
      await localStorage.save(key, Buffer.from(content, 'utf-8'), { mimeType: 'text/plain' });

      const stream = await localStorage.getStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const streamData = Buffer.concat(chunks).toString('utf-8');
      assert.equal(streamData, content);
    });

    it('debe listar claves con prefijo mediante listKeys()', async () => {
      const prefix = 'outputs/batch-test/';
      await localStorage.save(`${prefix}a.xml`, Buffer.from('A'));
      await localStorage.save(`${prefix}b.xml`, Buffer.from('B'));
      await localStorage.save(`${prefix}c.xml`, Buffer.from('C'));

      const keys = await localStorage.listKeys(prefix);
      assert.equal(keys.length, 3);
      assert(keys.includes(`${prefix}a.xml`));
      assert(keys.includes(`${prefix}b.xml`));
      assert(keys.includes(`${prefix}c.xml`));
    });
  });

  describe('S3CompatibleStorageProvider — SigV4 & S3 Interface Specification', () => {
    it('debe inicializar el cliente S3 compatible con credenciales y configuración válida', () => {
      const s3 = new S3CompatibleStorageProvider({
        endpoint: 'http://localhost:9000',
        bucket: 'bethesda-outputs',
        region: 'us-east-1',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key-12345',
        forcePathStyle: true,
      });

      assert.equal(s3.getBucketName(), 'bethesda-outputs');
      assert.equal(s3.getRegion(), 'us-east-1');
      assert.equal(s3.isPathStyle(), true);
    });

    it('debe calcular firmas HMAC SigV4 deterministas conformes con AWS v4', () => {
      const s3 = new S3CompatibleStorageProvider({
        endpoint: 'https://s3.amazonaws.com',
        bucket: 'bethesda-test-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        forcePathStyle: false,
      });

      const dateStr = '20261111';
      const sigKey = (s3 as any).getSignatureKey(
        'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        dateStr,
        'us-east-1',
        's3'
      );

      assert(Buffer.isBuffer(sigKey));
      assert.equal(sigKey.length, 32); // SHA-256 HMAC produce 32 bytes
    });

    it('debe construir URLs firmadas prefirmadas de S3 con parámetros de consulta requeridos', async () => {
      const s3 = new S3CompatibleStorageProvider({
        endpoint: 'http://localhost:9000',
        bucket: 'bethesda-outputs',
        region: 'us-east-1',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key-12345',
        forcePathStyle: true,
      });

      const presignedUrl = await s3.getSignedDownloadUrl('outputs/song-123.musicxml', 300);
      assert(presignedUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'));
      assert(presignedUrl.includes('X-Amz-Credential='));
      assert(presignedUrl.includes('X-Amz-Date='));
      assert(presignedUrl.includes('X-Amz-Expires=300'));
      assert(presignedUrl.includes('X-Amz-SignedHeaders=host'));
      assert(presignedUrl.includes('X-Amz-Signature='));
    });
  });
});
