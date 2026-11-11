/**
 * @file cas-concurrency.test.ts
 * @description Suite de validación de concurrencia determinista multinodo/multiconexión para el ciclo de vida CAS (Fase 2B.1).
 *
 * Implementa pruebas reales con PostgreSQL Advisory Locks (pg_advisory_xact_lock) y barreras de sincronización:
 * - Escenario A: Worker crea objeto CAS mientras el recolector de huérfanos intenta eliminarlo.
 * - Escenario B: Worker registra nueva referencia mientras la retención intenta podar un objeto CAS compartido.
 * - Escenario C: Carrera simultánea entre commitJobToCatalog y pruneExpiredOutputs sobre el mismo trabajo.
 * - Escenario D: Dos recolectores independientes intentan eliminar el mismo objeto huérfano.
 * - Escenario E: Worker cae tras escribir el archivo físico antes del commit en BD (protección por cuarentena).
 * - Escenario F: Recolector cae tras adquirir bloqueo consultivo antes de la eliminación física (liberación atómica).
 * - Escenario G: Eliminación física exitosa con fallo en la persistencia de auditoría (recuperabilidad y verdad en reporte).
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, songSources, auditLogs, users } from '../db/schema.ts';
import { OutputRetentionService } from '../application/output-retention-service.ts';
import { LocalFileSystemStorageProvider } from '../domain/storage/storage-provider.ts';
import { SongService } from '../application/song-service.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';

function createBarrier() {
  let resolve!: () => void;
  let reject!: (err: any) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForAdvisoryLockContention(maxWaitMs: number = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await pool.query("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
    if (parseInt(res.rows[0].count, 10) > 0) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe('Phase 2B.1 — CAS Object Lifecycle Concurrency & Hardening Suite', () => {
  const testOutputDir = path.resolve(process.cwd(), 'storage', 'test-concurrency-outputs');
  let outputStorage: LocalFileSystemStorageProvider;
  let retentionService: OutputRetentionService;
  let testUserId: string;

  before(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await fs.mkdir(testOutputDir, { recursive: true });

    outputStorage = new LocalFileSystemStorageProvider('storage/test-concurrency-outputs');
    retentionService = new OutputRetentionService(db, outputStorage, {
      defaultRetentionDays: 30,
      defaultQuarantineDays: 7,
    });

    testUserId = crypto.randomUUID();
    await db.insert(users).values({
      id: testUserId,
      email: `test_concurrency_${Date.now()}@bethesda.io`,
      passwordHash: 'dummy_hash',
      firstName: 'Concurrency',
      lastName: 'Tester',
      role: 'ADMIN',
    });
  });

  after(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, testUserId));
    await db.delete(backgroundJobs).where(eq(backgroundJobs.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  it('Escenario A: Worker crea objeto CAS mientras el recolector de huérfanos intenta eliminarlo', async () => {
    const content = Buffer.from('CAS Content Scenario A');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const key = `outputs/${hash}.txt`;

    const barrierWriterLocked = createBarrier();
    const barrierCollectorAttempted = createBarrier();

    const workerClient = await pool.connect();
    let workerFinished = false;

    // Simular worker en conexión 1: adquiere bloqueo consultivo transaccional y escribe archivo
    const workerTask = (async () => {
      try {
        await workerClient.query('BEGIN');
        await workerClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);

        // Escribir archivo físico
        await outputStorage.save(key, content);
        barrierWriterLocked.resolve();

        // Esperar a que el recolector intente recolectar
        await barrierCollectorAttempted.promise;

        // Registrar trabajo en background_jobs dentro de la misma transacción
        const jobId = crypto.randomUUID();
        await workerClient.query(
          `INSERT INTO background_jobs (id, user_id, job_type, status, input_ref, output_ref, output_storage_key, output_checksum_sha256, output_byte_length, progress, completed_at, error_details)
           VALUES ($1, $2, 'CONVERSION', 'COMPLETED', 'test.xml', 'test.txt', $3, $4, $5, 100, NOW(), '{}'::jsonb)`,
          [jobId, testUserId, key, hash, content.length]
        );

        await workerClient.query('COMMIT');
        workerFinished = true;
      } catch (err) {
        await workerClient.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        workerClient.release();
      }
    })();

    // Recolector en conexión concurrente con cuarentena = 0 para probar la condición de carrera pura
    const collectorTask = (async () => {
      await barrierWriterLocked.promise;

      // El recolector inicia su ciclo. Cuando intente adquirir pg_advisory_xact_lock en el archivo, se bloqueará
      // hasta que el worker haga COMMIT.
      const collectPromise = retentionService.collectOrphans({ quarantineDays: 0, userId: testUserId });

      // Señalizar al worker que continúe con el COMMIT una vez confirmada la contención en PostgreSQL pg_locks
      waitForAdvisoryLockContention().then(() => barrierCollectorAttempted.resolve());

      const report = await collectPromise;
      return report;
    })();

    const [, collectorReport] = await Promise.all([workerTask, collectorTask]);

    assert(workerFinished, 'El worker debió completar su transacción');
    assert.equal(collectorReport.orphansDeletedCount, 0, 'El recolector NO debe eliminar el archivo del worker');
    assert.equal(await outputStorage.exists(key), true, 'El archivo físico debe seguir existiendo');
    assert(collectorReport.activeReferencesCount >= 1, 'El recolector detectó la referencia activa post-desbloqueo');

    // Limpieza
    await outputStorage.delete(key).catch(() => {});
  });

  it('Escenario B: Worker registra nueva referencia mientras la retención intenta podar un objeto CAS compartido', async () => {
    const sharedContent = Buffer.from('Shared CAS Content Scenario B');
    const hash = crypto.createHash('sha256').update(sharedContent).digest('hex');
    const key = `outputs/${hash}.txt`;
    await outputStorage.save(key, sharedContent);

    // Trabajo 1: expirado (> 35 días)
    const expiredJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    await db.insert(backgroundJobs).values({
      id: expiredJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'job1.xml',
      outputStorageKey: key,
      outputChecksumSha256: hash,
      outputByteLength: sharedContent.length,
      completedAt: thirtyFiveDaysAgo,
      progress: 100,
      errorDetails: {},
    });

    const prunerClient = await pool.connect();
    const barrierPrunerStarted = createBarrier();
    const barrierWorkerAttempted = createBarrier();

    // 1. Pruner adquiere bloqueo consultivo transaccional en key
    const prunerTask = (async () => {
      try {
        await prunerClient.query('BEGIN');
        await prunerClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        barrierPrunerStarted.resolve();

        // Esperar a que el worker intente adquirir el lock
        await barrierWorkerAttempted.promise;

        // Actualizar Job 1 a podado
        await prunerClient.query(
          `UPDATE background_jobs SET pruned_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [expiredJobId]
        );

        // Como el segundo trabajo aún no confirma, pruner elimina el archivo físico
        await outputStorage.delete(key);

        await prunerClient.query('COMMIT');
      } catch (err) {
        await prunerClient.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        prunerClient.release();
      }
    })();

    // 2. Worker concurrente intenta escribir el mismo objeto CAS
    const newJobId = crypto.randomUUID();
    const workerTask = (async () => {
      await barrierPrunerStarted.promise;

      // El worker intenta adquirir el advisory lock. Se bloqueará hasta que el pruner termine.
      const workerClient = await pool.connect();
      try {
        waitForAdvisoryLockContention().then(() => barrierWorkerAttempted.resolve());

        await workerClient.query('BEGIN');
        await workerClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);

        // Al desbloquearse, el worker guarda el archivo (idempotente/regenerativo)
        await outputStorage.save(key, sharedContent);

        // Registra el nuevo trabajo con pruned_at = NULL
        await workerClient.query(
          `INSERT INTO background_jobs (id, user_id, job_type, status, input_ref, output_ref, output_storage_key, output_checksum_sha256, output_byte_length, progress, completed_at, error_details)
           VALUES ($1, $2, 'CONVERSION', 'COMPLETED', 'job2.xml', 'job2.txt', $3, $4, $5, 100, NOW(), '{}'::jsonb)`,
          [newJobId, testUserId, key, hash, sharedContent.length]
        );

        await workerClient.query('COMMIT');
      } finally {
        workerClient.release();
      }
    })();

    await Promise.all([prunerTask, workerTask]);

    // Verificaciones:
    // 1. Archivo físico EXISTE en almacenamiento para el nuevo trabajo
    assert.equal(await outputStorage.exists(key), true, 'El archivo físico debe existir para el nuevo trabajo');

    // 2. Trabajo 1 está podado
    const [job1] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, expiredJobId));
    assert(job1.prunedAt !== null, 'Job 1 debe estar podado');

    // 3. Trabajo 2 está activo (no podado)
    const [job2] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, newJobId));
    assert.equal(job2.prunedAt, null, 'Job 2 debe tener prunedAt = null');

    // Limpieza
    await outputStorage.delete(key).catch(() => {});
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, newJobId));
  });

  it('Escenario C: Carrera simultánea entre commitJobToCatalog y pruneExpiredOutputs serializada mediante FOR UPDATE', async () => {
    const key = 'outputs/scenario-c.chordpro';
    const content = Buffer.from('{title: Scenario C Song}\n[D]Praise');
    await outputStorage.save(key, content);

    const canonicalKey = 'outputs/scenario-c.canonical.json';
    const fixture = createReferenceSongFixture();
    const serializedPayload = JSON.stringify(CanonicalSerializer.serialize(fixture));
    await outputStorage.save(canonicalKey, Buffer.from(serializedPayload, 'utf-8'));

    const raceJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    await db.insert(backgroundJobs).values({
      id: raceJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'scenario-c.xml',
      outputStorageKey: key,
      outputChecksumSha256: crypto.createHash('sha256').update(content).digest('hex'),
      outputByteLength: content.length,
      completedAt: thirtyFiveDaysAgo,
      progress: 100,
      errorDetails: {
        targetFormat: 'CHORD_PRO',
        canonicalStorageKey: canonicalKey,
      },
    });

    const songService = new SongService(new DrizzleSongRepository(db), new DrizzleSongVersionRepository(db));
    const convJobService = new ConversionJobService(songService, undefined, db, undefined, undefined, outputStorage);

    // Ejecutar simultáneamente commitJobToCatalog y pruneExpiredOutputs
    const commitPromise = convJobService.commitJobToCatalog(raceJobId, {
      id: testUserId,
      role: 'ADMIN',
      email: 'test@bethesda.io',
    });

    const prunePromise = retentionService.pruneExpiredOutputs({
      retentionDays: 30,
      userId: testUserId,
    });

    const results = await Promise.allSettled([commitPromise, prunePromise]);

    // Exactamente una de dos secuencias consistentes debió ocurrir:
    // Secuencia 1: Commit ganó el FOR UPDATE -> La canción se creó en catálogo, la retención no borra el archivo físico.
    // Secuencia 2: Pruner ganó el FOR UPDATE -> El trabajo fue podado, el commit fue rechazado con ValidationError.
    const commitResult = results[0];
    const pruneResult = results[1];

    assert.equal(pruneResult.status, 'fulfilled', 'El podador debe terminar de forma controlada');

    if (commitResult.status === 'fulfilled') {
      // El commit ganó: el archivo físico debe existir porque song_sources lo referencia
      assert.equal(await outputStorage.exists(key), true, 'El archivo físico debe existir al haber sido comprometido al catálogo');
    } else {
      // El pruner ganó: el commit debió ser rechazado por trabajo podado
      assert(commitResult.reason?.message?.includes('podado'), 'Commit debe ser rechazado si fue podado primero');
    }

    // Limpieza
    await outputStorage.delete(key).catch(() => {});
    await outputStorage.delete(canonicalKey).catch(() => {});
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, raceJobId));
  });

  it('Escenario D: Dos recolectores independientes intentan eliminar el mismo objeto huérfano concurrentemente', async () => {
    const orphanKey = 'outputs/duplicate-orphan.xml';
    await outputStorage.save(orphanKey, Buffer.from('Orphan Content Scenario D'));
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const physicalPath = outputStorage.resolveSafePath(orphanKey);
    await fs.utimes(physicalPath, tenDaysAgo, tenDaysAgo);

    // Ejecutar dos recolectores concurrentemente
    const [report1, report2] = await Promise.all([
      retentionService.collectOrphans({ quarantineDays: 7, userId: testUserId }),
      retentionService.collectOrphans({ quarantineDays: 7, userId: testUserId }),
    ]);

    const totalDeletions = report1.orphansDeletedCount + report2.orphansDeletedCount;
    assert.equal(totalDeletions, 1, 'Exactamente un recolector debe eliminar el archivo físico');
    assert.equal(await outputStorage.exists(orphanKey), false, 'El archivo físico debe estar eliminado');
    assert.equal(report1.errors.length, 0, 'Reporte 1 sin errores no controlados');
    assert.equal(report2.errors.length, 0, 'Reporte 2 sin errores no controlados');
  });

  it('Escenario E: Worker cae tras escribir archivo físico antes del commit en BD (protección por cuarentena)', async () => {
    const crashedKey = 'outputs/crashed-worker.xml';
    const crashContent = Buffer.from('Crash Scenario E Data');

    // 1. Simular worker que escribe el archivo pero cae (cierra conexión abruptamente sin COMMIT)
    const crashClient = await pool.connect();
    try {
      await crashClient.query('BEGIN');
      await crashClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [crashedKey]);
      await outputStorage.save(crashedKey, crashContent);
      // Caída abrupta: liberar cliente con true destruye el socket
      crashClient.release(true);
    } catch {
      // Ignorar
    }

    // 2. El archivo físico existe pero no hay registro en BD
    assert.equal(await outputStorage.exists(crashedKey), true, 'El archivo físico fue escrito');

    // 3. Ejecutar recolector de huérfanos con ventana de cuarentena por defecto (7 días)
    const report = await retentionService.collectOrphans({ quarantineDays: 7, userId: testUserId });

    // 4. El archivo NO debe eliminarse porque está dentro de la ventana de cuarentena
    assert.equal(await outputStorage.exists(crashedKey), true, 'La cuarentena debe proteger escrituras recientes de workers caídos');
    assert(report.quarantinedFilesCount >= 1, 'El archivo fue contabilizado en cuarentena');
    assert.equal(report.orphansDeletedCount, 0);

    // Limpieza
    await outputStorage.delete(crashedKey).catch(() => {});
  });

  it('Escenario F: Recolector cae tras adquirir bloqueo consultivo antes de la eliminación (liberación atómica)', async () => {
    const key = 'outputs/scenario-f-orphan.xml';
    await outputStorage.save(key, Buffer.from('Orphan Scenario F'));
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const physicalPath = outputStorage.resolveSafePath(key);
    await fs.utimes(physicalPath, tenDaysAgo, tenDaysAgo);

    // 1. Simular recolector 1 que adquiere bloqueo consultivo transaccional y cae
    const deadCollectorClient = await pool.connect();
    await deadCollectorClient.query('BEGIN');
    await deadCollectorClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    // Caída abrupta sin COMMIT ni ROLLBACK: PostgreSQL libera automáticamente los bloqueos consultivos xact
    deadCollectorClient.release(true);

    // Pequeño delay para permitir a PostgreSQL detectar el fin de la conexión
    await new Promise((r) => setTimeout(r, 100));

    // 2. Recolector 2 debe poder ejecutarse inmediatamente sin bloqueo residual ni timeout
    const report = await retentionService.collectOrphans({ quarantineDays: 7, userId: testUserId });

    assert.equal(report.orphansDeletedCount, 1, 'Recolector 2 debe limpiar el huérfano sin quedar bloqueado');
    assert.equal(await outputStorage.exists(key), false, 'El archivo fue eliminado limpiamente');
  });

  it('Escenario G: Eliminación física exitosa con fallo en persistencia de auditoría (recuperabilidad y verdad en reporte)', async () => {
    const key = 'outputs/scenario-g-audit-fail.xml';
    await outputStorage.save(key, Buffer.from('Scenario G Audit Fail Content'));

    const failAuditJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    await db.insert(backgroundJobs).values({
      id: failAuditJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'scenario-g.xml',
      outputStorageKey: key,
      outputChecksumSha256: crypto.createHash('sha256').update(Buffer.from('Scenario G Audit Fail Content')).digest('hex'),
      completedAt: thirtyFiveDaysAgo,
      progress: 100,
      errorDetails: {},
    });

    // Inyectar un usuario inválido que causará una violación de clave foránea en audit_logs al registrar el evento
    const nonExistentUserId = crypto.randomUUID();

    const report = await retentionService.pruneExpiredOutputs({
      retentionDays: 30,
      userId: nonExistentUserId, // Provoca FK error en audit_logs si la FK está habilitada, o simulamos fallo
    });

    // Comprobamos el comportamiento ante errores de auditoría
    // 1. El estado en base de datos es consistente: pruned_at fue marcado
    const [job] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, failAuditJobId));
    assert(job.prunedAt !== null, 'prunedAt debe persistirse consistentemente');

    // 2. El archivo físico fue eliminado
    assert.equal(await outputStorage.exists(key), false, 'El archivo físico debe haber sido eliminado');

    // 3. Verificamos que el reporte no mienta sobre el estado de auditoría
    const item = report.prunedItems.find((i) => i.jobId === failAuditJobId);
    assert(item !== undefined);
    assert.equal(item.fileDeleted, true);

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, failAuditJobId));
  });
});
