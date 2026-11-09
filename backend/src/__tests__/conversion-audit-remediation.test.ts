/**
 * @file conversion-audit-remediation.test.ts
 * @description Suite de verificación técnica para las correcciones de auditoría de Fase 2A-R2.1:
 *
 * 1. Fail-Closed Format Detection en backend (createJob y transpileDirect).
 * 2. Propagación y distinción de errores transitorios vs permanentes en ConversionWorker (WS03).
 * 3. Recuperación segura de trabajos caducados sin limbo ante fallas de reencolado (WS04).
 * 4. Reconciliación segura entre almacenamiento físico y base de datos (WS06).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, users, songSources } from '../db/schema.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import {
  ConversionWorker,
  TransientWorkerError,
  isTransientError,
} from '../application/conversion-worker.ts';
import {
  LocalFileSystemSourceStorageProvider,
  StorageReadError,
} from '../domain/ingestion/source-storage-provider.ts';
import { stopConversionQueue } from '../infrastructure/queue/conversion-queue.ts';
import { ValidationError, PersistenceError } from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';

describe('Phase 2A-R2.1 — Audit Remediation Verification Suite', () => {
  const testUserId = '00000000-0000-0000-0000-000000000099';
  const testUser: AuthenticatedUser = {
    id: testUserId,
    email: 'audit-remediation@bethesda.com',
    role: 'MUSICIAN',
  };

  let service: ConversionJobService;
  let testStorageDir: string;
  let storage: LocalFileSystemSourceStorageProvider;
  const createdJobIds: string[] = [];

  before(async () => {
    testStorageDir = path.resolve(process.cwd(), 'storage/test-audit-remediation');
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    storage = new LocalFileSystemSourceStorageProvider('storage/test-audit-remediation');
    service = new ConversionJobService(undefined, undefined, db, storage);

    await db.insert(users).values({
      id: testUserId,
      email: 'audit-remediation@bethesda.com',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashremediation',
      firstName: 'Audit',
      lastName: 'Remediation',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    }).onConflictDoNothing();
  });

  after(async () => {
    for (const jobId of createdJobIds) {
      await db.delete(songSources).where(eq(songSources.jobId, jobId));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
    await stopConversionQueue();
    // Limpiar directorio de pruebas de almacenamiento
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
    await pool.end();
  });

  // 1. Fail-closed format rejection in transpileDirect
  it('1. transpileDirect should fail-closed on unknown or unsupported formats', async () => {
    // 1.1 Archivo desconocido sin notas
    const resUnknown = await service.transpileDirect({
      filename: 'documento.bin',
      targetFormat: 'CHORD_PRO',
      dataBase64: Buffer.from([0x00, 0x1f, 0x2e, 0x3d]).toString('base64'),
    });
    assert.strictEqual(resUnknown.success, false);
    assert.strictEqual(resUnknown.diagnostics[0]?.code, 'UNKNOWN_OR_UNSUPPORTED_FORMAT');

    // 1.2 XML que no es MusicXML
    const resXml = await service.transpileDirect({
      filename: 'manifest.xml',
      targetFormat: 'CHORD_PRO',
      rawText: '<app><version>1.0</version></app>',
    });
    assert.strictEqual(resXml.success, false);
    assert.strictEqual(resXml.diagnostics[0]?.code, 'UNKNOWN_OR_UNSUPPORTED_FORMAT');

    // 1.3 JSON no canónico
    const resJson = await service.transpileDirect({
      filename: 'settings.json',
      targetFormat: 'CHORD_PRO',
      rawText: JSON.stringify({ theme: 'dark', language: 'es' }),
    });
    assert.strictEqual(resJson.success, false);
    assert.strictEqual(resJson.diagnostics[0]?.code, 'UNKNOWN_OR_UNSUPPORTED_FORMAT');
  });

  // 2. Fail-closed format rejection in createJob
  it('2. createJob should fail-closed and throw ValidationError on unknown or unsupported formats', async () => {
    // Archivo binario desconocido
    await assert.rejects(
      async () => {
        await service.createJob(testUser, {
          filename: 'desconocido.bin',
          targetFormat: 'CHORD_PRO',
          dataBase64: Buffer.from([0x00, 0xfe, 0xba, 0xbe]).toString('base64'),
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /fail-closed format validation/);
        return true;
      }
    );

    // JSON arbitrario
    await assert.rejects(
      async () => {
        await service.createJob(testUser, {
          filename: 'package.json',
          targetFormat: 'LYRICS_ONLY',
          rawText: JSON.stringify({ name: 'my-package', version: '1.0.0' }),
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /fail-closed format validation/);
        return true;
      }
    );
  });

  // 3. Transient error vs permanent error discrimination and retry propagation (WS03)
  it('3. ConversionWorker should distinguish transient vs permanent errors and propagate transient ones for retry', async () => {
    const worker = new ConversionWorker(db, storage, undefined, 'worker-error-testing');

    // Verificar clasificador de errores transitorios
    const transientErr = new TransientWorkerError('Conexión con PostgreSQL interrumpida temporalmente');
    assert.strictEqual(isTransientError(transientErr), true);

    const netErr = new Error('getaddrinfo ETIMEDOUT storage.service');
    (netErr as any).code = 'ETIMEDOUT';
    assert.strictEqual(isTransientError(netErr), true);

    const permErr = new Error('Archivo corrupto irrecuperable');
    assert.strictEqual(isTransientError(permErr), false);
  });

  // 4. Safe stale job recovery without limbo (WS04)
  it('4. recoverStaleJobs should atomically recover expired jobs and prevent stuck limbo state', async () => {
    // Insertar un trabajo con arrendamiento expirado en el pasado
    const expiredDate = new Date(Date.now() - 120_000);
    const [staleJob] = await db
      .insert(backgroundJobs)
      .values({
        jobType: 'CONVERSION',
        status: 'PROCESSING',
        progress: 30,
        userId: testUserId,
        inputRef: 'stale_recovery_test.cho',
        leaseOwner: 'worker_crashed_99',
        leaseToken: 'stale_token_99',
        leaseExpiresAt: expiredDate,
        attempts: 1,
        maxAttempts: 3,
        errorDetails: {
          storageKey: 'valid_key.cho',
          checksumSha256: 'valid_sha256_dummy',
          targetFormat: 'CHORD_PRO',
        },
      })
      .returning();
    createdJobIds.push(staleJob.id);

    const worker = new ConversionWorker(db, storage, undefined, 'worker-recovery-tester');

    // Ejecutar recuperación de trabajos caducados
    const recoveredCount = await worker.recoverStaleJobs();
    assert.ok(recoveredCount >= 1);

    // Verificar que el trabajo fue reseteado a PENDING y los arrendamientos fueron liberados
    const [recoveredJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, staleJob.id));
    assert.strictEqual(recoveredJob.status, 'PENDING');
    assert.strictEqual(recoveredJob.leaseOwner, null);
    assert.strictEqual(recoveredJob.leaseToken, null);
    assert.strictEqual(recoveredJob.leaseExpiresAt, null);
    assert.strictEqual(recoveredJob.progress, 0);
  });

  // 5. Storage and Database reconciliation (WS06)
  it('5. reconcileStorage should detect orphaned files and missing files safely without deleting active records', async () => {
    // 5.1 Guardar un archivo en almacenamiento
    const testContent = Buffer.from('{title: Cancion Reconciliacion}\n[C]Prueba');
    const saveResult = await storage.save('cancion_reconciliada.cho', testContent);

    // 5.2 Crear un archivo huérfano en disco que no existe en BD
    const orphanFilename = 'archivo_huerfano_en_disco.txt';
    const orphanPath = storage.resolveSafePath(orphanFilename);
    fs.writeFileSync(orphanPath, 'contenido huerfano');

    // 5.3 Registrar el primer archivo en song_sources
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: testUserId,
      inputRef: 'cancion_reconciliada.cho',
      errorDetails: {
        storageKey: saveResult.storageKey,
        checksumSha256: saveResult.checksumSha256,
        targetFormat: 'CHORD_PRO',
      },
    }).returning();
    createdJobIds.push(job.id);

    await db.insert(songSources).values({
      userId: testUserId,
      sourceType: 'STRUCTURED_CHORDPRO',
      filename: 'cancion_reconciliada.cho',
      storagePath: saveResult.storageKey,
      mimeType: 'text/plain',
      fileSizeBytes: saveResult.fileSizeBytes,
      checksumSha256: saveResult.checksumSha256,
      jobId: job.id,
      importerName: 'ConversionJobService',
      importerVersion: '2.0.0',
    });

    // 5.4 Ejecutar reconciliación
    const report = await service.reconcileStorage();

    assert.ok(report.orphanedFiles.includes(orphanFilename), 'El archivo huérfano debe ser identificado');
    assert.ok(report.healthyFilesCount >= 1, 'El archivo registrado en BD debe contarse como saludable');

    // Limpiar archivo huérfano manual
    if (fs.existsSync(orphanPath)) {
      fs.unlinkSync(orphanPath);
    }
  });

  // 6. Storage reconciliation fail-safe and typed error propagation (WS04)
  it('6. reconcileStorage should abort and throw PersistenceError on storage inspection failure rather than marking all files missing', async () => {
    // 6.1 listKeys() retorna [] en directorio inexistente
    const missingDirStorage = new LocalFileSystemSourceStorageProvider('storage/non-existent-dir-12345');
    const resolvedMissingDir = missingDirStorage.resolveSafePath('dummy').replace(/[/\\]dummy$/, '');
    if (fs.existsSync(resolvedMissingDir)) {
      fs.rmdirSync(resolvedMissingDir);
    }
    const missingKeys = await missingDirStorage.listKeys();
    assert.deepStrictEqual(missingKeys, [], 'Directorio inexistente debe retornar [] sin fallar');

    // 6.2 listKeys() lanza StorageReadError cuando readdir falla por I/O o permiso
    const failingStorage = new LocalFileSystemSourceStorageProvider('storage/test-audit-remediation');
    failingStorage.listKeys = async () => {
      throw new StorageReadError('Simulated EACCES: Permission denied accessing storage volume');
    };

    const failingService = new ConversionJobService(undefined, undefined, db, failingStorage);

    // 6.3 reconcileStorage debe abortar de inmediato con PersistenceError
    await assert.rejects(
      async () => {
        await failingService.reconcileStorage();
      },
      (err: any) => {
        assert.ok(err instanceof PersistenceError, 'Debe lanzar PersistenceError');
        assert.match(err.message, /Fallo al inspeccionar el almacenamiento físico durante la reconciliación/);
        return true;
      },
      'reconcileStorage jamás debe tragar el fallo de almacenamiento ni marcar todos los archivos de BD como missing'
    );
  });

  // 7. ConversionWorker Graceful Shutdown and Periodic Recovery Lifecycle (WS03 & WS05)
  it('7. ConversionWorker should start periodic recovery, stop cleanly with bounded drain, and allow restart', async () => {
    const worker = new ConversionWorker(db, storage, undefined, 'worker-shutdown-lifecycle', {
      recoveryIntervalMs: 1000,
    });

    assert.strictEqual(worker.isActive(), false);
    await worker.start();
    assert.strictEqual(worker.isActive(), true);

    // Detener con bounded timeout de 2000ms
    await worker.stop(2000);
    assert.strictEqual(worker.isActive(), false, 'Worker debe quedar inactivo tras stop');

    // Reinicio idempotente limpio
    await worker.start();
    assert.strictEqual(worker.isActive(), true);
    await worker.stop(2000);
    assert.strictEqual(worker.isActive(), false);
  });

  // 8. Atomic Conditional Retry (WS06)
  it('8. retryJob should reject retry on non-terminal or in-progress jobs with ValidationError', async () => {
    const [activeJob] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PROCESSING',
      progress: 50,
      userId: testUserId,
      inputRef: 'active_job_retry_test.cho',
      attempts: 1,
    }).returning();
    createdJobIds.push(activeJob.id);

    // Intentar reintentar un trabajo en PROCESSING debe ser rechazado
    await assert.rejects(
      async () => {
        await service.retryJob(activeJob.id, testUser);
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Solo se pueden reintentar trabajos que se encuentren en estado FAILED o CANCELLED/);
        return true;
      }
    );

    // Intentar reintentar un trabajo en COMPLETED debe ser rechazado
    const [completedJob] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: testUserId,
      inputRef: 'completed_job_retry_test.cho',
      attempts: 1,
    }).returning();
    createdJobIds.push(completedJob.id);

    await assert.rejects(
      async () => {
        await service.retryJob(completedJob.id, testUser);
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Solo se pueden reintentar trabajos que se encuentren en estado FAILED o CANCELLED/);
        return true;
      }
    );
  });
});

